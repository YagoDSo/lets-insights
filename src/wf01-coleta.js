// ════════════════════════════════════════════════════════════
// WF-01 — Coleta (porte fiel do PROD-WF-01.json do N8N)
// Fluxo: Ler Edicoes → Config Edição → [9 RSS] → Padronizar →
//   Calcular Idade → Filtrar Palavras-Chave → Deduplicar →
//   Filtrar Concorrentes → Enriquecer e Limitar → Salvar
// ════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import { config, requireEnv } from './lib/config.js';
import { lerFeeds } from './lib/rss.js';
import { lerAba, upsertLinhas } from './lib/store.js';
import { chamarClaudeComWebSearch } from './lib/claude.js';
import { repairJSON } from './lib/repair.js';

// Feeds RSS. Base original (PROD-WF-01) + expansão pro ICP de operação de
// campo (jul/2026): cada URL abaixo foi validada manualmente (200 + XML de
// RSS real com itens recentes) antes de entrar aqui — ver relato da sessão
// que adicionou os feeds de mineração/geotecnia/ambiente/infra/siderurgia.
// `valorinveste.globo.com/rss/` foi removido: descontinuado pela Globo (404
// em toda variação de path testada, sem link de feed na homepage).
const FEEDS = [
  // Base original (frota/transporte/logística/economia)
  { url: 'https://frotacia.com.br/feed/' },
  { url: 'https://transportemoderno.com.br/feed/' },
  { url: 'https://diariodotransporte.com.br/feed/' },
  { url: 'https://logweb.com.br/feed/' },
  { url: 'https://neofeed.com.br/feed/' },
  { url: 'https://braziljournal.com/feed/' },
  { url: 'https://mobilidade.estadao.com.br/feed/' },
  { url: 'https://exame.com/feed/' },
  // Mineração
  { url: 'https://brasilmineral.com.br/rss.xml' },
  { url: 'https://ibram.org.br/feed/' },
  // Meio ambiente
  { url: 'https://oeco.org.br/feed/' },
  // Florestal / celulose
  { url: 'https://iba.org/feed/' },
  // Concessão de rodovias / infraestrutura
  { url: 'https://abcr.org.br/feed/' },
  // Indústria ferroviária (infraestrutura/logística adjacente)
  { url: 'https://abifer.org.br/feed/' },
  // Logística / transporte rodoviário de carga B2B
  { url: 'https://logisticanobrasil.com.br/feed' },
  { url: 'https://ocarreteiro.com.br/feed/' },
  { url: 'https://cargapesada.com.br/feed/' },
];

// Normaliza texto: minúsculas + remove acentos. Usado nos filtros e no classificador.
const normalizar = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// ─── Busca web (Claude API, tool nativa "web_search") ────────
// Complementa os 9 feeds RSS fixos: busca mais amplamente pela internet por
// notícias alinhadas ao ICP da Let's, sempre limitando a artigos publicados
// nos últimos N dias. Roda em paralelo aos RSS; os resultados entram no MESMO
// pipeline de filtros (relevância, dedup, concorrentes) — não é uma via separada.
const TEMAS_BUSCA_ICP = [
  'gestão de frota corporativa notícias Brasil',
  'TCO custo total de propriedade frota de veículos Brasil',
  'RAC2 laudo de vistoria veicular compliance frota',
  'mineração frota de veículos pickup 4x4 Brasil',
  'geotecnia frota veículos operação de campo',
  'meio ambiente licenciamento ambiental frota veículos',
  'obras infraestrutura concessão de rodovias frota veículos',
];

