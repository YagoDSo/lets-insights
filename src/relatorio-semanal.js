import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { listarCampanhas, relatorioEmail } from './lib/egoi-reports.js';
import {
  agruparEdicoes, calcularSinais, montarRelatorioHTML, validarSugestoes, renderizarSugestoes, limparUrl,
} from './lib/relatorio.js';

// ─────────────────────────────────────────────────────────────
// Relatório semanal da newsletter (nov/2026). Roda na máquina do Yago,
// chamado pela tarefa agendada "relatorio-news-semanal" do app Claude
// (sexta, sábado, domingo e segunda, várias janelas: a primeira que pegar o
// computador ligado faz o relatório; as outras veem o marcador e saem).
//
//   node src/relatorio-semanal.js gerar [--forcar]   → relatorio.html + sinais.json
//   node src/relatorio-semanal.js sugestoes <arq>    → relatorio-final.html + log
//   node src/relatorio-semanal.js concluir [id]      → marcador concluido.json
//
// Só LÊ o E-goi e o banco (baixado do GitHub, sem tocar no checkout local).
// Não envia nada: o e-mail vira rascunho no Gmail pela sessão do Claude.
// ─────────────────────────────────────────────────────────────

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = process.env.RELATORIO_DIR || path.join(RAIZ, 'Relatorios', 'semanal');
const LOG_SUGESTOES = path.join(PASTA, 'sugestoes.json');
const URL_BANCO = 'https://raw.githubusercontent.com/YagoDSo/lets-insights/main/data/newsletter.db';
const EDICOES_ANALISADAS = 8;

const lerJSON = (arq, padrao) => (fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : padrao);
const gravarJSON = (arq, dados) => fs.writeFileSync(arq, JSON.stringify(dados, null, 2) + '\n');
const pastaEdicao = (data) => path.join(PASTA, data);
const saida = (obj) => console.log(JSON.stringify(obj, null, 2));

async function campanhasEnviadas() {
  const todas = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const { items = [] } = await listarCampanhas({ channel: 'email', limit: 100, offset });
    todas.push(...items);
    if (items.length < 100) break;
  }
  return todas.filter((c) => c.status === 'sent' && c.start_date && /^POR PUBLICAR · /.test(c.internal_name || ''));
}

async function abrirBanco() {
  let arq = process.env.RELATORIO_DB;
  if (!arq) {
    const resp = await fetch(URL_BANCO);
    if (!resp.ok) throw new Error(`banco: HTTP ${resp.status} em ${URL_BANCO}`);
    arq = path.join(os.tmpdir(), `lets-insights-relatorio-${process.pid}.db`);
    fs.writeFileSync(arq, Buffer.from(await resp.arrayBuffer()));
  }
  return new Database(arq, { readonly: true, fileMustExist: true });
}

const parse = (txt, padrao) => { try { return txt ? JSON.parse(txt) : padrao; } catch { return padrao; } };

