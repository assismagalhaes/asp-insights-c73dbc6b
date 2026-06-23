# Football V1.1 Technical Audit

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
