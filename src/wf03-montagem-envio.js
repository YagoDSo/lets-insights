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
import { criarRascunho } from './lib/egoi-campaign.js';

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

  // "Montar HTML1" — teste A/B de posição do CTA: gera as 3 variantes
  // (início/meio/fim), todas com o mesmo texto de CTA (json_cta), só
  // mudando posição/estilo do botão. "fim" é o comportamento de produção
  // (vai no corpo do e-mail); as 3 vão em anexo pra comparação.
  const variantes = ['inicio', 'meio', 'fim'].map((ctaPosicao) => ({
    ctaPosicao,
    montado: montarHTML(selected, { ctaPosicao }),
  }));
  const principal = variantes.find((v) => v.ctaPosicao === 'fim').montado;
  console.log(`Edição ${principal.edicao} | Itens: ${principal.qtd_itens} | HTML: ${principal.html_final.length} chars`);

  // "Criar Anexo HTML1" + "Gmail - Enviar Preview1"
  const anexos = variantes.map((v) => ({
    filename: `lets_insights_${selected.edicao}_cta_${v.ctaPosicao}.html`,
    content: Buffer.from(v.montado.html_final, 'utf-8'),
  }));
  const messageId = await enviarPreview({
    assunto: principal.assunto_preview,
    html: principal.html_final,
    anexos,
    para: config.previewTo,
  });
  console.log(`✓ Preview enviado para ${config.previewTo} (messageId: ${messageId}) — 3 variantes de CTA em anexo`);

  // Rascunhos "POR PUBLICAR" no E-goi, um por lista, pra revisão manual
  // antes do envio real. Só CRIA (status "draft") — nunca dispara
  // /actions/send; isso continua exigindo autorização explícita do Yago
  // a cada campanha, na hora que ele mesmo decidir enviar pelo E-goi.
  // Falha aqui não derruba o WF-03: o preview do Gmail (passo crítico
  // de validação) já foi enviado com sucesso acima.
  for (const lista of config.egoiListas) {
    try {
      const hash = await criarRascunho({
        listId: lista.id,
        internalName: `POR PUBLICAR · ${principal.titulo_edicao} · ${lista.nome}`,
        subject: principal.assunto_preview,
        html: principal.html_final,
      });
      console.log(`✓ Rascunho E-goi criado (${lista.nome}): ${hash}`);
    } catch (e) {
      console.error(`✗ Falha ao criar rascunho E-goi (${lista.nome}):`, e.message);
    }
  }

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
