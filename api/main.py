from __future__ import annotations

import csv
import json
import math
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from scrapers.normalizer import normalize
from scrapers.odds_scraper import run_scraper

app = FastAPI(title="ASP Insights Scraper API", version="1.0.0")

BASE_DIR = Path(__file__).resolve().parents[1]
JOBS_DIR = BASE_DIR / "jobs"
RAW_DIR = BASE_DIR / "outputs" / "raw"
NORMALIZED_DIR = BASE_DIR / "outputs" / "normalized"
EXPORTS_DIR = BASE_DIR / "outputs" / "exports"
MODEL_OUTPUTS_DIR = BASE_DIR / "model_outputs"
LOGS_DIR = BASE_DIR / "logs"

for directory in (JOBS_DIR, RAW_DIR, NORMALIZED_DIR, EXPORTS_DIR, MODEL_OUTPUTS_DIR, LOGS_DIR):
    directory.mkdir(parents=True, exist_ok=True)


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


def verificar_token(authorization: str | None = Header(default=None)) -> None:
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


def require_bearer(authorization: str | None = Header(default=None)) -> None:
    verificar_token(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def job_file(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def raw_file(job_id: str) -> Path:
    return RAW_DIR / f"{job_id}.json"


def normalized_file(job_id: str) -> Path:
    return NORMALIZED_DIR / f"{job_id}.json"


def save_json(path: Path | str, data: Any) -> None:
    file_path = Path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json(path: Path | str) -> Any:
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return json.loads(file_path.read_text(encoding="utf-8"))


def save_job(job: dict[str, Any]) -> dict[str, Any]:
    job["updated_at"] = now_iso()
    save_json(job_file(str(job["job_id"])), job)
    return job


def load_job(job_id: str) -> dict[str, Any]:
    path = job_file(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Job não encontrado.")
    data = load_json(path)
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="Arquivo do job inválido.")
    return data


def append_log(job_id: str, message: str) -> None:
    try:
        job = load_job(job_id)
    except HTTPException:
        return
    timestamped = f"{now_iso()} {message}"
    job.setdefault("logs", []).append(timestamped)
    log_path = Path(job.get("log_path") or LOGS_DIR / f"{job_id}.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(timestamped + "\n")
    job["log_path"] = str(log_path)
    save_job(job)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scraping/jobs", dependencies=[Depends(require_bearer)])
def create_job(payload: ScrapingJobRequest, background: BackgroundTasks) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "status": "PENDENTE",
        "params": payload.model_dump(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "raw_path": None,
        "normalized_path": None,
        "log_path": str(LOGS_DIR / f"{job_id}.log"),
        "erro": None,
        "logs": [],
    }
    save_job(job)
    append_log(job_id, "Job criado.")
    background.add_task(execute_job, job_id)
    return {"job_id": job_id, "status": job["status"]}


@app.get("/scraping/jobs/{job_id}", dependencies=[Depends(require_bearer)])
def get_job(job_id: str) -> dict[str, Any]:
    return load_job(job_id)


@app.get("/scraping/jobs/{job_id}/raw", dependencies=[Depends(require_bearer)])
def get_raw(job_id: str) -> Any:
    job = load_job(job_id)
    raw_path = job.get("raw_path")
    if not raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível.")
    return load_json(raw_path)


@app.get("/scraping/jobs/{job_id}/normalized", dependencies=[Depends(require_bearer)])
def get_normalized(job_id: str) -> Any:
    job = load_job(job_id)
    normalized_path = job.get("normalized_path")
    if not normalized_path:
        raise HTTPException(status_code=404, detail="JSON normalizado ainda não disponível.")
    return load_json(normalized_path)


@app.get("/scraping/jobs/{job_id}/csv", dependencies=[Depends(require_bearer)])
def get_csv(job_id: str) -> FileResponse:
    job = load_job(job_id)
    raw_path = job.get("raw_path")
    if not raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível para este job_id")

    path = Path(raw_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo bruto da coleta não encontrado")

    raw_data = load_json(path)
    csv_coleta_path = gerar_csv_coleta(job_id, raw_data, job)
    return FileResponse(csv_coleta_path, media_type="text/csv", filename=f"coleta_odds_{job_id}.csv")


@app.post("/modelos/baseball/executar")
def executar_modelo_baseball(
    payload: ExecutarModeloRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    verificar_token(authorization)

    job_id = payload.job_id
    job = load_job(job_id)
    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(
            status_code=404,
            detail="JSON bruto ainda não disponível para este job_id",
        )

    path = Path(raw_path)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Arquivo bruto da coleta não encontrado",
        )

    raw_data = load_json(path)
    csv_coleta_path = gerar_csv_coleta(job_id, raw_data, job)

    script_modelo = BASE_DIR / "modelos" / "baseball_runner_real.py"
    output_path = BASE_DIR / "model_outputs" / f"prognosticos_baseball_{job_id}.csv"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not script_modelo.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script do modelo de baseball não encontrado em {script_modelo}",
        )

    resultado = subprocess.run(
        [
            sys.executable,
            str(script_modelo),
            str(csv_coleta_path),
            str(output_path),
        ],
        capture_output=True,
        text=True,
    )

    if resultado.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "Erro ao executar o modelo de baseball",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr,
            },
        )

    try:
        resposta_script = json.loads(resultado.stdout)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "O modelo executou, mas não retornou JSON válido",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr,
            },
        ) from exc

    if not resposta_script.get("ok"):
        raise HTTPException(status_code=500, detail=resposta_script)

    resposta_final = {
        "ok": True,
        "job_id": job_id,
        "modelo": "Baseball",
        "csv_coleta": str(csv_coleta_path),
        "arquivo_saida": f"prognosticos_baseball_{job_id}.csv",
        "arquivo_contexto": resposta_script.get("arquivo_contexto"),
        "total_prognosticos": resposta_script.get("total_prognosticos", 0),
        "contexto_modelo": resposta_script.get("contexto_modelo", ""),
        "dados_tecnicos": resposta_script.get("dados_tecnicos", ""),
        "prognosticos": resposta_script.get("prognosticos", []),
    }

    return limpar_json_nan(resposta_final)


