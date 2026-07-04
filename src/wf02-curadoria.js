// ════════════════════════════════════════════════════════════
// WF-02 — Curadoria + Redação (porte fiel do PROD-WF-02.json)
// Fluxo: Definir Edição → Ler Artigos → Filtrar Edição →
//   Curadoria (Claude) → Buscar HTML/Extrair Imagem →
//   Validar URLs Vivas → Redação (Claude) → Parse + Validar URLs →
//   Salvar Edição
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerAba, upsertLinhas } from './lib/store.js';
import { chamarClaude } from './lib/claude.js';
import { repairJSON } from './lib/repair.js';
import { gerarImagemPorTema } from './lib/imagegen.js';
import { commitarImagensGeradas } from './lib/gitAssets.js';

const DIACRITICOS = new RegExp('[̀-ͯ]', 'g');
const removerAcentos = (s) => s.normalize('NFD').replace(DIACRITICOS, '');
const slugify = (s) => removerAcentos(s || 'geral').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ─── Buscar HTML do Artigo (GET, tolerante a falha, timeout 15s) ─
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

Avalie cada artigo e selecione os 9 mais relevantes seguindo:
1. RELEVÂNCIA PRA OPERAÇÃO DE CAMPO (40%): o artigo fala de TCO, RAC2/compliance e laudos, manutenção preventiva vs corretiva, gestão de frota em operação severa, ou de algum dos setores prioritários/secundários acima?
2. ATUALIDADE (20%): Quanto mais recente, melhor
3. AUTORIDADE DA FONTE (20%): Fontes especializadas valem mais
4. ACIONABILIDADE (20%): O leitor (gestor de frota, coordenador de campo, engenheiro de campo) pode fazer algo com a informação na operação dele?

Descarte: conteúdo promocional, cases de concorrente direta, notícias internacionais sem relevância pro Brasil, conteúdo genérico de RH/carreira/mobilidade urbana sem relação com operação de campo, e qualquer artigo com foco central em preço (promoção, desconto, "mais barato").

REGRA DE DIVERSIDADE DE FONTE: no máximo 2 matérias da mesma fonte entre as 9 escolhidas. Esta regra é ESTRITA e vale pro conjunto inteiro (incluindo as reservas) — nunca escolha uma 3ª matéria da mesma fonte só porque ela também é relevante; prefira uma matéria de outra fonte, mesmo com score um pouco menor.

REGRA DE DIVERSIDADE DE TEMA (CRÍTICA): cada artigo tem um campo "tema". Entre os 9 selecionados, NÃO concentre num único tema. Distribua entre temas diferentes (Eletrificacao, Regulacao, Tecnologia, Mercado, RenovacaoFrota, Custos, Logistica, OperacaoCampo, Outros). O ideal é que os 3 PRINCIPAIS (top 3 por score) sejam de 3 temas DISTINTOS entre si. Se houver muitos artigos do mesmo tema, escolha o melhor de cada tema antes de repetir tema. Variedade temática é mais importante que pequenas diferenças de score. Ao empatar em score, prefira o artigo de tema OperacaoCampo ou Regulacao (mais alinhado ao ICP de operação de campo/compliance) sobre temas genéricos de mercado.

IMPORTANTE: ordene os 9 selecionados pelo score (do maior pro menor), MAS respeitando a diversidade de tema nos 3 primeiros. Atribua scores diferenciados. As posições 6, 7 e 8 (as três últimas) são reserva (backup) — coloque aí os 3 melhores artigos que sobrarem (de fontes/temas ainda dentro do limite de diversidade), caso algum dos 6 primeiros (principais + cards) seja descartado depois por falha de link.

Retorne APENAS JSON válido (sem markdown), ordenado por score decrescente:
{"selecionados": [{"titulo_original": "...", "url": "...", "fonte": "...", "data": "...", "tema": "...", "score": 0-10, "justificativa": "...", "categoria": "Análise|Renovação de frota|Regulação|Tecnologia|Carbono|Sazonalidade|Mercado"}]}

