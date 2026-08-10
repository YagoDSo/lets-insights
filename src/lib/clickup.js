import { config, requireEnv } from './config.js';

// ─────────────────────────────────────────────────────────────
// Cliente ClickUp (API v2). Uso restrito e específico: atualizar a
// tabela de números do E-goi na task 86ahderm5 (ver report-clickup.js).
// Exceção pontual concedida pelo Yago em 2026-08-10, só pra essa
// atividade — não usar pra criar/mover/comentar/apagar nada.
// ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.clickup.com/api/v2';

async function clickupFetch(path, options = {}) {
  requireEnv(['CLICKUP_API_TOKEN']);
  const resposta = await fetch(BASE_URL + path, {
    ...options,
    headers: {
      Authorization: config.clickupApiToken,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`ClickUp API ${resposta.status} em ${path}: ${corpo}`);
  }
  return resposta.json();
}

export async function getTaskMarkdown(taskId) {
  const dados = await clickupFetch(`/task/${taskId}?include_markdown_description=true`);
  return dados.markdown_description;
}

export async function updateTaskMarkdown(taskId, markdownContent) {
  return clickupFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ markdown_content: markdownContent }),
  });
}