async function buscarArtigosWeb(diasJanela = 7) {
  const hoje = new Date().toISOString().substring(0, 10);
  const prompt = `Data de referência (hoje): ${hoje}. Você tem acesso a uma ferramenta de busca na web.

Pesquise notícias em português, de fontes brasileiras (portais de notícias, imprensa especializada em logística/frotas/mineração/infraestrutura/meio ambiente), sobre estes temas:
${TEMAS_BUSCA_ICP.map((q, i) => `${i + 1}. ${q}`).join('\n')}

REGRA CRÍTICA DE DATA: só inclua um artigo se você conseguir identificar com confiança a data de publicação dele E essa data estiver dentro dos últimos ${diasJanela} dias corridos contados a partir de ${hoje}. Se não conseguir confirmar a data de publicação, DESCARTE o resultado — nunca estime ou invente uma data.

Não inclua: releases institucionais sem valor de notícia, posts de rede social, fóruns, páginas sem data verificável, ou resultados de fontes que não sejam veículos de imprensa/portais especializados.

Para cada artigo aprovado, retorne um objeto com estes campos exatos:
- titulo: título do artigo, como publicado (não traduza)
- url: URL completa e real do artigo (nunca invente uma URL)
- data: data de publicação, formato YYYY-MM-DD
- resumo: resumo de até 400 caracteres do conteúdo do artigo
- fonte: nome do veículo/portal que publicou

Sua resposta final deve conter SOMENTE o array JSON — nenhuma frase de introdução, explicação ou conclusão antes ou depois, mesmo que o array esteja vazio: []`;

  try {
    const { texto, buscasRealizadas } = await chamarClaudeComWebSearch(prompt, {
      maxTokens: 8000,
      maxBuscas: 15,
    });
    console.log(`Busca web: ${buscasRealizadas} buscas realizadas pela IA`);
    // O modelo às vezes explica antes/depois do array mesmo sendo instruído a não
    // fazer isso; extrai só o trecho entre o primeiro '[' e o último ']'.
    const match = texto.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Nenhum array JSON encontrado na resposta');
    const artigos = JSON.parse(repairJSON(match[0]));
    if (!Array.isArray(artigos)) throw new Error('Resposta não é um array JSON');

    const validos = artigos
      .filter((a) => a && a.titulo && a.url)
      .map((a) => ({
        titulo: String(a.titulo).trim(),
        url: a.url,
        data: a.data || hoje,
        resumo: String(a.resumo || '')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 500),
        fonte: a.fonte || 'Busca web',
        _origem: 'busca_web',
      }));
    console.log(`Busca web: ${validos.length} artigos retornados (antes dos filtros de relevância/dedup)`);
    return validos;
  } catch (e) {
    console.log(`⚠️ Busca web falhou (${e.message}). Seguindo só com RSS.`);
    return [];
  }
}

// brasilmineral.com.br usa um formato de data não-padrão que o rss-parser não
// reconhece ("Fri, 07/03/2026 - 15:16", ou seja MM/DD/AAAA - HH:MM, confirmado
// batendo o dia da semana com a data). Sem isso, calcularIdade() descartaria
// esses artigos (idade_dias cai no fallback 999 > corte de 60 dias).
function corrigirDataBrasilMineral(str) {
  const m = String(str || '').match(/(\d{2})\/(\d{2})\/(\d{4}) - (\d{2}):(\d{2})/);
  if (!m) return str;
  const [, mm, dd, aaaa, hh, min] = m;
  return `${aaaa}-${mm}-${dd}T${hh}:${min}:00`;
}

