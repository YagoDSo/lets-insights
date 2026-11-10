import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarRelevanciaComSegmentos, classificarSegmento } from '../wf01-coleta.js';

// Casos reais do banco (nov/2026). Ver EXCLUSAO_PASSAGEIROS em wf01-coleta.js.
const passa = (titulo, resumo = '') => {
  const log = console.log; console.log = () => {};
  try { return filtrarRelevanciaComSegmentos([{ titulo, resumo, url: 'u', fonte: 'X' }]).length === 1; } finally { console.log = log; }
};

test('transporte de passageiros sai do pool (edição 24 e histórico)', () => {
  assert.equal(passa('Minas Gerais analisa transferência de duas linhas de ônibus entre Viação Raulsoarense e Empresa São José, que possuem ligação societária',
    'Governo abre prazo antes da decisão sobre as concessões de serviços de ônibus intermunicipais entre as empresas'), false);
  assert.equal(passa('MPF aguarda decisão da Justiça sobre pedidos de 265 empresas de ônibus; disputa pode repercutir na primeira Janela da ANTT', 'mercado'), false);
  assert.equal(passa('ANTT recorre ao STJ para retomar controle de 769 mercados de ônibus interestaduais', 'empresa'), false);
});

test('falsos positivos do teste contra o histórico continuam passando', () => {
  // "rodoviária" como adjetivo e "Comissão de Viação e Transportes" da Câmara.
  assert.equal(passa('Crédito do BNDES pode ampliar investimentos em rodovias do Espírito Santo', 'obras na malha rodoviária do estado, investimento em infraestrutura'), true);
  assert.equal(passa('Comissão aprova incentivo tributário para indústria ferroviária', 'aprovado pela Comissão de Viação e Transportes da Câmara; setor de mineração e logística'), true);
  // "aviação" contém "viacao" mas não é palavra inteira.
  assert.equal(passa('Frota de aviação agrícola cresce no setor florestal', 'empresa amplia frota'), true);
  // Van de frota com "passageiros" segue passando (termo solto não é excluído).
  assert.equal(passa('Citroën Jumpy ganha versões para até nove passageiros', 'utilitário para frota de empresas'), true);
});

test('passageiros também não entram em segmento', () => {
  const r = classificarSegmento({ titulo: 'Concessão de linhas de ônibus intermunicipais em obra de rodovia', resumo: 'licitação e engenharia' });
  assert.equal(r.segmento, '');
});
