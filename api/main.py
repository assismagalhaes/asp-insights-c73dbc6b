from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
from uuid import uuid4
from datetime import datetime
import inspect
import hashlib
import json
import time
import os
import sys
import pandas as pd
import csv
import shutil
from typing import Any, List, Literal, Optional

from fastapi import HTTPException, Query
from pydantic import BaseModel
sys.path.append("/home/ubuntu/jupyter")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from scraper_flashscore import executar_scraper_real

try:
    from api.scraping_params import normalize_scraping_params
    from api.scraping_debug import ScraperDebugContext, is_debug_enabled, log_raw_debug
    from api.model_provenance import single_input_model_provenance
    from api.model_names import MODEL_NAME_BASEBALL, MODEL_NAME_FOOTBALL, basketball_model_name
    from scrapers.oddsagora_normalizer import normalize_oddsagora_raw
    from scrapers.oddsagora_scraper import executar_scraper_oddsagora
except ModuleNotFoundError:
    from scraping_params import normalize_scraping_params
    from scraping_debug import ScraperDebugContext, is_debug_enabled, log_raw_debug
    from model_provenance import single_input_model_provenance
    from model_names import MODEL_NAME_BASEBALL, MODEL_NAME_FOOTBALL, basketball_model_name
    from oddsagora_normalizer import normalize_oddsagora_raw
    from oddsagora_scraper import executar_scraper_oddsagora

try:
    from scrapers.flashscore_url import extract_flashscore_match_id, normalize_flashscore_url
except Exception:
    extract_flashscore_match_id = None
    normalize_flashscore_url = None

app = FastAPI(title="ASP Insights Scraper API")

BASE_DIR = Path.home() / "asp-scraper-api"
JOBS_DIR = BASE_DIR / "jobs"
RAW_DIR = BASE_DIR / "outputs" / "raw"
NORMALIZED_DIR = BASE_DIR / "outputs" / "normalized"
EXPORTS_DIR = BASE_DIR / "outputs" / "exports"
MODEL_INPUTS_DIR = BASE_DIR / "model_inputs"
DEBUG_DIR = BASE_DIR / "debug"

JOBS_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)
NORMALIZED_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_INPUTS_DIR.mkdir(parents=True, exist_ok=True)
DEBUG_DIR.mkdir(parents=True, exist_ok=True)

API_KEY = os.getenv("SCRAPER_API_KEY", "asp-teste-123")

class ScrapingParams(BaseModel):
    esporte: str
    data_inicio: str
    data_fim: str
    liga: str | None = None
    leagues: list[str] | None = None
    mercados: list[str] | None = None
    debug: bool | None = None
    source: str | None = None


def _raw_games(raw_data: Any) -> list[Any]:
    if isinstance(raw_data, dict):
        jogos = raw_data.get("jogos")
        games = raw_data.get("games")
        if isinstance(jogos, list) and jogos:
            return jogos
        if isinstance(games, list) and games:
            return games
        if isinstance(raw_data.get("_default"), dict):
            return [item for item in raw_data["_default"].values() if isinstance(item, dict)]
        if isinstance(jogos, list):
            return jogos
        if isinstance(games, list):
            return games
        for key in ("data", "result", "results", "items"):
            if isinstance(raw_data.get(key), list):
                return raw_data[key]
    if isinstance(raw_data, list):
        return raw_data
    return []


def _collection_warning(params: dict[str, Any], total_jogos: int, total_odds: int) -> str | None:
    reasons = []
    if not params.get("mercados"):
        reasons.append("nenhum mercado efetivo informado")
    if total_jogos == 0:
        reasons.append("nenhum jogo encontrado")
    if total_odds == 0:
        reasons.append("nenhuma odd normalizada")
    if not reasons:
        return None
    return "Coleta concluida com alerta: " + "; ".join(reasons) + "."


def _job_log(**values: Any) -> dict[str, Any]:
    return {
        "ts": datetime.now().isoformat(),
        **values,
    }

def _filter_supported_kwargs(func: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return kwargs
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()):
        return kwargs
    return {key: value for key, value in kwargs.items() if key in signature.parameters}


