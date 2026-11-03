// Busca de página HTML, compartilhada entre WF-02 (extração de imagem +
// verificação de integridade) e WF-03 (revalidação na hora do envio).
// Tolerante a falha: erro de rede devolve html vazio, nunca lança.

export async function buscarPagina(url, timeoutMs = 15000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    // encodeURI(decodeURIComponent(...)) normaliza link de RSS que chega
    // com encoding estranho; é no-op pra URL já limpa.
    const resp = await fetch(encodeURI(decodeURIComponent(url)), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LetsInsights-Bot/1.0; +https://www.lets.com.br)' },
    });
    clearTimeout(t);
    // urlFinal expõe o destino real depois dos redirects — um sequestro por
    // redirecionamento não aparece de outro jeito (o status continua 200).
    return { html: await resp.text(), urlFinal: resp.url || url, status: resp.status };
  } catch {
    return { html: '', urlFinal: null, status: 0 };
  }
}

export const buscarHTML = async (url) => (await buscarPagina(url)).html;