// Itens da edição a partir do banco, com as versões em que cada um saiu.
function itensDaEdicao(db, edicao, manchete) {
  const norm = (s) => String(s || '').replace(/^Let's Insights · /, '').trim();
  const linha = db.prepare('SELECT * FROM edicoes').all().find((l) => norm(l.titulo_edicao) === norm(manchete));
  if (!linha) return { numero: null, itens: [] };
  const versoesEnviadas = new Set(edicao.campanhas.map((c) => c.versao));
  const porUrl = new Map();
  const add = (it, versao, tipo) => {
    if (!it?.url) return;
    const k = limparUrl(it.url);
    const atual = porUrl.get(k) || { tipo: it.tipo || tipo, fonte: it.fonte || (tipo === 'blog' ? "Blog Let's" : ''), categoria: it.categoria || '', titulo: it.titulo || '', url: it.url, versoes: [] };
    if (!atual.versoes.includes(versao)) atual.versoes.push(versao);
    porUrl.set(k, atual);
  };
  const versoes = db.prepare('SELECT versao, json_itens FROM edicoes_versoes WHERE edicao = ?').all(linha.edicao);
  if (versoes.length) {
    for (const v of versoes) {
      if (!versoesEnviadas.has(v.versao)) continue;
      for (const it of parse(v.json_itens, [])) add(it, v.versao, it.tipo);
    }
  } else {
    const blog = parse(linha.json_blog, null);
    for (const b of [].concat(blog || [])) for (const v of versoesEnviadas) add(b, v, 'blog');
    for (const it of parse(linha.json_artigos_principais, [])) for (const v of versoesEnviadas) add(it, v, 'noticia');
  }
  return { numero: Number(linha.edicao), itens: [...porUrl.values()] };
}

async function gerar({ forcar }) {
  const campanhas = await campanhasEnviadas();
  const edicoes = agruparEdicoes(campanhas).slice(-EDICOES_ANALISADAS);
  if (!edicoes.length) return saida({ status: 'sem_edicao' });
  const atual = edicoes.at(-1);
  const pasta = pastaEdicao(atual.data);
  if (!forcar && fs.existsSync(path.join(pasta, 'concluido.json'))) {
    return saida({ status: 'ja_feito', data_edicao: atual.data, pasta });
  }

  // Relatório completo (com cliques por link) de cada campanha.
  for (const e of edicoes) {
    for (const c of e.campanhas) {
      const rel = await relatorioEmail(c.campaign_hash);
      c.overall = rel.overall; c.url = rel.url || [];
    }
  }
  const db = await abrirBanco();
  for (const e of edicoes) Object.assign(e, itensDaEdicao(db, e, e.manchete));
  db.close();

  const sinais = calcularSinais(edicoes);
  sinais.edicao.numero = atual.numero;
  const log = lerJSON(LOG_SUGESTOES, []);
  sinais.sugestoes_anteriores = log;

  fs.mkdirSync(pasta, { recursive: true });
  gravarJSON(path.join(pasta, 'sinais.json'), sinais);
  fs.writeFileSync(path.join(pasta, 'relatorio.html'), montarRelatorioHTML(sinais, { sugestoesAnteriores: log }));
  saida({ status: 'gerado', data_edicao: atual.data, horas_desde_envio: sinais.edicao.horas_desde_envio, pasta, alertas: sinais.alertas });
}

function sugestoes(arquivo) {
  if (!arquivo) throw new Error('uso: sugestoes <arquivo.json>');
  const lista = validarSugestoes(lerJSON(path.resolve(arquivo), null));
  const pasta = path.dirname(path.resolve(arquivo));
  const sinais = lerJSON(path.join(pasta, 'sinais.json'), null);
  if (!sinais) throw new Error(`sinais.json não encontrado em ${pasta}`);
  const html = renderizarSugestoes(fs.readFileSync(path.join(pasta, 'relatorio.html'), 'utf8'), lista);
  fs.writeFileSync(path.join(pasta, 'relatorio-final.html'), html);

  const log = lerJSON(LOG_SUGESTOES, []).filter((x) => x.data_edicao !== sinais.edicao.data);
  const agora = new Date().toISOString();
  lista.forEach((x, i) => log.push({ id: `${sinais.edicao.data}-${i + 1}`, data_edicao: sinais.edicao.data, criada_em: agora, status: 'pendente', ...x }));
  fs.mkdirSync(PASTA, { recursive: true });
  gravarJSON(LOG_SUGESTOES, log);
  saida({ status: 'ok', html: path.join(pasta, 'relatorio-final.html'), sugestoes: lista.length });
}

function concluir(data, rascunho) {
  if (!data) throw new Error('uso: concluir <data-edicao AAAA-MM-DD> [id-do-rascunho]');
  const pasta = pastaEdicao(data);
  if (!fs.existsSync(path.join(pasta, 'relatorio-final.html'))) throw new Error(`relatorio-final.html não existe em ${pasta}`);
  gravarJSON(path.join(pasta, 'concluido.json'), { concluido_em: new Date().toISOString(), rascunho_gmail: rascunho || null });
  saida({ status: 'concluido', pasta });
}

const [cmd = 'gerar', ...args] = process.argv.slice(2);
const acoes = {
  gerar: () => gerar({ forcar: args.includes('--forcar') }),
  sugestoes: () => sugestoes(args[0]),
  concluir: () => concluir(args[0], args[1]),
};
Promise.resolve()
  .then(() => (acoes[cmd] || (() => { throw new Error(`comando desconhecido: ${cmd}`); }))())
  .catch((erro) => { console.error('Erro no relatório semanal:', erro.message); process.exitCode = 1; });
