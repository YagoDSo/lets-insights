import { config } from './lib/config.js';
import { listarCampanhas, relatorioEmail } from './lib/egoi-reports.js';
import { getTaskMarkdown, updateTaskMarkdown } from './lib/clickup.js';

// ════════════════════════════════════════════════════════════
// Atualiza a tabela "Números Baseados na campanha do Egoi" na task
// ClickUp 86ahderm5 com os números mais recentes de cada edição da
// Let's Insights. Roda 3 dias depois do disparo (sexta), pra dar tempo
// de aberturas/cliques se acumularem.
//
// Numeração: a linha "Edição 1" (piloto, 28/05/2026, "Les's Insights
// 1...") é anterior à série "Newsletter" e fica fixa/hardcoded — nunca
// recalculada aqui. As edições da série Newsletter são numeradas por
// ORDEM CRONOLÓGICA DE ENVIO (não pelo número no internal_name do
// E-goi, que tem bugs conhecidos — ver CLAUDE.md regra 7), começando
// em 2. Isso resolve os bugs de numeração automaticamente pra sempre,
// inclusive edições futuras, sem precisar de exceções hardcoded.
//
// Exceção pontual de autorização (Yago, 2026-08-10): só esta tarefa,
// só esta tabela — nenhuma outra ação no ClickUp.
// ════════════════════════════════════════════════════════════

const LISTAS = { 34: 'Condutores 2023', 67: 'Gestores 2025', 69: "Base Usuários Let's" };
const ORDEM_LISTAS = ['Gestores 2025', 'Condutores 2023', "Base Usuários Let's"];

const LINHAS_PILOTO = `| 1 | 28/05/2026 | Gestores 2025 | 527 | 14.07% | 8.11% | 3% |
| 1 | 28/05/2026 | Base Usuários Let's | 2.636 | 11.03% | 4.17% | 3% |
| 1 | 28/05/2026 | Fornecedores | 4.779 | 16.91% | 2.01% | 4% |`;

function formatarPct(valor) {
  return `${(valor * 100).toFixed(2)}%`;
}

async function coletarNumeros() {
  const { items } = await listarCampanhas({
    channel: 'email',
    status: 'sent',
    startDateMin: '2026-01-01 00:00:00',
    startDateMax: '2026-12-31 23:59:59',
    limit: 200,
  });
  const newsletters = items.filter((c) => /^Newsletter\s+\d+/i.test(c.internal_name));

  // Agrupa por data de envio (1 edição = até 3 campanhas, 1 por lista, no mesmo dia).
  const porData = {};
  for (const c of newsletters) {
    const dia = c.start_date.slice(0, 10);
    (porData[dia] ??= []).push(c);
  }
  const diasOrdenados = Object.keys(porData).sort();

  const linhas = [];
  for (let i = 0; i < diasOrdenados.length; i++) {
    const dia = diasOrdenados[i];
    const edicao = i + 2; // +2: edição 1 é o piloto (hardcoded acima)
    const dataFormatada = `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

    const porLista = {};
    for (const c of porData[dia]) {
      const relatorio = await relatorioEmail(c.campaign_hash);
      const overall = relatorio.overall || {};
      const ctaClicks = (relatorio.url || [])
        .filter((u) => u.url.includes('solicitar-proposta'))
        .reduce((soma, u) => soma + u.clicks, 0);
      const lista = LISTAS[c.list_id];
      if (!porLista[lista]) porLista[lista] = { sends: 0, opens: 0, clicks: 0, cta: 0 };
      porLista[lista].sends += overall.sends || 0;
      porLista[lista].opens += overall.unique_opens || 0;
      porLista[lista].clicks += overall.unique_clicks || 0;
      porLista[lista].cta += ctaClicks;
    }

    for (const lista of ORDEM_LISTAS) {
      const n = porLista[lista];
      if (!n || !n.sends) {
        linhas.push(`| ${edicao} | ${dataFormatada} | ${lista} |  |  |  |  |`);
        continue;
      }
      const abertura = n.opens / n.sends;
      const ctr = n.opens ? n.clicks / n.opens : 0;
      const botao = n.opens ? n.cta / n.opens : 0;
      linhas.push(
        `| ${edicao} | ${dataFormatada} | ${lista} | ${n.sends} | ${formatarPct(abertura)} | ${formatarPct(ctr)} | ${formatarPct(botao)} |`,
      );
    }
  }
  return linhas.join('\n');
}

async function main() {
  const linhasNewsletter = await coletarNumeros();
  const hoje = new Date().toISOString().slice(0, 10);

  const novaTabela = `Números Baseados na campanha do Egoi (atualizado automaticamente em ${hoje} — CTR = cliques únicos ÷ aberturas, Botão = cliques no CTA "Falar com Especialista" ÷ aberturas):

| Edição | Data | Lista | Enviados | Abertura | CTR | Botão |
| ---| ---| ---| ---| ---| ---| --- |
${LINHAS_PILOTO}
${linhasNewsletter}`;

  const markdownAtual = await getTaskMarkdown(config.clickupTaskId);

  // Substitui só o bloco entre "Números Baseados..." e "_Responsável: Yago_",
  // preservando todo o resto da descrição intacto.
  const regexBloco = /Números Baseados na campanha do Egoi[\s\S]*?(?=\n\n_Responsável: Yago_)/;
  if (!regexBloco.test(markdownAtual)) {
    throw new Error('Bloco da tabela não encontrado na descrição atual — abortando pra não corromper a task.');
  }
  const markdownNovo = markdownAtual.replace(regexBloco, novaTabela);

  await updateTaskMarkdown(config.clickupTaskId, markdownNovo);

  // Verificação pós-escrita: confirma que o resto da descrição sobreviveu.
  const markdownVerificado = await getTaskMarkdown(config.clickupTaskId);
  const marcadores = ['## Sobre o projeto', '## Como funciona a newsletter automatizada', '_Responsável: Yago_'];
  const faltando = marcadores.filter((m) => !markdownVerificado.includes(m));
  if (faltando.length) {
    throw new Error(
      `Possível corrupção da descrição após update — marcadores sumiram: ${faltando.join(', ')}. Verifique a task manualmente.`,
    );
  }

  console.log(`✓ Task ${config.clickupTaskId} atualizada com sucesso.`);
}

main().catch((e) => {
  console.error('✗ report-clickup falhou:', e.message);
  process.exit(1);
});