// ─── Nó "Padronizar Estrutura" ───────────────────────────────
function padronizar(itens) {
  const validos = itens.filter((it) => it && it.title && it.link);
  const padronizados = validos.map((it) => {
    let fonte = 'Portal especializado';
    const url = it.link || '';
    if (url.includes('frotacia.com.br')) fonte = 'Frota&Cia';
    else if (url.includes('transportemoderno.com.br')) fonte = 'Transporte Moderno';
    else if (url.includes('diariodotransporte.com.br')) fonte = 'Diário do Transporte';
    else if (url.includes('logweb.com.br')) fonte = 'Logweb';
    else if (url.includes('neofeed.com.br')) fonte = 'NeoFeed';
    else if (url.includes('braziljournal.com')) fonte = 'Brazil Journal';
    else if (url.includes('mobilidade.estadao.com.br')) fonte = 'Mobilidade Estadão';
    else if (url.includes('valorinveste.globo.com') || url.includes('valor.globo.com'))
      fonte = 'Valor Econômico';
    else if (url.includes('exame.com')) fonte = 'Exame';
    else if (url.includes('brasilmineral.com.br')) fonte = 'Brasil Mineral';
    else if (url.includes('ibram.org.br')) fonte = 'IBRAM';
    else if (url.includes('oeco.org.br')) fonte = '(o)eco';
    else if (url.includes('iba.org')) fonte = 'IBÁ';
    else if (url.includes('abcr.org.br') || url.includes('melhoresrodovias.org.br')) fonte = 'ABCR';
    else if (url.includes('abifer.org.br')) fonte = 'ABIFER';
    else if (url.includes('logisticanobrasil.com.br')) fonte = 'Logística no Brasil';
    else if (url.includes('ocarreteiro.com.br')) fonte = 'O Carreteiro';
    else if (url.includes('cargapesada.com.br')) fonte = 'Carga Pesada';
    else if (it.creator) fonte = it.creator;

    const dataBruta = it.pubDate || it.isoDate || new Date().toISOString();

    return {
      titulo: (it.title || '').trim(),
      url,
      data: url.includes('brasilmineral.com.br') ? corrigirDataBrasilMineral(dataBruta) : dataBruta,
      resumo: (it.contentSnippet || it.content || it.description || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500),
      fonte,
      _origem: 'rss',
    };
  });

  const dist = {};
  padronizados.forEach((p) => (dist[p.fonte] = (dist[p.fonte] || 0) + 1));
  console.log(`Padronizados: ${padronizados.length} artigos`);
  console.log('Distribuição por fonte:', JSON.stringify(dist));
  return padronizados;
}

// ─── Nó "Calcular Idade" (descarta só >60 dias) ──────────────
function calcularIdade(itens) {
  const agora = new Date();
  const comIdade = itens.map((a) => {
    const dataArtigo = new Date(a.data);
    let idade_dias = 999;
    if (!isNaN(dataArtigo.getTime())) {
      idade_dias = Math.floor((agora - dataArtigo) / (24 * 60 * 60 * 1000));
    }
    return { ...a, idade_dias };
  });
  const validos = comIdade.filter((a) => a.idade_dias <= 60);
  console.log(`Idade calculada: ${validos.length} de ${itens.length}`);
  return validos;
}

