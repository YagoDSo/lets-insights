import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { git, gitOutput } from './gitBin.js';

// ─────────────────────────────────────────────────────────────
// Camada de banco de dados. Arquivo SQLite commitado no próprio repositório
// (mesmo padrão de lib/gitAssets.js pra imagens): cada job do GitHub Actions
// faz checkout, lê/escreve o .db, e commita+push antes de terminar, pro
// próximo job da cadeia (needs) enxergar o estado atualizado.
// ─────────────────────────────────────────────────────────────

let _db;
function conectar() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = DELETE'); // evita arquivos -wal/-shm extras (o .db precisa ficar num único arquivo commitável)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ${config.abaArtigos} (
      url TEXT PRIMARY KEY,
      edicao TEXT,
      data_coleta TEXT,
      titulo TEXT,
      fonte TEXT,
      data_publicacao TEXT,
      resumo TEXT,
      status TEXT,
      tema TEXT
    );
    CREATE TABLE IF NOT EXISTS ${config.abaEdicoes} (
      edicao TEXT PRIMARY KEY,
      titulo_edicao TEXT,
      pre_header TEXT,
      json_artigos_principais TEXT,
      json_artigos_cards TEXT,
      json_cta TEXT,
      status TEXT,
      gerado_em TEXT,
      enviado_em TEXT
    );
  `);

  // Migração aditiva (jul/2026): fim da divisão principais/cards — agora
  // json_artigos_principais guarda os 3 artigos selecionados (sem "cards"
  // menores) e json_blog guarda o destaque do blog Lets (antes só vinha de
  // scraping ao vivo no WF-03, sem persistir). json_artigos_cards fica sem
  // uso a partir daqui, mas a coluna não é removida (evita migração
  // destrutiva; linhas antigas continuam legíveis).
  const colunasEdicoes = _db.prepare(`PRAGMA table_info(${config.abaEdicoes})`).all().map((c) => c.name);
  if (!colunasEdicoes.includes('json_blog')) {
    _db.exec(`ALTER TABLE ${config.abaEdicoes} ADD COLUMN json_blog TEXT`);
  }

  return _db;
}

// Lê uma tabela inteira como { header, rows }, no mesmo formato que o resto
// do código já espera (era o formato de retorno do Google Sheets).
export async function lerAba(tabela) {
  const db = conectar();
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
  const linhas = db.prepare(`SELECT * FROM ${tabela}`).all();
  const rows = linhas.map((r) => {
    const obj = {};
    cols.forEach((c) => (obj[c] = r[c] ?? ''));
    return obj;
  });
  return { header: cols, rows };
}

// Upsert por coluna-chave (a coluna precisa ser PRIMARY KEY na tabela).
export async function upsertLinhas(tabela, objetos, colChave) {
  if (!objetos.length) return { atualizados: 0, inseridos: 0 };
  const db = conectar();
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
  const outrasCols = cols.filter((c) => c !== colChave);

  const sql = `
    INSERT INTO ${tabela} (${cols.join(', ')})
    VALUES (${cols.map((c) => `@${c}`).join(', ')})
    ON CONFLICT(${colChave}) DO UPDATE SET
      ${outrasCols.map((c) => `${c} = excluded.${c}`).join(', ')}
  `;
  const stmt = db.prepare(sql);

  const chavesExistentes = new Set(
    db.prepare(`SELECT ${colChave} FROM ${tabela}`).all().map((r) => r[colChave]),
  );

  let atualizados = 0;
  let inseridos = 0;
  const transacao = db.transaction((linhas) => {
    for (const obj of linhas) {
      const params = {};
      cols.forEach((c) => (params[c] = obj[c] ?? null));
      stmt.run(params);
      if (chavesExistentes.has(obj[colChave])) atualizados++;
      else inseridos++;
    }
  });
  transacao(objetos);

  return { atualizados, inseridos };
}

// Commita e dá push do arquivo .db se ele tiver mudado. Mesmo padrão de
// identidade de bot usado em lib/gitAssets.js pra imagens geradas.
export function commitarBanco(mensagem) {
  if (_db) _db.close(); // garante que tudo foi flushado pro arquivo antes do git add
  _db = undefined;

  if (!fs.existsSync(config.dbPath)) return;
  const status = gitOutput(['status', '--porcelain', '--', config.dbPath]).trim();
  if (!status) {
    console.log('Banco de dados sem alterações. Nada a commitar.');
    return;
  }

  git(['config', 'user.name', 'Lets Insights Bot']);
  git(['config', 'user.email', 'bot@lets.com.br']);
  git(['add', config.dbPath]);
  git(['commit', '-m', mensagem]);
  git(['push']);
}
