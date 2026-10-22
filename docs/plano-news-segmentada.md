# Let's Insights segmentada: desenho do pipeline

Status: **proposta para aprovação do Yago** (2026-10-22). Nada disto está implementado.

## Objetivo

A lista **Gestores 2025** (E-goi, lista 67) é de clientes da Let's. Para ela a news deixa de ter objetivo de venda e passa a ter objetivo de marca e autoridade. Os 5 segmentos com mais contatos ativos recebem uma versão própria; o resto continua com a versão geral.

| Versão | Para quem | Contatos ativos |
|---|---|---|
| Mineração e siderurgia | lista 67, Segmento = 1 | 54 |
| Indústria e manufatura | lista 67, Segmento = 2 | 52 |
| Engenharia e construção | lista 67, Segmento = 3 | 34 |
| Tecnologia e telecom | lista 67, Segmento = 4 | 32 |
| Florestal e celulose | lista 67, Segmento = 5 | 33 |
| Geral (clientes) | lista 67, Segmento = Geral ou vazio | 276 |
| Geral (comercial) | listas 34 (Condutores) e 69 (Base Usuários) | como hoje |

O campo `Segmento` (field_id 21) já existe e está preenchido na lista 67. Os 6 segmentos salvos são criados pelo Yago no painel (a API não cria segmento).

## Estrutura de cada versão segmentada

Mesmo formato visual de hoje (imagem + categoria + frase única estilo Brazil Journal + "Ler matéria"), com 5 itens nesta ordem:

1. Notícia do segmento
2. Destaque do blog Let's
3. Notícia do segmento
4. Notícia geral do Brasil
5. Notícia geral do Brasil

- **Notícias gerais do Brasil:** 4 temas (economia, regulação, negócios, operação). A curadoria escolhe as 2 mais relevantes da semana, de temas diferentes entre si. As mesmas 2 entram nas 5 versões segmentadas.
- **Sem botão de CTA.** No lugar, uma linha de identidade no rodapé, por exemplo: "Você recebe a Let's Insights por ser cliente Let's. Curadoria semanal do que muda na operação do seu setor." Sem convite para responder.
- **Assunto e pré-header próprios por versão**, a partir da notícia 1 (mesmas regras de hoje: manchete na frente, ` « Let's Insights` no fim, via `montarAssunto()`).

A versão geral comercial (listas 34 e 69) fica exatamente como hoje: blog + 3 notícias e botão "Falar com Especialista".

## WF-01: coleta

Hoje o filtro de relevância (`filtrarRelevancia`) só deixa passar notícia que fala de frota. Notícia de mineração ou de tecnologia que não cita frota seria descartada, então o WF-01 passa a ter **três trilhas**:

| Trilha | Fontes | Filtro |
|---|---|---|
| Frota (como hoje) | os 16 feeds atuais | filtro de frota atual |
| Segmento | feeds atuais + feeds novos por setor | palavras-chave do setor (sem exigir frota) |
| Brasil | feeds de economia, regulação e negócios | palavras-chave dos 4 temas + descarte de política partidária, crime, esporte, celebridade |

- Cada artigo ganha a coluna `segmento` (mineracao, industria, engenharia, tecnologia, florestal, brasil ou vazio), ao lado de `tema`. Migração aditiva (`ALTER TABLE`), como foi com `json_blog`.
- Cap do pool sobe de 30 para cerca de 70, com mínimo de candidatos por trilha (meta: 6 por segmento, 8 em Brasil), para cada versão ter reserva.
- Concorrentes, idade e deduplicação histórica seguem iguais para todas as trilhas.

**Fontes novas a validar feed por feed** (200 + XML real + itens recentes, como na expansão de jul/2026; nenhuma foi testada ainda):

| Segmento | Candidatas |
|---|---|
| Mineração e siderurgia | Notícias de Mineração Brasil, Aço Brasil, Revista Minérios & Minerales |
| Indústria e manufatura | Agência de Notícias da Indústria (CNI), Portal da Indústria, Revista Indústria Hoje |
| Engenharia e construção | Revista Grandes Construções, O Empreiteiro, CBIC |
| Tecnologia e telecom | Teletime, TeleSíntese, Convergência Digital |
| Florestal e celulose | Painel Florestal, CeluloseOnline, Revista O Papel (IBÁ já está) |
| Brasil | Agência Brasil (economia), InfoMoney, Poder360 (economia); NeoFeed, Brazil Journal e Exame já estão |

## WF-02: curadoria e redação

Continua **uma chamada de curadoria e uma de redação** (Sonnet 4.5), só que maiores:

