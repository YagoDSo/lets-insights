// ════════════════════════════════════════════════════════════
// Integridade de conteúdo — o link ainda é a notícia que o feed prometeu?
//
// Motivação (set/2026): a edição 16 saiu com um card apontando pra
// `ocarreteiro.com.br/empresas/veic-redes/`, uma URL sequestrada por
// parasite SEO que passou a servir página de cassino indonésio. O feed
// RSS continuava anunciando o título legítimo e a URL respondia HTTP 200,
// então `validarURL` (que só olha status) aprovou. O único sinal que o
// pipeline chegou a ver foi o og:image apontando pro Pinterest, e ninguém
// conferia isso.
//
// Nenhuma verificação aqui faz requisição: todas rodam em cima do HTML
// que o WF-02 já baixa pra extrair a imagem, e que antes era descartado.
// ════════════════════════════════════════════════════════════

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');

export const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ─── Texto visível da página ──────────────────────────────────
// Mesma limpeza que o WF-02 já usava pro corpo do post do blog: tira
// script/style/nav/header/footer, depois todas as tags.
export function extrairTextoVisivel(html, limite = 6000) {
  if (!html || html.length < 500) return null;
  let corpo = html;
  const bodyMatch = corpo.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) corpo = bodyMatch[1];
  corpo = corpo
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  let texto = corpo
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (texto.length < 100) return null; // extração falhou (página estranha/vazia)
  if (texto.length > limite) texto = texto.slice(0, limite) + '...';
  return texto;
}

