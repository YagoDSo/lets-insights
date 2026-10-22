// ════════════════════════════════════════════════════════════
// WF-01 — Coleta (porte fiel do PROD-WF-01.json do N8N)
// Fluxo: Ler Edicoes → Config Edição → [RSS: 16 de frota + 28 de segmento/Brasil] → Padronizar →
//   Calcular Idade → Filtrar Palavras-Chave → Deduplicar →
//   Filtrar Concorrentes → Enriquecer e Limitar → Salvar
// ════════════════════════════════════════════════════════════
import { pathToFileURL } from 'url';
import { config } from './lib/config.js';
import { lerFeeds } from './lib/rss.js';
import { lerAba, upsertLinhas, commitarBanco } from './lib/db.js';

// Feeds RSS. Base original (PROD-WF-01) + expansão pro ICP de operação de
// campo (jul/2026): cada URL abaixo foi validada manualmente (200 + XML de
// RSS real com itens recentes) antes de entrar aqui — ver relato da sessão
// que adicionou os feeds de mineração/geotecnia/ambiente/infra/siderurgia.
// `valorinveste.globo.com/rss/` foi removido: descontinuado pela Globo (404
// em toda variação de path testada, sem link de feed na homepage).
// `mobilidade.estadao.com.br/feed/` removido (jul/2026): feed responde 200 e
// devolve XML válido, mas ficou estagnado (item mais recente com 201 dias no
// teste que motivou a remoção) — nunca contribuiu artigo em nenhuma edição
// coletada até aqui, porque tudo cai no corte de idade de 60 dias.
const FEEDS = [
  // Base original (frota/transporte/logística/economia)
  { url: 'https://frotacia.com.br/feed/' },
  { url: 'https://transportemoderno.com.br/feed/' },
  { url: 'https://diariodotransporte.com.br/feed/' },
  { url: 'https://logweb.com.br/feed/' },
  { url: 'https://neofeed.com.br/feed/' },
  { url: 'https://braziljournal.com/feed/' },
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

  // ── News segmentada (out/2026, ver docs/plano-news-segmentada.md) ──
  // Cada feed abaixo foi validado em 22/10/2026 (200 + XML de RSS real + item
  // mais recente com até 14 dias). `segmento` é só uma DICA pro classificador
  // (classificarSegmento): a notícia ainda precisa casar com as palavras do
  // setor, e notícias de feeds gerais também podem cair num segmento.
  // Mineração e siderurgia
  { url: 'https://revistaminerios.com.br/feed/', fonte: 'Revista Minérios', segmento: 'mineracao' },
  { url: 'https://www.inthemine.com.br/site/feed/', fonte: 'In The Mine', segmento: 'mineracao' },
  { url: 'https://brasilminingsite.com.br/feed/', fonte: 'Brasil Mining Site', segmento: 'mineracao' },
  { url: 'https://siderurgiabrasil.com.br/feed/', fonte: 'Siderurgia Brasil', segmento: 'mineracao' },
  // Indústria e manufatura
  { url: 'https://www.cimm.com.br/portal/noticia/rss', fonte: 'CIMM', segmento: 'industria' },
  { url: 'https://www.automacaoindustrial.info/feed/', fonte: 'Automação Industrial', segmento: 'industria' },
  { url: 'https://www.usinagem-brasil.com.br/feed/', fonte: 'Usinagem Brasil', segmento: 'industria' },
  { url: 'https://www.infomoney.com.br/tudo-sobre/industria/feed/', fonte: 'InfoMoney', segmento: 'industria' },
  { url: 'https://revistapotencia.com.br/feed/', fonte: 'Revista Potência', segmento: 'industria' },
  { url: 'https://plasticovirtual.com.br/feed/', fonte: 'Plástico Virtual', segmento: 'industria' },
  { url: 'https://www.autoindustria.com.br/feed/', fonte: 'AutoIndústria', segmento: 'industria' },
  // Engenharia e construção (ABCR, acima, também cobre)
  { url: 'https://agenciainfra.com/blog/feed/', fonte: 'Agência iNFRA', segmento: 'engenharia' },
  { url: 'https://cbic.org.br/feed/', fonte: 'CBIC', segmento: 'engenharia' },
  { url: 'https://sindusconsp.com.br/feed/', fonte: 'Sinduscon-SP', segmento: 'engenharia' },
  { url: 'https://www.cimentoitambe.com.br/feed/', fonte: 'Cimento Itambé', segmento: 'engenharia' },
  { url: 'https://abcp.org.br/feed/', fonte: 'ABCP', segmento: 'engenharia' },
  // Tecnologia e telecom
  { url: 'https://teletime.com.br/feed/', fonte: 'TELETIME', segmento: 'tecnologia' },
  { url: 'https://telesintese.com.br/feed/', fonte: 'TeleSíntese', segmento: 'tecnologia' },
  { url: 'https://convergenciadigital.com.br/feed/', fonte: 'Convergência Digital', segmento: 'tecnologia' },
  { url: 'https://itforum.com.br/feed/', fonte: 'IT Forum', segmento: 'tecnologia' },
  // Florestal e celulose (IBÁ, acima, também cobre)
  { url: 'https://portalcelulose.com.br/feed/', fonte: 'Portal Celulose', segmento: 'florestal' },
  { url: 'https://newspulpaper.com/feed/', fonte: 'News Pulp & Paper', segmento: 'florestal' },
  { url: 'https://comunidadedesilvicultura.com.br/feed/', fonte: 'Comunidade de Silvicultura', segmento: 'florestal' },
  { url: 'https://portalpackaging.com.br/feed/', fonte: 'Portal Packaging', segmento: 'florestal' },
  // Brasil (economia, regulação, negócios, operação). Brazil Journal, NeoFeed e
  // Exame, acima, também alimentam esta trilha.
  { url: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml', fonte: 'Agência Brasil', segmento: 'brasil' },
  { url: 'https://www.infomoney.com.br/feed/', fonte: 'InfoMoney', segmento: 'brasil' },
  { url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/economia/?body=%7B%22layout%22:%22google-news%22%7D', fonte: 'Estadão', segmento: 'brasil' },
  { url: 'https://g1.globo.com/rss/g1/economia/', fonte: 'g1', segmento: 'brasil' },
];

// Feeds gerais de negócios que também alimentam a trilha Brasil (sem dica de segmento).
const FONTES_NEGOCIOS = new Set(['Brazil Journal', 'NeoFeed', 'Exame']);
const FEED_POR_URL = new Map(FEEDS.map((f) => [f.url, f]));

// Normaliza texto: minúsculas + remove acentos. Usado nos filtros e no classificador.
const normalizar = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

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
    else if (FEED_POR_URL.get(it.feedUrl)?.fonte) fonte = FEED_POR_URL.get(it.feedUrl).fonte;
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
      dicaSegmento: FEED_POR_URL.get(it.feedUrl)?.segmento || '',
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
  const termosGenericos = [
    'frota', 'frotas', 'logística', 'logistica', 'obra', 'obras', 'campo',
    // Loosening (jul/2026): categorias centrais do ICP que ainda dependiam só de match específico.
    'caminhão', 'caminhao', 'caminhões', 'caminhoes', 'ônibus', 'onibus',
    'rodovia', 'rodovias', 'mineral', 'celulose',
  ];
  const contextoB2B = [
    'empresa', 'corporativ', 'empresarial', 'terceiriz', 'locaç', 'locac', 'gestor', 'gestão',
    'gestao', 'setor', 'mercado', 'indústria', 'veículos', 'veiculos', 'automóv', 'automovel', 'carro',
    'mineradora', 'geotecnia', 'infraestrutura', 'concessionária', 'concessionaria', 'siderúrgica',
    'siderurgica', 'engenharia', 'operação', 'operacao',
    // Loosening (jul/2026): acompanham notícia legítima de indústria/comércio B2B.
    'produção', 'producao', 'investimento', 'comercial',
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

// News segmentada (out/2026): o filtro de frota acima continua decidindo o pool
// da versão geral (_frota). Notícia que não fala de frota mas é do setor (ou
// de Brasil) passa também, marcada só pro pool segmentado.
function filtrarRelevanciaComSegmentos(itens) {
  // Pool da versão geral = só os feeds de sempre (sem dica de segmento), pra
  // ela continuar exatamente como hoje; os feeds novos alimentam só os segmentos.
  const frota = new Set(filtrarRelevancia(itens.filter((a) => !a.dicaSegmento)));
  let soSegmento = 0;
  const out = [];
  for (const a of itens) {
    if (frota.has(a)) out.push({ ...a, _frota: true });
    else if (classificarSegmento(a).segmento) {
      out.push({ ...a, _frota: false });
      soSegmento++;
    }
  }
  console.log(`Relevância segmentada: +${soSegmento} artigos de setor/Brasil fora do filtro de frota (total ${out.length})`);
  return out;
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

// ─── News segmentada (out/2026): segmento por palavras, em TODOS os feeds ───
// Termos casam como palavra inteira no texto normalizado (sem acento); termo
// terminado em "*" casa como prefixo ("siderurg*" pega siderurgia/siderúrgica).
// A dica do feed (fonte setorial) soma pontos, mas a notícia ainda precisa ter
// pelo menos um termo do setor, pra não carregar post fora do tema que esses
// portais às vezes publicam.
const SEGMENTOS = {
  mineracao: [
    'mineracao', 'mineradora*', 'minerio*', 'mineral', 'minerais', 'lavra', 'mina', 'minas de', 'siderurg*',
    'aco', 'acos', 'aciaria', 'gusa', 'pelotizacao', 'niquel', 'cobre', 'litio', 'terras raras', 'bauxita',
    'aluminio', 'ouro', 'vale', 'samarco', 'usiminas', 'gerdau', 'csn', 'arcelormittal', 'aperam',
    'anglo american', 'barragem de rejeito*', 'rejeitos', 'ibram', 'anm', 'metalurg*',
  ],
  industria: [
    'industria', 'industrial', 'industriais', 'fabrica', 'fabricas', 'manufatura', 'metalmecanic*', 'usinagem',
    'maquinas e equipamentos', 'automacao industrial', 'manutencao industrial', 'quimica', 'petroquimic*',
    'plastico*', 'embalage*', 'autopecas', 'montadora*', 'producao industrial', 'cni', 'abimaq', 'weg',
    'chao de fabrica', 'linha de producao', 'industria 4.0',
  ],
  engenharia: [
    'construcao civil', 'construtora*', 'obra', 'obras', 'canteiro*', 'infraestrutura', 'pavimentacao',
    'concreto', 'cimento', 'rodovia', 'rodovias', 'ferrovia*', 'concessao', 'concessoes', 'leilao de rodovia*',
    'edificac*', 'incorporadora*', 'cbic', 'sinduscon', 'terraplenagem', 'montagem industrial', 'engenharia',
    'saneamento basico', 'ponte', 'viaduto', 'porto', 'portos',
  ],
  tecnologia: [
    // ("ia" sozinho não entra: colide com o verbo "ia"; "operadora" sozinho pega plano de saúde)
    'telecom', 'telecomunicac*', '5g', 'fibra optica', 'operadora de telecom*', 'operadoras de telecom*', 'telefonia',
    'data center*', 'software', 'inteligencia artificial', 'ia generativa', 'nuvem', 'cloud', 'ciberseguranca', 'seguranca cibernetica', 'ti', 'provedor de internet', 'provedores',
    'anatel', 'conectividade', 'sap', 'erp', 'startup*', 'transformacao digital', 'semicondutor*',
  ],
  florestal: [
    'florestal', 'florestais', 'floresta plantada', 'florestas plantadas', 'silvicultura', 'eucalipto', 'pinus',
    'celulose', 'papel e celulose', 'papelao', 'madeira', 'paineis de madeira', 'mdf', 'colheita florestal',
    'suzano', 'klabin', 'eldorado', 'bracell', 'arauco', 'cmpc', 'veracel', 'cenibra', 'dexco', 'iba',
  ],
};

// Trilha Brasil: 4 temas que alternam de edição em edição (a curadoria escolhe
// as 2 mais relevantes da semana, de temas diferentes).
const TEMAS_BRASIL = {
  Economia: ['pib', 'inflacao', 'ipca', 'juros', 'selic', 'copom', 'banco central', 'cambio', 'dolar', 'arrecadacao', 'desemprego', 'fiscal', 'orcamento', 'divida publica', 'credito'],
  Regulacao: ['lei', 'decreto', 'pec', 'reforma tributaria', 'medida provisoria', 'regulamenta*', 'norma', 'normas', 'antt', 'aneel', 'anp', 'senado aprova', 'camara aprova', 'tributo*', 'imposto*', 'stf'],
  Negocios: ['aquisicao', 'fusao', 'ipo', 'investimento*', 'lucro', 'receita', 'balanco', 'trimestre', 'aporte', 'expansao', 'resultado'],
  Operacao: ['logistica', 'frete', 'diesel', 'combustive*', 'rodovias', 'portos', 'energia', 'escala de trabalho', 'jornada', 'mao de obra', 'greve', 'abastecimento'],
};
// Fora da trilha Brasil: política eleitoral, polícia, esporte, entretenimento.
const EXCLUSAO_BRASIL = [
  'eleicao', 'eleicoes', 'eleitoral', 'pesquisa eleitoral', 'segundo turno', '2o turno', 'candidato*', 'campanha eleitoral',
  'lula', 'flavio', 'bolsonaro', 'partido', 'cpi', 'sigilo', 'policia', 'preso', 'presa', 'assassin*', 'crime',
  'golpe', 'futebol', 'campeonato', 'novela', 'bbb', 'celebridade*', 'horoscopo', 'mega-sena', 'loteria', 'airbnb',
];

// Fora de qualquer segmento: transporte público urbano (mesmo critério B2C do
// filtro de frota), que senão cairia em engenharia por "obra"/"licitação".
const EXCLUSAO_SEGMENTO = [
  'metro', 'cptm', 'sptrans', 'viamobilidade', 'onibus urbano', 'transporte publico', 'brt', 'vlt',
  'tarifa de onibus', 'passageiros', 'linha 10-turquesa', 'trens metropolitanos',
];
// Título majoritariamente em inglês (alguns portais misturam): fora.
const PALAVRAS_INGLES = ['the', 'of', 'and', 'to', 'with', 'who', 'will', 'for', 'new', 'its', 'targets', 'question'];
const pareceIngles = (titulo) => {
  const palavras = String(titulo || '').toLowerCase().split(/[^a-z']+/);
  return palavras.filter((p) => PALAVRAS_INGLES.includes(p)).length >= 2;
};

const regexDoTermo = (t) => {
  const prefixo = t.endsWith('*');
  const base = normalizar(prefixo ? t.slice(0, -1) : t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${base}${prefixo ? '' : '(?=[^a-z0-9]|$)'}`);
};
const compilar = (lista) => lista.map(regexDoTermo);
const SEGMENTOS_RE = Object.fromEntries(Object.entries(SEGMENTOS).map(([k, v]) => [k, compilar(v)]));
const TEMAS_BRASIL_RE = Object.fromEntries(Object.entries(TEMAS_BRASIL).map(([k, v]) => [k, compilar(v)]));
const EXCLUSAO_BRASIL_RE = compilar(EXCLUSAO_BRASIL);
const EXCLUSAO_SEGMENTO_RE = compilar(EXCLUSAO_SEGMENTO);
const contar = (txt, regs) => regs.filter((re) => re.test(txt)).length;

// Devolve { segmento, temaBrasil }. segmento: mineracao | industria |
// engenharia | tecnologia | florestal | brasil | '' (só trilha frota).
function classificarSegmento(a) {
  const txt = normalizar((a.titulo || '') + ' ' + (a.resumo || ''));
  const dica = a.dicaSegmento || '';
  const vazio = { segmento: '', temaBrasil: '' };
  if (pareceIngles(a.titulo) || EXCLUSAO_SEGMENTO_RE.some((re) => re.test(txt))) return vazio;

  let melhor = '';
  let melhorPontos = 0;
  for (const [seg, regs] of Object.entries(SEGMENTOS_RE)) {
    const casos = contar(txt, regs);
    if (!casos) continue; // sem nenhum termo do setor, nem a dica do feed salva
    const pontos = casos + (dica === seg ? 2 : 0);
    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = seg;
    }
  }
  // Feed setorial: 1 termo + dica basta. Feed geral: precisa de 2 termos do setor.
  if (melhor && melhorPontos >= 2) return { segmento: melhor, temaBrasil: '' };

  // Trilha Brasil: só de feeds de Brasil/negócios, com tema e sem assunto excluído.
  if (dica === 'brasil' || FONTES_NEGOCIOS.has(a.fonte)) {
    if (EXCLUSAO_BRASIL_RE.some((re) => re.test(txt))) return { segmento: '', temaBrasil: '' };
    let tema = '';
    let max = 0;
    for (const [t, regs] of Object.entries(TEMAS_BRASIL_RE)) {
      const n = contar(txt, regs);
      if (n > max) { max = n; tema = t; }
    }
    if (tema) return { segmento: 'brasil', temaBrasil: tema };
  }
  return { segmento: '', temaBrasil: '' };
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

  // Trilha frota usa só o que passou no filtro de frota (_frota), como sempre.
  const itensFrota = itens.filter((i) => i._frota);
  let janelaUsada = JANELAS[0];
  let balanceados = [];
  for (const janela of JANELAS) {
    const dentro = itensFrota.filter((i) => (i.idade_dias ?? 999) <= janela);
    balanceados = aplicarCaps(dentro);
    janelaUsada = janela;
    console.log(`Janela ${janela}d: ${dentro.length} no período, ${balanceados.length} após caps`);
    if (balanceados.length >= ALVO_MINIMO) break;
  }
  console.log(`Janela final: ${janelaUsada}d com ${balanceados.length} artigos`);

  const montarLinha = (item, trilha) => {
    const { segmento, temaBrasil } = classificarSegmento(item);
    return {
      edicao: edicaoAtual,
      data_coleta: dataColeta,
      titulo: item.titulo,
      url: item.url,
      fonte: item.fonte,
      data_publicacao: item.data,
      resumo: item.resumo,
      tema: segmento === 'brasil' ? temaBrasil : item._tema || classificarTema(item),
      status: 'coletado',
      segmento,
      trilha,
    };
  };

  // Trilha frota: exatamente o pool de sempre (só itens que passaram no filtro
  // de frota). É o que alimenta a versão geral.
  const enriquecidos = balanceados.map((item) => montarLinha(item, 'frota'));
  console.log(`✓ Trilha frota: ${enriquecidos.length} artigos (janela ${janelaUsada}d)`);

  // Trilhas segmento + Brasil: completam cada segmento até a cota, sem repetir
  // artigo que já entrou no pool de frota (esses já levam o rótulo de segmento).
  const jaUsados = new Set(enriquecidos.map((e) => e.url));
  const resto = itens
    .filter((i) => !jaUsados.has(i.url))
    .map((i) => ({ ...i, ...classificarSegmento(i) }))
    .filter((i) => i.segmento);
  const COTA = { mineracao: 8, industria: 8, engenharia: 8, tecnologia: 8, florestal: 8, brasil: 10 };
  const ALVO = { mineracao: 4, industria: 4, engenharia: 4, tecnologia: 4, florestal: 4, brasil: 6 };
  for (const seg of Object.keys(COTA)) {
    const jaTem = enriquecidos.filter((e) => e.segmento === seg).length;
    const falta = COTA[seg] - jaTem;
    if (falta <= 0) continue;
    const candidatos = resto.filter((i) => i.segmento === seg);
    let escolhidos = [];
    let janelaSeg = JANELAS[0];
    for (const janela of JANELAS) {
      const dentro = candidatos
        .filter((i) => (i.idade_dias ?? 999) <= janela)
        .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
      const contFonte = {};
      const contTema = {};
      escolhidos = [];
      for (const i of dentro) {
        const tema = seg === 'brasil' ? i.temaBrasil : 'x';
        contFonte[i.fonte] = contFonte[i.fonte] || 0;
        contTema[tema] = contTema[tema] || 0;
        // Brasil: no máximo 4 do mesmo tema, pra sobrar variedade pra curadoria.
        if (contFonte[i.fonte] < MAX_POR_FONTE && (seg !== 'brasil' || contTema[tema] < 4)) {
          escolhidos.push(i);
          contFonte[i.fonte]++;
          contTema[tema]++;
        }
        if (escolhidos.length >= falta) break;
      }
      janelaSeg = janela;
      if (jaTem + escolhidos.length >= ALVO[seg]) break;
    }
    escolhidos.forEach((i) => enriquecidos.push(montarLinha(i, seg === 'brasil' ? 'brasil' : 'segmento')));
    const total = jaTem + escolhidos.length;
    console.log(`✓ Trilha ${seg}: ${total} artigos (${jaTem} do pool de frota + ${escolhidos.length} novos, janela ${janelaSeg}d)${total < 2 ? ' ⚠️ menos de 2: WF-02 vai completar com notícia geral' : ''}`);
  }

  const distFonte = {};
  const distTema = {};
  const distSeg = {};
  enriquecidos.forEach((e) => {
    distFonte[e.fonte] = (distFonte[e.fonte] || 0) + 1;
    distTema[e.tema] = (distTema[e.tema] || 0) + 1;
    distSeg[e.segmento || '(só frota)'] = (distSeg[e.segmento || '(só frota)'] || 0) + 1;
  });
  console.log(`✓ WF-01: ${enriquecidos.length} artigos pra edição ${edicaoAtual}`);
  console.log('Distribuição por fonte:', JSON.stringify(distFonte));
  console.log('Distribuição por TEMA:', JSON.stringify(distTema));
  console.log('Distribuição por SEGMENTO:', JSON.stringify(distSeg));
  if (balanceados.length < 10) console.log(`⚠️ Só ${balanceados.length} artigos na trilha frota. WF-02 vai completar.`);
  return enriquecidos;
}

// ─── Orquestração ────────────────────────────────────────────
async function main() {
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

  // [RSS] → Padronizar → Calcular Idade → Relevância (frota OU segmento/Brasil)
  //   → Dedup → Concorrentes → Enriquecer (trilhas frota, segmento, Brasil)
  const brutos = await lerFeeds(FEEDS);
  let artigos = padronizar(brutos);

  artigos = calcularIdade(artigos);
  artigos = filtrarRelevanciaComSegmentos(artigos);
  artigos = deduplicar(artigos, urlsHistoricas);
  artigos = filtrarConcorrentes(artigos);

  const finais = enriquecerELimitar(artigos, edicaoAtual);

  if (finais.length === 0) {
    console.log('Nada a salvar. Encerrando WF-01.');
    return;
  }

  // "Salvar no Google Sheets": upsert por url.
  const res = await upsertLinhas(config.abaArtigos, finais, 'url');
  console.log(`✓ Salvo: ${res.inseridos} inseridos, ${res.atualizados} atualizados.`);
  commitarBanco(`chore: WF-01 coleta edição ${edicaoAtual} (${res.inseridos} novo(s), ${res.atualizados} atualizado(s))`);
}

// Só roda o pipeline completo quando este arquivo é executado diretamente.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('✗ WF-01 falhou:', e);
    process.exit(1);
  });
}

// Exportados só para teste local (scripts de ensaio que não gravam no banco).
export { FEEDS, padronizar, calcularIdade, filtrarRelevanciaComSegmentos, deduplicar, filtrarConcorrentes, enriquecerELimitar, classificarSegmento };
