import { execFileSync } from 'node:child_process';

// ─────────────────────────────────────────────────────────────
// Resolve o executável do git. No GitHub Actions (Linux) "git" já está no
// PATH. Em algumas instalações do Git for Windows o instalador não adiciona
// git.exe ao PATH do processo (ex: PATH herdado pelo Node via npm/VSCode),
// então cai nos caminhos padrão de instalação antes de desistir.
// ─────────────────────────────────────────────────────────────
let _gitBin;

function candidatos() {
  if (process.platform !== 'win32') return ['git'];
  return [
    'git',
    `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\git.exe`,
    `${process.env.LOCALAPPDATA}\\Programs\\Git\\cmd\\git.exe`,
    `${process.env.ProgramFiles}\\Git\\bin\\git.exe`,
    `${process.env.ProgramFiles}\\Git\\cmd\\git.exe`,
    `${process.env['ProgramFiles(x86)']}\\Git\\bin\\git.exe`,
  ];
}

function resolverGit() {
  if (_gitBin) return _gitBin;
  for (const c of candidatos()) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      _gitBin = c;
      return c;
    } catch {
      // tenta o próximo candidato
    }
  }
  throw new Error('git não encontrado no PATH nem nos caminhos padrão de instalação do Windows.');
}

export function git(args, opts = {}) {
  return execFileSync(resolverGit(), args, { stdio: 'inherit', ...opts });
}

export function gitOutput(args) {
  return execFileSync(resolverGit(), args).toString();
}
