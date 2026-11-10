// ─────────────────────────────────────────────────────────────
// Relatório semanal da newsletter (nov/2026): funções puras de agregação,
// sinais e HTML. Quem busca os dados (E-goi + banco) é src/relatorio-semanal.js.
//
// Divisão de trabalho: o CÓDIGO calcula os sinais e aplica as travas de
// amostra; as sugestões de melhoria são escritas por uma sessão do Claude
// (tarefa agendada no app do Yago) a partir de sinais.json, e voltam pra cá
// só pra serem renderizadas (renderizarSugestoes). Nada aqui envia e-mail
// nem altera o pipeline.
// ─────────────────────────────────────────────────────────────

export const MIN_EDICOES_SEGMENTO = 4; // abaixo disso, sinal de segmento é "amostra pequena"
export const MIN_ABERTURAS_CONFIAVEL = 20;
export const MIN_APARICOES_FONTE = 3;
export const HORAS_MINIMAS_ENVIO = 60; // antes disso os números ainda sobem bastante

const ROTULO_VERSAO = {
  'Mineração': 'mineracao', 'Indústria': 'industria', 'Engenharia': 'engenharia',
  'Tecnologia': 'tecnologia', 'Florestal': 'florestal', 'Geral': 'geral_clientes',
};
export const NOME_VERSAO = {
  geral_comercial: 'Geral comercial', geral_clientes: 'Gestores · Geral', gestores: 'Gestores (versão única)',
  mineracao: 'Gestores · Mineração', industria: 'Gestores · Indústria', engenharia: 'Gestores · Engenharia',
  tecnologia: 'Gestores · Tecnologia', florestal: 'Gestores · Florestal',
};

// "POR PUBLICAR · <manchete> · <lista>" ou "POR PUBLICAR · Gestores · <Segmento> · <manchete>"
export function lerNomeCampanha(nome) {
  const partes = String(nome).split(' · ').map((p) => p.trim());
  if (partes[0] !== 'POR PUBLICAR') return null;
  if (partes[1] === 'Gestores' && partes.length >= 4) {
    return { manchete: partes.slice(3).join(' · '), lista: 'Gestores 2025', versao: ROTULO_VERSAO[partes[2]] || 'geral_clientes' };
  }
  const lista = partes.at(-1);
  const manchete = partes.slice(1, -1).join(' · ');
  return { manchete, lista, versao: /Gestores/.test(lista) ? 'gestores' : 'geral_comercial' };
}

export function limparUrl(url) {
  return String(url || '').split('?')[0].replace(/\/$/, '');
}

export function classificarLink(url) {
  if (/!remove|unsubscribe|descadastr/i.test(url)) return 'descadastro';
  if (/utm_content=rodape/.test(url)) return 'rodape';
  if (/solicitar-proposta/.test(url)) return 'cta';
  return 'conteudo';
}

// Estrutura do assunto (regra 7 do CLAUDE.md): afirmativa, contraste ou pergunta.
export function estruturaAssunto(titulo) {
  const t = String(titulo || '').trim();
  if (/\?$/.test(t) || /^por que\b/i.test(t)) return 'pergunta';
  if (/[.!]\s+\S/.test(t)) return 'contraste';
  return 'afirmativa';
}

const taxa = (a, b) => (b ? a / b : null);
const media = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };

export function somar(campanhas) {
  const t = { envios: 0, aberturas: 0, cliques: 0, descadastros: 0, bounces: 0, reclamacoes: 0, cta: 0, rodape: 0, conteudo: 0 };
  for (const c of campanhas) {
    const o = c.overall || {};
    t.envios += o.sends || 0; t.aberturas += o.unique_opens || 0; t.cliques += o.unique_clicks || 0;
    t.descadastros += o.unsubscriptions || 0; t.bounces += (o.hard_bounces || 0) + (o.soft_bounces || 0); t.reclamacoes += o.complaints || 0;
    for (const l of c.url || []) {
      const tipo = classificarLink(l.url);
      if (tipo === 'cta') t.cta += l.clicks; else if (tipo === 'rodape') t.rodape += l.clicks; else if (tipo === 'conteudo') t.conteudo += l.clicks;
    }
  }
  t.abertura = taxa(t.aberturas, t.envios); t.ctr = taxa(t.cliques, t.aberturas);
  return t;
}