// ─── Nó "Filtrar por Palavras-Chave1" (relevância B2B v2) ────
function filtrarRelevancia(itens) {
  const palavrasChave = [
    'terceirização de frota', 'terceirizacao de frota', 'gestão de frota', 'gestao de frota',
    'locação corporativa', 'locacao corporativa', 'locação de veículos', 'locacao de veiculos',
    'fleet management', 'frota empresarial', 'frota corporativa', 'frota leve', 'frota terceirizada',
    'aluguel de carros corporativo', 'aluguel de veículos corporativo', 'leasing operacional',
    'outsourcing automotivo', 'telemetria veicular', 'telemetria', 'rastreamento veicular',
    'rastreamento gps', 'gestão veicular', 'gestao veicular', 'gestão de combustível',
    'gestao de combustivel', 'abastecimento de frota', 'consumo de combustível',
    'manutenção preventiva', 'manutencao preventiva', 'revisão preventiva', 'recall veicular',
    'seguro frota', 'seguro de frota', 'política de uso de veículos', 'car policy',
    'mobilidade corporativa', 'mobilidade elétrica', 'mobilidade eletrica',
    'eletrificação de frota', 'eletrificacao de frota', 'eletrificação da frota',
    'eletrificacao da frota', 'veículos elétricos corporativos', 'ev corporativo',
    'motorista corporativo', 'gestão de transporte', 'gestao de transporte',
    'transporte corporativo', 'transporte executivo', 'logística corporativa',
    'logistica corporativa', 'cadeia de suprimentos', 'supply chain', 'centro de distribuição',
    'centro de distribuicao', 'condomínio logístico', 'condominio logistico', 'descarbonização',
    'descarbonizacao', 'tco', 'custo total de propriedade', 'gestão de ativos', 'asset management',
    'emissão de co2 frota', 'pegada de carbono frota', 'esg frota', 'frota sustentável', 'abla',
    'fenabrave', 'sindipeças', 'sindipecas', 'locadora de veículos', 'locadora de frota',
    // ICP Let's (jul/2026): operação de campo, compliance/RAC2, setores prioritários e dores que ativam
    'rac2', 'laudo de vistoria veicular', 'laudo técnico veicular', 'inspeção veicular',
    'certificado de inspeção veicular', 'manutenção corretiva', 'nr-12', 'nr12', 'qsms',
    'operação de campo', 'terreno adverso', 'pickup 4x4', 'picape 4x4', 'utilitário 4x4',
    'veículo 4x4', 'frota pesada', 'geotecnia', 'geotécnica', 'mineração', 'mineradora',
    'exploração mineral', 'licenciamento ambiental', 'concessão de rodovias',
    'concessionária de rodovias', 'obras de infraestrutura', 'montagem industrial',
    'siderurgia', 'siderúrgica', 'florestal', 'celulose e papel', 'engenharia de campo',
    'coordenador de campo', 'supervisor de obra', 'gestor de frota', 'coordenador de frota',
    'diretor de operações', 'gerente de contratos',
  ];
  const termosGenericos = ['frota', 'frotas', 'logística', 'logistica', 'obra', 'obras', 'campo'];
  const contextoB2B = [
    'empresa', 'corporativ', 'empresarial', 'terceiriz', 'locaç', 'locac', 'gestor', 'gestão',
    'gestao', 'setor', 'mercado', 'indústria', 'veículos', 'veiculos', 'automóv', 'automovel', 'carro',
    'mineradora', 'geotecnia', 'infraestrutura', 'concessionária', 'concessionaria', 'siderúrgica',
    'siderurgica', 'engenharia', 'operação', 'operacao',
  ];
  const palavrasExclusao = [
    'metrô', 'metro sp', 'metro rio', 'metrorj', 'metrorio', 'metrô de sp', 'metrô de são paulo',
    'metrô de bh', 'metrô de fortaleza', 'metrô de recife', 'metrô de brasília', 'cptm',
    'viamobilidade', 'ccr mob', 'ônibus urbano', 'onibus urbano', 'transporte público urbano',
    'transporte publico urbano', 'tarifa de ônibus', 'tarifa de onibus', 'passageiros do metrô',
    'passageiros do metro', 'passageiros urbanos', 'linha 4-amarela', 'linha 4 amarela',
    'linha 5-lilás', 'linha 5 lilas', 'linha 1-azul', 'linha 1 azul', 'linha 2-verde',
    'linha 3-vermelha', 'brt rio', 'brt sp', 'vlt carioca', 'esteira rolante', 'transporte escolar',
    'van escolar', 'escolar', 'aplicativo de transporte', 'app de transporte', 'passes livres',
    'gratuidade', 'meia-passagem', 'meia passagem', 'vale-transporte', 'vale transporte',
    'estação de metrô', 'estacao de metro', 'virada cultural', 'litígio', 'litigio',
    // DESQUALIFICA (ICP Let's, jul/2026): RH/carreira genérico, urbano executivo sem campo, foco em preço, MEI
    'plano de carreira', 'rh estratégico', 'rh estrategico', 'gestão de pessoas', 'gestao de pessoas',
    'employer branding', 'liderança feminina', 'lideranca feminina', 'carro popular', 'carro de passeio',
    'mobilidade individual', 'microempreendedor individual', 'liquidação de veículos',
    'liquidacao de veiculos', 'queima de estoque', 'carro mais barato', 'preço popular', 'preco popular',
  ];
  const termosBlindados = [
    'terceirização', 'terceirizacao', 'fleet', 'gestão de frota corporativa',
    'gestao de frota corporativa', 'mobilidade corporativa', 'locação corporativa',
    'locacao corporativa', 'frota empresarial', 'frota corporativa', 'tco', 'leasing operacional',
  ];

  let descartadosPorExclusao = 0;
  let aprovadosEspecifico = 0;
  let aprovadosGenerico = 0;

  const filtrados = itens.filter((a) => {
    const textoNorm = normalizar((a.titulo || '') + ' ' + (a.resumo || ''));

    const temEspecifico = palavrasChave.some((p) => textoNorm.includes(normalizar(p)));

    let temGenericoComContexto = false;
    if (!temEspecifico) {
      const temGenerico = termosGenericos.some((t) => textoNorm.includes(normalizar(t)));
      if (temGenerico) {
        temGenericoComContexto = contextoB2B.some((ctx) => textoNorm.includes(normalizar(ctx)));
      }
    }

    if (!temEspecifico && !temGenericoComContexto) return false;

    const temExclusao = palavrasExclusao.some((p) => textoNorm.includes(normalizar(p)));
    if (temExclusao) {
      const temBlindado = termosBlindados.some((t) => textoNorm.includes(normalizar(t)));
      if (!temBlindado) {
        descartadosPorExclusao++;
        console.log(`  Descartado (B2C): ${(a.titulo || '').substring(0, 60)}`);
        return false;
      }
    }

    if (temEspecifico) aprovadosEspecifico++;
    else aprovadosGenerico++;
    return true;
  });

  console.log(`Filtro relevância B2B v4 (ICP campo/mineração/compliance): ${filtrados.length} de ${itens.length}`);
  console.log(`  Aprovados por termo específico: ${aprovadosEspecifico}`);
  console.log(`  Aprovados por termo genérico + contexto: ${aprovadosGenerico}`);
  console.log(`  Descartados por conteúdo B2C: ${descartadosPorExclusao}`);
  return filtrados;
}

