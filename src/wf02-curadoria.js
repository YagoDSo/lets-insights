// ════════════════════════════════════════════════════════════
// WF-02 — Curadoria + Redação (porte fiel do PROD-WF-02.json)
// Fluxo: Definir Edição → Ler Artigos → Filtrar Edição →
//   Curadoria (Claude) → Buscar HTML/Extrair Imagem →
//   Validar URLs Vivas → Buscar post do blog Lets →
//   Redação (Claude, artigos + blog) → Parse + Validar URLs →
//   Salvar Edição
//
// jul/2026: fim da divisão principais/cards. Agora a redação escreve só
// 3 artigos selecionados (sem "cards" menores) + o resumo do destaque do
// blog Lets — o scraping do blog, que antes rodava no WF-03 na hora de
// montar o HTML (sem persistir, sem passar pela IA), foi movido pra cá
// pra a IA poder escrever um título/resumo de verdade sobre o post, em
// vez de só reaproveitar o título bruto extraído por regex.
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerAba, upsertLinhas, commitarBanco } from './lib/db.js';
import { chamarClaude } from './lib/claude.js';
import { repairJSON } from './lib/repair.js';
import { gerarImagemPorTema } from './lib/imagegen.js';
import { commitarImagensGeradas } from './lib/gitAssets.js';

const FALLBACK_BLOG_IMG =
  'https://cdn.prod.website-files.com/67d2cd7e700eb793f98a2e81/6a04acd2772388e00bdf5a8d_Gemini_Generated_Image_nmyoe6nmyoe6nmyo.png';

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');
const removerAcentos = (s) => s.normalize('NFD').replace(DIACRITICOS, '');
const slugify = (s) => removerAcentos(s || 'geral').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ─── Buscar HTML (GET, tolerante a falha, timeout 15s) — usado tanto pra
// artigos coletados (via link normalizado, pode vir com encoding estranho
// do RSS) quanto pro scraping do blog Lets (URLs sempre nossas, sem esse
// problema; encodeURI/decodeURI aqui são no-op nesse caso). ─────────────
async function buscarHTML(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(encodeURI(decodeURIComponent(url)), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LetsInsights-Bot/1.0; +https://www.lets.com.br)' },
    });
    clearTimeout(t);
    return await resp.text();
  } catch {
    return '';
  }
}

// ─── Extrair Imagem (og:image → twitter:image → image_src) ───
function extrairImagem(html) {
  let imagem = null;
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m) imagem = m[1];
  if (!imagem) {
    m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) imagem = m[1];
  }
  if (!imagem) {
    m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (m) imagem = m[1];
  }
  if (!imagem) {
    m = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
    if (m) imagem = m[1];
  }
  if (imagem) {
    if (imagem.startsWith('//')) imagem = 'https:' + imagem;
    if (imagem.startsWith('http://')) imagem = imagem.replace('http://', 'https://');
  }
  return imagem || null;
}

// ─── Blog Lets: post mais recente (scraping da listagem) ──────
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function extrairPostRecente(html) {
  if (!html || html.length < 1000) {
    console.log('⚠️ HTML do blog vazio ou muito curto.');
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

  return { titulo, url };
}

// ─── Blog Lets: imagem do post (og/twitter → 1ª img CDN após h1) ─
function extrairImagemPost(htmlPost) {
  if (!htmlPost || htmlPost.length < 500) return null;
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
    }
  }
  return null;
}

