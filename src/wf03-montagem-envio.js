// ════════════════════════════════════════════════════════════
// WF-03 — Montagem HTML + Envio (porte fiel do PROD-WF-03.json)
// Fluxo: Ler Edições → Selecionar edição pronta → Scraping do blog
//   (post recente + imagem) → Montar HTML Cerberus → Enviar preview →
//   Atualizar status
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerAba, upsertLinhas, commitarBanco } from './lib/db.js';
import { montarHTML } from './lib/template.js';
import { enviarPreview } from './lib/sender.js';

const FALLBACK_BLOG_IMG =
  'https://cdn.prod.website-files.com/67d2cd7e700eb793f98a2e81/6a04acd2772388e00bdf5a8d_Gemini_Generated_Image_nmyoe6nmyoe6nmyo.png';

// GET texto, tolerante a falha (continueOnFail), timeout 15s.
async function buscarTexto(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LetsInsights-Bot/1.0; +https://www.lets.com.br)' },
    });
    clearTimeout(t);
    return await resp.text();
  } catch (e) {
    console.log(`⚠️ Falha ao buscar ${url}: ${e.message}`);
    return '';
  }
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── "Extrair Post Recente": primeiro post do blog (Webflow) ──
function extrairPostRecente(html) {
  if (!html || html.length < 1000) {
    console.log('⚠️ HTML do blog vazio ou muito curto. Usando fallback.');
    return null;
  }
  const regexLinks = /<a[^>]+href="(\/blog\/[a-z0-9\-]+)"[^>]*>/gi;
  const links = [];
  let m;
  while ((m = regexLinks.exec(html)) !== null) {
    const slug = m[1];
    if (slug === '/blog' || slug.startsWith('/blog/categoria') || slug.startsWith('/blog/tag')) continue;
    if (!links.includes(slug)) links.push(slug);
  }
  console.log(`✓ ${links.length} links de posts encontrados`);
  if (links.length === 0) return null;

  const slug = links[0];
  const url = `https://www.lets.com.br${slug}`;

  let titulo = null;
  const regexBloco = new RegExp(`<a[^>]+href="${escaparRegex(slug)}"[^>]*>([\\s\\S]{0,500}?)<\\/a>`, 'i');
  const bloco = html.match(regexBloco);
  if (bloco) {
    let texto = bloco[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    texto = texto.replace(/^Novo\s+/i, '');
    const primeiraFrase = texto.match(/^[^.!?]+[.!?]/);
    if (primeiraFrase) texto = primeiraFrase[0].trim();
    texto = texto.replace(/\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*$/i, '').trim();
    texto = texto.replace(/\s*\d{1,2}\s*min.*$/i, '').trim();
    if (texto.length > 150) texto = texto.substring(0, 147) + '...';
    if (texto.length > 15) titulo = texto;
  }
  if (!titulo) {
    titulo = slug.replace('/blog/', '').replace(/-/g, ' ');
    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  }

  console.log(`✓ Post recente: "${titulo}" (${url})`);
  return { titulo, url, origem: 'scraping_listagem' };
}

// ─── "Extrair Imagem do Post": og/twitter → 1ª img CDN após h1 → fallback ─
function extrairImagemPost(htmlPost) {
  if (!htmlPost || htmlPost.length < 500) {
    console.log('⚠️ HTML do post vazio. Usando fallback de imagem.');
    return null;
  }
  const og = htmlPost.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const tw = htmlPost.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (og && og[1].includes('http')) return og[1];
  if (tw && tw[1].includes('http')) return tw[1];

  const idxH1 = htmlPost.search(/<h1[^>]*>/i);
  if (idxH1 > 0) {
    const aposH1 = htmlPost.substring(idxH1);
    const imgMatch = aposH1.match(/<img[^>]+src=["']([^"']*cdn\.prod\.website-files\.com[^"']+)["']/i);
    if (imgMatch) {
      const src = imgMatch[1];
      const estrutural = /logo|icon|favicon|menu|footer|header|avatar/i.test(src);
      if (!estrutural) return src;
      console.log('⚠️ Primeira imagem após h1 parece estrutural. Mantendo fallback.');
    }
  }
  return null;
}

// ─── Orquestração ────────────────────────────────────────────
async function main() {
  requireEnv(['GMAIL_USER', 'GMAIL_APP_PASSWORD']);

  // "Ler Todas as Edições1" + "Validar e Selecionar Edição1"
  const { rows } = await lerAba(config.abaEdicoes);
  if (rows.length === 0) throw new Error('Planilha de edições vazia.');
  const prontas = rows.filter(
    (r) => String(r.status || '').trim().toLowerCase() === 'pronto_envio_com_imagens',
  );
  if (prontas.length === 0) {
    const status = [...new Set(rows.map((r) => r.status))].filter(Boolean);
    throw new Error(`Nenhuma edição com status 'pronto_envio_com_imagens'. Status existentes: ${status.join(', ')}.`);
  }
  const selected = prontas.sort((a, b) => String(b.edicao).localeCompare(String(a.edicao)))[0];
  console.log(`Edição selecionada: ${selected.edicao} - ${selected.titulo_edicao}`);

  // Scraping do blog: "Buscar Blog" → "Extrair Post" → "Buscar Página" → "Extrair Imagem"
  const blogHtml = await buscarTexto('https://www.lets.com.br/blog');
  const post = extrairPostRecente(blogHtml);
  if (post) {
    const postHtml = await buscarTexto(post.url);
    const img = extrairImagemPost(postHtml);
    post.imagem = img || FALLBACK_BLOG_IMG;
    post.tem_imagem_real = !!img;
  }

  // "Montar HTML1"
  const dados = { ...selected, postBlogRecente: post };
  const montado = montarHTML(dados);
  console.log(
    `Edição ${montado.edicao} | Principais: ${montado.qtd_principais} | Cards: ${montado.qtd_cards} | ` +
      `Blog: ${montado.tem_blog_destaque ? 'scraping' : 'fallback'} | HTML: ${montado.html_final.length} chars`,
  );

  // "Criar Anexo HTML1" + "Gmail - Enviar Preview1"
  const anexo = Buffer.from(montado.html_final, 'utf-8');
  const messageId = await enviarPreview({
    assunto: montado.assunto_preview,
    html: montado.html_final,
    anexoNome: `lets_insights_${selected.edicao}.html`,
    anexoConteudo: anexo,
    para: config.previewTo,
  });
  console.log(`✓ Preview enviado para ${config.previewTo} (messageId: ${messageId})`);

  // "Confirmar Preview1" + "Atualizar Status1"
  // (Correção do bug conhecido: grava na aba Edicoes, preservando as demais colunas.)
  const linha = {
    ...selected,
    status: 'draft_enviado_com_imagens',
    enviado_em: new Date().toISOString(),
  };
  const res = await upsertLinhas(config.abaEdicoes, [linha], 'edicao');
  console.log(`✓ Status atualizado na aba ${config.abaEdicoes}: ${res.atualizados} atualizado(s).`);
  commitarBanco(`chore: WF-03 envio edição ${selected.edicao}`);
}

main().catch((e) => {
  console.error('✗ WF-03 falhou:', e);
  process.exit(1);
});
