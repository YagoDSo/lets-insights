import 'dotenv/config';

// Configuração central. Lê do .env (local) ou dos Secrets (GitHub Actions).
export const config = {
  // Claude API
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',

  // Banco de dados (hoje Google Sheets — ver lib/store.js)
  sheetsDocId: process.env.SHEETS_DOC_ID || '1xSjvbZwI-3oLScimPcpBftB2E4muLV07dt1ZOVo3N5s',
  abaEdicoes: process.env.SHEETS_ABA_EDICOES || 'Edicoes',
  abaArtigos: process.env.SHEETS_ABA_ARTIGOS || 'Artigos_Coletados',

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
