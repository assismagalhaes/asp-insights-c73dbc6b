# Fase 8E — ciclo automático das partidas

## Resultado esperado

A Fase 8E acompanha partidas já descobertas pela janela futura sem repetir catálogos ou
estatísticas estáticas de temporada. O ciclo canônico é:

```text
scheduled → imminent → live → finished_pending_detail
          → complete | complete_with_exceptions | terminal | quarantined
```

O rollout é criado **desligado para os três esportes**. A migration, a publicação do bridge e a
instalação do timer não iniciam chamadas enquanto
`hl_match_lifecycle_policies.enabled=false`.

## Cadência

| Etapa | Recursos |
| --- | --- |
| T−2h e T−30m | escalações de Football e Baseball, quando suportadas |
| T−30m até início | status/placar a cada 15 minutos |
| Ao vivo | status, eventos e estatísticas a cada 5 minutos; box score quando suportado |
| T+15m, T+2h e T+24h | somente recursos finais ainda não concluídos |

Recursos obrigatórios:

- Football: status/placar, eventos e estatísticas;
- Baseball: status/placar, estatísticas e box score;
- Basketball: status/placar e estatísticas.

Escalações, highlights e o player box score de Football são opcionais. Highlights são consultados
a partir de T+2h, quando suportados. A quarentena de standings da WNBA permanece inalterada; a
Fase 8E não consulta standings.

## Aplicação no Lovable

Aplicar exatamente:

1. `supabase/migrations/20260723183721_6981c84a-126e-4be9-ac87-6161b89369e4.sql`;
2. `supabase/tests/highlightly_phase8e_match_lifecycle_smoke.sql`.

Depois publicar o backend para disponibilizar no bridge:

- tabelas `hl_match_lifecycle_policies`, `hl_match_lifecycle_states` e
  `hl_match_lifecycle_resources`;
- RPCs `get_highlightly_match_lifecycle_candidates`,
  `refresh_highlightly_match_lifecycle_states` e
  `get_highlightly_match_lifecycle_report`.

Critérios:

- três políticas presentes e `enabled=false`;
- tabelas com RLS;
- `anon` sem leitura;
- `authenticated` somente com leitura e policy administrativa;
- RPCs de escrita/candidatos apenas para `service_role`;
- relatório para `authenticated` e `service_role`, com gate interno de administrador;
- todas as funções `SECURITY INVOKER`;
- nenhum worker ou coleta iniciado pelo Lovable.

## Instalação na VM

Somente após migration, smoke e publicação:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
git pull --ff-only origin main
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-match-lifecycle.service \
  /etc/systemd/system/highlightly-match-lifecycle.service
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-match-lifecycle.timer \
  /etc/systemd/system/highlightly-match-lifecycle.timer
sudo systemctl daemon-reload
sudo systemctl enable --now highlightly-match-lifecycle.timer
```

O serviço usa `/run/lock/asp-highlightly-future.lock`, a mesma trava da janela futura,
continuação e atualização de odds. Ele não mistura filas e volta no próximo intervalo quando
outro coletor estiver trabalhando.

## Preview sem cota

O preview inclui políticas desligadas para mostrar o volume que seria coletado, mas não enfileira
jobs nem chama a Highlightly:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.run_highlightly_phase8e_match_lifecycle
```

Validar no JSON:

- `event=phase8e_lifecycle_plan`;
- `includes_disabled_policies=true`;
- distribuição `by_stage` e `by_resource`;
- nenhuma alteração no provider ou na fila.

## Ativação gradual

Depois de pelo menos 24 horas saudáveis da Fase 8D, ativar somente Football:

```sql
UPDATE public.hl_match_lifecycle_policies AS lifecycle_policy
SET enabled = true,
    updated_at = now()
FROM public.sports AS sport
WHERE sport.id = lifecycle_policy.sport_id
  AND sport.code = 'football';
```

Observar por 24 horas antes de habilitar Baseball e Basketball. A ativação deve ser feita no
backend administrativo; nunca pelo cliente público.

## Verificação

```bash
systemctl status highlightly-match-lifecycle.timer --no-pager
systemctl list-timers highlightly-match-lifecycle.timer --no-pager
journalctl -u highlightly-match-lifecycle.service -n 150 --no-pager
```

Critérios operacionais:

- provider restaurado para `enabled=false` ao final de cada ciclo;
- reserva mínima de 750 chamadas preservada;
- nenhuma fila de outro escopo processada;
- partidas finalizadas não recebem novas chamadas depois de T+24h;
- `complete_with_exceptions` identifica recursos definitivamente indisponíveis;
- Central mostra estágio, recursos faltantes e próxima atualização.

## Rollback

Desativação lógica imediata:

```sql
UPDATE public.hl_match_lifecycle_policies
SET enabled = false,
    updated_at = now();
```

Desativação operacional:

```bash
sudo systemctl disable --now highlightly-match-lifecycle.timer
```

Nenhum dado canônico é removido. Estados e recursos já coletados permanecem disponíveis para
auditoria e reprocessamento.