ARTIGOS:
${JSON.stringify(artigos, null, 2)}`;
}

function promptRedacao(selecionados) {
  return `Você é o redator-chefe da newsletter 'Let's Insights', uma publicação semanal B2B da Let's (gestão de frotas do Grupo Águia Branca) voltada para gestores de frota, coordenadores de campo, QSMS, engenheiros de campo e diretores de operações de empresas com frotas 4x4 em operação de campo (Engenharia/Geotecnia, Mineração, Meio Ambiente, Concessão de Rodovias, Obras/Montagem Industrial, Florestal/Celulose, Infraestrutura, Siderurgia).

TOM DE VOZ (guia oficial da marca, siga à risca):
- Técnico, direto e confiável: fale como especialista de operação conversando com outro especialista de operação, nunca como vendedor.
- Profissional sem ser formal demais, sem jargão de marketing.
- Sempre traga a camada "e o que isso significa pra sua operação?" (impacto prático em campo, não abstrato).
- NUNCA prometa o que não pode entregar.
- NUNCA use superlativo vazio ("melhor", "líder", "número 1") nem linguagem de venda genérica (ex: "5 vantagens de...", "temos a solução perfeita pra sua empresa!").
- NUNCA fale de preço antes de falar de operação. Preço não é gancho de manchete nem de resumo.
- NUNCA use travessão (—).
- Exemplos de tom certo: "Como calcular o TCO real de uma frota 4x4 em operação de campo", "RAC2: o que é e por que seu veículo precisa estar em conformidade", "Um laudo vencido pode parar sua equipe inteira".
- Exemplos de tom errado (evite): "5 vantagens de terceirizar veículos", "Temos a solução perfeita pra sua empresa!", qualquer superlativo ou foco em preço.

REGRAS DE COPYRIGHT (CRÍTICO): NUNCA copie trechos literais. SEMPRE parafraseie. Cite a fonte ao final.

REGRA DE DIVERSIDADE EDITORIAL (CRÍTICA): ao escolher os 3 principais e até 3 cards, garanta que NO MÁXIMO 2 sejam da mesma fonte. Distribua entre as fontes disponíveis.

REGRA DE DIVERSIDADE DE TEMA (CRÍTICA): cada artigo tem um campo "tema". Os 3 PRINCIPAIS devem ser de 3 temas DISTINTOS entre si (nunca 2 principais do mesmo tema). Nos CARDS, no MÁXIMO 1 card por tema (nunca 2 cards do mesmo tema). Se receber muitos artigos do mesmo tema, use o melhor como principal ou card e descarte os demais repetidos de tema, preferindo variedade. Variedade temática é mais importante que pequenas diferenças de score.

REGRA CRÍTICA DE INTEGRIDADE DE DADOS: você DEVE preservar EXATAMENTE como recebidos os campos url, fonte e imagem de cada artigo. NUNCA invente, modifique, encurte ou abrevie URLs. NUNCA troque URLs entre artigos. Esta regra é INVIOLÁVEL.

Você vai receber uma lista de artigos JÁ validados (link e imagem conferidos), ordenados por score (do maior pro menor). IMPORTANTE: nem sempre a lista terá 9 artigos — alguns dos que a curadoria escolheu podem ter sido descartados nessa validação por link morto ou erro temporário do site de origem, então você pode receber menos itens do que o esperado. NUNCA invente um artigo pra completar uma quantidade "ideal": use só o que está na lista.

Trate a lista recebida assim, respeitando as regras de diversidade de fonte/tema acima na hora de escolher quem vai em cada grupo:

GRUPO 1 - ARTIGOS PRINCIPAIS: escolha os 3 melhores artigos da lista pra esse grupo (destaque editorial).
Para CADA artigo principal, gere:
- categoria (1-2 palavras, ex: "Análise", "Pesados", "Leves", "Regulação", "Renovação de frota")
- subtitulo (1 palavra/curto identificando o tema, ex: "Pesados", "Leves", "Regulação")
- resumo (parafraseado, máx 50 palavras, traz contexto + dado/insight principal)
- MANTENHA url, fonte e imagem EXATAMENTE como vieram

