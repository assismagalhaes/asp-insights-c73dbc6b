from __future__ import annotations

import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
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


class BaseLineRequest(BaseModel):
    esporte: str = Field(default="baseball", min_length=1)
    liga: str = Field(default="mlb", min_length=1)
    ano: int = Field(..., ge=2000, le=2100)
    sigla: str = Field(..., min_length=1)
    linha: str | list[str] = Field(..., min_length=1)


class RemoveBaseLineRequest(BaseModel):
    esporte: str = Field(default="baseball", min_length=1)
    liga: str = Field(default="mlb", min_length=1)
    ano: int = Field(..., ge=2000, le=2100)
    sigla: str = Field(..., min_length=1)


class CreateSeasonRequest(BaseModel):
    esporte: str = Field(..., min_length=1)
    liga: str = Field(..., min_length=1)
    ano_destino: int = Field(..., ge=2000, le=2100)
    ano_origem: int | None = Field(default=None, ge=2000, le=2100)


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


BASEBALL_BASE_DIR = Path(os.getenv("BASEBALL_BASE_DIR", "/home/ubuntu/jupyter/dados_baseball"))
BASKETBALL_BASE_DIR = Path(os.getenv("BASKETBALL_BASE_DIR", "/home/ubuntu/jupyter/dados_basquete"))


def normalize_slug(value: str) -> str:
    return value.strip().lower().replace(" ", "-")


def normalize_team_sigla(value: str) -> str:
    cleaned = value.strip().lower()
    return "ath" if cleaned == "oak" else cleaned


def resolve_base_root(esporte: str, liga: str, ano: int) -> Path:
    sport = normalize_slug(esporte)
    league = normalize_slug(liga)
    if sport == "baseball" and league == "mlb":
        return BASEBALL_BASE_DIR / str(ano)
    if sport == "basketball" and league in {"nba", "wnba"}:
        return BASKETBALL_BASE_DIR / league / str(ano)
    raise HTTPException(status_code=422, detail="Base ainda não integrada à API.")


def resolve_team_file(esporte: str, liga: str, ano: int, sigla: str, must_exist: bool = True) -> Path:
    sport = normalize_slug(esporte)
    league = normalize_slug(liga)
    team = normalize_team_sigla(sigla)
    root = resolve_base_root(sport, league, ano)

    if sport == "baseball":
        candidates = [
            root / f"dados_base_{team}.csv",
            root / f"dados_base_{team.upper()}.csv",
            root / f"{team}.csv",
            root / f"{team.upper()}.csv",
        ]
    else:
        candidates = [
            root / "merged" / f"dados_basquete_{team}.csv",
            root / "merged" / f"dados_basquete_{team.upper()}.csv",
            root / f"dados_basquete_{team}.csv",
            root / f"dados_basquete_{team.upper()}.csv",
        ]

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate

    if must_exist:
        raise HTTPException(status_code=404, detail=f"Arquivo da base não encontrado para {sigla} em {ano}.")
    return candidates[0]


def list_years_for_base(esporte: str, liga: str) -> dict[str, Any]:
    sport = normalize_slug(esporte)
    league = normalize_slug(liga)
    if sport == "baseball" and league == "mlb":
        root = BASEBALL_BASE_DIR
    elif sport == "basketball" and league in {"nba", "wnba"}:
        root = BASKETBALL_BASE_DIR / league
    else:
        raise HTTPException(status_code=422, detail="Base ainda não integrada à API.")

    years = []
    if root.exists():
        for folder in sorted(root.iterdir()):
            if not folder.is_dir() or not folder.name.isdigit():
                continue
            csvs = list_base_csvs(sport, league, int(folder.name))
            years.append({"ano": int(folder.name), "pasta": str(folder), "total_csvs": len(csvs)})
    years.sort(key=lambda item: item["ano"], reverse=True)
    return {"total_anos": len(years), "anos": years, "detalhes": years}


