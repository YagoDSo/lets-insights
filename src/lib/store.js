import { google } from 'googleapis';
import { config } from './config.js';

// ─────────────────────────────────────────────────────────────
// Camada de banco de dados. HOJE: Google Sheets.
// DEPOIS: trocar a implementação destas funções por Postgres/Supabase
// mantendo a mesma assinatura — nenhuma etapa (wf01/02/03) precisa mudar.
// ─────────────────────────────────────────────────────────────

function getAuth() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  // CI (GitHub Actions): JSON inteiro da service account em GOOGLE_SERVICE_ACCOUNT_JSON.
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new google.auth.GoogleAuth({ credentials, scopes });
  }
  // Local: caminho do arquivo em GOOGLE_APPLICATION_CREDENTIALS.
  return new google.auth.GoogleAuth({ scopes });
}

let _sheets;
async function sheetsClient() {
  if (_sheets) return _sheets;
  const auth = getAuth();
  _sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return _sheets;
}

// Lê uma aba inteira como array de objetos (chaveados pelo cabeçalho da linha 1).
export async function lerAba(aba) {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetsDocId,
    range: aba,
  });
  const linhas = res.data.values || [];
  if (linhas.length === 0) return { header: [], rows: [] };
  const header = linhas[0];
  const rows = linhas.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = r[i] ?? '';
    });
    return obj;
  });
  return { header, rows };
}

// Upsert por coluna-chave (equivale ao appendOrUpdate do N8N).
// Atualiza a linha cujo valor em `colChave` bate; senão, insere nova.
export async function upsertLinhas(aba, objetos, colChave) {
  if (!objetos.length) return { atualizados: 0, inseridos: 0 };
  const { header, rows } = await lerAba(aba);
  const cols = header.length ? header : Object.keys(objetos[0]);

  // Mapa chave -> número da linha na planilha (linha 1 = header; dados a partir da 2).
  const linhaPorChave = {};
  rows.forEach((r, i) => {
    const k = r[colChave];
    if (k) linhaPorChave[k] = i + 2;
  });

  const updates = [];
  const novos = [];
  for (const o of objetos) {
    const valores = cols.map((c) => o[c] ?? '');
    const k = o[colChave];
    if (k && linhaPorChave[k]) {
      updates.push({ range: `${aba}!A${linhaPorChave[k]}`, values: [valores] });
    } else {
      novos.push(valores);
    }
  }

  const sheets = await sheetsClient();
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.sheetsDocId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
  }
  if (novos.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheetsDocId,
      range: aba,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: novos },
    });
  }
  return { atualizados: updates.length, inseridos: novos.length };
}
