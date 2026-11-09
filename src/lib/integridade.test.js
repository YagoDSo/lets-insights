// Testes das verificações de integridade (node --test).
// As fixtures espelham o caso real que motivou o módulo: a URL
// `ocarreteiro.com.br/empresas/veic-redes/` sequestrada por parasite SEO
// na edição 16 (set/2026), e uma matéria legítima do mesmo portal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verificarIntegridade,
  sobreposicaoTitulo,
  ancoraResumo,
  termosSpam,
  imagemSuspeita,
  mesmoDominio,
  pareceportugues,
  declaraPaywall,
} from './integridade.js';

const paginaLegitima = `<!DOCTYPE html><html lang="pt-BR"><head>
<title>Retrofit de caminhões: Grupo Sada transforma Euro 3 em veículos a GNV - Portal O Carreteiro</title>
<meta property="og:image" content="https://ocarreteiro.com.br/wp-content/uploads/2026/09/sada.jpg">
</head><body><article>
<h1>Retrofit de caminhões: Grupo Sada transforma Euro 3 em veículos a GNV</h1>
<p>Em vez de tirar caminhões antigos de operação, o Grupo Sada aposta no retrofit de caminhões
para dar uma nova vida a veículos que ainda apresentam condições de trabalho. Em parceria com a
MWM, a empresa converteu 35 cegonhas Euro 3 para GNV (gás natural veicular). Além da mudança do
combustível, os veículos passam por revisão e modernização antes de retornar às operações.</p>
<p>A estratégia combina dois objetivos: reduzir as emissões da frota e aproveitar veículos que
ainda podem trabalhar por vários anos, segundo a diretoria de sustentabilidade da companhia.</p>
</article></body></html>`;

const tituloRssLegitimo = 'Retrofit de caminhões: Grupo Sada transforma Euro 3 em veículos a GNV';
const resumoRssLegitimo =
  'Em vez de tirar caminhões antigos de operação, o Grupo Sada aposta no retrofit de caminhões para dar uma nova vida a veículos que ainda apresentam condições de trabalho. […]';

const paginaSequestrada = `<!DOCTYPE html><html><head>
<title>ULTRA777 ⁂ Daftar Situs Slot Toto x Veic Redes</title>
<meta property="og:image" content="https://i.pinimg.com/1200x/4d/d1/20/4dd120b8b564c56021f0d6a6c9977793.jpg">
</head><body>
<h1>ULTRA777 ⁂ Daftar Situs Slot Toto x Veic Redes</h1>
<p>Situs slot gacor ULTRA777 merupakan info daftar 10 link slot gacor hari ini jackpot terbesar
2026 setiap hari &amp; situs judi slot online gampang menang maxwin. Melalui pembaruan rutin,
ULTRA777 membantu pemain menemukan link slot gacor hari ini dengan akses cepat, stabil, dan aman
untuk pengalaman bermain yang lebih nyaman.</p>
<p>Minimal Deposit IDR 5.000. Minimal Withdraw IDR 50.000. Transfer Bank Lokal, E-wallet, QRIS.</p>
</body></html>`;

const tituloRssVeic = 'VEIC Redes: nova solução une abastecimento, crédito e gestão de frota';
const resumoRssVeic =
  'O VEIC Redes chega ao mercado com uma proposta diferente das tradicionais soluções de gestão de abastecimento. Em vez de partir de uma rede credenciada para atender empresas, a plataforma coloca o posto de combustível no centro da operação. […]';

