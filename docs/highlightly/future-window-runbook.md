# Janela móvel de partidas futuras da Highlightly

## Objetivo

Manter no ASP Insights uma agenda continuamente reconciliada para os próximos cinco dias sem
gastar cota em eventos, estatísticas finais ou box scores antes das partidas. A primeira versão
cobre os esportes já implementados no worker canônico: football, baseball e basketball.

O processo é incremental. Cada execução usa um scope determinístico por horário; repetir o mesmo
horário é idempotente. Horários posteriores usam um novo scope e consultam novamente a agenda e as
odds, capturando partidas adicionadas, adiadas ou alteradas pelo provedor.

## Cadência em America/Sao_Paulo

| Horário | Intervalo consultado | Orçamento máximo |
| --- | --- | ---: |
| 06:10 | D0 até D+2 | 1.200 chamadas |
| 12:10 | D0 até D+1 | 1.000 chamadas |
| 18:10 | D0 até D+1 | 1.000 chamadas |
| 22:10 | D+1 até D+5 | 2.500 chamadas |

O planejamento totaliza no máximo 5.700 chamadas no mesmo dia de quota UTC. O worker ainda aplica
o teto absoluto de 6.750, preservando 750 das 7.500 chamadas contratuais. A execução noturna ocorre
depois da virada da cota UTC, atualmente às 21:00 em São Paulo.

Uma fila futura que ultrapasse o orçamento do horário não fica ociosa até o próximo slot. O
continuador roda a cada cinco minutos, reutiliza exclusivamente o mesmo `shadow_scope` e consome
somente o saldo existente até o teto de 6.750. Se a cota estiver esgotada, ele registra
`future_continuation_waiting_quota` e tenta novamente depois da renovação diária.

## Perfil pregame

O parâmetro `--fanout-mode pregame` mantém:

- paginação completa da listagem de partidas;
- odds pré-jogo;
- estatísticas históricas/forma dos times;
- classificação, exceto competições já em quarentena.

Ele não solicita estatísticas da partida, eventos ao vivo, escalações ou box scores. Esses recursos
continuam no perfil `full` usado por coletas históricas/finalizadas e poderão ganhar uma cadência
própria mais próxima do início da partida.

## Segurança operacional

O scheduler encerra com sucesso e registra `future_window_skipped` quando:

- o provider já está ligado;
- existe job ativo sem escopo canônico, de mais de um escopo ou de uma coleta não futura;
- o uso diário alcançou o teto que preserva a reserva.

Quando existe uma única fila `future-*`, o scheduler chama o continuador em vez de ignorá-la.
O continuador recusa locks válidos, múltiplos escopos e filas históricas. Os dois serviços usam o
mesmo `flock` em `/run/lock/asp-highlightly-future.lock`, portanto não executam chamadas concorrentes.
O provider é ligado apenas pelo runner isolado e restaurado para `enabled=false` em `finally`.

Ao zerar a fila, o continuador chama `finalize_highlightly_shadow_window` e publica o estado final
da janela. Se houver retries ainda não elegíveis ou cota insuficiente, o timer mantém a retomada
autônoma sem depender de uma sessão do operador.

## Preview sem consumir cota

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
PYTHONPATH=. /home/ubuntu/asp-scraper-api/.venv/bin/python \
  -m scripts.run_highlightly_future_schedule
```

O JSON deve conter `event=future_window_plan`, o slot, as datas, os esportes, o orçamento e a
reserva. Esse comando não acessa Supabase nem Highlightly.

## Instalação na VM

Somente depois de o backfill histórico terminar e o commit estar em `origin/main`:

```bash
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-future-window.service \
  /etc/systemd/system/highlightly-future-window.service
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-future-window.timer \
  /etc/systemd/system/highlightly-future-window.timer
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-future-continuation.service \
  /etc/systemd/system/highlightly-future-continuation.service
sudo install -o root -g root -m 0644 \
  config/systemd/highlightly-future-continuation.timer \
  /etc/systemd/system/highlightly-future-continuation.timer
sudo systemctl daemon-reload
sudo systemctl enable --now highlightly-future-window.timer
sudo systemctl enable --now highlightly-future-continuation.timer
systemctl list-timers highlightly-future-window.timer --no-pager
systemctl list-timers highlightly-future-continuation.timer --no-pager
```

Não iniciar manualmente o `.service` enquanto existir backfill, fila ativa ou provider ligado.

## Verificação depois do primeiro horário

```bash
systemctl status highlightly-future-window.timer --no-pager
systemctl status highlightly-future-window.service --no-pager
systemctl status highlightly-future-continuation.timer --no-pager
systemctl status highlightly-future-continuation.service --no-pager
journalctl -u highlightly-future-window.service -n 100 --no-pager
journalctl -u highlightly-future-continuation.service -n 100 --no-pager
```

Critérios de aceitação:

- retorno `future_window_finished` ou um `future_window_skipped` justificável;
- provider desligado ao final;
- nenhuma quebra da reserva de 750 chamadas;
- nenhuma fila futura pendente sem worker por mais de dez minutos quando houver cota;
- partidas normalizadas para todas as datas do intervalo;
- odds ausentes tratadas como indisponibilidade do provedor, nunca como `1.00` artificial.
