# CLAUDE.md — Let's Insights (newsletter B2B automatizada)

Este arquivo orienta o Claude Code ao trabalhar neste repositório. Leia por completo antes de qualquer alteração.

---

## O que é este projeto

**Let's Insights** é uma newsletter B2B semanal **totalmente automatizada**, da **Let's** (gestão de frotas, Grupo Águia Branca / portfólio VIXPar, Vitória/ES). Público: gestores de frota, diretores de logística e CFOs de empresas que terceirizam veículos. Responsável: Yago Dias Soares (CRM e Marketing Automation).

A automação roda em **N8N Cloud** e é composta por **3 workflows** que rodam toda segunda-feira em sequência por horário (não estão encadeados por conexão — são schedules independentes):

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
- **Claude API** modelo `claude-sonnet-4-5-20250929` (curadoria, redação, e antigamente filtro de concorrentes)
- **Google Sheets** — banco de dados. Doc ID: `1xSjvbZwI-3oLScimPcpBftB2E4muLV07dt1ZOVo3N5s`
  - Aba **Edicoes** — gid `1325127310` — colunas: `edicao, titulo_edicao, pre_header, json_artigos_principais, json_artigos_cards, json_cta, status, gerado_em, enviado_em`
  - Aba **Artigos_Coletados** — gid `1508227275` — colunas: `edicao, data_coleta, titulo, url, fonte, data_publicacao, resumo, status, tema`
- **E-goi** — disparo de produção (futuro). **Gmail** — preview atual.
- **CDN de imagens** (logo, ícones): SendGrid account `aead0c601c58f7b7`.

## Regras inegociáveis do projeto

1. **Idioma:** tudo em **PT-BR**.
2. **Tom de voz:** B2B premium, profissional, direto, sem floreios.
3. **NUNCA usar travessão (—)** em copy.
4. **Copyright:** sempre parafrasear conteúdo de portais, nunca copiar literal. Citar a fonte.
5. **Concorrentes:** bloquear notícias onde Localiza/Movida/Unidas/Vamos/Ouro Verde/ALD/Arval são **protagonistas**; permitir menção neutra de mercado.
6. **CTA "Falar com Especialista":** sempre `https://www.lets.com.br/solicitar-proposta` (nunca `/contato`).
7. **Assunto:** padrão `Let's Insights · [destaque]` com **ponto médio U+00B7** (não hífen).
8. **ClickUp:** **NUNCA** criar/editar/ler/mover/comentar tasks **sem autorização explícita do Yago na mensagem específica** — mesmo que pareça implícito. Sempre ler uma task antes de atualizar. (Workspace 36916834; tasks de referência: `86ahfmnwx` projeto, `86ahderm5` log de resultados.)
9. **Integrações:** nunca inventar capacidades/APIs. Verificar viabilidade antes de propor.
10. **Decisões fechadas:** schedules independentes (não encadear), modelo Sonnet 4.5, Google Sheets como banco (não migrar para Airtable/Supabase/Notion por enquanto).

## Como o Yago gosta de trabalhar (preferências)

- Direto e orientado a decisão. Prefere **opções A/B/C com trade-offs honestos** antes de implementar.
- Prefere **snippets prontos para colar no nó do N8N** a arquivos JSON inteiros, **quando a mudança é só de código**. JSON completo só quando a mudança é estrutural (nós/conexões).
- **Sempre validar nomes de campo contra o output real do nó upstream** — nunca inferir do código do workflow. Já corrigiu o Claude várias vezes por isso. Quando em dúvida sobre o schema, peça os logs/output real.
- Itera por bugs de forma sistemática; aceita pivotar de estratégia em vez de insistir em becos sem saída.

---

## Arquitetura detalhada dos workflows (estado atual)

