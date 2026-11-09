// Testes da extração de imagem (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodificarEntidades, extrairImagem, extrairImagemPost } from './imagem.js';

// Caso real da edição 24 (nov/2026): o "&" do endereço vem como "&amp;".
const OG_ESTADAO =
  '<meta property="og:image" content="https://www.estadao.com.br/resizer/v2/PHXXTRIQJZFUDDU2OXL5XMK2IU.jpg?quality=80&amp;auth=9b8f28e7&amp;width=1200&amp;height=630&amp;focal=4344,3048"/>';

test('og:image com &amp; sai com & de verdade (Estadão, edição 24)', () => {
  assert.equal(
    extrairImagem(`<html><head>${OG_ESTADAO}</head></html>`),
    'https://www.estadao.com.br/resizer/v2/PHXXTRIQJZFUDDU2OXL5XMK2IU.jpg?quality=80&auth=9b8f28e7&width=1200&height=630&focal=4344,3048',
  );
});

test('entidade numérica do WordPress (&#038;) também é decodificada', () => {
  const html = '<meta property="og:image" content="https://i0.wp.com/site.com.br/foto.jpg?fit=500%2C400&#038;ssl=1">';
  assert.equal(extrairImagem(html), 'https://i0.wp.com/site.com.br/foto.jpg?fit=500%2C400&ssl=1');
});

test('decodificarEntidades: nomeadas, decimais e hexadecimais; desconhecida fica', () => {
  assert.equal(decodificarEntidades('a&amp;b&#38;c&#x26;d&AMP;e'), 'a&b&c&d&e');
  assert.equal(decodificarEntidades('x&naoexiste;y'), 'x&naoexiste;y');
  assert.equal(decodificarEntidades('sem entidade'), 'sem entidade');
});

test('ordem de preferência e normalização de protocolo', () => {
  assert.equal(
    extrairImagem('<meta content="//cdn.site.com/a.jpg" property="og:image">'),
    'https://cdn.site.com/a.jpg',
  );
  assert.equal(
    extrairImagem('<meta name="twitter:image" content="http://site.com/b.jpg">'),
    'https://site.com/b.jpg',
  );
  assert.equal(extrairImagem('<link rel="image_src" href="https://site.com/c.jpg">'), 'https://site.com/c.jpg');
  assert.equal(extrairImagem('<html><body>sem imagem</body></html>'), null);
  assert.equal(extrairImagem(''), null);
});

test('imagem do post do blog também é decodificada', () => {
  const html = `<html><head><meta property="og:image" content="https://cdn.prod.website-files.com/x/capa.jpg?a=1&amp;b=2"></head><body>${'texto '.repeat(100)}</body></html>`;
  assert.equal(extrairImagemPost(html), 'https://cdn.prod.website-files.com/x/capa.jpg?a=1&b=2');
});
