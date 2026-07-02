from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from jobs.job_store import RAW_DIR, store

SPORT_ENV = {
    "baseball": "SCRAPER_SCRIPT_BASEBALL",
    "basketball": "SCRAPER_SCRIPT_BASKETBALL",
    "futebol": "SCRAPER_SCRIPT_FOOTBALL",
    "football": "SCRAPER_SCRIPT_FOOTBALL",
    "soccer": "SCRAPER_SCRIPT_FOOTBALL",
    "american football": "SCRAPER_SCRIPT_AMERICAN_FOOTBALL",
    "american-football": "SCRAPER_SCRIPT_AMERICAN_FOOTBALL",
    "hockey": "SCRAPER_SCRIPT_HOCKEY",
}


def _script_for_sport(esporte: str) -> str:
    key = esporte.strip().lower()
    env_name = SPORT_ENV.get(key)
    if env_name and os.getenv(env_name):
        return os.environ[env_name]
    if os.getenv("SCRAPER_SCRIPT_DEFAULT"):
        return os.environ["SCRAPER_SCRIPT_DEFAULT"]
    raise RuntimeError(
        "Nenhum script configurado para o esporte. Configure SCRAPER_SCRIPT_DEFAULT "
        "ou SCRAPER_SCRIPT_BASEBALL/BASKETBALL/FOOTBALL/AMERICAN_FOOTBALL/HOCKEY."
    )


def _command(script: str, params: dict[str, Any], output_path: Path) -> list[str]:
    command = [
        sys.executable,
        script,
        "--esporte",
        str(params.get("esporte") or ""),
        "--output",
        str(output_path),
    ]
    optional = {
        "--liga": params.get("liga"),
        "--data-inicio": params.get("data_inicio"),
        "--data-fim": params.get("data_fim"),
        "--bookmaker": params.get("bookmaker"),
        "--fonte": params.get("fonte"),
    }
    for flag, value in optional.items():
        if value:
            command.extend([flag, str(value)])
    for mercado in params.get("mercados") or []:
        command.extend(["--mercado", str(mercado)])
    return command


def _debug_env(job_id: str, params: dict[str, Any]) -> dict[str, str]:
    enabled = bool(params.get("debug")) or str(os.getenv("SCRAPER_DEBUG") or "").lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return dict(os.environ)
    env = dict(os.environ)
    debug_dir = str(params.get("debug_dir") or RAW_DIR.parent / "debug" / f"job_{job_id}")
    env["SCRAPER_DEBUG"] = "1"
    env["FLASHSCORE_DEBUG"] = "1"
    env["SCRAPER_DEBUG_DIR"] = debug_dir
    env["SCRAPER_JOB_ID"] = job_id
    Path(debug_dir).mkdir(parents=True, exist_ok=True)
    return env


def run_scraper(job_id: str, params: dict[str, Any]) -> Any:
    script = _script_for_sport(str(params.get("esporte") or ""))
    output_path = RAW_DIR / f"{job_id}.json"
    command = _command(script, params, output_path)
    store.append_log(job_id, f"Executando scraper: {' '.join(command)}")

    proc = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=int(os.getenv("SCRAPER_TIMEOUT_SECONDS", "1800")),
        check=False,
        env=_debug_env(job_id, params),
    )

    if proc.stdout.strip():
        store.append_log(job_id, f"stdout: {proc.stdout.strip()[-4000:]}")
    if proc.stderr.strip():
        store.append_log(job_id, f"stderr: {proc.stderr.strip()[-4000:]}")

    if proc.returncode != 0:
        raise RuntimeError(f"Scraper retornou código {proc.returncode}: {proc.stderr.strip() or proc.stdout.strip()}")

    if output_path.exists():
        return json.loads(output_path.read_text(encoding="utf-8"))

    stdout = proc.stdout.strip()
    if not stdout:
        raise RuntimeError("Scraper terminou sem gerar arquivo de saída nem JSON no stdout.")
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Scraper retornou stdout que não é JSON válido: {exc}") from exc
