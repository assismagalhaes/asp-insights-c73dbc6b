# Fase 6 — Central Esportiva

## Resultado

A primeira interface analítica da Highlightly foi integrada ao ASP Insights. A rota
`/central-esportiva` consome exclusivamente os read models canônicos das Fases 2, 3 e 4 e
permanece protegida por autenticação, perfil administrativo e feature flag.

## Escopo entregue

- explorador diário unificado para football, MLB e WNBA;
- busca por time, adversário ou competição;
- navegação por data, esporte, favoritos e presets analíticos;
- lista virtualizada para evitar a renderização integral de grandes agendas;
- detalhe da partida com placar, períodos, odds, estatísticas, forma, elencos, eventos,
  classificação e rastreabilidade da fonte;
- consenso de odds, mediana, melhor preço, quantidade de fontes e preços por bookmaker;
- movimento histórico somente quando existem pelo menos duas observações reais da mesma
  linha;
- comparação lado a lado de todas as métricas retornadas pelos read models;
- estados explícitos para carregamento, erro, ausência de dados e qualidade bloqueada;
- estado da seleção sincronizado na URL (`sport`, `date` e `match`).

## Contratos consumidos

- `get_football_daily_matches` e `get_football_match_detail`;
- `get_baseball_daily_matches` e `get_baseball_match_detail`;
- `get_basketball_daily_matches` e `get_basketball_match_detail`.

O cliente não escreve nas tabelas esportivas e não utiliza `service_role`.

## Rollout

A rota e o item de menu só aparecem quando:

```env
VITE_HIGHLIGHTLY_ANALYSIS_ENABLED=true
```

O valor deve permanecer `false` no ambiente de produção até a aprovação do rollout. A
ativação da interface não habilita o provider, não inicia worker e não executa backfill.

## Validação

- TypeScript: `tsc --noEmit` sem erros;
- ESLint: arquivos da funcionalidade sem erros ou avisos;
- build Vite client e SSR concluído;
- QA no navegador com uma amostra real do shadow WNBA, removida ao final;
- seleção de partida, sincronização da URL, abas, estatísticas e odds validadas;
- conferência visual contra os conceitos aprovados da Fase 5.

## Guardrails preservados

- nenhuma odd histórica foi inventada para preencher gráficos;
- dados bloqueados por qualidade não são apresentados como válidos;
- consenso informa a quantidade efetiva de bookmakers;
- ausência de standings, eventos, lineups ou highlights produz estado vazio, não conteúdo
  sintético;
- nenhum bypass de autenticação ou fixture de QA faz parte do código final.
