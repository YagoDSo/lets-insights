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
import { buscarPagina } from './lib/paginas.js';
import { verificarIntegridade, resumirMotivos } from './lib/integridade.js';
import { blocoDiagnosticoHTML } from './lib/diagnostico.js';

// ─── Reconferência na hora do envio ──────────────────────────
// O WF-02 já verificou a integridade de cada link, mas o disparo real é
// manual e costuma sair dias depois: a edição 16 ficou em rascunho de
// 15/09 em diante. Uma página pode ser sequestrada nessa janela, então
// os links são reconferidos aqui, imediatamente antes de montar o HTML.
// Custo: 4 requisições HTTP, nenhum token de API.
async function revalidarLinks(itens) {
  const problemas = [];
  for (const item of itens) {
    if (!item.url) continue;
    const { html, urlFinal, status } = await buscarPagina(item.url);
    if (status >= 400) {
      problemas.push({
        etapa: 'wf03 (reconferência)',
        acao: 'bloqueio',
        url: item.url,
        fonte: item.fonte,
        titulo: item.titulo,
        motivos: [{ codigo: 'http_invalido', peso: 'grave', detalhe: `HTTP ${status}` }],
      });
      continue;
    }
    if (status === 0) {
      console.log(`  ~ ${item.url}: sem resposta (rede). Mantido, mesmo critério do WF-02.`);
      continue;
    }
    // titulo_original é o título como o feed publicou, gravado pelo WF-02.
    // Sem ele (edições anteriores a set/2026), a comparação de título fica
    // de fora e sobram spam/idioma/redirect, que já são as mais fortes.
    // A imagem fica de fora: a que está gravada já passou pela validação do
    // WF-02 e pode ser legitimamente de outro host (as geradas por IA ficam
    // em raw.githubusercontent.com), então compará-la com o host do artigo
    // aqui só produziria ruído, sem dizer nada novo sobre sequestro.
    const r = verificarIntegridade({
      url: item.url,
      urlFinal,
      html,
      tituloRss: item.titulo_original || '',
      resumoRss: '',
    });
    const graves = r.motivos.filter((m) => m.peso === 'grave');
    if (graves.length > 0) {
      problemas.push({
        etapa: 'wf03 (reconferência)',
        acao: 'bloqueio',
        url: item.url,
        fonte: item.fonte,
        titulo: item.titulo,
        motivos: graves,
      });
    } else if (r.motivos.length > 0) {
      console.log(`  ~ ${item.url}: ${resumirMotivos(r.motivos)}`);
    }
  }
  return problemas;
}

const parseJSON = (valor, padrao) => {
  try {
    const v = JSON.parse(valor);
    return v == null ? padrao : v;
  } catch {
    return padrao;
  }
};

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

  // Reconferência dos 4 links (blog + 3 artigos) antes de montar o HTML.
  const artigosEdicao = parseJSON(selected.json_artigos_principais, []);
  const blogEdicao = parseJSON(selected.json_blog, null);
  const itensParaConferir = [...(blogEdicao ? [blogEdicao] : []), ...artigosEdicao];
  console.log(`\nReconferindo ${itensParaConferir.length} link(s) antes do envio...`);
  const problemas = await revalidarLinks(itensParaConferir);
  const bloqueado = problemas.length > 0;
  if (bloqueado) {
    console.error(`✗ ${problemas.length} link(s) reprovado(s) na reconferência:`);
    problemas.forEach((p) => console.error(`  - ${p.url}: ${resumirMotivos(p.motivos)}`));
  } else {
    console.log('✓ Todos os links seguem apontando para o conteúdo esperado.');
  }

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
  // O bloco de diagnóstico entra só no CORPO do preview (e-mail interno).
  // Os anexos e o HTML que vira rascunho no E-goi seguem sem ele.
  const diagnosticoWf02 = parseJSON(selected.json_diagnostico, []);
  const corpoPreview =
    blocoDiagnosticoHTML([...problemas, ...diagnosticoWf02], { bloqueado }) + principal.html_final;

  const messageId = await enviarPreview({
    assunto: `${bloqueado ? '[BLOQUEADO] ' : ''}${principal.assunto_preview}`,
    html: corpoPreview,
    anexos,
    para: config.previewTo,
  });
  console.log(`✓ Preview enviado para ${config.previewTo} (messageId: ${messageId}) — 3 variantes de CTA em anexo`);

  // Reprovou na reconferência: o preview sai (com o alerta no topo) pra
  // você ver o que houve, mas nada mais acontece — sem rascunho no E-goi,
  // sem mudar o status. Assim, depois de corrigir o link no banco ou de o
  // site voltar ao normal, basta rodar o WF-03 de novo: a edição continua
  // como 'pronto_envio_com_imagens' e é selecionada normalmente.
  if (bloqueado) {
    throw new Error(
      `Reconferência reprovou ${problemas.length} link(s). Rascunhos do E-goi não criados e status preservado. Veja o preview enviado para ${config.previewTo}.`,
    );
  }

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
