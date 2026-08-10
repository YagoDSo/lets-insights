import { config, requireEnv } from './config.js';

// ─────────────────────────────────────────────────────────────
// Cliente de CRIAÇÃO de campanha (rascunho) na API E-goi.
// Expõe só a criação (POST /campaigns/email), que deixa a campanha
// em status "draft" — NUNCA chama /actions/send. Envio real só com
// autorização explícita do Yago a cada disparo (ver egoi-reports.js).
// ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.egoiapp.com';

// Cria uma campanha de email em rascunho (status "draft"), pronta pra
// revisão manual no E-goi. Retorna o campaign_hash.
export async function criarRascunho({ listId, internalName, subject, html, senderId }) {
  requireEnv(['EGOI_API_KEY']);
  const resposta = await fetch(BASE_URL + '/campaigns/email', {
    method: 'POST',
    headers: { Apikey: config.egoiApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      list_id: listId,
      internal_name: internalName,
      subject,
      content: { type: 'html', body: html },
      sender_id: senderId ?? config.egoiSenderId,
    }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`E-goi API ${resposta.status} ao criar rascunho: ${corpo}`);
  }
  const dados = await resposta.json();
  return dados.campaign_hash;
}
