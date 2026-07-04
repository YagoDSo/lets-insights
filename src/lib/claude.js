import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

// Substitui os nós "Claude API - *" (que eram HTTP cru pra /v1/messages).
let _client;
function client() {
  if (!_client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY não configurada (.env ou Secret do GitHub).');
    }
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}

// Manda 1 mensagem de usuário e devolve o texto da resposta.
export async function chamarClaude(prompt, { maxTokens = 4000, model = config.claudeModel } = {}) {
  const resp = await client().messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const texto = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!texto) throw new Error('Resposta sem conteúdo');
  return texto;
}

// Mesma coisa, mas com a tool nativa "web_search" da API (server-side, cobrada
// à parte — ver docs). Usa a variante básica (web_search_20250305) porque
// nem Haiku 4.5 nem o Sonnet 4.5 usado no resto do pipeline são elegíveis pra
// variante com dynamic filtering (exige Opus 4.6+/Sonnet 5/Sonnet 4.6).
// Modelo default é Haiku 4.5 (config.claudeModelBusca), não o Sonnet 4.5 do
// resto do pipeline: essa chamada é extração/filtragem estruturada (achar
// artigos, confirmar data), não redação, e o conteúdo das páginas buscadas
// já domina o custo de input (~107k tokens observados) — Haiku é 3x mais
// barato no input pro mesmo trabalho. Ver CLAUDE.md "Otimização de custo de
// tokens (jul/2026)".
// Cobre o stop_reason "pause_turn" (loop de busca do servidor pausa a cada 10
// buscas) reenviando o turno, conforme documentado pela Anthropic.
export async function chamarClaudeComWebSearch(
  prompt,
  { maxTokens = 8000, model = config.claudeModelBusca, maxBuscas = 15 } = {},
) {
  const c = client();
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxBuscas }];
  let messages = [{ role: 'user', content: prompt }];

  let resp = await c.messages.create({ model, max_tokens: maxTokens, tools, messages });
  let retomadas = 0;
  while (resp.stop_reason === 'pause_turn' && retomadas < 3) {
    messages = [...messages, { role: 'assistant', content: resp.content }];
    resp = await c.messages.create({ model, max_tokens: maxTokens, tools, messages });
    retomadas++;
  }

  const texto = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const buscasRealizadas = resp.usage?.server_tool_use?.web_search_requests ?? 0;
  if (!texto) throw new Error('Busca web: resposta sem conteúdo de texto');
  return { texto, buscasRealizadas, usage: resp.usage };
}