// ─── Nó "Deduplicar" + ENXERTO: anti-duplicação histórica ────
// (o PROD-WF-01 só dedupava no run; trago o dedup entre edições do outro
//  export, alinhado ao que o CLAUDE.md marca como ideal.)
function deduplicar(itens, urlsHistoricas) {
  const vistos = new Set(urlsHistoricas);
  const tamHistorico = vistos.size;
  const unicos = [];
  for (const a of itens) {
    const chave = (a.url || a.titulo || '').toLowerCase().trim();
    if (chave && !vistos.has(chave)) {
      vistos.add(chave);
      unicos.push(a);
    }
  }
  console.log(`Dedup: ${tamHistorico} no histórico; ${unicos.length} novos de ${itens.length}`);
  return unicos;
}

// ─── Nó "Filtrar Concorrentes" (heurística sem API) ──────────
function filtrarConcorrentes(itens) {
  const CONCORRENTES = [
    'localiza fleet', 'localiza&co', 'localiza frotas', 'localiza co', 'movida frotas',
    'movida gestão de frotas', 'movida gestao de frotas', 'unidas frotas', 'ouro verde locação',
    'ouro verde locacao', 'vamos locação', 'vamos brasil', 'vamos frotas', 'ald automotive',
    'ald brasil', 'arval brasil', 'arval',
  ];
  const PALAVRAS_PROTAGONISMO = [
    'anuncia', 'lança', 'lanca', 'apresenta', 'expande', 'cresce', 'contrata', 'demite', 'abre',
    'fecha', 'assina', 'investe', 'parceria', 'resultado', 'receita', 'faturamento', 'lucro', 'ceo',
    'presidente', 'diretor', 'executivo', 'entrevista', 'estratégia', 'estrategia', 'plano', 'meta',
    'previsão', 'previsao',
  ];

  const aprovados = [];
  const descartados = [];
  for (const a of itens) {
    const titulo = (a.titulo || '').toLowerCase();
    const resumo = (a.resumo || '').toLowerCase();
    const texto = titulo + ' ' + resumo;

    const concorrenteMencionado = CONCORRENTES.find((c) => texto.includes(c));
    if (!concorrenteMencionado) {
      aprovados.push(a);
      continue;
    }
    const concorrenteNoTitulo = CONCORRENTES.some((c) => titulo.includes(c));
    if (concorrenteNoTitulo) {
      descartados.push({ titulo: a.titulo, motivo: `Concorrente no título: "${concorrenteMencionado}"` });
      continue;
    }
    const temProtagonismo = PALAVRAS_PROTAGONISMO.some((p) => {
      const idxC = texto.indexOf(concorrenteMencionado);
      const trecho = texto.substring(Math.max(0, idxC - 50), idxC + 100);
      return trecho.includes(p);
    });
    if (temProtagonismo) {
      descartados.push({ titulo: a.titulo, motivo: `Concorrente protagonista: "${concorrenteMencionado}"` });
      continue;
    }
    aprovados.push(a);
  }

  console.log(`Filtro concorrentes: ${aprovados.length} aprovados, ${descartados.length} descartados de ${itens.length}`);
  descartados.forEach((d) => console.log(`  - ${(d.titulo || '').substring(0, 60)}: ${d.motivo}`));
  return aprovados;
}