test('matéria legítima passa sem nenhum motivo', () => {
  const r = verificarIntegridade({
    url: 'https://ocarreteiro.com.br/ultimas-noticias/retrofit-de-caminhoes/',
    urlFinal: 'https://ocarreteiro.com.br/ultimas-noticias/retrofit-de-caminhoes/',
    html: paginaLegitima,
    tituloRss: tituloRssLegitimo,
    resumoRss: resumoRssLegitimo,
    imagem: 'https://ocarreteiro.com.br/wp-content/uploads/2026/09/sada.jpg',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.motivos, []);
});

test('página sequestrada é reprovada com motivo grave', () => {
  const r = verificarIntegridade({
    url: 'https://ocarreteiro.com.br/empresas/veic-redes/',
    urlFinal: 'https://ocarreteiro.com.br/empresas/veic-redes/',
    html: paginaSequestrada,
    tituloRss: tituloRssVeic,
    resumoRss: resumoRssVeic,
    imagem: 'https://i.pinimg.com/1200x/4d/d1/20/4dd120b8b564c56021f0d6a6c9977793.jpg',
  });
  assert.equal(r.ok, false);
  const codigos = r.motivos.map((m) => m.codigo);
  assert.ok(codigos.includes('vocabulario_spam'));
  assert.ok(codigos.includes('fora_de_pt_br'));
  assert.ok(codigos.includes('conteudo_trocado'));
  assert.ok(codigos.includes('imagem_ugc'));
  assert.ok(r.motivos.some((m) => m.peso === 'grave'));
});

test('cada verificação sozinha pega o sequestro', () => {
  // Sem o texto em indonésio, só com o título trocado e a imagem no
  // Pinterest, a página ainda cai (dois sinais leves somados).
  const html = paginaLegitima
    .replace(tituloRssLegitimo, 'ULTRA777 Daftar Toto')
    .replace('https://ocarreteiro.com.br/wp-content/uploads/2026/09/sada.jpg', 'https://i.pinimg.com/1200x/abc.jpg');
  const r = verificarIntegridade({
    url: 'https://ocarreteiro.com.br/ultimas-noticias/retrofit-de-caminhoes/',
    html,
    tituloRss: tituloRssLegitimo,
    resumoRss: resumoRssLegitimo,
    imagem: 'https://i.pinimg.com/1200x/abc.jpg',
  });
  assert.equal(r.ok, false);
});

test('título divergente sozinho não reprova', () => {
  // Portal que reescreve o título depois de publicar: sinal leve, passa.
  const html = paginaLegitima.replace(
    '<title>Retrofit de caminhões: Grupo Sada transforma Euro 3 em veículos a GNV - Portal O Carreteiro</title>',
    '<title>Portal O Carreteiro</title>',
  );
  const r = verificarIntegridade({
    url: 'https://ocarreteiro.com.br/ultimas-noticias/retrofit-de-caminhoes/',
    html,
    tituloRss: tituloRssLegitimo,
    resumoRss: resumoRssLegitimo,
    imagem: 'https://ocarreteiro.com.br/wp-content/uploads/2026/09/sada.jpg',
  });
  assert.equal(r.ok, true);
  assert.equal(r.motivos.length, 1);
  assert.equal(r.motivos[0].codigo, 'titulo_divergente');
});

test('redirect para fora do domínio da fonte é grave', () => {
  const r = verificarIntegridade({
    url: 'https://ocarreteiro.com.br/empresas/veic-redes/',
    urlFinal: 'https://apostas-exemplo.com/lp/',
    html: paginaLegitima,
    tituloRss: tituloRssLegitimo,
    resumoRss: resumoRssLegitimo,
  });
  assert.equal(r.ok, false);
  assert.equal(r.motivos[0].codigo, 'redirect_externo');
});

test('página sem conteúdo extraível não reprova (anti-bot conhecido)', () => {
  const r = verificarIntegridade({
    url: 'https://brasilmineral.com.br/noticias/exemplo',
    html: '',
    tituloRss: 'Qualquer título',
    resumoRss: 'Qualquer resumo com palavras suficientes para formar uma janela de oito.',
  });
  assert.equal(r.ok, true);
  assert.equal(r.motivos[0].codigo, 'sem_conteudo');
});

test('"aposta" em matéria legítima não conta como vocabulário de spam', () => {
  assert.deepEqual(termosSpam('O Grupo Sada aposta no retrofit e no slot de agendamento em Betim'), []);
  assert.deepEqual(termosSpam('situs judi slot online gacor'), ['gacor', 'judi', 'slot online']);
  // Palavra inteira: "especialista" contém "cialis" e "judicial" contém "judi".
  assert.deepEqual(termosSpam('O especialista explica a decisão judicial sobre o setor'), []);
});

test('sobreposição de título ignora sufixo do portal', () => {
  const r = sobreposicaoTitulo(tituloRssLegitimo, `${tituloRssLegitimo} - Portal O Carreteiro`);
  assert.ok(r.comuns >= 4);
  assert.ok(r.razao >= 0.9);
  assert.equal(sobreposicaoTitulo(tituloRssVeic, 'ULTRA777 Daftar Situs Slot Toto').comuns, 0);
});

test('título de spam que ecoa o slug da URL ainda é divergente', () => {
  // O caso real: "ULTRA777 ⁂ Daftar Situs Slot Toto x Veic Redes" repete
  // "Veic Redes" do slug, então sobreposição zero não serviria de regra.
  const r = sobreposicaoTitulo(tituloRssVeic, 'ULTRA777 ⁂ Daftar Situs Slot Toto x Veic Redes');
  assert.ok(r.comuns > 0, 'o spam ecoa parte do título');
  assert.ok(r.razao < 0.3, 'mas fica muito abaixo do piso de sobreposição');
});

test('âncora do resumo tolera o corte "[…]" do feed', () => {
  const texto =
    'Em vez de tirar caminhões antigos de operação, o Grupo Sada aposta no retrofit de caminhões para dar uma nova vida a veículos.';
  assert.equal(ancoraResumo(resumoRssLegitimo, texto).encontrada, true);
  assert.equal(ancoraResumo(resumoRssVeic, texto).encontrada, false);
});

test('CDN do próprio portal não é imagem suspeita', () => {
  assert.equal(imagemSuspeita('https://cdn.ocarreteiro.com.br/a.jpg', 'https://ocarreteiro.com.br/x/'), null);
  assert.equal(imagemSuspeita('https://i.pinimg.com/a.jpg', 'https://ocarreteiro.com.br/x/'), 'ugc');
  assert.equal(
    imagemSuspeita('https://storage.googleapis.com/a.jpg', 'https://brasilmineral.com.br/x/'),
    'host-diferente',
  );
  assert.equal(mesmoDominio('cdn.logisticanobrasil.com.br', 'logisticanobrasil.com.br'), true);
  assert.equal(mesmoDominio('i.pinimg.com', 'ocarreteiro.com.br'), false);
});

test('detector de idioma não dispara em texto curto', () => {
  assert.equal(pareceportugues('Texto curto qualquer').avaliavel, false);
  assert.equal(pareceportugues('x'.repeat(400)).ok, false);
});

test('imagem em CDN de outro domínio é só informativa e não soma pra reprovar', () => {
  // Caso real (nov/2026): matéria do g1 com título reescrito e imagem em glbimg.com.
  const corpo = 'As empresas passam a ser obrigadas a oferecer atendimento humano ao consumidor no SAC a partir desta segunda-feira, segundo as novas regras que entram em vigor para todo o país e que valem para bancos, operadoras e o comércio. '.repeat(3);
  const r = verificarIntegridade({
    url: 'https://g1.globo.com/economia/noticia/x.ghtml',
    html: `<html><head><title>Atendimento humano no SAC: novas regras começam a valer hoje | G1</title></head><body><p>${corpo}</p></body></html>`,
    tituloRss: 'Empresas devem oferecer atendimento humano para o consumidor a partir desta segunda-feira',
    resumoRss: 'As empresas passam a ser obrigadas a oferecer atendimento humano ao consumidor no SAC',
    imagem: 'https://s2-g1.glbimg.com/foto.jpg',
  });
  assert.ok(r.motivos.some((m) => m.codigo === 'imagem_host_diferente' && m.peso === 'info'));
  assert.equal(r.ok, true);
});

// Edição 24 (nov/2026): matéria do Estadão fechada para assinante entrou
// nas 5 versões segmentadas. A página se declara paga no JSON-LD.
const jsonLdPago = `<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":"False","hasPart":{"@type":"WebPageElement","isAccessibleForFree":"False","cssSelector":"[data-paywall-wrapper]"}}</script>`;

test('matéria marcada como paga é reprovada mesmo com título e resumo batendo', () => {
  const r = verificarIntegridade({
    url: 'https://ocarreteiro.com.br/ultimas-noticias/retrofit-de-caminhoes/',
    html: paginaLegitima.replace('</head>', `${jsonLdPago}</head>`),
    tituloRss: tituloRssLegitimo,
    resumoRss: resumoRssLegitimo,
  });
  assert.equal(r.ok, false);
  assert.ok(r.motivos.some((m) => m.codigo === 'paywall' && m.peso === 'grave'));
});

test('paywall reprova também quando o corpo da página não é extraível', () => {
  const r = verificarIntegridade({
    url: 'https://www.estadao.com.br/economia/x/',
    html: `<html><head>${jsonLdPago}</head><body></body></html>`.padEnd(600, ' '),
  });
  assert.equal(r.ok, false);
});

test('declaraPaywall: JSON-LD e microdata; marcação "true" não conta', () => {
  assert.equal(declaraPaywall(jsonLdPago), true);
  assert.equal(declaraPaywall('{"isAccessibleForFree": false}'), true);
  assert.equal(declaraPaywall('<meta itemprop="isAccessibleForFree" content="false">'), true);
  assert.equal(declaraPaywall('{"isAccessibleForFree":"True"}'), false);
  assert.equal(declaraPaywall(paginaLegitima), false);
  assert.equal(declaraPaywall(''), false);
});
