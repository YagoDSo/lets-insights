# Let's Insights · newsletter B2B automatizada

Newsletter semanal da Let's para gestores de frota, gerada por um pipeline em **Node.js + GitHub Actions** (migrado do N8N Cloud em jul/2026). Toda segunda de manhã o pipeline coleta notícias, escolhe e escreve a edição com a Claude API, monta o HTML, manda um preview para revisão e deixa as campanhas prontas no E-goi.

Regras de copy, decisões fechadas e histórico detalhado: ver [`CLAUDE.md`](CLAUDE.md).

## Como roda

`.github/workflows/newsletter.yml`: toda **segunda às 02:17 (horário de Brasília)** (`cron: "17 5 * * 1"`), ou manualmente pela aba Actions. O GitHub pode atrasar execuções agendadas (em 26/10/2026 foram quase 7 horas). As três etapas são **encadeadas** (`needs`): cada uma só começa se a anterior passar.

| Etapa | Script | O que faz |
|---|---|---|
| WF-01 · Coleta | `src/wf01-coleta.js` | Lê 44 feeds RSS, filtra, remove duplicadas e concorrentes, separa em três trilhas e grava em `artigos_coletados` |
| WF-02 · Curadoria e redação | `src/wf02-curadoria.js` | Claude escolhe as notícias (com reservas), valida links e imagens, gera imagem quando falta, busca o post mais recente do blog e escreve títulos, assunto, pré-header e CTA. Grava em `edicoes` |
| WF-03 · Montagem e envio | `src/wf03-montagem-envio.js` | Monta o HTML, manda o preview por Gmail e cria as campanhas no E-goi (rascunho, ou agendadas se o interruptor estiver ligado) |

### WF-01 · três trilhas de coleta

- **Frota:** os 16 feeds de sempre (frota, transporte, logística, mineração, infraestrutura) com o filtro de relevância de frota. É o pool da versão geral da news.
- **Segmento:** 28 feeds de mineração, indústria, engenharia, tecnologia e florestal, mais classificação por palavras em todos os feeds (`classificarSegmento`). Cota de 8 notícias por segmento.
- **Brasil:** economia, regulação, negócios e operação, sem política eleitoral, polícia e entretenimento. Cota de 10.

As trilhas de segmento e Brasil alimentam a **news segmentada**, ainda em construção (ver [`docs/plano-news-segmentada.md`](docs/plano-news-segmentada.md)). Hoje o WF-02 lê só a trilha frota.

### WF-02 · Claude API

- Modelo **`claude-sonnet-5-5` com raciocínio desligado** (`thinking: {type: "between_tools"}`, em `src/lib/claude.js`). Não usar no modo padrão: fica mais caro e cortou a curadoria no limite de tokens no teste.
- Respostas em **JSON com formato fixo** (saída estruturada, `schema`): sem isso o Sonnet 5.5 chegou a devolver dois JSONs com comentários (edição 22).
- **API de lote (metade do preço):** espera o resultado até as 14:30 (Brasília) ou até 5h30 de espera, o que vier primeiro (o GitHub encerra job com mais de 6h); depois disso cancela e faz a chamada normal. O preview pode chegar até as 15h de segunda. Desliga com `CLAUDE_LOTE=desligado`.
- Imagem faltando: gerada pelo Gemini (`src/lib/imagegen.js`). Imagem em CDN compartilhado (ex.: Webflow): baixada e re-hospedada (`src/lib/rehost.js`). As duas vão para `public/generated/` e são servidas por `raw.githubusercontent.com` (por isso o repositório é público).

### WF-03 · E-goi

- Cria uma campanha por lista: **Gestores 2025** (67), **Condutores 2023** (34) e **Base de Usuários Let's** (69).
- **Padrão: rascunho** (`POR PUBLICAR · ...`). O disparo é manual, pelo painel do E-goi.
- **Agendamento automático (desligado):** com a variável `EGOI_AGENDAMENTO=ligado`, cada campanha que passa nas checagens é agendada para **terça às 07:30** e nomeada `AGENDADA · ...`, e um resumo vai por e-mail. Dá para cancelar pelo painel até o horário. Decisão de 22/10/2026: ligar só depois de duas semanas de disparo manual.

## Banco de dados

SQLite em `data/newsletter.db`, **commitado no repositório pelo bot** (`Lets Insights Bot`) ao fim de cada etapa. É assim que o estado passa de um job para o outro, já que os jobs do Actions são efêmeros.

- `artigos_coletados`: uma linha por notícia (`url`), com `tema`, `segmento` e `trilha`.
- `edicoes`: uma linha por edição, com os artigos, o destaque do blog, o CTA e o status.

## Credenciais

Em **Settings → Secrets and variables → Actions**:

| Nome | Tipo | Usado em |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | WF-02 (o workflow também passa pro WF-01, que não chama mais a Claude API) |
| `GEMINI_API_KEY` | secret | WF-02 |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `PREVIEW_TO` | secret | WF-03 (preview) |
| `EGOI_API_KEY` | secret | WF-03 (campanhas no E-goi) |
| `EGOI_AGENDAMENTO` | **variável** (não secret) | WF-03. Só agenda com o valor `ligado` |
| `CLICKUP_API_TOKEN` | secret | relatório ClickUp (manual, ver abaixo) |

O secret `CLAUDE_MODEL` existe, mas não é mais usado pelo workflow: o modelo fica versionado em `src/lib/config.js`.

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencha as credenciais
npm run wf01           # ou wf02 / wf03
npm run pipeline       # roda as 3 em sequência
```

Rodar `wf01`, `wf02` ou `wf03` localmente **grava no banco e faz commit e push** (`commitarBanco`). Para testar sem gravar, use uma cópia do banco com `SQLITE_DB_PATH` e chame as funções direto.

Outros scripts:

- `npm run report-egoi`: lista as campanhas enviadas no ano com envios, aberturas e cliques (só leitura).
- `npm run report-clickup`: atualiza a tabela de números numa task do ClickUp. **Fora de uso desde 14/10/2026**: o agendamento foi desligado e o workflow `report-clickup.yml` só roda manualmente.
- `npm run test-conexao`: confere se o banco SQLite abre e lista as tabelas.

## Estrutura

```
src/
  wf01-coleta.js           coleta (RSS, filtros, trilhas)
  wf02-curadoria.js        curadoria e redação (Claude), imagens, blog
  wf03-montagem-envio.js   HTML, preview, campanhas no E-goi
  lib/
    claude.js              chamada à Claude API
    template.js            HTML do e-mail e assunto (montarAssunto)
    egoi-campaign.js       rascunho e agendamento no E-goi
    agendamento.js         data do envio e checagens antes de agendar
    egoi-reports.js        leitura de relatórios do E-goi
    db.js                  SQLite e commit do banco
    rss.js, imagegen.js, rehost.js, gitAssets.js, sender.js, config.js, repair.js
docs/
  plano-news-segmentada.md desenho aprovado da news segmentada
data/newsletter.db         banco (commitado pelo bot)
public/generated/          imagens geradas ou re-hospedadas
```
