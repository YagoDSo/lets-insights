# CLAUDE.md — Let's Insights (newsletter B2B automatizada)

Este arquivo orienta o Claude Code ao trabalhar neste repositório. Leia por completo antes de qualquer alteração.

---

## O que é este projeto

**Let's Insights** é uma newsletter B2B semanal **totalmente automatizada**, da **Let's** (gestão de frotas, Grupo Águia Branca / portfólio VIXPar, Vitória/ES). Público: gestores de frota, diretores de logística e CFOs de empresas que terceirizam veículos. Responsável: Yago Dias Soares (CRM e Marketing Automation).

A automação roda em **N8N Cloud** e é composta por **3 workflows** que rodam toda terça-feira em sequência por horário (não estão encadeados por conexão — são schedules independentes):

- **WF-01** às 06:00 — coleta de notícias (RSS) → aba `Artigos_Coletados`
- **WF-02** às 06:04 — curadoria + redação (Claude API) → aba `Edicoes`
- **WF-03** às 06:06 — montagem HTML + envio de preview (Gmail)

## Como este repositório funciona (LEIA ISTO)

- Os "workflows" são **arquivos `.json` exportados do N8N**. Cada arquivo é um workflow completo (nós + conexões).
- **Você (Claude Code) edita os JSON localmente. Você NÃO consegue executar, importar nem testar nada no N8N** — isso é uma plataforma web externa. O ciclo é: você edita o JSON → o Yago importa manualmente no N8N Cloud → o Yago roda e cola os logs de volta.
- **Não há build, nem testes automatizados, nem servidor.** O "teste" é o Yago rodar no N8N e reportar.
- A lógica de cada nó Code fica em `parameters.jsCode` (string com JavaScript). É aí que mora 90% do trabalho.
- Ao editar um nó Code, **preserve `id`, `name`, `type`, `typeVersion`, `position` e `credentials`** — mude só o `jsCode` (ou o parâmetro pedido). Renomear um nó exige atualizar também o objeto `connections`.
- Sempre **valide o JSON** após editar (`python3 -c "import json; json.load(open('arquivo.json'))"`) antes de entregar.

## Stack e identificadores

- **N8N Cloud** v2.27.4
- **Claude API** modelo `claude-sonnet-4-5-20250929` (curadoria, redação, e antigamente filtro de concorrentes). **Não há mais busca web via Claude API** (busca híbrida do WF-01 removida em jul/2026 — ver "Decisões fechadas" e "Otimização de custo de tokens").
- **SQLite** (`data/newsletter.db`, via `better-sqlite3`) — banco de dados da implementação Node.js atual (ver `src/lib/db.js`). O arquivo `.db` é commitado no próprio repo pelo bot (`Lets Insights Bot <bot@lets.com.br>`) ao final de cada workflow, mesmo padrão já usado pra imagens geradas (`src/lib/gitAssets.js`) — necessário porque os jobs do GitHub Actions são efêmeros e o próximo job da cadeia (`needs`) precisa enxergar o estado atualizado via checkout do `main`.
  - Tabela **edicoes** (PK `edicao`) — colunas: `edicao, titulo_edicao, pre_header, json_artigos_principais, json_artigos_cards, json_cta, status, gerado_em, enviado_em, json_blog, json_assunto_manchetes`. **jul/2026:** fim da divisão principais/cards (ver "Decisões fechadas" e WF-02/WF-03 abaixo) — `json_artigos_principais` agora guarda os 3 artigos selecionados (sem "cards" menores); `json_artigos_cards` ficou **sem uso** (migração aditiva, coluna não removida pra evitar migração destrutiva); `json_blog` (nova, `ALTER TABLE` em `db.js`) guarda o destaque do blog Lets, escrito pela IA no WF-02 — antes vinha de scraping ao vivo no WF-03, sem passar pela IA e sem persistir; `json_assunto_manchetes` (`ALTER TABLE` em `db.js`, jul/2026) guardava as manchetes do teste de Assunto formato Brazil Journal — **sem uso** desde a reversão de ago/2026 (ver regra 7 abaixo), coluna mantida só pra não exigir migração destrutiva (edições 8-9 continuam legíveis).
  - Tabela **artigos_coletados** (PK `url`) — colunas: `url, edicao, data_coleta, titulo, fonte, data_publicacao, resumo, status, tema`
  - **Legado N8N (pré-migração):** o N8N usava **Google Sheets** como banco (doc `1xSjvbZwI-3oLScimPcpBftB2E4muLV07dt1ZOVo3N5s`, abas `Edicoes` gid `1325127310` e `Artigos_Coletados` gid `1508227275`). Migração pra SQLite feita em jul/2026 **sem** importar o histórico do Sheets (banco novo nasceu vazio — dedup histórico e numeração de edição resetaram). As seções "Arquitetura detalhada dos workflows" abaixo descrevem o comportamento de referência dos `.json` do N8N; os bugs de `matchingColumns`/`appendOrUpdate` são específicos do Sheets e não existem no SQLite.
