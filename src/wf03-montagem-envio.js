// ════════════════════════════════════════════════════════════
// WF-03 — Montagem HTML + Envio (porte fiel do PROD-WF-03.json)
// Fluxo: Ler Edições → Selecionar edição pronta → Montar HTML Cerberus →
//   Enviar preview → Atualizar status
//
// jul/2026: o scraping do blog Lets (post recente + imagem) saiu daqui —
// agora roda no WF-02, antes da redação, pra IA poder escrever um título
// sobre o post (ver json_blog). Este workflow só lê o que já foi
// persistido no banco, sem scraping ao vivo.
//
// nov/2026: news segmentada (ver docs/plano-news-segmentada.md). Monta as 7
// versões gravadas pelo WF-02 em edicoes_versoes: preview no Gmail com a
// geral comercial no corpo e as outras 6 em anexo; rascunhos no E-goi
// conforme config.egoiListas[].envios (34/69: geral comercial; 67: 5
// segmentadas + geral para clientes). O teste de posição do CTA saiu.
// Antes do preview, reconfere a integridade de todos os links (revalidarLinks):
// reprovou, o preview sai com [BLOQUEADO], nenhum rascunho é criado e o job falha.
// ════════════════════════════════════════════════════════════
import { config, requireEnv } from './lib/config.js';
import { lerAba, upsertLinhas, commitarBanco } from './lib/db.js';
import { montarHTML, LINHA_IDENTIDADE_CLIENTE } from './lib/template.js';
import { enviarPreview } from './lib/sender.js';
import { criarRascunho, agendarEnvio } from './lib/egoi-campaign.js';
import { proximoEnvio, checarAntesDeAgendar } from './lib/agendamento.js';
import { buscarPagina } from './lib/paginas.js';
import { verificarIntegridade, resumirMotivos } from './lib/integridade.js';
import { blocoDiagnosticoHTML } from './lib/diagnostico.js';

const COMERCIAL = 'geral_comercial';
const GERAL_CLIENTES = 'geral_clientes';
const ORDEM_VERSOES = [COMERCIAL, GERAL_CLIENTES, 'mineracao', 'industria', 'engenharia', 'tecnologia', 'florestal'];
// Mínimo de itens para agendar: gerais = blog + 3; segmentadas = 5.
const minimoItens = (versao) => (versao === COMERCIAL || versao === GERAL_CLIENTES ? 4 : 5);