def _call_scraper_real(params: dict[str, Any], job_id: str, debug_ctx: ScraperDebugContext | None):
    kwargs = {
        "esporte": params["esporte"],
        "data_inicio": params["data_inicio"],
        "data_fim": params["data_fim"],
        "mercados": params.get("mercados", []),
        "leagues": params.get("leagues"),
    }
    if debug_ctx and debug_ctx.enabled:
        kwargs.update(
            {
                "debug": True,
                "debug_dir": str(debug_ctx.job_dir),
                "debug_job_id": job_id,
                "job_id": job_id,
            }
        )

    old_env = {
        "FLASHSCORE_DEBUG": os.environ.get("FLASHSCORE_DEBUG"),
        "SCRAPER_DEBUG": os.environ.get("SCRAPER_DEBUG"),
        "SCRAPER_DEBUG_DIR": os.environ.get("SCRAPER_DEBUG_DIR"),
        "SCRAPER_JOB_ID": os.environ.get("SCRAPER_JOB_ID"),
    }
    if debug_ctx and debug_ctx.enabled:
        os.environ["FLASHSCORE_DEBUG"] = "1"
        os.environ["SCRAPER_DEBUG"] = "1"
        os.environ["SCRAPER_DEBUG_DIR"] = str(debug_ctx.job_dir)
        os.environ["SCRAPER_JOB_ID"] = job_id
    try:
        if str(params.get("source") or "").lower() == "oddsagora":
            return executar_scraper_oddsagora(**_filter_supported_kwargs(executar_scraper_oddsagora, kwargs))
        return executar_scraper_real(**_filter_supported_kwargs(executar_scraper_real, kwargs))
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def verificar_token(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token ausente")

    token = authorization.replace("Bearer ", "").strip()

    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Token inválido")


def job_file(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def raw_file(job_id: str) -> Path:
    return RAW_DIR / f"{job_id}.json"


def normalized_file(job_id: str) -> Path:
    return NORMALIZED_DIR / f"{job_id}.json"


def save_json(path: Path, data: dict):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_raw_json(path: Path, job_id: str = "") -> dict:
    content = path.read_text(encoding="utf-8")
    if not content.strip():
        return {
            "job_id": job_id,
            "jogos": [],
            "_default": {},
            "mensagem": "Arquivo bruto da coleta está vazio.",
        }

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        return {
            "job_id": job_id,
            "jogos": [],
            "_default": {},
            "mensagem": "Arquivo bruto da coleta não contém JSON válido.",
            "erro_json": str(exc),
        }


def save_job(job: dict):
    save_json(job_file(job["job_id"]), job)


def load_job(job_id: str) -> dict:
    path = job_file(job_id)

    if not path.exists():
        raise HTTPException(status_code=404, detail="Job não encontrado")

    return load_json(path)


def normalizar_raw_data(job_id: str, raw_data: dict) -> dict:
    if isinstance(raw_data, dict) and str(raw_data.get("source") or "").lower() == "oddsagora":
        return normalize_oddsagora_raw(raw_data, job_id)

    normalized_rows = []

    def format_country_league(country: str | None, league: str | None) -> str:
        country_text = str(country or "").strip()
        league_text = str(league or "").strip()
        if not country_text:
            return league_text
        country_text = country_text.replace("_", " ").title()
        if not league_text:
            return country_text
        if league_text.casefold().startswith(f"{country_text} - ".casefold()):
            return league_text
        return f"{country_text} - {league_text}"

    def country_from_league(country: str | None, league: str | None) -> str:
        country_text = str(country or "").strip()
        if country_text:
            return country_text.replace("_", " ").title()
        league_text = str(league or "").strip()
        if " - " in league_text:
            return league_text.split(" - ", 1)[0].strip()
        return ""

    def adicionar_linha(
        data="",
        hora="",
        esporte="",
        liga="",
        country="",
        jogo_nome="",
        mandante="",
        visitante="",
        mercado="",
        pick="",
        linha="",
        odd=None,
        bookmaker="",
        fonte="",
        raw_ref=None,
    ):
        normalized_rows.append({
            "data": data,
            "hora": hora,
            "esporte": esporte,
            "liga": liga,
            "country": country_from_league(country, liga),
            "jogo": jogo_nome,
            "mandante": mandante,
            "visitante": visitante,
            "mercado": mercado,
            "pick": pick,
            "linha": linha,
            "odd": odd,
            "bookmaker": bookmaker,
            "fonte": fonte or bookmaker or "FlashScore",
            "raw_ref": raw_ref or {},
        })

    def is_number(value):
        try:
            if value is None:
                return False
            float(str(value).replace(",", "."))
            return True
        except Exception:
            return False

    def to_float(value):
        try:
            return float(str(value).replace(",", "."))
        except Exception:
            return None

    def is_half_point_line(value):
        number = to_float(value)
        if number is None:
            return False
        return abs((abs(number) % 1) - 0.5) < 1e-9

    # ======================================================
    # FORMATO ANTIGO / FAKE
    # ======================================================
    jogos_legado = raw_data.get("jogos") if isinstance(raw_data.get("jogos"), list) else []
    if jogos_legado:
        for jogo in jogos_legado:
            mercados = jogo.get("mercados", [])

            for mercado in mercados:
                adicionar_linha(
                    data=jogo.get("data", ""),
                    hora=jogo.get("hora", ""),
                    esporte=jogo.get("esporte", ""),
                    liga=jogo.get("liga", ""),
                    jogo_nome=jogo.get("jogo", ""),
                    mandante=jogo.get("mandante", ""),
                    visitante=jogo.get("visitante", ""),
                    mercado=mercado.get("mercado", ""),
                    pick=mercado.get("pick", ""),
                    linha=mercado.get("linha", ""),
                    odd=mercado.get("odd", None),
                    bookmaker=mercado.get("bookmaker", ""),
                    fonte=mercado.get("bookmaker", "") or "FakeBook"
                )

        return {
            "job_id": job_id,
            "total_linhas": len(normalized_rows),
            "linhas": normalized_rows
        }

    # ======================================================
    # FORMATO REAL DO SCRAPER / TINYDB
    # ======================================================
    jogos_tinydb = raw_data.get("_default", {})

    for _, jogo in jogos_tinydb.items():
        data = jogo.get("date", "")
        hora = jogo.get("hour", "")
        country = jogo.get("country", "")
        liga = format_country_league(country, jogo.get("league", ""))
        mandante = jogo.get("home", "")
        visitante = jogo.get("away", "")
        jogo_nome = f"{mandante} vs {visitante}".strip()
        link = jogo.get("link", "")
        game_id = (
            extract_flashscore_match_id(link)
            if extract_flashscore_match_id
            else (jogo.get("id") or jogo.get("match_id") or jogo.get("game_id") or jogo.get("fixture_id"))
        )
        fonte_jogo = normalize_flashscore_url(link) if normalize_flashscore_url and link else "FlashScore"

        esporte = ""
        if "/football/" in link or "/match/football/" in link:
            esporte = "Football"
        elif "/basketball/" in link or "/match/basketball/" in link:
            esporte = "Basketball"
        elif "/baseball/" in link or "/match/baseball/" in link:
            esporte = "Baseball"
        elif "/hockey/" in link or "/match/hockey/" in link or "/nhl/" in link:
            esporte = "Hockey"
        elif "/american-football/" in link or "/match/american-football/" in link:
            esporte = "American Football"

        odds = jogo.get("odds", {}) or {}

        for mercado_nome, submercados in odds.items():
            if not isinstance(submercados, dict):
                continue

            for sub_nome, tabela in submercados.items():
                if not tabela or len(tabela) < 2:
                    continue

                header = tabela[0]
                rows = tabela[1:]

                if not header:
                    continue

                header_upper = [str(h).strip().upper() for h in header]

                for row in rows:
                    if not row or len(row) < 2:
                        continue

                    bookmaker = str(row[0]).strip()

                    # ------------------------------
                    # 1X2
                    # Header: BOOKMAKER, 1, X, 2
                    # ------------------------------
                    if mercado_nome == "1X2":
                        for idx, pick_label in [(1, mandante), (2, "Empate"), (3, visitante)]:
                            if idx < len(row) and is_number(row[idx]):
                                adicionar_linha(
                                    data=data,
                                    hora=hora,
                                    esporte=esporte,
                                    liga=liga,
                                    jogo_nome=jogo_nome,
                                    mandante=mandante,
                                    visitante=visitante,
                                    mercado="1X2",
                                    pick=pick_label,
                                    linha="",
                                    odd=to_float(row[idx]),
                                    bookmaker=bookmaker,
                                    fonte=fonte_jogo,
                                    raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                                )

                    # ------------------------------
                    # Home/Away (Baseball/Hockey/etc.)
                    # Header: BOOKMAKER, 1, 2
                    # ------------------------------
                    elif mercado_nome == "Home/Away":
                        for idx, pick_label in [(1, mandante), (2, visitante)]:
                            if idx < len(row) and is_number(row[idx]):
                                adicionar_linha(
                                    data=data,
                                    hora=hora,
                                    esporte=esporte,
                                    liga=liga,
                                    jogo_nome=jogo_nome,
                                    mandante=mandante,
                                    visitante=visitante,
                                    mercado="Moneyline",
                                    pick=pick_label,
                                    linha="",
                                    odd=to_float(row[idx]),
                                    bookmaker=bookmaker,
                                    fonte=fonte_jogo,
                                    raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                                )

                    # ------------------------------
                    # Over/Under
                    # Header: BOOKMAKER, TOTAL, OVER, UNDER
                    # Row: betano.br, 2.5, 1.70, 2.07
                    # ------------------------------
                    elif mercado_nome == "Over/Under":
                        linha = row[1] if len(row) > 1 else ""
                        if esporte == "Baseball" and not is_half_point_line(linha):
                            continue

                        if len(row) > 2 and is_number(row[2]):
                            adicionar_linha(
                                data=data,
                                hora=hora,
                                esporte=esporte,
                                liga=liga,
                                jogo_nome=jogo_nome,
                                mandante=mandante,
                                visitante=visitante,
                                mercado="Over/Under",
                                pick=f"Over {linha}",
                                linha=str(linha),
                                odd=to_float(row[2]),
                                bookmaker=bookmaker,
                                fonte=fonte_jogo,
                                raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                            )

                        if len(row) > 3 and is_number(row[3]):
                            adicionar_linha(
                                data=data,
                                hora=hora,
                                esporte=esporte,
                                liga=liga,
                                jogo_nome=jogo_nome,
                                mandante=mandante,
                                visitante=visitante,
                                mercado="Over/Under",
                                pick=f"Under {linha}",
                                linha=str(linha),
                                odd=to_float(row[3]),
                                bookmaker=bookmaker,
                                fonte=fonte_jogo,
                                raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                            )

                    # ------------------------------
                    # Both teams to score
                    # Header: BOOKMAKER, YES, NO
                    # ------------------------------
                    elif mercado_nome == "Both teams to score":
                        if len(row) > 1 and is_number(row[1]):
                            adicionar_linha(
                                data=data,
                                hora=hora,
                                esporte=esporte,
                                liga=liga,
                                jogo_nome=jogo_nome,
                                mandante=mandante,
                                visitante=visitante,
                                mercado="Ambas Marcam",
                                pick="Sim",
                                linha="",
                                odd=to_float(row[1]),
                                bookmaker=bookmaker,
                                fonte=fonte_jogo,
                                raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                            )

                        if len(row) > 2 and is_number(row[2]):
                            adicionar_linha(
                                data=data,
                                hora=hora,
                                esporte=esporte,
                                liga=liga,
                                jogo_nome=jogo_nome,
                                mandante=mandante,
                                visitante=visitante,
                                mercado="Ambas Marcam",
                                pick="Não",
                                linha="",
                                odd=to_float(row[2]),
                                bookmaker=bookmaker,
                                fonte=fonte_jogo,
                                raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                            )

                    # ------------------------------
                    # Double chance
                    # Header: BOOKMAKER, 1X, 12, X2
                    # ------------------------------
                    elif mercado_nome == "Double chance":
                        labels = ["1X", "12", "X2"]
                        for idx, label in enumerate(labels, start=1):
                            if idx < len(row) and is_number(row[idx]):
                                adicionar_linha(
                                    data=data,
                                    hora=hora,
                                    esporte=esporte,
                                    liga=liga,
                                    jogo_nome=jogo_nome,
                                    mandante=mandante,
                                    visitante=visitante,
                                    mercado="Dupla Chance",
                                    pick=label,
                                    linha="",
                                    odd=to_float(row[idx]),
                                    bookmaker=bookmaker,
                                    fonte=fonte_jogo,
                                    raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                                )

                    # ------------------------------
                    # Asian handicap
                    # Header: BOOKMAKER, HANDICAP, 1, 2
                    # Row: betano.br, -1.5, 2.18, 1.67
                    # ------------------------------
                    elif mercado_nome == "Asian handicap":
                        linha = row[1] if len(row) > 1 else ""
                        if esporte == "Baseball" and not is_half_point_line(linha):
                            continue

                        if len(row) > 2 and is_number(row[2]):
                            adicionar_linha(
                                data=data,
                                hora=hora,
                                esporte=esporte,
                                liga=liga,
                                jogo_nome=jogo_nome,
                                mandante=mandante,
                                visitante=visitante,
                                mercado="Asian handicap",
                                pick=mandante,
                                linha=str(linha),
                                odd=to_float(row[2]),
                                bookmaker=bookmaker,
                                fonte=fonte_jogo,
                                raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                            )

                        if len(row) > 3 and is_number(row[3]):
                            adicionar_linha(
                                data=data,
                                hora=hora,
                                esporte=esporte,
                                liga=liga,
                                jogo_nome=jogo_nome,
                                mandante=mandante,
                                visitante=visitante,
                                mercado="Asian handicap",
                                pick=visitante,
                                linha=str(linha),
                                odd=to_float(row[3]),
                                bookmaker=bookmaker,
                                fonte=fonte_jogo,
                                raw_ref={"game_id": game_id, "market": mercado_nome, "period": sub_nome}
                            )

    return {
        "job_id": job_id,
        "total_linhas": len(normalized_rows),
        "linhas": normalized_rows
    }

def executar_coleta_fake(job_id: str, params: dict):
    job = load_job(job_id)
    job["status"] = "RODANDO"
    job["iniciado_em"] = datetime.now().isoformat()
    save_job(job)

    time.sleep(5)

    raw_data = {
        "job_id": job_id,
        "status": "teste",
        "mensagem": "Coleta fake concluída. Scraper real ainda não conectado.",
        "params": params,
        "jogos": [
            {
                "data": params["data_inicio"],
                "hora": "19:40",
                "esporte": params["esporte"],
                "liga": params["liga"],
                "jogo": "Pittsburgh Pirates vs Miami Marlins",
                "mandante": "Pittsburgh Pirates",
                "visitante": "Miami Marlins",
                "mercados": [
                    {
                        "mercado": "Moneyline",
                        "pick": "Pittsburgh Pirates",
                        "linha": "",
                        "odd": 1.85,
                        "bookmaker": "FakeBook"
                    },
                    {
                        "mercado": "Total de Corridas",
                        "pick": "Over 7.5",
                        "linha": "7.5",
                        "odd": 1.68,
                        "bookmaker": "FakeBook"
                    }
                ]
            }
        ]
    }

    normalized_data = normalizar_raw_data(job_id, raw_data)

    save_json(raw_file(job_id), raw_data)
    save_json(normalized_file(job_id), normalized_data)

    job["status"] = "CONCLUIDA"
    job["total_jogos"] = len(raw_data["jogos"])
    job["total_odds"] = normalized_data["total_linhas"]
    job["raw_path"] = str(raw_file(job_id))
    job["normalized_path"] = str(normalized_file(job_id))
    job["finalizado_em"] = datetime.now().isoformat()
    save_job(job)
def executar_coleta_real(job_id: str, params: dict):
    params = normalize_scraping_params(params)
    debug_ctx = ScraperDebugContext(job_id, DEBUG_DIR, enabled=is_debug_enabled(params))
    job = load_job(job_id)
    job["status"] = "RODANDO"
    job["iniciado_em"] = datetime.now().isoformat()
    job["params"] = params
    if debug_ctx.enabled:
        job["debug_dir"] = str(debug_ctx.job_dir)
    job["logs"] = [
        _job_log(
            evento="inicio_coleta_real",
            esporte=params.get("esporte"),
            leagues=params.get("leagues"),
            mercados_efetivos=params.get("mercados"),
            debug=debug_ctx.enabled,
            debug_dir=str(debug_ctx.job_dir) if debug_ctx.enabled else None,
        )
    ]
    save_job(job)

    try:
        debug_ctx.log(
            "fixtures_open_requested",
            urls=params.get("leagues") or [],
            seletores_utilizados=["external_scraper"],
            mercados_efetivos=params.get("mercados", []),
        )
        scraper_started = time.perf_counter()
        resultado = _call_scraper_real(params, job_id, debug_ctx)
        debug_ctx.log("scraper_finished", tempo_ms=int((time.perf_counter() - scraper_started) * 1000))

        raw_started = time.perf_counter()
        raw_path = None
        if isinstance(resultado, dict):
            raw_path = resultado.get("raw_path") or resultado.get("db_path")
        if raw_path and Path(raw_path).exists():
            raw_data = load_raw_json(Path(raw_path), job_id)
        else:
            raw_data = resultado if isinstance(resultado, dict) else {"data": resultado}
            raw_path = str(raw_file(job_id))
            save_json(raw_file(job_id), raw_data)
        debug_ctx.log("raw_loaded", raw_path=raw_path, tempo_ms=int((time.perf_counter() - raw_started) * 1000))

        normalization_started = time.perf_counter()
        normalized_data = normalizar_raw_data(job_id, raw_data)
        normalized_path = normalized_file(job_id)
        save_json(normalized_path, normalized_data)
        debug_ctx.log(
            "normalization_finished",
            normalized_path=str(normalized_path),
            total_linhas=normalized_data.get("total_linhas"),
            tempo_ms=int((time.perf_counter() - normalization_started) * 1000),
        )

        total_jogos = len(_raw_games(raw_data))
        total_odds = int(normalized_data.get("total_linhas") or len(normalized_data.get("linhas") or []))
        warning = _collection_warning(params, total_jogos, total_odds)
        if debug_ctx.enabled:
            debug_ctx.save_json("resultado_scraper", resultado)
            debug_ctx.save_json("raw_payload", raw_data)
            debug_ctx.save_json("normalized_payload", normalized_data)
            metrics = log_raw_debug(
                debug_ctx,
                raw_data,
                normalized_data,
                extract_match_id=extract_flashscore_match_id,
            )
        else:
            metrics = {}

        job = load_job(job_id)
        job["status"] = "WARNING" if warning else "CONCLUIDA"
        job["total_jogos"] = total_jogos
        job["total_odds"] = total_odds
        job["raw_path"] = raw_path
        job["normalized_path"] = str(normalized_path)
        job["resultado_scraper"] = resultado
        job["warning"] = warning
        job["mensagem"] = (
            "Nenhum jogo ou odd foi extraido. Consulte pasta debug."
            if warning and debug_ctx.enabled
            else warning or "Coleta real concluida com jogos e odds normalizadas."
        )
        if debug_ctx.enabled:
            job["debug_dir"] = str(debug_ctx.job_dir)
            job["debug_metrics"] = metrics
        job["logs"] = (job.get("logs") or []) + [
            _job_log(
                evento="fim_coleta_real",
                esporte=params.get("esporte"),
                leagues=params.get("leagues"),
                mercados_efetivos=params.get("mercados"),
                raw_path=raw_path,
                normalized_path=str(normalized_path),
                total_jogos=total_jogos,
                total_odds=total_odds,
                status=job["status"],
                warning=warning,
                debug=debug_ctx.enabled,
                debug_dir=str(debug_ctx.job_dir) if debug_ctx.enabled else None,
                debug_metrics=metrics,
            )
        ]
        job["finalizado_em"] = datetime.now().isoformat()
        save_job(job)


    except Exception as e:
        debug_ctx.log("scraper_exception", erro=str(e))
        job = load_job(job_id)
        job["status"] = "ERRO"
        job["erro"] = str(e)
        if debug_ctx.enabled:
            job["debug_dir"] = str(debug_ctx.job_dir)
        job["finalizado_em"] = datetime.now().isoformat()
        save_job(job)

def gerar_csv_coleta(job_id: str, raw_data: dict, job: dict) -> Path:
    normalized = normalizar_raw_data(job_id, raw_data)
    linhas = normalized.get("linhas", [])

    if not linhas:
        raise HTTPException(status_code=404, detail="Nenhuma linha normalizada disponível para exportar")

    df = pd.DataFrame(linhas)

    colunas = [
        "data",
        "hora",
        "esporte",
        "liga",
        "country",
        "jogo",
        "mandante",
        "visitante",
        "mercado",
        "pick",
        "linha",
        "odd",
        "odd_media",
        "odd_mediana",
        "odd_minima",
        "odd_maxima",
        "odd_melhor",
        "bookmaker_melhor",
        "odd_desvio_padrao",
        "casas_count",
        "odds_disponiveis",
        "probabilidade_implicita_media",
        "probabilidade_implicita_mediana",
        "margem_mercado_media",
        "margem_mercado_mediana",
        "bookmaker",
        "fonte",
    ]

    for coluna in colunas:
        if coluna not in df.columns:
            df[coluna] = ""

    df = df[colunas]

    esporte = job.get("params", {}).get("esporte", "coleta")
    esporte_safe = str(esporte).lower().replace(" ", "_").replace("-", "_")

    output_path = EXPORTS_DIR / f"{job_id}_{esporte_safe}_odds_coletadas.csv"

    df.to_csv(output_path, index=False, encoding="utf-8-sig")

    return output_path

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "asp-insights-scraper-api"
    }


@app.post("/scraping/jobs")
def criar_job(
    params: ScrapingParams,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    job_id = str(uuid4())
    params_dict = normalize_scraping_params(params.model_dump())
    debug_enabled = is_debug_enabled(params_dict)
    debug_dir = DEBUG_DIR / f"job_{job_id}"

    job = {
        "job_id": job_id,
        "status": "PENDENTE",
        "params": params_dict,
        "total_jogos": 0,
        "total_odds": 0,
        "erro": None,
        "created_at": datetime.now().isoformat(),
        "debug": debug_enabled,
        "debug_dir": str(debug_dir) if debug_enabled else None,
        "logs": [
            _job_log(
                evento="job_criado",
                esporte=params_dict.get("esporte"),
                leagues=params_dict.get("leagues"),
                mercados_efetivos=params_dict.get("mercados"),
                debug=debug_enabled,
                debug_dir=str(debug_dir) if debug_enabled else None,
            )
        ],
    }

    save_job(job)

    background_tasks.add_task(
        executar_coleta_real,
        job_id,
        params_dict
    )

    return {
        "job_id": job_id,
        "status": "PENDENTE"
    }


@app.get("/scraping/jobs/{job_id}")
def consultar_job(
    job_id: str,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)
    return load_job(job_id)

@app.get("/scraping/jobs/{job_id}/status")
def consultar_status_job(
    job_id: str,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)
    job = load_job(job_id)
    status_fields = (
        "job_id",
        "status",
        "total_jogos",
        "total_odds",
        "erro",
        "warning",
        "mensagem",
        "created_at",
        "updated_at",
        "iniciado_em",
        "finalizado_em",
    )
    return {field: job.get(field) for field in status_fields if field in job}

@app.get("/scraping/jobs/{job_id}/raw")
def consultar_raw(
    job_id: str,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    job = load_job(job_id)
    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível")

    path = Path(raw_path)

    if not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo bruto não encontrado")

    return load_raw_json(path, job_id)

@app.get("/scraping/jobs/{job_id}/normalized")
def consultar_normalized(
    job_id: str,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    job = load_job(job_id)
    normalized_path = job.get("normalized_path")
    if normalized_path:
        normalized_file_path = Path(normalized_path)
        if normalized_file_path.exists():
            normalized_data = load_json(normalized_file_path)
            return {
                **normalized_data,
                "status": job.get("status")
            }

    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível")

    path = Path(raw_path)

    if not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo bruto não encontrado")

    raw_data = load_raw_json(path, job_id)
    normalized_data = normalizar_raw_data(job_id, raw_data)

    return {
        **normalized_data,
        "status": job.get("status")
    }

@app.get("/scraping/jobs/{job_id}/csv")
def baixar_csv_coleta(
    job_id: str,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    job = load_job(job_id)
    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(status_code=404, detail="JSON bruto ainda não disponível")

    path = Path(raw_path)

    if not path.exists():
        raise HTTPException(status_code=404, detail="Arquivo bruto não encontrado")

    raw_data = load_raw_json(path, job_id)
    csv_path = gerar_csv_coleta(job_id, raw_data, job)

    return FileResponse(
        path=str(csv_path),
        filename=csv_path.name,
        media_type="text/csv"
    )




def limpar_json_nan(obj):
    import math

    if isinstance(obj, dict):
        return {k: limpar_json_nan(v) for k, v in obj.items()}

    if isinstance(obj, list):
        return [limpar_json_nan(v) for v in obj]

    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj

    return obj
class ExecutarModeloRequest(BaseModel):
    job_id: str


class ExecutarPackballModeloRequest(BaseModel):
    input_id: str
    run_mode: Literal["prognostico", "backtest"] = "prognostico"


@app.post("/modelos/futebol/executar")
def executar_modelo_futebol(
    payload: ExecutarModeloRequest,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    job_id = payload.job_id

    job = load_job(job_id)
    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(
            status_code=404,
            detail="JSON bruto ainda não disponível para este job_id"
        )

    path = Path(raw_path)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Arquivo bruto da coleta não encontrado"
        )

    raw_data = load_raw_json(path, job_id)

    # Reaproveita a função já existente que gera o CSV da coleta
    csv_coleta_path = gerar_csv_coleta(job_id, raw_data, job)

    script_modelo = BASE_DIR / "modelos" / "football_runner_real.py"
    output_path = BASE_DIR / "model_outputs" / f"prognosticos_futebol_{job_id}.csv"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not script_modelo.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script do modelo de futebol não encontrado em {script_modelo}"
        )

    import subprocess

    resultado = subprocess.run(
        [
            sys.executable,
            str(script_modelo),
            str(csv_coleta_path),
            str(output_path)
        ],
        capture_output=True,
        text=True
    )

    if resultado.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "Erro ao executar o modelo de futebol",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr
            }
        )

    try:
        resposta_script = json.loads(resultado.stdout)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "O modelo executou, mas não retornou JSON válido",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr
            }
        )

    if not resposta_script.get("ok"):
        raise HTTPException(
            status_code=500,
            detail=resposta_script
        )

    resposta_final = {
        "ok": True,
        "job_id": job_id,
        "modelo": MODEL_NAME_FOOTBALL,
        "csv_coleta": str(csv_coleta_path),
        "arquivo_saida": f"prognosticos_futebol_{job_id}.csv",
        "arquivo_contexto": resposta_script.get("arquivo_contexto"),
        "arquivo_snapshot": resposta_script.get("arquivo_snapshot"),
        "provenance": single_input_model_provenance(
            resposta_script,
            raw_path=path,
            input_path=csv_coleta_path,
            job_id=job_id,
        ),
        "total_prognosticos": resposta_script.get("total_prognosticos", 0),
        "contexto_modelo": resposta_script.get("contexto_modelo", ""),
        "dados_tecnicos": resposta_script.get("dados_tecnicos", ""),
        "prognosticos": resposta_script.get("prognosticos", [])
    }

    return limpar_json_nan(resposta_final)

