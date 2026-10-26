import 'dotenv/config';

// Configuração central. Lê do .env (local) ou dos Secrets (GitHub Actions).
export const config = {
  // Claude API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  // out/2026: Sonnet 4.5 → Sonnet 5.5 (com raciocínio desligado, ver lib/claude.js).
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  // out/2026: chamadas via API de lote (metade do preço), com volta para a
  // chamada normal se o lote não terminar até loteLimite (horário de Brasília).
  claudeLote: process.env.CLAUDE_LOTE !== 'desligado',
  loteLimite: process.env.CLAUDE_LOTE_LIMITE || '06:00',

  // Gemini API (geração de imagem fallback — ver lib/imagegen.js)
  geminiApiKey: process.env.GEMINI_API_KEY,

  // Banco de dados (SQLite commitado no repo — ver lib/db.js)
  dbPath: process.env.SQLITE_DB_PATH || 'data/newsletter.db',
  abaArtigos: 'artigos_coletados',
  abaEdicoes: 'edicoes',

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
  egoiListas: [
    { id: Number(process.env.EGOI_LIST_GESTORES) || 67, nome: 'Gestores 2025' },
    { id: Number(process.env.EGOI_LIST_CONDUTORES) || 34, nome: 'Condutores 2023' },
    { id: Number(process.env.EGOI_LIST_BASE_LETS) || 69, nome: "Base de Usuários Let's" },
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
