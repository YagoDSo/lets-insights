// Teste rápido de conexão com o Google Sheets.
// Uso: npm run test-conexao
// Confirma que a Service Account tem acesso e lê o cabeçalho + contagem das abas.
import { config } from './lib/config.js';
import { lerAba } from './lib/store.js';

async function main() {
  console.log(`Doc ID: ${config.sheetsDocId}`);

  for (const aba of [config.abaArtigos, config.abaEdicoes]) {
    try {
      const { header, rows } = await lerAba(aba);
      console.log(`\n✓ Aba "${aba}" acessível.`);
      console.log(`  Colunas: ${header.join(', ') || '(vazia)'}`);
      console.log(`  Linhas de dados: ${rows.length}`);
    } catch (e) {
      console.log(`\n✗ Falha ao ler "${aba}": ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('✗ Conexão falhou:', e.message);
  console.error('Verifique: (1) Sheets API ativada, (2) planilha compartilhada com o e-mail da Service Account como Editor, (3) credencial no .env.');
  process.exit(1);
});