def list_base_csvs(esporte: str, liga: str, ano: int) -> list[Path]:
    sport = normalize_slug(esporte)
    league = normalize_slug(liga)
    root = resolve_base_root(sport, league, ano)
    if not root.exists():
        return []
    if sport == "baseball":
        files = list(root.glob("dados_base_*.csv"))
    else:
        merged = root / "merged"
        files = list(merged.glob("dados_basquete_*.csv")) if merged.exists() else []
        if not files:
            files = list(root.glob("dados_basquete_*.csv"))
    return [file for file in files if file.is_file() and ".ipynb_checkpoints" not in str(file) and file.suffix == ".csv"]


def list_teams_for_base(esporte: str, liga: str, ano: int) -> dict[str, Any]:
    sport = normalize_slug(esporte)
    league = normalize_slug(liga)
    teams = []
    for file in list_base_csvs(sport, league, ano):
        prefix = "dados_base_" if sport == "baseball" else "dados_basquete_"
        sigla = file.stem.replace(prefix, "", 1).upper()
        teams.append({"sigla": sigla, "nome": sigla, "arquivo": file.name, "caminho": str(file)})
    teams.sort(key=lambda item: item["sigla"])
    return {"ano": ano, "total_times": len(teams), "times": teams}


def read_last_lines_for_base(esporte: str, liga: str, ano: int, sigla: str, limite: int) -> dict[str, Any]:
    path = resolve_team_file(esporte, liga, ano, sigla)
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
        header = fh.seek(0) or next(csv.reader(fh), [])

    if not rows:
        return {
            "ano": ano,
            "sigla": sigla.upper(),
            "arquivo": str(path),
            "total_linhas": 0,
            "limite": limite,
            "cabecalho": header,
            "ultimas_linhas": [],
            "mensagem": "Temporada criada, mas ainda sem jogos importados para este time.",
        }

    selected = rows[-limite:]
    if normalize_slug(esporte) == "basketball":
        keys = ["data", "local", "adversario", "resultado", "pontos_time", "pontos_adversario", "off_rtg", "def_rtg", "pace", "ts_pct"]
        lines = [{key: row.get(key, "") for key in keys if key in row} for row in selected]
    else:
        lines = [",".join(str(row.get(col, "")) for col in header) for row in selected]
    return {
        "ano": ano,
        "sigla": sigla.upper(),
        "arquivo": str(path),
        "total_linhas": len(rows),
        "limite": limite,
        "cabecalho": header,
        "ultimas_linhas": lines,
    }


def normalize_line_input(value: str | list[str]) -> str:
    return "\t".join(value) if isinstance(value, list) else value


def validate_base_line(payload: BaseLineRequest) -> dict[str, Any]:
    sport = normalize_slug(payload.esporte)
    line = normalize_line_input(payload.linha).strip()
    if not line:
        return {"valida": False, "erros": ["Linha vazia."], "avisos": []}
    if sport == "basketball":
        parts = [part for part in line.split("\t") if part.strip()]
        avisos = []
        if len(parts) < 2:
            avisos.append("Formato parece incompleto: esperado basic e advanced separados por TAB.")
        return {
            "valida": bool(parts),
            "erros": [] if parts else ["Não foi possível identificar dados basic/advanced."],
            "avisos": avisos,
            "liga": payload.liga,
            "ano": payload.ano,
            "sigla": payload.sigla.upper(),
            "basic_identificado": len(parts) >= 1,
            "advanced_identificado": len(parts) >= 2,
            "registros_identificados": len(parts),
            "linha": line,
        }
    return {"valida": True, "erros": [], "avisos": [], "ano": payload.ano, "sigla": payload.sigla.upper(), "linha": payload.linha}


