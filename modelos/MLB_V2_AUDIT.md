# MLB V2.0

## Escopo operacional

- Moneyline e Total de Corridas usam edge minimo de 5% e 4%, respectivamente.
- Handicap permanece apenas em shadow; nenhum prognostico e publicado.
- Cada mercado publica uma principal e no maximo duas alternativas da mesma tese.
- Starter, bullpen, parque e clima nao entram na probabilidade pre-IA. Esses fatores continuam na Validacao Critica via Preview/pesquisa.

## Dados e lambdas

- O historico e cortado estritamente antes da data do evento.
- Pesos temporais iniciais: temporada atual 55%, ultimos 15 jogos com meia-vida de 7 jogos 30%, temporada anterior 15%.
- A media de corridas da liga e calculada ate o cutoff e recebe prior de 4.50 corridas por equipe/jogo.
- Lambdas usam ataque e defesa relativos a liga, com fatores iniciais de mando 1.025/0.975.

## Distribuicao e probabilidades

- Corridas por equipe seguem Negative Binomial com sobredispersao inicial 0.08.
- A cobertura de handicap usa a mesma matriz Negative Binomial, inclusive no modo shadow; o identificador operacional e `MLB_V2_1_HANDICAP_NB_SHADOW`.
- Moneyline separa a massa de empate apos nove entradas e condiciona os dois lados a um resultado decidido.
- O componente historico de moneyline usa Log5 com shrinkage, garantindo lados complementares.
- Pesos iniciais de moneyline: historico 15%, simulacao 35%, mercado no-vig 50%.
- Pesos iniciais de totais: historico 20%, simulacao 30%, mercado no-vig 50%.

## Calibracao

O runtime aceita calibracao Platt por mercado, mas so ativa parametros quando:

- o treino temporal possui ao menos 100 observacoes;
- a validacao futura possui ao menos 40 observacoes;
- o log-loss calibrado melhora o bruto em pelo menos 0.002;
- o slope permanece entre 0.20 e 2.50.

Sem esses requisitos, a transformacao e identidade. O arquivo `mlb_calibration.json` registra o estado atual.

## Backtest walk-forward local

Base local disponivel em 10/07/2026:

- 21 picks V2.0, todos em Total de Corridas;
- 15 greens e 6 reds;
- win rate 71.43%;
- ROI hipotetico de 26.14% a 1 unidade;
- Brier 0.2078 e log-loss 0.6061;
- 22 jogos ignorados por ausencia de resultado correspondente;
- Moneyline sem pares de odds nos CSVs locais, portanto ainda sem validacao empirica;
- calibracao mantida inativa por amostra insuficiente.

Os resultados sao direcionais e nao justificam aumentar stake ou ativar calibracao antes de uma amostra temporal maior.

O auditor tambem materializa as oportunidades qualificadas em modo sombra no arquivo
`mlb_v2_handicap_shadow_walk_forward.csv`, sem publica-las, para permitir a validacao
walk-forward especifica do handicap antes de qualquer ativacao operacional.
