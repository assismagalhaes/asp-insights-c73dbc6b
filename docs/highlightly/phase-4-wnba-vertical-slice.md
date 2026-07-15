# Highlightly Fase 4 — vertical WNBA

Estado em 15/07/2026: implementação, migration, smoke e shadow operacional concluídos. O provider `highlightly` e `HIGHLIGHTLY_ANALYSIS_ENABLED` permanecem desligados fora da janela controlada de shadow; nenhum backfill foi iniciado.

## Escopo implementado

- runtime para as 19 operações Basketball do contrato Highlightly 6.13.2;
- WNBA identificada como `NBA Women`, league ID `11847`;
- partidas, participantes, placares por quarto, países, ligas, times, forma e splits total/casa/fora;
- todas as 21 métricas brutas observadas por equipe;
- Pace, Offensive Rating, Defensive Rating, eFG%, TS% e Net Rating;
- odds Moneyline, Total e Spread, histórico e consenso global de 2–7 bookmakers preferidos;
- highlights e restrições geográficas;
- read models admin-only para lista diária e detalhe;
- shadow limitado a uma partida, com kill switch restaurado em `finally`;
- rejeição integral de standings com liga/temporada incompatível ou identidade repetida/duplicada.

O módulo Basketball da Highlightly não expõe lineups nem box score individual. A vertical WNBA V1 usa dados de equipe; disponibilidade e impacto de jogadoras continuam como enriquecimento externo.

## Fórmulas reproduzíveis

Para cada equipe:

```text
posses_equipe = FGA - OREB + TOV + 0.44 × FTA
Pace = (posses_casa + posses_fora) / 2
ORtg = 100 × pontos / Pace
DRtg = 100 × pontos_adversário / Pace
Net Rating = ORtg - DRtg
eFG% = 100 × (FGM + 0.5 × 3PM) / FGA
TS% = 100 × pontos / (2 × (FGA + 0.44 × FTA))
```

O placar e os IDs de casa/fora seguem como metadados internos do job de estatísticas. Eles não são enviados à Highlightly e evitam associar a pontuação pela ordem incidental do array.

## Guardrail de standings

O normalizador rejeita todo o documento antes de criar times ou posições quando detecta:

- `leagueId` ou temporada diferentes da requisição;
- menos de duas identidades distintas em um documento com múltiplas posições;
- o mesmo time repetido dentro do grupo.

Linhas isoladas também são rejeitadas quando a posição é inválida/duplicada ou quando `wins + loses != gamesPlayed`. Os read models consultam exclusivamente `quality_status = 'valid'`. O payload bruto privado continua preservado para auditoria e replay.

## Aplicação no banco

Aplicar exatamente:

```text
supabase/migrations/20260715200000_create_highlightly_basketball_read_models.sql
```

Depois executar transacionalmente:

```text
supabase/tests/highlightly_phase4_smoke.sql
```

O smoke deve terminar em `ROLLBACK` sem exceções. Confirmar ainda:

- `sports_providers.enabled = false` para `highlightly`;
- `anon` sem `EXECUTE` nas duas RPCs;
- `authenticated` com `EXECUTE`, mantendo o gate interno de admin;
- view `sports_basketball_match_summary_v` com `security_invoker`.

## Shadow operacional na VM

Somente depois da migration aplicada e com a fila Highlightly vazia:

```powershell
sudo /bin/bash -lc "set -a; source /etc/asp-scraper-api.env; set +a; cd /home/ubuntu/asp-insights-c73dbc6b; PYTHONDONTWRITEBYTECODE=1 /home/ubuntu/asp-scraper-api/.venv/bin/python -m scripts.run_highlightly_basketball_shadow --match-id 421203234 --confirm-bounded-shadow"
```

O relatório deve mostrar `provider_restored_disabled=true`, a partida mapeada, dois participantes, placares por quarto, estatísticas e odds quando disponíveis. Para o payload de standings atualmente corrompido, `standings_guard_triggered=true` é o resultado correto.

Se houver interrupção com jobs ainda no mesmo escopo:

```powershell
sudo /bin/bash -lc "set -a; source /etc/asp-scraper-api.env; set +a; cd /home/ubuntu/asp-insights-c73dbc6b; PYTHONDONTWRITEBYTECODE=1 /home/ubuntu/asp-scraper-api/.venv/bin/python -m scripts.drain_highlightly_shadow_queue --sport basketball --scope <scope-exato> --max-jobs 100 --confirm-bounded-drain"
```

Não iniciar backfill nesta fase.

## Resultado operacional

Shadow `wnba-shadow-20260715T215844Z-11acd413`, partida Highlightly `421203234`:

- 10 jobs processados e fila ativa final igual a zero;
- dois participantes e oito placares de quarto;
- 42 métricas brutas mais 12 fatos derivados, totalizando 54 fatos por partida;
- 1.000 odds atuais, 1.000 registros de histórico e 125 consensos;
- um highlight;
- provider restaurado para `false`.

O único job `partial` foi o standings: as 30 posições retornaram a mesma identidade (`Panevezys Women`, ID 784). O guardrail emitiu `BASKETBALL_STANDINGS_CORRUPTED` como crítico, com `distinctTeams=1`, e não persistiu as posições. O segundo apontamento foi apenas `SCHEMA_FINGERPRINT_CHANGED` como warning. Esse resultado satisfaz o aceite de impedir standings corrompido de aparecer como válido.