// ─── Nó "Enriquecer e Limitar" (janela adaptativa + caps + tema) ─
const TEMAS = {
  Eletrificacao: ['eletric', 'eletrific', 'bateria', 'recarga', 'ev ', 'e-delivery', 'hibrido', 'biometano', 'gnl', 'gas natural', 'descarboniz', 'emissao', 'emissoes', 'co2', 'sustentavel', 'sustentabilidade'],
  Regulacao: ['lei', 'regulament', 'tst', 'tribunal', 'norma', 'fiscal', 'tributa', 'imposto', 'receita federal', 'legisla', 'decreto', 'multa', 'compliance', 'laudo', 'rac2', 'inspecao veicular', 'nr-12', 'nr12', 'qsms', 'licenciamento ambiental'],
  Tecnologia: ['telemetria', 'rastreamento', 'software', 'tms', 'plataforma', 'inteligencia artificial', ' ia ', 'automacao', 'robotica', 'digital', 'app', 'aplicativo', 'dados', 'data center'],
  Mercado: ['mercado', 'venda', 'vendas', 'crescimento', 'investiment', 'aporte', 'aquisicao', 'fusao', 'expansao', 'faturamento', 'receita', 'resultado', 'economia', 'pib'],
  RenovacaoFrota: ['compra', 'adquire', 'incorpora', 'renovacao', 'novos caminhoes', 'amplia frota', 'lote', 'unidades', 'aquisicao de veiculos'],
  Custos: ['custo', 'diesel', 'combustivel', 'preco', 'reajuste', 'tarifa', 'pedagio', 'frete', 'despesa', 'inflacao', 'tco', 'manutencao corretiva', 'manutencao preventiva'],
  Logistica: ['logistica', 'supply chain', 'cadeia de suprimentos', 'armazen', 'cabotagem', 'porto', 'intermodal', 'distribuicao', 'cargas'],
  OperacaoCampo: ['mineracao', 'mineradora', 'geotecnia', 'geotecnica', 'exploracao mineral', 'campo', 'obra', 'obras', 'canteiro', 'infraestrutura', 'siderurgia', 'siderurgica', 'florestal', 'celulose', 'concessao de rodovias', 'montagem industrial', 'engenharia de campo', 'terreno adverso', 'pickup 4x4', 'picape 4x4', '4x4'],
};

function classificarTema(a) {
  const txt = normalizar((a.titulo || '') + ' ' + (a.resumo || ''));
  let melhorTema = 'Outros';
  let maxMatches = 0;
  for (const [tema, palavras] of Object.entries(TEMAS)) {
    const matches = palavras.filter((p) => txt.includes(normalizar(p))).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      melhorTema = tema;
    }
  }
  return melhorTema;
}

function enriquecerELimitar(itens, edicaoAtual) {
  const MAX_TOTAL = 30;
  const MAX_POR_FONTE = 3;
  const MAX_POR_TEMA = 6;
  const ALVO_MINIMO = 15;
  const JANELAS = [7, 14, 21, 30];
  const dataColeta = new Date().toISOString();

  const aplicarCaps = (lista) => {
    const ordenados = [...lista].sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
    const contFonte = {};
    const contTema = {};
    const out = [];
    for (const item of ordenados) {
      const fonte = item.fonte || 'Desconhecido';
      const tema = classificarTema(item);
      contFonte[fonte] = contFonte[fonte] || 0;
      contTema[tema] = contTema[tema] || 0;
      if (contFonte[fonte] < MAX_POR_FONTE && contTema[tema] < MAX_POR_TEMA) {
        out.push({ ...item, _tema: tema });
        contFonte[fonte]++;
        contTema[tema]++;
      }
      if (out.length >= MAX_TOTAL) break;
    }
    return out;
  };

  let janelaUsada = JANELAS[0];
  let balanceados = [];
  for (const janela of JANELAS) {
    const dentro = itens.filter((i) => (i.idade_dias ?? 999) <= janela);
    balanceados = aplicarCaps(dentro);
    janelaUsada = janela;
    console.log(`Janela ${janela}d: ${dentro.length} no período, ${balanceados.length} após caps`);
    if (balanceados.length >= ALVO_MINIMO) break;
  }
  console.log(`Janela final: ${janelaUsada}d com ${balanceados.length} artigos`);

  const enriquecidos = balanceados.map((item) => ({
    edicao: edicaoAtual,
    data_coleta: dataColeta,
    titulo: item.titulo,
    url: item.url,
    fonte: item.fonte,
    data_publicacao: item.data,
    resumo: item.resumo,
    tema: item._tema || 'Outros',
    status: 'coletado',
  }));

  const distFonte = {};
  const distTema = {};
  enriquecidos.forEach((e) => {
    distFonte[e.fonte] = (distFonte[e.fonte] || 0) + 1;
    distTema[e.tema] = (distTema[e.tema] || 0) + 1;
  });
  console.log(`✓ WF-01: ${enriquecidos.length} artigos pra edição ${edicaoAtual} (janela ${janelaUsada}d)`);
  console.log('Distribuição por fonte:', JSON.stringify(distFonte));
  console.log('Distribuição por TEMA:', JSON.stringify(distTema));
  if (enriquecidos.length < 10) console.log(`⚠️ Só ${enriquecidos.length} artigos. WF-02 vai completar.`);
  return enriquecidos;
}