def add_base_line(payload: BaseLineRequest) -> dict[str, Any]:
    sport = normalize_slug(payload.esporte)
    league = normalize_slug(payload.liga)
    if sport == "basketball":
        script = Path("/home/ubuntu/jupyter/scripts/importar_basquete_manual.py")
        if not script.exists():
            raise HTTPException(status_code=500, detail=f"Script de importação Basketball não encontrado: {script}")
        line = normalize_line_input(payload.linha)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, prefix=f"asp_base_basketball_{league}_{payload.ano}_{payload.sigla}_", suffix=".txt") as tmp:
            tmp.write(line)
            temp_path = tmp.name
        try:
            result = subprocess.run(
                ["python3", str(script), "--liga", league, "--ano", str(payload.ano), "--time", normalize_team_sigla(payload.sigla), "--arquivo", temp_path],
                capture_output=True,
                text=True,
            )
        finally:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
        status_text = "ok" if result.returncode == 0 else "erro"
        return {
            "status": status_text,
            "ok": result.returncode == 0,
            "mensagem": "Linha Basketball importada." if result.returncode == 0 else "Falha ao importar linha Basketball.",
            "liga": league.upper(),
            "ano": payload.ano,
            "sigla": payload.sigla.upper(),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "registros_basicos_importados": parse_count_from_text(result.stdout, "basic"),
            "registros_avancados_importados": parse_count_from_text(result.stdout, "advanced"),
        }

    path = resolve_team_file(sport, league, payload.ano, payload.sigla, must_exist=True)
    backup = backup_file(path)
    line_values = payload.linha if isinstance(payload.linha, list) else [payload.linha]
    with path.open("a", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(line_values)
    return {"status": "ok", "mensagem": f"Linha adicionada ao arquivo {path}", "ano": payload.ano, "sigla": payload.sigla.upper(), "arquivo": str(path), "backup": str(backup), "linha_adicionada": line_values}


def remove_last_base_line(payload: RemoveBaseLineRequest) -> dict[str, Any]:
    if normalize_slug(payload.esporte) == "basketball":
        raise HTTPException(status_code=422, detail="Remoção manual para Basketball será habilitada após rotina segura de backup.")
    path = resolve_team_file(payload.esporte, payload.liga, payload.ano, payload.sigla, must_exist=True)
    backup = backup_file(path)
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    if len(lines) <= 1:
        raise HTTPException(status_code=422, detail="Arquivo não possui linha de dados para remover.")
    removed = lines.pop()
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"status": "ok", "mensagem": f"Última linha removida do arquivo {path}", "ano": payload.ano, "sigla": payload.sigla.upper(), "arquivo": str(path), "backup": str(backup), "linha_removida": removed}


def backup_file(path: Path) -> Path:
    backup_dir = path.parent / "backups_importacao"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"{path.stem}_{datetime.now().strftime('%Y%m%d_%H%M%S')}{path.suffix}"
    shutil.copy2(path, backup)
    return backup


def create_base_season(payload: CreateSeasonRequest) -> dict[str, Any]:
    sport = normalize_slug(payload.esporte)
    league = normalize_slug(payload.liga)
    root = resolve_base_root(sport, league, payload.ano_destino)
    existed = root.exists()
    if sport == "basketball":
        if payload.ano_origem is None:
            raise HTTPException(status_code=422, detail="ano_origem é obrigatório para Basketball.")
        script = Path("/home/ubuntu/jupyter/scripts/inicializar_temporada_basquete_vazia.py")
        if not script.exists():
            raise HTTPException(status_code=500, detail=f"Script de temporada Basketball não encontrado: {script}")
        result = subprocess.run(
            ["python3", str(script), "--liga", league, "--ano-origem", str(payload.ano_origem), "--ano-destino", str(payload.ano_destino)],
            capture_output=True,
            text=True,
        )
        return {
            "status": "ok" if result.returncode == 0 else "erro",
            "ok": result.returncode == 0,
            "mensagem": "Temporada criada com sucesso." if result.returncode == 0 else "Falha ao criar temporada.",
            "esporte": sport,
            "liga": league.upper(),
            "ano_destino": payload.ano_destino,
            "ano_origem": payload.ano_origem,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "arquivos_criados": parse_count_from_text(result.stdout, "csv"),
        }
    script = Path("/home/ubuntu/jupyter/scripts/iniciar_ano_base.py")
    if script.exists():
        result = subprocess.run(["python3", str(script), "--esporte", "baseball", "--ano", str(payload.ano_destino)], capture_output=True, text=True)
        return {"status": "ok" if result.returncode == 0 else "erro", "ok": result.returncode == 0, "mensagem": "A temporada já existe. Nenhum dado foi apagado." if existed else "Temporada criada com sucesso.", "esporte": sport, "liga": "MLB", "ano_destino": payload.ano_destino, "stdout": result.stdout, "stderr": result.stderr}
    (root / "raw").mkdir(parents=True, exist_ok=True)
    (root / "manual").mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(parents=True, exist_ok=True)
    return {"status": "ok", "ok": True, "mensagem": "A temporada já existe. Nenhum dado foi apagado." if existed else "Temporada criada com sucesso.", "esporte": sport, "liga": "MLB", "ano_destino": payload.ano_destino}