def execute_job(job_id: str) -> None:
    try:
        job = load_job(job_id)
        job["status"] = "RODANDO"
        job["erro"] = None
        save_job(job)
        append_log(job_id, "Raspagem iniciada.")

        raw = run_scraper(job_id, job.get("params", {}))
        raw_path = raw_file(job_id)
        save_json(raw_path, raw)
        job = load_job(job_id)
        job["raw_path"] = str(raw_path)
        save_job(job)
        append_log(job_id, "JSON bruto salvo.")

        normalized = normalize(raw, esporte_hint=job.get("params", {}).get("esporte"))
        normalized_path = normalized_file(job_id)
        save_json(normalized_path, normalized)
        job = load_job(job_id)
        job["normalized_path"] = str(normalized_path)
        save_job(job)
        append_log(job_id, f"JSON normalizado salvo com {normalized.get('total_odds', 0)} odds.")

        job = load_job(job_id)
        job["status"] = "CONCLUIDA"
        job["erro"] = None
        save_job(job)
        append_log(job_id, "Job concluído.")
    except Exception as exc:  # noqa: BLE001 - API must persist explicit job failure.
        try:
            job = load_job(job_id)
            job["status"] = "ERRO"
            job["erro"] = str(exc)
            save_job(job)
            append_log(job_id, f"Job falhou: {exc}")
        except Exception:
            pass


def gerar_csv_coleta(job_id: str, raw_data: Any, job: dict[str, Any]) -> Path:
    normalized = normalize(raw_data, esporte_hint=job.get("params", {}).get("esporte"))
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
