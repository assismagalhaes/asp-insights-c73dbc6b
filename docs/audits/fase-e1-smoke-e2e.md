# Fase E1 - Smoke manual autenticado e matriz E2E minima

Data: 2026-07-04

## Objetivo

Validar, em ambiente real ou staging autenticado, os fluxos que a Fase E nao conseguiu cobrir com build, typecheck, testes Python e revisao estatica.

Esta fase nao altera runtime, regra de negocio, calculo de banca, decisao `CONFIRMAR`/`PULAR`, schema Supabase, migrations, prompts IA/OCR, scraper ou dados de producao.

## Status desta execucao

| Item | Status | Observacao |
| --- | --- | --- |
| Documento de checklist E1 | OK | Criado neste arquivo. |
| Matriz E2E minima | OK | Definida abaixo, pronta para execucao manual ou automacao futura. |
| Execucao autenticada em staging/producao | Bloqueado | Faltam URL alvo confirmada, credenciais de usuarios de teste e massa controlada. |
| Correcoes pequenas | Nao aplicavel | Nenhum bug critico/obvio foi confirmado nesta sessao. |

## Insumos obrigatorios antes de executar

- URL do ambiente alvo: staging, preview ou producao.
- Usuario QA A com permissao normal.
- Usuario QA B com permissao normal para validar isolamento/RLS.
- Se existir fluxo admin, usuario admin separado.
- Massa controlada com:
  - 1 prognostico `CONFIRMAR` ainda nao publicado;
  - 1 prognostico `PULAR` ou caso que possa ser pulado;
  - 1 coleta de odds concluida ou job de teste que possa ser criado;
  - 1 oportunidade MLB elegivel para handoff Screener -> Validator;
  - 1 arquivo pequeno de imagem/documento para upload/OCR;
  - 1 CSV/XLSX pequeno com linhas validas, invalidas e duplicadas.
- Confirmacao explicita de que os testes podem gravar dados no ambiente escolhido.

## Regras de execucao segura

- Nao limpar dados de producao.
- Nao apagar registros existentes fora da massa de teste.
- Marcar todos os registros criados no teste com prefixo identificavel, por exemplo `QA-E1`.
- Antes de registrar resultado financeiro, anotar valor atual de bankroll/dashboard.
- Depois de registrar resultado financeiro, reconciliar apenas os registros criados pela massa QA.
- Se um bug medio/grande aparecer, parar o fluxo afetado e documentar para PR separado.

## Checklist manual autenticado

### 1. Login e navegacao

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-AUTH-01 | Acessar URL alvo sem sessao. | Redireciona para `/auth`. | Pendente |
| E1-AUTH-02 | Fazer login com Usuario QA A. | Entra no app sem erro global. | Pendente |
| E1-AUTH-03 | Abrir cada item da sidebar. | Rotas carregam sem tela branca. | Pendente |
| E1-AUTH-04 | Fazer logout/login novamente. | Sessao e redirect continuam funcionais. | Pendente |

### 2. ASP Screener

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-SCR-01 | Abrir `/asp-screener`. | Tela carrega cards, filtros e estados iniciais. | Pendente |
| E1-SCR-02 | Carregar odds/snapshot MLB do dia ou massa QA. | Odds e snapshot aparecem sem erro. | Pendente |
| E1-SCR-03 | Rodar Moneyline Screener. | Linhas avaliadas aparecem. | Pendente |
| E1-SCR-04 | Rodar Over/Under Screener. | Linhas avaliadas aparecem, sem mercados quebrados. | Pendente |
| E1-SCR-05 | Rodar Asian Handicap / Run Line Screener. | Linhas avaliadas aparecem, com linhas baseball `.5`. | Pendente |
| E1-SCR-06 | Gerar Opportunity Score/Shortlist. | Oportunidades aparecem com score e filtros funcionais. | Pendente |
| E1-SCR-07 | Abrir payload de oportunidade. | JSON abre sob demanda e sem travar UI. | Pendente |
| E1-SCR-08 | Copiar payload. | Clipboard recebe payload valido. | Pendente |
| E1-SCR-09 | Criar handoff para Validator. | Navega/preenche Validator e registra auditoria de handoff. | Pendente |
| E1-SCR-10 | Abrir historico/auditoria/calibracao. | Filtros e contagens carregam. | Pendente |

