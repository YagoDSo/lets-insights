// ─────────────────────────────────────────────────────────────
// Regras do agendamento automático no E-goi (decisão do Yago em
// 2026-10-22, ver CLAUDE.md › Pendências). Funções puras, sem chamada
// de rede, pra dar pra testar sem tocar no E-goi.
// ─────────────────────────────────────────────────────────────

const FUSO = 'America/Sao_Paulo';
const DIA_ENVIO = 2; // terça (0 = domingo)
const HORA_ENVIO = '07:30:00';

// Data de hoje no fuso de Brasília, como { ano, mes, dia, semana }.
function hojeEmBrasilia(agora) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
  return { ano: Number(partes.year), mes: Number(partes.month), dia: Number(partes.day), semana };
}

// Próxima terça-feira às 07:30 (horário de Brasília), sempre num dia
// DEPOIS de hoje, pra garantir a janela de cancelamento. Rodando na
// segunda, cai na terça seguinte (o dia de envio combinado).
// Devolve "AAAA-MM-DD HH:MM:SS".
export function proximoEnvio(agora = new Date()) {
  const h = hojeEmBrasilia(agora);
  let dias = (DIA_ENVIO - h.semana + 7) % 7;
  if (dias === 0) dias = 7;
  const alvo = new Date(Date.UTC(h.ano, h.mes - 1, h.dia + dias));
  const p2 = (n) => String(n).padStart(2, '0');
  return `${alvo.getUTCFullYear()}-${p2(alvo.getUTCMonth() + 1)}-${p2(alvo.getUTCDate())} ${HORA_ENVIO}`;
}

// Checagens antes de agendar uma campanha. Qualquer problema = não agenda
// (fica só como rascunho) e o motivo vai pro e-mail de resumo.
export function checarAntesDeAgendar({ montado, previewEnviado, minimoItens = 4 }) {
  const problemas = [];
  if (!previewEnviado) problemas.push('o preview não foi enviado ao Yago');
  if (!montado || !montado.html_final) problemas.push('HTML vazio');
  else {
    if ((montado.qtd_itens || 0) < minimoItens) problemas.push(`só ${montado.qtd_itens} itens (mínimo ${minimoItens})`);
    // safeURL troca link inválido por "#": se aparecer, algum link da edição veio quebrado.
    if (/href="#"/.test(montado.html_final)) problemas.push('há link inválido no e-mail');
  }
  if (!String(montado?.assunto_preview || '').trim()) problemas.push('assunto vazio');
  return problemas;
}
