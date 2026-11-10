import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerNomeCampanha, classificarLink, estruturaAssunto, agruparEdicoes, calcularSinais,
  montarRelatorioHTML, validarSugestoes, renderizarSugestoes, MARCADOR_SUGESTOES,
} from './relatorio.js';

const camp = (nome, data, o, url = []) => ({
  internal_name: nome, start_date: data, campaign_hash: nome,
  overall: { sends: 0, unique_opens: 0, unique_clicks: 0, hard_bounces: 0, soft_bounces: 0, unsubscriptions: 0, complaints: 0, ...o }, url,
});

test('lerNomeCampanha entende versão geral, gestores única e segmentada', () => {
  assert.deepEqual(lerNomeCampanha('POR PUBLICAR · Frota mista ganha · Condutores 2023'), { manchete: 'Frota mista ganha', lista: 'Condutores 2023', versao: 'geral_comercial' });
  assert.equal(lerNomeCampanha('POR PUBLICAR · Usiminas perde 43% · Gestores 2025').versao, 'gestores');
  assert.deepEqual(lerNomeCampanha('POR PUBLICAR · Gestores · Indústria · Fábrica de R$ 23 bi'), { manchete: 'Fábrica de R$ 23 bi', lista: 'Gestores 2025', versao: 'industria' });
  assert.equal(lerNomeCampanha('Newsletter 3'), null);
});

test('classificarLink separa rodapé, descadastro, CTA e conteúdo', () => {
  assert.equal(classificarLink('https://www.linkedin.com/x?utm_content=rodape_linkedin'), 'rodape');
  assert.equal(classificarLink('[!remove]'), 'descadastro');
  assert.equal(classificarLink('https://www.lets.com.br/solicitar-proposta?utm_content=botao_cta'), 'cta');
  assert.equal(classificarLink('https://oeco.org.br/a/?utm_content=noticia_2'), 'conteudo');
});

test('estruturaAssunto reconhece as três estruturas da regra 7', () => {
  assert.equal(estruturaAssunto('Frota mista ganha de conversão total'), 'afirmativa');
  assert.equal(estruturaAssunto('Biodiesel a 15% já é lei. Poucas frotas estão prontas'), 'contraste');
  assert.equal(estruturaAssunto('Por que a Lei 15.485 aperta prazo de motorista'), 'pergunta');
  assert.equal(estruturaAssunto('R$ 1.5 bi em obras'), 'afirmativa');
});

test('calcularSinais compara com a média, separa rodapé e marca amostra pequena', () => {
  const urlBlog = 'https://www.lets.com.br/blog/post?utm_content=blog';
  const ed = (dia, aberturas, extra = []) => [
    camp(`POR PUBLICAR · Manchete ${dia} · Condutores 2023`, `2026-11-${dia} 07:00:00`, { sends: 1000, unique_opens: aberturas, unique_clicks: 10 },
      [{ url: urlBlog, clicks: 5 }, { url: 'https://x.com?utm_content=rodape_site', clicks: 9 }, { url: 'https://www.lets.com.br/solicitar-proposta', clicks: 1 }]),
    ...extra,
  ];
  const campanhas = [
    ...ed('03', 150), ...ed('04', 150), ...ed('05', 150), ...ed('06', 150),
    ...ed('10', 100, [camp('POR PUBLICAR · Gestores · Tecnologia · Edge chega', '2026-11-10 07:00:30', { sends: 32, unique_opens: 8 })]),
  ];
  const edicoes = agruparEdicoes(campanhas);
  assert.equal(edicoes.length, 5);
  for (const e of edicoes) e.itens = [{ tipo: 'blog', fonte: "Blog Let's", url: 'https://www.lets.com.br/blog/post', versoes: ['geral_comercial'] }];
  const s = calcularSinais(edicoes, { agora: new Date('2026-11-13T09:00:00-03:00') });

  assert.equal(s.edicao.manchete, 'Manchete 10');
  assert.equal(s.edicao.horas_desde_envio, 74);
  assert.equal(s.alertas.length, 1); // só o de rodapé (9) > conteúdo (5)
  assert.ok(Math.abs(s.resumo.media_anteriores.abertura - 0.15) < 1e-9);
  assert.equal(s.resumo.rodape, 9);
  assert.equal(s.resumo.conteudo, 5);
  assert.equal(s.resumo.cta, 1);
  assert.equal(s.versoes.find((v) => v.versao === 'tecnologia').confianca, 'amostra_pequena');
  assert.equal(s.itens_edicao[0].cliques, 5);
  assert.deepEqual(s.historico.map((h) => h.data), ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-03', '2026-11-10'].sort());
});

test('alerta de números parciais antes de 60h', () => {
  const edicoes = agruparEdicoes([camp('POR PUBLICAR · M · Condutores 2023', '2026-11-10 07:00:00', { sends: 10, unique_opens: 1 })]);
  const s = calcularSinais(edicoes, { agora: new Date('2026-11-10T10:00:00-03:00') });
  assert.match(s.alertas[0], /3h de envio/);
});

test('HTML tem o marcador e as sugestões entram no lugar dele, sem travessão', () => {
  const edicoes = agruparEdicoes([camp('POR PUBLICAR · M <b> · Condutores 2023', '2026-11-10 07:00:00', { sends: 10, unique_opens: 1 })]);
  const html = montarRelatorioHTML(calcularSinais(edicoes, { agora: new Date('2026-11-13T09:00:00-03:00') }));
  assert.ok(html.includes(MARCADOR_SUGESTOES));
  assert.ok(html.includes('M &lt;b&gt;'));
  const sug = [{ titulo: 'Trocar fonte X', evidencia: '0 cliques em 4 edições', mudanca: 'tirar do FEEDS', como_medir: 'CTR por 4 edições' }];
  const final = renderizarSugestoes(html, validarSugestoes(sug));
  assert.ok(!final.includes(MARCADOR_SUGESTOES));
  assert.ok(final.includes('Trocar fonte X'));
  assert.throws(() => validarSugestoes([{ ...sug[0], titulo: 'A — B' }]), /travessão/);
  assert.throws(() => validarSugestoes([sug[0], sug[0], sug[0], sug[0]]), /no máximo 3/);
  assert.throws(() => validarSugestoes([{ titulo: 'x' }]), /evidencia/);
});