- **E-goi** — disparo de produção (futuro). **Gmail** — preview atual.
- **CDN de imagens** (logo, ícones): SendGrid account `aead0c601c58f7b7`.
- **Gemini API** (`gemini-2.5-flash-image`, "Nano Banana") — geração de imagem fallback quando artigo não tem imagem própria válida. Ver `src/lib/imagegen.js`.
- **Repositório GitHub `YagoDSo/lets-insights`: PÚBLICO** (desde jul/2026, decisão deliberada — ver "Decisões fechadas"). Imagens geradas pela IA são commitadas em `public/generated/` e servidas via `raw.githubusercontent.com`, que só funciona em repo público.

## Regras inegociáveis do projeto

1. **Idioma:** tudo em **PT-BR**.
2. **Tom de voz:** B2B premium, profissional, direto, sem floreios.
3. **NUNCA usar travessão (—)** em copy.
4. **Copyright:** sempre parafrasear conteúdo de portais, nunca copiar literal. Citar a fonte.
5. **Concorrentes:** bloquear notícias onde Localiza/Movida/Unidas/Vamos/Ouro Verde/ALD/Arval são **protagonistas**; permitir menção neutra de mercado.
6. **CTA "Falar com Especialista":** sempre `https://www.lets.com.br/solicitar-proposta` (nunca `/contato`).
7. **Assunto:** `Let's Insights · [destaque]` (ponto médio U+00B7, nunca hífen), gerado como `titulo_edicao` pela IA e reaproveitado direto como Assunto do e-mail. **jul-ago/2026:** houve um teste breve com formato Brazil Journal (2 manchetes curtas geradas à parte, `assunto_manchetes`, separadas por `; ` e terminando em ` « Let's Insights` — usado nas edições 8 e 9); revertido em ago/2026 por decisão do Yago (dado insuficiente pra isolar o efeito do assunto da mudança de layout simultânea — ver "Decisões fechadas"). O layout novo dessas edições (hero maior no topo) **não foi revertido**, só o assunto.
8. **ClickUp:** **NUNCA** criar/editar/ler/mover/comentar tasks **sem autorização explícita do Yago na mensagem específica** — mesmo que pareça implícito. Sempre ler uma task antes de atualizar. (Workspace 36916834; tasks de referência: `86ahfmnwx` projeto, `86ahderm5` log de resultados.)
9. **Integrações:** nunca inventar capacidades/APIs. Verificar viabilidade antes de propor.
10. **Decisões fechadas:** schedules independentes (não encadear) *(pré-migração; ver nota no fim do arquivo)*, modelo Sonnet 4.5, **SQLite commitado no repo como banco** (jul/2026, substituiu Google Sheets; ver "Stack e identificadores" — não migrar para Postgres/Supabase/Airtable/Notion por enquanto), repositório GitHub público (necessário pra hospedar imagens fallback via `raw.githubusercontent.com` — decisão tomada cientes de que expõe código/prompts/regras de negócio; credenciais seguem só em Secrets), **busca web híbrida do WF-01 removida** (jul/2026 — ver "Otimização de custo de tokens"; não reintroduzir sem antes confirmar, via log real de execução, que ela contribui artigos que os feeds RSS não trazem), **feed Mobilidade Estadão removido** (jul/2026 — feed parou de publicar, item mais recente ficou parado em 201 dias; ver "Arquitetura detalhada dos workflows › WF-01").

