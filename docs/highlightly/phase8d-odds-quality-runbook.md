# Fase 8D — disponibilidade e atualização de odds

## Resultado esperado

A Fase 8D separa descoberta de partidas e dados estáticos da atualização de preços. A janela
noturna continua reconciliando os próximos cinco dias. O coletor `odds-only` consulta apenas as
odds quando uma partida entra em cada horizonte:

| Horizonte | Momento de elegibilidade | Frescor máximo |
| --- | --- | ---: |
| T−24h | até 24 horas antes do início | 86.400 s |
| T−6h | até 6 horas antes do início | 21.600 s |
| T−60m | até 60 minutos antes do início | 3.600 s |

O timer verifica candidatos a cada 15 minutos. A chave
`phase8d:odds:<sport>:<external_match_id>:<kickoff_epoch>:<horizon>` torna cada chamada
idempotente. Uma alteração real de horário muda a identidade do agendamento e permite as três
novas capturas.

## Diagnóstico

`get_highlightly_odds_quality_report` classifica cada partida futura com um motivo determinístico:

- `available`: há odds abertas e dentro do frescor do horizonte;
- `stale`: há odds, mas a observação venceu;
- `not_yet_due`: a partida ainda está fora de T−24h;
- `not_collected`, `collection_pending` ou `collection_failed`: estado operacional da fila;
- `provider_empty`: a Highlightly retornou a estrutura sem mercados;
- `provider_unavailable`: o provedor usou o sentinela de indisponibilidade;
- `bookmaker_missing`: nenhuma das casas preferidas apareceu;
- `market_missing`: não apareceu mercado pré-jogo compatível;
- `quality_rejected`: o payload existia, mas não passou pelos guardrails;
- `no_supported_quote`: fallback explícito, nunca convertido em odd artificial.

As metas iniciais são progressivas e separadas por esporte: Football 60%, Baseball 20% e
Basketball 25%. Esses valores são editáveis em `hl_odds_quality_targets`; não alteram nem
fabricam odds. O monitor administrativo mostra cobertura, meta, frescor p95 e contagem por motivo.

## Aplicação no Lovable

Aplicar exatamente:

1. `supabase/migrations/20260723162300_create_highlightly_phase8d_odds_quality.sql`
2. `supabase/tests/highlightly_phase8d_odds_quality_smoke.sql`

Critérios:

- três metas habilitadas;
- funções `SECURITY INVOKER`;
- RPC de candidatos executável apenas por `service_role`;
- relatório executável por `authenticated` e `service_role`, com gate interno de administrador;
- `anon` sem acesso;
- provider Highlightly não deve ser ligado pela migration;
- nenhuma coleta deve ser iniciada pelo Lovable.

Depois da publicação, a allowlist HMAC deve conter
`get_highlightly_odds_refresh_candidates` e `get_highlightly_odds_quality_report`.

## Instalação na VM

Somente após a migration e a publicação do bridge:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
git pull --ff-only origin main
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-odds-refresh.service \
  /etc/systemd/system/highlightly-odds-refresh.service
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-odds-refresh.timer \
  /etc/systemd/system/highlightly-odds-refresh.timer
sudo systemctl daemon-reload
sudo systemctl enable --now highlightly-odds-refresh.timer
```

O serviço usa o mesmo `flock` da janela futura. Se a descoberta ou o continuador estiverem
rodando, a atualização de odds encerra sem concorrência e volta no próximo intervalo.

## Preview e validação

O preview consulta candidatos no banco, mas não enfileira jobs e não chama a Highlightly:

```bash
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.run_highlightly_phase8d_odds_refresh
```

Após ativar:

```bash
systemctl status highlightly-odds-refresh.timer --no-pager
systemctl list-timers highlightly-odds-refresh.timer --no-pager
journalctl -u highlightly-odds-refresh.service -n 100 --no-pager
```

Critérios operacionais:

- `odds_only=true`;
- provider restaurado para `enabled=false` ao final;
- reserva de 750 chamadas preservada;
- nenhuma fila de outro escopo processada em conjunto;
- T−24h, T−6h e T−60m no relatório;
- nenhuma estatística, classificação, escalação ou box score criada pelo coletor.

## Rollback

```bash
sudo systemctl disable --now highlightly-odds-refresh.timer
```

Desativar o timer interrompe novas chamadas. Os dados canônicos já coletados permanecem válidos.
Se necessário, revogar as duas RPCs e remover `hl_odds_quality_targets` por uma nova migration;
não editar nem apagar a migration já aplicada.