// ─── Orquestração ────────────────────────────────────────────
async function main() {
  requireEnv(['SHEETS_DOC_ID']);

  // "Ler Edicoes": lê toda a aba Artigos_Coletados (numeração + dedup histórico).
  const { rows: historico } = await lerAba(config.abaArtigos);

  // "Config Edição": max(edicao) + 1.
  const numeros = historico
    .map((r) => parseInt(r.edicao))
    .filter((n) => !isNaN(n) && n > 0);
  const edicaoAtual = String(numeros.length > 0 ? Math.max(...numeros) + 1 : 1);
  console.log(`✓ Próxima edição: ${edicaoAtual} (última: ${numeros.length ? Math.max(...numeros) : 'nenhuma'})`);

  // URLs/títulos já coletados, pro dedup histórico.
  const urlsHistoricas = historico
    .map((r) => (r.url || r.titulo || '').toLowerCase().trim())
    .filter(Boolean);

  // [9 RSS] + [Busca Web] → Padronizar → Calcular Idade → Relevância → Dedup → Concorrentes → Enriquecer
  // Híbrido: RSS continua sendo a fonte principal; a busca web complementa
  // buscando mais amplamente pela internet, sempre limitada aos últimos 7 dias.
  // Ambas passam pelos MESMOS filtros de relevância/concorrentes abaixo, e o
  // dedup por URL cobre o caso de um artigo aparecer nas duas fontes.
  const [brutos, artigosWeb] = await Promise.all([lerFeeds(FEEDS), buscarArtigosWeb(7)]);
  let artigos = [...padronizar(brutos), ...artigosWeb];
  console.log(
    `Fontes antes dos filtros: ${artigos.filter((a) => a._origem === 'rss').length} via RSS, ` +
      `${artigos.filter((a) => a._origem === 'busca_web').length} via busca web`,
  );

  artigos = calcularIdade(artigos);
  artigos = filtrarRelevancia(artigos);
  artigos = deduplicar(artigos, urlsHistoricas);
  artigos = filtrarConcorrentes(artigos);
  console.log(
    `Fontes após filtros: ${artigos.filter((a) => a._origem === 'rss').length} via RSS, ` +
      `${artigos.filter((a) => a._origem === 'busca_web').length} via busca web`,
  );

  const finais = enriquecerELimitar(artigos, edicaoAtual);

  if (finais.length === 0) {
    console.log('Nada a salvar. Encerrando WF-01.');
    return;
  }

  // "Salvar no Google Sheets": upsert por url.
  const res = await upsertLinhas(config.abaArtigos, finais, 'url');
  console.log(`✓ Salvo: ${res.inseridos} inseridos, ${res.atualizados} atualizados.`);
}

export { buscarArtigosWeb };

// Só roda o pipeline completo quando este arquivo é executado diretamente
// (permite importar buscarArtigosWeb isoladamente em scripts de teste).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('✗ WF-01 falhou:', e);
    process.exit(1);
  });
}