// ─── Blog Lets: descrição do post (og:description/meta description) —
// fallback curto caso a extração de texto completo abaixo falhe. ──────
function extrairDescricaoPost(htmlPost) {
  if (!htmlPost) return null;
  let m = htmlPost.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = htmlPost.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

// ─── Blog Lets: texto completo do artigo (corpo da página, sem nav/
// footer/script/style), pra IA extrair números e detalhes específicos
// em vez de só reescrever a meta description (curta, genérica, escrita
// pra SEO). Corta em 6000 caracteres — sobra pra qualquer post do blog,
// evita gastar tokens à toa se a página vier maior que o esperado. ────
function extrairTextoArtigo(htmlPost) {
  if (!htmlPost || htmlPost.length < 500) return null;
  let corpo = htmlPost;
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
  if (texto.length > 6000) texto = texto.slice(0, 6000) + '...';
  return texto;
}

// ─── Validar URLs Vivas (HEAD, timeout 5s) ───────────────────
// Retenta uma vez em status tipicamente transitório (rate-limit/anti-bot do
// site-fonte, ex: brasilmineral.com.br já observado alternando 403/200 pra
// a mesma URL em requisições próximas) antes de descartar o artigo de vez.
const STATUS_TRANSITORIO = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

async function validarURL(url, tentativas = 2) {
  if (!url || typeof url !== 'string') return { ok: false, status: 0 };
  let ultimoErro = { ok: false, status: 0 };
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LetsInsights-Bot/1.0; +https://www.lets.com.br)' },
      });
      clearTimeout(t);
      if (resp.ok || !STATUS_TRANSITORIO.has(resp.status) || tentativa === tentativas) {
        return { ok: resp.ok, status: resp.status };
      }
      ultimoErro = { ok: false, status: resp.status };
    } catch {
      ultimoErro = { ok: false, status: 0 }; // timeout/erro de rede: benefício da dúvida
      if (tentativa === tentativas) return ultimoErro;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return ultimoErro;
}
// status 0 (rede) = mantém; >=400 = descarta.
const deveDescartar = (r) => (r.status === 0 ? false : r.status >= 400);

// ─── Prompts (verbatim do PROD-WF-02; carregam as regras de negócio) ──
function promptCuradoria(artigos) {
  return `Você é o editor de uma newsletter B2B voltada para o público-alvo (ICP) da Let's (gestão de frotas do Grupo Águia Branca): empresas de médio/grande porte com 3 a 35 veículos em operação de campo contínua e terreno adverso (pickup 4x4, utilitários).

Setores prioritários: Engenharia/Geotecnia, Mineração, Meio Ambiente.
Setores secundários: Concessão de Rodovias, Obras/Montagem Industrial, Florestal/Celulose, Infraestrutura, Siderurgia.
Quem lê: Gestor de Frota, Coordenador de Campo, QSMS, Engenheiro de Campo (influenciadores) e Diretor de Operações/Administrativo, Gerente Geral (decisores).

DORES QUE ATIVAM (priorize artigos que tocam nisso): manutenção corretiva imprevisível comendo margem; veículo barrado por laudo/RAC2 vencido; carga de gerir implementação e documentação da frota; atendimento sem solução real; veículo parado em campo como risco de segurança; pickup fora da norma da operação.

Avalie cada artigo e selecione os 6 mais relevantes seguindo:
1. RELEVÂNCIA PRA OPERAÇÃO DE CAMPO (40%): o artigo fala de TCO, RAC2/compliance e laudos, manutenção preventiva vs corretiva, gestão de frota em operação severa, ou de algum dos setores prioritários/secundários acima?
2. ATUALIDADE (20%): Quanto mais recente, melhor
3. AUTORIDADE DA FONTE (20%): Fontes especializadas valem mais
4. ACIONABILIDADE (20%): O leitor (gestor de frota, coordenador de campo, engenheiro de campo) pode fazer algo com a informação na operação dele?

Descarte: conteúdo promocional, cases de concorrente direta, notícias internacionais sem relevância pro Brasil, conteúdo genérico de RH/carreira/mobilidade urbana sem relação com operação de campo, e qualquer artigo com foco central em preço (promoção, desconto, "mais barato").

REGRA DE DIVERSIDADE DE FONTE (CRÍTICA): NENHUMA fonte pode se repetir entre as 6 escolhidas — cada uma vem de uma fonte diferente. Esta regra é ESTRITA e vale pro conjunto inteiro (incluindo as reservas) — nunca escolha uma 2ª matéria da mesma fonte só porque ela também é relevante; prefira uma matéria de outra fonte, mesmo com score um pouco menor.

REGRA DE DIVERSIDADE DE TEMA (CRÍTICA): cada artigo tem um campo "tema". Entre os 6 selecionados, NÃO concentre num único tema. Distribua entre temas diferentes (Eletrificacao, Regulacao, Tecnologia, Mercado, RenovacaoFrota, Custos, Logistica, OperacaoCampo, Outros). O ideal é que os 3 primeiros (top 3 por score) sejam de 3 temas DISTINTOS entre si. Se houver muitos artigos do mesmo tema, escolha o melhor de cada tema antes de repetir tema. Variedade temática é mais importante que pequenas diferenças de score. Ao empatar em score, prefira o artigo de tema OperacaoCampo ou Regulacao (mais alinhado ao ICP de operação de campo/compliance) sobre temas genéricos de mercado.

IMPORTANTE: ordene os 6 selecionados pelo score (do maior pro menor), MAS respeitando a diversidade de tema nos 3 primeiros. Atribua scores diferenciados. As posições 3, 4 e 5 (as três últimas) são reserva (backup) — coloque aí os 3 melhores artigos que sobrarem (de fontes/temas ainda dentro do limite de diversidade), caso algum dos 3 primeiros seja descartado depois por falha de link.

Retorne APENAS JSON válido (sem markdown), ordenado por score decrescente:
{"selecionados": [{"titulo_original": "...", "url": "...", "fonte": "...", "data": "...", "tema": "...", "score": 0-10, "justificativa": "...", "categoria": "Análise|Renovação de frota|Regulação|Tecnologia|Carbono|Sazonalidade|Mercado"}]}

ARTIGOS:
${JSON.stringify(artigos, null, 2)}`;
}