@app.post("/modelos/baseball/executar")
def executar_modelo_baseball(
    payload: ExecutarModeloRequest,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    job_id = payload.job_id

    job = load_job(job_id)
    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(
            status_code=404,
            detail="JSON bruto ainda não disponível para este job_id"
        )

    path = Path(raw_path)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Arquivo bruto da coleta não encontrado"
        )

    raw_data = load_raw_json(path, job_id)

    csv_coleta_path = gerar_csv_coleta(job_id, raw_data, job)

    script_modelo = BASE_DIR / "modelos" / "baseball_runner_real.py"
    output_path = BASE_DIR / "model_outputs" / f"prognosticos_baseball_{job_id}.csv"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not script_modelo.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script do modelo de baseball não encontrado em {script_modelo}"
        )

    import subprocess

    resultado = subprocess.run(
        [
            sys.executable,
            str(script_modelo),
            str(csv_coleta_path),
            str(output_path)
        ],
        capture_output=True,
        text=True
    )

    if resultado.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "Erro ao executar o modelo de baseball",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr
            }
        )

    try:
        resposta_script = json.loads(resultado.stdout)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "O modelo executou, mas não retornou JSON válido",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr
            }
        )

    if not resposta_script.get("ok"):
        raise HTTPException(
            status_code=500,
            detail=resposta_script
        )

    resposta_final = {
        "ok": True,
        "job_id": job_id,
        "modelo": MODEL_NAME_BASEBALL,
        "csv_coleta": str(csv_coleta_path),
        "arquivo_saida": f"prognosticos_baseball_{job_id}.csv",
        "arquivo_contexto": resposta_script.get("arquivo_contexto"),
        "total_prognosticos": resposta_script.get("total_prognosticos", 0),
        "contexto_modelo": resposta_script.get("contexto_modelo", ""),
        "dados_tecnicos": resposta_script.get("dados_tecnicos", ""),
        "prognosticos": resposta_script.get("prognosticos", []),
        "handicap_shadow_diagnostics": resposta_script.get("handicap_shadow_diagnostics"),
    }

    return limpar_json_nan(resposta_final)


