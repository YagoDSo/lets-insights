import fs from 'node:fs';
import path from 'node:path';
import { git } from './gitBin.js';

// ─────────────────────────────────────────────────────────────
// Hospeda imagens geradas (ver lib/imagegen.js) commitando-as no próprio
// repositório e servindo via raw.githubusercontent.com. Regra do projeto:
// e-mail nunca usa imagem base64 inline, sempre URL pública.
// ─────────────────────────────────────────────────────────────
const REPO = process.env.GITHUB_REPOSITORY || 'YagoDSo/lets-insights';
const BRANCH = 'main';
const DIR = 'public/generated';

// arquivos: [{ nomeArquivo, buffer }] → retorna { nomeArquivo: urlPublica }
export function commitarImagensGeradas(arquivos) {
  if (!arquivos.length) return {};

  const dirAbs = path.join(process.cwd(), DIR);
  fs.mkdirSync(dirAbs, { recursive: true });

  const urls = {};
  for (const { nomeArquivo, buffer } of arquivos) {
    fs.writeFileSync(path.join(dirAbs, nomeArquivo), buffer);
    urls[nomeArquivo] = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIR}/${nomeArquivo}`;
  }

  git(['config', 'user.name', 'Lets Insights Bot']);
  git(['config', 'user.email', 'bot@lets.com.br']);
  git(['add', ...arquivos.map((a) => `${DIR}/${a.nomeArquivo}`)]);
  git(['commit', '-m', `chore: imagem gerada por IA (fallback) — ${arquivos.length} arquivo(s)`]);
  git(['push']);

  return urls;
}