function promptRedacao(selecionados, blogRaw) {
  return `Você é o redator-chefe da newsletter 'Let's Insights', uma publicação semanal B2B da Let's (gestão de frotas do Grupo Águia Branca) voltada para gestores de frota, coordenadores de campo, QSMS, engenheiros de campo e diretores de operações de empresas com frotas 4x4 em operação de campo (Engenharia/Geotecnia, Mineração, Meio Ambiente, Concessão de Rodovias, Obras/Montagem Industrial, Florestal/Celulose, Infraestrutura, Siderurgia).

TOM DE VOZ (guia oficial da marca, siga à risca):
- Técnico, direto e confiável: fale como especialista de operação conversando com outro especialista de operação, nunca como vendedor.
- Profissional sem ser formal demais, sem jargão de marketing.
- Sempre traga a camada "e o que isso significa pra sua operação?" (impacto prático em campo, não abstrato).
- SEMPRE que o artigo trouxer um dado concreto (número, %, prazo, valor), esse dado deve aparecer no título — números são mais concretos e convincentes que descrições genéricas.
- Estruture a frase com o insight/impacto primeiro, a contextualização depois. Não enterre o "e daí" no fim.
- NUNCA prometa o que não pode entregar.
- NUNCA use superlativo vazio ("melhor", "líder", "número 1") nem linguagem de venda genérica (ex: "5 vantagens de...", "temos a solução perfeita pra sua empresa!").
- NUNCA fale de preço antes de falar de operação. Preço não é gancho de manchete.
- NUNCA use travessão (—).
- Exemplos de tom certo: "Como calcular o TCO real de uma frota 4x4 em operação de campo", "RAC2: o que é e por que seu veículo precisa estar em conformidade", "Um laudo vencido pode parar sua equipe inteira".
- Exemplos de tom errado (evite): "5 vantagens de terceirizar veículos", "Temos a solução perfeita pra sua empresa!", qualquer superlativo ou foco em preço.

REFERÊNCIA DE ESTRUTURA DE FRASE: Brazil Journal. O título não é uma manchete seca — é UMA FRASE ÚNICA que declara o fato principal e emenda, na mesma frase, uma cláusula com o dado concreto e a implicação pra operação. Encadeie com dois-pontos, ponto e vírgula, ou "e"/"que" (NUNCA travessão — proibido pra nossa marca, mesmo sendo a técnica de encadeamento favorita do Brazil Journal). Exemplo real deles (adaptado): "A Rumo concluiu os primeiros 162 km da Ferrovia Estadual de Mato Grosso, ligando Rondonópolis a Dom Aquino: um investimento de R$ 5 bi que reduz o custo de escoamento na região." Exemplo no nosso tom: "ANTT reduz de 24 para 12 meses a validade do laudo RAC2: veículo com laudo vencido fica proibido de operar em estrada federal." Nunca separe em manchete + resumo — é uma frase só, com a cláusula extra dentro dela.

REGRAS DE COPYRIGHT (CRÍTICO): NUNCA copie trechos literais dos artigos de terceiros. SEMPRE parafraseie. Cite a fonte ao final. (Não se aplica ao destaque do blog Lets abaixo — é conteúdo próprio da marca.)

REGRA DE DIVERSIDADE EDITORIAL (CRÍTICA): ao escolher os 3 artigos, NENHUMA fonte pode se repetir — cada um vem de uma fonte diferente. (Não se aplica ao destaque do blog Lets, que não concorre com essa diversidade.)

REGRA DE DIVERSIDADE DE TEMA (CRÍTICA): cada artigo tem um campo "tema". Os 3 escolhidos devem ser de 3 temas DISTINTOS entre si (nunca 2 do mesmo tema). Se receber muitos artigos do mesmo tema, use o melhor e descarte os demais repetidos de tema, preferindo variedade. Variedade temática é mais importante que pequenas diferenças de score.

REGRA CRÍTICA DE INTEGRIDADE DE DADOS: você DEVE preservar EXATAMENTE como recebidos os campos url, fonte e imagem de cada artigo. NUNCA invente, modifique, encurte ou abrevie URLs. NUNCA troque URLs entre artigos. Esta regra é INVIOLÁVEL.

Você vai receber uma lista de artigos JÁ validados (link e imagem conferidos), ordenados por score (do maior pro menor). IMPORTANTE: nem sempre a lista terá 6 artigos — alguns dos que a curadoria escolheu podem ter sido descartados nessa validação por link morto ou erro temporário do site de origem, então você pode receber menos itens do que o esperado. NUNCA invente um artigo pra completar uma quantidade "ideal": use só o que está na lista.

ARTIGOS SELECIONADOS: escolha os 3 melhores artigos da lista (respeitando as regras de diversidade de fonte/tema acima). Se sobrar menos de 3 na lista, gere só os que existirem — não invente um a mais.
Para CADA artigo, gere:
- categoria (1-2 palavras, ex: "Análise", "Pesados", "Leves", "Regulação", "Renovação de frota")
- titulo (MÁX 140 caracteres, DE VERDADE curto — isso é o registro rápido do Brazil Journal, não o do blog abaixo: UMA cláusula só, sem emendar uma segunda cláusula elaborada. Frase única no estilo Brazil Journal — ver REFERÊNCIA DE ESTRUTURA DE FRASE acima: fato principal + no máximo UM dado concreto e a implicação pra operação de campo, tudo na mesma frase curta, sem travessão; parafraseado, nunca copie o título original)
- MANTENHA url, fonte e imagem EXATAMENTE como vieram

DESTAQUE DO BLOG LETS (ÚNICO item com esse tratamento — os 3 artigos acima ficam curtos e rápidos, isso aqui é a exceção): abaixo vêm o título e o texto completo do post mais recente do blog institucional da Let's — conteúdo próprio da marca, não precisa de regra de diversidade nem de copyright, e AQUI a regra é diferente da dos artigos externos: em vez de uma frase-fato compacta, quero uma chamada mais detalhada e persuasiva, que dê vontade de clicar. Gere:
- categoria: sempre "Blog Lets"
- titulo (MÁX 260 caracteres; leia o texto completo do post abaixo e garimpe o que tem de mais concreto e curioso — números específicos, estatística inesperada, detalhe que a maioria não imagina, contraste chamativo — e construa uma frase (ou duas, ligadas por dois-pontos/ponto e vírgula, nunca travessão) que venda o clique com esse gancho, não um resumo burocrático do assunto. Ainda no tom da marca — nada de superlativo vazio ("incrível", "imperdível") nem clickbait vazio; a curiosidade tem que vir de um fato real do texto, não de suspense artificial)

REGRA DE VOZ (INVIOLÁVEL, vale pro destaque do blog): mesmo sendo conteúdo próprio, a frase fica em 3ª pessoa neutra, no mesmo registro de reportagem dos artigos externos — NUNCA "no blog, a Let's mostra/ensina/explica", NUNCA "você vai ver/aprender", NUNCA a marca falando de si mesma na frase. Relate o fato do jeito que uma editoria de negócios relataria uma notícia de terceiros: o fato primeiro, a implicação depois, sem se autopromover dentro do título. O link/imagem/botão já deixam claro que é conteúdo Let's — a frase não precisa (e não deve) dizer isso.

REGRA CRÍTICA (INVIOLÁVEL, vale pro destaque do blog): todo número, estatística, dado ou detalhe que aparecer no título DEVE estar literalmente presente no "Texto completo do artigo" abaixo. NUNCA invente, estime, arredonde de forma enganosa nem "complete" um dado que o texto não fornece. Se o texto completo não tiver nenhum número ou detalhe curioso de sobra, construa a frase persuasiva só com o que estiver escrito ali (pode usar o ângulo/insight do artigo, só não pode inventar dado concreto que não exista no texto-fonte). Na dúvida, prefira uma chamada mais genérica e verdadeira a uma específica e inventada.

Post do blog:
Título: ${blogRaw?.titulo || '(sem título disponível)'}
Texto completo do artigo: ${blogRaw?.textoCompleto || blogRaw?.descricao || '(sem texto disponível, baseie-se só no título)'}

Gere também:

1. TÍTULO DA EDIÇÃO no formato OBRIGATÓRIO: "Let's Insights · [destaque]"
   - Destaque: máx 40 caracteres, verbo de ação ou novidade concreta
   - NUNCA omita o prefixo "Let's Insights · "
   - Use "·" (ponto médio U+00B7), nunca hífen

2. PRÉ-HEADER (máx 90 caracteres, vira preview no inbox)

3. CTA_FINAL (chamada pra falar com especialista Let's)
   - ANTES de escrever, releia os 3 artigos e o destaque do blog que você selecionou acima. Identifique qual dor operacional de campo domina ESTA edição especificamente (pode ser documentação/compliance, manutenção, disponibilidade de veículo, tecnologia, regulação ambiental, custo, ou outra — depende do que você mesmo selecionou, não de um exemplo fixo).
   - titulo (pergunta provocativa ancorada NESSA dor específica da edição; NUNCA sobre preço, máx 60 chars)
   - texto (2 frases sobre a operação: veículo pronto pra operar, consultor dedicado, documentação/laudos resolvidos; sem falar de preço)
   - botao (texto do botão, ex: "FALAR COM ESPECIALISTA")
   - VARIAÇÃO OBRIGATÓRIA: não repita sempre o mesmo gancho de "laudo/RAC2 vencido" só porque é um exemplo comum de outras edições — o gancho deve mudar conforme o tema real dos artigos selecionados nesta chamada.

Retorne APENAS JSON válido (sem markdown):
{
  "titulo_edicao": "...",
  "pre_header": "...",
  "artigos_selecionados": [
    {"categoria": "...", "titulo": "...", "url": "...", "fonte": "...", "imagem": "..."}
  ],
  "blog": {"categoria": "Blog Lets", "titulo": "..."},
  "cta_final": {"titulo": "...", "texto": "...", "botao": "..."}
}

ARTIGOS (ordenados por score):
${JSON.stringify(
  // score/justificativa/posicao são metadado interno da curadoria — a redação
  // não usa nenhum dos três (não estão no formato de saída pedido acima) e
  // são só tokens de input desperdiçados nesta chamada.
  selecionados.map(({ score, justificativa, posicao, ...resto }) => resto),
  null,
  2,
)}`;
}