### 3. ASP Validator

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-VAL-01 | Abrir `/asp-validator`. | Tela carrega historico, formulario e dashboard especifico. | Pendente |
| E1-VAL-02 | Criar validacao manual minima. | Formulario aceita campos e valida sem erro de UI. | Pendente |
| E1-VAL-03 | Receber handoff vindo do Screener. | Banner/payload importado aparece com dados corretos. | Pendente |
| E1-VAL-04 | Copiar payload importado. | Clipboard recebe JSON do handoff. | Pendente |
| E1-VAL-05 | Descartar handoff de teste. | Draft some e auditoria marca descarte. | Pendente |
| E1-VAL-06 | Upload de arquivo QA. | Arquivo salva em storage/tabela e aparece no detalhe. | Pendente |
| E1-VAL-07 | CTRL+V de imagem, se navegador permitir. | Upload source aparece como `CTRL+V`. | Pendente |
| E1-VAL-08 | Rodar OCR em arquivo pequeno. | Status vai para completed ou erro explicito controlado. | Pendente |
| E1-VAL-09 | Rodar IA local. | Retorna somente `CONFIRMAR` ou `PULAR`. | Pendente |
| E1-VAL-10 | Rodar IA + Pesquisa. | Retorna somente `CONFIRMAR` ou `PULAR`; guardrail preservado. | Pendente |
| E1-VAL-11 | Registrar resultado de validacao `PULAR`. | Grava como simulado, `bankroll_applied=false`. | Pendente |
| E1-VAL-12 | Registrar resultado de validacao `CONFIRMAR`. | Grava como oficial, `bankroll_applied=true`, stake positiva. | Pendente |
| E1-VAL-13 | Recarregar dashboard especifico. | Filtros e metricas refletem os registros QA. | Pendente |

### 4. Dashboard geral e Bankroll

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-FIN-01 | Anotar cards antes dos registros QA. | Baseline financeiro documentado. | Pendente |
| E1-FIN-02 | Registrar caso `PULAR` no Validator. | Dashboard/Bankroll real nao muda. | Pendente |
| E1-FIN-03 | Registrar caso `CONFIRMAR` no Validator. | Dashboard/Bankroll muda apenas pelo caso oficial. | Pendente |
| E1-FIN-04 | Conferir ROI/yield/lucro. | Valores batem com stake, odd e resultado esperados. | Pendente |
| E1-FIN-05 | Conferir historico do Bankroll. | Entradas reais aparecem; simuladas nao entram como financeiro. | Pendente |

### 5. Prognosticos, Publicacao e Historico

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-PROG-01 | Abrir `/prognosticos`. | Listagem e filtros carregam. | Pendente |
| E1-PROG-02 | Abrir detalhe de prognostico QA. | Dados tecnicos/parecer aparecem quando existem. | Pendente |
| E1-PUB-01 | Abrir `/publicacao`. | Lista mostra apenas itens publicaveis. | Pendente |
| E1-PUB-02 | Tentar publicar item `PULAR`/`PASS`. | Bloqueio permanece ativo. | Pendente |
| E1-PUB-03 | Editar TIP de item confirmado. | Texto editado permanece antes da publicacao. | Pendente |
| E1-HIST-01 | Abrir `/historico`. | Filtros e resultados carregam. | Pendente |
| E1-HIST-02 | Conferir caso QA. | Resultado e dados financeiros nao divergem do Bankroll. | Pendente |

### 6. Coleta de Odds

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-COL-01 | Abrir `/coleta-dados`. | Tela carrega historico de coletas e formulario. | Pendente |
| E1-COL-02 | Criar job QA, se permitido. | Job cria status `PENDENTE`/`RODANDO`. | Pendente |
| E1-COL-03 | Consultar status. | Status atualiza sem erro silencioso. | Pendente |
| E1-COL-04 | Importar resultado normalizado. | Preview/tabela mostra odds. | Pendente |
| E1-COL-05 | Validar baseball Over/Under e Run Line. | Apenas linhas `.5` entram para esses mercados. | Pendente |
| E1-COL-06 | Forcar/observar erro de job controlado. | Mensagem de erro aparece corretamente. | Pendente |

