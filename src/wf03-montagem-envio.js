// ════════════════════════════════════════════════════════════
// WF-03 — Montagem HTML + Envio (porte fiel do PROD-WF-03.json)
// Fluxo: Ler Edições → Selecionar edição pronta → Montar HTML Cerberus →
//   Enviar preview → Atualizar status
//
// jul/2026: o scraping do blog Lets (post recente + imagem) saiu daqui —
// agora roda no WF-02, antes da redação, pra IA poder escrever um título
// sobre o post (ver json_blog). Este workflow só lê o que já foi
// persistido no banco, sem scraping ao vivo.
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerAba, upsertLinhas, commitarBanco } from './lib/db.js';
import { montarHTML } from './lib/template.js';
import { enviarPreview } from './lib/sender.js';

// ─── Orquestração ────────────────────────────────────────────
async function main() {
  requireEnv(['GMAIL_USER', 'GMAIL_APP_PASSWORD']);

  // "Ler Todas as Edições1" + "Validar e Selecionar Edição1"
  const { rows } = await lerAba(config.abaEdicoes);
  if (rows.length === 0) throw new Error('Planilha de edições vazia.');
  const prontas = rows.filter(
    (r) => String(r.status || '').trim().toLowerCase() === 'pronto_envio_com_imagens',
  );
  if (prontas.length === 0) {
    const status = [...new Set(rows.map((r) => r.status))].filter(Boolean);
    throw new Error(`Nenhuma edição com status 'pronto_envio_com_imagens'. Status existentes: ${status.join(', ')}.`);
  }
  const selected = prontas.sort((a, b) => String(b.edicao).localeCompare(String(a.edicao)))[0];
  console.log(`Edição selecionada: ${selected.edicao} - ${selected.titulo_edicao}`);

  // "Montar HTML1"
  const montado = montarHTML(selected);
  console.log(`Edição ${montado.edicao} | Itens: ${montado.qtd_itens} | HTML: ${montado.html_final.length} chars`);

  // "Criar Anexo HTML1" + "Gmail - Enviar Preview1"
  const anexo = Buffer.from(montado.html_final, 'utf-8');
  const messageId = await enviarPreview({
    assunto: montado.assunto_preview,
    html: montado.html_final,
    anexoNome: `lets_insights_${selected.edicao}.html`,
    anexoConteudo: anexo,
    para: config.previewTo,
  });
  console.log(`✓ Preview enviado para ${config.previewTo} (messageId: ${messageId})`);

  // "Confirmar Preview1" + "Atualizar Status1"
  // (Correção do bug conhecido: grava na aba Edicoes, preservando as demais colunas.)
  const linha = {
    ...selected,
    status: 'draft_enviado_com_imagens',
    enviado_em: new Date().toISOString(),
  };
  const res = await upsertLinhas(config.abaEdicoes, [linha], 'edicao');
  console.log(`✓ Status atualizado na aba ${config.abaEdicoes}: ${res.atualizados} atualizado(s).`);
  commitarBanco(`chore: WF-03 envio edição ${selected.edicao}`);
}

main().catch((e) => {
  console.error('✗ WF-03 falhou:', e);
  process.exit(1);
});