// A redação principal às vezes deixa vaga sem motivo (falha de
// instruction-following do modelo) mesmo havendo candidato validado e sem
// conflito de fonte/tema disponível. Em vez de publicar a edição capenga,
// completa com uma chamada avulsa focada só nesse artigo.
function promptArtigoAvulso(artigo, resumoOriginal) {
  return `Você é o redator-chefe da newsletter 'Let's Insights', B2B da Let's (gestão de frotas do Grupo Águia Branca) voltada pra gestores de frota, coordenadores de campo, QSMS e engenheiros de campo em operação com veículos 4x4.

TOM: técnico, direto, especialista falando com especialista. Sem superlativo vazio, sem jargão de marketing, sem foco em preço, NUNCA use travessão (—). SEMPRE parafraseie, nunca copie trecho literal.

Gere o título pra este artigo:
Título original: ${artigo.titulo_original}
Fonte: ${artigo.fonte}
Resumo original: ${resumoOriginal || '(sem resumo disponível, baseie-se só no título)'}

Retorne APENAS JSON válido (sem markdown):
{"categoria": "1-2 palavras, ex: Regulação, Tecnologia, Carbono", "titulo": "máx 140 caracteres, curto e rápido; UMA frase única com no máximo uma cláusula extra (dado concreto + implicação), nunca duas; nunca travessão"}`;
}

