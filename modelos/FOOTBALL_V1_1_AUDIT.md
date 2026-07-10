# Football V1.1 Technical Audit

## Football V1.2 - Revisao Estatistica

A V1.2 substitui os principais controles heurísticos identificados na auditoria:

- Data de referência dinâmica, derivada da coleta e com fallback no fuso `America/Sao_Paulo`.
- Corte temporal obrigatório antes de qualquer média, forma recente, RPI ou H2H.
- Exclusão de partidas incompletas e deduplicação da base histórica.
- Lambdas com forças relativas de ataque/defesa e shrinkage para as médias da liga.
- Poisson com correção Dixon-Coles; binomial negativa somente por configuração explícita.
- Probabilidade própria separada das odds. Odds medianas são benchmark no-vig; melhor odd é usada no EV.
- Normalização obrigatória do 1X2 e complementaridade de O/U e BTTS.
- Pesos históricos dependentes do tamanho amostral, com limite por mercado.
- Handicap asiático completo em incrementos de 0.25, com win/push/loss, meia-vitória e meia-derrota.
- Calibração opcional via `FOOTBALL_CALIBRATION_PATH`.
- Validação temporal em `modelos/football_validation.py`, com Brier, log loss, RPS 1X2, ECE, ROI, CLV e Platt walk-forward.

O arquivo de calibração só deve ser ativado depois de gerado com histórico rotulado e odds registradas no momento da previsão. Sem arquivo, a calibração é identidade.
Cada execução também gera `*_all_candidates.csv`, sem o filtro EV+, para evitar viés de seleção na calibração. Depois dos jogos, acrescente `resultado_binario`; para RPS 1X2, preencha também `resultado_1x2` com `H`, `D` ou `A`.

Exemplo:

```bash
python modelos/football_validation.py historico_rotulado.csv --output-dir model_outputs/football_validation
```

Colunas mínimas: `data`, `mercado`, `probabilidade_final`, `resultado_binario` e `odd_ofertada`. `odd_fechamento` é opcional para CLV.
Para comparar Poisson, Dixon-Coles e binomial negativa no mesmo relatório, inclua `modelo_variante`.
As variantes são controladas por `FOOTBALL_GOAL_DISTRIBUTION=poisson|nbinom|auto` e `FOOTBALL_DIXON_COLES_ENABLED=true|false`.

## Histórico V1.1

As seções abaixo registram o comportamento anterior e são mantidas para comparação.

## Objetivo

Football V1.1 endurece o runner atual de futebol sem substituir a arquitetura, sem alterar endpoints, telas, Supabase ou modelos ASP GoalMatrix/ASP CornerMatrix. A meta e reduzir selecoes artificiais, expor diagnostico estatistico e tratar mercados correlatos com controles tecnicos mais claros.

## O Que Foi Alterado

- Adapter long-to-wide para futebol com suporte mais seguro a Asian Handicap.
- Runner real com versao `FOOTBALL_V1_1`.
- Auditoria estatistica `FOOTBALL_V1_1_B`.
- Exposicao de lambdas, matriz de placar, massa de cauda, shrinkage, no-vig, edge e motivo de descarte.
- Script de comparacao/auditoria para gerar relatorios locais.
- Testes unitarios dedicados para os controles V1.1.

## O Que Nao Foi Alterado

- Nenhum endpoint publico.
- Nenhuma tela do app.
- Nenhuma tabela, policy ou funcao Supabase.
- Nenhum fluxo de publicacao, historico, bankroll ou validacao critica.
- Nenhum modelo ASP GoalMatrix.
- Nenhum modelo ASP CornerMatrix.
- Nenhum deploy ou restart de servico foi executado nesta fase.

## Mercados Tratados

- 1X2.
- Total de Gols.
- Ambas Marcam.
- Dupla Chance.
- Asian Handicap em meia-linha, quando houver par de odds valido.

## Mercados e Linhas Bloqueados

- Handicap Europeu.
- Handicap inteiro, por exigir probabilidade de push ainda nao suportada com seguranca.
- Quarter line.
- Handicap sem par complementar de odds.
- Handicap ambiguo sem identificacao confiavel de lado/linha.

## Ajustes Estatisticos

- Poisson com matriz de placar dinamica.
- Lambdas home/away expostos no debug.
- Massa de cauda (`score_matrix_tail_mass`) e soma da matriz (`score_matrix_probability_sum`) expostas.
- Shrinkage conservador com prior 0.50.
- Edge minimo explicito por mercado/cenario.
- No-vig usado como baseline quando ha par/grupo de mercado valido.
- NBD apenas avaliado/documentado no debug; nao foi ativado como nova regra de selecao.

## Resultado dos Testes

- Local: `python -m unittest tests.test_football_runner_v1_1 -v` -> 29/29 OK.
- VM: `python -m unittest tests.test_football_runner_v1_1 -v` -> 29/29 OK.
- `py_compile` dos arquivos de futebol: OK.

## Smoke VM V1.1-D

- Input: CSV real de coleta de futebol.
- Adapter: 152 linhas brutas -> 6 jogos wide, 36 colunas.
- Diagnostico de odds: 70 grupos mercado/linha avaliados.
- Runner executado com sucesso na VM em laboratorio temporario.
- Picks selecionadas: 0.
- Picks descartadas: 12.
- Motivo principal: `NEGATIVE_EDGE_AFTER_V1_1`.
- Deploy: nao executado.
- Restart: nao executado.

## Smoke Ampliado V1.1-E

Relatorios brutos foram gerados em `.codex_tmp/football_backtest_app_outputs/v1_1_e/` e nao devem ser versionados por padrao. O objetivo foi verificar fluxo operacional, nao ROI.

## Confirmacoes de Escopo

- Sem alteracao em telas.
- Sem alteracao em Supabase.
- Sem alteracao em endpoints publicos.
- Sem alteracao em ASP GoalMatrix.
- Sem alteracao em ASP CornerMatrix.
- Sem deploy.
- Sem restart de servico.
