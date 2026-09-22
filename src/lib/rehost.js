// ─────────────────────────────────────────────────────────────
// Re-hospedagem de imagens que moram em CDN compartilhado.
//
// Motivo (set/2026): o verificador do E-goi pontua 100 (de um total que
// vira "PÉSSIMO" acima de ~100) qualquer mensagem que referencie
// cdn.prod.website-files.com — o CDN do Webflow, onde roda o blog da
// Let's. A penalidade não é pelo nosso conteúdo: o domínio é compartilhado
// por centenas de milhares de sites Webflow e a reputação é coletiva, então
// blocklist causada por outro site respinga na nossa entrega.
//
// A solução reaproveita a máquina que já existia pra imagem gerada por IA
// (lib/gitAssets.js): baixa o arquivo e serve do nosso próprio repositório
// via raw.githubusercontent.com.
//
// IMPORTANTE: o nome do arquivo tem que ser único por edição. E-mail já
// enviado aponta pra essa URL pra sempre; reusar o mesmo nome numa edição
// seguinte trocaria a imagem de todas as edições anteriores.
// ─────────────────────────────────────────────────────────────

// Hosts cuja imagem precisa ser re-hospedada antes de entrar no e-mail.
// Comparação por sufixo, então cobre subdomínio (a.b.exemplo.com casa com
// exemplo.com). Acrescente aqui conforme o E-goi for sinalizando outros.
export const HOSTS_PROBLEMATICOS = ['cdn.prod.website-files.com', 'website-files.com'];

const TIMEOUT_MS = 20000;
const TAMANHO_MAX = 8 * 1024 * 1024; // 8 MB

const EXT_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function precisaRehospedar(url) {
  if (!url || typeof url !== 'string') return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // URL malformada: não é problema desta função resolver
  }
  return HOSTS_PROBLEMATICOS.some((h) => host === h || host.endsWith(`.${h}`));
}

// Baixa a imagem e devolve { buffer, ext }. Lança em qualquer condição que
// torne o arquivo inutilizável — quem chama decide se mantém a URL original.
export async function baixarImagem(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Mesmo UA de browser real usado no RSS: alguns CDNs recusam bot.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const mime = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_POR_MIME[mime];
  if (!ext) throw new Error(`content-type não suportado: ${mime || '(vazio)'}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length === 0) throw new Error('arquivo vazio');
  if (buffer.length > TAMANHO_MAX) {
    throw new Error(`arquivo grande demais: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  }

  return { buffer, ext };
}
