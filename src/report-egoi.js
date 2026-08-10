import { listarCampanhas, relatorioEmail } from './lib/egoi-reports.js';

// Lista campanhas de email enviadas em 2026 e traz enviados/abertos/cliques de cada uma.
async function main() {
  const { items: campanhas, total_items: totalItens } = await listarCampanhas({
    channel: 'email',
    status: 'sent',
    startDateMin: '2026-01-01 00:00:00',
    startDateMax: '2026-12-31 23:59:59',
    limit: 200,
  });

  if (!campanhas?.length) {
    console.log('Nenhuma campanha de email enviada em 2026 encontrada.');
    return;
  }

  console.log(`${campanhas.length} de ${totalItens} campanha(s) encontrada(s) em 2026:\n`);
  if (totalItens > campanhas.length) {
    console.log(`(aviso: há mais campanhas do que o limite atual trouxe — aumentar "limit" ou paginar)\n`);
  }

  for (const campanha of campanhas) {
    const relatorio = await relatorioEmail(campanha.campaign_hash);
    const overall = relatorio?.overall || relatorio?.data?.overall;
    console.log(`— ${campanha.internal_name} (${campanha.start_date})`);
    console.log(`  hash: ${campanha.campaign_hash}`);
    console.log(
      `  enviados: ${overall?.sends ?? '?'} | abertos únicos: ${overall?.unique_opens ?? '?'} | cliques únicos: ${overall?.unique_clicks ?? '?'} | bounces: ${(overall?.hard_bounces ?? 0) + (overall?.soft_bounces ?? 0)}`,
    );
    console.log('');
  }
}

main().catch((erro) => {
  console.error('Erro ao consultar E-goi:', erro.message);
  process.exitCode = 1;
});
