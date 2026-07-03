import { config } from './config.js';

// ─────────────────────────────────────────────────────────────
// Geração de imagem fallback via Gemini API (modelo gemini-2.5-flash-image,
// "Nano Banana"). Usado quando um artigo curado não tem imagem válida
// (og:image ausente ou removida por estar quebrada — ver wf02-curadoria.js).
// ─────────────────────────────────────────────────────────────
const MODEL = 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function montarPrompt({ titulo, categoria, tema }) {
  return `Fotografia editorial profissional para newsletter B2B de gestão de frotas de veículos comerciais no Brasil. ` +
    `Tema da matéria: ${tema || categoria || 'logística'}. Contexto: "${titulo}". ` +
    `Estilo corporativo, realista, sem texto nem logotipos na imagem, iluminação natural, paleta neutra ` +
    `compatível com identidade visual laranja (#f15a22) e cinza. Formato quadrado.`;
}

export async function gerarImagemPorTema({ titulo, categoria, tema }) {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY não configurada (.env ou Secrets).');

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': config.geminiApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: montarPrompt({ titulo, categoria, tema }) }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });
  if (!resp.ok) {
    throw new Error(`Gemini image API falhou: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const parte = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!parte) throw new Error('Gemini não retornou imagem (resposta sem inlineData).');

  const ext = parte.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  return { buffer: Buffer.from(parte.inlineData.data, 'base64'), ext };
}
