# SETUP — credenciais e deploy

## 1. Service Account do Google (acesso ao Sheets)

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) e crie (ou selecione) um projeto.
2. **APIs e serviços → Biblioteca** → busque **Google Sheets API** → **Ativar**.
3. **APIs e serviços → Credenciais → Criar credenciais → Conta de serviço**.
   - Nome: `newsletter-lets` → **Criar e continuar** → pode pular as permissões de projeto → **Concluir**.
4. Clique na conta de serviço criada → aba **Chaves → Adicionar chave → Criar nova chave → JSON**.
   - Baixa um arquivo `.json`. **Esse é o segredo.** Não commitar.
5. Copie o **e-mail da conta de serviço** (algo como `newsletter-lets@PROJETO.iam.gserviceaccount.com`).
6. Abra a planilha do Sheets → botão **Compartilhar** → cole o e-mail da conta de serviço → permissão **Editor** → enviar.
   - Doc: `1xSjvbZwI-3oLScimPcpBftB2E4muLV07dt1ZOVo3N5s`

## 2. Rodar localmente

1. Renomeie o JSON baixado para `google-service-account.json` e coloque na raiz do repo (já está no `.gitignore`).
2. `cp .env.example .env` e preencha:
   - `ANTHROPIC_API_KEY` (a mesma do N8N)
   - `GOOGLE_APPLICATION_CREDENTIALS=./google-service-account.json`
   - `SHEETS_DOC_ID=1xSjvbZwI-3oLScimPcpBftB2E4muLV07dt1ZOVo3N5s`
3. `npm install`
4. `npm run test-conexao` → deve listar as colunas e a contagem das abas `Artigos_Coletados` e `Edicoes`.
5. Se passar: `npm run wf01`.

## 3. Repo no GitHub

```bash
cd c:\Users\yagod\Documents\newsletter-lets
git init
git add .
git commit -m "Migração WF-01 do N8N para Node + GitHub Actions"
git branch -M main
git remote add origin https://github.com/<seu-usuario>/newsletter-lets.git
git push -u origin main
```

## 4. Secrets no GitHub (para o Actions rodar)

No repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | a chave da Claude API |
| `CLAUDE_MODEL` | `claude-sonnet-4-5-20250929` (opcional) |
| `GEMINI_API_KEY` | chave do Gemini API (Google AI Studio) — geração de imagem fallback, ver `lib/imagegen.js` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **conteúdo inteiro** do arquivo `google-service-account.json` |
| `SHEETS_DOC_ID` | `1xSjvbZwI-3oLScimPcpBftB2E4muLV07dt1ZOVo3N5s` |
| `GMAIL_USER` | e-mail remetente do preview (só pro WF-03) |
| `GMAIL_APP_PASSWORD` | senha de app do Gmail (só pro WF-03, ver abaixo) |
| `PREVIEW_TO` | destinatário(s) do preview (separados por vírgula) |

> O `store.js` usa `GOOGLE_SERVICE_ACCOUNT_JSON` (CI) se existir; senão cai no `GOOGLE_APPLICATION_CREDENTIALS` (arquivo local). Os dois modos funcionam.

> O job `wf02-curadoria` do GitHub Actions precisa de `permissions: contents: write` (já configurado no `newsletter.yml`) — o passo de fallback de imagem commita e dá push no próprio repositório (pasta `public/generated/`). Por isso o repositório **precisa ser público**: `raw.githubusercontent.com` não serve arquivos de repo privado sem autenticação.

## 5. Gmail App Password (deixar pro WF-03)

1. A conta precisa ter **verificação em 2 etapas** ativada.
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → gerar senha de app → usar em `GMAIL_APP_PASSWORD`.

## 6. Disparo manual / agendado

- Aba **Actions** do repo → workflow "Let's Insights" → **Run workflow** (disparo manual).
- Agendado: toda segunda 09:00 UTC (06:00 BRT), via cron no `.github/workflows/newsletter.yml`.
