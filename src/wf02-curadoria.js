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
//
// nov/2026: news segmentada (ver docs/plano-news-segmentada.md). A curadoria
// cura 7 listas numa chamada (geral, Brasil e 5 segmentos); a validação de
// link/imagem e a re-hospedagem rodam uma vez sobre a união; o
// código distribui os artigos nas versões (distribuirArtigos); a redação
// escreve cada artigo uma vez e o assunto/pré-header de cada versão. Grava
// a versão geral em edicoes (como antes) e as 7 versões em edicoes_versoes.
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerAba, upsertLinhas, commitarBanco } from './lib/db.js';
import { chamarClaude } from './lib/claude.js';
import { repairJSON } from './lib/repair.js';
import { commitarImagensGeradas } from './lib/gitAssets.js';
import { precisaRehospedar, baixarImagem } from './lib/rehost.js';

const FALLBACK_BLOG_IMG =
  'https://cdn.prod.website-files.com/67d2cd7e700eb793f98a2e81/6a04acd2772388e00bdf5a8d_Gemini_Generated_Image_nmyoe6nmyoe6nmyo.png';

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

// ─── News segmentada (nov/2026, ver docs/plano-news-segmentada.md) ──────
// 7 versões por semana: geral comercial (listas 34/69, com botão), geral
// clientes (lista 67 fora dos 5 segmentos, sem botão) e 5 segmentadas (lista
// 67). As duas gerais têm o mesmo conteúdo; muda só o rodapé (ver template.js).
// Cada segmentada tem 5 itens: notícia do segmento, blog, notícia do segmento,
// notícia Brasil, notícia Brasil (as 2 do Brasil são as mesmas nas 5).
const SEGMENTOS = ['mineracao', 'industria', 'engenharia', 'tecnologia', 'florestal'];
const NOME_SEGMENTO = {
  mineracao: 'Mineração e siderurgia',
  industria: 'Indústria e manufatura',
  engenharia: 'Engenharia e construção',
  tecnologia: 'Tecnologia e telecom',
  florestal: 'Florestal e celulose',
};
const ROTULO_TEMA_BRASIL = { Economia: 'Economia', Regulacao: 'Regulação', Negocios: 'Negócios', Operacao: 'Operação' };
const ITENS_VERSAO_SEGMENTADA = 5;