## Como o Yago gosta de trabalhar (preferências)

- Direto e orientado a decisão. Prefere **opções A/B/C com trade-offs honestos** antes de implementar.
- Prefere **snippets prontos para colar no nó do N8N** a arquivos JSON inteiros, **quando a mudança é só de código**. JSON completo só quando a mudança é estrutural (nós/conexões).
- **Sempre validar nomes de campo contra o output real do nó upstream** — nunca inferir do código do workflow. Já corrigiu o Claude várias vezes por isso. Quando em dúvida sobre o schema, peça os logs/output real.
- Itera por bugs de forma sistemática; aceita pivotar de estratégia em vez de insistir em becos sem saída.

---

## Arquitetura detalhada dos workflows (estado atual)

### WF-01 (06:00) — Coleta
```
Toda Terça 06:00 → Ler Edicoes → Config Edição → [16 RSS] → Padronizar Estrutura
→ Calcular Idade → Filtrar por Palavras-Chave1 → Deduplicar → Filtrar Concorrentes
→ Enriquecer e Limitar → Salvar no Google Sheets
```
- **16 feeds RSS** (expandido jul/2026 pro ICP de operação de campo; `valorinveste.globo.com` removido por estar descontinuado — 404 em toda variação de path testada; `mobilidade.estadao.com.br` removido jul/2026 — feed vivo mas estagnado, item mais recente com 201 dias no teste que motivou a remoção):
  - Base original: Frota&Cia, Transporte Moderno, Diário do Transporte, Logweb, NeoFeed, Brazil Journal, Exame.
  - Mineração: Brasil Mineral, IBRAM.
  - Meio ambiente: (o)eco.
  - Florestal/celulose: IBÁ.
  - Concessão de rodovias/infraestrutura: ABCR (publica em `melhoresrodovias.org.br`, não `abcr.org.br` — mapeamento de fonte cobre os dois).
  - Indústria ferroviária (infra/logística adjacente): ABIFER.
  - Logística/transporte de carga B2B: Logística no Brasil, O Carreteiro, Carga Pesada.
  - Todos com `continueOnFail` (feed individual falhar não derruba a coleta).
- **Busca web híbrida: REMOVIDA (jul/2026).** Existiu por ~1 semana (`buscarArtigosWeb()`, tool nativa `web_search` da Claude API via Haiku). Análise das 5 primeiras edições do banco mostrou 100% dos artigos coletados vindo de domínio de feed RSS e 0 de busca web em toda execução com a feature ativa — sem contribuição mensurável, só custo (~87% do gasto total do pipeline). RSS sozinho vinha entregando 10-23 artigos/edição, acima do `ALVO_MINIMO=15` na maioria. Removida de `src/wf01-coleta.js`, `src/lib/claude.js` (`chamarClaudeComWebSearch`) e `src/lib/config.js` (`claudeModelBusca`).
- **Config Edição:** `max(edicao)+1` da aba Artigos_Coletados (numeração sequencial 1, 2, 3...).
- **Calcular Idade:** não descarta por corte fixo; calcula `idade_dias`, descarta só >60 dias. Declara `pairedItem`.
- **Filtrar por Palavras-Chave1:** filtro de relevância B2B. **Ver "ponto de atenção" abaixo** — pode estar em v2 (rigoroso) ou v3 (permissivo).
- **Deduplicar:** remove duplicados da execução; idealmente também faz **anti-duplicação histórica** (lê `$('Ler Edicoes').all()` e descarta URLs já usadas em edições passadas).
- **Filtrar Concorrentes:** heurística sem API — concorrente no título = descarta; no resumo + palavra de protagonismo = descarta; menção neutra = aprova.
- **Enriquecer e Limitar:** **janela de idade adaptativa 7→14→21→30** (expande só se pool < `ALVO_MINIMO=15`); **cap por fonte** `MAX_POR_FONTE=3`; **cap por tema** `MAX_POR_TEMA=6` via `classificarTema()`; `MAX_TOTAL=30`. Salva `tema`. Usa `$('Config Edição').first()`.
- **Salvar no Google Sheets:** `appendOrUpdate`, **`matchingColumns=['url']`** (cada artigo = 1 linha), schema com coluna `tema`.