// Agrupa campanhas enviadas (já filtradas por "POR PUBLICAR" e status sent) por dia de envio.
export function agruparEdicoes(campanhas) {
  const porDia = new Map();
  for (const c of campanhas) {
    const info = lerNomeCampanha(c.internal_name);
    if (!info || !c.start_date) continue;
    const dia = c.start_date.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, { data: dia, enviadoEm: c.start_date, campanhas: [] });
    const e = porDia.get(dia);
    if (c.start_date < e.enviadoEm) e.enviadoEm = c.start_date;
    e.campanhas.push({ ...c, ...info });
  }
  for (const e of porDia.values()) {
    e.manchete = (e.campanhas.find((c) => c.versao === 'geral_comercial') || e.campanhas[0]).manchete;
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data));
}

// Cliques por item (url limpa), somando todas as campanhas da edição.
function cliquesPorUrl(campanhas) {
  const m = new Map();
  for (const c of campanhas) for (const l of c.url || []) {
    if (classificarLink(l.url) !== 'conteudo') continue;
    const u = limparUrl(l.url);
    m.set(u, (m.get(u) || 0) + l.clicks);
  }
  return m;
}

// edicoes: saída de agruparEdicoes, cada uma com `itens` = [{tipo, fonte, categoria, titulo, url, versoes:[...]}]
// (preenchido pelo script a partir do banco; pode vir vazio se a edição não for achada).
export function calcularSinais(edicoes, { agora = new Date() } = {}) {
  const atual = edicoes.at(-1);
  const anteriores = edicoes.slice(-5, -1);
  const tot = somar(atual.campanhas);
  const totAnt = anteriores.map((e) => ({ data: e.data, manchete: e.manchete, ...somar(e.campanhas) }));
  const horas = Math.round((agora - new Date(atual.enviadoEm.replace(' ', 'T') + '-03:00')) / 36e5);

  const resumo = {
    ...tot,
    media_anteriores: {
      abertura: media(totAnt.map((t) => t.abertura)), ctr: media(totAnt.map((t) => t.ctr)),
      cta: media(totAnt.map((t) => t.cta)), descadastros: media(totAnt.map((t) => t.descadastros)),
      bounces: media(totAnt.map((t) => t.bounces)),
    },
    datas_anteriores: anteriores.map((e) => e.data),
  };

  // Versões (atual + acumulado nas edições em que a versão existiu).
  const versoes = {};
  for (const e of edicoes) for (const c of e.campanhas) {
    const v = (versoes[c.versao] ||= { versao: c.versao, nome: NOME_VERSAO[c.versao] || c.versao, edicoes: new Set(), acumulado: [], atual: [] });
    v.edicoes.add(e.data); v.acumulado.push(c);
    if (e === atual) v.atual.push(c);
  }
  const listaVersoes = Object.values(versoes).filter((v) => v.atual.length).map((v) => {
    const a = somar(v.atual); const acc = somar(v.acumulado);
    const n = v.edicoes.size;
    return {
      versao: v.versao, nome: v.nome, lista: v.atual[0].lista,
      atual: { envios: a.envios, aberturas: a.aberturas, abertura: a.abertura, cliques: a.cliques, ctr: a.ctr, bounces: a.bounces },
      acumulado: { edicoes: n, envios: acc.envios, aberturas: acc.aberturas, abertura: acc.abertura, ctr: acc.ctr },
      confianca: n >= MIN_EDICOES_SEGMENTO && acc.aberturas >= MIN_ABERTURAS_CONFIAVEL ? 'ok' : 'amostra_pequena',
    };
  });

  // Itens: cliques por matéria na edição atual e desempenho por fonte/tipo/categoria no histórico.
  const porFonte = {}; const porTipo = {}; const porCategoria = {};
  const conta = (obj, k, cliques, data) => { const x = (obj[k] ||= { aparicoes: 0, cliques: 0, edicoes: new Set() }); x.aparicoes++; x.cliques += cliques; x.edicoes.add(data); };
  let itensAtual = [];
  for (const e of edicoes) {
    const cliques = cliquesPorUrl(e.campanhas);
    for (const it of e.itens || []) {
      const c = cliques.get(limparUrl(it.url)) || 0;
      conta(porFonte, it.fonte || '?', c, e.data);
      conta(porTipo, it.tipo || 'noticia', c, e.data);
      if (it.tipo !== 'blog') conta(porCategoria, it.categoria || '?', c, e.data);
      if (e === atual) itensAtual.push({ ...it, cliques: c });
    }
  }
  itensAtual = itensAtual.sort((a, b) => b.cliques - a.cliques);
  const fechar = (obj) => Object.entries(obj).map(([k, x]) => ({ chave: k, aparicoes: x.aparicoes, edicoes: x.edicoes.size, cliques: x.cliques, cliques_por_aparicao: +(x.cliques / x.aparicoes).toFixed(2) }))
    .sort((a, b) => b.cliques_por_aparicao - a.cliques_por_aparicao);
  const fontes = fechar(porFonte);

  // Assunto: abertura da versão geral comercial (listas 34 e 69) por estrutura.
  const assuntos = edicoes.map((e) => {
    const gerais = e.campanhas.filter((c) => c.versao === 'geral_comercial');
    const s = somar(gerais);
    return { data: e.data, manchete: e.manchete, estrutura: estruturaAssunto(e.manchete), caracteres: e.manchete.length, abertura_geral: s.abertura };
  });
  const porEstrutura = {};
  for (const a of assuntos.slice(0, -1)) (porEstrutura[a.estrutura] ||= []).push(a.abertura_geral);

  const alertas = [];
  if (horas < HORAS_MINIMAS_ENVIO) alertas.push(`Números com ${horas}h de envio: abertura e cliques ainda vão subir; não compare com as edições anteriores.`);
  if (tot.rodape > tot.conteudo) alertas.push(`Rodapé com mais cliques (${tot.rodape}) que o conteúdo (${tot.conteudo}): provável clique de robô; leitura de interesse fica só no conteúdo.`);

  return {
    edicao: { data: atual.data, enviado_em: atual.enviadoEm, horas_desde_envio: horas, manchete: atual.manchete, campanhas: atual.campanhas.length, numero: atual.numero ?? null },
    resumo,
    versoes: listaVersoes,
    itens_edicao: itensAtual.map(({ tipo, fonte, categoria, titulo, url, versoes: vs, cliques }) => ({ tipo, fonte, categoria, titulo, url, versoes: vs, cliques })),
    fontes: {
      ranking: fontes,
      sem_clique: fontes.filter((f) => f.aparicoes >= MIN_APARICOES_FONTE && f.cliques === 0).map((f) => f.chave),
    },
    tipos: fechar(porTipo),
    categorias: fechar(porCategoria),
    assunto: { historico: assuntos, media_por_estrutura: Object.fromEntries(Object.entries(porEstrutura).map(([k, v]) => [k, { edicoes: v.length, abertura_media: media(v) }])) },
    historico: [...totAnt, { data: atual.data, manchete: atual.manchete, ...tot }].map((t) => ({ data: t.data, manchete: t.manchete, envios: t.envios, abertura: t.abertura, ctr: t.ctr, cta: t.cta, descadastros: t.descadastros, bounces: t.bounces })),
    alertas,
    observacoes: [
      'Cliques por link do E-goi são totais (não únicos).',
      'CTR = cliques únicos ÷ aberturas únicas.',
      `Segmento só tem confiança "ok" com ${MIN_EDICOES_SEGMENTO}+ edições e ${MIN_ABERTURAS_CONFIAVEL}+ aberturas acumuladas.`,
    ],
  };
}

