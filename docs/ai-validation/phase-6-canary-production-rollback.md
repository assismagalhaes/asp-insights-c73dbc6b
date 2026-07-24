# Fase 6 — Canary, produção e rollback

## Objetivo

Fechar a implantação do contrato estruturado com autorização administrativa no
servidor, seleção determinística da variante, telemetria de rollout e um
procedimento reversível de promoção. O árbitro determinístico continua sendo a
única autoridade sobre decisão, pick, ID, stake e gates operacionais.

## Controles de rollout

Os modos local e online são controlados separadamente:

| Variável                                   | Valores                                        | Padrão  |
| ------------------------------------------ | ---------------------------------------------- | ------- |
| `AI_VALIDATION_LOCAL_ROLLOUT_STAGE`        | `legacy`, `canary`, `full`                     | `full`  |
| `AI_VALIDATION_ONLINE_ROLLOUT_STAGE`       | `legacy`, `canary`, `full`                     | `full`  |
| `AI_VALIDATION_STRUCTURED_CANARY_USER_IDS` | UUIDs de administradores separados por vírgula | vazio   |
| `AI_VALIDATION_LOCAL_LEGACY_ROLLBACK`      | `true` ou `false`                              | `false` |
| `AI_VALIDATION_ONLINE_LEGACY_ROLLBACK`     | `true` ou `false`                              | `false` |

Precedência:

1. um flag `*_LEGACY_ROLLBACK=true` sempre seleciona o contrato legado;
2. estágio `legacy` seleciona o contrato legado;
3. estágio `canary` seleciona structured apenas para UUIDs da allowlist;
4. estágio `full` seleciona structured para todos os administradores.

Valores ausentes ou inválidos de estágio preservam o comportamento produtivo
atual (`full`). O canary sem allowlist é fail-closed para legado.

Cada execução persiste `rollout_stage`, `rollout_variant` e `rollout_reason`.
O painel de observabilidade permite filtrar pelo estágio e separa as dimensões
por estágio/variante.

## Autorização

Os endpoints de IA exigem duas verificações no servidor:

1. JWT Supabase válido;
2. papel `admin` em `public.user_roles`.

A proteção da rota no frontend permanece como defesa adicional, não como limite
de autorização. A RLS de `analises_ia` continua exigindo `has_role(..., 'admin')`.

## Ordem de implantação

1. Rodar lint, typecheck, testes, evals e build.
2. Aplicar `20260724190000_add_ai_validation_rollout_telemetry.sql`.
3. Executar todos os smokes SQL transacionais e os advisors de segurança e
   performance.
4. Publicar preview com ambos os estágios em `canary` e adicionar somente o UUID
   do administrador executor à allowlist.
5. Executar uma amostra controlada de baseball futuro e `PENDENTE`:
   - uma análise Local;
   - uma análise Online + Pesquisa;
   - não clicar em Aplicar, Confirmar, Pular, publicar ou liquidar.
6. Conferir por `run_id`:
   - `rollout_stage = canary`;
   - `rollout_variant = structured`;
   - `parse_status = VALID`;
   - contrato `1.1.0`;
   - modelo `google/gemini-3.6-flash`;
   - erro nulo e telemetria de latência/tokens presente quando o Gateway informar;
   - decisão final coerente com o árbitro;
   - prognóstico ainda `PENDENTE`.
7. Promover Local para `full`, repetir a verificação curta e então promover
   Online para `full`.
8. Publicar produção e verificar o bundle público e o painel autenticado.

## Gates de promoção

O canary é aprovado quando:

- lint, typecheck, testes, evals e build passam;
- migration e smokes SQL passam sem deixar registros;
- 100% da pequena amostra canary possui schema válido e nenhum erro de provider;
- todo bloqueio do árbitro resulta em `PULAR`, stake `0`, ID e pick nulos;
- nenhuma análise altera o status operacional do prognóstico;
- latência, tokens, buscas e fontes ficam observáveis.

Latência e custo são métricas de acompanhamento, não bloqueios absolutos nesta
fase. Uma pequena perda de desempenho é aceitável em favor do custo-benefício
do `gemini-3.6-flash`, desde que schema, segurança e invariantes determinísticos
permaneçam íntegros.

## Consultas de verificação

```sql
select
  run_id,
  created_at,
  modo_ia,
  model_id,
  schema_version,
  parse_status,
  error_code,
  final_decision,
  rollout_stage,
  rollout_variant,
  rollout_reason,
  latency_ms,
  total_tokens
from public.analises_ia
where run_id = '<RUN_ID>';
```

```sql
select id, status_validacao
from public.prognosticos
where id = '<PROGNOSTICO_ID>';
```

## Rollback

Rollback imediato, sem migration destrutiva:

```text
AI_VALIDATION_LOCAL_LEGACY_ROLLBACK=true
AI_VALIDATION_ONLINE_LEGACY_ROLLBACK=true
```

Os flags têm precedência mesmo quando o estágio permanece `full`. Depois da
publicação do ambiente, uma nova execução deve registrar
`rollout_reason = explicit_rollback`, `rollout_variant = legacy` e
`parse_status = LEGACY_ROLLBACK`.

As colunas e o índice da Fase 6 são aditivos e podem permanecer no banco durante
o rollback. O parser legado é mantido apenas para essa janela operacional; não
existe fallback silencioso após falha de schema. O código Python e a VM de
scraping não foram alterados nesta fase.
