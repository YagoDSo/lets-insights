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

// Sonnet 5.5 (out/2026): por padrão ele raciocina antes de responder, o que
// encarece (raciocínio é cobrado como saída) e, no teste com a edição 21,
// estourou o max_tokens da curadoria e devolveu JSON cortado. Com
// `between_tools` o raciocínio fica desligado: no mesmo teste saiu 18% mais
// barato que o Sonnet 4.5 e seguiu melhor as regras do prompt. Esse modo só
// existe no Sonnet 5.5, por isso é condicional ao modelo.
const SEM_RACIOCINIO = /^claude-sonnet-5-5/;

// Manda 1 mensagem de usuário e devolve o texto da resposta.
export async function chamarClaude(prompt, { maxTokens = 4000, model = config.claudeModel } = {}) {
  const resp = await client().messages.create({
    model,
    max_tokens: maxTokens,
    ...(SEM_RACIOCINIO.test(model) ? { thinking: { type: 'between_tools' } } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  if (resp.stop_reason === 'max_tokens') {
    // Resposta cortada no meio: o JSON viria incompleto e o parse falharia
    // com um erro confuso rio abaixo. Melhor falhar aqui, dizendo o porquê.
    throw new Error(`Resposta do Claude cortada no limite de ${maxTokens} tokens (modelo ${model}). Aumente maxTokens.`);
  }
  if (resp.stop_reason === 'refusal') {
    throw new Error(`Claude recusou a resposta (modelo ${model}): ${resp.stop_details?.category || 'sem categoria'}`);
  }
  const texto = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!texto) throw new Error('Resposta sem conteúdo');
  return texto;
}