// ─── HTML ────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x === null || x === undefined ? '-' : (100 * x).toFixed(1).replace('.', ',') + '%');
const dec = (x) => (x === null || x === undefined ? '-' : x.toFixed(1).replace('.', ','));
const n = (x) => Number(x || 0).toLocaleString('pt-BR');
const dataBR = (d) => d.split('-').reverse().slice(0, 2).join('/');

const TD = 'padding:8px 10px;border-bottom:1px solid #eee;';
const td = (v, al = 'left', extra = '') => `<td align="${al}" style="${TD}${extra}">${v}</td>`;
const th = ([t, al = 'left']) => `<th align="${al}" style="padding:8px 10px;background:#f6f6f6;font-size:11px;text-transform:uppercase;color:#666">${t}</th>`;
const tabela = (cab, corpo) => `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-size:13px;border-collapse:collapse"><tr>${cab.map(th).join('')}</tr>${corpo}</table>`;
const h2 = (t) => `<h2 style="font-size:15px;color:#f15a22;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.5px">${t}</h2>`;
const nota = (t) => `<p style="font-size:12px;color:#888;margin:6px 0 0">${t}</p>`;
const delta = (v, m) => {
  if (v === null || m === null) return '';
  const df = 100 * (v - m); const cor = df >= 0 ? '#1e8e3e' : '#c5221f';
  return `<span style="color:${cor};font-size:12px">${df >= 0 ? '▲' : '▼'} ${dec(Math.abs(df))} p.p. vs média</span>`;
};
const kpi = (rot, val, sub) => `<td width="25%" style="padding:14px 8px;border:1px solid #eee;text-align:center;vertical-align:top"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px">${rot}</div><div style="font-size:24px;font-weight:bold;color:#222;margin:4px 0">${val}</div>${sub}</td>`;