// ─── Título da página (<title> → og:title) ────────────────────
export function extrairTituloPagina(html) {
  if (!html) return null;
  let m = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  if (!m) m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (!m) return null;
  const t = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

// ─── Tokens significativos (pra comparar títulos) ─────────────
// Palavras de 4+ caracteres, sem os conectivos que empatariam qualquer
// par de títulos em português.
const CONECTIVOS = new Set([
  'para', 'pelo', 'pela', 'como', 'mais', 'ainda', 'sobre', 'entre', 'este',
  'esta', 'esse', 'essa', 'pelos', 'pelas', 'dos', 'das', 'com', 'que', 'nao',
  'uma', 'por', 'sua', 'seu', 'apos', 'ante', 'sera', 'sao',
]);

export const tokensSignificativos = (s) =>
  normalizar(s)
    .split(' ')
    .filter((p) => p.length >= 4 && !CONECTIVOS.has(p));

// Fração mínima dos tokens do título do RSS que precisa reaparecer no
// título da página. Não basta exigir sobreposição zero: o template de
// spam que sequestrou `/empresas/veic-redes/` ecoava o slug da URL no
// título ("... x Veic Redes"), o que já garantiria 1 ou 2 tokens em
// comum. Título legítimo fica perto de 1,0 mesmo quando o portal trunca.
const MIN_SOBREPOSICAO_TITULO = 0.3;

// Sobreposição entre o título do RSS e o título da página. Sufixo de
// portal ("- Portal O Carreteiro") não atrapalha: só contamos tokens em
// comum, nunca exigimos igualdade.
export function sobreposicaoTitulo(tituloRss, tituloPagina) {
  const a = tokensSignificativos(tituloRss);
  const b = new Set(tokensSignificativos(tituloPagina));
  if (a.length === 0 || b.size === 0) return { comuns: 0, razao: null, avaliavel: false };
  const comuns = a.filter((t) => b.has(t)).length;
  return { comuns, razao: comuns / a.length, avaliavel: true };
}

// ─── Âncora: um trecho do resumo do RSS aparece no corpo da página? ──
// Testa TODAS as janelas de 8 palavras do resumo, não só uma: o corpo
// extraído pode estar truncado, ou o feed pode ter reescrito o começo, e
// basta um trecho casar pra provar que a página ainda é o artigo. Se a
// página foi trocada, nenhuma janela casa.
export function ancoraResumo(resumoRss, textoPagina, janela = 8) {
  const palavras = normalizar(resumoRss).split(' ').filter(Boolean);
  const alvo = normalizar(textoPagina);
  if (palavras.length < janela || !alvo) return { encontrada: false, avaliavel: false, trecho: null };

  let referencia = null;
  let melhorPeso = -1;
  for (let i = 0; i + janela <= palavras.length; i++) {
    const fatia = palavras.slice(i, i + janela);
    const trecho = fatia.join(' ');
    if (alvo.includes(trecho)) return { encontrada: true, avaliavel: true, trecho };
    const peso = fatia.reduce((acc, p) => acc + p.length, 0);
    if (peso > melhorPeso) {
      melhorPeso = peso;
      referencia = trecho;
    }
  }
  return { encontrada: false, avaliavel: true, trecho: referencia };
}

// ─── Idioma: a página parece portuguesa? ──────────────────────
// Não é detecção de idioma de verdade, é um piso: um texto longo em
// PT-BR sempre traz vários destes. Uma página trocada por spam em
// indonésio/inglês não traz nenhum.
const MARCADORES_PT = [
  'que', 'para', 'com', 'nao', 'uma', 'dos', 'das', 'por', 'mais', 'como',
  'sao', 'pelo', 'isso', 'foi', 'ser', 'tem', 'entre', 'sobre', 'ao', 'seu',
];

export function pareceportugues(texto, minimoDistintos = 3) {
  const t = normalizar(texto);
  if (!t || t.length < 300) return { ok: true, avaliavel: false, encontrados: [] };
  const palavras = new Set(t.split(' '));
  const encontrados = MARCADORES_PT.filter((m) => palavras.has(m));
  return { ok: encontrados.length >= minimoDistintos, avaliavel: true, encontrados };
}

// ─── Vocabulário de spam ──────────────────────────────────────
// Só expressões inequívocas. Fora da lista de propósito: "aposta"
// ("a empresa aposta no retrofit"), "slot" sozinho (slot portuário, slot
// de agendamento) e "bet" (Betim, Betânia) — todos aparecem em matéria
// legítima de logística.
const TERMOS_SPAM = [
  'slot gacor', 'gacor', 'judi', 'togel', 'maxwin', 'situs slot', 'slot online',
  'daftar situs', 'rtp slot', 'bandar bola', 'pragmatic play', 'casino online',
  'cassino online', 'apostas esportivas', 'deposit pulsa', 'viagra', 'cialis',
];

export function termosSpam(texto) {
  const t = normalizar(texto);
  if (!t) return [];
  return TERMOS_SPAM.filter((termo) => t.includes(termo));
}

// ─── Hosts ────────────────────────────────────────────────────
export function hostDe(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// "logisticanobrasil.com.br" e "cdn.logisticanobrasil.com.br" contam como
// o mesmo domínio; "i.pinimg.com" não.
const dominioRaiz = (host) => (host ? host.split('.').slice(-3).join('.') : null);

export function mesmoDominio(hostA, hostB) {
  if (!hostA || !hostB) return false;
  if (hostA === hostB) return true;
  return hostA.endsWith('.' + hostB) || hostB.endsWith('.' + hostA) || dominioRaiz(hostA) === dominioRaiz(hostB);
}

// Hosts de conteúdo gerado por usuário: nunca são a capa de uma matéria
// jornalística, e é onde os templates de spam buscam imagem.
const HOSTS_UGC = [
  'pinimg.com', 'pinterest.com', 'imgur.com', 'ibb.co', 'postimg.cc',
  'blogspot.com', 'bp.blogspot.com', 'tumblr.com', 'pbs.twimg.com',
  'i.redd.it', 'imgbb.com',
];

export function imagemSuspeita(imagemUrl, urlArtigo) {
  const hostImg = hostDe(imagemUrl);
  const hostArt = hostDe(urlArtigo);
  if (!hostImg) return null;
  if (HOSTS_UGC.some((h) => hostImg === h || hostImg.endsWith('.' + h))) return 'ugc';
  if (hostArt && !mesmoDominio(hostImg, hostArt)) return 'host-diferente';
  return null;
}

// ─── Veredito ─────────────────────────────────────────────────
// Dois pesos: 'grave' reprova sozinho; dois 'leve' somados reprovam.
// Um 'leve' isolado passa, mas fica registrado no diagnóstico do preview.
export function verificarIntegridade({
  url,
  urlFinal = null,
  html = '',
  tituloRss = '',
  resumoRss = '',
  imagem = null,
} = {}) {
  const motivos = [];
  const add = (codigo, peso, detalhe) => motivos.push({ codigo, peso, detalhe });

  const texto = extrairTextoVisivel(html, 4000);
  const tituloPagina = extrairTituloPagina(html);
  const sinais = { tituloPagina, texto: texto ? texto.length : 0 };

  // Sem HTML não dá pra afirmar nada. Não reprova (pode ser bloqueio
  // anti-bot do site-fonte, já conhecido); só registra.
  if (!texto) {
    add('sem_conteudo', 'leve', 'não foi possível extrair texto da página');
    return { ok: true, motivos, sinais };
  }

  // 5. Redirect pra fora do domínio da fonte.
  if (urlFinal && !mesmoDominio(hostDe(urlFinal), hostDe(url))) {
    add('redirect_externo', 'grave', `${hostDe(url)} redirecionou para ${hostDe(urlFinal)}`);
  }

  // 4a. Vocabulário de spam.
  const spam = termosSpam(texto);
  sinais.termosSpam = spam;
  if (spam.length >= 2) {
    add('vocabulario_spam', 'grave', `termos encontrados: ${spam.join(', ')}`);
  } else if (spam.length === 1) {
    add('vocabulario_spam', 'leve', `termo encontrado: ${spam[0]}`);
  }

  // 4b. Idioma.
  const idioma = pareceportugues(texto);
  sinais.marcadoresPT = idioma.encontrados;
  if (idioma.avaliavel && !idioma.ok) {
    add('fora_de_pt_br', 'grave', `só ${idioma.encontrados.length} marcador(es) de português em ${texto.length} chars`);
  }

  // 1 + 2. Título e âncora do resumo. Cada um sozinho é sinal fraco
  // (portal reescreve título; feed publica resumo que não está no corpo),
  // mas os dois juntos significam que a página não é mais o artigo.
  const titulo = sobreposicaoTitulo(tituloRss, tituloPagina);
  const ancora = ancoraResumo(resumoRss, texto);
  sinais.sobreposicaoTitulo = titulo;
  sinais.ancoraResumo = { encontrada: ancora.encontrada, avaliavel: ancora.avaliavel };

  const tituloFalhou = titulo.avaliavel && titulo.razao < MIN_SOBREPOSICAO_TITULO;
  const ancoraFalhou = ancora.avaliavel && !ancora.encontrada;

  if (tituloFalhou && ancoraFalhou) {
    add('conteudo_trocado', 'grave', `título da página ("${tituloPagina}") quase não coincide com o do RSS (${titulo.comuns} palavra(s) em comum), e o resumo do feed não aparece no corpo`);
  } else if (tituloFalhou) {
    add('titulo_divergente', 'leve', `título da página: "${tituloPagina}"`);
  } else if (ancoraFalhou) {
    add('resumo_ausente', 'leve', `trecho do feed não encontrado no corpo: "${ancora.trecho}"`);
  }

  // 3. Imagem.
  const img = imagemSuspeita(imagem, url);
  sinais.imagem = img;
  if (img === 'ugc') {
    add('imagem_ugc', 'leve', `og:image em host de conteúdo de usuário: ${hostDe(imagem)}`);
  } else if (img === 'host-diferente') {
    add('imagem_host_diferente', 'leve', `og:image em ${hostDe(imagem)}, artigo em ${hostDe(url)}`);
  }

  const graves = motivos.filter((m) => m.peso === 'grave').length;
  const leves = motivos.filter((m) => m.peso === 'leve').length;
  return { ok: graves === 0 && leves < 2, motivos, sinais };
}

// Uma linha por motivo, pro log e pro bloco de diagnóstico do preview.
export const resumirMotivos = (motivos) =>
  (motivos || []).map((m) => `${m.peso === 'grave' ? '[GRAVE]' : '[leve]'} ${m.codigo}: ${m.detalhe}`).join(' | ');
