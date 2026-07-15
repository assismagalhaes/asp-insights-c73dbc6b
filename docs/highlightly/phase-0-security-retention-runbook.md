# Fase 0 — segurança, retenção e rollout

## Secrets

Secrets obrigatórios do worker:

```text
HIGHLIGHTLY_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SCRAPER_API_KEY
```

Nenhum deles pode usar prefixo `VITE_`, aparecer no frontend, ser retornado por health check ou ser salvo em `hl_ingestion_runs`/raw objects.

O único valor público da feature será:

```text
VITE_HIGHLIGHTLY_ANALYSIS_ENABLED=false
```

Feature flag controla rollout visual, não autorização. A rota continuará exigindo sessão e role admin.

## Instalação na VM

Arquivo usado pelo serviço atual:

```text
/etc/asp-scraper-api.env
```

Controles:

- owner `root`;
- permissão `0600`;
- carregamento por `EnvironmentFile` do systemd;
- fail closed quando `HIGHLIGHTLY_API_KEY` estiver ausente;
- nunca usar valor default para secret;
- logs devem registrar apenas que a variável existe, nunca tamanho, prefixo ou conteúdo;
- core dumps e debug HTTP desabilitados no worker produtivo.

O template seguro está em `api/highlightly.env.example`. O instalador interativo, que lê a chave sem exibi-la nem colocá-la no histórico, está em `scripts/install_highlightly_vm_secret.sh`.

## Rotação da chave Highlightly

1. Gerar uma nova chave no painel do provider.
2. Validar a nova chave com uma chamada de baixo custo em ambiente seguro.
3. Atualizar o `EnvironmentFile` sem registrar a chave no shell history.
4. Reiniciar somente o worker Highlightly.
5. Confirmar health, plano PRO, limite diário e saldo.
6. Revogar a chave anterior.
7. Monitorar 401/403/429 por 30 minutos.
8. Registrar data, responsável e resultado da rotação, nunca o valor da chave.

Como uma chave já foi compartilhada em conversa, a primeira implantação deve usar uma chave regenerada.

## Redaction

Antes de gravar raw/log:

- remover `x-rapidapi-key`, `authorization`, cookies e query params sensíveis;
- não salvar headers de request completos;
- permitir apenas headers de resposta necessários: content type, rate limit, request/correlation ID;
- limitar body de erro persistido e aplicar redaction recursiva por nomes sensíveis;
- nunca incluir environment dump em exceções.

## Retenção inicial

| Classe | Payload bruto | Normalizado | Observação |
|---|---:|---:|---|
| Catálogos | 30 dias + última versão | indefinido | countries, leagues, teams, players, bookmakers |
| Matches/stats/events/lineups/box score | 365 dias | indefinido | bruto suficiente para reprocessamento anual |
| Odds | 90 dias | indefinido com history por mudança | maior volume esperado |
| Standings/team stats | 365 dias | indefinido | snapshots históricos preservados |
| Highlights | metadata 365 dias | indefinido | não copiar vídeo/imagem sem revisão de licença |
| Erros/quarentena | 180 dias | até resolução + auditoria | preservar evidência de corrupção |

Reavaliar custo e compressão após 30 dias reais. Exclusão de raw deve ser automatizada, auditável e nunca apagar o normalizado correspondente.

## Quota PRO

| Bucket | Chamadas/dia | Regra |
|---|---:|---|
| Scheduled/current | 4.500 | partidas, live, lineups e odds |
| Pós-jogo/backfill | 1.500 | stats, box score, eventos finais e histórico |
| Retry | 750 | somente erros elegíveis |
| Reserva | 750 | não consumida por backfill |

Thresholds:

- 25% restante: reduzir tarefas P3/P4;
- 15%: pausar backfill e catálogos não críticos;
- 10%: executar somente P0 e recuperação indispensável;
- abaixo de 5%: circuit breaker, salvo finalização de jobs já iniciados.

Erros 400/401/403 não recebem retry automático. 429 respeita reset/backoff. 5xx e timeout usam retry exponencial com jitter e limite.

## Feature flag

Flag canônica:

```text
highlightly_analysis_enabled = false
```

Representações:

- registry: default `false`;
- worker: `HIGHLIGHTLY_ANALYSIS_ENABLED=false`;
- frontend: `VITE_HIGHLIGHTLY_ANALYSIS_ENABLED=false`.

Na Fase 0 não há rota exposta. Nas fases seguintes, a flag desligada impede menu/rota e o backend mantém autorização independente.

## Checklist antes de habilitar

- [ ] chave regenerada e instalada na VM;
- [ ] worker falha sem secrets;
- [ ] logs verificados sem credenciais;
- [ ] RLS admin-only aplicado;
- [ ] sete dias de shadow concluídos;
- [ ] quota com reserva mínima de 10%;
- [ ] issues críticos zerados ou explicitamente bloqueados;
- [ ] rollback da flag testado;
- [ ] termos de logos, imagens e highlights revisados.