// ─── Prompts (verbatim do PROD-WF-02; carregam as regras de negócio) ──
// nov/2026: uma chamada só para os 7 pools (geral, Brasil e os 5 segmentos).
// Cada artigo tem um "id"; a resposta devolve só ids, e url/fonte/imagem
// voltam do banco em código (a IA não tem como inventar link).
function promptCuradoria(pools) {
  const blocoPool = (chave) => JSON.stringify(pools[chave], null, 2);
  return `Você é o editor de uma newsletter B2B voltada para o público-alvo (ICP) da Let's (gestão de frotas do Grupo Águia Branca): empresas de médio/grande porte com 3 a 35 veículos em operação de campo contínua e terreno adverso (pickup 4x4, utilitários).

Setores prioritários: Engenharia/Geotecnia, Mineração, Meio Ambiente.
Setores secundários: Concessão de Rodovias, Obras/Montagem Industrial, Florestal/Celulose, Infraestrutura, Siderurgia.
Quem lê: Gestor de Frota, Coordenador de Campo, QSMS, Engenheiro de Campo (influenciadores) e Diretor de Operações/Administrativo, Gerente Geral (decisores).

A newsletter sai em várias versões nesta semana. Você vai curar SETE listas, cada uma a partir do seu próprio pool de artigos (abaixo). Cada artigo tem um "id"; responda só com ids que existem no pool daquela lista.

═══ LISTA 1: "geral" (versão geral, todos os leitores) ═══

DORES QUE ATIVAM (priorize artigos que tocam nisso): manutenção corretiva imprevisível comendo margem; veículo barrado por laudo/RAC2 vencido; carga de gerir implementação e documentação da frota; atendimento sem solução real; veículo parado em campo como risco de segurança; pickup fora da norma da operação.

Avalie cada artigo do POOL GERAL e selecione os 6 mais relevantes seguindo:
1. RELEVÂNCIA PRA OPERAÇÃO DE CAMPO (40%): o artigo fala de TCO, RAC2/compliance e laudos, manutenção preventiva vs corretiva, gestão de frota em operação severa, ou de algum dos setores prioritários/secundários acima?
2. ATUALIDADE (20%): Quanto mais recente, melhor
3. AUTORIDADE DA FONTE (20%): Fontes especializadas valem mais
4. ACIONABILIDADE (20%): O leitor (gestor de frota, coordenador de campo, engenheiro de campo) pode fazer algo com a informação na operação dele?

Descarte: conteúdo promocional, cases de concorrente direta, notícias internacionais sem relevância pro Brasil, conteúdo genérico de RH/carreira/mobilidade urbana sem relação com operação de campo, e qualquer artigo com foco central em preço (promoção, desconto, "mais barato").

REGRA DE DIVERSIDADE DE FONTE (CRÍTICA): NENHUMA fonte pode se repetir entre as 6 escolhidas — cada uma vem de uma fonte diferente. Esta regra é ESTRITA e vale pro conjunto inteiro (incluindo as reservas) — nunca escolha uma 2ª matéria da mesma fonte só porque ela também é relevante; prefira uma matéria de outra fonte, mesmo com score um pouco menor.

REGRA DE DIVERSIDADE DE TEMA (CRÍTICA): cada artigo tem um campo "tema". Entre os 6 selecionados, NÃO concentre num único tema. Distribua entre temas diferentes (Eletrificacao, Regulacao, Tecnologia, Mercado, RenovacaoFrota, Custos, Logistica, OperacaoCampo, Outros). O ideal é que os 3 primeiros (top 3 por score) sejam de 3 temas DISTINTOS entre si. Se houver muitos artigos do mesmo tema, escolha o melhor de cada tema antes de repetir tema. Variedade temática é mais importante que pequenas diferenças de score. Ao empatar em score, prefira o artigo de tema OperacaoCampo ou Regulacao (mais alinhado ao ICP de operação de campo/compliance) sobre temas genéricos de mercado.

IMPORTANTE: ordene os 6 selecionados pelo score (do maior pro menor), MAS respeitando a diversidade de tema nos 3 primeiros. Atribua scores diferenciados. As posições 3, 4 e 5 (as três últimas) são reserva (backup) — coloque aí os 3 melhores artigos que sobrarem (de fontes/temas ainda dentro do limite de diversidade), caso algum dos 3 primeiros seja descartado depois por falha de link.

═══ LISTA 2: "brasil" (notícias gerais do Brasil, entram em todas as versões por setor) ═══

Do POOL BRASIL, selecione 4 artigos (2 que entram + 2 reservas), ordenados por score. São as notícias da semana sobre economia, regulação, negócios e operação no Brasil que mais importam pra um gestor de empresa com operação de campo: juros, câmbio, combustível, lei/norma que muda a rotina da empresa, grande investimento ou movimento de mercado, logística e energia. Os 2 primeiros têm que ser de temas DIFERENTES entre si (o campo "tema" é Economia, Regulacao, Negocios ou Operacao) e de fontes diferentes. Descarte política partidária ou eleitoral, crime, esporte, celebridade, e notícia de mercado financeiro sem efeito na operação (cotação do dia, recomendação de ação).

═══ LISTAS 3 a 7: uma por setor (versões enviadas a clientes da Let's desse setor) ═══

Para cada setor, do POOL DAQUELE SETOR, selecione 4 artigos (2 que entram + 2 reservas), ordenados por score. O leitor é cliente da Let's e trabalha nesse setor: priorize o que muda a operação, o investimento, a regulação ou o mercado do setor no Brasil (obra, mina, fábrica, rede, floresta), mesmo que não fale de frota. Descarte release de produto sem impacto, evento/feira, nota institucional, conteúdo internacional sem efeito no Brasil e qualquer artigo com foco central em preço. Os 2 primeiros de cada setor têm que ser de fontes diferentes. Se o pool do setor tiver menos artigos bons do que o pedido, devolva menos: nunca complete com artigo fraco ou fora do setor (o código completa com notícia geral).

═══ REGRAS QUE VALEM PRAS 7 LISTAS ═══
- Um artigo NÃO pode aparecer em duas listas. Se um artigo serve a duas, deixe-o na lista onde ele é mais forte.
- Concorrentes (Localiza, Movida, Unidas, Vamos, Ouro Verde, ALD, Arval) não podem ser protagonistas.
- Scores diferenciados, de 0 a 10. Ordene cada lista do maior pro menor score.
- categoria: 1-2 palavras (Análise, Renovação de frota, Regulação, Tecnologia, Carbono, Sazonalidade, Mercado, Investimento, Operação...).

Retorne APENAS JSON válido (sem markdown), no formato:
{"geral": [{"id": 0, "score": 0-10, "justificativa": "...", "categoria": "..."}], "brasil": [...], "mineracao": [...], "industria": [...], "engenharia": [...], "tecnologia": [...], "florestal": [...]}

POOL GERAL:
${blocoPool('geral')}

POOL BRASIL:
${blocoPool('brasil')}

${SEGMENTOS.map((s) => `POOL ${NOME_SEGMENTO[s].toUpperCase()} (lista "${s}"):\n${blocoPool(s)}`).join('\n\n')}`;
}

