import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notaRelevancia } from '../wf01-coleta.js';

// Títulos reais da simulação da edição 24 (nov/2026).
const nota = (titulo, resumo = '', idade_dias = 0) => notaRelevancia({ titulo, resumo, idade_dias });

test('termo do ICP e veículo do ICP sobem a nota', () => {
  assert.ok(nota('Finep amplia para R$ 500 milhões chamada de transformação mineral', 'mineração e mineradoras').nota > 3);
  const eaton = nota('Eaton traz nova caixa de transferência DURA4TRAK para comerciais leves e médios');
  assert.ok(eaton.nota >= 4, JSON.stringify(eaton));
  assert.ok(eaton.motivos.some((m) => m.startsWith('veículo')));
});

test('acidente, ônibus e internacional sem Brasil descem a nota', () => {
  assert.ok(nota('Batida entre ônibus e caminhão na Rodovia Anhanguera deixa feridos').nota <= -5);
  assert.deepEqual(nota('Bitcoin cai aos US$ 73 mil após inflação nos EUA').motivos.includes('internacional'), true);
  // Internacional que fala do Brasil não é penalizado.
  assert.equal(nota('China amplia compra de minério do Brasil', 'exportação brasileira').motivos.includes('internacional'), false);
});

test('falsos positivos conhecidos não são penalizados', () => {
  // "segunda-feira" não é feira; "implementos rodoviários" não é ônibus.
  assert.deepEqual(nota('Operação de frota retomada nesta segunda-feira').motivos.filter((m) => m === 'feira/evento'), []);
  assert.deepEqual(nota('Baú Furgão de 2 eixos firma-se como tendência no mercado de implementos rodoviários').motivos.filter((m) => m === 'ônibus'), []);
});

test('idade só desempata: 1 termo do ICP vale mais que 2 semanas', () => {
  const velhaComIcp = nota('Gestão de frota corporativa ganha nova norma', '', 14).nota;
  const novaSemIcp = nota('Montadora apresenta novo modelo', '', 0).nota;
  assert.ok(velhaComIcp > novaSemIcp);
});
