from __future__ import annotations

import os
import csv
import json
import math
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from jobs.job_store import store
from scrapers.normalizer import normalize
from scrapers.odds_scraper import run_scraper

app = FastAPI(title="ASP Insights Scraper API", version="1.0.0")


class ScrapingJobRequest(BaseModel):
    esporte: str = Field(..., min_length=1)
    liga: str = Field(..., min_length=1)
    data_inicio: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    data_fim: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    mercados: list[str] = Field(..., min_length=1)
    bookmaker: str | None = None
    fonte: str | None = None


class ExecutarModeloRequest(BaseModel):
    job_id: str = Field(..., min_length=1)


BASE_DIR = Path(__file__).resolve().parents[1]
EXPORTS_DIR = BASE_DIR / "outputs" / "exports"
MODEL_OUTPUTS_DIR = BASE_DIR / "model_outputs"


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


@app.get("/scraping/jobs/{job_id}/csv", dependencies=[Depends(require_bearer)])
def get_csv(job_id: str) -> FileResponse:
    record = _record_or_404(job_id)
    if not record.raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível.")
    raw_path = Path(record.raw_path)
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo bruto do job não encontrado.")
    raw_data = _read_json(str(raw_path))
    csv_path = gerar_csv_coleta(job_id, raw_data, record)
    return FileResponse(csv_path, media_type="text/csv", filename=f"coleta_odds_{job_id}.csv")


@app.post("/modelos/baseball/executar", dependencies=[Depends(require_bearer)])
def executar_modelo_baseball(payload: ExecutarModeloRequest) -> dict[str, Any]:
    job_id = payload.job_id
    record = _record_or_404(job_id)
    if not record.raw_path:
        raise HTTPException(status_code=409, detail="raw_path ainda não disponível para este job.")

    raw_path = Path(record.raw_path)
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo bruto do job não encontrado.")

    raw_data = _read_json(str(raw_path))
    csv_coleta_path = gerar_csv_coleta(job_id, raw_data, record)
    script_modelo = BASE_DIR / "modelos" / "baseball_runner_real.py"
    if not script_modelo.exists():
        raise HTTPException(status_code=500, detail=f"Runner Baseball não encontrado em {script_modelo}.")

    MODEL_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = MODEL_OUTPUTS_DIR / f"prognosticos_baseball_{job_id}.csv"
    proc = subprocess.run(
        [sys.executable, str(script_modelo), str(csv_coleta_path), str(output_path)],
        capture_output=True,
        text=True,
        timeout=int(os.getenv("MODEL_TIMEOUT_SECONDS", "1800")),
        check=False,
    )

    if proc.stderr.strip():
        store.append_log(job_id, f"baseball stderr: {proc.stderr.strip()[-4000:]}")

    stdout = proc.stdout.strip()
    if proc.returncode != 0:
        detail = proc.stderr.strip() or stdout or f"Runner retornou código {proc.returncode}."
        raise HTTPException(status_code=500, detail=f"Runner Baseball falhou: {detail}")
    if not stdout:
        raise HTTPException(status_code=500, detail="Runner Baseball não retornou JSON no stdout.")

    try:
        result = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Runner Baseball não retornou JSON válido: {exc}. stdout={stdout[:2000]}",
        ) from exc

    if result.get("ok") is not True:
        raise HTTPException(status_code=500, detail=limpar_json_nan(result))

    response = {
        "ok": True,
        "job_id": job_id,
        "modelo": "Baseball",
        "csv_coleta": str(csv_coleta_path),
        "arquivo_saida": output_path.name,
        "arquivo_contexto": result.get("arquivo_contexto"),
        "total_prognosticos": result.get("total_prognosticos", 0),
        "contexto_modelo": result.get("contexto_modelo", ""),
        "dados_tecnicos": result.get("dados_tecnicos", ""),
        "mensagem": result.get("mensagem"),
        "prognosticos": result.get("prognosticos", []),
    }
    return limpar_json_nan(response)


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
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo do job não encontrado.")
    return json.loads(file_path.read_text(encoding="utf-8"))


def gerar_csv_coleta(job_id: str, raw_data: Any, job: Any) -> Path:
    normalized = normalize(raw_data, esporte_hint=job.params.get("esporte"))
    rows = normalized.get("rows") or []
    if not rows:
        raise HTTPException(status_code=422, detail="CSV da coleta não possui odds normalizadas.")

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = EXPORTS_DIR / f"{job_id}_odds_coletadas.csv"
    columns = [
        "data",
        "hora",
        "esporte",
        "liga",
        "jogo",
        "mandante",
        "visitante",
        "mercado",
        "pick",
        "linha",
        "odd",
        "bookmaker",
        "fonte",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column) for column in columns})
    return csv_path


def limpar_json_nan(value: Any) -> Any:
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, dict):
        return {key: limpar_json_nan(item) for key, item in value.items()}
    if isinstance(value, list):
        return [limpar_json_nan(item) for item in value]
    return value