function tituloDeUrl(url) {
  try {
    const u = new URL(url);
    let s = decodeURIComponent(limparUrl(url).split('/').pop()).replace(/^\d+-/, '').replace(/-/g, ' ');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return { host: u.hostname.replace('www.', ''), texto: s.length > 70 ? s.slice(0, 67) + '...' : s };
  } catch { return { host: '', texto: url }; }
}

function destaquesAutomaticos(s) {
  const r = s.resumo; const out = [];
  const gest = s.versoes.filter((v) => /^(mineracao|industria|engenharia|tecnologia|florestal)$/.test(v.versao));
  if (gest.length) {
    const ord = [...gest].sort((a, b) => (b.atual.abertura ?? 0) - (a.atual.abertura ?? 0));
    const pequena = gest.some((v) => v.confianca !== 'ok');
    out.push(`Segmentos: melhor abertura em <b>${esc(ord[0].nome.replace('Gestores · ', ''))}</b> (${pct(ord[0].atual.abertura)}), pior em <b>${esc(ord.at(-1).nome.replace('Gestores · ', ''))}</b> (${pct(ord.at(-1).atual.abertura)}).${pequena ? ' Amostra ainda pequena: cada segmento tem poucas dezenas de contatos.' : ''}`);
  }
  const top = s.itens_edicao[0];
  const totalConteudo = s.itens_edicao.reduce((a, i) => a + i.cliques, 0);
  if (top && top.cliques) out.push(`Item mais clicado: <b>${esc(top.tipo === 'blog' ? 'o post do blog' : top.fonte)}</b>, com ${top.cliques} cliques (${pct(top.cliques / (totalConteudo || 1))} dos cliques em conteúdo).`);
  if (r.rodape) out.push(`Rodapé (redes, site e logo): <b>${r.rodape} cliques</b>, contra ${r.conteudo} no conteúdo. Padrão de robô de segurança e Apple Mail, fora da leitura de interesse.`);
  if (s.fontes.sem_clique.length) out.push(`Fontes sem nenhum clique em ${MIN_APARICOES_FONTE}+ aparições nas últimas edições: ${s.fontes.sem_clique.map(esc).join(', ')}.`);
  out.push(`Saúde da base: ${r.descadastros} descadastro(s) (média ${dec(r.media_anteriores.descadastros)}), ${r.reclamacoes} reclamação(ões), ${r.bounces} bounces (média ${dec(r.media_anteriores.bounces)}).`);
  return out;
}

export const MARCADOR_SUGESTOES = '<!-- SUGESTOES -->';

