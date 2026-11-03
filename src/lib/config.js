import 'dotenv/config';

// Configuração central. Lê do .env (local) ou dos Secrets (GitHub Actions).
export const config = {
  // Claude API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  // out/2026: Sonnet 4.5 → Sonnet 5.5 (com raciocínio desligado, ver lib/claude.js).
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  // nov/2026: curadoria no Haiku 5.5 (~19x mais barato que o Sonnet no teste
  // das edições 19-23), decisão do Yago por verba. A redação fica no Sonnet.
  claudeModelCuradoria: process.env.CLAUDE_MODEL_CURADORIA || 'claude-haiku-5-5',
  // out/2026: chamadas via API de lote (metade do preço), com volta para a
  // chamada normal se o lote não terminar até loteLimite (horário de Brasília).
  claudeLote: process.env.CLAUDE_LOTE !== 'desligado',
  // 14:30: o preview pode chegar até as 15h de segunda (decisão do Yago,
  // 26/10/2026); 30 min de folga pra chamada normal, imagens e WF-03.
  loteLimite: process.env.CLAUDE_LOTE_LIMITE || '14:30',
  // Teto de espera por execução: o GitHub encerra job com mais de 6h.
  loteEsperaMaxMin: Number(process.env.CLAUDE_LOTE_ESPERA_MAX_MIN) || 330,

  // Banco de dados (SQLite commitado no repo — ver lib/db.js)
  dbPath: process.env.SQLITE_DB_PATH || 'data/newsletter.db',
  abaArtigos: 'artigos_coletados',
  abaEdicoes: 'edicoes',
  // News segmentada (nov/2026): uma linha por versão da edição (PK edicao + versao).
  abaVersoes: 'edicoes_versoes',

  // Modo de teste (MODO_TESTE=ligado): roda o pipeline de verdade contra o
  // banco, mas não envia e-mail, não cria campanha no E-goi e não commita
  // nada; grava o que seria enviado em testeDir (ver sender.js,
  // egoi-campaign.js, gitAssets.js e db.js). Aponte SQLITE_DB_PATH para uma
  // cópia do banco.
  modoTeste: process.env.MODO_TESTE === 'ligado',
  testeDir: process.env.TESTE_DIR || 'saida-teste',

  // Envio (hoje Gmail preview — ver lib/sender.js)
  sender: process.env.SENDER || 'gmail',
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  previewTo: process.env.PREVIEW_TO || process.env.GMAIL_USER,

  // E-goi (relatórios de campanhas — ver lib/egoi-reports.js)
  egoiApiKey: process.env.EGOI_API_KEY,

  // E-goi (criação de rascunhos "POR PUBLICAR" — ver lib/egoi-campaign.js)
  egoiSenderId: Number(process.env.EGOI_SENDER_ID) || 2, // "Let's Terceirização de Frotas" <lets@lets.com.br>
  // Interruptor do agendamento automático (decisão de 2026-10-22). Só liga
  // com o valor exato "ligado" na variável EGOI_AGENDAMENTO do GitHub.
  egoiAgendamento: process.env.EGOI_AGENDAMENTO === 'ligado',
  // envios: cada rascunho que a lista recebe por semana (versao = chave em
  // edicoes_versoes; segmentIds = segmentos salvos do E-goi, usados pelo
  // agendamento; vazio = lista inteira).
  // 34 e 69: segmento salvo "Newsletter sem duplicados" (decisão de
  // 2026-11-03). Gestores é a lista padrão; quem também está nela recebe a
  // tag "Duplicado Gestores" (id 28) em 34/69 e fica fora desses envios.
  // Entre 34 e 69, Condutores fica com a pessoa (tag 28 também na 69).
  // 67 (news segmentada, decisão de 2026-10-22): segmentos salvos criados
  // pelo Yago em 2026-11-03 a partir do campo Segmento (field_id 21):
  // 1 Mineração, 2 Indústria, 3 Engenharia, 4 Tecnologia, 5 Florestal,
  // 6 ou vazio = Geral.
  egoiListas: [
    {
      id: Number(process.env.EGOI_LIST_GESTORES) || 67,
      nome: 'Gestores 2025',
      rotulo: 'Gestores',
      envios: [
        { versao: 'mineracao', rotulo: 'Mineração', segmentIds: [57] },
        { versao: 'industria', rotulo: 'Indústria', segmentIds: [58] },
        { versao: 'engenharia', rotulo: 'Engenharia', segmentIds: [59] },
        { versao: 'tecnologia', rotulo: 'Tecnologia', segmentIds: [60] },
        { versao: 'florestal', rotulo: 'Florestal', segmentIds: [61] },
        { versao: 'geral_clientes', rotulo: 'Geral', segmentIds: [62] },
      ],
    },
    {
      id: Number(process.env.EGOI_LIST_CONDUTORES) || 34,
      nome: 'Condutores 2023',
      envios: [{ versao: 'geral_comercial', segmentIds: [56] }],
    },
    {
      id: Number(process.env.EGOI_LIST_BASE_LETS) || 69,
      nome: "Base de Usuários Let's",
      envios: [{ versao: 'geral_comercial', segmentIds: [55] }],
    },
  ],

  // ClickUp (relatório automático de números do E-goi — ver lib/clickup.js
  // e report-clickup.js). Exceção pontual: só essa tarefa, só essa tabela.
  clickupApiToken: process.env.CLICKUP_API_TOKEN,
  clickupTaskId: process.env.CLICKUP_TASK_ID || '86ahderm5',
};

// Falha cedo e com mensagem clara se faltar credencial obrigatória.
export function requireEnv(chaves) {
  const faltando = chaves.filter((k) => !process.env[k]);
  if (faltando.length) {
    throw new Error(
      `Variáveis de ambiente faltando: ${faltando.join(', ')}. ` +
        `Configure no .env (local) ou nos Secrets do GitHub Actions.`,
    );
  }
}
