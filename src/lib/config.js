import 'dotenv/config';

// Configuração central. Lê do .env (local) ou dos Secrets (GitHub Actions).
export const config = {
  // Claude API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  // Modelo mais barato usado só na busca web (WF-01): tarefa de extração/
  // filtragem estruturada, não redação — não precisa do Sonnet usado em
  // curadoria/redação. Ver CLAUDE.md "Otimização de custo de tokens (jul/2026)".
  claudeModelBusca: process.env.CLAUDE_MODEL_BUSCA || 'claude-haiku-4-5-20251001',

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