export function montarRelatorioHTML(s, { geradoEm = new Date(), sugestoesAnteriores = [] } = {}) {
  const r = s.resumo; const m = r.media_anteriores;
  const dataGer = geradoEm.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).toUpperCase();

  const linhas = [...s.versoes].sort((a, b) => b.atual.envios - a.atual.envios).map((v) => {
    const dest = v.atual.envios >= 30 && v.atual.abertura >= 0.2 ? 'background:#fff4ee;' : '';
    const nome = v.versao === 'geral_comercial' ? `${esc(v.lista)} (geral)` : esc(v.nome);
    const acc = v.acumulado.edicoes > 1 ? `<br><span style="color:#888;font-size:11px">${v.acumulado.edicoes} edições: ${pct(v.acumulado.abertura)}${v.confianca !== 'ok' ? ' · amostra pequena' : ''}</span>` : '';
    return `<tr style="${dest}">${td(nome + acc)}${td(n(v.atual.envios), 'right')}${td(`<b>${pct(v.atual.abertura)}</b>`, 'right')}${td(`${v.atual.cliques} <span style="color:#888">(${pct(v.atual.ctr)})</span>`, 'right')}${td(v.atual.bounces, 'right')}</tr>`;
  }).join('');

  const itens = s.itens_edicao.slice(0, 8).map((it) => {
    const t = it.titulo ? { host: it.fonte, texto: it.titulo.length > 90 ? it.titulo.slice(0, 87) + '...' : it.titulo } : tituloDeUrl(it.url);
    const onde = (it.versoes || []).map((v) => (NOME_VERSAO[v] || v).replace('Gestores · ', '')).join(', ');
    return `<tr>${td(`<a href="${esc(it.url)}" style="color:#222;text-decoration:none">${esc(t.texto)}</a><br><span style="color:#888;font-size:12px">${esc(it.tipo === 'blog' ? "Blog Let's" : t.host)}${it.categoria ? ' · ' + esc(it.categoria) : ''}${onde ? ' · ' + esc(onde) : ''}</span>`)}${td(it.cliques, 'right', 'font-weight:bold')}</tr>`;
  }).join('');

  const hist = s.historico.map((h, i, arr) => {
    const at = i === arr.length - 1;
    return `<tr style="${at ? 'background:#fff4ee;font-weight:bold' : ''}">${td(dataBR(h.data))}${td(esc(h.manchete), 'left', 'font-size:12px')}${td(pct(h.abertura), 'right')}${td(pct(h.ctr), 'right')}${td(h.cta, 'right')}${td(h.descadastros, 'right')}</tr>`;
  }).join('');

  const anteriores = sugestoesAnteriores.filter((x) => x.status !== 'recusada').slice(-6).map((x) =>
    `<tr>${td(dataBR(x.data_edicao))}${td(esc(x.titulo), 'left', 'font-size:12px')}${td(esc(x.status), 'right', 'font-size:12px')}</tr>`).join('');

  const alertas = s.alertas.length ? `<tr><td style="background:#fffbe6;border-bottom:1px solid #f0d878;padding:10px 24px;font-size:12px;color:#7a5c00">${s.alertas.map(esc).join('<br>')}</td></tr>` : '';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Relatório semanal · Let's Insights · ${dataBR(s.edicao.data)}</title></head>