def _executar_modelo_basketball(job_id: str, liga: str):
    job = load_job(job_id)
    raw_path = job.get("raw_path")

    if not raw_path:
        raise HTTPException(
            status_code=404,
            detail="JSON bruto ainda não disponível para este job_id"
        )

    path = Path(raw_path)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Arquivo bruto da coleta não encontrado"
        )

    raw_data = load_raw_json(path, job_id)
    csv_coleta_path = gerar_csv_coleta(job_id, raw_data, job)

    liga = liga.upper().strip()
    script_modelo = BASE_DIR / "modelos" / "basketball_runner_real.py"
    output_path = BASE_DIR / "model_outputs" / f"prognosticos_basketball_{liga.lower()}_{job_id}.csv"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not script_modelo.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script do modelo de basketball não encontrado em {script_modelo}"
        )

    import subprocess

    resultado = subprocess.run(
        [
            sys.executable,
            str(script_modelo),
            str(csv_coleta_path),
            str(output_path),
            liga,
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )

    if resultado.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": f"Erro ao executar o modelo de basketball {liga}",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr,
            }
        )

    try:
        resposta_script = json.loads(resultado.stdout)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "O modelo executou, mas não retornou JSON válido",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr,
            }
        )

    if not resposta_script.get("ok"):
        raise HTTPException(status_code=500, detail=resposta_script)

    resposta_final = {
        "ok": True,
        "job_id": job_id,
        "modelo": basketball_model_name(liga),
        "csv_coleta": str(csv_coleta_path),
        "arquivo_saida": output_path.name,
        "arquivo_contexto": resposta_script.get("arquivo_contexto"),
        "total_prognosticos": resposta_script.get("total_prognosticos", 0),
        "contexto_modelo": resposta_script.get("contexto_modelo", ""),
        "dados_tecnicos": resposta_script.get("dados_tecnicos", ""),
        "mensagem": resposta_script.get("mensagem"),
        "prognosticos": resposta_script.get("prognosticos", []),
        "handicap_shadow_diagnostics": resposta_script.get("handicap_shadow_diagnostics"),
    }

    return limpar_json_nan(resposta_final)


@app.post("/modelos/basketball/nba/executar")
def executar_modelo_basketball_nba(
    payload: ExecutarModeloRequest,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)
    return _executar_modelo_basketball(payload.job_id, "NBA")


@app.post("/modelos/basketball/wnba/executar")
def executar_modelo_basketball_wnba(
    payload: ExecutarModeloRequest,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)
    return _executar_modelo_basketball(payload.job_id, "WNBA")


@app.post("/modelos/basketball/executar")
def executar_modelo_basketball(
    payload: ExecutarModeloRequest,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)
    job = load_job(payload.job_id)
    liga = str(job.get("liga") or "").upper()
    if "WNBA" in liga:
        return _executar_modelo_basketball(payload.job_id, "WNBA")
    return _executar_modelo_basketball(payload.job_id, "NBA")


PACKBALL_MODEL_CONFIG = {
    "ASP GoalMatrix": {
        "slug": "goalmatrix",
        "script": "goalmatrix_runner_real.py",
        "output_prefix": "asp_goalmatrix",
    },
    "ASP CornerMatrix": {
        "slug": "cornermatrix",
        "script": "cornermatrix_runner_real.py",
        "output_prefix": "asp_cornermatrix",
    },
    "ASP BackMatrix": {
        "slug": "backmatrix",
        "script": "backmatrix_runner_real.py",
        "output_prefix": "asp_backmatrix",
    },
}


def normalize_packball_model(modelo: str) -> str:
    normalized = modelo.strip().casefold()
    if "goal" in normalized or "gol" in normalized:
        return "ASP GoalMatrix"
    if "corner" in normalized or "canto" in normalized:
        return "ASP CornerMatrix"
    if "back" in normalized or "favorito" in normalized:
        return "ASP BackMatrix"
    raise HTTPException(status_code=422, detail="Modelo PackBall nao suportado.")


def infer_packball_date(*names: str) -> str:
    for name in names:
        match = re.search(r"(\d{2}-\d{2}-\d{4})", name)
        if match:
            return match.group(1)
    return datetime.now().strftime("%d-%m-%Y")


def packball_input_dir(input_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-fA-F-]{16,64}", input_id):
        raise HTTPException(status_code=422, detail="input_id invalido.")
    return MODEL_INPUTS_DIR / "packball" / input_id