GRUPO 2 - CARDS: dos artigos que sobraram (não usados como principal), use até 3 como cards menores no grid. Se sobrarem mais de 3, os excedentes são reserva e devem ser IGNORADOS (não aparecem na edição). Se sobrar menos de 3, gere só os cards que existirem — não invente um a mais.
Para CADA card, gere:
- categoria (1 palavra, ex: "Telemetria", "Carbono", "Sazonalidade")
- resumo (parafraseado, máx 25 palavras, frase única e direta)
- MANTENHA url, fonte e imagem EXATAMENTE como vieram

Gere também:

1. TÍTULO DA EDIÇÃO no formato OBRIGATÓRIO: "Let's Insights · [destaque]"
   - Destaque: máx 40 caracteres, verbo de ação ou novidade concreta
   - NUNCA omita o prefixo "Let's Insights · "
   - Use "·" (ponto médio U+00B7), nunca hífen

2. PRÉ-HEADER (máx 90 caracteres, vira preview no inbox)

3. CTA_FINAL (chamada pra falar com especialista Let's)
   - titulo (pergunta provocativa ligada a um problema de operação de campo, ex: manutenção corretiva, laudo/RAC2 vencido, veículo parado em campo; NUNCA sobre preço, máx 60 chars)
   - texto (2 frases sobre a operação: veículo pronto pra operar, consultor dedicado, documentação/laudos resolvidos; sem falar de preço)
   - botao (texto do botão, ex: "FALAR COM ESPECIALISTA")

Retorne APENAS JSON válido (sem markdown):
{
  "titulo_edicao": "...",
  "pre_header": "...",
  "artigos_principais": [
    {"categoria": "...", "subtitulo": "...", "resumo": "...", "url": "...", "fonte": "...", "imagem": "..."}
  ],
  "artigos_cards": [
    {"categoria": "...", "resumo": "...", "url": "...", "fonte": "...", "imagem": "..."}
  ],
  "cta_final": {"titulo": "...", "texto": "...", "botao": "..."}
}

ARTIGOS (ordenados por score):
${JSON.stringify(selecionados, null, 2)}`;
}

// ─── Orquestração ────────────────────────────────────────────
async function main() {
  requireEnv(['SHEETS_DOC_ID', 'ANTHROPIC_API_KEY']);

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
  if (dessaEdicao.length < 7) {
    console.log(`⚠️ Apenas ${dessaEdicao.length} artigos disponíveis (esperado 7). Newsletter pode ficar incompleta.`);
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
  const textoCuradoria = await chamarClaude(promptCuradoria(artigos), { maxTokens: 4000 });
  let dadosCuradoria;
  try {
    dadosCuradoria = JSON.parse(repairJSON(textoCuradoria));
  } catch (e) {
    throw new Error('Falha ao parsear JSON da curadoria: ' + e.message);
  }
  if (!dadosCuradoria.selecionados || !Array.isArray(dadosCuradoria.selecionados)) {
    throw new Error('JSON da curadoria inválido');
  }
  // A regra "máx 2 por fonte" é só pedida no prompt — a IA já violou isso na
  // prática (3 artigos da mesma fonte), o que desperdiça vaga de backup rio
  // abaixo (a redação descarta o excedente depois de já ter "gasto" o slot).
  // Reforça em código, mantendo a ordem por score (mais alto primeiro).
  const MAX_POR_FONTE_CURADORIA = 2;
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
  const selecionados = semExcessoDeFonte.map((art, idx) => ({ ...art, posicao: idx }));
  console.log(`Curadoria: ${selecionados.length} artigos selecionados`);

  // "Buscar HTML do Artigo" + "Extrair Imagem"
  const comImagem = [];
  for (let idx = 0; idx < selecionados.length; idx++) {
    const original = selecionados[idx];
    const tipo = idx < 3 ? 'PRINCIPAL' : idx < 6 ? 'CARD' : 'BACKUP';
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
  if (validados.length < 6) {
    console.log(`⚠️ ALERTA: só ${validados.length} artigos válidos (precisa de 6: 3 principais + 3 cards).`);
  }
  if (validados.length === 0) {
    throw new Error('Todos os artigos foram descartados na validação. Verifique o WF-01.');
  }

  // "Gerar Imagem Fallback (IA)": artigos sem imagem válida entre os 6 "reais"
  // (posições 0-5; 6 e 7 são backup e nunca entram na edição) recebem imagem
  // gerada via Gemini, hospedada no próprio repo (raw.githubusercontent.com).
  const semImagem = validados.filter((a) => !a.imagem && a.posicao < 6);
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
  const textoRedacao = await chamarClaude(promptRedacao(validados), { maxTokens: 4000 });
  let edicao;
  try {
    edicao = JSON.parse(repairJSON(textoRedacao));
  } catch (e) {
    throw new Error('Falha ao parsear JSON da redação: ' + e.message);
  }

  // "Parse Edição Final + Validar URLs"
  const obrigatorios = ['titulo_edicao', 'pre_header', 'artigos_principais', 'artigos_cards', 'cta_final'];
  const faltando = obrigatorios.filter((c) => !edicao[c]);
  if (faltando.length > 0) throw new Error(`Campos faltando: ${faltando.join(', ')}`);
  if (!Array.isArray(edicao.artigos_principais) || edicao.artigos_principais.length === 0) {
    throw new Error('artigos_principais inválido ou vazio');
  }
  if (!Array.isArray(edicao.artigos_cards)) throw new Error('artigos_cards inválido');

  // Integridade de URL: corrige URL/fonte/imagem caso a IA tenha inventado.
  const mapaOriginal = {};
  validados.forEach((s) => (mapaOriginal[s.url] = { url: s.url, fonte: s.fonte, imagem: s.imagem }));
  const validarArtigo = (artIA, posEsperada, tipo) => {
    const urlIA = artIA.url || '';
    if (mapaOriginal[urlIA]) {
      const o = mapaOriginal[urlIA];
      return { ...artIA, url: o.url, fonte: o.fonte, imagem: o.imagem };
    }
    if (validados[posEsperada]) {
      const o = validados[posEsperada];
      console.log(`⚠️ URL corrigida (${tipo} pos ${posEsperada}): IA inventou, usando original`);
      return { ...artIA, url: o.url, fonte: o.fonte, imagem: o.imagem };
    }
    return artIA;
  };
  const principais = edicao.artigos_principais.map((a, idx) => validarArtigo(a, idx, 'PRINCIPAL'));
  const cards = edicao.artigos_cards.map((a, idx) => validarArtigo(a, idx + 3, 'CARD'));

  console.log(`✓ Edição ${edicaoAtual} gerada: "${edicao.titulo_edicao}"`);
  console.log(`Principais: ${principais.length} | Cards: ${cards.length}`);

  // "Salvar Edição" (upsert por edicao)
  const linha = {
    edicao: edicaoAtual,
    titulo_edicao: edicao.titulo_edicao,
    pre_header: edicao.pre_header,
    json_artigos_principais: JSON.stringify(principais),
    json_artigos_cards: JSON.stringify(cards),
    json_cta: JSON.stringify(edicao.cta_final),
    status: 'pronto_envio_com_imagens',
    gerado_em: new Date().toISOString(),
  };
  const res = await upsertLinhas(config.abaEdicoes, [linha], 'edicao');
  console.log(`✓ Salvo na aba ${config.abaEdicoes}: ${res.inseridos} inseridos, ${res.atualizados} atualizados.`);
}

main().catch((e) => {
  console.error('✗ WF-02 falhou:', e);
  process.exit(1);
});