### WF-02 (06:04) — Curadoria + Redação
```
Toda Terça 06:04 → Ler Edicoes → Definir Edição → Ler Artigos Coletados
→ Filtrar Edição Atual → Preparar Curadoria → Claude API - Curadoria → Parse Curadoria
→ Buscar HTML do Artigo → Extrair Imagem → Validar URLs Vivas → Buscar Blog Lets
→ Preparar Redação → Claude API - Redação → Parse Edição Final + Validar URLs → Salvar Edição
```
- **jul/2026 — fim da divisão principais/cards:** não existe mais destaque editorial (3 principais, imagem grande) separado de cards menores. Agora é **1 lista única de 4 itens**: destaque do blog Lets primeiro, depois os **3 artigos selecionados** — todos no mesmo formato visual (ver WF-03). Curadoria/redação selecionam 6 artigos (3 reais + 3 backup), não mais 9 (3+3+3) — ver "Pontos de atenção" item 9 pro histórico do número antigo.
- **Definir Edição:** `max(edicao)` (a que o WF-01 acabou de gravar).
- **Preparar Curadoria:** passa `tema` à IA; regra de diversidade (3 selecionados de temas distintos; **sem fonte repetida** — reforçado em código após o parse da curadoria, não só no prompt, ver ponto de atenção 9; regra apertada em jul/2026, era "máx 2 por fonte"). Seleciona 6 (3 reais + 3 backup), ordenados por score.
- **Parse Curadoria / Parse Edição Final:** ambos usam `repairJSON()` (limpa aspas tipográficas, travessões, controle; escapa aspas internas linha a linha) antes do `JSON.parse`.
- **Extrair Imagem:** og:image → twitter:image → image_src; normaliza `//` e `http→https`; preserva `tema`; usa `idx` do `.map` (não `posicao`).
- **Validar URLs Vivas:** HEAD com timeout 5s; descarta 4xx/5xx; imagem 404 vira null mantendo artigo; erro de rede = mantém.
- **Buscar Blog Lets** (novo, movido do WF-03): pega o post mais recente do blog Webflow (`lets.com.br/blog`), sua imagem (og:image → twitter:image → 1ª img CDN após h1) e sua meta-description — pra IA escrever um título de verdade sobre o post na mesma chamada da redação, em vez de só reaproveitar o título bruto extraído por regex.
- **Preparar Redação:** tom Let's, sem travessão, parafrasear (não se aplica ao blog — conteúdo próprio); **frase única no estilo Brazil Journal** (fato + cláusula com dado concreto + implicação pra operação, nunca travessão) pro título de cada item; 3 artigos de fonte/tema sem repetição + 1 destaque de blog (tratamento à parte, mais detalhado/persuasivo, minerado do texto completo do post); integridade de URL/fonte/imagem inviolável (artigos externos); título da edição `Let's Insights · [destaque]` (U+00B7) — vira o `<title>`/exibição interna **e** o Assunto do e-mail (ver regra 7); título de artigo ≤140 caracteres, título de blog ≤260; CTA final deriva o gancho do tema real da edição (não de exemplo fixo, ver "Pontos de atenção").
- **Parse Edição Final + Validar URLs:** corrige URL inventada pela IA (fallback por posição); status `pronto_envio_com_imagens`.
- **Salvar Edição:** aba Edicoes, **`matchingColumns=['edicao']`** (aqui `edicao` é correto: 1 linha por edição). Grava `json_artigos_principais` (3 selecionados), `json_blog` (destaque do blog), `json_artigos_cards` (sempre `[]`, sem uso).

### WF-03 (06:06) — Montagem HTML + Envio
```
Toda Terça 06:06 → Ler Todas as Edições1 → Validar e Selecionar Edição1
→ Montar HTML1 → Criar Anexo HTML1 → Gmail - Enviar Preview1 → Confirmar Preview1
→ Atualizar Status1
```
- **jul/2026:** o scraping do blog Lets saiu de aqui (ver WF-02) — este workflow só lê o que já foi persistido no banco (`json_blog`), sem scraping ao vivo na hora de montar o HTML.
- **Validar e Selecionar Edição1:** pega a edição `pronto_envio_com_imagens` mais recente.
- **Montar HTML1:** template **Cerberus Hybrid**, 600px, Open Sans, cor primária `#f15a22`, dark mode (`@media prefers-color-scheme` + `[data-ogsc]`). Topo laranja "EDIÇÃO N · DD MMM YYYY". **Lista única de 4 itens** empilhados (img 160×160 + categoria + título + botão + fonte + divisor) — blog primeiro (botão "Ler artigo", `utm_content=blog`), depois os 3 artigos (botão "Ler matéria", `utm_content=noticia_N`). CTA "FALAR COM ESPECIALISTA". Footer laranja 2 colunas (232px cada + padding 20, tabela real sem VML). UTMs `utm_source=newsletter&utm_medium=email&utm_campaign=insights&utm_content=blog|noticia_N`.
- **Teste A/B de posição do CTA (ago/2026):** `montarHTML(dados, opts)` (`src/lib/template.js`) aceita `opts.ctaPosicao` (`'inicio' | 'meio' | 'fim'`, default `'fim'` = comportamento original) e `opts.ctaOverride` (texto alternativo pro CTA; se omitido, usa o mesmo `json_cta` da IA nas 3 posições). `wf03-montagem-envio.js` gera as 3 variantes a cada envio (mesmo texto de CTA, só muda posição/estilo do botão) — a variante `'fim'` vai no **corpo** do e-mail de preview (comportamento de produção inalterado), e as 3 (`inicio`/`meio`/`fim`) vão em **anexo** (`lets_insights_<edicao>_cta_<posicao>.html`) pro Yago comparar. `enviarPreview` (`src/lib/sender.js`) recebe `anexos: [{filename, content}]` (lista, não mais um anexo único).
- **Rascunhos "POR PUBLICAR" no E-goi (ago/2026):** depois do preview do Gmail, `wf03-montagem-envio.js` chama `criarRascunho` (`src/lib/egoi-campaign.js`) uma vez por lista (`config.egoiListas`: Gestores 2025 `67`, Condutores 2023 `34`, Base de Usuários Let's `69`) via `POST /campaigns/email`, com o mesmo assunto/HTML (variante `'fim'`) do preview. A campanha nasce em status `draft` — **isso NUNCA chama `/actions/send`**; o disparo real continua manual e exige autorização explícita do Yago a cada campanha (regra inviolável, ver [[feedback-egoi-send-authorization]] na memória). `internal_name` sai como `POR PUBLICAR · [titulo_edicao] · [nome da lista]`, pra ficar fácil de achar no painel do E-goi. Falha na criação (ex: `EGOI_API_KEY` faltando) é logada e **não derruba o workflow** — o preview do Gmail já foi enviado antes e continua sendo o passo crítico de validação. Requer secret `EGOI_API_KEY` no GitHub Actions (job `wf03-montagem-envio`).

---

## Pontos de atenção / bugs conhecidos (verificar antes de mexer)

1. **Filtro de relevância (WF-01):** existem duas versões. **v2** (rigoroso, exige contexto B2B adjacente a termos genéricos) deixava passar só ~3 artigos. **v3** (termos centrais aceitos diretamente, exclusão B2C só para transporte público de passageiros, normalização de acento consistente) resolveu — passou para ~9 artigos. **Confirme qual está no `jsCode` do nó antes de diagnosticar escassez de artigos.**
2. **`matchingColumns` (WF-01 Salvar):** tem que ser **`url`** na aba Artigos_Coletados. Se estiver `edicao` (ou vazio), o Sheets sobrescreve linhas da mesma edição e só salva 1-3 artigos.
3. **WF-03 "Atualizar Status1":** há inconsistência — `documentId` aponta para aba Edicoes mas `sheetName.value` é o gid de Artigos_Coletados, com `matchingColumns=['edicao']`. Gera linhas-fantasma. **Correção pendente:** apontar consistentemente para a aba Edicoes.
4. ~~**Fallback de imagem (WF-02 Parse Edição Final):** versão anterior tinha `aplicarFallback()` para trocar imagem null pelo fallback; sumiu da versão atual.~~ **RESOLVIDO (jul/2026):** artigos sem imagem válida (posições 0-5; 6, 7 e 8 são backup e são ignorados) agora geram imagem via Gemini API (`gerarImagemPorTema` em `src/lib/imagegen.js`), commitada em `public/generated/` e servida via `raw.githubusercontent.com` (`src/lib/gitAssets.js`). Passo roda dentro do `wf02-curadoria.js`, entre "Validar URLs Vivas" e "Preparar Redação". Requer `GEMINI_API_KEY` e permissão `contents: write` no job do GitHub Actions (já configurado no `newsletter.yml`).
5. **Paired item errors (N8N 2.27):** se aparecer "Paired item data... unavailable", a causa é nó Code sem `pairedItem: {item: i}` declarado, ou referência `$('Nó').item` a nó fora da cadeia direta. Solução: usar `.first()`, declarar `pairedItem`, referenciar só nós da cadeia.
6. **Hotlink 403 (Frota&Cia, Logweb no Outlook):** limitação do servidor da fonte ao baixar imagem sem referrer. Aceito como conhecido.
7. **User-Agent do RSS (jul/2026):** `mobilidade.estadao.com.br` retornava 403 pro User-Agent de bot antigo (`LetsInsightsBot/1.0`); trocado por UA de browser real em `src/lib/rss.js`. Sem isso o feed parece "quebrado" mas na verdade só está sendo bloqueado por identificação de bot. **Nota:** esse feed foi removido depois (ver item de decisões fechadas) por outro motivo — passou a responder 200 normalmente, mas parou de publicar itens novos (estagnou). A troca de UA continua valendo como aprendizado geral pros feeds restantes.
8. **Rate-limit/anti-bot em `brasilmineral.com.br` (jul/2026):** o feed RSS funciona normal, mas a validação de URL viva (`validarURL`/`buscarHTML` no WF-02) pode receber 403 intermitente ao acessar a página do artigo — parece ser rate-limit por IP do site-fonte, não um bloqueio de User-Agent (testes manuais confirmaram 200 tanto com UA de bot quanto de browser fora de rajadas de teste; em outro teste o mesmo 403 persistiu mesmo com retry de 3s, então o rate-limit pode durar mais que alguns segundos). `validarURL` agora tenta 2x com espera de 3s em status tipicamente transitório (403/408/425/429/5xx) antes de descartar — mitiga parte dos casos, mas não é garantia. Aceito como conhecido, mesma categoria do item 6; não deve ser problema em produção (1 requisição por artigo, 1x/semana) mas pode descartar 1-2 artigos ocasionalmente — por isso o pool de backup do WF-02 foi aumentado (ver item 9).
9. **Newsletter gerada com card faltando (jul/2026, bug real, corrigido):** edição de teste saiu com 3 principais + só 2 cards (devia ter 3). Causa raiz dupla: (a) só havia 1 artigo de reserva (7 selecionados = 3+3+1) — insuficiente quando 2 artigos da mesma fonte falham juntos na validação (item 8 acima), já que a regra de diversidade permite até 2 artigos da mesma fonte numa edição; (b) a curadoria (IA) violou sua própria regra de "máx 2 por fonte" e selecionou 3 artigos da mesma fonte entre os 7, desperdiçando o único backup nisso — a redação corrigiu depois descartando o excedente, mas àquela altura já não sobrava artigo pra repor o card. **Correção (histórica, pré fim-da-divisão-principais/cards):** (1) `promptCuradoria`/`promptRedacao` passaram a pedir 9 artigos (3 principais + 3 cards + 3 backup, antes eram 7 com 1 backup); (2) a regra "máx 2 por fonte" reforçada em CÓDIGO logo após o parse da curadoria (não só no prompt); (3) `promptRedacao` parou de depender de posições fixas (0,1,2 / 3,4,5 / 6), usando "os N primeiros da lista recebida" de forma dinâmica. **jul/2026 (2ª rodada):** com o fim da divisão principais/cards, o número caiu de 9 para 6 (3 reais + 3 backup) — a mesma lógica de reforço em código e de lista dinâmica (2) e (3) continua valendo, só o total mudou.

## Otimização de custo de tokens (jul/2026)

Análise do gasto de tokens do pipeline Claude API, com o objetivo de reduzir custo sem arriscar qualidade nas etapas de negócio sensíveis (curadoria/redação).

**Achado original:** a busca web híbrida do WF-01 (`chamarClaudeComWebSearch`) sozinha respondia por **~87% do custo total** do pipeline (~$0,40 de ~$0,46/semana), porque o conteúdo das páginas retornadas pela tool `web_search` entra como tokens de input (~104-107 mil tokens medidos em teste real). Curadoria e redação juntas (WF-02) custavam só ~$0,06/semana no total.

**Busca web híbrida REMOVIDA (jul/2026), não só trocada de modelo.** Depois de rodar por ~1 semana (5 edições de teste no banco), a análise mostrou que ela contribuiu **0 artigos** em toda execução com a feature ativa — 100% dos artigos coletados vinham de domínio de feed RSS. Custo sem retorno mensurável. Ver "Decisões fechadas" e a nota na arquitetura do WF-01. Isso corta o ~$0,40/semana quase inteiro (o antigo ajuste pra Haiku, abaixo, ficou obsoleto — a chamada não existe mais).

**Decisões (histórico, pré-remoção):**
- ~~**`claude-haiku-4-5-20251001` só na busca web**~~ — obsoleto, a chamada foi removida. Ficam registradas as notas técnicas (uso de `web_search_20250305`, cobertura de `pause_turn`) só como referência caso a busca web seja reavaliada no futuro — mas não reintroduzir sem antes confirmar via log real que ela traz artigos que o RSS não traz.
- **`claude-sonnet-4-5-20250929` continua em curadoria e redação** (`config.claudeModel`, usado em `chamarClaude`) — são etapas de julgamento editorial e tom de voz da marca, sensíveis a qualidade; não trocado sem necessidade.
- **Payload da redação reduzido:** `promptRedacao()` (`wf02-curadoria.js`) removia `score`, `justificativa` e `posicao` de cada artigo antes de montar o JSON enviado à API — são metadado interno da curadoria que a redação nunca usa (não aparecem nem no schema de saída pedido). Reduz ~15-20% do payload dessa chamada especificamente. Risco zero.
- **Prompt caching (`cache_control`) — avaliado e descartado.** O pipeline roda 1x/semana; o cache da Anthropic expira em 5min (ou 1h com TTL explícito). Não existe cenário em que um cache escrito numa segunda-feira ainda esteja quente na segunda seguinte — toda chamada semanal pagaria o prêmio de escrita (1,25x-2x) sem nunca ganhar a leitura barata de volta, o que **pioraria** o custo em vez de melhorar.
- **Combinar curadoria+redação numa chamada só — não é viável.** Há uma validação de URL/imagem (HTTP real, fora da API Claude) entre as duas etapas que pode descartar artigos selecionados pela curadoria; a redação só sabe o que sobrou depois dessa validação. É uma dependência sequencial real do pipeline, não uma duplicação evitável.

**Estimativa de custo:** ~$0,46/semana (com busca web em Sonnet) → ~$0,06/semana agora (só curadoria+redação, sem busca web).

## Learnings técnicos (não repetir os erros)

- N8N 2.27 é rigoroso com `pairedItem`: declarar nos nós Code, usar `.first()` não `.item`, referenciar só nós da cadeia direta.
- `matchingColumns` em `appendOrUpdate`: usar coluna de valor único por linha (`url` p/ artigos); nunca coluna repetida (`edicao`), exceto na aba Edicoes (1 linha por edição).
- Filtro de relevância: aceitar termos centrais direto > exigir contexto adjacente. Normalização de acento idêntica nos dois lados da comparação.
- Diversidade temática nasce no WF-01 (cap por tema no pool), não só no WF-02 (1 card por tema na vitrine) — o WF-02 só cura o que recebe. **Ordem de implantação:** rodar WF-01 (popula coluna `tema`) ANTES do WF-02. Se WF-02 rodar antes, `tema` vem vazio → tudo "Outros" → sem variedade.
- Janela de idade adaptativa resolve escassez sem perder relevância; WF-01 pode ser permissivo (entrega volume), pois a curadoria do Claude no WF-02 é a segunda peneira.
- Classificação de tema por palavras-chave é imperfeita — monitorar `Distribuição por TEMA` nos logs e ajustar listas.
- N8N Cloud bloqueia requisição direta a domínios externos no editor de teste — não dá para validar feed RSS de fora; verificar `/feed/` no browser.
- Outlook ignora padding de TD externa antes de tabela MSO — reduzir width da tabela MSO e pôr padding direto nas TDs MSO internas.
- `repairJSON()` é necessário para parsear com robustez a saída JSON do Claude.
- `raw.githubusercontent.com` **não serve arquivos de repositório privado** sem autenticação (não dá pra passar Authorization header num `<img src>` de e-mail). Só funciona se o repo for público — daí a decisão de tornar `lets-insights` público em jul/2026.
- Commits automáticos de CI (imagens geradas) usam identidade `Lets Insights Bot <bot@lets.com.br>` via `git config` no próprio script (`src/lib/gitAssets.js`), pra diferenciar de commits manuais do Yago no histórico.
- **SQLite commitado no repo (jul/2026):** como os jobs do GitHub Actions são efêmeros, `data/newsletter.db` só persiste entre WF-01→WF-02→WF-03 porque cada script chama `commitarBanco()` (`src/lib/db.js`) ao final, e cada job do workflow faz `actions/checkout` com `ref: main` explícito (não o padrão `github.sha`) pra pegar o commit do job anterior na mesma execução.
- `better-sqlite3` não tem binário pré-compilado pra toda versão do Node imediatamente após o lançamento (ex: Node 24 exigiu a versão `^12.x`; a `11.x` só compila via `node-gyp`, que exige Python/Visual Studio Build Tools instalados). Ao atualizar Node localmente ou no `setup-node` do Actions, confirmar que a versão do `better-sqlite3` no `package.json` tem prebuild pra aquele ABI.

## Pendências / backlog

- [ ] Confirmar se WF-01 em produção tem filtro v3 + anti-duplicação histórica (ou se é híbrido).
- [ ] Confirmar coluna `tema` criada e populada na aba Artigos_Coletados.
- [ ] Corrigir WF-03 "Atualizar Status1" (documentId/sheetName inconsistentes → linhas-fantasma).
- [ ] Decidir reinclusão do `aplicarFallback()` no WF-02.
- [ ] Conferir distribuição de temas nos logs e calibrar listas do `classificarTema()`.
- [ ] Validar footer Outlook em edição real via E-goi.
- [x] Decisão de horário: terça-feira 06:00 BRT (mudou de segunda em jul/2026); **ago/2026: mudou pra 05:00 BRT** (`cron: "0 8 * * 2"` em `newsletter.yml`, único disparo — WF-02/WF-03 são encadeados via `needs`, não têm cron próprio).
- [ ] Fase 2 captação: landing lets.com.br/newsletter, double opt-in LGPD.
- [ ] Base Pipedrive (~11k): enriquecimento Apollo + tracking pós-envio.
- [x] **Expansão RSS (jul/2026):** validado manualmente feed por feed (200 + XML real + itens recentes). Adicionados: Logística no Brasil, O Carreteiro, Carga Pesada (dessa lista), mais Brasil Mineral, IBRAM, (o)eco, IBÁ, ABCR, ABIFER (mineração/ambiente/florestal/infra, fora da lista original). **Rejeitados** (sem feed funcional): AIAFA News (`/feed/` 404, `?feed=rss2` devolve HTML normal), Estradão (domínio `estradao.com.br` não resolve/não existe), Guia Marítimo (`/feed/` redireciona pra página 404 do site), NTC&Logística (`portalntc.org.br/feed/` cai em challenge anti-bot, não retorna RSS real). Ver lista completa e domínios em `src/wf01-coleta.js` (`FEEDS`).

---

> **NOTA DE MIGRAÇÃO (jun/2026):** este projeto está sendo migrado de **N8N Cloud** para **Node.js + GitHub Actions** (ver `README.md`). Enquanto a migração não termina, as seções acima descrevem o comportamento de referência (a "spec") a ser preservado. Itens que mudam com a migração: schedules passam a ser **encadeados** (`needs`) em vez de independentes; o runtime deixa de ser o N8N. As regras de copy/negócio (idioma, tom, sem travessão, concorrentes, CTA, assunto) permanecem inegociáveis.