async def save_uploaded_packball_file(file: UploadFile, target: Path) -> int:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail=f"Arquivo vazio: {file.filename}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return len(content)


def packball_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@app.post("/modelos/packball/upload")
async def upload_packball_model_files(
    modelo: str = Form(...),
    arquivo_5: UploadFile = File(...),
    arquivo_20: UploadFile = File(...),
    date_str: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    verificar_token(authorization)

    model_name = normalize_packball_model(modelo)
    config = PACKBALL_MODEL_CONFIG[model_name]
    input_id = str(uuid4())
    target_dir = packball_input_dir(input_id)

    selected_date = (date_str or "").strip() or infer_packball_date(arquivo_5.filename or "", arquivo_20.filename or "")
    if not re.fullmatch(r"\d{2}-\d{2}-\d{4}", selected_date):
        raise HTTPException(status_code=422, detail="Data deve estar no formato DD-MM-YYYY.")

    recent_window = 10 if model_name in {"ASP GoalMatrix", "ASP CornerMatrix", "ASP BackMatrix"} else 5
    file5_path = target_dir / f"packball_{recent_window}.csv"
    file20_path = target_dir / "packball_20.csv"
    size5 = await save_uploaded_packball_file(arquivo_5, file5_path)
    size20 = await save_uploaded_packball_file(arquivo_20, file20_path)

    meta = {
        "input_id": input_id,
        "modelo": model_name,
        "slug": config["slug"],
        "date_str": selected_date,
        "arquivo_5": str(file5_path),
        "arquivo_recente": str(file5_path),
        "arquivo_20": str(file20_path),
        "nome_original_5": arquivo_5.filename,
        "nome_original_recente": arquivo_5.filename,
        "nome_original_20": arquivo_20.filename,
        "tamanho_5": size5,
        "tamanho_recente": size5,
        "tamanho_20": size20,
        "sha256_5": packball_file_sha256(file5_path),
        "sha256_recente": packball_file_sha256(file5_path),
        "sha256_20": packball_file_sha256(file20_path),
        "janela_recente": recent_window,
        "perfil_recente": (
            "10 jogos, todos os mandos e ligas, sem temporada anterior"
            if model_name in {"ASP GoalMatrix", "ASP CornerMatrix", "ASP BackMatrix"} else "5 jogos"
        ),
        "perfil_20": (
            "20 jogos, mandante em casa e visitante fora, todas as ligas, com temporada anterior"
            if model_name in {"ASP GoalMatrix", "ASP CornerMatrix", "ASP BackMatrix"} else "20 jogos"
        ),
        "created_at": datetime.now().isoformat(),
    }
    save_json(target_dir / "meta.json", meta)

    return limpar_json_nan({"ok": True, **meta})


def executar_modelo_packball(
    input_id: str,
    expected_model: str,
    authorization: str | None,
    run_mode: str = "prognostico",
):
    verificar_token(authorization)

    target_dir = packball_input_dir(input_id)
    meta_path = target_dir / "meta.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Upload PackBall nao encontrado.")

    meta = load_json(meta_path)
    model_name = normalize_packball_model(str(meta.get("modelo") or expected_model))
    if model_name != expected_model:
        raise HTTPException(status_code=422, detail=f"Upload pertence ao modelo {model_name}.")

    config = PACKBALL_MODEL_CONFIG[model_name]
    file5_path = Path(str(meta.get("arquivo_recente") or meta.get("arquivo_5") or ""))
    file20_path = Path(str(meta.get("arquivo_20") or ""))
    if not file5_path.exists() or not file20_path.exists():
        raise HTTPException(status_code=404, detail="Arquivos PackBall do upload nao encontrados.")

    script_modelo = BASE_DIR / "modelos" / config["script"]
    if not script_modelo.exists():
        raise HTTPException(status_code=500, detail=f"Script do modelo nao encontrado em {script_modelo}")

    output_path = BASE_DIR / "model_outputs" / f"{config['output_prefix']}_{input_id}.csv"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    import subprocess

    command = [
        sys.executable,
        str(script_modelo),
        str(file5_path),
        str(file20_path),
        str(output_path),
        str(meta.get("date_str") or ""),
    ]
    if expected_model in {"ASP GoalMatrix", "ASP CornerMatrix", "ASP BackMatrix"}:
        command.append(run_mode)

    resultado = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=180,
    )

    if resultado.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": f"Erro ao executar o modelo {model_name}",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr,
            }
        )

    try:
        resposta_script = json.loads(resultado.stdout)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "erro": "O modelo executou, mas nao retornou JSON valido",
                "stdout": resultado.stdout,
                "stderr": resultado.stderr,
            }
        )

    if not resposta_script.get("ok"):
        raise HTTPException(status_code=500, detail=resposta_script)

    resposta_final = {
        "ok": True,
        "input_id": input_id,
        "job_id": input_id,
        "modelo": model_name,
        "run_mode": run_mode if expected_model in {"ASP GoalMatrix", "ASP CornerMatrix", "ASP BackMatrix"} else "prognostico",
        "csv_coleta": None,
        "arquivo_saida": f"{config['output_prefix']}_{input_id}.csv",
        "arquivo_contexto": resposta_script.get("arquivo_contexto"),
        "arquivo_snapshot": resposta_script.get("arquivo_snapshot"),
        "provenance": resposta_script.get("provenance"),
        "total_prognosticos": resposta_script.get("total_prognosticos", 0),
        "diagnostico_funil": resposta_script.get("diagnostico_funil"),
        "contexto_modelo": resposta_script.get("contexto_modelo", ""),
        "dados_tecnicos": resposta_script.get("dados_tecnicos", ""),
        "prognosticos": resposta_script.get("prognosticos", []),
    }

    return limpar_json_nan(resposta_final)


@app.post("/modelos/goalmatrix/executar")
def executar_modelo_goalmatrix(
    payload: ExecutarPackballModeloRequest,
    authorization: str | None = Header(default=None)
):
    return executar_modelo_packball(payload.input_id, "ASP GoalMatrix", authorization, payload.run_mode)


@app.post("/modelos/cornermatrix/executar")
def executar_modelo_cornermatrix(
    payload: ExecutarPackballModeloRequest,
    authorization: str | None = Header(default=None)
):
    return executar_modelo_packball(payload.input_id, "ASP CornerMatrix", authorization, payload.run_mode)


@app.post("/modelos/backmatrix/executar")
def executar_modelo_backmatrix(
    payload: ExecutarPackballModeloRequest,
    authorization: str | None = Header(default=None)
):
    return executar_modelo_packball(payload.input_id, "ASP BackMatrix", authorization, payload.run_mode)

# ============================================================
# ROTAS - MODELOS BASEBALL - BASE HISTÓRICA
# ============================================================

BASEBALL_HIST_DIR = Path(
    os.getenv("BASEBALL_HIST_DIR", "/home/ubuntu/jupyter/dados_baseball")
)


class BaseballLinhaPayload(BaseModel):
    ano: int
    sigla: str
    linha: list[Any]


class BaseballRemoverUltimaPayload(BaseModel):
    ano: int
    sigla: str


def _normalizar_sigla_baseball(sigla: str) -> str:
    sigla_limpa = str(sigla).strip()

    if not sigla_limpa:
        raise HTTPException(status_code=400, detail="Sigla do time não informada")

    caracteres_validos = set(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
    )

    if not all(c in caracteres_validos for c in sigla_limpa):
        raise HTTPException(
            status_code=400,
            detail="Sigla inválida. Use apenas letras, números, hífen ou underline."
        )

    return sigla_limpa.upper()


def _pasta_ano_baseball(ano: int) -> Path:
    pasta = BASEBALL_HIST_DIR / str(ano)

    if not pasta.exists() or not pasta.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"Pasta do ano {ano} não encontrada em {BASEBALL_HIST_DIR}"
        )

    return pasta


def _csv_time_baseball(ano: int, sigla: str) -> Path:
    pasta = _pasta_ano_baseball(ano)
    sigla_norm = _normalizar_sigla_baseball(sigla)

    candidatos = [
        pasta / f"{sigla_norm}.csv",
        pasta / f"{sigla_norm.lower()}.csv",
        pasta / f"{sigla_norm.upper()}.csv",
        pasta / f"dados_base_{sigla_norm.lower()}.csv",
        pasta / f"dados_base_{sigla_norm.upper()}.csv",
        pasta / f"base_{sigla_norm.lower()}.csv",
        pasta / f"base_{sigla_norm.upper()}.csv",
    ]

    for caminho in candidatos:
        if caminho.exists() and caminho.is_file():
            return caminho

    for arquivo in pasta.glob("*.csv"):
        if "_backups" in arquivo.parts:
            continue

        sigla_arquivo = _extrair_sigla_arquivo_baseball(arquivo)

        if sigla_arquivo == sigla_norm:
            return arquivo

    raise HTTPException(
        status_code=404,
        detail=f"CSV do time {sigla_norm} não encontrado no ano {ano}"
    )

def _ler_csv_baseball(caminho_csv: Path) -> tuple[list[str], list[list[str]]]:
    try:
        with caminho_csv.open("r", encoding="utf-8-sig", newline="") as f:
            leitor = csv.reader(f)
            linhas = list(leitor)
    except UnicodeDecodeError:
        with caminho_csv.open("r", encoding="latin-1", newline="") as f:
            leitor = csv.reader(f)
            linhas = list(leitor)

    if not linhas:
        raise HTTPException(
            status_code=400,
            detail=f"CSV vazio: {caminho_csv.name}"
        )

    cabecalho = linhas[0]
    dados = linhas[1:]

    return cabecalho, dados