### WF-01 (06:00) — Coleta
```
Toda Segunda 06:00 → Ler Edicoes → Config Edição → [9 RSS] → Padronizar Estrutura
→ Calcular Idade → Filtrar por Palavras-Chave1 → Deduplicar → Filtrar Concorrentes
→ Enriquecer e Limitar → Salvar no Google Sheets
```
- **9 feeds RSS:** Frota&Cia, Transporte Moderno, Diário do Transporte, Logweb, NeoFeed, Brazil Journal, Mobilidade Estadão, Valor Investe, Exame. Todos com `continueOnFail` + `onError: continueRegularOutput`.
- **Config Edição:** `max(edicao)+1` da aba Artigos_Coletados (numeração sequencial 1, 2, 3...).
- **Calcular Idade:** não descarta por corte fixo; calcula `idade_dias`, descarta só >60 dias. Declara `pairedItem`.
- **Filtrar por Palavras-Chave1:** filtro de relevância B2B. **Ver "ponto de atenção" abaixo** — pode estar em v2 (rigoroso) ou v3 (permissivo).
- **Deduplicar:** remove duplicados da execução; idealmente também faz **anti-duplicação histórica** (lê `$('Ler Edicoes').all()` e descarta URLs já usadas em edições passadas).
- **Filtrar Concorrentes:** heurística sem API — concorrente no título = descarta; no resumo + palavra de protagonismo = descarta; menção neutra = aprova.
- **Enriquecer e Limitar:** **janela de idade adaptativa 7→14→21→30** (expande só se pool < `ALVO_MINIMO=15`); **cap por fonte** `MAX_POR_FONTE=3`; **cap por tema** `MAX_POR_TEMA=6` via `classificarTema()`; `MAX_TOTAL=30`. Salva `tema`. Usa `$('Config Edição').first()`.
- **Salvar no Google Sheets:** `appendOrUpdate`, **`matchingColumns=['url']`** (cada artigo = 1 linha), schema com coluna `tema`.

### WF-02 (06:04) — Curadoria + Redação
```
Toda Segunda 06:04 → Ler Edicoes → Definir Edição → Ler Artigos Coletados
→ Filtrar Edição Atual → Preparar Curadoria → Claude API - Curadoria → Parse Curadoria
→ Buscar HTML do Artigo → Extrair Imagem → Validar URLs Vivas → Preparar Redação
→ Claude API - Redação → Parse Edição Final + Validar URLs → Salvar Edição
```
- **Definir Edição:** `max(edicao)` (a que o WF-01 acabou de gravar).
- **Preparar Curadoria:** passa `tema` à IA; regra de diversidade (3 principais de temas distintos; máx 2 por fonte). Seleciona 7 (3 principais + 3 cards + 1 backup), ordenados por score.
- **Parse Curadoria / Parse Edição Final:** ambos usam `repairJSON()` (limpa aspas tipográficas, travessões, controle; escapa aspas internas linha a linha) antes do `JSON.parse`.
- **Extrair Imagem:** og:image → twitter:image → image_src; normaliza `//` e `http→https`; preserva `tema`; usa `idx` do `.map` (não `posicao`).
- **Validar URLs Vivas:** HEAD com timeout 5s; descarta 4xx/5xx; imagem 404 vira null mantendo artigo; erro de rede = mantém.
- **Preparar Redação:** tom Let's, sem travessão, parafrasear; **1 card por tema** + 3 principais de temas distintos; integridade de URL/fonte/imagem inviolável; título `Let's Insights · [destaque]` (U+00B7); resumo principal ≤50 palavras, card ≤25 palavras.
- **Parse Edição Final + Validar URLs:** corrige URL inventada pela IA (fallback por posição); status `pronto_envio_com_imagens`.
- **Salvar Edição:** aba Edicoes, **`matchingColumns=['edicao']`** (aqui `edicao` é correto: 1 linha por edição).

### WF-03 (06:06) — Montagem HTML + Envio
```
Toda Segunda 06:06 → Ler Todas as Edições1 → Validar e Selecionar Edição1
→ Buscar Blog Lets → Extrair Post Recente → Buscar Página do Post → Extrair Imagem do Post
→ Montar HTML1 → Criar Anexo HTML1 → Gmail - Enviar Preview1 → Confirmar Preview1
→ Atualizar Status1
```
- **Validar e Selecionar Edição1:** pega a edição `pronto_envio_com_imagens` mais recente.
- **Scraping do blog** (4 nós): pega post mais recente do blog Webflow da Let's (`lets.com.br/blog`) para o card destaque do grid. Os nós Code leem dados via `$('Validar e Selecionar Edição1').first()` e `$('Extrair Post Recente').first()`, **não de `$input`** (senão o payload da edição se perde após os HTTP de scraping).
- **Montar HTML1:** template **Cerberus Hybrid**, 600px, Open Sans, cor primária `#f15a22`, dark mode (`@media prefers-color-scheme` + `[data-ogsc]`). Topo laranja "EDIÇÃO N · DD MMM YYYY". 3 principais (img 160×160 + divisores). Grid 2×2 (card blog com borda laranja no slot 1 + 3 cards). CTA "FALAR COM ESPECIALISTA". Footer laranja 2 colunas (MSO width 504, colunas 232 + padding 20 nas TDs MSO). UTMs `utm_source=newsletter&utm_medium=email&utm_campaign=insights&utm_content=principal_N/card_N`. Imagem fallback: `https://cdn.prod.website-files.com/67d2cd7e700eb793f98a2e81/6a04acd2772388e00bdf5a8d_Gemini_Generated_Image_nmyoe6nmyoe6nmyo.png`.

