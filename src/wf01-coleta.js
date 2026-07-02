// ════════════════════════════════════════════════════════════
// WF-01 — Coleta (porte fiel do PROD-WF-01.json do N8N)
// Fluxo: Ler Edicoes → Config Edição → [9 RSS] → Padronizar →
//   Calcular Idade → Filtrar Palavras-Chave → Deduplicar →
//   Filtrar Concorrentes → Enriquecer e Limitar → Salvar
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerFeeds } from './lib/rss.js';
import { lerAba, upsertLinhas } from './lib/store.js';

// 9 feeds RSS (mesma lista do PROD-WF-01).
const FEEDS = [
  { url: 'https://frotacia.com.br/feed/' },
  { url: 'https://transportemoderno.com.br/feed/' },
  { url: 'https://diariodotransporte.com.br/feed/' },
  { url: 'https://logweb.com.br/feed/' },
  { url: 'https://neofeed.com.br/feed/' },
  { url: 'https://braziljournal.com/feed/' },
  { url: 'https://mobilidade.estadao.com.br/feed/' },
  { url: 'https://valorinveste.globo.com/rss/' },
  { url: 'https://exame.com/feed/' },
];

// Normaliza texto: minúsculas + remove acentos. Usado nos filtros e no classificador.
const normalizar = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

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
    else if (it.creator) fonte = it.creator;

    return {
      titulo: (it.title || '').trim(),
      url,
      data: it.pubDate || it.isoDate || new Date().toISOString(),
      resumo: (it.contentSnippet || it.content || it.description || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500),
      fonte,
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
  ];
  const termosGenericos = ['frota', 'frotas', 'logística', 'logistica'];
  const contextoB2B = [
    'empresa', 'corporativ', 'empresarial', 'terceiriz', 'locaç', 'locac', 'gestor', 'gestão',
    'gestao', 'setor', 'mercado', 'indústria', 'veículos', 'veiculos', 'automóv', 'automovel', 'carro',
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

  console.log(`Filtro relevância B2B v2: ${filtrados.length} de ${itens.length}`);
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
  Regulacao: ['lei', 'regulament', 'tst', 'tribunal', 'norma', 'fiscal', 'tributa', 'imposto', 'receita federal', 'legisla', 'decreto', 'multa', 'compliance'],
  Tecnologia: ['telemetria', 'rastreamento', 'software', 'tms', 'plataforma', 'inteligencia artificial', ' ia ', 'automacao', 'robotica', 'digital', 'app', 'aplicativo', 'dados', 'data center'],
  Mercado: ['mercado', 'venda', 'vendas', 'crescimento', 'investiment', 'aporte', 'aquisicao', 'fusao', 'expansao', 'faturamento', 'receita', 'resultado', 'economia', 'pib'],
  RenovacaoFrota: ['compra', 'adquire', 'incorpora', 'renovacao', 'novos caminhoes', 'amplia frota', 'lote', 'unidades', 'aquisicao de veiculos'],
  Custos: ['custo', 'diesel', 'combustivel', 'preco', 'reajuste', 'tarifa', 'pedagio', 'frete', 'despesa', 'inflacao'],
  Logistica: ['logistica', 'supply chain', 'cadeia de suprimentos', 'armazen', 'cabotagem', 'porto', 'intermodal', 'distribuicao', 'cargas'],
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

  // [9 RSS] → Padronizar → Calcular Idade → Relevância → Dedup → Concorrentes → Enriquecer
  const brutos = await lerFeeds(FEEDS);
  let artigos = padronizar(brutos);
  artigos = calcularIdade(artigos);
  artigos = filtrarRelevancia(artigos);
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
}

main().catch((e) => {
  console.error('✗ WF-01 falhou:', e);
  process.exit(1);
});