function promptRedacao(artigosParaEscrever, versoes, blogRaw) {
  const descreverVersao = (v) => {
    const itens = v.itens.map((it, i) => `${i + 1}. ${it.tipo === 'blog' ? 'destaque do blog' : `artigo id ${it.id}`}`).join('; ');
    return `- "${v.versao}" (${v.descricao}): ${itens}`;
  };
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

ESTA SEMANA A NEWSLETTER SAI EM VÁRIAS VERSÕES (uma geral e uma por setor). Os artigos de cada versão JÁ foram escolhidos e validados (link e imagem conferidos); você não escolhe nem descarta nenhum. Cada artigo aparece numa lista única abaixo, com um "id", e é escrito UMA VEZ SÓ: o mesmo título serve em todas as versões em que ele aparece. Escreva um título para CADA artigo da lista, sem pular nenhum.

Para CADA artigo, gere:
- id (o mesmo recebido)
- categoria (1-2 palavras, ex: "Análise", "Pesados", "Leves", "Regulação", "Renovação de frota", "Investimento")
- titulo (MÁX 140 caracteres, DE VERDADE curto — isso é o registro rápido do Brazil Journal, não o do blog abaixo: UMA cláusula só, sem emendar uma segunda cláusula elaborada. Frase única no estilo Brazil Journal — ver REFERÊNCIA DE ESTRUTURA DE FRASE acima: fato principal + no máximo UM dado concreto e a implicação pra operação, tudo na mesma frase curta, sem travessão; parafraseado, nunca copie o título original). Nos artigos de setor e do Brasil, a implicação é pra operação ou pro negócio de quem trabalha naquele setor, não necessariamente pra frota: não force um gancho de frota que o artigo não tem.

DESTAQUE DO BLOG LETS (ÚNICO item com esse tratamento — os artigos acima ficam curtos e rápidos, isso aqui é a exceção): abaixo vêm o título e o texto completo do post mais recente do blog institucional da Let's — conteúdo próprio da marca, não precisa de regra de copyright, e AQUI a regra é diferente da dos artigos externos: em vez de uma frase-fato compacta, quero uma chamada mais detalhada e persuasiva, que dê vontade de clicar. Gere:
- categoria: sempre "Blog Lets"
- titulo (MÁX 260 caracteres; leia o texto completo do post abaixo e garimpe o que tem de mais concreto e curioso — números específicos, estatística inesperada, detalhe que a maioria não imagina, contraste chamativo — e construa uma frase (ou duas, ligadas por dois-pontos/ponto e vírgula, nunca travessão) que venda o clique com esse gancho, não um resumo burocrático do assunto. Ainda no tom da marca — nada de superlativo vazio ("incrível", "imperdível") nem clickbait vazio; a curiosidade tem que vir de um fato real do texto, não de suspense artificial)

REGRA DE VOZ (INVIOLÁVEL, vale pro destaque do blog): mesmo sendo conteúdo próprio, a frase fica em 3ª pessoa neutra, no mesmo registro de reportagem dos artigos externos — NUNCA "no blog, a Let's mostra/ensina/explica", NUNCA "você vai ver/aprender", NUNCA a marca falando de si mesma na frase. Relate o fato do jeito que uma editoria de negócios relataria uma notícia de terceiros: o fato primeiro, a implicação depois, sem se autopromover dentro do título. O link/imagem/botão já deixam claro que é conteúdo Let's — a frase não precisa (e não deve) dizer isso.

REGRA CRÍTICA (INVIOLÁVEL, vale pro destaque do blog): todo número, estatística, dado ou detalhe que aparecer no título DEVE estar literalmente presente no "Texto completo do artigo" abaixo. NUNCA invente, estime, arredonde de forma enganosa nem "complete" um dado que o texto não fornece. Se o texto completo não tiver nenhum número ou detalhe curioso de sobra, construa a frase persuasiva só com o que estiver escrito ali (pode usar o ângulo/insight do artigo, só não pode inventar dado concreto que não exista no texto-fonte). Na dúvida, prefira uma chamada mais genérica e verdadeira a uma específica e inventada.

Post do blog:
Título: ${blogRaw?.titulo || '(sem título disponível)'}
Texto completo do artigo: ${blogRaw?.textoCompleto || blogRaw?.descricao || '(sem texto disponível, baseie-se só no título)'}

Gere também, PARA CADA VERSÃO listada em VERSÕES abaixo, um título da edição e um pré-header:

1. TÍTULO DA EDIÇÃO (titulo_edicao): uma manchete única. Na versão "geral", sobre o destaque mais forte da versão; nas versões de setor, a partir do PRIMEIRO artigo da versão (a notícia de abertura do setor). Escolha UMA das estruturas abaixo (A, B, ou a pergunta ancorada opcional) — a que render o gancho mais forte pro fato daquela versão especificamente, não sempre a mesma:

   ESTRUTURA A — Afirmativa (padrão, use quando não houver uma reviravolta clara)
   - Máx 45 caracteres (o ponto ideal fica entre 30 e 42)
   - Se der pra fechar o sentido em até 33 caracteres, melhor ainda: é o que cabe INTEIRO no Gmail do Android. Não force, porém, a ponto de virar genérico — fato concreto em 40 chars vale mais que vaguidade em 30
   - Comece pelo FATO CONCRETO (sujeito + verbo de ação). O Gmail no celular mostra só os ~33 primeiros caracteres, então preâmbulo, rótulo de categoria ou contexto antes do fato desperdiçam a parte que o leitor realmente vê
   - Formato certo: "Lei 15.485 aperta cadastro de motorista" / "Pesagem em movimento chega à BR-040" / "Biodiesel a 15% derruba desempenho"

   ESTRUTURA B — Contraste (duas orações curtas: afirma, depois vira a mesa)
   - Use só quando os artigos sustentarem uma tensão real (ex: um fato positivo com um "mas" concreto, ou uma solução com uma lacuna) — nunca force um contraste que o conteúdo não tem
   - Máx 65 caracteres no total, cada oração curta (a segunda pode ser só 2-4 palavras)
   - Formato certo: "Biodiesel a 15% já é lei. Poucas frotas estão prontas" / "Fiscalização de RAC2 aumentou. Renovação ainda demora"

   Independente da estrutura escolhida, valem SEMPRE estas regras:
   - NUNCA escreva "Let's Insights" em lugar nenhum do título: o sufixo da marca é acrescentado depois, em código
   - NUNCA escreva o nome do setor como rótulo ("Mineração: ...", "Edição Indústria"): o leitor não deve perceber que recebeu uma versão segmentada
   - Prefira âncora concreta a termo genérico: número, sigla, nome próprio ou percentual quando existir ("Lei 15.485", "BR-040", "biodiesel a 15%") ganham de "regulação" ou "combustível". Quando houver um número ou percentual forte disponível, ele deve ser o CENTRO da frase (o que o leitor lembra depois), não um detalhe posto de lado
   - Sem travessão, sem dois-pontos de rótulo ("Regulação: ..."), sem ponto final, sem aspas
   - Formato errado: "Let's Insights · Biodiesel e compliance" (marca na frente) / "Regulação e custos" (genérico, sem fato) / "Novidades do setor de frotas" (vazio)

   OPCIONAL — pergunta ancorada ("por quê"), em vez de afirmação direta:
   - Só use se a pergunta for sobre um fato ESPECÍFICO daquela versão, nunca genérica ("Por que isso muda tudo?" é proibido — não diz nada que não sirva pra qualquer edição)
   - A resposta tem que vir de fato no corpo do e-mail (a manchete não pode prometer um "porquê" que o texto não desenvolve)
   - Mesmo limite de caracteres da Estrutura A
   - Formato certo: "Por que a Lei 15.485 aperta prazo de motorista" / "Por que biodiesel a 15% derruba desempenho"
   - Formato errado: "Por que isso é importante?" / "Por que você precisa saber disso?" (suspense vazio, sem âncora)

2. PRÉ-HEADER (pre_header, máx 90 caracteres, vira preview no inbox): complementa o título com os outros assuntos daquela versão. Não repita o título.

Gere também, só para a versão "geral":

3. CTA_FINAL (chamada pra falar com especialista Let's)
   - ANTES de escrever, releia os artigos e o destaque do blog da versão "geral". Identifique qual dor operacional de campo domina ESSA versão especificamente (pode ser documentação/compliance, manutenção, disponibilidade de veículo, tecnologia, regulação ambiental, custo, ou outra — depende dos artigos, não de um exemplo fixo).
   - titulo (pergunta provocativa ancorada NESSA dor específica da edição; NUNCA sobre preço, máx 60 chars)
   - texto (2 frases sobre a operação: veículo pronto pra operar, consultor dedicado, documentação/laudos resolvidos; sem falar de preço)
   - botao (texto do botão, ex: "FALAR COM ESPECIALISTA")
   - VARIAÇÃO OBRIGATÓRIA: não repita sempre o mesmo gancho de "laudo/RAC2 vencido" só porque é um exemplo comum de outras edições — o gancho deve mudar conforme o tema real dos artigos.

VERSÕES (itens na ordem do e-mail):
${versoes.map(descreverVersao).join('\n')}

Retorne APENAS JSON válido (sem markdown):
{
  "artigos": [{"id": 0, "categoria": "...", "titulo": "..."}],
  "blog": {"categoria": "Blog Lets", "titulo": "..."},
  "versoes": {${versoes.map((v) => `"${v.versao}": {"titulo_edicao": "...", "pre_header": "..."}`).join(', ')}},
  "cta_final": {"titulo": "...", "texto": "...", "botao": "..."}
}

ARTIGOS:
${JSON.stringify(artigosParaEscrever, null, 2)}`;
}

// ─── Formatos de resposta (saída estruturada, out/2026) ──────
// Espelham exatamente os JSON pedidos nos prompts acima. Com eles a API só
// devolve um JSON válido nesse formato, sem texto antes ou depois.
const STR = { type: 'string' };
const ITEM_CURADORIA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'score', 'justificativa', 'categoria'],
    properties: { id: { type: 'integer' }, score: { type: 'number' }, justificativa: STR, categoria: STR },
  },
};
const LISTAS_CURADORIA = ['geral', 'brasil', ...SEGMENTOS];
const SCHEMA_CURADORIA = {
  type: 'object',
  additionalProperties: false,
  required: LISTAS_CURADORIA,
  properties: Object.fromEntries(LISTAS_CURADORIA.map((l) => [l, ITEM_CURADORIA])),
};
// A lista de versões muda de semana pra semana (versão sem artigo suficiente
// não vai pra redação), então o formato é montado na hora.
function schemaRedacao(chavesVersoes) {
  const VERSAO = {
    type: 'object', additionalProperties: false, required: ['titulo_edicao', 'pre_header'],
    properties: { titulo_edicao: STR, pre_header: STR },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['artigos', 'blog', 'versoes', 'cta_final'],
    properties: {
      artigos: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'categoria', 'titulo'],
          properties: { id: { type: 'integer' }, categoria: STR, titulo: STR },
        },
      },
      blog: {
        type: 'object', additionalProperties: false, required: ['categoria', 'titulo'],
        properties: { categoria: STR, titulo: STR },
      },
      versoes: {
        type: 'object', additionalProperties: false, required: chavesVersoes,
        properties: Object.fromEntries(chavesVersoes.map((k) => [k, VERSAO])),
      },
      cta_final: {
        type: 'object', additionalProperties: false, required: ['titulo', 'texto', 'botao'],
        properties: { titulo: STR, texto: STR, botao: STR },
      },
    },
  };
}
const SCHEMA_ARTIGO_AVULSO = {
  type: 'object', additionalProperties: false, required: ['categoria', 'titulo'],
  properties: { categoria: STR, titulo: STR },
};

// A redação às vezes deixa artigo sem título (falha de instruction-following
// do modelo). Em vez de publicar a versão capenga, completa com uma chamada
// avulsa focada só nesse artigo.
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

// Roda fn sobre a lista com no máximo `limite` chamadas ao mesmo tempo,
// mantendo a ordem do resultado.
async function mapLimitado(lista, limite, fn) {
  const resultado = new Array(lista.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lista.length) {
      const k = proximo++;
      resultado[k] = await fn(lista[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, trabalhador));
  return resultado;
}

// ─── Montagem das versões (código, sem IA) ────────────────────
// Recebe as listas da curadoria já validadas (ordem = score) e decide o que
// entra em cada versão, respeitando: nenhum artigo em dois lugares (exceto as
// 2 notícias Brasil, que são compartilhadas pelas 5 segmentadas), sem fonte
// repetida dentro da versão, e segmento com menos de 2 notícias completado com
// a melhor notícia geral ainda não usada.
function distribuirArtigos(validadosPorLista) {
  const usados = new Set();
  // Escolhe até `qtd` artigos de `candidatos`, em ordem, sem repetir artigo já
  // usado nem fonte em `fontesBloqueadas`. Com distinguirTema, primeiro tenta
  // temas distintos e só depois relaxa (mesma lógica do antigo completarSelecionados).
  const escolher = (candidatos, qtd, { fontesBloqueadas = new Set(), distinguirTema = false } = {}) => {
    const escolhidos = [];
    const fontes = new Set(fontesBloqueadas);
    const passadas = distinguirTema ? [true, false] : [false];
    for (const exigirTemaNovo of passadas) {
      for (const c of candidatos) {
        if (escolhidos.length >= qtd) break;
        if (usados.has(c.id) || escolhidos.includes(c) || fontes.has(c.fonte)) continue;
        if (exigirTemaNovo && escolhidos.some((e) => e.tema === c.tema)) continue;
        escolhidos.push(c);
        fontes.add(c.fonte);
      }
    }
    escolhidos.forEach((c) => usados.add(c.id));
    return escolhidos;
  };

  const geral = escolher(validadosPorLista.geral, 3, { distinguirTema: true });
  // Reserva da versão geral: o que sobrou dela, na ordem de score. É a "melhor
  // notícia geral de operação ainda não usada" que completa segmento e Brasil.
  const reservaGeral = () => validadosPorLista.geral.filter((c) => !usados.has(c.id));

  const brasil = escolher(validadosPorLista.brasil, 2, { distinguirTema: true });
  if (brasil.length < 2) {
    const extra = escolher(reservaGeral(), 2 - brasil.length, { fontesBloqueadas: new Set(brasil.map((b) => b.fonte)) });
    extra.forEach((e) => console.log(`  ⚠️ Brasil com menos de 2 notícias: completado com a geral "${e.titulo_original}" (${e.fonte})`));
    brasil.push(...extra.map((e) => ({ ...e, completou: 'brasil' })));
  }

  const segmentos = {};
  for (const seg of SEGMENTOS) {
    const fontesBrasil = new Set(brasil.map((b) => b.fonte));
    const doSegmento = escolher(validadosPorLista[seg] || [], 2, { fontesBloqueadas: fontesBrasil });
    if (doSegmento.length < 2) {
      const fontes = new Set([...fontesBrasil, ...doSegmento.map((d) => d.fonte)]);
      const extra = escolher(reservaGeral(), 2 - doSegmento.length, { fontesBloqueadas: fontes });
      extra.forEach((e) => console.log(`  ⚠️ ${seg}: só ${doSegmento.length} notícia(s) do setor; completado com a geral "${e.titulo_original}" (${e.fonte})`));
      doSegmento.push(...extra.map((e) => ({ ...e, completou: seg })));
    }
    segmentos[seg] = doSegmento;
  }
  return { geral, brasil, segmentos };
}

// ─── Orquestração ────────────────────────────────────────────
async function main() {
  requireEnv(['ANTHROPIC_API_KEY']);

  // "Ler Artigos Coletados" + "Definir Edição": max(edicao) = a que o WF-01 gravou.
  const { rows } = await lerAba(config.abaArtigos);
  const numeros = rows.map((r) => parseInt(r.edicao)).filter((n) => !isNaN(n) && n > 0);
  const edicaoAtual = String(numeros.length > 0 ? Math.max(...numeros) : 1);
  console.log(`✓ Edição para curadoria: ${edicaoAtual}`);

  // "Filtrar Edição Atual" + pools. Geral = trilha frota (linhas antigas têm
  // trilha vazia e contam como frota). Brasil e cada segmento = coluna
  // segmento, de qualquer trilha (notícia de frota classificada num setor
  // também concorre no setor; o código impede que entre em dois lugares).
  const dessaEdicao = rows.filter((r) => String(r.edicao) === edicaoAtual);
  const artigos = dessaEdicao.map((r, idx) => ({
    id: idx + 1,
    titulo: r.titulo,
    url: r.url,
    fonte: r.fonte,
    data: r.data_publicacao,
    resumo: r.resumo,
    tema: r.tema || 'Outros',
    trilha: r.trilha || 'frota',
    segmento: r.segmento || '',
  }));
  const paraPool = ({ trilha, segmento, url, ...resto }) => resto;
  const pools = {
    geral: artigos.filter((a) => a.trilha === 'frota').map(paraPool),
    brasil: artigos.filter((a) => a.segmento === 'brasil').map(paraPool),
    ...Object.fromEntries(SEGMENTOS.map((s) => [s, artigos.filter((a) => a.segmento === s).map(paraPool)])),
  };
  if (pools.geral.length === 0) {
    throw new Error(`Nenhum artigo de frota para edição ${edicaoAtual}. WF-01 não rodou ou não encontrou conteúdo.`);
  }
  if (pools.geral.length < 4) {
    console.log(`⚠️ Apenas ${pools.geral.length} artigos de frota (esperado 4+). Newsletter pode ficar incompleta.`);
  }
  console.log(`Artigos da edição ${edicaoAtual}: ${Object.entries(pools).map(([k, v]) => `${k} ${v.length}`).join(' | ')}`);

  // "Claude API - Curadoria" + "Parse Curadoria". Folga de tokens: o Sonnet
  // 5.5 usa ~30% mais tokens que o 4.5 pro mesmo texto.
  const textoCuradoria = await chamarClaude(promptCuradoria(pools), { maxTokens: 12000, schema: SCHEMA_CURADORIA });
  let dadosCuradoria;
  try {
    dadosCuradoria = JSON.parse(repairJSON(textoCuradoria));
  } catch (e) {
    throw new Error('Falha ao parsear JSON da curadoria: ' + e.message);
  }
  if (!Array.isArray(dadosCuradoria.geral)) throw new Error('JSON da curadoria inválido');

  // Ids → artigos do banco. Descarta id fora do pool daquela lista. A regra
  // "sem fonte repetida" da versão geral é só pedida no prompt — a IA já
  // violou isso na prática, o que desperdiça vaga de backup rio abaixo.
  // Reforça em código, mantendo a ordem por score (mais alto primeiro).
  const porId = new Map(artigos.map((a) => [a.id, a]));
  const selecionadosPorLista = {};
  for (const lista of LISTAS_CURADORIA) {
    const idsDoPool = new Set(pools[lista].map((a) => a.id));
    const contagemFonte = {};
    selecionadosPorLista[lista] = (dadosCuradoria[lista] || [])
      .filter((s) => {
        if (idsDoPool.has(s.id)) return true;
        console.log(`  ⚠️ [${lista}] id ${s.id} fora do pool, ignorado.`);
        return false;
      })
      .filter((s) => {
        if (lista !== 'geral') return true;
        const fonte = porId.get(s.id).fonte || 'Desconhecido';
        contagemFonte[fonte] = (contagemFonte[fonte] || 0) + 1;
        if (contagemFonte[fonte] > 1) {
          console.log(`  ⚠️ Removido por excesso de fonte (>1): ${porId.get(s.id).titulo} (${fonte})`);
          return false;
        }
        return true;
      })
      .map((s, posicao) => {
        const a = porId.get(s.id);
        return {
          id: a.id, titulo_original: a.titulo, url: a.url, fonte: a.fonte, data: a.data,
          tema: a.tema, score: s.score, justificativa: s.justificativa, categoria: s.categoria,
          lista, posicao,
        };
      });
  }
  console.log(`Curadoria: ${LISTAS_CURADORIA.map((l) => `${l} ${selecionadosPorLista[l].length}`).join(' | ')}`);

  // "Buscar HTML do Artigo" + "Extrair Imagem" + "Validar URLs Vivas", uma vez
  // por artigo (a curadoria pode, contra a regra, pôr o mesmo id em 2 listas).
  const unicos = [...new Map(Object.values(selecionadosPorLista).flat().map((s) => [s.id, s])).values()];
  console.log(`\nValidando ${unicos.length} artigos...`);
  let descartados = 0;
  let imagensDescartadas = 0;
  const resultadoValidacao = await mapLimitado(unicos, 4, async (artigo) => {
    const vURL = await validarURL(artigo.url);
    if (deveDescartar(vURL)) {
      console.log(`  ✗ DESCARTADO (HTTP ${vURL.status}): ${artigo.titulo_original} (${artigo.fonte})`);
      descartados++;
      return null;
    }
    let imagem = extrairImagem(await buscarHTML(artigo.url));
    if (imagem && deveDescartar(await validarURL(imagem))) {
      imagem = null;
      imagensDescartadas++;
    }
    console.log(`  ✓ [${artigo.lista} ${artigo.posicao}] ${artigo.titulo_original} (${artigo.fonte}) ${imagem ? '✓ img' : '✗ sem img'}`);
    return [artigo.id, imagem];
  });
  const imagemPorId = new Map(resultadoValidacao.filter(Boolean));
  const validadosPorLista = Object.fromEntries(
    LISTAS_CURADORIA.map((l) => [
      l,
      selecionadosPorLista[l].filter((s) => imagemPorId.has(s.id)).map((s) => ({ ...s, imagem: imagemPorId.get(s.id) })),
    ]),
  );
  console.log(`Válidos: ${imagemPorId.size}/${unicos.length} | descartados: ${descartados} | imagens removidas: ${imagensDescartadas}`);
  if (validadosPorLista.geral.length === 0) {
    throw new Error('Todos os artigos da versão geral foram descartados na validação. Verifique o WF-01.');
  }
  if (validadosPorLista.geral.length < 3) {
    console.log(`⚠️ ALERTA: só ${validadosPorLista.geral.length} artigos gerais válidos (precisa de 3).`);
  }

  const distribuicao = distribuirArtigos(validadosPorLista);
  // Cada artigo usado vira um objeto só (o segmento que reaproveita a reserva
  // geral ou as notícias Brasil compartilhadas apontam pro mesmo objeto), pra
  // imagem e título serem resolvidos uma vez.
  const usadosPorId = new Map();
  const registrar = (a) => {
    if (!usadosPorId.has(a.id)) usadosPorId.set(a.id, { ...a });
    return usadosPorId.get(a.id);
  };
  const geral = distribuicao.geral.map(registrar);
  const brasil = distribuicao.brasil.map(registrar);
  const segmentos = Object.fromEntries(SEGMENTOS.map((s) => [s, distribuicao.segmentos[s].map(registrar)]));
  const usados = [...usadosPorId.values()];
  console.log(`Distribuição: geral ${geral.length} | brasil ${brasil.length} | ${SEGMENTOS.map((s) => `${s} ${segmentos[s].length}`).join(' | ')}`);

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

  // ─── Imagens que precisam sair pro nosso domínio ───
  // Imagem em CDN compartilhado → baixa e re-hospeda em public/generated/,
  // servido por raw.githubusercontent.com (ver lib/rehost.js), num único
  // commit. Só os artigos que entram em alguma versão (reservas não usadas
  // ficam de fora). O nome do arquivo carrega o número da edição e o id do
  // artigo de propósito: e-mail já enviado aponta pra essa URL pra sempre,
  // então nome não pode ser reusado.
  //
  // nov/2026: a geração de imagem pelo Gemini saiu (decisão do Yago). Artigo
  // sem imagem própria válida sai sem imagem (o template omite o bloco).
  const arquivos = [];
  const semImagem = usados.filter((a) => !a.imagem);
  if (semImagem.length > 0) {
    console.log(`\n⚠️ ${semImagem.length} artigo(s) sem imagem própria; saem sem imagem: ${semImagem.map((a) => a.titulo_original).join(' | ')}`);
  }

  // Re-hospedagem: cobre os artigos usados e o destaque do blog. O blog é
  // o caso comum, porque lets.com.br/blog roda em Webflow e tanto a og:image
  // do post quanto o FALLBACK_BLOG_IMG saem do CDN deles. Holder da imagem do
  // blog: resolve o fallback ANTES da re-hospedagem, senão o caminho "scraping
  // do blog falhou" escaparia com a URL do Webflow do FALLBACK_BLOG_IMG intacta.
  const blogImg = { imagem: blogRaw?.imagem || FALLBACK_BLOG_IMG };

  const candidatosRehost = [
    ...usados
      .filter((a) => precisaRehospedar(a.imagem))
      .map((a) => ({ alvo: a, nome: `ed${edicaoAtual}-a${a.id}-rehost`, rotulo: `[${a.lista} ${a.posicao}] artigo` })),
    ...(precisaRehospedar(blogImg.imagem)
      ? [{ alvo: blogImg, nome: `ed${edicaoAtual}-blog`, rotulo: '[blog] destaque' }]
      : []),
  ];
  if (candidatosRehost.length > 0) {
    console.log(`\nRe-hospedando ${candidatosRehost.length} imagem(ns) de CDN compartilhado...`);
    for (const { alvo, nome, rotulo } of candidatosRehost) {
      const origem = alvo.imagem;
      try {
        const { buffer, ext } = await baixarImagem(origem);
        arquivos.push({
          nomeArquivo: `${nome}.${ext}`,
          buffer,
          aplicar: (url) => {
            alvo.imagem = url;
            if (alvo === blogImg && blogRaw) blogRaw.imagem = url;
          },
          rotulo: `${rotulo} re-hospedado`,
        });
      } catch (e) {
        // Degrada pro comportamento antigo: mantém a URL original. Score de
        // spam pior é melhor do que edição sem imagem.
        console.log(`  ⚠️ ${rotulo}: falha ao baixar (${e.message}). Mantendo URL original.`);
      }
    }
  }

  if (arquivos.length > 0) {
    const urls = commitarImagensGeradas(
      arquivos,
      `chore: imagens da edição ${edicaoAtual} (${arquivos.length} arquivo(s))`,
    );
    for (const { nomeArquivo, aplicar, rotulo } of arquivos) {
      aplicar(urls[nomeArquivo]);
      console.log(`  ${rotulo}: ${urls[nomeArquivo]}`);
    }
  }

  // Composição das versões (ids; o blog entra como item próprio).
  const BLOG = { tipo: 'blog' };
  const composicoes = [
    { versao: 'geral', descricao: 'versão geral, todos os leitores', itens: [BLOG, ...geral], segmento: null },
    ...SEGMENTOS.map((s) => {
      const [s1, s2] = segmentos[s];
      const itens = [s1, BLOG, s2, ...brasil].filter(Boolean);
      return { versao: s, descricao: `clientes de ${NOME_SEGMENTO[s]}`, itens, segmento: s };
    }),
  ];
  const completas = composicoes.filter((c) => c.segmento === null || c.itens.length >= ITENS_VERSAO_SEGMENTADA);
  composicoes
    .filter((c) => !completas.includes(c))
    .forEach((c) => console.log(`⚠️ Versão ${c.versao} com só ${c.itens.length} itens (mínimo ${ITENS_VERSAO_SEGMENTADA}): fica incompleta e o WF-03 não cria o rascunho dela.`));

  // "Preparar Redação" + "Claude API - Redação". score/justificativa/posicao
  // são metadado interno da curadoria — a redação não usa e seriam só tokens
  // de input desperdiçados.
  const paraRedacao = usados.map(({ id, titulo_original, fonte, data, categoria, tema }) => ({ id, titulo_original, fonte, data, categoria, tema }));
  const chavesVersoes = completas.map((c) => c.versao);
  const textoRedacao = await chamarClaude(promptRedacao(paraRedacao, completas, blogRaw), {
    maxTokens: 12000,
    schema: schemaRedacao(chavesVersoes),
  });
  let redacao;
  try {
    redacao = JSON.parse(repairJSON(textoRedacao));
  } catch (e) {
    throw new Error('Falha ao parsear JSON da redação: ' + e.message);
  }
  const faltando = ['artigos', 'blog', 'versoes', 'cta_final'].filter((c) => !redacao[c]);
  if (faltando.length > 0) throw new Error(`Campos faltando: ${faltando.join(', ')}`);
  if (!redacao.versoes.geral?.titulo_edicao) throw new Error('Redação sem titulo_edicao da versão geral');

  // Título de cada artigo. url/fonte/imagem nunca vêm da IA (só o id), então
  // não há URL inventada pra corrigir. Artigo sem título → chamada avulsa.
  const tituloPorId = new Map((redacao.artigos || []).filter((a) => a.titulo).map((a) => [a.id, a]));
  const mapaResumos = Object.fromEntries(artigos.map((a) => [a.id, a.resumo]));
  for (const artigo of usados) {
    let escrito = tituloPorId.get(artigo.id);
    if (!escrito) {
      try {
        const texto = await chamarClaude(promptArtigoAvulso(artigo, mapaResumos[artigo.id]), { maxTokens: 1500, schema: SCHEMA_ARTIGO_AVULSO });
        escrito = JSON.parse(repairJSON(texto));
        console.log(`⚠️ Título completado em código (IA deixou vaga): ${artigo.titulo_original} (${artigo.fonte})`);
      } catch (e) {
        console.log(`⚠️ Falha ao gerar título avulso pra "${artigo.titulo_original}" (${e.message}); artigo sai das versões.`);
        artigo.semTitulo = true;
        continue;
      }
    }
    artigo.tituloFinal = escrito.titulo;
    // Notícias Brasil levam o rótulo fixo do exemplo aprovado ("Brasil · Regulação").
    artigo.categoriaFinal = artigo.lista === 'brasil'
      ? `Brasil · ${ROTULO_TEMA_BRASIL[artigo.tema] || artigo.tema}`
      : escrito.categoria || artigo.tema || 'Notícia';
  }

  // Blog: garante fallback de imagem/url mesmo se a extração falhar.
  const blogFinal = {
    tipo: 'blog',
    categoria: redacao.blog.categoria || 'Blog Lets',
    titulo: redacao.blog.titulo,
    url: blogRaw?.url || 'https://www.lets.com.br/blog',
    fonte: 'Blog Lets',
    imagem: blogImg.imagem,
  };
  const itemFinal = (it) => (it.tipo === 'blog'
    ? blogFinal
    : { tipo: 'noticia', categoria: it.categoriaFinal, titulo: it.tituloFinal, url: it.url, fonte: it.fonte, imagem: it.imagem });

  const agora = new Date().toISOString();
  const linhasVersoes = [];
  let geralItens = null;
  let geralTexto = null;
  for (const c of composicoes) {
    const itens = c.itens.filter((it) => it.tipo === 'blog' || !it.semTitulo).map(itemFinal);
    const texto = redacao.versoes[c.versao] || {};
    const minimo = c.segmento ? ITENS_VERSAO_SEGMENTADA : 2;
    const status = itens.length >= minimo && texto.titulo_edicao ? 'pronto' : 'incompleta';
    if (texto.titulo_edicao && texto.titulo_edicao.length > 65) {
      console.log(`⚠️ [${c.versao}] título com ${texto.titulo_edicao.length} chars (alvo: até 45, ou 65 no contraste). O Gmail no celular corta em ~33.`);
    }
    if (c.versao === 'geral') {
      geralItens = itens;
      geralTexto = texto;
      // As duas versões gerais têm o mesmo conteúdo, assunto e pré-header
      // (muda só o rodapé, no WF-03).
      for (const versao of ['geral_comercial', 'geral_clientes']) {
        linhasVersoes.push({ edicao: edicaoAtual, versao, titulo_edicao: texto.titulo_edicao, pre_header: texto.pre_header, json_itens: JSON.stringify(itens), status, gerado_em: agora });
      }
    } else {
      linhasVersoes.push({ edicao: edicaoAtual, versao: c.versao, titulo_edicao: texto.titulo_edicao || '', pre_header: texto.pre_header || '', json_itens: JSON.stringify(itens), status, gerado_em: agora });
    }
  }

  console.log(`\n✓ Edição ${edicaoAtual} gerada:`);
  for (const l of linhasVersoes) {
    console.log(`  ${l.versao.padEnd(16)} ${l.status.padEnd(10)} ${JSON.parse(l.json_itens).length} itens  "${l.titulo_edicao}"`);
  }

  // "Salvar Edição" (upsert por edicao). A tabela edicoes continua com a
  // versão geral no formato de sempre (json_artigos_principais sem o blog,
  // json_blog à parte). json_artigos_cards fica sem uso desde jul/2026 —
  // mantido só pra não exigir migração destrutiva de coluna.
  const linha = {
    edicao: edicaoAtual,
    titulo_edicao: geralTexto.titulo_edicao,
    pre_header: geralTexto.pre_header,
    json_artigos_principais: JSON.stringify(geralItens.filter((i) => i.tipo !== 'blog')),
    json_artigos_cards: JSON.stringify([]),
    json_blog: JSON.stringify(blogFinal),
    json_cta: JSON.stringify(redacao.cta_final),
    status: 'pronto_envio_com_imagens',
    gerado_em: agora,
  };
  const res = await upsertLinhas(config.abaEdicoes, [linha], 'edicao');
  const resV = await upsertLinhas(config.abaVersoes, linhasVersoes, ['edicao', 'versao']);
  console.log(`✓ Salvo: ${config.abaEdicoes} (${res.inseridos} inseridos, ${res.atualizados} atualizados), ${config.abaVersoes} (${resV.inseridos} inseridos, ${resV.atualizados} atualizados).`);
  commitarBanco(`chore: WF-02 curadoria e redação edição ${edicaoAtual}`);
}

main().catch((e) => {
  console.error('✗ WF-02 falhou:', e);
  process.exit(1);
});
