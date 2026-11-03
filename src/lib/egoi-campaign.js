import fs from 'node:fs';
import path from 'node:path';
import { config, requireEnv } from './config.js';

// ─────────────────────────────────────────────────────────────
// Cliente de CRIAÇÃO de campanha (rascunho) e AGENDAMENTO na API E-goi.
// criarRascunho deixa a campanha em "draft". agendarEnvio (out/2026) só
// roda com o interruptor EGOI_AGENDAMENTO=ligado, decisão do Yago de
// 2026-10-22: agenda para a manhã seguinte e ele cancela pelo painel se
// precisar. Envio IMEDIATO não existe aqui de propósito.
// ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.egoiapp.com';

// Modo de teste (MODO_TESTE=ligado): nenhuma chamada ao E-goi. Grava o que
// seria criado/agendado em testeDir/egoi e devolve um hash fictício.
let _contadorTeste = 0;
function simular(acao, { html, ...dados }) {
  const dir = path.join(config.testeDir, 'egoi');
  fs.mkdirSync(dir, { recursive: true });
  const hash = `teste${String(++_contadorTeste).padStart(3, '0')}`;
  fs.writeFileSync(path.join(dir, `${hash}-${acao}.json`), JSON.stringify({ acao, ...dados, tamanho_html: html?.length }, null, 2));
  if (html) fs.writeFileSync(path.join(dir, `${hash}-${acao}.html`), html);
  console.log(`[MODO TESTE] E-goi: ${acao} simulado (${hash}), nada foi criado no E-goi.`);
  return hash;
}

// Cria uma campanha de email em rascunho (status "draft"), pronta pra
// revisão manual no E-goi. Retorna o campaign_hash.
export async function criarRascunho({ listId, internalName, subject, html, senderId }) {
  if (config.modoTeste) return simular('rascunho', { listId, internalName, subject, html });
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

// ─────────────────────────────────────────────────────────────
// AGENDAMENTO (decisão do Yago em 2026-10-22, ver CLAUDE.md › Pendências).
// Agenda o envio de uma campanha já criada para uma data/hora futura. O
// Yago tem até a hora marcada para cancelar pelo painel do E-goi. Só é
// chamado pelo WF-03 quando a variável EGOI_AGENDAMENTO=ligado estiver
// definida no GitHub (desligado por padrão).
// segmentIds: ids de segmentos salvos da lista; vazio = lista inteira.
// quando: string "AAAA-MM-DD HH:MM:SS" (mesmo formato de data que a API
// devolve nas campanhas).
// ─────────────────────────────────────────────────────────────
export async function agendarEnvio({ campaignHash, listId, segmentIds = [], quando }) {
  if (config.modoTeste) return { simulado: simular('agendamento', { campaignHash, listId, segmentIds, quando }) };
  requireEnv(['EGOI_API_KEY']);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(quando || '')) {
    throw new Error(`Data de agendamento inválida: "${quando}"`);
  }
  const segments = segmentIds.length
    ? { type: 'segment', data: segmentIds.map(String) }
    : { type: 'none' };
  const resposta = await fetch(`${BASE_URL}/campaigns/email/${campaignHash}/actions/send`, {
    method: 'POST',
    headers: { Apikey: config.egoiApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ list_id: listId, segments, schedule_date: quando }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`E-goi API ${resposta.status} ao agendar ${campaignHash}: ${corpo}`);
  }
  return resposta.json();
}