def _criar_backup_baseball(caminho_csv: Path) -> Path:
    pasta_backup = caminho_csv.parent / "_backups"
    pasta_backup.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = pasta_backup / f"{caminho_csv.stem}_{timestamp}.csv"

    shutil.copy2(caminho_csv, backup)

    return backup


def _validar_linha_baseball(caminho_csv: Path, linha: list[Any]) -> dict:
    cabecalho, _ = _ler_csv_baseball(caminho_csv)

    qtd_colunas_csv = len(cabecalho)
    qtd_colunas_linha = len(linha)

    valido = qtd_colunas_linha == qtd_colunas_csv

    return {
        "valido": valido,
        "arquivo": caminho_csv.name,
        "cabecalho": cabecalho,
        "qtd_colunas_csv": qtd_colunas_csv,
        "qtd_colunas_linha": qtd_colunas_linha,
        "mensagem": (
            "Linha válida para o cabeçalho do CSV."
            if valido
            else f"Linha inválida: esperado {qtd_colunas_csv} colunas, recebido {qtd_colunas_linha}."
        )
    }


@app.get("/modelos/baseball/anos")
def listar_anos_baseball(
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    if not BASEBALL_HIST_DIR.exists() or not BASEBALL_HIST_DIR.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"Diretório de dados baseball não encontrado: {BASEBALL_HIST_DIR}"
        )

    anos = []
    detalhes = []

    for pasta in BASEBALL_HIST_DIR.iterdir():
        if pasta.is_dir() and pasta.name.isdigit():
            csvs = [
                arquivo
                for arquivo in pasta.glob("*.csv")
                if "_backups" not in arquivo.parts
            ]

            total_csvs = len(csvs)

            if total_csvs > 0:
                ano_int = int(pasta.name)
                anos.append(ano_int)

                detalhes.append({
                    "ano": ano_int,
                    "total_csvs": total_csvs
                })

    anos = sorted(anos, reverse=True)
    detalhes = sorted(detalhes, key=lambda item: item["ano"], reverse=True)

    return {
        "ok": True,
        "base_dir": str(BASEBALL_HIST_DIR),
        "anos": anos,
        "detalhes": detalhes,
        "total_anos": len(anos)
    }

BASEBALL_TEAM_NAMES = {
    "NYY": "New York Yankees",
    "TOR": "Toronto Blue Jays",
    "BOS": "Boston Red Sox",
    "TBR": "Tampa Bay Rays",
    "BAL": "Baltimore Orioles",
    "DET": "Detroit Tigers",
    "CLE": "Cleveland Guardians",
    "KCR": "Kansas City Royals",
    "MIN": "Minnesota Twins",
    "CHW": "Chicago White Sox",
    "TEX": "Texas Rangers",
    "LAA": "Los Angeles Angels",
    "HOU": "Houston Astros",
    "SEA": "Seattle Mariners",
    "ATH": "Athletics",
    "NYM": "New York Mets",
    "PHI": "Philadelphia Phillies",
    "MIA": "Miami Marlins",
    "WSN": "Washington Nationals",
    "ATL": "Atlanta Braves",
    "CHC": "Chicago Cubs",
    "CIN": "Cincinnati Reds",
    "MIL": "Milwaukee Brewers",
    "STL": "St. Louis Cardinals",
    "PIT": "Pittsburgh Pirates",
    "SDP": "San Diego Padres",
    "SFG": "San Francisco Giants",
    "LAD": "Los Angeles Dodgers",
    "ARI": "Arizona Diamondbacks",
    "COL": "Colorado Rockies",
}