// Completa a lista de selecionados se sobrar vaga após a redação principal,
// usando os candidatos validados (posições 0-2 primeiro; backups 3-5 só
// como último recurso) que ainda não foram usados, respeitando as mesmas
// regras de diversidade (sem tema repetido, sem fonte repetida no total).
async function completarSelecionados(selecionados, validados, mapaResumos) {
  const MAX = 3;
  if (selecionados.length >= MAX) return selecionados;

  const usados = new Set(selecionados.map((a) => a.url));
  const mapaTemaPorUrl = {};
  validados.forEach((v) => (mapaTemaPorUrl[v.url] = v.tema));
  const temasUsados = new Set(
    selecionados.map((a) => mapaTemaPorUrl[a.url]).filter(Boolean),
  );
  const contarFonte = () => {
    const c = {};
    selecionados.forEach((a) => (c[a.fonte] = (c[a.fonte] || 0) + 1));
    return c;
  };

  const candidatosReais = validados.filter((v) => v.posicao < 3 && !usados.has(v.url));
  const candidatosBackup = validados.filter((v) => v.posicao >= 3 && !usados.has(v.url));
  for (const cand of [...candidatosReais, ...candidatosBackup]) {
    if (selecionados.length >= MAX) break;
    if (temasUsados.has(cand.tema)) continue;
    if ((contarFonte()[cand.fonte] || 0) >= 1) continue;

    let dados;
    try {
      const texto = await chamarClaude(promptArtigoAvulso(cand, mapaResumos[cand.url]), { maxTokens: 500 });
      dados = JSON.parse(repairJSON(texto));
    } catch (e) {
      console.log(`⚠️ Falha ao gerar artigo avulso pra "${cand.titulo_original}" (${e.message}), pulando.`);
      continue;
    }
    console.log(`⚠️ Artigo completado em código (IA deixou vaga): ${cand.titulo_original} (${cand.fonte})`);
    selecionados.push({
      categoria: dados.categoria || cand.tema || 'Notícia',
      titulo: dados.titulo || '',
      url: cand.url,
      fonte: cand.fonte,
      imagem: cand.imagem,
    });
    usados.add(cand.url);
    temasUsados.add(cand.tema);
  }
  return selecionados;
}