- **Curadoria:** recebe o pool com `segmento` e devolve, ordenado por score:
  - geral: 6 (3 + 3 reserva), como hoje;
  - cada segmento: 4 (2 + 2 reserva);
  - Brasil: 4 (2 + 2 reserva), de temas diferentes.
  Um artigo não pode ser usado em dois lugares. Diversidade de fonte vale dentro de cada versão.
- **Validação de link e imagem, fallback Gemini e re-hospedagem:** rodam uma vez sobre a união dos artigos (sem duplicar trabalho).
- **Redação:** escreve cada artigo uma única vez (o mesmo título serve para todas as versões em que ele aparece) e gera assunto + pré-header para cada uma das 7 versões.
- **Faltou notícia de segmento** (menos de 2 válidas depois da validação): completa com a melhor notícia geral de operação ainda não usada. A versão nunca sai com menos de 5 itens.
- **Custo estimado:** de cerca de US$ 0,06 para algo entre US$ 0,15 e 0,25 por semana (prompts maiores; mesmo número de chamadas).

**Banco:** nova tabela `edicoes_versoes` (PK `edicao` + `versao`), com `titulo_edicao`, `pre_header`, `json_itens`, `status`. A tabela `edicoes` continua guardando a versão geral, para não quebrar nada.

## WF-03: montagem e rascunhos

- `montarHTML` passa a aceitar lista de N itens e as opções `semCta` e `linhaIdentidade`.
- **Preview no Gmail:** um único e-mail com a versão geral no corpo e as outras 6 versões em anexo (`lets_insights_<edicao>_<versao>.html`). Os anexos do teste de posição de CTA saem (o teste perde sentido com a mudança de objetivo).
- **Rascunhos no E-goi:** 8 por semana, todos em `draft`, nunca enviados pelo pipeline:
  - lista 34 e lista 69: versão geral comercial, como hoje;
  - lista 67: 6 rascunhos, nomeados `POR PUBLICAR · Gestores · <Segmento> · <manchete>`. Na hora de publicar, o Yago escolhe o segmento correspondente no painel.
- **Descadastro:** antes de ativar, confirmar no painel que o envio de um rascunho criado pela API sai com o link de descadastro (entre 18/08 e 01/09 os envios saíram sem ele).

## Medição

Clique fica em segundo plano (robôs). Métricas principais por versão, comparadas com o histórico do próprio segmento:

- **Cobertura de contas:** empresas (domínio) com pelo menos 1 abertura no mês, sobre empresas com contato ativo.
- **Abertura única por segmento**, contra a média do segmento nos 19 envios anteriores.
- **Descadastro por segmento**, como alarme de relevância.

Avaliar só depois de 6 a 8 edições: cada segmento tem entre 32 e 54 contatos ativos, então a semana a semana oscila muito.

## Documentação a atualizar junto com o código

- `CLAUDE.md` do projeto: regra 6 (CTA só na versão geral comercial), descrição do WF-01/02/03, tabela nova do banco.
- Memória: `news-segmentada-gestores`.

## Implantação proposta

1. Validar feeds novos e escrever a trilha de segmento e Brasil no WF-01.
2. WF-02 (curadoria, redação, banco) e WF-03 (template, preview, rascunhos).
3. **Semana de ensaio:** o pipeline gera tudo, o Yago revisa o preview e os 8 rascunhos, sem disparar as versões segmentadas.
4. Yago cria os 6 segmentos no painel e confirma o descadastro.
5. Primeiro disparo segmentado, manual, como hoje.

## Decisões do Yago (2026-10-22)

Desenho aprovado. Visual aprovado a partir do exemplo `lets/Marketing/Email/campanhas/exemplo-news-segmentada-mineracao.html`, **sem o selo do segmento no topo**.

1. **Gestores fora dos 5 segmentos (276 clientes):** versão geral **sem** botão e com a linha de identidade.
2. **Selo do segmento no topo:** não usar. O topo fica igual ao de hoje.
3. **Teste de posição do CTA:** encerrado; os anexos de início/meio/fim saem do preview.
4. **Notícias gerais do Brasil:** as mesmas 2 nas 5 versões segmentadas.
5. **Segmento sem notícia suficiente:** completar com a melhor notícia geral de operação ainda não usada; nenhuma versão sai com menos de 5 itens.

Versões por semana, portanto: 5 segmentadas (lista 67), 1 geral para clientes sem botão (lista 67, segmento Geral) e 1 geral comercial com botão (listas 34 e 69).
