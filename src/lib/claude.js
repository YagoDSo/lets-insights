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
