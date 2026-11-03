import fs from 'node:fs';
import path from 'node:path';
import { git } from './gitBin.js';
import { config } from './config.js';

// ─────────────────────────────────────────────────────────────
// Hospeda imagens re-hospedadas (ver lib/rehost.js) commitando-as no próprio
// repositório e servindo via raw.githubusercontent.com. Regra do projeto:
// e-mail nunca usa imagem base64 inline, sempre URL pública.
// ─────────────────────────────────────────────────────────────
const REPO = process.env.GITHUB_REPOSITORY || 'YagoDSo/lets-insights';
const BRANCH = 'main';
const DIR = 'public/generated';

// arquivos: [{ nomeArquivo, buffer }] → retorna { nomeArquivo: urlPublica }
// Campos extras em cada item sao ignorados, entao quem chama pode carregar
// metadado proprio junto (ver wf02-curadoria.js).
export function commitarImagensGeradas(arquivos, mensagem) {
  if (!arquivos.length) return {};

  // Modo de teste: grava as imagens fora do repo e não commita. As URLs
  // devolvidas são as que existiriam em produção (não abrem localmente).
  const dirAbs = config.modoTeste ? path.join(config.testeDir, 'imagens') : path.join(process.cwd(), DIR);
  fs.mkdirSync(dirAbs, { recursive: true });

  const urls = {};
  for (const { nomeArquivo, buffer } of arquivos) {
    fs.writeFileSync(path.join(dirAbs, nomeArquivo), buffer);
    urls[nomeArquivo] = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIR}/${nomeArquivo}`;
  }
  if (config.modoTeste) {
    console.log(`[MODO TESTE] ${arquivos.length} imagem(ns) gravada(s) em ${dirAbs}, sem commit.`);
    return urls;
  }

  git(['config', 'user.name', 'Lets Insights Bot']);
  git(['config', 'user.email', 'bot@lets.com.br']);
  git(['add', ...arquivos.map((a) => `${DIR}/${a.nomeArquivo}`)]);
  git(['commit', '-m', mensagem || `chore: imagem gerada por IA (fallback) — ${arquivos.length} arquivo(s)`]);
  git(['push']);

  return urls;
}
