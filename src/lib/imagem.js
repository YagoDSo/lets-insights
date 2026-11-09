// ════════════════════════════════════════════════════════════
// Extração da imagem de capa de uma página (og:image e afins).
//
// Fica fora do wf02-curadoria.js para poder ter teste: o wf02 roda o
// pipeline inteiro ao ser importado.
//
// Edição 24 (nov/2026): a imagem de uma matéria do Estadão sumiu porque o
// endereço vem no HTML com o "&" escrito como "&amp;"
// (`...jpg?quality=80&amp;auth=...&amp;width=1200`). Sem decodificar, a
// checagem da imagem pedia o endereço literal, o servidor respondia 400 e
// a imagem era descartada. O mesmo acontecia sem dar sinal com o
// "&#038;" do WordPress (i0.wp.com aceita o parâmetro quebrado).
// ════════════════════════════════════════════════════════════

const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

// Decodifica as entidades HTML que aparecem em atributo de URL: as
// nomeadas acima e as numéricas (&#38;, &#038;, &#x26;). Entidade
// desconhecida fica como está.
export function decodificarEntidades(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (inteira, corpo) => {
    if (corpo[0] === '#') {
      const n = corpo[1] === 'x' || corpo[1] === 'X' ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : inteira;
    }
    return ENTIDADES[corpo.toLowerCase()] ?? inteira;
  });
}

// Endereço como sai do atributo HTML → endereço que dá pra pedir:
// entidades decodificadas, "//host" e "http://" viram https.
export function normalizarURLImagem(bruta) {
  if (!bruta) return null;
  let url = decodificarEntidades(bruta).trim();
  if (!url) return null;
  if (url.startsWith('//')) url = 'https:' + url;
  if (url.startsWith('http://')) url = url.replace('http://', 'https://');
  return url;
}

// ─── Matéria externa (og:image → twitter:image → image_src) ───
export function extrairImagem(html) {
  if (!html) return null;
  const padroes = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const re of padroes) {
    const m = html.match(re);
    if (m) return normalizarURLImagem(m[1]);
  }
  return null;
}

// ─── Blog Lets: imagem do post (og/twitter → 1ª img CDN após h1) ─
export function extrairImagemPost(htmlPost) {
  if (!htmlPost || htmlPost.length < 500) return null;
  const og = htmlPost.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const tw = htmlPost.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (og && og[1].includes('http')) return normalizarURLImagem(og[1]);
  if (tw && tw[1].includes('http')) return normalizarURLImagem(tw[1]);

  const idxH1 = htmlPost.search(/<h1[^>]*>/i);
  if (idxH1 > 0) {
    const aposH1 = htmlPost.substring(idxH1);
    const imgMatch = aposH1.match(/<img[^>]+src=["']([^"']*cdn\.prod\.website-files\.com[^"']+)["']/i);
    if (imgMatch) {
      const src = imgMatch[1];
      const estrutural = /logo|icon|favicon|menu|footer|header|avatar/i.test(src);
      if (!estrutural) return normalizarURLImagem(src);
    }
  }
  return null;
}