<body style="margin:0;background:#f2f2f2;font-family:'Open Sans',Arial,sans-serif;color:#222;font-size:14px;line-height:1.5">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:20px 10px">
<table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;background:#fff">
${alertas}
<tr><td style="background:#f15a22;color:#fff;padding:20px 24px"><div style="font-size:12px;letter-spacing:1px;opacity:.9">RELATÓRIO SEMANAL · ${esc(dataGer)}</div><div style="font-size:21px;font-weight:bold;margin-top:4px">Let's Insights de ${dataBR(s.edicao.data)}</div><div style="font-size:14px;margin-top:2px;opacity:.95">"${esc(s.edicao.manchete)}" · ${s.edicao.campanhas} campanhas · ${s.edicao.horas_desde_envio}h de envio</div></td></tr>
<tr><td style="padding:20px 24px 28px">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
${kpi('Envios', n(r.envios), `<span style="color:#888;font-size:12px">${r.bounces} bounces</span>`)}
${kpi('Abertura', pct(r.abertura), delta(r.abertura, m.abertura))}
${kpi('CTR', pct(r.ctr), delta(r.ctr, m.ctr))}
${kpi('Botão proposta', r.cta, `<span style="color:#888;font-size:12px">média ${dec(m.cta)}</span>`)}
</tr></table>
${nota(`Média = as edições anteriores (${r.datas_anteriores.map(dataBR).join(', ')}). CTR = cliques únicos ÷ aberturas únicas.`)}
${h2('Destaques da semana')}
<ul style="margin:0;padding-left:18px">${destaquesAutomaticos(s).map((d) => `<li style="margin-bottom:4px">${d}</li>`).join('')}</ul>
${MARCADOR_SUGESTOES}
${h2('Por lista e versão')}
${tabela([['Campanha'], ['Envios', 'right'], ['Abertura', 'right'], ['Cliques (CTR)', 'right'], ['Bounces', 'right']], linhas)}
${nota('Em destaque: versões com 30+ envios e abertura acima de 20%.')}
${h2('Matérias mais clicadas')}
${itens ? tabela([['Matéria · fonte · onde saiu'], ['Cliques', 'right']], itens) : nota('Itens da edição não encontrados no banco.')}
${nota(`Cliques totais (não únicos), somando as versões em que a matéria apareceu. Fora daqui: rodapé (${r.rodape}) e botão de proposta (${r.cta}).`)}
${h2(`Últimas ${s.historico.length} edições`)}
${tabela([['Data'], ['Manchete'], ['Abertura', 'right'], ['CTR', 'right'], ['Botão', 'right'], ['Descad.', 'right']], hist)}
${anteriores ? h2('Sugestões anteriores') + tabela([['Edição'], ['Sugestão'], ['Status', 'right']], anteriores) : ''}
<p style="font-size:12px;color:#888;margin:16px 0 0;border-top:1px solid #eee;padding-top:12px">Gerado pela tarefa agendada no app Claude a partir da API do E-goi (somente leitura) e do banco da newsletter. Sugestões escritas pelo Claude a partir dos sinais calculados em código; nada é aplicado sem o seu ok.</p>
</td></tr></table></td></tr></table></body></html>`;
}

// Sugestões escritas pelo Claude → bloco HTML no lugar do marcador.
export function validarSugestoes(lista) {
  if (!Array.isArray(lista) || !lista.length) throw new Error('sugestoes: esperado array com 1 a 3 itens');
  if (lista.length > 3) throw new Error('sugestoes: no máximo 3');
  for (const [i, x] of lista.entries()) {
    for (const campo of ['titulo', 'evidencia', 'mudanca', 'como_medir']) {
      if (!x[campo] || typeof x[campo] !== 'string') throw new Error(`sugestoes[${i}].${campo} ausente`);
    }
    if (/—/.test(Object.values(x).join(' '))) throw new Error(`sugestoes[${i}]: sem travessão (regra 3)`);
  }
  return lista;
}

export function renderizarSugestoes(html, lista) {
  const bloco = h2('Sugestões da semana') + lista.map((x, i) => `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 10px;border-left:3px solid #f15a22;background:#fafafa"><tr><td style="padding:10px 14px;font-size:13px">
<div style="font-weight:bold;font-size:14px;margin-bottom:4px">${i + 1}. ${esc(x.titulo)}${x.confianca === 'baixa' ? ' <span style="font-weight:normal;color:#888;font-size:12px">(evidência fraca)</span>' : ''}</div>
<div><b>Por quê:</b> ${esc(x.evidencia)}</div>
<div><b>O que mudar${x.onde ? ` (${esc(x.onde)})` : ''}:</b> ${esc(x.mudanca)}</div>
<div><b>Como medir:</b> ${esc(x.como_medir)}</div>
</td></tr></table>`).join('');
  if (!html.includes(MARCADOR_SUGESTOES)) throw new Error('marcador de sugestões não encontrado no HTML');
  return html.replace(MARCADOR_SUGESTOES, bloco);
}
