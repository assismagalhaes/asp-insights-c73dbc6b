# Phase 8H — Relatório de validação shadow

Data do relatório: 2026-08-03  
Modo: shadow, sem publicação automática

## Escopo

Validar a entrada Central/MatchMatrix, a execução do runner de futebol e a
comparação com o fluxo tradicional usando snapshots congelados.

## Controles aplicados

- Linhas de total de gols não padrão (`1.8`, `2.2`, `2.8`, `3.2` etc.) são descartadas.
- A data-alvo é propagada como `FOOTBALL_DATA_REF` para ambos os caminhos.
- Moneyline usa nomes canônicos do mandante, visitante e `Empate`.
- Builds e shadow runs são imutáveis.
- `automatic_publication=false` permanece obrigatório.
- Nenhum prognóstico é publicado pelo shadow.

## Evidências

### Comparações com snapshot congelado

| Data | Central | Replay tradicional | Resultado |
|---|---:|---:|---|
| 25/07/2026 | 0 | 0 | hash idêntico |
| 29/07/2026 | 6 | 6 | mesmas previsões; diferenças apenas de metadados/versionamento |
| 30/07/2026 | 2 | 2 | mesmas previsões; diferenças apenas de metadados/versionamento |
| 31/07/2026 | 0 | 0 | hash idêntico |

Nas datas com hash diferente, as chaves e os valores matemáticos das previsões
foram iguais. As diferenças ficaram restritas a `modelo_versao`, versão de
auditoria e caminhos de contexto temporários.

### Validação operacional

- API da VM: `active`.
- `/health`: HTTP `200`.
- RPC de candidatos: estabilizado após atualização de estatísticas, índice e
  plano filtrado por data.
- Cobertura de candidatos nas execuções shadow: `100%` por partida.
- Publicação automática: desativada.

## Limites mantidos

- `NO_MARKET_BASELINE` continua bloqueando seleções sem referência de mercado
  suficiente.
- Linhas de gols fora do contrato padrão continuam descartadas.
- O shadow não substitui o fluxo tradicional.

## Decisão recomendada

Prosseguir para publicação assistida somente com aprovação humana explícita,
mantendo o shadow como trilha de comparação. Não ativar publicação automática
até existir amostra operacional contínua e revisão das divergências de baseline.