@app.get("/modelos/baseball/times")
def listar_times_baseball(
    ano: int,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    pasta = _pasta_ano_baseball(ano)

    times = []

    for arquivo in sorted(pasta.glob("*.csv")):
        if "_backups" in arquivo.parts:
            continue

        sigla = _extrair_sigla_arquivo_baseball(arquivo)

        times.append({
             "sigla": sigla,
             "nome": BASEBALL_TEAM_NAMES.get(sigla, sigla),
             "arquivo": arquivo.name
        })

    return {
        "ok": True,
        "ano": ano,
        "times": times,
        "total": len(times)
    }

@app.get("/modelos/baseball/time/{sigla}/ultimas-linhas")
def ultimas_linhas_time_baseball(
    sigla: str,
    ano: int,
    limite: int = 10,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    if limite < 1:
        limite = 1

    if limite > 100:
        limite = 100

    caminho_csv = _csv_time_baseball(ano, sigla)
    cabecalho, dados = _ler_csv_baseball(caminho_csv)

    ultimas = dados[-limite:] if dados else []

    linhas = []

    primeira_linha_numero = max(len(dados) - len(ultimas) + 1, 1)

    for idx, linha in enumerate(ultimas, start=primeira_linha_numero):
        linhas.append({
            "numero_linha_dados": idx,
            "valores": linha,
            "registro": dict(zip(cabecalho, linha))
        })

    return {
        "ok": True,
        "ano": ano,
        "sigla": _normalizar_sigla_baseball(sigla),
        "arquivo": caminho_csv.name,
        "cabecalho": cabecalho,
        "total_linhas_dados": len(dados),
        "limite": limite,
        "linhas": linhas
    }


@app.post("/modelos/baseball/base/validar-linha")
def validar_linha_baseball(
    payload: BaseballLinhaPayload,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    caminho_csv = _csv_time_baseball(payload.ano, payload.sigla)

    resultado = _validar_linha_baseball(caminho_csv, payload.linha)

    return {
        "ok": True,
        "ano": payload.ano,
        "sigla": _normalizar_sigla_baseball(payload.sigla),
        **resultado
    }


@app.post("/modelos/baseball/base/adicionar")
def adicionar_linha_baseball(
    payload: BaseballLinhaPayload,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    caminho_csv = _csv_time_baseball(payload.ano, payload.sigla)

    validacao = _validar_linha_baseball(caminho_csv, payload.linha)

    if not validacao["valido"]:
        raise HTTPException(
            status_code=400,
            detail=validacao
        )

    backup = _criar_backup_baseball(caminho_csv)

    linha_formatada = [
        "" if valor is None else str(valor)
        for valor in payload.linha
    ]

    with caminho_csv.open("a", encoding="utf-8-sig", newline="") as f:
        escritor = csv.writer(f)
        escritor.writerow(linha_formatada)

    _, dados_atualizados = _ler_csv_baseball(caminho_csv)

    return {
        "ok": True,
        "mensagem": "Linha adicionada com sucesso.",
        "ano": payload.ano,
        "sigla": _normalizar_sigla_baseball(payload.sigla),
        "arquivo": caminho_csv.name,
        "backup": str(backup),
        "total_linhas_dados": len(dados_atualizados),
        "linha_adicionada": linha_formatada
    }


@app.post("/modelos/baseball/base/remover-ultima")
def remover_ultima_linha_baseball(
    payload: BaseballRemoverUltimaPayload,
    authorization: str | None = Header(default=None)
):
    verificar_token(authorization)

    caminho_csv = _csv_time_baseball(payload.ano, payload.sigla)

    cabecalho, dados = _ler_csv_baseball(caminho_csv)

    if not dados:
        raise HTTPException(
            status_code=400,
            detail="O CSV não possui linhas de dados para remover."
        )

    backup = _criar_backup_baseball(caminho_csv)

    linha_removida = dados[-1]
    dados_restantes = dados[:-1]

    with caminho_csv.open("w", encoding="utf-8-sig", newline="") as f:
        escritor = csv.writer(f)
        escritor.writerow(cabecalho)
        escritor.writerows(dados_restantes)

    return {
        "ok": True,
        "mensagem": "Última linha removida com sucesso.",
        "ano": payload.ano,
        "sigla": _normalizar_sigla_baseball(payload.sigla),
        "arquivo": caminho_csv.name,
        "backup": str(backup),
        "total_linhas_dados": len(dados_restantes),
        "linha_removida": linha_removida
    }

def _extrair_sigla_arquivo_baseball(arquivo: Path) -> str:
    nome = arquivo.stem.strip()

    prefixos = [
        "dados_base_",
        "base_",
        "dados_",
    ]

    nome_lower = nome.lower()

    for prefixo in prefixos:
        if nome_lower.startswith(prefixo):
            nome = nome[len(prefixo):]
            break

    return nome.upper()
# ============================================================
# BASE DE DADOS - BASKETBALL NBA/WNBA
# ============================================================

from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from pathlib import Path
import subprocess
import tempfile
import os
import re

BASKETBALL_BASE_DIR = Path("/home/ubuntu/jupyter/dados_basquete")
BASKETBALL_IMPORT_SCRIPT = Path("/home/ubuntu/jupyter/scripts/importar_basquete_manual.py")
BASKETBALL_INIT_SCRIPT = Path("/home/ubuntu/jupyter/scripts/inicializar_temporada_basquete_vazia.py")

NBA_TEAM_NAMES = {
    "ATL": "Atlanta Hawks",
    "BOS": "Boston Celtics",
    "BRK": "Brooklyn Nets",
    "CHO": "Charlotte Hornets",
    "CHI": "Chicago Bulls",
    "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks",
    "DEN": "Denver Nuggets",
    "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors",
    "HOU": "Houston Rockets",
    "IND": "Indiana Pacers",
    "LAC": "Los Angeles Clippers",
    "LAL": "Los Angeles Lakers",
    "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat",
    "MIL": "Milwaukee Bucks",
    "MIN": "Minnesota Timberwolves",
    "NOP": "New Orleans Pelicans",
    "NYK": "New York Knicks",
    "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic",
    "PHI": "Philadelphia 76ers",
    "PHO": "Phoenix Suns",
    "POR": "Portland Trail Blazers",
    "SAC": "Sacramento Kings",
    "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors",
    "UTA": "Utah Jazz",
    "WAS": "Washington Wizards",
}

WNBA_TEAM_NAMES = {
    "ATL": "Atlanta Dream W",
    "CHI": "Chicago Sky W",
    "CON": "Connecticut Sun W",
    "DAL": "Dallas Wings W",
    "GSV": "Golden State Valkyries W",
    "IND": "Indiana Fever W",
    "LVA": "Las Vegas Aces W",
    "LAS": "Los Angeles Sparks W",
    "MIN": "Minnesota Lynx W",
    "NYL": "New York Liberty W",
    "PHO": "Phoenix Mercury W",
    "SEA": "Seattle Storm W",
    "WAS": "Washington Mystics W",
    "TOR": "Toronto Tempo W",
    "POR": "Portland Fire W",
}


def _basketball_team_name(liga: str, sigla: str) -> str:
    sigla = sigla.upper().strip()

    if liga.lower() == "nba":
        return NBA_TEAM_NAMES.get(sigla, sigla)

    if liga.lower() == "wnba":
        return WNBA_TEAM_NAMES.get(sigla, sigla)

    return sigla


def _basketball_team_option(liga: str, sigla: str) -> dict:
    sigla = sigla.upper().strip()
    nome = _basketball_team_name(liga, sigla)

    return {
        "sigla": sigla,
        "codigo": sigla,
        "value": sigla,
        "time": sigla,
        "team": sigla,
        "nome": nome,
        "name": nome,
        "label": f"{sigla} - {nome}",
        "display": f"{sigla} - {nome}",
    }

class BasketballLinhaPayload(BaseModel):
    linha: str


class BasketballTemporadaPayload(BaseModel):
    ano_origem: int
    ano_destino: int


def _dividir_registros_basketball(texto: str) -> List[str]:
    texto = (texto or "").strip()

    if not texto:
        return []

    registros: List[str] = []

    for linha in [l.strip() for l in texto.splitlines() if l.strip()]:
        partes_tab = [p.strip() for p in linha.split("\t") if p.strip()]

        for parte_tab in partes_tab:
            partes = re.split(
                r"\s+(?=(?:\d+,\d+,\d{4}-\d{2}-\d{2},|\d+,\d{4}-\d{2}-\d{2},))",
                parte_tab,
            )

            for parte in partes:
                parte = parte.strip()
                if parte:
                    registros.append(parte)

    return registros


def _normalizar_basketball_liga(liga: str) -> str:
    liga = liga.lower().strip()
    if liga not in ["nba", "wnba"]:
        raise HTTPException(status_code=400, detail="Liga inválida. Use nba ou wnba.")
    return liga


def _normalizar_time(time: str) -> str:
    return time.lower().strip()


def _basketball_year_dir(liga: str, ano: int) -> Path:
    liga = _normalizar_basketball_liga(liga)
    return BASKETBALL_BASE_DIR / liga / str(ano)


def _basketball_merged_dir(liga: str, ano: int) -> Path:
    return _basketball_year_dir(liga, ano) / "merged"


def _basketball_file_path(liga: str, ano: int, time: str) -> Path:
    liga = _normalizar_basketball_liga(liga)
    time = _normalizar_time(time)

    path_merged = BASKETBALL_BASE_DIR / liga / str(ano) / "merged" / f"dados_basquete_{time}.csv"
    path_raiz = BASKETBALL_BASE_DIR / liga / str(ano) / f"dados_basquete_{time}.csv"

    if path_merged.exists():
        return path_merged

    if path_raiz.exists():
        return path_raiz

    # Retorna o caminho padrão novo mesmo se ainda não existir.
    return path_merged


def _listar_times_basketball(liga: str, ano: int) -> List[str]:
    liga = _normalizar_basketball_liga(liga)
    base_ano = _basketball_year_dir(liga, ano)
    merged_dir = base_ano / "merged"

    arquivos = []

    if merged_dir.exists():
        arquivos = list(merged_dir.glob("dados_basquete_*.csv"))

    if not arquivos and base_ano.exists():
        arquivos = list(base_ano.glob("dados_basquete_*.csv"))

    times = []

    for arquivo in arquivos:
        if ".ipynb_checkpoints" in str(arquivo):
            continue

        nome = arquivo.name

        if not nome.startswith("dados_basquete_") or not nome.endswith(".csv"):
            continue

        time = nome.replace("dados_basquete_", "").replace(".csv", "").upper()
        times.append(time)

    return sorted(list(set(times)))


def _parse_import_stdout(stdout: str) -> Dict[str, Any]:
    resultado = {
        "registros_lidos": None,
        "registros_basicos_importados": None,
        "registros_avancados_importados": None,
        "erros_ignorados": None,
        "arquivo_merged": None,
        "raw_salvo": None,
        "log_salvo": None,
    }

    patterns = {
        "registros_lidos": r"Registros lidos:\s*(\d+)",
        "registros_basicos_importados": r"Registros básicos importados:\s*(\d+)",
        "registros_avancados_importados": r"Registros avançados importados:\s*(\d+)",
        "erros_ignorados": r"Erros/ignorados:\s*(\d+)",
        "arquivo_merged": r"Arquivo merged:\s*(.+)",
        "raw_salvo": r"Raw salvo em:\s*(.+)",
        "log_salvo": r"Log salvo em:\s*(.+)",
    }

    for key, pattern in patterns.items():
        match = re.search(pattern, stdout)
        if match:
            value = match.group(1).strip()
            if key in [
                "registros_lidos",
                "registros_basicos_importados",
                "registros_avancados_importados",
                "erros_ignorados",
            ]:
                try:
                    value = int(value)
                except Exception:
                    pass
            resultado[key] = value

    return resultado


@app.get("/modelos/base/basketball/{liga}/anos")
def listar_anos_basketball(liga: str):
    liga = _normalizar_basketball_liga(liga)
    base_liga = BASKETBALL_BASE_DIR / liga

    if not base_liga.exists():
        return {
            "ok": True,
            "esporte": "basketball",
            "liga": liga.upper(),
            "anos": [],
            "message": f"Nenhum diretório encontrado para {liga.upper()}."
        }

    anos = []

    for item in base_liga.iterdir():
        if item.is_dir() and item.name.isdigit():
            anos.append({
                "ano": int(item.name),
                "label": item.name,
                "path": str(item),
            })

    anos = sorted(anos, key=lambda x: x["ano"])

    return {
        "ok": True,
        "esporte": "basketball",
        "liga": liga.upper(),
        "anos": anos,
        "total": len(anos),
    }


@app.get("/modelos/base/basketball/{liga}/{ano}/times")
def listar_times_basketball(liga: str, ano: int):
    liga = _normalizar_basketball_liga(liga)
    times = _listar_times_basketball(liga, ano)

    times_obj = [
        _basketball_team_option(liga, t)
        for t in times
    ]

    return {
        "ok": True,
        "esporte": "basketball",
        "liga": liga.upper(),
        "ano": ano,

        # Compatibilidade com o app atual
        "times": times,
        "teams": times,

        # Versão enriquecida para o app usar depois
        "items": times_obj,
        "options": times_obj,
        "times_detalhados": times_obj,
        "teams_detalhados": times_obj,

        "total": len(times),
        "count": len(times),
    }

@app.get("/modelos/base/basketball/{liga}/{ano}/{time}/ultimas")
def ultimas_linhas_basketball(liga: str, ano: int, time: str, limite: int = 10):
    liga = _normalizar_basketball_liga(liga)
    time_norm = _normalizar_time(time)

    path = _basketball_file_path(liga, ano, time_norm)

    if not path.exists():
        return {
            "ok": False,
            "esporte": "basketball",
            "liga": liga.upper(),
            "ano": ano,
            "time": time_norm.upper(),
            "path": str(path),
            "linhas": [],
            "message": "Arquivo do time não encontrado."
        }

    try:
        import pandas as pd

        df = pd.read_csv(path)

        if df.empty:
            return {
                "ok": True,
                "esporte": "basketball",
                "liga": liga.upper(),
                "ano": ano,
                "time": time_norm.upper(),
                "path": str(path),
                "linhas": [],
                "total_linhas": 0,
                "message": "Temporada criada, mas ainda sem jogos importados para este time."
            }

        ultimas = df.tail(limite).fillna("").to_dict(orient="records")

        return {
            "ok": True,
            "esporte": "basketball",
            "liga": liga.upper(),
            "ano": ano,
            "time": time_norm.upper(),
            "path": str(path),
            "linhas": ultimas,
            "total_linhas": len(df),
            "message": f"Últimas {min(limite, len(df))} linhas carregadas."
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao ler CSV Basketball: {str(e)}")


@app.post("/modelos/base/basketball/{liga}/{ano}/{time}/validar")
def validar_linha_basketball(liga: str, ano: int, time: str, payload: BasketballLinhaPayload):
    liga = _normalizar_basketball_liga(liga)

    linha = (payload.linha or "").strip()

    if not linha:
        raise HTTPException(status_code=400, detail="Linha vazia.")

    partes = _dividir_registros_basketball(linha)

    possui_basic = False
    possui_advanced = False

    detalhes = []

    for parte in partes:
        colunas = len(next(__import__("csv").reader([parte])))

        tipo = "desconhecido"

        if liga == "nba":
            if colunas >= 45:
                tipo = "basic"
                possui_basic = True
            elif colunas >= 25:
                tipo = "advanced"
                possui_advanced = True

        if liga == "wnba":
            if colunas >= 38:
                tipo = "basic"
                possui_basic = True
            elif colunas >= 25:
                tipo = "advanced"
                possui_advanced = True

        detalhes.append({
            "colunas": colunas,
            "tipo_estimado": tipo,
        })

    return {
        "ok": True,
        "esporte": "basketball",
        "liga": liga.upper(),
        "ano": ano,
        "time": time.upper(),
        "registros_identificados": len(partes),
        "possui_basic": possui_basic,
        "possui_advanced": possui_advanced,
        "detalhes": detalhes,
        "message": (
            "Formato parece válido para Basketball."
            if possui_basic or possui_advanced
            else "Não foi possível identificar basic/advanced."
        )
    }


@app.post("/modelos/base/basketball/{liga}/{ano}/{time}/adicionar")
def adicionar_linha_basketball(liga: str, ano: int, time: str, payload: BasketballLinhaPayload):
    liga = _normalizar_basketball_liga(liga)
    time_norm = _normalizar_time(time)

    linha = (payload.linha or "").strip()

    if not linha:
        raise HTTPException(status_code=400, detail="Linha vazia.")

    if not BASKETBALL_IMPORT_SCRIPT.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script de importação não encontrado: {BASKETBALL_IMPORT_SCRIPT}"
        )

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=f"_basketball_{liga}_{ano}_{time_norm}.txt",
        delete=False,
    ) as tmp:
        tmp.write(linha)
        tmp_path = tmp.name

    try:
        cmd = [
            sys.executable,
            str(BASKETBALL_IMPORT_SCRIPT),
            "--liga",
            liga,
            "--ano",
            str(ano),
            "--time",
            time_norm.upper(),
            "--arquivo",
            tmp_path,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )

        parsed = _parse_import_stdout(result.stdout or "")

        if result.returncode != 0:
            return {
                "ok": False,
                "esporte": "basketball",
                "liga": liga.upper(),
                "ano": ano,
                "time": time_norm.upper(),
                "cmd": " ".join(cmd),
                "stdout": result.stdout,
                "stderr": result.stderr,
                "message": "Erro ao adicionar linha Basketball."
            }

        return {
            "ok": True,
            "esporte": "basketball",
            "liga": liga.upper(),
            "ano": ano,
            "time": time_norm.upper(),
            "cmd": " ".join(cmd),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "parsed": parsed,
            "message": "Linha Basketball adicionada com sucesso."
        }

    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


@app.post("/modelos/base/basketball/{liga}/{ano}/{time}/remover-ultima")
def remover_ultima_linha_basketball(liga: str, ano: int, time: str):
    liga = _normalizar_basketball_liga(liga)
    time_norm = _normalizar_time(time)

    path = _basketball_file_path(liga, ano, time_norm)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Arquivo do time não encontrado: {path}"
        )

    try:
        import pandas as pd

        df = pd.read_csv(path)

        if df.empty:
            raise HTTPException(
                status_code=400,
                detail="O CSV não possui linhas de dados para remover."
            )

        backups_dir = _basketball_year_dir(liga, ano) / "backups_importacao"

        def _backup_arquivo_basketball(csv_path: Path):
            if not csv_path.exists():
                return None

            import shutil
            from datetime import datetime

            backups_dir.mkdir(parents=True, exist_ok=True)
            tag = datetime.now().strftime("%Y%m%d_%H%M%S")
            destino = backups_dir / f"{csv_path.stem}_backup_{tag}{csv_path.suffix}"
            shutil.copy2(csv_path, destino)
            return destino

        def _preencher_chaves_merge_legadas_api(df_base):
            if df_base.empty:
                return df_base

            df_base = df_base.copy()
            aliases = {
                "data": ["Date", "Date.1"],
                "adversario": ["Opp", "Opp.2"],
                "local": ["Unnamed: 3", "local"],
                "resultado": ["W/L", "W/L.1"],
                "pontos_time": ["Tm", "Tm.1"],
                "pontos_adversario": ["Opp.1", "Opp.3"],
            }

            for destino, fontes in aliases.items():
                if destino not in df_base.columns:
                    df_base[destino] = ""

                atual = df_base[destino].astype("string")
                vazio = df_base[destino].isna() | atual.fillna("").str.strip().eq("")

                for fonte in fontes:
                    if fonte not in df_base.columns:
                        continue

                    origem = df_base[fonte]
                    origem_txt = origem.astype("string")
                    tem_valor = origem.notna() & origem_txt.fillna("").str.strip().ne("")
                    mask_alias = vazio & tem_valor

                    if mask_alias.any():
                        df_base.loc[mask_alias, destino] = origem.loc[mask_alias].astype("string")
                        atual = df_base[destino].astype("string")
                        vazio = df_base[destino].isna() | atual.fillna("").str.strip().eq("")

            return df_base

        backup = _backup_arquivo_basketball(path)

        linha_removida = df.tail(1).fillna("").to_dict(orient="records")[0]
        df_restante = df.iloc[:-1].copy()
        df_restante.to_csv(path, index=False)

        arquivos_atualizados = [str(path)]
        backups = [str(backup)] if backup else []

        chaves = {
            "data": linha_removida.get("data") or linha_removida.get("Date") or linha_removida.get("Date.1"),
            "adversario": linha_removida.get("adversario") or linha_removida.get("Opp") or linha_removida.get("Opp.2"),
            "local": linha_removida.get("local") or linha_removida.get("Unnamed: 3"),
            "resultado": linha_removida.get("resultado") or linha_removida.get("W/L") or linha_removida.get("W/L.1"),
            "pontos_time": linha_removida.get("pontos_time") or linha_removida.get("Tm") or linha_removida.get("Tm.1"),
            "pontos_adversario": linha_removida.get("pontos_adversario") or linha_removida.get("Opp.1") or linha_removida.get("Opp.3"),
        }

        def _normalizar_chave(valor):
            if valor is None:
                return ""
            texto = str(valor).strip()
            if texto.endswith(".0"):
                texto = texto[:-2]
            return texto

        chaves = {k: _normalizar_chave(v) for k, v in chaves.items()}

        def _remover_correspondente(csv_path: Path):
            if not csv_path.exists() or not all(chaves.values()):
                return None

            df_base = pd.read_csv(csv_path)
            if df_base.empty:
                return None

            df_base = _preencher_chaves_merge_legadas_api(df_base)
            mask = pd.Series([True] * len(df_base), index=df_base.index)

            for coluna, valor in chaves.items():
                if coluna not in df_base.columns:
                    return None
                serie = df_base[coluna].astype("string").fillna("").str.strip().str.replace(r"\.0$", "", regex=True)
                mask = mask & serie.eq(valor)

            indices = df_base.index[mask].tolist()
            if not indices:
                return None

            backup_extra = _backup_arquivo_basketball(csv_path)
            df_base = df_base.drop(index=indices[-1])
            df_base.to_csv(csv_path, index=False)
            return {
                "arquivo": str(csv_path),
                "backup": str(backup_extra) if backup_extra else None,
            }

        basic_path = _basketball_year_dir(liga, ano) / "basic" / f"dados_base_{time_norm}.csv"
        advanced_path = _basketball_year_dir(liga, ano) / "advanced" / f"dados_avancados_{time_norm}.csv"

        for removido in [_remover_correspondente(basic_path), _remover_correspondente(advanced_path)]:
            if removido:
                arquivos_atualizados.append(removido["arquivo"])
                if removido.get("backup"):
                    backups.append(removido["backup"])

        return {
            "ok": True,
            "esporte": "basketball",
            "liga": liga.upper(),
            "ano": ano,
            "time": time_norm.upper(),
            "arquivo": str(path),
            "arquivos_atualizados": arquivos_atualizados,
            "backups": backups,
            "linha_removida": linha_removida,
            "total_linhas": len(df_restante),
            "message": "Última linha Basketball removida com sucesso."
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover linha Basketball: {str(e)}")


@app.post("/modelos/base/basketball/{liga}/{ano}/temporada")
def criar_temporada_basketball(liga: str, ano: int, payload: BasketballTemporadaPayload):
    """
    Endpoint aceitando a estrutura:
    /modelos/base/basketball/{liga}/{ano}/temporada

    O {ano} da URL é mantido por compatibilidade visual,
    mas o ano real criado é payload.ano_destino.
    """
    liga = _normalizar_basketball_liga(liga)

    ano_origem = int(payload.ano_origem)
    ano_destino = int(payload.ano_destino)

    if ano_destino < 2000 or ano_destino > 2100:
        raise HTTPException(status_code=400, detail="Ano destino inválido.")

    if ano_origem < 2000 or ano_origem > 2100:
        raise HTTPException(status_code=400, detail="Ano origem inválido.")

    if not BASKETBALL_INIT_SCRIPT.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script de inicialização não encontrado: {BASKETBALL_INIT_SCRIPT}"
        )

    cmd = [
        sys.executable,
        str(BASKETBALL_INIT_SCRIPT),
        "--liga",
        liga,
        "--ano-origem",
        str(ano_origem),
        "--ano-destino",
        str(ano_destino),
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        return {
            "ok": False,
            "esporte": "basketball",
            "liga": liga.upper(),
            "ano_origem": ano_origem,
            "ano_destino": ano_destino,
            "cmd": " ".join(cmd),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "message": "Erro ao criar temporada Basketball."
        }

    return {
        "ok": True,
        "esporte": "basketball",
        "liga": liga.upper(),
        "ano_origem": ano_origem,
        "ano_destino": ano_destino,
        "cmd": " ".join(cmd),
        "stdout": result.stdout,
        "stderr": result.stderr,
        "message": "Temporada Basketball criada/validada com sucesso."
    }
