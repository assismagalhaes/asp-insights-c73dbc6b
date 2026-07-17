# Histórico consolidado de odds e retenção

## Registro permanente

`public.odds_market_snapshots` mantém uma linha por fonte, evento, instante de coleta,
mercado, período, linha e seleção. O histórico consolidado é permanente e serve de
entrada canônica para backtests, independentemente de a origem ser OddsAgora ou
Highlightly.

`public.odds_backtest_snapshots` expõe somente observações pré-jogo. Snapshots com
horário do evento ausente (`UNKNOWN`) ou coletados depois do início (`POS_INICIO`)
ficam preservados para auditoria, mas não entram no backtest pré-jogo.

## Compatibilidade durante a transição

`public.odds_jogos` continua recebendo as linhas detalhadas por bookmaker enquanto
os consumidores existentes são migrados. Não remover essa escrita antes de confirmar
que todos os modelos e relatórios consultam `odds_market_snapshots`.

## Retenção dos artefatos na VM

A rotina é sempre *dry-run* por padrão:

```bash
cd /home/ubuntu/asp-insights-c73dbc6b
python -m scripts.prune_scraper_artifacts
```

Política inicial:

- bruto, normalizado e CSV de jobs concluídos: 90 dias;
- artefatos de jobs com erro: 180 dias;
- metadados de jobs: 365 dias;
- snapshots consolidados no Supabase: permanentes.

Depois de revisar a saída e comprovar a presença dos snapshots no Supabase:

```bash
python -m scripts.prune_scraper_artifacts --confirm-prune --max-files 100
```

O limite de 100 arquivos torna cada execução limitada. Agendar somente depois de uma
execução manual bem-sucedida e manter o log da saída do comando.

## Migração para Highlightly

O adaptador da nova fonte deve preencher o mesmo contrato. Durante 30–60 dias, manter
as duas fontes em paralelo e comparar cobertura de eventos, mercados, linhas e casas.
Somente depois dessa validação a raspagem pode deixar de ser a fonte principal.
