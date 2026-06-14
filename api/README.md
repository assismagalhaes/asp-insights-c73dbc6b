# ASP Insights Scraper API

API FastAPI para executar os scrapers Python existentes da VM como jobs acionáveis pelo ASP Insights.

## Variáveis de ambiente

Obrigatórias:

```bash
SCRAPER_API_KEY="troque-por-um-token-forte"
SCRAPER_SCRIPT_DEFAULT="/caminho/para/scraper.py"
```

Opcionalmente, configure scripts por esporte:

```bash
SCRAPER_SCRIPT_BASEBALL="/caminho/baseball.py"
SCRAPER_SCRIPT_BASKETBALL="/caminho/basketball.py"
SCRAPER_SCRIPT_FOOTBALL="/caminho/football.py"
SCRAPER_SCRIPT_AMERICAN_FOOTBALL="/caminho/american_football.py"
SCRAPER_SCRIPT_HOCKEY="/caminho/hockey.py"
SCRAPER_TIMEOUT_SECONDS="1800"
```

O app ASP Insights deve usar:

```bash
SCRAPER_API_URL="https://sua-vm/api"
SCRAPER_API_KEY="mesmo-token"
```

## Rodar

```bash
pip install -r requirements-scraper-api.txt
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## Endpoints

```bash
GET /health
POST /scraping/jobs
GET /scraping/jobs/{job_id}
GET /scraping/jobs/{job_id}/raw
GET /scraping/jobs/{job_id}/normalized
```

Todos os endpoints de scraping exigem:

```http
Authorization: Bearer <SCRAPER_API_KEY>
```

## Contrato esperado dos scripts

Cada script deve aceitar, quando aplicável:

```bash
--esporte
--liga
--data-inicio
--data-fim
--mercado
--bookmaker
--fonte
--output
```

O script deve gravar JSON bruto no caminho recebido em `--output` ou imprimir JSON válido no stdout.
