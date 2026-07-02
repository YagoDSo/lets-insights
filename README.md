# Let's Insights — newsletter B2B automatizada

Migração do pipeline de **N8N Cloud** para **Node.js + GitHub Actions**.

## Etapas (encadeadas)

| Script | O que faz | Origem N8N |
|---|---|---|
| `src/wf01-coleta.js` | RSS dos feeds → filtra/dedup/cura → grava artigos | WF-01 |
| `src/wf02-curadoria.js` | Curadoria + redação via Claude API → grava edição | WF-02 |
| `src/wf03-montagem-envio.js` | Scraping do blog + monta HTML + envia preview | WF-03 |

## Camadas trocáveis (roadmap)

- `src/lib/store.js` — banco de dados. **Hoje:** Google Sheets. **Depois:** Postgres/Supabase.
- `src/lib/sender.js` — envio. **Hoje:** Gmail preview. **Depois:** E-goi (produção).

Trocar Gmail→E-goi ou Sheets→Postgres mexe **só nesses dois arquivos**, sem tocar na lógica das etapas.

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencha as credenciais
npm run wf01           # ou wf02 / wf03
npm run pipeline       # roda as 3 em sequência
```

## Agendamento

`.github/workflows/newsletter.yml` — cron toda segunda 09:00 UTC (06:00 BRT) + disparo manual.
Credenciais ficam em **Settings → Secrets and variables → Actions**.

## Regras do projeto

Ver `CLAUDE.md` (PT-BR, sem travessão na copy, bloqueio de concorrentes, CTA fixo, etc.).
