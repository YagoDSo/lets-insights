import { config, requireEnv } from './config.js';

// ─────────────────────────────────────────────────────────────
// Cliente de LEITURA da API E-goi (relatórios/listagem de campanhas).
// Não expõe nenhuma chamada de criação ou envio de campanha —
// isso fica de fora de propósito (ver regra: envio real só com
// autorização explícita do Yago a cada disparo).
// ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.egoiapp.com';

async function egoiGet(path, params = {}) {
  requireEnv(['EGOI_API_KEY']);
  const url = new URL(BASE_URL + path);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null) url.searchParams.set(chave, valor);
  }
  const resposta = await fetch(url, {
    headers: { Apikey: config.egoiApiKey, Accept: 'application/json' },
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`E-goi API ${resposta.status} em ${path}: ${corpo}`);
  }
  return resposta.json();
}

// Lista campanhas (GET /campaigns). channel/status/datas em snake_case, ver docs API v3.
export async function listarCampanhas({
  channel = 'email',
  status,
  startDateMin,
  startDateMax,
  limit = 100,
  offset = 0,
} = {}) {
  return egoiGet('/campaigns', {
    channel,
    status,
    start_date_min: startDateMin,
    start_date_max: startDateMax,
    limit,
    offset,
    order_by: 'created',
    order: 'desc',
  });
}

// Relatório de uma campanha de email (GET /reports/email/{campaign_hash}).
// Inclui detalhamento por URL (cliques por link), usado pra calcular a
// taxa de clique no CTA especificamente.
export async function relatorioEmail(campaignHash) {
  return egoiGet(`/reports/email/${campaignHash}`, { url: true });
}
