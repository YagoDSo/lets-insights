import test from 'node:test';
import assert from 'node:assert/strict';
import { blocoDiagnosticoHTML } from './diagnostico.js';

const item = {
  etapa: 'wf02',
  acao: 'descartado',
  url: 'https://exemplo.com/a?x=1&y=2',
  fonte: 'Fonte & Cia',
  titulo: 'Título com <script>alert(1)</script>',
  motivos: [{ codigo: 'vocabulario_spam', peso: 'grave', detalhe: 'termos: gacor, judi' }],
};

test('sem itens não gera bloco nenhum', () => {
  assert.equal(blocoDiagnosticoHTML([]), '');
  assert.equal(blocoDiagnosticoHTML(null), '');
});

test('escapa HTML vindo do título e da URL', () => {
  const html = blocoDiagnosticoHTML([item]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Fonte &amp; Cia'));
  assert.ok(html.includes('DESCARTADO'));
  assert.ok(html.includes('[GRAVE]'));
});

test('modo bloqueado avisa que o E-goi não recebeu rascunho', () => {
  const html = blocoDiagnosticoHTML([{ ...item, acao: 'bloqueio' }], { bloqueado: true });
  assert.ok(html.includes('Envio bloqueado'));
  assert.ok(html.includes('E-goi'));
  assert.ok(html.includes('BLOQUEADO'));
});
