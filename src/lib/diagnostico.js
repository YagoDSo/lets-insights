// Bloco de diagnóstico do e-mail de preview.
//
// Motivação: antes, um artigo descartado na validação sumia em silêncio —
// o motivo só existia no log do GitHub Actions, que ninguém abre toda
// terça. O bloco abaixo entra SOMENTE no corpo do preview (interno); o
// HTML de produção, o que vai em anexo e o que vira rascunho no E-goi
// continuam sem ele.

const escapar = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const CORES = {
  bloqueio: { fundo: '#fdecea', borda: '#c0392b', titulo: '#922b21' },
  aviso: { fundo: '#fff8e1', borda: '#f15a22', titulo: '#8a4b20' },
};

// itens: [{etapa, acao, url, fonte, titulo, motivos: [{codigo, peso, detalhe}]}]
export function blocoDiagnosticoHTML(itens, { bloqueado = false } = {}) {
  const lista = (itens || []).filter(Boolean);
  if (lista.length === 0) return '';
  const cor = bloqueado ? CORES.bloqueio : CORES.aviso;

  const linhas = lista
    .map((item) => {
      const motivos = (item.motivos || [])
        .map((m) => `<li>${m.peso === 'grave' ? '<strong>[GRAVE]</strong> ' : ''}${escapar(m.codigo)}: ${escapar(m.detalhe)}</li>`)
        .join('');
      const rotulo = item.acao === 'descartado' ? 'DESCARTADO' : item.acao === 'bloqueio' ? 'BLOQUEADO' : 'RESSALVA';
      return `<tr><td style="padding:10px 12px;border-top:1px solid ${cor.borda}33;font:13px/1.5 Arial,sans-serif;color:#333;">
<strong>${escapar(rotulo)}</strong> · ${escapar(item.fonte || 'fonte desconhecida')} · <span style="color:#666;">${escapar(item.etapa || '')}</span><br>
<span style="color:#555;">${escapar(item.titulo || '')}</span><br>
<a href="${escapar(item.url || '')}" style="color:#0b63ce;word-break:break-all;">${escapar(item.url || '')}</a>
<ul style="margin:6px 0 0 18px;padding:0;color:#555;">${motivos}</ul>
</td></tr>`;
    })
    .join('');

  const cabecalho = bloqueado
    ? 'Envio bloqueado: link da edição falhou na reconferência'
    : 'Diagnóstico de integridade (uso interno)';
  const explicacao = bloqueado
    ? 'Os rascunhos no E-goi NÃO foram criados e o status da edição não foi atualizado. Corrija o item abaixo antes de reenviar.'
    : 'Itens que a verificação de conteúdo descartou ou marcou com ressalva ao montar esta edição. Nada aqui aparece no e-mail que vai para a base.';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cor.fundo};border:2px solid ${cor.borda};border-radius:4px;margin:0 0 16px 0;">
<tr><td style="padding:12px;font:bold 15px/1.4 Arial,sans-serif;color:${cor.titulo};">${cabecalho}</td></tr>
<tr><td style="padding:0 12px 10px;font:13px/1.5 Arial,sans-serif;color:#555;">${explicacao}</td></tr>
${linhas}
</table>`;
}
