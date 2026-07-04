# Fase E - QA funcional pos-refatoracao

Data: 2026-07-04

## Escopo

QA funcional completo pos-D1/D2/D2.1/D3/D4, sem feature nova, sem alteracao de regra de negocio, sem migration, sem limpeza de dados, sem mudanca de prompt IA/OCR/scraper e sem refatoracao adicional.

Esta fase foi executada como validacao tecnica e revisao funcional dirigida. Nao houve alteracao em codigo de runtime.

## Metodologia

- Checks obrigatorios executados localmente.
- Revisao estatica dos fluxos em rotas, hooks e servicos criticos.
- Verificacao especifica de contaminacao financeira por `PULAR`, handoffs, snapshots e resultados simulados.
- Verificacao especifica de separacao entre Screener, Validator, Coleta, Dashboard, Bankroll e Historico.
- Tentativa de smoke local do servidor Vite. O servidor nao iniciou via `Start-Process` nesta sessao por conflito ambiental `Path/PATH`; o build de producao passou e foi usado como validacao de empacotamento.

## Checks tecnicos

| Check                                                       | Resultado       | Observacao                                                                                                                                             |
| ----------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit`                                              | OK              | Sem erros TypeScript.                                                                                                                                  |
| `vite build --outDir .codex_tmp/fase-e-build --emptyOutDir` | OK              | Primeira tentativa falhou por sandbox/acesso ao `vite.config.ts`; repetido fora do sandbox e passou.                                                   |
| `python -m unittest discover -s tests -p "test_*.py"`       | OK              | 365 testes passaram usando o Python do runtime local.                                                                                                  |
| `git diff --check`                                          | OK              | Apenas aviso conhecido de line ending em `routeTree.gen.ts`, sem erro de whitespace.                                                                   |
| `eslint .`                                                  | Falha conhecida | Baseline antigo de Prettier/CRLF: `eslint.config.js`, `src/components/app-sidebar.tsx` e demais arquivos com CRLF. Nao parece causado pelas fases D/E. |

## ASP Screener

| Fluxo                          | Resultado                  | Evidencia                                                                                                   |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Tela/rota `/asp-screener`      | OK por build e rota tipada | Rota autenticada compila e entra no bundle `asp-screener`.                                                  |
| Odds carregam                  | OK por revisao             | `useQuery` usa odds MLB filtradas por data; preview de Coleta tambem e lido de storage local quando existe. |
| Moneyline Screener             | OK por revisao             | `generateMoneylineProjections` exige snapshot e chama `buildMlbMoneylineScreenerRows`.                      |
| Over/Under Screener            | OK por revisao             | `generateTotalsProjections` usa standings e `leagueAverageSnapshot`.                                        |
| Asian Handicap / Run Line      | OK por revisao             | `generateHandicapProjections` segue o mesmo gate de snapshot/odds.                                          |
| Opportunity Score              | OK por revisao             | `buildMlbOpportunityShortlist` agrega moneyline, totals e handicap.                                         |
| Shortlist/filtros              | OK por revisao             | Filtros derivados por `filterOpportunityRows` e estados memoizados.                                         |
| Snapshots                      | OK por revisao             | `listMlbDailySnapshots` e `listMlbOpportunitySnapshots` usam paginacao por limite.                          |
| Carregar mais snapshots        | OK por revisao             | `snapshotOpportunityLimit` cresce a partir de `SNAPSHOT_OPPORTUNITY_PAGE_SIZE`.                             |
| Payload/copiar payload         | OK por revisao             | Payloads sao exibidos/copiados sob acao explicita.                                                          |
| Baseball-Reference             | OK por build/revisao       | Servico MLB standings permanece no bundle e preserva fallback de CSV manual.                                |
| Handoff para Validator         | OK por revisao             | `storeMlbValidatorHandoffDraft`, auditoria e link de snapshot continuam separados do bankroll.              |
| Historico/auditoria/calibracao | OK por revisao             | Filtros de auditoria/calibracao continuam em `filterHandoffAuditRows`/`filterCalibrationRows`.              |

Achado: nenhum bug critico encontrado no Screener nesta fase. Fluxos dependentes de dados reais de odds/Supabase nao foram clicados em ambiente autenticado.

## ASP Validator

| Fluxo                                  | Resultado                  | Evidencia                                                                                                                  |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tela/rota `/asp-validator`             | OK por build e rota tipada | Rota autenticada compila e entra no bundle `asp-validator`.                                                                |
| Formulario manual                      | OK por revisao             | `canValidate` permite core manual, texto colado ou uploads.                                                                |
| Upload                                 | OK por revisao             | `addUploads`, `saveValidation` e storage path por usuario/validator/upload seguem presentes.                               |
| CTRL+V de imagem                       | OK por revisao             | Upload source `clipboard` segue tipado e formatado como `CTRL+V`.                                                          |
| OCR                                    | OK por revisao             | `processUploadOcr`, `persistOcrResult` e `persistStructuredOcr` preservados.                                               |
| IA local                               | OK por revisao             | `validateWithAiFallback` e `validateAspValidatorWithAi` preservam saida `CONFIRMAR`/`PULAR`.                               |
| IA + Pesquisa                          | OK por revisao             | `validateAspValidatorWithOnlineAi` preserva guardrail que rebaixa `CONFIRMAR` para `PULAR` quando EV/odd justa nao passam. |
| Handoff importado                      | OK por revisao             | `readMlbValidatorHandoffDraft`, validacao de versao/origem/destino e importacao continuam ativos.                          |
| Payload importado/copiar payload       | OK por revisao             | `copyImportedHandoffPayload` usa `navigator.clipboard`.                                                                    |
| Descartar handoff                      | OK por revisao             | `discardImportedHandoff` remove draft e marca auditoria como descartada.                                                   |
| Decisao final                          | OK por revisao             | Tipo `Decision` continua restrito a `CONFIRMAR`/`PULAR`; parsers normalizam fallback para `PULAR`.                         |
| `PULAR` nao altera bankroll            | OK por revisao             | Resultado `PULAR` grava `is_simulated_result=true` e `bankroll_applied=false`.                                             |
| `CONFIRMAR` segue regra atual          | OK por revisao             | Resultado exige stake positiva e grava `bankroll_applied=true` apenas quando decisao e `CONFIRMAR`.                        |
| Dashboard especifico/filtros/historico | OK por revisao             | `computeValidatorDashboard` e filtros por periodo/esporte/mercado/decisao/modelo continuam separados.                      |

Achado: nenhum bug critico encontrado no Validator nesta fase. OCR/IA online dependem de servicos externos e nao foram executados com payload real nesta sessao.

## Dashboard geral

| Fluxo                             | Resultado            | Evidencia                                                                                                                                                         |
| --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cards carregam                    | OK por build/revisao | Dashboard/bankroll compila e usa hooks existentes.                                                                                                                |
| ROI/yield/lucro sem contaminacao  | OK por revisao       | `computeMetrics` usa apenas confirmadas; `useAspValidatorBankrollPrognosticos` filtra `decision=CONFIRMAR`, `bankroll_applied=true`, `is_simulated_result=false`. |
| Filtros                           | OK por revisao       | Filtros de historico/prognosticos permanecem por data/esporte/liga/mercado/status.                                                                                |
| Valores batem com registros reais | Pendente de ambiente | Exige base Supabase autenticada com dados reais para reconciliacao manual.                                                                                        |

Achado: regra financeira preservada. Nenhum indico de handoff/snapshot alimentando dashboard financeiro real.

## Prognosticos

| Fluxo                                  | Resultado            | Evidencia                                                   |
| -------------------------------------- | -------------------- | ----------------------------------------------------------- |
| Listagem/filtros                       | OK por revisao       | `usePrognosticos` e filtros de tela continuam ativos.       |
| Detalhes                               | OK por build/revisao | Renderizacao de detalhes tecnicos permanece na rota.        |
| Publicacao nao inclui `PULAR` indevido | OK por revisao       | Tela bloqueia publicacao de `status_validacao === "PULAR"`. |
| Registro de resultado                  | OK por revisao       | Mutations de resultado permanecem no fluxo existente.       |

Achado: nenhum bug critico encontrado.

## Publicacao

| Fluxo                      | Resultado      | Evidencia                                                                                   |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| Lote                       | OK por revisao | `publicarLote` percorre selecao e chama mutation de publicacao.                             |
| TIP editavel               | OK por revisao | Modal/estado `tip` antes de enviar permanecem.                                              |
| Bloqueio de `PULAR`/`PASS` | OK por revisao | Lista de publicaveis exclui status nao confirmados e tela de prognosticos bloqueia `PULAR`. |
| Dados tecnicos/parecer     | OK por revisao | Campos tecnicos seguem renderizados quando presentes.                                       |

Achado: nenhum bug critico encontrado.

## Historico

| Fluxo               | Resultado      | Evidencia                                                                         |
| ------------------- | -------------- | --------------------------------------------------------------------------------- |
| Filtros/resultados  | OK por revisao | Filtros por data, esporte, liga, mercado, status e resultado preservados.         |
| Dados tecnicos      | OK por revisao | Colunas tecnicas aparecem nos detalhes/tabela quando existem.                     |
| Bankroll divergente | OK por revisao | Historico lista prognosticos; bankroll oficial usa filtros financeiros separados. |

Achado: nenhum bug critico encontrado.

## Bankroll

| Fluxo                      | Resultado            | Evidencia                                                                                |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| Historico carrega          | OK por build/revisao | Rota `/bankroll` usa `usePrognosticos` e `useAspValidatorBankrollPrognosticos`.          |
| Entradas reais aparecem    | OK por revisao       | Linhas oficiais combinam prognosticos reais e registros confirmados do ASP Validator.    |
| `PULAR` fora do financeiro | OK por revisao       | `useAspValidatorBankrollPrognosticos` filtra apenas `CONFIRMAR` aplicado e nao simulado. |
| Lucro em unidade/R$        | OK por revisao       | `computeMetrics` e `bankrollTimeline` preservados.                                       |

Achado: nenhum bug critico encontrado.

## Coleta de Odds

| Fluxo                    | Resultado            | Evidencia                                                                                                     |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tela abre                | OK por build/revisao | Rota `/coleta-dados` compila.                                                                                 |
| Criar job                | OK por revisao       | `createRemoteCollection` cria status `PENDENTE` e chama `startScrapingJob`.                                   |
| Consultar status         | OK por revisao       | `getScrapingJobStatus`, `extractVmStatus` e `updateCollectionStatus` preservados.                             |
| Erro de job              | OK por revisao       | Status `ERRO` grava mensagem e exibe toast/alerta.                                                            |
| Preview/resultado        | OK por revisao       | `normalized` alimenta cards, tabela/export e preview para Screener.                                           |
| Baseball com linhas `.5` | OK por revisao       | `requiresBaseballHalfPointLine`/`isHalfPointLine` filtram Over/Under e Asian/Run Line para linhas meio ponto. |
| Fluxo antigo quebrado    | OK por revisao       | Caminho principal usa VM API e fallback de payload normalizado/raw.                                           |

Achado: nenhum bug critico encontrado. Criacao real de job na VM nao foi executada nesta sessao.

## Importacao CSV/XLSX

| Fluxo                             | Resultado      | Evidencia                                                                            |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| Upload CSV/XLSX                   | OK por revisao | Aceita `.csv`, `.xlsx`, `.xls`; ExcelJS ainda usado para XLSX.                       |
| Validacao de campos               | OK por revisao | Required fields e aliases preservados.                                               |
| Duplicatas                        | OK por revisao | Busca chaves existentes e marca `duplicate`; opcao de ignorar duplicados preservada. |
| Normalizacao odds/prob/edge/stake | OK por revisao | `parseProb`, `parseEdge` e payload final preservam stake inicial `0`.                |
| Selecionar todos/individual       | OK por revisao | Estado `selected` e checkbox de selecao seguem presentes.                            |

Achado: nenhum bug critico encontrado.

## Seguranca e dados

| Item                                  | Resultado                    | Evidencia                                                                                                             |
| ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| RLS                                   | OK por revisao de migrations | Tabelas principais, Validator, uploads, handoffs e snapshots possuem RLS por `auth.uid() = user_id`.                  |
| Usuario nao ve dados de outro usuario | OK por revisao de policies   | Policies usam `auth.uid()` e `user_id`; confirmacao real exige teste com dois usuarios.                               |
| Handoffs/snapshots fora do bankroll   | OK por revisao               | Serviços de handoff/snapshot usam tabelas dedicadas; comentarios e queries financeiras mantem separacao.              |
| Simulados fora da performance real    | OK por revisao               | `is_simulated_result=false` e `bankroll_applied=true` sao filtros obrigatorios para ASP Validator entrar no bankroll. |

## Bugs encontrados

- Nenhum bug critico novo identificado por build, typecheck, testes e revisao dirigida.
- Nenhum bug pequeno foi corrigido nesta fase, pois nao houve achado evidente de baixo risco que justificasse alterar runtime.

## Bugs pendentes / limitacoes

- `eslint .` segue vermelho por baseline antigo de Prettier/CRLF. Recomendado PR proprio, sem misturar com QA funcional.
- Smoke local via servidor Vite nao foi concluido nesta sessao porque `Start-Process` falhou antes de iniciar o app com `Path/PATH` duplicado no ambiente PowerShell.
- Validacao funcional clicada de Supabase/RLS com dois usuarios, OCR real, IA + Pesquisa real e job real da VM ficou pendente por depender de credenciais, dados e servicos externos.
- Reconciliacao numerica dashboard geral vs base real nao foi executada por falta de acesso interativo a uma base autenticada com massa conhecida.

## Riscos

- Sem suite E2E automatizada, regressao visual/fluxo de UI ainda depende de QA manual autenticado.
- OCR, IA online e VM scraper sao integracoes externas; build/typecheck nao garantem disponibilidade, chave valida ou resposta real desses servicos.
- O baseline de ESLint/CRLF dificulta usar lint global como gate limpo de PR.

## Recomendacao de proxima fase

Fase E1 - Smoke manual autenticado e matriz E2E minima:

- Criar checklist manual com usuario real/staging e massa controlada.
- Validar duas contas para confirmar RLS.
- Executar um handoff Screener -> Validator completo.
- Registrar um resultado `PULAR` e um `CONFIRMAR` em staging e reconciliar Bankroll/Dashboard.
- Depois disso, criar uma suite Playwright pequena cobrindo login, abertura das rotas principais, filtros basicos e bloqueios financeiros.

## Conclusao

A main pos-D4 esta tecnicamente saudavel para seguir: typecheck, build e testes Python passam. A revisao funcional dirigida nao encontrou contaminacao de bankroll por `PULAR`, handoff, snapshot ou simulado, nem alteracao de regras de decisao. A pendencia principal agora nao e refatoracao, e sim QA manual autenticado/E2E para cobrir os fluxos externos que nao sao exercitados pelos checks locais.