def parse_count_from_text(text: str, token: str) -> int | None:
    pattern = re.compile(rf"(\d+).{{0,30}}{re.escape(token)}|{re.escape(token)}.{{0,30}}(\d+)", re.IGNORECASE)
    match = pattern.search(text or "")
    if not match:
        return None
    return int(next(group for group in match.groups() if group))


@app.get("/modelos/base/{esporte}/{liga}/anos", dependencies=[Depends(require_bearer)])
def get_base_years(esporte: str, liga: str) -> dict[str, Any]:
    return list_years_for_base(esporte, liga)


@app.get("/modelos/base/{esporte}/{liga}/times", dependencies=[Depends(require_bearer)])
def get_base_teams(esporte: str, liga: str, ano: int) -> dict[str, Any]:
    return list_teams_for_base(esporte, liga, ano)


@app.get("/modelos/base/{esporte}/{liga}/time/{sigla}/ultimas-linhas", dependencies=[Depends(require_bearer)])
def get_base_last_lines(esporte: str, liga: str, sigla: str, ano: int, limite: int = 10) -> dict[str, Any]:
    return read_last_lines_for_base(esporte, liga, ano, sigla, limite)


@app.post("/modelos/base/validar-linha")
def post_validate_base_line(payload: BaseLineRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    return validate_base_line(payload)


@app.post("/modelos/base/adicionar")
def post_add_base_line(payload: BaseLineRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    return add_base_line(payload)


@app.post("/modelos/base/remover-ultima")
def post_remove_base_line(payload: RemoveBaseLineRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    return remove_last_base_line(payload)


@app.post("/modelos/base/criar-temporada")
def post_create_base_season(payload: CreateSeasonRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    return create_base_season(payload)


@app.get("/modelos/baseball/anos", dependencies=[Depends(require_bearer)])
def get_baseball_years_legacy() -> dict[str, Any]:
    return list_years_for_base("baseball", "mlb")


@app.get("/modelos/baseball/times", dependencies=[Depends(require_bearer)])
def get_baseball_teams_legacy(ano: int) -> dict[str, Any]:
    return list_teams_for_base("baseball", "mlb", ano)


@app.get("/modelos/baseball/time/{sigla}/ultimas-linhas", dependencies=[Depends(require_bearer)])
def get_baseball_last_lines_legacy(sigla: str, ano: int, limite: int = 10) -> dict[str, Any]:
    return read_last_lines_for_base("baseball", "mlb", ano, sigla, limite)


@app.post("/modelos/baseball/base/validar-linha")
def validate_baseball_line_legacy(payload: BaseLineRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    payload.esporte = "baseball"
    payload.liga = "mlb"
    return validate_base_line(payload)


@app.post("/modelos/baseball/base/adicionar")
def add_baseball_line_legacy(payload: BaseLineRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    payload.esporte = "baseball"
    payload.liga = "mlb"
    return add_base_line(payload)


@app.post("/modelos/baseball/base/remover-ultima")
def remove_baseball_line_legacy(payload: RemoveBaseLineRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    verificar_token(authorization)
    payload.esporte = "baseball"
    payload.liga = "mlb"
    return remove_last_base_line(payload)


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