// ─── Reconferência na hora do envio ──────────────────────────
// O WF-02 já verificou a integridade de cada link, mas o disparo real sai
// depois da geração: a edição 16 ficou em rascunho de 15/09 em diante com um
// link sequestrado. Uma página pode ser trocada nessa janela, então os links
// são reconferidos aqui, logo antes do preview. Custo: 1 requisição HTTP por
// link (4 em paralelo), nenhum token de API.
async function revalidarLinks(itens) {
  const problemas = [];
  const bloqueio = (item, motivos) => problemas.push({
    etapa: 'wf03 (reconferência)', acao: 'bloqueio', url: item.url, fonte: item.fonte, titulo: item.titulo, motivos,
  });
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const item = itens[proximo++];
      const { html, urlFinal, status } = await buscarPagina(item.url);
      if (status >= 400) {
        bloqueio(item, [{ codigo: 'http_invalido', peso: 'grave', detalhe: `HTTP ${status}` }]);
        continue;
      }
      if (status === 0) {
        console.log(`  ~ ${item.url}: sem resposta (rede). Mantido, mesmo critério do WF-02.`);
        continue;
      }
      // titulo_original é o título como o feed publicou, gravado pelo WF-02
      // (não existe no blog nem em edições antigas: aí a comparação de título
      // fica de fora e sobram spam/idioma/redirect, que já são as mais fortes).
      // A imagem fica de fora: a gravada já passou pelo WF-02 e pode estar
      // legitimamente em outro host (re-hospedada em raw.githubusercontent.com).
      const r = verificarIntegridade({ url: item.url, urlFinal, html, tituloRss: item.titulo_original || '', resumoRss: '' });
      const graves = r.motivos.filter((m) => m.peso === 'grave');
      if (graves.length > 0) bloqueio(item, graves);
      else if (r.motivos.length > 0) console.log(`  ~ ${item.url}: ${resumirMotivos(r.motivos)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, itens.length) }, trabalhador));
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
  if (!config.modoTeste) requireEnv(['GMAIL_USER', 'GMAIL_APP_PASSWORD']);

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

  // Versões da edição. Edição gerada antes da news segmentada não tem linhas
  // em edicoes_versoes: as duas gerais saem da linha de edicoes e cada envio
  // segmentado cai na geral para clientes (ver abaixo).
  const { rows: linhasVersoes } = await lerAba(config.abaVersoes);
  const daEdicao = Object.fromEntries(
    linhasVersoes.filter((v) => String(v.edicao) === String(selected.edicao)).map((v) => [v.versao, v]),
  );
  if (!daEdicao[COMERCIAL]) {
    console.log('⚠️ Edição sem versões em edicoes_versoes: só as versões gerais, a partir de edicoes.');
    for (const versao of [COMERCIAL, GERAL_CLIENTES]) daEdicao[versao] = { versao, status: 'pronto', legado: true };
  }

  // "Montar HTML1": uma montagem por versão pronta. A comercial leva o CTA
  // (json_cta, da linha de edicoes); as de cliente, a linha de identidade.
  const montadas = {};
  for (const versao of ORDEM_VERSOES) {
    const v = daEdicao[versao];
    if (!v) continue;
    if (v.status !== 'pronto') {
      console.log(`⚠️ Versão ${versao} está "${v.status}": fica fora do preview e dos rascunhos.`);
      continue;
    }
    const dados = v.legado ? selected : { ...v, json_cta: selected.json_cta };
    const opts = versao === COMERCIAL ? {} : { semCta: true, linhaIdentidade: LINHA_IDENTIDADE_CLIENTE };
    montadas[versao] = montarHTML(dados, opts);
    const m = montadas[versao];
    console.log(`  ${versao.padEnd(16)} ${m.qtd_itens} itens | ${m.html_final.length} chars | ${m.assunto_preview}`);
  }
  const principal = montadas[COMERCIAL];
  if (!principal) throw new Error('Versão geral comercial não montada.');

  // Reconferência de integridade de todos os links que vão sair (blog +
  // artigos das versões montadas, cada URL uma vez), logo antes do preview.
  const itensParaConferir = new Map();
  for (const versao of Object.keys(montadas)) {
    const v = daEdicao[versao];
    const itens = v.legado
      ? [parseJSON(selected.json_blog, null), ...parseJSON(selected.json_artigos_principais, [])]
      : parseJSON(v.json_itens, []);
    for (const item of itens) if (item?.url && !itensParaConferir.has(item.url)) itensParaConferir.set(item.url, item);
  }
  console.log(`\nReconferindo ${itensParaConferir.size} link(s) antes do envio...`);
  const problemas = await revalidarLinks([...itensParaConferir.values()]);
  const bloqueado = problemas.length > 0;
  if (bloqueado) {
    console.error(`✗ ${problemas.length} link(s) reprovado(s) na reconferência:`);
    problemas.forEach((p) => console.error(`  - ${p.url}: ${resumirMotivos(p.motivos)}`));
  } else {
    console.log('✓ Todos os links seguem apontando para o conteúdo esperado.');
  }

  // "Criar Anexo HTML1" + "Gmail - Enviar Preview1": geral comercial no
  // corpo, as outras versões em anexo. O bloco de diagnóstico entra só no
  // CORPO do preview (e-mail interno); anexos e rascunhos seguem sem ele.
  const anexos = Object.entries(montadas)
    .filter(([versao]) => versao !== COMERCIAL)
    .map(([versao, m]) => ({
      filename: `lets_insights_${selected.edicao}_${versao}.html`,
      content: Buffer.from(m.html_final, 'utf-8'),
    }));
  const diagnosticoWf02 = parseJSON(selected.json_diagnostico, []);
  const messageId = await enviarPreview({
    assunto: `${bloqueado ? '[BLOQUEADO] ' : ''}${principal.assunto_preview}`,
    html: blocoDiagnosticoHTML([...problemas, ...diagnosticoWf02], { bloqueado }) + principal.html_final,
    anexos,
    para: config.previewTo,
  });
  console.log(`✓ Preview enviado para ${config.previewTo} (messageId: ${messageId}) com ${anexos.length} versão(ões) em anexo`);

  // Reprovou na reconferência: o preview sai (com o alerta no topo) pra
  // mostrar o que houve, mas nada mais acontece: sem rascunho no E-goi, sem
  // mudar o status. Depois de corrigir o link no banco ou de o site voltar
  // ao normal, basta rodar o WF-03 de novo.
  if (bloqueado) {
    throw new Error(
      `Reconferência reprovou ${problemas.length} link(s). Rascunhos do E-goi não criados e status preservado. Veja o preview enviado para ${config.previewTo}.`,
    );
  }

  // Rascunhos "POR PUBLICAR" no E-goi, um por envio de cada lista
  // (config.egoiListas[].envios), pra revisão manual antes do envio real.
  // Só CRIA (status "draft") — nunca dispara /actions/send; isso continua
  // exigindo autorização explícita do Yago a cada campanha, na hora que ele
  // mesmo decidir enviar pelo E-goi. Falha aqui não derruba o WF-03: o
  // preview do Gmail (passo crítico de validação) já foi enviado acima.
  //
  // Agendamento automático (decisão do Yago em 2026-10-22): com o
  // interruptor EGOI_AGENDAMENTO=ligado, cada rascunho que passar nas
  // checagens é agendado pra terça 07h30 (BRT), no segmento salvo do envio,
  // e o Yago recebe um resumo; ele cancela pelo painel do E-goi o que estiver
  // errado. Desligado (padrão), nada muda: só rascunho.
  const quando = proximoEnvio();
  const resumo = [];
  for (const lista of config.egoiListas) {
    for (const envio of lista.envios) {
      const nomeEnvio = envio.rotulo ? `${lista.nome} · ${envio.rotulo}` : lista.nome;
      // Versão segmentada que não ficou pronta: o segmento recebe a geral para
      // clientes, em rascunho que nunca é agendado sozinho.
      let versaoUsada = envio.versao;
      const problemasExtras = [];
      if (!montadas[versaoUsada] && versaoUsada !== COMERCIAL) {
        console.log(`⚠️ ${nomeEnvio}: versão ${versaoUsada} indisponível, rascunho com a geral para clientes.`);
        problemasExtras.push(`versão ${versaoUsada} indisponível, rascunho montado com a geral para clientes`);
        versaoUsada = GERAL_CLIENTES;
      }
      const montado = montadas[versaoUsada];
      if (!montado) {
        resumo.push({ lista: nomeEnvio, status: 'sem rascunho', detalhe: `versão ${versaoUsada} indisponível` });
        continue;
      }
      const problemas = [
        ...checarAntesDeAgendar({ montado, previewEnviado: Boolean(messageId), minimoItens: minimoItens(versaoUsada) }),
        ...problemasExtras,
      ];
      const prefixo = config.egoiAgendamento && !problemas.length ? 'AGENDADA' : 'POR PUBLICAR';
      // 67: "POR PUBLICAR · Gestores · Mineração · <manchete>"; 34/69 como antes.
      const internalName = envio.rotulo
        ? `${prefixo} · ${lista.rotulo || lista.nome} · ${envio.rotulo} · ${montado.titulo_edicao}`
        : `${prefixo} · ${montado.titulo_edicao} · ${lista.nome}`;
      let hash;
      try {
        hash = await criarRascunho({
          listId: lista.id,
          internalName,
          subject: montado.assunto_preview,
          html: montado.html_final,
        });
        console.log(`✓ Rascunho E-goi criado (${nomeEnvio}): ${hash} · ${internalName}`);
      } catch (e) {
        console.error(`✗ Falha ao criar rascunho E-goi (${nomeEnvio}):`, e.message);
        resumo.push({ lista: nomeEnvio, status: 'erro ao criar rascunho', detalhe: e.message });
        continue;
      }
      if (!config.egoiAgendamento) continue;
      if (problemas.length) {
        resumo.push({ lista: nomeEnvio, status: 'NÃO agendada (ficou como rascunho)', detalhe: problemas.join('; ') });
        continue;
      }
      try {
        await agendarEnvio({ campaignHash: hash, listId: lista.id, segmentIds: envio.segmentIds || [], quando });
        console.log(`✓ Agendada (${nomeEnvio}) para ${quando}`);
        resumo.push({ lista: nomeEnvio, status: `agendada para ${quando}`, detalhe: hash });
      } catch (e) {
        console.error(`✗ Falha ao agendar (${nomeEnvio}):`, e.message);
        resumo.push({ lista: nomeEnvio, status: 'NÃO agendada (erro no E-goi, ficou como rascunho)', detalhe: e.message });
      }
    }
  }

  if (config.egoiAgendamento) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const linhas = resumo
      .map((r) => `<tr><td style="padding:4px 10px">${esc(r.lista)}</td><td style="padding:4px 10px"><b>${esc(r.status)}</b></td><td style="padding:4px 10px;color:#777">${esc(r.detalhe)}</td></tr>`)
      .join('');
    const agendadas = resumo.filter((r) => r.status.startsWith('agendada')).length;
    try {
      await enviarPreview({
        assunto: `Let's Insights ${selected.edicao}: ${agendadas} de ${resumo.length} campanhas agendadas para ${quando.slice(8, 10)}/${quando.slice(5, 7)} às ${quando.slice(11, 16)}`,
        html: `<p>Edição ${esc(selected.edicao)} · <b>${esc(principal.assunto_preview)}</b></p>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${linhas}</table>
<p>Para cancelar: no painel do E-goi, abra a campanha agendada (nome começando com "AGENDADA ·") e cancele o agendamento antes do horário.</p>
<p>Para desligar o agendamento automático: mude a variável <code>EGOI_AGENDAMENTO</code> no GitHub para qualquer valor diferente de "ligado".</p>`,
        para: config.previewTo,
      });
      console.log('✓ Resumo do agendamento enviado ao Yago');
    } catch (e) {
      console.error('✗ Falha ao enviar resumo do agendamento:', e.message);
    }
  }

  // "Confirmar Preview1" + "Atualizar Status1"
  // (Correção do bug conhecido: grava na aba Edicoes, preservando as demais colunas.)
  const enviadoEm = new Date().toISOString();
  const linha = {
    ...selected,
    status: 'draft_enviado_com_imagens',
    enviado_em: enviadoEm,
  };
  const res = await upsertLinhas(config.abaEdicoes, [linha], 'edicao');
  const versoesEnviadas = Object.values(daEdicao)
    .filter((v) => !v.legado && montadas[v.versao])
    .map((v) => ({ ...v, status: 'draft_enviado', enviado_em: enviadoEm }));
  await upsertLinhas(config.abaVersoes, versoesEnviadas, ['edicao', 'versao']);
  console.log(`✓ Status atualizado: ${config.abaEdicoes} (${res.atualizados}), ${config.abaVersoes} (${versoesEnviadas.length} versões).`);
  commitarBanco(`chore: WF-03 envio edição ${selected.edicao}`);
}

main().catch((e) => {
  console.error('✗ WF-03 falhou:', e);
  process.exit(1);
});
