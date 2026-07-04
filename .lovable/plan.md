# Arquitetura modular de parsers e validadores — ASP Validator (texto colado)

Objetivo: expandir o fluxo de texto colado (hoje só escanteios) para 1X2, Over/Under FT/HT/ST, BTTS, Dupla Chance, Escanteios e Cartões — sem Handicap. Detecção de mercado, parsers, simuladores, UI e prompt da IA passam a ser roteados por `market_type` + `period`.

## 1. Novos arquivos

- `src/lib/asp-validator-market-detector.ts`
  - `detectFootballMarketType(text, formMarket?, formPick?) -> { market_type, period, selection, line }`
  - Regras conforme briefing (corners > cards > btts > double_chance > x1x2 > goals_total; period FT/HT/ST).

- `src/lib/asp-validator-football-parsers.ts`
  - `parsePastedBaseMatchData(text)` (compartilhado: times, liga, data, mercado, odd, prob, EV).
  - `parseFootballGeneralPerformance(text, home, away)` → wins/draws/losses/efic/possession/frequent_scores.
  - `parseFootballGoalsData(text, home, away, period)` → totais/médias/over_lines/under_lines/btts/first_goal, por geral e casa/fora.
  - `parseFootballCardsData(...)` → médias amarelos/vermelhos/total + over/under.
  - `parseFootballBttsData(...)` (deriva de goals + bloco "Ambas marcam").
  - `parseFootball1x2Data(...)` (deriva de general performance + gols).
  - `parseFootballDoubleChanceData(...)` (deriva de 1x2).
  - `normalizeFootballMarket(rawMarket, rawPick) -> { market_type, period, line, pick_normalized, validator_model }`.
  - `buildStructuredPastedDataByMarket(text) -> StructuredPastedData` (orquestrador — chama detector + parsers do mercado correto + base + general performance quando útil).

- `src/lib/asp-validator-football-simulation.ts`
  - `simulateGoalsTotal(structured)` — `football_goals_total_simplified` com composição técnica (média(home_for, away_against) + média(away_for, home_against)); HT usa dados HT, fallback FT marcado como proxy de baixa confiança.
  - `simulateBtts(structured)` — BTTS Sim/Não, inverte para Não.
  - `simulate1x2(structured)` — eficiência + gols + mando.
  - `simulateDoubleChance(structured)` — composição a partir de 1X2.
  - `simulateCards(structured)` — médias + over/under.
  - Reutiliza `runAspValidatorSimulation` (escanteios) já existente.
  - `routeSimulation(structured) -> SimulationResult` decide pelo market_type.

- Manter `src/lib/asp-validator-paste-parser.ts` como wrapper: continua exportando `parsePastedPrognostico`, mas internamente delega para `buildStructuredPastedDataByMarket`. Parser de escanteios atual é movido para `parseFootballCornersData` em `asp-validator-football-parsers.ts`, preservando regra PackBall (+9 → Over 9.5) e estruturas existentes (over_lines, race_to_N_pct, etc.).

## 2. Schema

`StructuredPastedData` ganha campos:

```ts
{
  input_source: "pasted_text",
  sport: "Futebol",
  market_type: "goals_total"|"btts"|"x1x2"|"double_chance"|"corners"|"cards",
  period: "FT"|"HT"|"ST",
  match: { ...existente, location_scope, period_scope },
  market: { ...existente, selection },
  general_performance?: { home, away },
  goals?: { period, general:{home,away}, home_away:{home,away} },
  corners?: { ...estrutura atual },
  cards?: { period, general, home_away },
  btts?: { home:{yes_pct,no_pct,first_goal_pct}, away:{...} },
  raw_pasted_text, data_quality_score, structured_fields_count, missing_critical_fields,
  form_patch: { ...existente, validator_model }
}
```

Backwards-compat: para escanteios, `corners.home/away` permanecem populados como hoje (consumido por `runAspValidatorSimulation`).

## 3. Rota `src/routes/_authenticated/asp-validator.tsx`

- `PastedDataPreview` passa a renderizar painéis condicionais por `market_type`:
  - `corners` → painel atual (Escanteios + race).
  - `goals_total` → novo `GoalsPanel` (totais, médias, over/under, btts opcional).
  - `cards` → `CardsPanel`.
  - `btts` → `GoalsPanel` + `BttsPanel`.
  - `x1x2` / `double_chance` → `GeneralPerformancePanel` + `GoalsPanel` (suporte).
- Esconder seções de Race/Corners quando market_type ≠ corners.
- `applyPastedToForm`: usa `form_patch.validator_model` (`ASP Goal Validator` / `ASP Corner Validator` / `ASP Cards Validator`).
- `runAspValidatorSimulation` substituído por `routeSimulation` para mercados não-corner. Corners continua chamando o atual.
- `simulation_json` enviado à IA inclui `market_type`, `period`, `proxy_used` (FT como proxy para HT), `model_name` (ex. `football_goals_total_simplified`).
- `saveValidation`: persistir `market_type` e `period` em `structured_json`; mapear validador correto.

## 4. Prompts (`asp-validator-ai.functions.ts` e `asp-validator-ai-online.functions.ts`)

- System prompt recebe `market_type` e `period`. Regras:
  - "Não use análise de escanteios para mercado de gols/BTTS/1X2/cartões."
  - "Cite apenas dados do mercado correto presente em `structured_json`."
  - "Se `simulation_json.proxy_used = FT_as_HT`, alerte sobre baixa confiança."
  - Manter proibição de soma bruta de médias.
- Guardrail mantido: CONFIRMAR só se EV ajustado ≥ 3% e fair_odd < offered_odd; senão PULAR.

## 5. Tolerância do parser

Helper `normalize()` já remove acentos. Adicionar:

- Sinônimos de período: `1 tempo|1º tempo|1° tempo|primeiro tempo|HT|1T` → HT; análogo ST; `jogo completo|FT|todos|tempo regulamentar` → FT.
- Sinônimos de mercado conforme regras do briefing.
- Ordem livre de blocos: parsers escaneiam o texto inteiro buscando marcadores `--- TITULO ---` ou cabeçalhos `TIME:`.

## 6. Critérios de aceite

- Náutico x Goiás "Menos de 1.5 gols 1º tempo" → `market_type=goals_total`, `period=HT`, painel de Gols (sem escanteios), simulador `football_goals_total_simplified`, proxy FT→HT se faltar HT.
- Escanteios continua igual.
- Cartões: detecta, painel cartões, simulador `football_cards_total_simplified`.
- BTTS, 1X2, Dupla Chance: detectam e usam painéis/simuladores corretos.
- `tsc --noEmit` e `vite build` OK.

## 7. Fora de escopo

- Handicap (asiático/europeu) não implementado.
- Migração de banco não necessária — `structured_json` já é JSONB livre em `asp_validator_registros`.
- Sem mudanças em uploads/OCR (fluxo secundário inalterado).

## 8. Execução

1. Criar `asp-validator-market-detector.ts` + `asp-validator-football-parsers.ts` (move parser de escanteios para lá, sem mudar comportamento).
2. Criar `asp-validator-football-simulation.ts` com `routeSimulation`.
3. Refatorar `asp-validator-paste-parser.ts` para delegar (mantendo exports usados pela rota).
4. Atualizar UI da rota com painéis condicionais + roteamento de simulação.
5. Atualizar prompts da IA com `market_type`/`period` e proibições.
6. `bunx tsgo --noEmit` + `bunx vite build` para validar.

Estimativa: alteração grande, mas confinada a `src/lib/asp-validator-*` e `src/routes/_authenticated/asp-validator.tsx`.