// ─── Orquestração ────────────────────────────────────────────
async function main() {
  requireEnv(['ANTHROPIC_API_KEY']);

  // "Ler Artigos Coletados" + "Definir Edição": max(edicao) = a que o WF-01 gravou.
  const { rows } = await lerAba(config.abaArtigos);
  const numeros = rows.map((r) => parseInt(r.edicao)).filter((n) => !isNaN(n) && n > 0);
  const edicaoAtual = String(numeros.length > 0 ? Math.max(...numeros) : 1);
  console.log(`✓ Edição para curadoria: ${edicaoAtual}`);

  // "Filtrar Edição Atual"
  const dessaEdicao = rows.filter((r) => String(r.edicao) === edicaoAtual);
  if (dessaEdicao.length === 0) {
    throw new Error(`Nenhum artigo para edição ${edicaoAtual}. WF-01 não rodou ou não encontrou conteúdo.`);
  }
  if (dessaEdicao.length < 4) {
    console.log(`⚠️ Apenas ${dessaEdicao.length} artigos disponíveis (esperado 4+). Newsletter pode ficar incompleta.`);
  }
  console.log(`Artigos da edição ${edicaoAtual}: ${dessaEdicao.length}`);

  // "Preparar Curadoria" + "Claude API - Curadoria" + "Parse Curadoria"
  const artigos = dessaEdicao.map((r, idx) => ({
    id: idx + 1,
    titulo: r.titulo,
    url: r.url,
    fonte: r.fonte,
    data: r.data_publicacao,
    resumo: r.resumo,
    tema: r.tema || 'Outros',
  }));
  const textoCuradoria = await chamarClaude(promptCuradoria(artigos), { maxTokens: 3000 });
  let dadosCuradoria;
  try {
    dadosCuradoria = JSON.parse(repairJSON(textoCuradoria));
  } catch (e) {
    throw new Error('Falha ao parsear JSON da curadoria: ' + e.message);
  }
  if (!dadosCuradoria.selecionados || !Array.isArray(dadosCuradoria.selecionados)) {
    throw new Error('JSON da curadoria inválido');
  }
  // A regra "sem fonte repetida" é só pedida no prompt — a IA já violou isso
  // na prática, o que desperdiça vaga de backup rio abaixo. Reforça em
  // código, mantendo a ordem por score (mais alto primeiro).
  const MAX_POR_FONTE_CURADORIA = 1;
  const contagemFonte = {};
  const semExcessoDeFonte = dadosCuradoria.selecionados.filter((art) => {
    const fonte = art.fonte || 'Desconhecido';
    contagemFonte[fonte] = (contagemFonte[fonte] || 0) + 1;
    if (contagemFonte[fonte] > MAX_POR_FONTE_CURADORIA) {
      console.log(`  ⚠️ Removido por excesso de fonte (>${MAX_POR_FONTE_CURADORIA}): ${art.titulo_original} (${fonte})`);
      return false;
    }
    return true;
  });
  const selecionadosCuradoria = semExcessoDeFonte.map((art, idx) => ({ ...art, posicao: idx }));
  console.log(`Curadoria: ${selecionadosCuradoria.length} artigos selecionados`);

  // "Buscar HTML do Artigo" + "Extrair Imagem"
  const comImagem = [];
  for (let idx = 0; idx < selecionadosCuradoria.length; idx++) {
    const original = selecionadosCuradoria[idx];
    const tipo = idx < 3 ? 'REAL' : 'BACKUP';
    const html = await buscarHTML(original.url);
    const imagem = extrairImagem(html);
    console.log(`[${idx}] ${tipo}: ${original.titulo_original} (${original.fonte}) ${imagem ? '✓ img' : '✗ sem img'}`);
    comImagem.push({
      titulo_original: original.titulo_original,
      url: original.url,
      fonte: original.fonte,
      data: original.data,
      score: original.score,
      justificativa: original.justificativa,
      categoria: original.categoria,
      tema: original.tema || 'Outros',
      imagem,
      posicao: idx,
    });
  }

  // "Validar URLs Vivas"
  console.log(`\nValidando ${comImagem.length} artigos...`);
  const validados = [];
  let descartados = 0;
  let imagensDescartadas = 0;
  for (let idx = 0; idx < comImagem.length; idx++) {
    const artigo = comImagem[idx];
    const vURL = await validarURL(artigo.url);
    if (deveDescartar(vURL)) {
      console.log(`  [${idx}] ✗ DESCARTADO: HTTP ${vURL.status}`);
      descartados++;
      continue;
    }
    let imagem = artigo.imagem;
    if (imagem) {
      const vImg = await validarURL(imagem);
      if (deveDescartar(vImg)) {
        imagem = null;
        imagensDescartadas++;
      }
    }
    validados.push({ ...artigo, imagem });
  }
  console.log(`Válidos: ${validados.length}/${comImagem.length} | descartados: ${descartados} | imagens removidas: ${imagensDescartadas}`);
  if (validados.length < 3) {
    console.log(`⚠️ ALERTA: só ${validados.length} artigos válidos (precisa de 3).`);
  }
  if (validados.length === 0) {
    throw new Error('Todos os artigos foram descartados na validação. Verifique o WF-01.');
  }

  // Blog Lets: post mais recente + descrição (pra IA escrever o título) + imagem.
  // Movido do WF-03 pra cá — antes o scraping rodava na hora de montar o
  // HTML, sem passar pela IA nem persistir; agora entra na mesma chamada
  // de redação, então precisa acontecer antes dela.
  console.log('\nBuscando post mais recente do blog Lets...');
  const blogHtml = await buscarHTML('https://www.lets.com.br/blog');
  const postBlog = extrairPostRecente(blogHtml);
  let blogRaw = null;
  if (postBlog) {
    const postHtml = await buscarHTML(postBlog.url);
    const imgPost = extrairImagemPost(postHtml);
    postBlog.imagem = imgPost || FALLBACK_BLOG_IMG;
    postBlog.textoCompleto = extrairTextoArtigo(postHtml);
    postBlog.descricao = extrairDescricaoPost(postHtml); // fallback se o texto completo falhar
    blogRaw = postBlog;
    console.log(`✓ Post do blog: "${postBlog.titulo}" (${postBlog.url}) ${imgPost ? '✓ img' : '✗ sem img (fallback)'} ${postBlog.textoCompleto ? `✓ texto (${postBlog.textoCompleto.length} chars)` : '✗ sem texto completo'}`);
  } else {
    console.log('⚠️ Não foi possível extrair post do blog. Usando fallback genérico.');
  }

  // "Gerar Imagem Fallback (IA)": artigos sem imagem válida entre os 3
  // "reais" (posições 0-2; 3 e 4 são backup e nunca entram na edição).
  const semImagem = validados.filter((a) => !a.imagem && a.posicao < 3);
  if (semImagem.length > 0) {
    console.log(`\nGerando ${semImagem.length} imagem(ns) via IA (Gemini) para artigos sem imagem...`);
    const arquivos = [];
    for (const artigo of semImagem) {
      const { buffer, ext } = await gerarImagemPorTema({
        titulo: artigo.titulo_original,
        categoria: artigo.categoria,
        tema: artigo.tema,
      });
      arquivos.push({
        nomeArquivo: `ed${edicaoAtual}-pos${artigo.posicao}-${slugify(artigo.tema)}.${ext}`,
        buffer,
        posicao: artigo.posicao,
      });
    }
    const urls = commitarImagensGeradas(arquivos);
    for (const { nomeArquivo, posicao } of arquivos) {
      const alvo = validados.find((a) => a.posicao === posicao);
      alvo.imagem = urls[nomeArquivo];
      console.log(`  [${posicao}] imagem gerada: ${urls[nomeArquivo]}`);
    }
  }

  // "Preparar Redação" + "Claude API - Redação"
  const textoRedacao = await chamarClaude(promptRedacao(validados, blogRaw), { maxTokens: 3000 });
  let edicao;
  try {
    edicao = JSON.parse(repairJSON(textoRedacao));
  } catch (e) {
    throw new Error('Falha ao parsear JSON da redação: ' + e.message);
  }

  // "Parse Edição Final + Validar URLs"
  const obrigatorios = ['titulo_edicao', 'pre_header', 'artigos_selecionados', 'blog', 'cta_final'];
  const faltando = obrigatorios.filter((c) => !edicao[c]);
  if (faltando.length > 0) throw new Error(`Campos faltando: ${faltando.join(', ')}`);
  if (!Array.isArray(edicao.artigos_selecionados) || edicao.artigos_selecionados.length === 0) {
    throw new Error('artigos_selecionados inválido ou vazio');
  }

  // Integridade de URL: corrige URL/fonte/imagem caso a IA tenha inventado.
  const mapaOriginal = {};
  validados.forEach((s) => (mapaOriginal[s.url] = { url: s.url, fonte: s.fonte, imagem: s.imagem }));
  const validarArtigo = (artIA, posEsperada) => {
    const urlIA = artIA.url || '';
    if (mapaOriginal[urlIA]) {
      const o = mapaOriginal[urlIA];
      return { ...artIA, url: o.url, fonte: o.fonte, imagem: o.imagem };
    }
    if (validados[posEsperada]) {
      const o = validados[posEsperada];
      console.log(`⚠️ URL corrigida (pos ${posEsperada}): IA inventou, usando original`);
      return { ...artIA, url: o.url, fonte: o.fonte, imagem: o.imagem };
    }
    return artIA;
  };
  let selecionadosFinal = edicao.artigos_selecionados.map((a, idx) => validarArtigo(a, idx));

  const mapaResumos = {};
  artigos.forEach((a) => (mapaResumos[a.url] = a.resumo));
  selecionadosFinal = await completarSelecionados(selecionadosFinal, validados, mapaResumos);

  // Blog: garante fallback de imagem/url mesmo se a extração falhar.
  const blogFinal = {
    categoria: edicao.blog.categoria || 'Blog Lets',
    titulo: edicao.blog.titulo,
    url: blogRaw?.url || 'https://www.lets.com.br/blog',
    fonte: 'Blog Lets',
    imagem: blogRaw?.imagem || FALLBACK_BLOG_IMG,
  };

  console.log(`✓ Edição ${edicaoAtual} gerada: "${edicao.titulo_edicao}"`);
  console.log(`Artigos selecionados: ${selecionadosFinal.length} | Blog: "${blogFinal.titulo}"`);

  // "Salvar Edição" (upsert por edicao). json_artigos_cards fica sem uso a
  // partir daqui (não existe mais divisão principais/cards) — mantido só
  // pra não exigir migração destrutiva de coluna.
  const linha = {
    edicao: edicaoAtual,
    titulo_edicao: edicao.titulo_edicao,
    pre_header: edicao.pre_header,
    json_artigos_principais: JSON.stringify(selecionadosFinal),
    json_artigos_cards: JSON.stringify([]),
    json_blog: JSON.stringify(blogFinal),
    json_cta: JSON.stringify(edicao.cta_final),
    status: 'pronto_envio_com_imagens',
    gerado_em: new Date().toISOString(),
  };
  const res = await upsertLinhas(config.abaEdicoes, [linha], 'edicao');
  console.log(`✓ Salvo na aba ${config.abaEdicoes}: ${res.inseridos} inseridos, ${res.atualizados} atualizados.`);
  commitarBanco(`chore: WF-02 curadoria e redação edição ${edicaoAtual}`);
}

main().catch((e) => {
  console.error('✗ WF-02 falhou:', e);
  process.exit(1);
});
