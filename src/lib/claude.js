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

// ─── Processamento em lote (out/2026) ─────────────────────────
// A API de lote (Message Batches) cobra metade do preço, mas não garante
// prazo (até 24h; na prática, minutos). Como a news roda de madrugada, dá
// pra esperar: se o lote não terminar até o horário limite (config.loteLimite,
// horário de Brasília), cancela e faz a chamada normal, pagando o preço cheio
// só naquela semana. Se o pipeline já começar depois do limite (atraso na fila
// do GitHub), nem tenta o lote. Desliga com CLAUDE_LOTE=desligado.
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Horário limite de hoje, em Brasília (UTC-3, sem horário de verão desde 2019).
function limiteDeHoje(agora = new Date()) {
  const [h, m] = config.loteLimite.split(':').map(Number);
  const brt = new Date(agora.getTime() - 3 * 3600e3);
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), h + 3, m));
}

async function viaLote(params) {
  if (!config.claudeLote) return null;
  const limite = limiteDeHoje();
  if (Date.now() >= limite.getTime()) {
    console.log(`  Lote ignorado: já passou do limite de ${config.loteLimite}; usando chamada normal.`);
    return null;
  }
  let lote;
  try {
    lote = await client().messages.batches.create({ requests: [{ custom_id: 'pedido', params }] });
    console.log(`  Lote criado (${lote.id}); limite ${config.loteLimite} BRT.`);
    while (lote.processing_status !== 'ended') {
      if (Date.now() >= limite.getTime()) {
        console.log(`  ⚠️ Lote ${lote.id} não terminou até ${config.loteLimite}: cancelando e usando chamada normal.`);
        await client().messages.batches.cancel(lote.id).catch(() => {});
        return null;
      }
      await esperar(30000);
      lote = await client().messages.batches.retrieve(lote.id);
    }
    for await (const r of await client().messages.batches.results(lote.id)) {
      if (r.custom_id !== 'pedido') continue;
      if (r.result.type === 'succeeded') {
        console.log(`  Lote ${lote.id} concluído (metade do preço).`);
        return r.result.message;
      }
      console.log(`  ⚠️ Lote ${lote.id} terminou como "${r.result.type}": usando chamada normal.`, JSON.stringify(r.result.error || {}));
      return null;
    }
    return null;
  } catch (e) {
    console.log(`  ⚠️ Lote falhou (${e.message}): usando chamada normal.`);
    if (lote?.id) await client().messages.batches.cancel(lote.id).catch(() => {});
    return null;
  }
}

// Manda 1 mensagem de usuário e devolve o texto da resposta.
// schema (opcional): JSON Schema da resposta. Com ele, a API só devolve JSON
// válido nesse formato (saída estruturada). Necessário desde 26/10/2026: o
// Sonnet 5.5 respondeu a curadoria com dois JSONs e comentários entre eles,
// apesar do "Retorne APENAS JSON" no prompt, e a edição 22 falhou no parse.
export async function chamarClaude(prompt, { maxTokens = 4000, model = config.claudeModel, schema } = {}) {
  const params = {
    model,
    max_tokens: maxTokens,
    ...(SEM_RACIOCINIO.test(model) ? { thinking: { type: 'between_tools' } } : {}),
    ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
    messages: [{ role: 'user', content: prompt }],
  };
  const resp = (await viaLote(params)) || (await client().messages.create(params));
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