---

## Pontos de atenção / bugs conhecidos (verificar antes de mexer)

1. **Filtro de relevância (WF-01):** existem duas versões. **v2** (rigoroso, exige contexto B2B adjacente a termos genéricos) deixava passar só ~3 artigos. **v3** (termos centrais aceitos diretamente, exclusão B2C só para transporte público de passageiros, normalização de acento consistente) resolveu — passou para ~9 artigos. **Confirme qual está no `jsCode` do nó antes de diagnosticar escassez de artigos.**
2. **`matchingColumns` (WF-01 Salvar):** tem que ser **`url`** na aba Artigos_Coletados. Se estiver `edicao` (ou vazio), o Sheets sobrescreve linhas da mesma edição e só salva 1-3 artigos.
3. **WF-03 "Atualizar Status1":** há inconsistência — `documentId` aponta para aba Edicoes mas `sheetName.value` é o gid de Artigos_Coletados, com `matchingColumns=['edicao']`. Gera linhas-fantasma. **Correção pendente:** apontar consistentemente para a aba Edicoes.
4. **Fallback de imagem (WF-02 Parse Edição Final):** versão anterior tinha `aplicarFallback()` para trocar imagem null pelo fallback; sumiu da versão atual. Decidir se reinclui.
5. **Paired item errors (N8N 2.27):** se aparecer "Paired item data... unavailable", a causa é nó Code sem `pairedItem: {item: i}` declarado, ou referência `$('Nó').item` a nó fora da cadeia direta. Solução: usar `.first()`, declarar `pairedItem`, referenciar só nós da cadeia.
6. **Hotlink 403 (Frota&Cia, Logweb no Outlook):** limitação do servidor da fonte ao baixar imagem sem referrer. Aceito como conhecido.

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

## Pendências / backlog

- [ ] Confirmar se WF-01 em produção tem filtro v3 + anti-duplicação histórica (ou se é híbrido).
- [ ] Confirmar coluna `tema` criada e populada na aba Artigos_Coletados.
- [ ] Corrigir WF-03 "Atualizar Status1" (documentId/sheetName inconsistentes → linhas-fantasma).
- [ ] Decidir reinclusão do `aplicarFallback()` no WF-02.
- [ ] Conferir distribuição de temas nos logs e calibrar listas do `classificarTema()`.
- [ ] Validar footer Outlook em edição real via E-goi.
- [ ] Decisão de horário (terça/quarta 8h30–10h vs segunda 06:00) + teste A/B.
- [ ] Fase 2 captação: landing lets.com.br/newsletter, double opt-in LGPD.
- [ ] Base Pipedrive (~11k): enriquecimento Apollo + tracking pós-envio.
- [ ] Expansão RSS: verificar `/feed/` de AIAFA News, Logística no Brasil, O Carreteiro, Carga Pesada, Estradão, Guia Marítimo, NTC&Logística.

---

> **NOTA DE MIGRAÇÃO (jun/2026):** este projeto está sendo migrado de **N8N Cloud** para **Node.js + GitHub Actions** (ver `README.md`). Enquanto a migração não termina, as seções acima descrevem o comportamento de referência (a "spec") a ser preservado. Itens que mudam com a migração: schedules passam a ser **encadeados** (`needs`) em vez de independentes; o runtime deixa de ser o N8N. As regras de copy/negócio (idioma, tom, sem travessão, concorrentes, CTA, assunto) permanecem inegociáveis.
