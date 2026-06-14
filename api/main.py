from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

from jobs.job_store import store
from scrapers.normalizer import normalize
from scrapers.odds_scraper import run_scraper

app = FastAPI(title="ASP Insights Scraper API", version="1.0.0")


class ScrapingJobRequest(BaseModel):
    esporte: str = Field(..., min_length=1)
    liga: str | None = None
    data_inicio: str | None = None
    data_fim: str | None = None
    mercados: list[str] = Field(default_factory=list)
    bookmaker: str | None = None
    fonte: str | None = None


def require_bearer(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("SCRAPER_API_KEY")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SCRAPER_API_KEY não configurada na VM.",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token ausente.")
    token = authorization.removeprefix("Bearer ").strip()
    if token != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearer token inválido.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scraping/jobs", dependencies=[Depends(require_bearer)])
def create_job(payload: ScrapingJobRequest, background: BackgroundTasks) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    record = store.create(job_id, payload.model_dump())
    background.add_task(execute_job, job_id)
    return {"job_id": job_id, "status": record.status}


@app.get("/scraping/jobs/{job_id}", dependencies=[Depends(require_bearer)])
def get_job(job_id: str) -> dict[str, Any]:
    record = _record_or_404(job_id)
    return record.__dict__


@app.get("/scraping/jobs/{job_id}/raw", dependencies=[Depends(require_bearer)])
def get_raw(job_id: str) -> Any:
    record = _record_or_404(job_id)
    if not record.raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível.")
    return _read_json(record.raw_path)


@app.get("/scraping/jobs/{job_id}/normalized", dependencies=[Depends(require_bearer)])
def get_normalized(job_id: str) -> Any:
    record = _record_or_404(job_id)
    if not record.normalized_path:
        raise HTTPException(status_code=404, detail="JSON normalizado ainda não disponível.")
    return _read_json(record.normalized_path)


def execute_job(job_id: str) -> None:
    try:
        record = store.update(job_id, status="RODANDO", erro=None)
        store.append_log(job_id, "Raspagem iniciada.")
        raw = run_scraper(job_id, record.params)
        store.save_raw(job_id, raw)
        store.append_log(job_id, "JSON bruto salvo.")

        normalized = normalize(raw, esporte_hint=record.params.get("esporte"))
        store.save_normalized(job_id, normalized)
        store.append_log(job_id, f"JSON normalizado salvo com {normalized.get('total_odds', 0)} odds.")

        store.update(job_id, status="CONCLUIDA", erro=None)
        store.append_log(job_id, "Job concluído.")
    except Exception as exc:  # noqa: BLE001 - API must persist explicit job failure.
        store.update(job_id, status="ERRO", erro=str(exc))
        store.append_log(job_id, f"Job falhou: {exc}")


def _record_or_404(job_id: str):
    try:
        return store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job não encontrado.") from exc


def _read_json(path: str) -> Any:
    import json

    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo do job não encontrado.")
    return json.loads(file_path.read_text(encoding="utf-8"))
