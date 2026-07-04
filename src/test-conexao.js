// Teste rápido de conexão com o banco SQLite.
// Uso: npm run test-conexao
// Confirma que o arquivo abre e lê as tabelas artigos_coletados/edicoes.
import { config } from './lib/config.js';
import { lerAba } from './lib/db.js';

async function main() {
  console.log(`Arquivo do banco: ${config.dbPath}`);

  for (const tabela of [config.abaArtigos, config.abaEdicoes]) {
    try {
      const { header, rows } = await lerAba(tabela);
      console.log(`\n✓ Tabela "${tabela}" acessível.`);
      console.log(`  Colunas: ${header.join(', ') || '(vazia)'}`);
      console.log(`  Linhas de dados: ${rows.length}`);
    } catch (e) {
      console.log(`\n✗ Falha ao ler "${tabela}": ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error('✗ Conexão falhou:', e.message);
  process.exit(1);
});