### 7. Importacao CSV/XLSX

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-IMP-01 | Abrir `/importar`. | Tela aceita CSV/XLSX. | Pendente |
| E1-IMP-02 | Upload de CSV pequeno com linha valida. | Linha aparece valida e selecionada. | Pendente |
| E1-IMP-03 | Upload com linha invalida. | Erro de campo aparece e linha nao importa. | Pendente |
| E1-IMP-04 | Upload com duplicata. | Duplicata e marcada; opcao de ignorar funciona. | Pendente |
| E1-IMP-05 | Selecionar todos/individual. | Estado de selecao bate com contador. | Pendente |
| E1-IMP-06 | Confirmar importacao QA. | Apenas selecionadas validas entram em prognosticos. | Pendente |

### 8. RLS e isolamento de usuario

| ID | Passo | Esperado | Status |
| --- | --- | --- | --- |
| E1-RLS-01 | Usuario QA A cria registro QA em Validator. | Registro visivel para QA A. | Pendente |
| E1-RLS-02 | Login Usuario QA B. | Registro QA A nao aparece para QA B. | Pendente |
| E1-RLS-03 | QA B cria handoff/snapshot/validacao propria. | QA A nao ve dados de QA B. | Pendente |
| E1-RLS-04 | Conferir storage de upload. | Upload de QA A nao abre para QA B. | Pendente |

## Matriz E2E minima automatizavel

Esta matriz e o alvo recomendado para uma futura suite Playwright pequena. Ainda nao foi implementada nesta fase para evitar adicionar dependencias/configuracao sem decisao explicita.

| Cenario | Rota inicial | Assercoes minimas |
| --- | --- | --- |
| Login e guard auth | `/asp-screener` sem sessao | Redireciona para `/auth`; apos login volta ao app. |
| Navegacao principal | `/` autenticado | Sidebar abre Screener, Validator, Prognosticos, Publicacao, Historico, Bankroll e Coleta. |
| Bloqueio financeiro de PULAR | `/asp-validator` | Registro `PULAR` fica simulado e nao muda Bankroll. |
| Registro financeiro confirmado | `/asp-validator` | Registro `CONFIRMAR` com stake valida aparece no Bankroll. |
| Handoff Screener -> Validator | `/asp-screener` | Handoff preenche Validator e nao cria prognostico/bankroll automaticamente. |
| Publicacao bloqueia pulados | `/publicacao` | Itens `PULAR`/`PASS` nao aparecem como publicaveis ou sao bloqueados. |
| RLS basico | duas sessoes | Usuario B nao ve registros, handoffs, snapshots ou uploads do Usuario A. |
| Coleta QA | `/coleta-dados` | Job cria status, resultado normalizado gera preview, erros aparecem. |
| Importacao | `/importar` | CSV/XLSX valida campos, duplicatas e selecao. |

## Registro de execucao desta sessao

| Acao | Resultado |
| --- | --- |
| Base da branch | `origin/main` apos merge da Fase E. |
| Criacao do checklist | OK. |
| Revisao de insumos locais | OK, mas sem credenciais de usuario QA nem URL alvo confirmada. |
| Execucao autenticada real/staging | Bloqueada por falta de insumos. |
| `tsc --noEmit` | OK. |
| `vite build --outDir .codex_tmp/fase-e1-build --emptyOutDir` | OK. |
| `python -m unittest discover -s tests -p "test_*.py"` | OK, 365 testes. |
| `git diff --check` | OK. |
| `eslint .` | Falha conhecida de baseline Prettier/CRLF. |
| Alteracao de runtime | Nenhuma. |
| Alteracao de dados | Nenhuma. |

## Bugs encontrados

- Nenhum bug critico confirmado nesta sessao.
- Nenhum ajuste de codigo foi aplicado.

## Pendencias para concluir E1 de ponta a ponta

- Fornecer URL alvo e usuarios QA A/B.
- Confirmar se pode gravar dados de teste no ambiente escolhido.
- Disponibilizar massa controlada ou autorizar a criacao manual dessa massa.
- Executar checklist e substituir os status `Pendente` por `OK`, `Falhou` ou `Bloqueado`.
- Se algum fluxo falhar, abrir PR separado quando a correcao nao for trivial.

## Recomendacao

Antes da proxima fase de refatoracao ou feature, executar este checklist em staging com dois usuarios. Depois, transformar a matriz E2E minima em uma suite Playwright pequena, cobrindo apenas os caminhos de maior risco financeiro: auth, handoff, `PULAR`, `CONFIRMAR`, Bankroll, Publicacao e RLS.
