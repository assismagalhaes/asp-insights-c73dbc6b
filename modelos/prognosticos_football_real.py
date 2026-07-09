# =========================
# Standard library imports
# =========================
import unicodedata
import difflib
import logging
import re
import io
from pathlib import Path
from datetime import datetime, date
from typing import List, Dict, Tuple, Optional
import warnings

# Silenciar FutureWarning (ex.: pandas) — escopo global, seguro
warnings.simplefilter("ignore", category=FutureWarning)

# =========================
# Third-party imports
# =========================
import pandas as pd
import numpy as np
import requests
from math import ceil
from scipy.stats import poisson, nbinom


# -------------------------------------------------------
# Configuração de logging (evita reconfigurar se já houver handlers)
# -------------------------------------------------------
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

# -------------------------------------------------------
# Constantes e parâmetros
# -------------------------------------------------------
DATA_REF = "14_06_2026"

# Pasta que aparece em:
# http://localhost:8888/lab/tree/OneDrive/APOSTAS%20ESPORTIVAS/FlashScore-Data
DATA_DIR = Path.cwd() / "FlashScore-Data"

MATCHES_JSON = DATA_DIR / f"{DATA_REF}_football.json"
MATCHES_CSV  = DATA_DIR / f"jogos_{DATA_REF}_football.csv"

# Pasta/arquivo de saída para importação no Lovable
# Modelo alinhado ao código da WNBA: CSV enxuto para importação direta.
LOVABLE_DIR = Path.cwd() / "Prognostico"
LOVABLE_DIR.mkdir(parents=True, exist_ok=True)
DATA_ARQUIVO = DATA_REF.replace("_", ".")
LOVABLE_CSV = LOVABLE_DIR / f"futebol_{DATA_ARQUIVO}.csv"

# Filtro padrão Lovable, igual ao modelo WNBA:
# odd ofertada precisa ser EV+, maior que 1.25 e no máximo 2.00.
MIN_ODD_EXPORT = 1.25
MAX_ODD_EXPORT = 2.00

# Aliases para compatibilidade com trechos antigos, caso sejam reutilizados.
PROGNOSTICO_DIR = LOVABLE_DIR
ARQ_PROGNOSTICOS_LOVABLE = LOVABLE_CSV
ODD_MINIMA_LOVABLE = MIN_ODD_EXPORT

LINHAS_OU = []  # definido dinamicamente no main()

# Range padrão (fallback / compat)
RANGE_GOLS_DEFAULT = range(0, 6)

# Controle do range dinâmico
GOALS_TAIL_EPS   = 1e-6   # tolerância para a probabilidade de cauda (fora do range)
GOALS_MIN_MAX    = 5      # garante pelo menos 0..5 (6 pontos)
GOALS_MAX_CAP    = 12     # limite superior (custo computacional); ajuste se quiser mais

# -------------------------------------------------------
# Pesos de Probabilidade
# -------------------------------------------------------
PROB_1X2_WEIGHTS = {"hist": 30, "pois": 30, "odds": 40}
PROB_OU_WEIGHTS = {"hist": 35, "pois": 35, "odds": 30}
PROB_BTTS_WEIGHTS = {"hist": 35, "pois": 35, "odds": 30}
PROB_HANDICAP_WEIGHTS_TRI = {"hist": 25, "pois": 40, "odds": 35}
PROB_HANDICAP_WEIGHTS = {"pois": 50, "odds": 50}

RPI_WEIGHTS       = {"passada": 0.20, "atual": 0.50, "recente": 0.30}
RPI_WEIGHTS_2     = {"atual": 0.65, "recente": 0.35}
METRICAS_WEIGHTS  = {"passada": 0.20, "atual": 0.50, "recente": 0.30}
METRICAS_WEIGHTS_2= {"atual": 0.65, "recente": 0.35}

# -------------------------------------------------------
# Funções de temporada (AUTOMATIZAÇÃO)
# -------------------------------------------------------
def parse_data_ref(data_ref: str) -> date:
    """
    DATA_REF no formato 'DD_MM_AAAA' -> datetime.date
    """
    dd, mm, yyyy = data_ref.split("_")
    return date(int(yyyy), int(mm), int(dd))

def normalize_season_str(s: str) -> str:
    """
    Normaliza season strings:
      - '25/26' -> '2025/2026'
      - '2025/26' -> '2025/2026'
      - '2025/2026' permanece
      - '2026' permanece
    """
    if s is None:
        return ""
    s = str(s).strip()

    # '25/26' -> '2025/2026'
    m = re.fullmatch(r"(\d{2})/(\d{2})", s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        # assume 20xx
        return f"20{a:02d}/20{b:02d}"

    # '2025/26' -> '2025/2026'
    m = re.fullmatch(r"(\d{4})/(\d{2})", s)
    if m:
        a = int(m.group(1))
        b = int(m.group(2))
        return f"{a}/20{b:02d}"

    # '2025/2026' já ok
    m = re.fullmatch(r"(\d{4})/(\d{4})", s)
    if m:
        return s

    # '2026' etc
    m = re.fullmatch(r"\d{4}", s)
    if m:
        return s

    return s

def build_season_context(ref_date: date, split_start_month: int = 7) -> dict:
    """
    Cria contexto de temporadas baseado na data de referência.

    - split_start_month: mês em que normalmente começa a temporada europeia (Julho=7, Agosto=8).
      Regra: se mês >= split_start_month, temporada split começa no próprio ano;
             se mês < split_start_month, temporada split começa no ano anterior.

    Ex: ref_date=08/02/2026 -> split_start_year=2025 -> current_split='2025/2026'
    """
    year = ref_date.year
    if ref_date.month >= split_start_month:
        split_start_year = year
    else:
        split_start_year = year - 1

    current_split = f"{split_start_year}/{split_start_year+1}"
    prev_split    = f"{split_start_year-1}/{split_start_year}"

    current_year  = f"{year}"
    prev_year     = f"{year-1}"

    current_seasons = {current_year, current_split}
    previous_seasons = {prev_year, prev_split}
    valid_seasons = current_seasons | previous_seasons

    season_code_current = f"{split_start_year % 100:02d}{(split_start_year+1) % 100:02d}"
    season_code_prev    = f"{(split_start_year-1) % 100:02d}{split_start_year % 100:02d}"

    return {
        "ref_date": ref_date,
        "split_start_month": split_start_month,
        "split_start_year": split_start_year,
        "current_split": current_split,
        "prev_split": prev_split,
        "current_year": current_year,
        "prev_year": prev_year,
        "CURRENT_SEASONS": current_seasons,
        "PREVIOUS_SEASONS": previous_seasons,
        "VALID_SEASONS": valid_seasons,
        "SEASON_CODE_CURRENT": season_code_current,
        "SEASON_CODE_PREVIOUS": season_code_prev,
    }

SEASON_CTX = build_season_context(parse_data_ref(DATA_REF), split_start_month=7)
CURRENT_SEASONS  = SEASON_CTX["CURRENT_SEASONS"]
PREVIOUS_SEASONS = SEASON_CTX["PREVIOUS_SEASONS"]
VALID_SEASONS    = SEASON_CTX["VALID_SEASONS"]

logging.info(
    f"Season context | DATA_REF={DATA_REF} | "
    f"CURRENT_SEASONS={sorted(CURRENT_SEASONS)} | PREVIOUS_SEASONS={sorted(PREVIOUS_SEASONS)} | "
    f"mmz_code_current={SEASON_CTX['SEASON_CODE_CURRENT']} | mmz_code_prev={SEASON_CTX['SEASON_CODE_PREVIOUS']}"
)

# -------------------------------------------------------
# Ligas "CURRENT/PREVIOUS" (mmz4281) agora via TEMPLATE + código automático
# -------------------------------------------------------
LEAGUES_MMZ_FILES = {
    "ENG - Premier League":      "E0.csv",
    "ENG - Championship":        "E1.csv",
    "SPA - La Liga":             "SP1.csv",
    "SPA - La Liga 2":           "SP2.csv",
    "GER - Bundesliga":          "D1.csv",
    "GER - 2. Bundesliga":       "D2.csv",
    "ITA - Serie A":             "I1.csv",
    "ITA - Serie B":             "I2.csv",
    "FRA - Ligue 1":             "F1.csv",
    "FRA - Ligue 2":             "F2.csv",
    "POR - Liga Portugal":       "P1.csv",
    "NED - Eredivisie":          "N1.csv",
    "BEL - Jupiler Pro League":  "B1.csv",
    "SCO - Premiership":         "SC0.csv",
    "SCO - Championship":        "SC1.csv",
    "TUR - Super Lig":           "T1.csv",
    "GRE - Super League":        "G1.csv",
}

def build_mmz_urls(season_code: str) -> Dict[str, str]:
    """
    Monta URLs mmz4281 automaticamente para o season_code (ex.: '2526').
    """
    base = "https://www.football-data.co.uk/mmz4281"
    return {liga: f"{base}/{season_code}/{fname}" for liga, fname in LEAGUES_MMZ_FILES.items()}

LEAGUES_CURRENT  = build_mmz_urls(SEASON_CTX["SEASON_CODE_CURRENT"])
LEAGUES_PREVIOUS = build_mmz_urls(SEASON_CTX["SEASON_CODE_PREVIOUS"])

# -------------------------------------------------------
# Ligas "EXTRA" (link fixo com histórico)
# -------------------------------------------------------
LEAGUES_EXTRA = {
    "BRA - Serie A Betano":   "https://www.football-data.co.uk/new/BRA.csv",
    "ARG - Torneo Betano":    "https://www.football-data.co.uk/new/ARG.csv",
    "DNK - Superliga":        "https://www.football-data.co.uk/new/DNK.csv",
    "NOR - Eliteserien":      "https://www.football-data.co.uk/new/NOR.csv",
    "POL - Ekstraklasa":      "https://www.football-data.co.uk/new/POL.csv",
    "ROU - Superliga":        "https://www.football-data.co.uk/new/ROU.csv",
    "SWE - Allsvenskan":      "https://www.football-data.co.uk/new/SWE.csv",
    "SWZ - Super League":     "https://www.football-data.co.uk/new/SWZ.csv",
    "USA - MLS":              "https://www.football-data.co.uk/new/USA.csv",
    "CHN - Super League":     "https://www.football-data.co.uk/new/CHN.csv",
    "MEX - Liga MX":          "https://www.football-data.co.uk/new/MEX.csv",
    "AUT - Bundesliga":       "https://www.football-data.co.uk/new/AUT.csv",
    "JPN - J1 League":        "https://www.football-data.co.uk/new/JPN.csv",
    "FIN - Veikkausliiga":    "https://www.football-data.co.uk/new/FIN.csv",
    "IRL - Premier Division": "https://www.football-data.co.uk/new/IRL.csv",
}

# -------------------------------------------------------
# Base de pesos por total de rodadas (cenário com 'passada','atual','recente')
# -------------------------------------------------------
_PESOS_TRI_BASE = {
    24: [
        {"rodadas": range(1, 5),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(5, 9),   "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(9, 13),  "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(13, 17), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(17, 21), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(21, 25), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    27: [
        {"rodadas": range(1, 6),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(6, 10),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(10, 15), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(15, 20), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(20, 24), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(24, 28), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    29: [
        {"rodadas": range(1, 6),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(6, 11),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(11, 16), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(16, 21), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(21, 26), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(26, 30), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    30: [
        {"rodadas": range(1, 6),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(6, 11),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(11, 16), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(16, 22), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(22, 27), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(27, 31), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    32: [
        {"rodadas": range(1, 6),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(6, 12),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(12, 17), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(17, 23), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(23, 28), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(28, 33), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    34: [
        {"rodadas": range(1, 7),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(7, 12),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(12, 18), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(18, 24), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(24, 29), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(29, 35), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    36: [
        {"rodadas": range(1, 7),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(7, 13),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(13, 19), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(19, 25), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(25, 31), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(31, 37), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    37: [
        {"rodadas": range(1, 6),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(6, 11),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(11, 16), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(16, 26), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(26, 31), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(31, 38), "passada": 0.01, "atual": 0.64, "recente": 0.35},
    ],
    38: [
        {"rodadas": range(1, 7),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(7, 13),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(13, 19), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(19, 26), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(26, 33), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(33, 39), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    39: [
        {"rodadas": range(1, 7),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(7, 14),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(14, 20), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(20, 27), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(27, 34), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(34, 40), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    40: [
        {"rodadas": range(1, 8),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(8, 14),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(14, 21), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(21, 28), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(28, 35), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(35, 41), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    42: [
        {"rodadas": range(1, 8),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(8, 15),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(15, 22), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(22, 29), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(29, 36), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(36, 43), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
    46: [
        {"rodadas": range(1, 9),   "passada": 0.60, "atual": 0.20, "recente": 0.20},
        {"rodadas": range(9, 17),  "passada": 0.40, "atual": 0.35, "recente": 0.25},
        {"rodadas": range(17, 25), "passada": 0.25, "atual": 0.45, "recente": 0.30},
        {"rodadas": range(25, 33), "passada": 0.10, "atual": 0.55, "recente": 0.35},
        {"rodadas": range(33, 41), "passada": 0.05, "atual": 0.60, "recente": 0.35},
        {"rodadas": range(41, 47), "passada": 0.00, "atual": 0.65, "recente": 0.35},
    ],
}

def _build_pesos_duplos(base_tri: dict) -> dict:
    out = {}
    for total, faixas in base_tri.items():
        com_passada = []
        sem_passada = []
        for f in faixas:
            com_passada.append({
                "rodadas": f["rodadas"],
                "passada": f["passada"],
                "atual":   f["atual"],
                "recente": f["recente"],
            })
            ar_sum = (f["atual"] + f["recente"])
            if ar_sum <= 0:
                a_norm, r_norm = 0.5, 0.5
            else:
                a_norm = f["atual"] / ar_sum
                r_norm = f["recente"] / ar_sum
            sem_passada.append({
                "rodadas": f["rodadas"],
                "atual":   round(a_norm, 4),
                "recente": round(r_norm, 4),
            })
        out[total] = {
            "com_passada": com_passada,
            "sem_passada": sem_passada,
        }
    return out

PESOS_POR_LIGA = _build_pesos_duplos(_PESOS_TRI_BASE)

# -------------------------------------------------------
# Liga → Total de rodadas
# -------------------------------------------------------
LEAGUE_TOTAL_ROUNDS = {
    "AUT - Bundesliga": 24,
    "FIN - Veikkausliiga": 27,
    "ARG - Torneo Betano": 29,
    "NOR - Eliteserien": 30, "SWE - Allsvenskan": 30, "CHN - Super League": 30,
    "GRE - Super League": 32, "DNK - Superliga": 32, "ROU - Superliga": 32,
    "GER - Bundesliga": 34, "GER - 2. Bundesliga": 34, "FRA - Ligue 1": 34,
    "POR - Liga Portugal": 34, "NED - Eredivisie": 34, "POL - Ekstraklasa": 34, "MEX - Liga MX": 34,
    "SWZ - Super League": 36, "IRL - Premier Division": 36,
    "ENG - Premier League": 38, "ENG - Championship": 38, "SPA - La Liga": 38,
    "ITA - Serie A": 38, "ITA - Serie B": 38, "FRA - Ligue 2": 38, "SCO - Premiership": 38,
    "TUR - Super Lig": 38, "BRA - Serie A Betano": 38, "JPN - J1 League": 38,
    "USA - MLS": 39, "BEL - Jupiler Pro League": 40, "SPA - La Liga 2": 42, "SCO - Championship": 46,
}

def infer_total_rodadas(nome_liga: str, default: int | None = None):
    return LEAGUE_TOTAL_ROUNDS.get(nome_liga, default)

def _get_faixa(lista_faixas: list, rodada_atual: int) -> dict:
    for faixa in lista_faixas:
        if int(rodada_atual) in faixa["rodadas"]:
            return faixa
    return lista_faixas[-1]

def get_weights_por_liga(nome_liga: str, rodada_atual: int, has_prev_season_data: bool = True) -> dict:
    total = infer_total_rodadas(nome_liga)
    if total is None:
        total = 34
    cen = "com_passada" if has_prev_season_data else "sem_passada"
    tabela = PESOS_POR_LIGA.get(int(total), PESOS_POR_LIGA[34])[cen]
    return _get_faixa(tabela, rodada_atual)

def get_metricas_weights(nome_liga: str, rodada_atual: int, has_prev_season_data: bool = True) -> dict:
    return get_weights_por_liga(nome_liga, rodada_atual, has_prev_season_data)

def get_rpi_weights(nome_liga: str, rodada_atual: int, has_prev_season_data: bool = True) -> dict:
    return get_weights_por_liga(nome_liga, rodada_atual, has_prev_season_data)

# -------------------------------------------------------
# Mapeamento País → Prefixo de Liga (para desambiguar nomes iguais)
# -------------------------------------------------------
country_to_code = {
    "england": "ENG", "scotland": "SCO", "spain": "SPA",
    "germany": "GER", "italy": "ITA", "portugal": "POR",
    "netherlands": "NED", "belgium": "BEL", "france": "FRA",
    "turkey": "TUR", "brazil": "BRA", "argentina": "ARG",
    "denmark": "DNK", "norway": "NOR", "poland": "POL",
    "romania": "ROU", "sweden": "SWE", "austria": "AUT",
    "usa": "USA", "china": "CHN", "mexico": "MEX",
    "japan": "JPN", "finland": "FIN", "ireland": "IRL",
    "greece": "GRE", "switzerland": "SWZ",
}

# -------------------------------------------------------
# Auxiliares comuns
# -------------------------------------------------------
def normalize_str(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s))
    s = s.encode("ASCII", "ignore").decode()
    return s.lower().strip()

def fuzzy_match(s: str, choices: list[str], cutoff: float = 0.20) -> str | None:
    best = difflib.get_close_matches(s, choices, n=1, cutoff=cutoff)
    return best[0] if best else None

def resolve_league_sem_pais(raw: str, league_lookup: dict[str, str]) -> str | None:
    if raw is None:
        return None
    s = normalize_str(raw)
    if s in league_lookup:
        return league_lookup[s]
    for low, real in league_lookup.items():
        if s in low or low in s:
            return real
    best = fuzzy_match(s, list(league_lookup.keys()))
    return league_lookup.get(best)

def resolve_league(raw: str, country: str, league_lookup: dict[str, str]) -> str | None:
    if raw is None:
        return None
    s = normalize_str(raw)
    code = country_to_code.get(normalize_str(country))
    if code:
        candidatos = {k: v for k, v in league_lookup.items() if v.upper().startswith(code)}
        if s in candidatos:
            return candidatos[s]
        best = fuzzy_match(s, list(candidatos.keys()))
        if best:
            return candidatos[best]
    return resolve_league_sem_pais(raw, league_lookup)

def _tokens(s: str) -> list[str]:
    s = normalize_str(s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    toks = [t for t in s.split() if t]
    stop = {"fc", "cf", "sc", "ac", "cd", "de", "y", "the", "club", "dep"}
    toks = [t for t in toks if t not in stop and len(t) >= 2]
    return toks

CLUB_STOPWORDS = {
    "fc","cf","sc","ac","cd","cp","ud","sd",
    "de","da","do","dos","das","e",
    "clube","club","futebol","football"
}

def club_tokens(name: str) -> list[str]:
    return [t for t in _tokens(name) if t not in CLUB_STOPWORDS]

def resolve_team_in_base_liga(raw_team: str, base_liga) -> str:
    """
    Resolve o nome do time do input para o nome EXATO existente em base_liga,
    priorizando:
      1) match exato normalizado
      2) aliases
      3) match por tokens (Dice coefficient)
      4) fuzzy fallback
    """
    if base_liga is None or getattr(base_liga, "empty", True):
        return raw_team

    teams = sorted(set(base_liga["HomeTeam"].dropna()).union(set(base_liga["AwayTeam"].dropna())))
    lookup = {normalize_str(t): t for t in teams}

    raw_norm = normalize_str(raw_team)
    logging.info(f"[debug] resolving: raw='{raw_team}' norm='{raw_norm}'")

    # 1) Match exato normalizado
    if raw_norm in lookup:
        resolved = lookup[raw_norm]
        logging.info(f"[debug] resolve exact -> '{resolved}'")
        return resolved

    # 2) Aliases (adicione os que você quiser aqui)
    ALIASES = {
        # --- PORTUGAL / football-data ---
        "sporting cp": [
            "sp lisbon",  # <- NOME REAL NO FOOTBALL-DATA
            "sporting",
            "sporting clube de portugal",
            "sporting lisbon",
        ],
        "sporting": [
            "sp lisbon",  # <- garante que "Sporting" também resolve
            "sporting cp",
            "sporting lisbon",
            "sporting clube de portugal",
        ],
        "manchester utd": [
            "man united",  
        ],
        "manchester city": [
            "man city",  
        ],
        "nottingham": [
            "nott'm forest",  
        ],
         "g.a. eagles": [
            "go ahead eagles",  
        ],
    
        # (opcional) Porto costuma estar OK como "Porto"
        "fc porto": ["porto", "f c porto", "porto fc"],
        "porto": ["porto", "fc porto"],
    }
    if raw_norm in ALIASES:
        for cand in ALIASES[raw_norm]:
            c = normalize_str(cand)
            if c in lookup:
                resolved = lookup[c]
                logging.info(f"[debug] resolve alias '{cand}' -> '{resolved}'")
                return resolved

    # 3) Match por tokens (bem robusto)
    rt = set(club_tokens(raw_team))
    if rt:
        best_team = None
        best_score = 0.0

        for t in teams:
            tt = set(club_tokens(t))
            if not tt:
                continue

            inter = len(rt & tt)
            # Dice coefficient: 2*|A∩B| / (|A|+|B|)
            score = (2.0 * inter) / (len(rt) + len(tt))

            if score > best_score:
                best_score = score
                best_team = t

        if best_team and best_score >= 0.70:
            logging.info(f"[debug] resolve tokens score={best_score:.3f} -> '{best_team}'")
            return best_team

    # 4) Fuzzy fallback
    import difflib
    best = difflib.get_close_matches(raw_norm, list(lookup.keys()), n=1, cutoff=0.78)
    if best:
        resolved = lookup[best[0]]
        logging.info(f"[debug] resolve fuzzy -> '{resolved}' (key='{best[0]}')")
        return resolved

    logging.warning(f"[debug] resolve failed: mantendo '{raw_team}'")
    return raw_team


def resolve_team_safe(
    raw: str,
    team_lookup: dict[str, str],
    *,
    cutoff: float = 0.86,
    min_margin: float = 0.06,
    min_token_overlap: float = 0.50,
) -> str | None:
    """
    Resolve nome do time com segurança:
    - exato -> ok
    - contém/substr -> só se for único
    - fuzzy -> score alto + margem p/ 2º
             + overlap de tokens (exceto casos 1-token bem parecidos)
    """
    if raw is None:
        return None

    s = normalize_str(raw)
    if not s:
        return None

    if s in team_lookup:
        return team_lookup[s]

    keys = list(team_lookup.keys())

    # substrings apenas se único
    sub_hits = [k for k in keys if (s in k) or (k in s)]
    if len(sub_hits) == 1:
        return team_lookup[sub_hits[0]]

    # fuzzy top2 p/ checar margem
    best2 = difflib.get_close_matches(s, keys, n=2, cutoff=cutoff)
    if not best2:
        return None

    best = best2[0]
    best_score = difflib.SequenceMatcher(None, s, best).ratio()
    second_score = difflib.SequenceMatcher(None, s, best2[1]).ratio() if len(best2) > 1 else 0.0

    if (best_score - second_score) < min_margin:
        return None

    raw_t = set(_tokens(raw))
    best_t = set(_tokens(best))

    # ✅ regra especial p/ nomes “de 1 token” (Espanyol/Espanol)
    # Se ambos têm 1 token, ignore overlap e confie no best_score alto
    if (len(raw_t) == 1) and (len(best_t) == 1):
        return team_lookup[best] if best_score >= 0.88 else None

    # multi-token: exige overlap
    if not raw_t or not best_t:
        return None

    overlap = len(raw_t & best_t) / max(len(raw_t), len(best_t))
    if overlap < min_token_overlap:
        return None

    return team_lookup.get(best)

# -------------------------------------------------------
# Carregamento de dados (corrigido e automatizado por temporada)
# -------------------------------------------------------
def _add_round_estimates(df: pd.DataFrame) -> pd.DataFrame:
    """
    Mantém seus contadores e calcula RodadaEstimada por jogos anteriores (casa+fora).
    """
    if df.empty:
        return df

    df = df.sort_values(["Liga", "Season", "Date", "HomeTeam", "AwayTeam"]).reset_index(drop=True)

    df["JogosAntes_Home"] = df.groupby(["Liga", "Season", "HomeTeam"]).cumcount()
    df["JogosAntes_Away"] = df.groupby(["Liga", "Season", "AwayTeam"]).cumcount()

    aux_home = df[["Liga", "Season", "Date", "HomeTeam"]].rename(columns={"HomeTeam": "Team"}).copy()
    aux_away = df[["Liga", "Season", "Date", "AwayTeam"]].rename(columns={"AwayTeam": "Team"}).copy()
    aux = pd.concat([aux_home, aux_away], ignore_index=True)
    aux = aux.sort_values(["Liga", "Season", "Team", "Date"]).reset_index(drop=True)
    aux["JogosAntes"] = aux.groupby(["Liga", "Season", "Team"]).cumcount()

    h = df[["Liga", "Season", "Date", "HomeTeam"]].merge(
        aux, left_on=["Liga", "Season", "Date", "HomeTeam"],
        right_on=["Liga", "Season", "Date", "Team"], how="left"
    )
    a = df[["Liga", "Season", "Date", "AwayTeam"]].merge(
        aux, left_on=["Liga", "Season", "Date", "AwayTeam"],
        right_on=["Liga", "Season", "Date", "Team"], how="left"
    )
    df["JogosAntes_HomeTotal"] = h["JogosAntes"].to_numpy()
    df["JogosAntes_AwayTotal"] = a["JogosAntes"].to_numpy()

    df["RodadaEstimada"] = df[["JogosAntes_HomeTotal", "JogosAntes_AwayTotal"]].max(axis=1) + 1
    return df

def carregar_dados_temporada(urls: dict[str, str], season_label: str) -> pd.DataFrame:
    """
    Para mmz4281: não existe coluna Season confiável -> setamos Season=season_label (ex.: '2025/2026').
    """
    sess, dfs = requests.Session(), []
    for liga, url in urls.items():
        try:
            r = sess.get(url, timeout=30)
            r.raise_for_status()
            tmp = pd.read_csv(
                io.StringIO(r.text),
                usecols=["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"]
            )
            tmp["Date"] = pd.to_datetime(tmp["Date"], dayfirst=True, errors="coerce")
            tmp["Season"] = normalize_season_str(season_label)
            tmp["Liga"] = liga
            dfs.append(tmp)
        except Exception as e:
            logging.warning(f"Falha ao baixar {liga} ({season_label}): {e}")

    if not dfs:
        return pd.DataFrame()

    df = pd.concat(dfs, ignore_index=True)
    df = _add_round_estimates(df)

    return df[[
        "Date","HomeTeam","AwayTeam","FTHG","FTAG","FTR","Season","Liga",
        "JogosAntes_Home","JogosAntes_Away",
        "JogosAntes_HomeTotal","JogosAntes_AwayTotal","RodadaEstimada"
    ]].copy()

def carregar_dados_liga(nome_liga: str, url_csv: str, valid_seasons: set[str]) -> pd.DataFrame:
    """
    Para /new/XXX.csv: geralmente há coluna Season, mas pode variar.
    Vamos ler de forma flexível e normalizar Season.
    """
    try:
        df = pd.read_csv(url_csv)

        # tenta resolver colunas (alguns arquivos têm schema diferente)
        # preferências:
        #  - Home/Away/HG/AG/Res/Season (como você usa)
        #  - HomeTeam/AwayTeam/FTHG/FTAG/FTR/Season (fallback)
        colmap = {}

        if set(["Home", "Away", "HG", "AG", "Res", "Season"]).issubset(df.columns):
            colmap = {"Home": "HomeTeam", "Away": "AwayTeam", "HG": "FTHG", "AG": "FTAG", "Res": "FTR"}
        elif set(["HomeTeam","AwayTeam","FTHG","FTAG","FTR","Season"]).issubset(df.columns):
            colmap = {}
        else:
            # tenta ao menos achar colunas principais
            raise ValueError(f"Schema inesperado em {nome_liga}. Colunas: {list(df.columns)[:20]}")

        if colmap:
            df = df.rename(columns=colmap)

        if "Date" not in df.columns:
            raise ValueError(f"Coluna Date não encontrada em {nome_liga}")
        df["Date"] = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")

        df["Season"] = df["Season"].astype(str).str.strip().apply(normalize_season_str)

        df = df[df["Season"].isin(set(map(str, valid_seasons)))].copy()
        df["Liga"] = nome_liga

        df = df[["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR", "Season", "Liga"]].copy()
        df = _add_round_estimates(df)

        return df[[
            "Date","HomeTeam","AwayTeam","FTHG","FTAG","FTR","Season","Liga",
            "JogosAntes_Home","JogosAntes_Away",
            "JogosAntes_HomeTotal","JogosAntes_AwayTotal","RodadaEstimada"
        ]].copy()

    except Exception as e:
        logging.warning(f"Falha ao carregar {nome_liga}: {e}")
        return pd.DataFrame()

# -------------------------------------------------------
# H2H Futebol (temporada atual + passada)
# -------------------------------------------------------
def gerar_h2h_football(
    base: pd.DataFrame,
    home: str,
    away: str,
    temporadas: Optional[Tuple[str, ...]] = None,
    n: int = 5,
) -> Tuple[pd.DataFrame, dict]:
    temporadas_sel = tuple(sorted(VALID_SEASONS)) if (temporadas is None) else tuple(temporadas)
    df = base.loc[base["Season"].isin(temporadas_sel)].copy()

    mask1 = (df["HomeTeam"] == home) & (df["AwayTeam"] == away)
    mask2 = (df["HomeTeam"] == away) & (df["AwayTeam"] == home)
    df_h2h_raw = df.loc[mask1 | mask2].copy()

    if df_h2h_raw.empty:
        return pd.DataFrame(), {
            "total_jogos": 0,
            "wins_home": 0,
            "wins_away": 0,
            "avg_goals_home": None,
            "avg_goals_away": None,
            "avg_total": None,
            "mensagem": "Sem H2H nas temporadas selecionadas.",
        }

    df_h2h_raw["Date"] = pd.to_datetime(df_h2h_raw["Date"], errors="coerce")
    df_h2h = (
        df_h2h_raw.sort_values("Date", ascending=False, kind="mergesort")
        .head(n)
        .reset_index(drop=True)
    )

    is_home = (df_h2h["HomeTeam"].values == home) & (df_h2h["AwayTeam"].values == away)
    goals_home = np.where(is_home, df_h2h["FTHG"].values, df_h2h["FTAG"].values)
    goals_away = np.where(is_home, df_h2h["FTAG"].values, df_h2h["FTHG"].values)
    venue = np.where(is_home, "Casa", "Fora")
    winner = np.where(goals_home > goals_away, home, np.where(goals_home < goals_away, away, None))
    margin = np.abs(goals_home - goals_away)

    df_out = pd.DataFrame({
        "season": df_h2h["Season"].values,
        "date": df_h2h["Date"].values,
        "home_abbr": np.full(len(df_h2h), home, dtype=object),
        "away_abbr": np.full(len(df_h2h), away, dtype=object),
        "home_venue": venue,
        "goals_home": goals_home,
        "goals_away": goals_away,
        "total_goals": goals_home + goals_away,
        "winner": winner,
        "margin": margin,
    })

    total = len(df_out)
    wins_home = int((df_out["winner"] == home).sum())
    wins_away = int((df_out["winner"] == away).sum())

    stats = {
        "total_jogos": total,
        "wins_home": wins_home,
        "wins_away": wins_away,
        "avg_goals_home": round(float(df_out["goals_home"].mean()), 2),
        "avg_goals_away": round(float(df_out["goals_away"].mean()), 2),
        "avg_total": round(float(df_out["total_goals"].mean()), 2),
        "mensagem": None,
    }
    return df_out, stats

# -------------------------------------------------------
# Últimos 5 jogos (home/away)
# -------------------------------------------------------
def get_last_games_football(base: pd.DataFrame, team: str, venue: str, n: int = 5) -> pd.DataFrame:
    df = base.copy()
    if "Date" not in df.columns:
        raise KeyError("Coluna de data não encontrada: precisa ter 'Date'.")
    df_loc = df.loc[df["HomeTeam"] == team] if venue == "home" else df.loc[df["AwayTeam"] == team]
    df_loc = df_loc.sort_values(by="Date", ascending=True, kind="mergesort")
    return df_loc.tail(n)

# -------------------------------------------------------
# Estatísticas, RPI e Poisson/NdB (auto por superdispersão)
# -------------------------------------------------------
OVERDISP_TOL = 0.10

def calcular_probabilidade_sem_vig(odds: dict[str, float]) -> dict[str, float]:
    inv = {k: 1.0 / v for k, v in odds.items() if v is not None and np.isfinite(v) and v > 0}
    total_inv = sum(inv.values())
    if total_inv <= 0:
        return {}
    return {k: round(p / total_inv * 100, 2) for k, p in inv.items()}

def process_jogos(df: pd.DataFrame, venue: str) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    if venue == "home":
        df.loc[:, "GF"] = df["FTHG"]
        df.loc[:, "GA"] = df["FTAG"]
        df.loc[:, "Result"] = df["FTR"].map({"H": "W", "D": "D"}).fillna("L")
    else:
        df.loc[:, "GF"] = df["FTAG"]
        df.loc[:, "GA"] = df["FTHG"]
        df.loc[:, "Result"] = df["FTR"].map({"A": "W", "D": "D"}).fillna("L")

    df.loc[:, "TotalGoals"] = df["FTHG"] + df["FTAG"]
    df.loc[:, "BTTS"] = np.where((df["FTHG"] > 0) & (df["FTAG"] > 0), "Yes", "No")
    return df

def obter_jogos_por_temporada(base: pd.DataFrame, team: str, venue: str,
                             current_seasons: set[str], previous_seasons: set[str]):
    if venue == "home":
        cur  = base[(base["HomeTeam"] == team) & (base["Season"].isin(current_seasons))].copy()
        prev = base[(base["HomeTeam"] == team) & (base["Season"].isin(previous_seasons))].copy()
    else:
        cur  = base[(base["AwayTeam"] == team) & (base["Season"].isin(current_seasons))].copy()
        prev = base[(base["AwayTeam"] == team) & (base["Season"].isin(previous_seasons))].copy()
    return process_jogos(cur, venue), process_jogos(prev, venue)

def calcular_wp_subset(team: str, df: pd.DataFrame) -> float:
    jogos = df[(df["HomeTeam"] == team) | (df["AwayTeam"] == team)]
    if jogos.empty:
        return 0.0
    vit = ((jogos["HomeTeam"] == team) & (jogos["FTR"] == "H")) | ((jogos["AwayTeam"] == team) & (jogos["FTR"] == "A"))
    emp = jogos["FTR"] == "D"
    return (vit.sum() + 0.5 * emp.sum()) / len(jogos)

def calcular_wp_ajustado_subset(op: str, idx: int, df: pd.DataFrame) -> float:
    jogos = df[(df["HomeTeam"] == op) | (df["AwayTeam"] == op)].drop(idx, errors="ignore")
    if jogos.empty:
        return 0.0
    vit = ((jogos["HomeTeam"] == op) & (jogos["FTR"] == "H")) | ((jogos["AwayTeam"] == op) & (jogos["FTR"] == "A"))
    emp = jogos["FTR"] == "D"
    return (vit.sum() + 0.5 * emp.sum()) / len(jogos)

def calcular_OWP_subset(team: str, df: pd.DataFrame) -> float:
    jogos = df[(df["HomeTeam"] == team) | (df["AwayTeam"] == team)]
    if jogos.empty:
        return 0.0
    vals = [
        calcular_wp_ajustado_subset(jogo["AwayTeam"] if jogo["HomeTeam"] == team else jogo["HomeTeam"], idx, df)
        for idx, jogo in jogos.iterrows()
    ]
    return float(np.mean(vals)) if len(vals) else 0.0

def calcular_OOWP_subset(team: str, df: pd.DataFrame) -> float:
    adversarios = {
        jogo["AwayTeam"] if jogo["HomeTeam"] == team else jogo["HomeTeam"]
        for _, jogo in df[(df["HomeTeam"] == team) | (df["AwayTeam"] == team)].iterrows()
    }
    if not adversarios:
        return 0.0
    return float(np.mean([calcular_OWP_subset(a, df) for a in adversarios]))

def calcular_RPI_conventional_subset(team: str, df: pd.DataFrame) -> float:
    wp = calcular_wp_subset(team, df)
    owp = calcular_OWP_subset(team, df)
    oowp = calcular_OOWP_subset(team, df)
    return round(0.25 * wp + 0.50 * owp + 0.25 * oowp, 3)

def calcular_RPI_segmentado(
    team: str,
    atual: pd.DataFrame,
    passada: pd.DataFrame,
    nome_liga: str | None = None,
    rodada_atual: int | None = None,
):
    rpi_p = None if passada.empty else calcular_RPI_conventional_subset(team, passada)
    rpi_a = calcular_RPI_conventional_subset(team, atual)

    if atual.empty:
        rpi_u = 0.0
    else:
        jogos_time = atual[(atual["HomeTeam"] == team) | (atual["AwayTeam"] == team)].copy()
        jogos_time = jogos_time.sort_values("Date")
        ultimos_ids = jogos_time.tail(5).index
        atual_recent = atual.loc[ultimos_ids]
        rpi_u = calcular_RPI_conventional_subset(team, atual_recent) if not atual_recent.empty else 0.0

    if (nome_liga is not None) and (rodada_atual is not None):
        if rpi_p is None:
            w = get_rpi_weights(nome_liga, int(rodada_atual), has_prev_season_data=False)
            rpi_final = round(w["atual"] * rpi_a + w["recente"] * rpi_u, 3)
        else:
            w = get_rpi_weights(nome_liga, int(rodada_atual), has_prev_season_data=True)
            rpi_final = round(w["passada"] * rpi_p + w["atual"] * rpi_a + w["recente"] * rpi_u, 3)
    else:
        if rpi_p is None:
            rpi_final = round(RPI_WEIGHTS_2["atual"] * rpi_a + RPI_WEIGHTS_2["recente"] * rpi_u, 3)
        else:
            rpi_final = round(
                RPI_WEIGHTS["passada"] * rpi_p +
                RPI_WEIGHTS["atual"]   * rpi_a +
                RPI_WEIGHTS["recente"] * rpi_u, 3
            )

    return rpi_p, rpi_a, rpi_u, rpi_final

def gerar_estatisticas_comparadas(
    atual: pd.DataFrame,
    passada: pd.DataFrame,
    venue: str,
    nome_liga: str | None = None,
    rodada_atual: int | None = None,
):
    hist = process_jogos(passada.copy(), venue)
    cur  = process_jogos(atual.copy(), venue)
    last = cur.tail(5)

    def calc(df: pd.DataFrame) -> dict[str, float]:
        if df.empty:
            return {}
        d = {
            "Gols Marcados (média)": df["GF"].mean(),
            "Gols Sofridos (média)": df["GA"].mean(),
            "Vitórias (%)":           df["Result"].eq("W").mean() * 100,
            "Empates (%)":            df["Result"].eq("D").mean() * 100,
            "Ambas Marcam - Sim (%)": df["BTTS"].eq("Yes").mean() * 100,
            "Ambas Marcam - Não (%)": df["BTTS"].eq("No").mean() * 100,
        }
        for l in LINHAS_OU:
            d[f"Over {l} (%)"]  = df["TotalGoals"].gt(l).mean() * 100
            d[f"Under {l} (%)"] = df["TotalGoals"].le(l).mean() * 100
        return {k: round(float(v), 2) for k, v in d.items()}

    h = calc(hist)
    c = calc(cur)
    l = calc(last)

    if (nome_liga is not None) and (rodada_atual is not None):
        if h:
            w = get_metricas_weights(nome_liga, int(rodada_atual), has_prev_season_data=True)
            final = {f"{k} (Final)": round(w["passada"] * h[k] + w["atual"] * c[k] + w["recente"] * l[k], 2) for k in h}
        else:
            w = get_metricas_weights(nome_liga, int(rodada_atual), has_prev_season_data=False)
            final = {f"{k} (Final)": round(w["atual"] * c[k] + w["recente"] * l[k], 2) for k in c}
    else:
        if h:
            final = {
                f"{k} (Final)": round(
                    METRICAS_WEIGHTS["passada"] * h[k] +
                    METRICAS_WEIGHTS["atual"]   * c[k] +
                    METRICAS_WEIGHTS["recente"] * l[k], 2
                )
                for k in h
            }
        else:
            final = {
                f"{k} (Final)": round(
                    METRICAS_WEIGHTS_2["atual"]   * c[k] +
                    METRICAS_WEIGHTS_2["recente"] * l[k], 2
                )
                for k in c
            }

    out = {}
    for src, tag in [(h, "(Temporada passada)"), (c, "(Temporada atual)"), (l, "(últimos 5)")]:
        for k, v in src.items():
            out[f"{k} {tag}"] = v
    out.update(final)
    return out

# -------------------------------------------------------
# Handicap histórico
# -------------------------------------------------------
def _coverage_handicap(df_proc: pd.DataFrame, h: float) -> float | None:
    if df_proc.empty or ("GF" not in df_proc.columns) or ("GA" not in df_proc.columns):
        return None
    diff = df_proc["GF"] - df_proc["GA"]
    if h < 0:
        covered = (diff > abs(h))
    else:
        covered = (diff >= -h)
    return float(covered.mean() * 100) if len(df_proc) else None

def historico_handicap_weighted(
    atual_proc: pd.DataFrame,
    passada_proc: pd.DataFrame,
    h: float,
    nome_liga: str | None,
    rodada_atual: int | None,
) -> float | None:
    cur = atual_proc
    last = cur.tail(5) if not cur.empty else cur
    hist = passada_proc

    c_cov = _coverage_handicap(cur, h)
    l_cov = _coverage_handicap(last, h)
    p_cov = _coverage_handicap(hist, h) if not hist.empty else None

    if (c_cov is None) and (l_cov is None) and (p_cov is None):
        return None

    if (nome_liga is not None) and (rodada_atual is not None):
        if p_cov is not None:
            w = get_metricas_weights(nome_liga, int(rodada_atual), has_prev_season_data=True)
            return round(w["passada"] * p_cov + w["atual"] * (c_cov or 0) + w["recente"] * (l_cov or 0), 2)
        else:
            w = get_metricas_weights(nome_liga, int(rodada_atual), has_prev_season_data=False)
            return round(w["atual"] * (c_cov or 0) + w["recente"] * (l_cov or 0), 2)

    if p_cov is not None:
        return round(
            METRICAS_WEIGHTS["passada"] * p_cov +
            METRICAS_WEIGHTS["atual"]   * (c_cov or 0) +
            METRICAS_WEIGHTS["recente"] * (l_cov or 0), 2
        )
    else:
        return round(
            METRICAS_WEIGHTS_2["atual"]   * (c_cov or 0) +
            METRICAS_WEIGHTS_2["recente"] * (l_cov or 0), 2
        )

# -------------------------------------------------------
# Poisson x NegBin (auto)
# -------------------------------------------------------
def _nbinom_params_from_mean_var(mu: float, var: float) -> Tuple[float, float]:
    denom = max(var - mu, 1e-9)
    r = max((mu * mu) / denom, 1e-9)
    p = r / (r + mu)
    p = min(max(p, 1e-9), 1 - 1e-9)
    return r, p

def _dist_from_mu_var(mu: float, var: float | None, method: str):
    use_nb = False
    if method == "nbinom" and var is not None:
        use_nb = True
    elif method == "auto" and (var is not None) and (var > mu * (1 + OVERDISP_TOL)):
        use_nb = True

    if use_nb:
        r, p = _nbinom_params_from_mean_var(mu, var if var is not None else mu)
        return nbinom(n=r, p=p)
    return poisson(mu)

def construir_range_gols(
    mu_c: float,
    mu_f: float,
    var_c: float | None = None,
    var_f: float | None = None,
    method: str = "auto",
    eps: float = GOALS_TAIL_EPS,
    min_max: int = GOALS_MIN_MAX,
    max_cap: int = GOALS_MAX_CAP,
    linhas_ou: list[float] | None = None,
) -> range:
    kmin = min_max
    if linhas_ou:
        max_line = max(linhas_ou)
        kmin = max(kmin, int(ceil(max_line)) + 2)

    def k_max_for_one_side(mu: float, var: float | None) -> int:
        if mu <= 0:
            return kmin
        dist = _dist_from_mu_var(mu, var, method)
        try:
            q = dist.ppf(1 - eps)
            if not np.isfinite(q):
                q = kmin
            k = int(ceil(q))
        except Exception:
            k = kmin

        k = max(k, kmin)
        k = min(k, max_cap)

        while k < max_cap and (1.0 - float(dist.cdf(k)) > eps):
            k += 1
        return k

    k_home = k_max_for_one_side(mu_c, var_c)
    k_away = k_max_for_one_side(mu_f, var_f)

    k_max = max(k_home, k_away, kmin)
    k_max = min(k_max, max_cap)
    return range(0, k_max + 1)

def pmf_gols(mu: float, var: float | None = None, method: str = "auto", range_gols: range | None = None) -> np.ndarray:
    rg = range_gols if range_gols is not None else RANGE_GOLS_DEFAULT
    k = np.fromiter(rg, dtype=int)

    use_nb = False
    if method == "nbinom" and var is not None:
        use_nb = True
    elif method == "auto" and (var is not None) and (var > mu * (1 + OVERDISP_TOL)):
        use_nb = True

    if use_nb:
        r, p = _nbinom_params_from_mean_var(mu, var)
        return nbinom.pmf(k, n=r, p=p).astype(float)

    return poisson.pmf(k, mu).astype(float)

def gerar_matriz_gols(m_c: float, m_f: float, var_c: float | None = None, var_f: float | None = None,
                      method: str = "auto", range_gols: range | None = None) -> pd.DataFrame:
    rg = range_gols if range_gols is not None else RANGE_GOLS_DEFAULT
    pmf_c = pmf_gols(m_c, var_c, method=method, range_gols=rg)
    pmf_f = pmf_gols(m_f, var_f, method=method, range_gols=rg)
    M = np.outer(pmf_c, pmf_f)
    return pd.DataFrame(M, index=rg, columns=rg, dtype=float)

def gerar_matriz_poisson(m_c: float, m_f: float, var_c: float | None = None, var_f: float | None = None,
                         method: str = "auto", range_gols: range | None = None) -> pd.DataFrame:
    rg = range_gols if range_gols is not None else RANGE_GOLS_DEFAULT
    if var_c is None and var_f is None and method == "auto":
        i = np.fromiter(rg, dtype=float)
        pmf_c = poisson.pmf(i, m_c)
        pmf_f = poisson.pmf(i, m_f)
        M = np.outer(pmf_c, pmf_f)
        return pd.DataFrame(M, index=rg, columns=rg, dtype=float)
    return gerar_matriz_gols(m_c, m_f, var_c=var_c, var_f=var_f, method=method, range_gols=rg)

def probabilidades_poisson(M: pd.DataFrame) -> dict:
    vals = M.values
    tot = vals.sum()
    if tot <= 0:
        return {
            "Resultado": {"Casa": 0.0, "Empate": 0.0, "Fora": 0.0},
            "OverUnder": {l: {"Over": 0.0, "Under": 0.0} for l in LINHAS_OU},
            "BTTS": {"Yes": 0.0, "No": 0.0},
        }

    h_goals = M.index.to_numpy(dtype=int)
    a_goals = M.columns.to_numpy(dtype=int)
    H, A = np.meshgrid(h_goals, a_goals, indexing="ij")

    home = vals[H > A].sum() / tot * 100
    draw = vals[H == A].sum() / tot * 100
    away = vals[H < A].sum() / tot * 100

    ou = {
        l: {
            "Over":  round(vals[(H + A) > l].sum() / tot * 100, 2),
            "Under": round(vals[(H + A) <= l].sum() / tot * 100, 2),
        }
        for l in LINHAS_OU
    }

    b_s = round(vals[(H > 0) & (A > 0)].sum() / tot * 100, 2)

    return {
        "Resultado": {"Casa": round(home, 2), "Empate": round(draw, 2), "Fora": round(away, 2)},
        "OverUnder": ou,
        "BTTS": {"Yes": b_s, "No": round(100 - b_s, 2)},
    }

def combinar_probabilidades(hist: dict, pois: dict, odds: dict, pesos: dict) -> dict:
    return {
        k: round((hist[k] * pesos["hist"] + pois[k] * pesos["pois"] + odds[k] * pesos["odds"]) / 100, 2)
        for k in hist
    }

# -------------------------------------------------------
# Standings (limpeza + desempate H2H para grupos)
# -------------------------------------------------------
def generate_standings(matches_df: pd.DataFrame) -> pd.DataFrame:
    teams = pd.unique(matches_df[["HomeTeam", "AwayTeam"]].values.ravel())
    stats = {
        t: {"Played": 0, "Wins": 0, "Draws": 0, "Losses": 0, "GF": 0, "GA": 0, "Points": 0}
        for t in teams
    }

    for _, row in matches_df.iterrows():
        h, a = row["HomeTeam"], row["AwayTeam"]
        hg, ag = int(row["FTHG"]), int(row["FTAG"])
        stats[h]["Played"] += 1
        stats[a]["Played"] += 1
        stats[h]["GF"] += hg
        stats[h]["GA"] += ag
        stats[a]["GF"] += ag
        stats[a]["GA"] += hg

        if hg > ag:
            stats[h]["Wins"] += 1
            stats[h]["Points"] += 3
            stats[a]["Losses"] += 1
        elif hg < ag:
            stats[a]["Wins"] += 1
            stats[a]["Points"] += 3
            stats[h]["Losses"] += 1
        else:
            stats[h]["Draws"] += 1
            stats[a]["Draws"] += 1
            stats[h]["Points"] += 1
            stats[a]["Points"] += 1

    table = pd.DataFrame.from_dict(stats, orient="index")
    table.index.name = "Team"
    table["GD"] = table["GF"] - table["GA"]

    # Ordena por pontos primeiro, desempates depois
    table = table.sort_values(by=["Points", "GD", "GF"], ascending=False)

    def apply_head2head(grp: pd.DataFrame) -> pd.DataFrame:
        teams_grp = grp.index.tolist()
        direct = matches_df[
            matches_df["HomeTeam"].isin(teams_grp) & matches_df["AwayTeam"].isin(teams_grp)
        ].copy()

        if direct.empty:
            return grp.sort_values(by=["GD", "GF"], ascending=False)

        h2h = {t: {"H2H_Pts": 0, "H2H_GF": 0, "H2H_GA": 0} for t in teams_grp}

        for _, m in direct.iterrows():
            ht, at = m["HomeTeam"], m["AwayTeam"]
            hg, ag = int(m["FTHG"]), int(m["FTAG"])

            h2h[ht]["H2H_GF"] += hg
            h2h[ht]["H2H_GA"] += ag
            h2h[at]["H2H_GF"] += ag
            h2h[at]["H2H_GA"] += hg

            if hg > ag:
                h2h[ht]["H2H_Pts"] += 3
            elif hg < ag:
                h2h[at]["H2H_Pts"] += 3
            else:
                h2h[ht]["H2H_Pts"] += 1
                h2h[at]["H2H_Pts"] += 1

        grp = grp.copy()
        grp["H2H_Pts"] = [h2h[t]["H2H_Pts"] for t in grp.index]
        grp["H2H_GD"]  = [h2h[t]["H2H_GF"] - h2h[t]["H2H_GA"] for t in grp.index]
        grp["H2H_GF"]  = [h2h[t]["H2H_GF"] for t in grp.index]

        return grp.sort_values(
            by=["H2H_Pts", "H2H_GD", "H2H_GF", "GD", "GF"],
            ascending=False
        ).drop(columns=["H2H_Pts", "H2H_GD", "H2H_GF"])

    parts = []
    for pts, grp in table.groupby("Points", sort=False):
        parts.append(apply_head2head(grp) if len(grp) > 1 else grp)

    standings = pd.concat(parts).reset_index()
    return standings

# -------------------------------------------------------
# Análise de uma partida (ajustada para temporadas dinâmicas)
# -------------------------------------------------------
def analyze_match(
    base: pd.DataFrame,
    home_team: str,
    away_team: str,
    kickoff_date: str,
    kickoff_time: str,
    league_key: str,
    odds_full_time: dict[str, float],
    odds_ou: dict[float, dict[str, float]],
    odds_bt: dict[str, float],
    odds_double_chance: dict[str, float],
    odds_handicap: dict[str, dict[float, float]],
    current_seasons: set[str] = CURRENT_SEASONS,
    previous_seasons: set[str] = PREVIOUS_SEASONS,
) -> dict:
    base_liga = base.loc[base["Liga"] == league_key].copy()
    home_raw, away_raw = home_team, away_team
    
    home_team = resolve_team_in_base_liga(home_raw, base_liga)
    away_team = resolve_team_in_base_liga(away_raw, base_liga)
    
    logging.info(f"[debug] resolved names: '{home_raw}' -> '{home_team}' | '{away_raw}' -> '{away_team}'")

    
    def _count_team(df: pd.DataFrame, team: str) -> int:
        if df is None or df.empty:
            return 0
        return int(((df["HomeTeam"] == team) | (df["AwayTeam"] == team)).sum())

    logging.info(
        f"[debug] contagem na base_liga: {home_team}={_count_team(base_liga, home_team)} | "
        f"{away_team}={_count_team(base_liga, away_team)}"
    )

    kickoff_date = str(kickoff_date).strip() if kickoff_date is not None else ""
    kickoff_time = str(kickoff_time).strip() if kickoff_time is not None else ""
    dt_kick = pd.to_datetime(f"{kickoff_date} {kickoff_time}", format="%Y-%m-%d %H:%M", errors="coerce")

    last5_home = get_last_games_football(base_liga, home_team, "home", n=5)
    last5_away = get_last_games_football(base_liga, away_team, "away", n=5)

    df_h2h, h2h_stats = gerar_h2h_football(base_liga, home_team, away_team)

    ja, jp   = obter_jogos_por_temporada(base_liga, home_team, "home", current_seasons, previous_seasons)
    ja2, jp2 = obter_jogos_por_temporada(base_liga, away_team, "away", current_seasons, previous_seasons)

    # Rodada estimada
    rodada_atual = 1
    try:
        df_liga = base_liga.copy()
        df_liga["Date"] = pd.to_datetime(df_liga["Date"], errors="coerce")

        def _rodada_para(time_name: str) -> int:
            if pd.isna(dt_kick):
                return 1
            kick_date = dt_kick.date()
            df_prev = df_liga.loc[
                ((df_liga["HomeTeam"] == time_name) | (df_liga["AwayTeam"] == time_name)) &
                (df_liga["Date"].dt.date < kick_date)
            ].sort_values("Date")
            if df_prev.empty:
                return 1
            if "RodadaEstimada" in df_prev.columns:
                return int(df_prev["RodadaEstimada"].iloc[-1]) + 1
            last_season = df_prev["Season"].iloc[-1]
            jogs = df_prev.loc[df_prev["Season"] == last_season]
            return int(len(jogs)) + 1

        rodada_home = _rodada_para(home_team)
        rodada_away = _rodada_para(away_team)
        rodada_atual = max(rodada_home, rodada_away)
    except Exception:
        pass

    warnings_list = []
    if jp.empty:
        msg = f"⚠️ Atenção: {home_team} não contempla dados da temporada passada."
        logging.warning(msg)
        warnings_list.append(msg)
    if jp2.empty:
        msg = f"⚠️ Atenção: {away_team} não contempla dados da temporada passada."
        logging.warning(msg)
        warnings_list.append(msg)

    df_liga_all = base.loc[base["Liga"] == league_key].copy()
    df_liga_all["Date"] = pd.to_datetime(df_liga_all["Date"], errors="coerce")

    liga_atual_df   = df_liga_all[df_liga_all["Season"].isin(current_seasons)].copy()
    liga_passada_df = df_liga_all[df_liga_all["Season"].isin(previous_seasons)].copy()

    s1 = gerar_estatisticas_comparadas(ja,  jp,  "home", nome_liga=league_key, rodada_atual=rodada_atual)
    s2 = gerar_estatisticas_comparadas(ja2, jp2, "away", nome_liga=league_key, rodada_atual=rodada_atual)

    required_keys = [
        "Gols Marcados (média) (Final)",
        "Gols Sofridos (média) (Final)",
        "Vitórias (%) (Final)",
        "Empates (%) (Final)",
        "Ambas Marcam - Sim (%) (Final)",
        "Ambas Marcam - Não (%) (Final)",
    ]
    for l in LINHAS_OU:
        required_keys += [f"Over {l} (%) (Final)", f"Under {l} (%) (Final)"]
        
    def _count_team(df: pd.DataFrame, team: str) -> int:
        return int(((df['HomeTeam'] == team) | (df['AwayTeam'] == team)).sum()) if not df.empty else 0
    
    c_home = _count_team(base_liga, home_team)
    c_away = _count_team(base_liga, away_team)
    logging.info(f"[debug] base_liga team counts: {home_team}={c_home} | {away_team}={c_away} | liga={league_key}")
    logging.info(f"[debug] ja={len(ja)} jp={len(jp)} | ja2={len(ja2)} jp2={len(jp2)}")

    missing_s1 = [k for k in required_keys if k not in s1]
    missing_s2 = [k for k in required_keys if k not in s2]
    if missing_s1 or missing_s2:
        msg = (
            f"Sem dados suficientes para análise de {home_team} vs {away_team} "
            f"({league_key}). Missing s1={missing_s1[:6]} Missing s2={missing_s2[:6]}"
        )
        logging.warning(msg)
        raise ValueError(msg)

    gf1, ga1 = s1["Gols Marcados (média) (Final)"], s1["Gols Sofridos (média) (Final)"]
    gf2, ga2 = s2["Gols Marcados (média) (Final)"], s2["Gols Sofridos (média) (Final)"]
    m_c, m_f = (gf1 + ga2) / 2, (gf2 + ga1) / 2

    base_liga_prior = base_liga.copy()
    if "Date" in base_liga_prior.columns:
        base_liga_prior["Date"] = pd.to_datetime(base_liga_prior["Date"], errors="coerce")
        if pd.notna(dt_kick):
            base_liga_prior = base_liga_prior.loc[base_liga_prior["Date"] < dt_kick]

    league_avg_home_goals = float(base_liga_prior["FTHG"].mean()) if (not base_liga_prior.empty and "FTHG" in base_liga_prior) else np.nan
    league_avg_away_goals = float(base_liga_prior["FTAG"].mean()) if (not base_liga_prior.empty and "FTAG" in base_liga_prior) else np.nan
    sample_home = int(len(ja) + len(jp))
    sample_away = int(len(ja2) + len(jp2))
    sample_league = int(len(base_liga_prior))

    def _var_recent(df_proc: pd.DataFrame, n: int = 5) -> float:
        if df_proc.empty or "GF" not in df_proc:
            return 0.0
        s = df_proc["GF"].tail(n)
        return float(s.var(ddof=1)) if s.size >= 2 else 0.0

    var_c = _var_recent(ja,  n=5)
    var_f = _var_recent(ja2, n=5)

    diff_gols_home = gf1 - ga1
    diff_gols_away = gf2 - ga2
    delta_diff_gols = round(diff_gols_home - diff_gols_away, 2)

    p_ft_raw = calcular_probabilidade_sem_vig(odds_full_time)
    p_ft = {
        "Casa":   p_ft_raw.get("home", 0),
        "Empate": p_ft_raw.get("draw", 0),
        "Fora":   p_ft_raw.get("away", 0),
    }

    p_ou_raw = {l: calcular_probabilidade_sem_vig(ou) for l, ou in odds_ou.items()}
    p_ou = {
        l: {"Over": p_ou_raw[l].get("over", 0), "Under": p_ou_raw[l].get("under", 0)}
        for l in p_ou_raw
    }

    p_bt_raw = calcular_probabilidade_sem_vig(odds_bt)
    p_bt = {"Yes": p_bt_raw.get("yes", 0), "No": p_bt_raw.get("no", 0)}

    rg = construir_range_gols(
        m_c, m_f,
        var_c=var_c, var_f=var_f,
        method="auto",
        eps=GOALS_TAIL_EPS,
        min_max=GOALS_MIN_MAX,
        max_cap=GOALS_MAX_CAP,
        linhas_ou=LINHAS_OU if isinstance(LINHAS_OU, list) and len(LINHAS_OU) else None
    )
    M = gerar_matriz_poisson(m_c, m_f, var_c=var_c, var_f=var_f, method="auto", range_gols=rg)
    pm = probabilidades_poisson(M)

    range_used = list(rg)
    score_matrix_probability_sum = float(M.values.sum())
    score_matrix_tail_mass = max(0.0, 1.0 - score_matrix_probability_sum)
    score_matrix_normalized = abs(score_matrix_probability_sum - 1.0) > 1e-9
    overdispersion_home = float(var_c / m_c) if m_c else np.nan
    overdispersion_away = float(var_f / m_f) if m_f else np.nan
    overdispersion_ratio = np.nanmax([overdispersion_home, overdispersion_away])

    _total = (
        M.stack()
        .rename("p")
        .reset_index()
        .assign(total_goals=lambda d: d["level_0"] + d["level_1"])
        .groupby("total_goals", as_index=True)["p"].sum()
    )
    total_goals_pmf = {int(k): float(v * 100.0) for k, v in _total.items()}

    _, _, _, rpi_home = calcular_RPI_segmentado(home_team, liga_atual_df, liga_passada_df, nome_liga=league_key, rodada_atual=rodada_atual)
    _, _, _, rpi_away = calcular_RPI_segmentado(away_team, liga_atual_df, liga_passada_df, nome_liga=league_key, rodada_atual=rodada_atual)
    delta_rpi = round(rpi_home - rpi_away, 3)

    ph_hist = {
        "Casa": s1["Vitórias (%) (Final)"],
        "Empate": (s1["Empates (%) (Final)"] + s2["Empates (%) (Final)"]) / 2,
        "Fora": s2["Vitórias (%) (Final)"],
    }
    raw_1x2 = combinar_probabilidades(ph_hist, pm["Resultado"], p_ft, PROB_1X2_WEIGHTS)
    p_final = {k: round(v, 2) for k, v in raw_1x2.items()}
    val_h = _safe_odd_value(p_final["Casa"])
    val_x = _safe_odd_value(p_final["Empate"])
    val_a = _safe_odd_value(p_final["Fora"])

    raw_dc = {
        "1X": round(p_final["Casa"] + p_final["Empate"], 2),
        "12": round(p_final["Casa"] + p_final["Fora"], 2),
        "X2": round(p_final["Empate"] + p_final["Fora"], 2),
    }
    dc_adj = {k: round(v, 2) for k, v in raw_dc.items()}
    prob_1X, prob_12, prob_X2 = dc_adj["1X"], dc_adj["12"], dc_adj["X2"]
    val_1X = _safe_odd_value(prob_1X)
    val_12 = _safe_odd_value(prob_12)
    val_X2 = _safe_odd_value(prob_X2)

    ou_adj = {}
    for l, odds_line in odds_ou.items():
        hist_vals = {
            "Over":  (s1[f"Over {l} (%) (Final)"]  + s2[f"Over {l} (%) (Final)"])  / 2,
            "Under": (s1[f"Under {l} (%) (Final)"] + s2[f"Under {l} (%) (Final)"]) / 2,
        }
        pois_vals = pm["OverUnder"][l]
        impl_vals = p_ou[l]
        raw_ou = combinar_probabilidades(hist_vals, pois_vals, impl_vals, PROB_OU_WEIGHTS)
        ou_adj[l] = {"Over": round(raw_ou["Over"], 2), "Under": round(raw_ou["Under"], 2)}

    raw_btts = combinar_probabilidades(
        {
            "Yes": (s1["Ambas Marcam - Sim (%) (Final)"] + s2["Ambas Marcam - Sim (%) (Final)"]) / 2,
            "No":  (s1["Ambas Marcam - Não (%) (Final)"] + s2["Ambas Marcam - Não (%) (Final)"]) / 2,
        },
        pm["BTTS"],
        p_bt,
        PROB_BTTS_WEIGHTS,
    )
    bt_adj = {"Yes": round(raw_btts["Yes"], 2), "No": round(raw_btts["No"], 2)}

    # Handicap Asiático
    s = M.stack()
    total = float(s.sum())
    idx0 = s.index.get_level_values(0).to_numpy()
    idx1 = s.index.get_level_values(1).to_numpy()
    vals = s.to_numpy()

    model_probs = {"casa": {}, "fora": {}}
    if total > 0:
        for side in ("casa", "fora"):
            diff = (idx0 - idx1) if side == "casa" else (idx1 - idx0)
            for h in odds_handicap.get(side, {}):
                if h < 0:
                    mask = diff > abs(h)
                else:
                    mask = diff >= -h
                prob_pct = (vals[mask].sum() / total) * 100.0
                model_probs[side][h] = round(float(prob_pct), 2)

    probs_odd = {"casa": {}, "fora": {}}
    for h_home, odd_c in odds_handicap.get("casa", {}).items():
        h_away = -h_home
        odd_f = odds_handicap.get("fora", {}).get(h_away)
        if odd_f is None:
            continue
        p0 = calcular_probabilidade_sem_vig({"Casa": odd_c, "Fora": odd_f})
        probs_odd["casa"][h_home] = p0.get("Casa", 0.0)
        probs_odd["fora"][h_away] = p0.get("Fora", 0.0)

    hist_handicap = {"casa": {}, "fora": {}}
    for h in odds_handicap.get("casa", {}):
        hist_handicap["casa"][h] = historico_handicap_weighted(ja, jp, h, league_key, rodada_atual)
    for h in odds_handicap.get("fora", {}):
        hist_handicap["fora"][h] = historico_handicap_weighted(ja2, jp2, h, league_key, rodada_atual)

    prob_handicap_aj = {"casa": {}, "fora": {}}
    for side in ("casa", "fora"):
        common_h = set(model_probs[side].keys()).intersection(probs_odd[side].keys())
        for h in sorted(common_h):
            hist_val = hist_handicap[side].get(h, None)
            if (hist_val is not None) and np.isfinite(hist_val):
                w = PROB_HANDICAP_WEIGHTS_TRI
                num = (hist_val * w["hist"] + model_probs[side][h] * w["pois"] + probs_odd[side][h] * w["odds"])
                den = (w["hist"] + w["pois"] + w["odds"])
                prob_handicap_aj[side][h] = round(num / den, 2)
            else:
                w = PROB_HANDICAP_WEIGHTS
                num = (model_probs[side][h] * w["pois"] + probs_odd[side][h] * w["odds"])
                den = (w["pois"] + w["odds"])
                prob_handicap_aj[side][h] = round(num / den, 2)

    odd_justa_hand = {"casa": {}, "fora": {}}
    for side in ("casa", "fora"):
        for h, v in prob_handicap_aj[side].items():
            odd_justa_hand[side][h] = round(100.0 / v, 2) if v > 0 else np.nan

    top5 = M.stack().sort_values(ascending=False).head(5)
    tp = "; ".join(
        f"{home_team} {i}x{j} {away_team} ({round(p*100,2)}%)" for (i, j), p in top5.items()
    )

    res = {
        "Home": home_team, "Away": away_team, "League": league_key,
        "Date": kickoff_date, "Kickoff": kickoff_time,
        "Rodada_Atual": rodada_atual,
        "RPI_Home": rpi_home, "RPI_Away": rpi_away, "Delta_RPI": delta_rpi,
        "Diff_Gols_Home": round(gf1-ga1, 2), "Diff_Gols_Away": round(gf2-ga2, 2), "Delta_Diff_Gols": delta_diff_gols,
        "Media_GF_Home": gf1, "Media_GA_Home": ga1,
        "Media_GF_Away": gf2, "Media_GA_Away": ga2,
        "Media_Total_Gols": round(m_c+m_f, 2),
        "Lambda_Home_Raw": round(m_c, 4),
        "Lambda_Away_Raw": round(m_f, 4),
        "Lambda_Home_Final": round(m_c, 4),
        "Lambda_Away_Final": round(m_f, 4),
        "League_Avg_Home_Goals": round(league_avg_home_goals, 4) if np.isfinite(league_avg_home_goals) else np.nan,
        "League_Avg_Away_Goals": round(league_avg_away_goals, 4) if np.isfinite(league_avg_away_goals) else np.nan,
        "Sample_Home": sample_home,
        "Sample_Away": sample_away,
        "Sample_League": sample_league,
        "Shrinkage_Applied": True,
        "Shrinkage_K": "dynamic_by_league_weights",
        "Prior_Home": round(league_avg_home_goals, 4) if np.isfinite(league_avg_home_goals) else np.nan,
        "Prior_Away": round(league_avg_away_goals, 4) if np.isfinite(league_avg_away_goals) else np.nan,
        "Poisson_Enabled": True,
        "NBD_Evaluated": True,
        "NBD_Enabled": bool((var_c > m_c * (1 + OVERDISP_TOL)) or (var_f > m_f * (1 + OVERDISP_TOL))),
        "Overdispersion_Ratio": round(float(overdispersion_ratio), 4) if np.isfinite(overdispersion_ratio) else np.nan,
        "Score_Matrix_Max_Goals": max(range_used) if range_used else np.nan,
        "Score_Matrix_Tail_Mass": round(score_matrix_tail_mass, 8),
        "Score_Matrix_Probability_Sum": round(score_matrix_probability_sum, 8),
        "Score_Matrix_Normalized": score_matrix_normalized,

        "Prob_Casa": p_final["Casa"], "OddValor_Casa": val_h, "OddReal_Casa": odds_full_time["home"],
        "Prob_Empate": p_final["Empate"], "OddValor_Empate": val_x, "OddReal_Empate": odds_full_time["draw"],
        "Prob_Fora": p_final["Fora"], "OddValor_Fora": val_a, "OddReal_Fora": odds_full_time["away"],

        "Prob_1X": prob_1X, "OddValor_1X": val_1X, "OddReal_1X": odds_double_chance["1X"],
        "Prob_12": prob_12, "OddValor_12": val_12, "OddReal_12": odds_double_chance["12"],
        "Prob_X2": prob_X2, "OddValor_X2": val_X2, "OddReal_X2": odds_double_chance["X2"],

        "Prob_BTTS_Yes": bt_adj["Yes"],
        "OddValor_BTTS_Yes": round(100/bt_adj["Yes"],2) if bt_adj["Yes"]>0 else np.nan,
        "OddReal_BTTS_Yes": odds_bt.get("yes", np.nan),

        "Prob_BTTS_No": bt_adj["No"],
        "OddValor_BTTS_No": round(100/bt_adj["No"],2) if bt_adj["No"]>0 else np.nan,
        "OddReal_BTTS_No": odds_bt.get("no", np.nan),

        "Top5_Placares": tp,
        "Warnings": warnings_list,
        "last5_home": last5_home, "last5_away": last5_away,
        "H2H_df": df_h2h, "H2H_stats": h2h_stats,
        "TotalGoals_PMF": total_goals_pmf,
        "Range_Gols_Usado": range_used,
    }

    for l in odds_ou:
        res[f"Prob_Over_{l}"]      = ou_adj[l]["Over"]
        res[f"OddValor_Over_{l}"]  = round(100/ou_adj[l]["Over"], 2) if ou_adj[l]["Over"]>0 else np.nan
        res[f"OddReal_Over_{l}"]   = odds_ou[l]["over"]
        res[f"Prob_Under_{l}"]     = ou_adj[l]["Under"]
        res[f"OddValor_Under_{l}"] = round(100/ou_adj[l]["Under"], 2) if ou_adj[l]["Under"]>0 else np.nan
        res[f"OddReal_Under_{l}"]  = odds_ou[l]["under"]

    for h in sorted(prob_handicap_aj["casa"]):
        res[f"HandicapCasa_Line_{h}"]      = h
        res[f"Prob_Handicap_Casa_{h}"]     = prob_handicap_aj["casa"][h]
        res[f"OddValor_Handicap_Casa_{h}"] = odd_justa_hand["casa"][h]
        res[f"OddReal_Handicap_Casa_{h}"]  = odds_handicap["casa"][h]
    for h in sorted(prob_handicap_aj["fora"]):
        res[f"HandicapFora_Line_{h}"]      = h
        res[f"Prob_Handicap_Fora_{h}"]     = prob_handicap_aj["fora"][h]
        res[f"OddValor_Handicap_Fora_{h}"] = odd_justa_hand["fora"][h]
        res[f"OddReal_Handicap_Fora_{h}"]  = odds_handicap["fora"][h]

    res["OU_Lines"]      = sorted(odds_ou.keys())
    res["HC_Lines_Casa"] = sorted(prob_handicap_aj["casa"].keys())
    res["HC_Lines_Fora"] = sorted(prob_handicap_aj["fora"].keys())

    return res

# -------------------------------------------------------
# Impressão (mantida com mínimos ajustes)
# -------------------------------------------------------
def is_value(odd_off, odd_val, eps: float = 1e-9) -> bool:
    """
    Retorna True somente se Odd Ofertada > Odd de Valor (estritamente).
    eps evita ruído de float.
    """
    return (
        np.isfinite(odd_off) and np.isfinite(odd_val)
        and (odd_off > odd_val + eps)
    )


def _safe_odd_value(prob_pct: float) -> float:
    """Converte probabilidade em odd justa, evitando divisão por zero."""
    try:
        prob_pct = float(prob_pct)
    except Exception:
        return np.nan
    return round(100.0 / prob_pct, 2) if prob_pct > 0 else np.nan


def safe_float(value, default=np.nan) -> float:
    """Converte valores para float sem quebrar a exportação do Lovable."""
    try:
        if pd.isna(value):
            return default
        if isinstance(value, str):
            value = value.replace(',', '.').strip()
            if value == '':
                return default
        return float(value)
    except Exception:
        return default


def _split_date_time_values(date_value, time_value='') -> tuple[str, str]:
    """Separa data e hora mesmo quando o horário vem embutido na coluna date."""
    raw_date = '' if pd.isna(date_value) else str(date_value).strip()
    raw_time = '' if pd.isna(time_value) else str(time_value).strip()

    # dayfirst=True: entradas do fluxo brasileiro chegam como DD/MM/YYYY.
    # Sem esse flag, o pandas assume mês-primeiro (US) e uma data como
    # "09/07/2026" vira 2026-09-07 (7 de setembro) em vez de 9 de julho.
    dt = pd.to_datetime(raw_date, errors='coerce', dayfirst=True)
    if pd.notna(dt):
        data = dt.strftime('%d/%m/%Y')
        hora_embutida = dt.strftime('%H:%M') if (dt.hour or dt.minute or dt.second) else ''
        return data, (raw_time or hora_embutida)

    # Fallback para strings no formato "YYYY-MM-DD HH:MM" ou "DD/MM/YYYY HH:MM".
    m = re.match(r'^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(\d{1,2}:\d{2})(?::\d{2})?$', raw_date)
    if m:
        dt2 = pd.to_datetime(m.group(1), errors='coerce', dayfirst='/' in m.group(1))
        data = dt2.strftime('%d/%m/%Y') if pd.notna(dt2) else m.group(1)
        return data, (raw_time or m.group(2))

    return raw_date, raw_time


def formatar_data_lovable(valor) -> str:
    """Retorna somente a data no mesmo padrão do CSV WNBA do Lovable: DD/MM/AAAA."""
    return _split_date_time_values(valor, '')[0]


def formatar_hora_lovable(hora=None) -> str:
    """Retorna somente a hora no padrão HH:MM quando possível."""
    return _split_date_time_values('', hora)[1]


def formatar_numero(valor, casas: int = 2):
    """Arredonda números mantendo vazio quando não houver valor válido."""
    try:
        if pd.isna(valor):
            return ''
        return round(float(valor), casas)
    except Exception:
        return ''


def _edge_percent(odd_ofertada, odd_valor) -> float:
    """Calcula edge percentual: quanto a odd ofertada supera a odd de valor."""
    try:
        odd_ofertada = float(odd_ofertada)
        odd_valor = float(odd_valor)
    except (TypeError, ValueError):
        return 0.0
    if not np.isfinite(odd_ofertada) or not np.isfinite(odd_valor) or odd_valor <= 0:
        return 0.0
    return (odd_ofertada / odd_valor - 1) * 100


def calcular_edge_percentual(odd_ofertada: float, odd_valor: float) -> float:
    """Alias mantido para compatibilidade com trechos antigos."""
    return _edge_percent(odd_ofertada, odd_valor)


def _is_ev_plus(odd_ofertada, odd_valor, odd_minima: float = MIN_ODD_EXPORT, odd_maxima: float = MAX_ODD_EXPORT) -> bool:
    """Regra única EV+: odd ofertada > odd valor, > odd mínima e <= odd máxima."""
    try:
        odd_ofertada = float(odd_ofertada)
        odd_valor = float(odd_valor)
    except (TypeError, ValueError):
        return False
    if not np.isfinite(odd_ofertada) or not np.isfinite(odd_valor):
        return False
    return (
        odd_ofertada > odd_minima
        and odd_ofertada <= odd_maxima
        and odd_valor > 0
        and odd_ofertada > odd_valor
    )


def montar_observacoes_lovable(res: dict) -> str:
    """Monta observações somente com dados técnicos/avançados, sem texto comercial."""
    top5 = res.get('Top5_Placares', '')
    if isinstance(top5, (list, tuple)):
        top5 = '; '.join(str(x) for x in top5[:5])

    partes = [
        f"Rodada {res.get('Rodada_Atual', 'N/D')}",
        f"RPI casa {safe_float(res.get('RPI_Home'), 0):.3f}",
        f"RPI fora {safe_float(res.get('RPI_Away'), 0):.3f}",
        f"Delta RPI {safe_float(res.get('Delta_RPI'), 0):+.3f}",
        f"Exp. gols {safe_float(res.get('Media_Total_Gols'), 0):.2f}",
        f"Delta gols {safe_float(res.get('Delta_Diff_Gols'), 0):+.2f}",
        f"core_lambda_home={safe_float(res.get('Lambda_Home_Final'), 0):.4f}",
        f"core_lambda_away={safe_float(res.get('Lambda_Away_Final'), 0):.4f}",
        f"league_avg_home_goals={safe_float(res.get('League_Avg_Home_Goals'), 0):.4f}",
        f"league_avg_away_goals={safe_float(res.get('League_Avg_Away_Goals'), 0):.4f}",
        f"sample_home={int(safe_float(res.get('Sample_Home'), 0))}",
        f"sample_away={int(safe_float(res.get('Sample_Away'), 0))}",
        f"sample_league={int(safe_float(res.get('Sample_League'), 0))}",
        f"shrinkage_k={res.get('Shrinkage_K', 'N/D')}",
        f"score_matrix_max_goals={res.get('Score_Matrix_Max_Goals', 'N/D')}",
        f"score_matrix_tail_mass={safe_float(res.get('Score_Matrix_Tail_Mass'), 0):.8f}",
        f"score_matrix_probability_sum={safe_float(res.get('Score_Matrix_Probability_Sum'), 0):.8f}",
        f"nbd_enabled={res.get('NBD_Enabled', False)}",
        f"overdispersion_ratio={safe_float(res.get('Overdispersion_Ratio'), 0):.4f}",
    ]

    if top5:
        partes.append(f"Top placares {top5}")

    alertas = res.get('Warnings') or []
    if alertas:
        partes.append("Alertas " + " | ".join(str(x) for x in alertas))

    return '; '.join(partes)


def montar_linhas_lovable(res: dict) -> list[dict]:
    """
    Gera linhas planas para importação no Lovable, seguindo o modelo WNBA.

    Layout:
    data,hora,esporte,liga,jogo,mandante,visitante,mercado,pick,linha,
    odd_ofertada,odd_valor,probabilidade_final,edge,observacoes

    Regra EV+ única para todos os mercados:
    odd_ofertada > odd_valor, odd_ofertada > MIN_ODD_EXPORT e odd_ofertada <= MAX_ODD_EXPORT.
    """
    mandante = res.get('Home', '')
    visitante = res.get('Away', '')
    data_fmt, hora = _split_date_time_values(res.get('Date', ''), res.get('Kickoff', ''))
    observacoes = montar_observacoes_lovable(res)

    base_common = {
        'data': data_fmt,
        'hora': hora,
        'esporte': 'Futebol',
        'liga': res.get('League', ''),
        'jogo': f"{mandante} vs {visitante}",
        'mandante': mandante,
        'visitante': visitante,
    }
    linhas: list[dict] = []

    def add(mercado, pick, linha, probabilidade_final, odd_valor, odd_ofertada):
        if not _is_ev_plus(odd_ofertada, odd_valor):
            return
        edge = _edge_percent(odd_ofertada, odd_valor)
        linhas.append({
            **base_common,
            'mercado': mercado,
            'pick': pick,
            'linha': '' if linha is None or pd.isna(linha) else linha,
            'odd_ofertada': round(float(odd_ofertada), 2),
            'odd_valor': round(float(odd_valor), 2),
            'probabilidade_final': round(float(probabilidade_final), 2),
            'edge': round(edge, 2),
            'observacoes': observacoes,
        })

    # Resultado Final / 1X2
    add('Resultado Final', f'{mandante} para vencer', '', res.get('Prob_Casa'), res.get('OddValor_Casa'), res.get('OddReal_Casa'))
    add('Resultado Final', 'Empate', '', res.get('Prob_Empate'), res.get('OddValor_Empate'), res.get('OddReal_Empate'))
    add('Resultado Final', f'{visitante} para vencer', '', res.get('Prob_Fora'), res.get('OddValor_Fora'), res.get('OddReal_Fora'))

    # Dupla Chance
    for dc in ('1X', '12', 'X2'):
        add('Dupla Chance', dc, '', res.get(f'Prob_{dc}'), res.get(f'OddValor_{dc}'), res.get(f'OddReal_{dc}'))

    # Over/Under Gols
    for ln in res.get('OU_Lines', []):
        add('Total de Gols', f'Over {ln} gols', ln, res.get(f'Prob_Over_{ln}'), res.get(f'OddValor_Over_{ln}'), res.get(f'OddReal_Over_{ln}'))
        add('Total de Gols', f'Under {ln} gols', ln, res.get(f'Prob_Under_{ln}'), res.get(f'OddValor_Under_{ln}'), res.get(f'OddReal_Under_{ln}'))

    # Ambas Marcam
    add('Ambas Marcam', 'Ambas Marcam - Sim', '', res.get('Prob_BTTS_Yes'), res.get('OddValor_BTTS_Yes'), res.get('OddReal_BTTS_Yes'))
    add('Ambas Marcam', 'Ambas Marcam - Não', '', res.get('Prob_BTTS_No'), res.get('OddValor_BTTS_No'), res.get('OddReal_BTTS_No'))

    # Handicap Asiático
    for h in res.get('HC_Lines_Casa', []):
        h_float = float(h)
        add('Handicap Asiático', f'{mandante} {h_float:+.1f}', h_float,
            res.get(f'Prob_Handicap_Casa_{h}'),
            res.get(f'OddValor_Handicap_Casa_{h}'),
            res.get(f'OddReal_Handicap_Casa_{h}'))

    for h in res.get('HC_Lines_Fora', []):
        h_float = float(h)
        add('Handicap Asiático', f'{visitante} {h_float:+.1f}', h_float,
            res.get(f'Prob_Handicap_Fora_{h}'),
            res.get(f'OddValor_Handicap_Fora_{h}'),
            res.get(f'OddReal_Handicap_Fora_{h}'))

    return linhas


# Alias mantido para não quebrar chamadas antigas do main.
def gerar_linhas_prognosticos_lovable(res: dict) -> list[dict]:
    return montar_linhas_lovable(res)


def exportar_lovable(rows: list[dict], path: Path = LOVABLE_CSV) -> Path:
    """Exporta CSV do Lovable exatamente no layout definido pelo modelo WNBA."""
    path.parent.mkdir(parents=True, exist_ok=True)
    colunas = [
        'data', 'hora', 'esporte', 'liga', 'jogo', 'mandante', 'visitante',
        'mercado', 'pick', 'linha', 'odd_ofertada', 'odd_valor',
        'probabilidade_final', 'edge', 'observacoes'
    ]

    df_out = pd.DataFrame(rows)
    if df_out.empty:
        df_out = pd.DataFrame(columns=colunas)
    else:
        df_out = df_out.reindex(columns=colunas)
        df_out.sort_values(
            ['data', 'hora', 'jogo', 'mercado', 'edge'],
            ascending=[True, True, True, True, False],
            inplace=True
        )

    df_out.to_csv(path, index=False, encoding='utf-8-sig')
    logging.info(f"Planilha Lovable gerada: {path} ({len(df_out)} linhas)")
    return path


# Alias mantido para não quebrar chamadas antigas do main.
def salvar_prognosticos_lovable(linhas: list[dict], caminho: Path = LOVABLE_CSV) -> Path:
    return exportar_lovable(linhas, caminho)


def print_analysis(res: dict, standings: pd.DataFrame):
    try:
        pos_home = int(standings.index[standings["Team"] == res["Home"]].tolist()[0]) + 1
    except Exception:
        pos_home = None
    try:
        pos_away = int(standings.index[standings["Team"] == res["Away"]].tolist()[0]) + 1
    except Exception:
        pos_away = None

    try:
        date_obj = datetime.strptime(res["Date"], "%Y-%m-%d")
    except Exception:
        date_obj = pd.to_datetime(res.get("Date"), errors="coerce")
    date_fmt = date_obj.strftime("%d-%m-%Y") if pd.notna(date_obj) else str(res.get("Date", ""))

    print("Utilize o INPUT APRIMORADO - CONFIRMAÇÃO CRÍTICA MULTI-ESPORTES v2 para confirmação do prognóstico")
    print("=== PROGNÓSTICOS - FUTEBOL ===")

    classific = []
    classific.append(f"{res['Home']} ({pos_home}º)" if pos_home else f"{res['Home']}")
    classific.append(f"{res['Away']} ({pos_away}º)" if pos_away else f"{res['Away']}")
    print("Confronto:")
    print(f"{' vs '.join(classific)} | ({res['League']})")

    print("--- Probabilidades MOneyline ---")
    print(f"{res['Home']}: {res['Prob_Casa']:.2f}%")
    print(f"Empate: {res['Prob_Empate']:.2f}%")
    print(f"{res['Away']}: {res['Prob_Fora']:.2f}%\n")

    avisos = res.get("Warnings", [])
    if avisos:
        print("⚠️ AVISOS:")
        for aviso in avisos:
            print(f"  - {aviso}")
        print()

    print(f"Data/Horário: {date_fmt} / {res.get('Kickoff','')}")
    print(f"Rodada Atual: {res.get('Rodada_Atual', 'N/D')}\n")

    print("--- H2H (temporada atual + passada) ---")
    df_h2h = res.get("H2H_df", pd.DataFrame())
    stats  = res.get("H2H_stats", {})

    if df_h2h.empty:
        print(stats.get("mensagem", "Sem H2H nas temporadas selecionadas."), "\n")
    else:
        for season in sorted(df_h2h["season"].unique(), reverse=True):
            print(f"{season}:")
            sf = df_h2h[df_h2h["season"] == season]
            for i, r in enumerate(sf.itertuples(index=False), start=1):
                date_str = r.date.strftime("%d/%m/%Y") if pd.notna(r.date) else ""
                home_label = r.home_venue
                away_label = "Fora" if home_label == "Casa" else "Casa"
                print(
                    f"  jogo {i}: {date_str} - "
                    f"{r.home_abbr} ({home_label}) {r.goals_home} x {r.goals_away} "
                    f"{r.away_abbr} ({away_label}) | Total Gols = {r.total_goals}"
                )

            v_home_season = int((sf["winner"] == res["Home"]).sum())
            v_away_season = int((sf["winner"] == res["Away"]).sum())
            draws_season  = int(sf["winner"].isna().sum())
            avg_h_season  = float(sf["goals_home"].mean()) if not sf.empty else 0.0
            avg_a_season  = float(sf["goals_away"].mean()) if not sf.empty else 0.0
            avg_t_season  = float(sf["total_goals"].mean()) if not sf.empty else 0.0

            print(f"  Resumo {season}: Vitórias {res['Home']}: {v_home_season} | Empates: {draws_season} | Vitórias {res['Away']}: {v_away_season}")
            print(f"  Médias {season}: {res['Home']}= {avg_h_season:.2f} | {res['Away']}= {avg_a_season:.2f} | Total= {avg_t_season:.2f}\n")

        if stats:
            total = int(stats.get("total_jogos", 0))
            v_home = int(stats.get("wins_home", 0))
            v_away = int(stats.get("wins_away", 0))
            draws  = max(total - v_home - v_away, 0)

            print(f"Total de jogos: {total}")
            print(f"Vitórias {res['Home']}: {v_home} | Empates: {draws} | Vitórias {res['Away']}: {v_away}")
            if (stats.get("avg_goals_home") is not None and stats.get("avg_goals_away") is not None and stats.get("avg_total") is not None):
                print(
                    f"Médias H2H (geral): {res['Home']}= {stats['avg_goals_home']:.2f} | "
                    f"{res['Away']}= {stats['avg_goals_away']:.2f} | Total= {stats['avg_total']:.2f}\n"
                )

    print("--- ÚLTIMOS 5 JOGOS NO LOCAL ---")
    print(f"{res['Home']}: (últimos 5 em casa)")
    for _, r in res.get("last5_home", pd.DataFrame()).iterrows():
        date_obj = r["Date"]
        date_str = date_obj.strftime("%d/%m/%Y") if pd.notna(date_obj) else ""
        opp = r["AwayTeam"]
        wl  = "W" if r["FTHG"] > r["FTAG"] else ("D" if r["FTHG"] == r["FTAG"] else "L")
        gf, ga = r["FTHG"], r["FTAG"]
        print(f"  {date_str} vs {opp} - {wl} ({gf}-{ga}) | Total Gols = {gf + ga}")
    print("")

    print(f"{res['Away']}: (últimos 5 fora)")
    for _, r in res.get("last5_away", pd.DataFrame()).iterrows():
        date_obj = r["Date"]
        date_str = date_obj.strftime("%d/%m/%Y") if pd.notna(date_obj) else ""
        opp = r["HomeTeam"]
        wl  = "W" if r["FTAG"] > r["FTHG"] else ("D" if r["FTAG"] == r["FTHG"] else "L")
        gf, ga = r["FTAG"], r["FTHG"]
        print(f"  {date_str} vs {opp} - {wl} ({gf}-{ga}) | Total Gols = {gf + ga}")
    print("")

    print("\n--- DADOS TÉCNICOS ---")
    print("RPI:")
    print(f"   {res['Home']} - {res['RPI_Home']:.3f}  |  {res['Away']} - {res['RPI_Away']:.3f}")
    print(f"   Delta RPI: {res['Delta_RPI']:.3f}\n")

    print("Médias e Expectativas de Gols:")
    lambda_total = float(res.get("Media_Total_Gols", 0.0))

    lower, upper = None, None
    tg_pmf = res.get("TotalGoals_PMF")
    if isinstance(tg_pmf, dict) and len(tg_pmf) > 0:
        items = sorted(((int(k), float(v)) for k, v in tg_pmf.items()), key=lambda x: x[0])
        totals = np.array([k for k, _ in items], dtype=int)
        probs  = np.array([p for _, p in items], dtype=float) / 100.0
        probs  = probs / probs.sum() if probs.sum() > 0 else probs
        cdf = probs.cumsum()
        lower_idx = np.searchsorted(cdf, 0.05, side="left")
        upper_idx = np.searchsorted(cdf, 0.95, side="left")
        lower = int(totals[min(lower_idx, len(totals)-1)])
        upper = int(totals[min(upper_idx, len(totals)-1)])
    else:
        lower = int(poisson.ppf(0.05, lambda_total))
        upper = int(poisson.ppf(0.95, lambda_total))

    print(f"   {res['Home']} – Marcados: {res['Media_GF_Home']:.2f} | Sofridos: {res['Media_GA_Home']:.2f}")
    print(f"   {res['Away']} – Marcados: {res['Media_GF_Away']:.2f} | Sofridos: {res['Media_GA_Away']:.2f}")
    print(f"   Expectativas de Gols: {lambda_total:.2f} | Min: {lower} | Máx: {upper}\n")

    print("Diferencial de Gols:")
    print(f"   {res['Home']}: {res['Diff_Gols_Home']:.2f}  |  {res['Away']}: {res['Diff_Gols_Away']:.2f}")
    print(f"   Delta Gols: {res['Delta_Diff_Gols']:.2f}\n")

    print("--- TOP 5 PLACARES MAIS PROVÁVEIS ---")
    for placar in str(res.get("Top5_Placares", "")).split("; "):
        if placar.strip():
            print(f"  {placar}")
    print()

    print("--- RESULTADO DA PARTIDA ---")
    ml_items = [
        ("Casa",   res["Home"],  res.get("Prob_Casa", np.nan),   res.get("OddValor_Casa", np.nan),   res.get("OddReal_Casa", np.nan)),
        ("Empate", "Empate",     res.get("Prob_Empate", np.nan), res.get("OddValor_Empate", np.nan), res.get("OddReal_Empate", np.nan)),
        ("Fora",   res["Away"],  res.get("Prob_Fora", np.nan),   res.get("OddValor_Fora", np.nan),   res.get("OddReal_Fora", np.nan)),
    ]
    printed = False
    for _, label, prob, odd_val, odd_off in ml_items:
        if is_value(odd_off, odd_val):
            print(f"{label}: {prob:.2f}% | Odd Valor: {odd_val:.2f} | Odd Ofertada: {odd_off:.2f}")
            printed = True
    if not printed:
        print("  (sem valor no Moneyline)")
    print()

    print("--- OVER/UNDER GOLS ---")
    for l in res.get("OU_Lines", []):
        over_prob  = res[f"Prob_Over_{l}"]
        over_val   = res[f"OddValor_Over_{l}"]
        over_off   = res[f"OddReal_Over_{l}"]
        under_prob = res[f"Prob_Under_{l}"]
        under_val  = res[f"OddValor_Under_{l}"]
        under_off  = res[f"OddReal_Under_{l}"]

        over_ok  = is_value(over_off, over_val)
        under_ok = is_value(under_off, under_val)
        if not (over_ok or under_ok):
            continue

        if over_ok and under_ok:
            print(f"Linha {l}: Over {over_prob:.2f}% | Odd Valor: {over_val:.2f} | Odd Ofertada: {over_off:.2f}")
            print(f"         Under {under_prob:.2f}% | Odd Valor: {under_val:.2f} | Odd Ofertada: {under_off:.2f}\n")
        elif over_ok:
            print(f"Linha {l}: Over {over_prob:.2f}% | Odd Valor: {over_val:.2f} | Odd Ofertada: {over_off:.2f}\n")
        else:
            print(f"Linha {l}: Under {under_prob:.2f}% | Odd Valor: {under_val:.2f} | Odd Ofertada: {under_off:.2f}\n")

    print("--- AMBOS MARCAM ---")
    btts_items = [
        ("Sim", res.get("Prob_BTTS_Yes", np.nan), res.get("OddValor_BTTS_Yes", np.nan), res.get("OddReal_BTTS_Yes", np.nan)),
        ("Não", res.get("Prob_BTTS_No",  np.nan), res.get("OddValor_BTTS_No",  np.nan), res.get("OddReal_BTTS_No",  np.nan)),
    ]
    printed = False
    for label, prob, odd_val, odd_off in btts_items:
        if is_value(odd_off, odd_val):
            print(f"{label}: {prob:.2f}% | Odd Valor: {odd_val:.2f} | Odd Ofertada: {odd_off:.2f}")
            printed = True
    if not printed:
        print("  (sem valor em BTTS)")
    print()

    print("--- DUPLA CHANCE ---")
    dc_items = [
        ("1X", res.get("Prob_1X", np.nan), res.get("OddValor_1X", np.nan), res.get("OddReal_1X", np.nan)),
        ("12", res.get("Prob_12", np.nan), res.get("OddValor_12", np.nan), res.get("OddReal_12", np.nan)),
        ("X2", res.get("Prob_X2", np.nan), res.get("OddValor_X2", np.nan), res.get("OddReal_X2", np.nan)),
    ]
    printed = False
    for mkt, prob, odd_val, odd_off in dc_items:
        if is_value(odd_off, odd_val):
            print(f"{mkt}: {prob:.2f}% | Odd Valor: {odd_val:.2f} | Odd Ofertada: {odd_off:.2f}")
            printed = True
    if not printed:
        print("  (sem valor em Dupla Chance)")
    print()

    print("--- HANDICAP ASIÁTICO ---")
    for h in res.get("HC_Lines_Casa", []):
        odd_val = res.get(f"OddValor_Handicap_Casa_{h}", np.nan)
        odd_off = res.get(f"OddReal_Handicap_Casa_{h}", np.nan)
        if is_value(odd_off, odd_val):
            print(
                f"{res['Home']}: {h:+.1f}: {res[f'Prob_Handicap_Casa_{h}']:.2f}% | "
                f"Odd Valor: {odd_val:.2f} | Odd Ofertada: {odd_off:.2f}"
            )
    for h in res.get("HC_Lines_Fora", []):
        odd_val = res.get(f"OddValor_Handicap_Fora_{h}", np.nan)
        odd_off = res.get(f"OddReal_Handicap_Fora_{h}", np.nan)
        if is_value(odd_off, odd_val):
            print(
                f"{res['Away']}: {h:+.1f}: {res[f'Prob_Handicap_Fora_{h}']:.2f}% | "
                f"Odd Valor: {odd_val:.2f} | Odd Ofertada: {odd_off:.2f}"
            )

    print("\n" + "=" * 60 + "\n")

# -------------------------------------------------------
# Main
# -------------------------------------------------------
def main():
    if not MATCHES_CSV.exists():
        logging.error(f"Não encontrou CSV de jogos: {MATCHES_CSV.name}")
        return

    df_matches = pd.read_csv(MATCHES_CSV)
    df_matches["date"] = df_matches["date"].astype(str).str.strip()
    df_matches["time"] = df_matches["time"].astype(str).str.strip()

    # Converte odds/handicaps para numérico sem quebrar o script em caso de strings vazias.
    numeric_prefixes = ("odds_",)
    for col in df_matches.columns:
        if col.startswith(numeric_prefixes):
            df_matches[col] = pd.to_numeric(df_matches[col], errors="coerce")

    # 1) Detecta LINHAS_OU
    pattern = re.compile(r"OverUnder_Full_Time_(\d+)_(\d+)_Over")
    dynamic = set()
    for col in df_matches.columns:
        m = pattern.search(col)
        if m:
            dynamic.add(float(f"{m.group(1)}.{m.group(2)}"))
    global LINHAS_OU
    LINHAS_OU = sorted(dynamic)
    logging.info(f"Linhas de OU detectadas: {LINHAS_OU}")

    # 2) Detecta índices de Handicap Asiático
    hp_indices = set()
    for col in df_matches.columns:
        m1 = re.match(r"odds_Asian_handicap_Full_Time_Linha(\d+)_HANDICAP$", col)
        m2 = re.match(r"odds_Asian_handicap_Full_Time_Linha(\d+)_Opp_HANDICAP$", col)
        if m1:
            hp_indices.add(int(m1.group(1)))
        if m2:
            hp_indices.add(int(m2.group(1)))
    hp_indices = sorted(hp_indices)
    logging.info(f"Handicap indices detectados: {hp_indices}")

    # 3) Normaliza e resolve ligas
    df_matches["league_norm"] = df_matches["league"].apply(normalize_str)
    league_lookup = {
        normalize_str(l): l
        for d in (LEAGUES_CURRENT, LEAGUES_PREVIOUS, LEAGUES_EXTRA)
        for l in d.keys()
    }
    df_matches["league_key"] = df_matches.apply(
        lambda row: resolve_league(row["league"], row["country"], league_lookup),
        axis=1,
    )
    df_matches.loc[df_matches["country"].astype(str).str.lower() == "romania", "league_key"] = "ROU - Superliga"
    logging.info("\n" + df_matches[["league", "league_key"]].drop_duplicates().to_string())

    unresolved = df_matches[df_matches["league_key"].isna()][["country", "league", "home", "away"]].drop_duplicates()
    if not unresolved.empty:
        logging.warning("Ligas não resolvidas; jogos serão ignorados:\n" + unresolved.to_string(index=False))
        df_matches = df_matches[df_matches["league_key"].notna()].copy()

    leagues = df_matches["league_key"].dropna().unique()

    # 4) URLs históricas (mmz current/previous já estão automáticos)
    cur_urls  = {l: LEAGUES_CURRENT[l]  for l in leagues if l in LEAGUES_CURRENT}
    prev_urls = {l: LEAGUES_PREVIOUS[l] for l in leagues if l in LEAGUES_PREVIOUS}
    ext_urls  = {l: LEAGUES_EXTRA[l]    for l in leagues if l in LEAGUES_EXTRA}

    # 5) Carrega históricos
    df_cur  = carregar_dados_temporada(cur_urls,  SEASON_CTX["current_split"])
    df_prev = carregar_dados_temporada(prev_urls, SEASON_CTX["prev_split"])

    df_extra = (
        pd.concat([carregar_dados_liga(l, u, VALID_SEASONS) for l, u in ext_urls.items()], ignore_index=True)
        if ext_urls else pd.DataFrame()
    )

    # 6) Prepara df_extra somente com temporadas atuais
    if df_extra.empty:
        expected = ["HomeTeam","AwayTeam","FTHG","FTAG","FTR","Season","Liga"]
        df_extra_cur = pd.DataFrame(columns=expected)
    else:
        df_extra_cur = df_extra[df_extra["Season"].isin(CURRENT_SEASONS)].copy()

    expected = ["HomeTeam","AwayTeam","FTHG","FTAG","FTR","Season","Liga"]
    if not set(expected).issubset(df_cur.columns):
        df_cur = pd.DataFrame(columns=expected)
    if not set(expected).issubset(df_extra_cur.columns):
        df_extra_cur = pd.DataFrame(columns=expected)

    # 7) Standings por liga
    standings_by_league: dict[str, pd.DataFrame] = {}
    for liga in leagues:
        df_oficial = df_cur[df_cur["Liga"] == liga]
        df_ext     = df_extra_cur[df_extra_cur["Liga"] == liga]
        df_all     = pd.concat([df_oficial, df_ext], ignore_index=True)
        if not df_all.empty:
            standings_by_league[liga] = generate_standings(df_all)
        else:
            standings_by_league[liga] = pd.DataFrame(
                columns=["Team","Played","Wins","Draws","Losses","GF","GA","Points","GD"]
            )

    # 7.5) Lookup de times por liga
    team_lookup_by_league: dict[str, dict[str,str]] = {}
    for liga, st in standings_by_league.items():
        mapping = {normalize_str(t): t for t in st["Team"].tolist()}
        team_lookup_by_league[liga] = mapping

    # 8) Base geral
    base = pd.concat([df_cur, df_prev, df_extra], ignore_index=True)
    base.dropna(subset=["HomeTeam","AwayTeam"], inplace=True)

    def norm_in_league(raw: str, league: str):
        lookup = team_lookup_by_league.get(league, {})
        resolved = resolve_team_safe(raw, lookup)
        return raw if resolved is None else resolved

    df_matches["home_norm"] = df_matches.apply(lambda r: norm_in_league(r["home"], r["league_key"]), axis=1)
    df_matches["away_norm"] = df_matches.apply(lambda r: norm_in_league(r["away"], r["league_key"]), axis=1)
    logging.info("\n" + df_matches[["home","home_norm","away","away_norm"]].drop_duplicates().to_string())

    # 9) Loop análise
    results = []
    for _, row in df_matches.iterrows():
        ft_odds = {
            "home": row.get("odds_1X2_Full_Time_1", np.nan),
            "draw": row.get("odds_1X2_Full_Time_X", np.nan),
            "away": row.get("odds_1X2_Full_Time_2", np.nan),
        }
        bt_odds = {
            "yes": row.get("odds_Both_teams_to_score_Full_Time_YES", np.nan),
            "no": row.get("odds_Both_teams_to_score_Full_Time_NO", np.nan),
        }
        dc_odds = {
            "1X": row.get("odds_Double_chance_Full_Time_1X", np.nan),
            "12": row.get("odds_Double_chance_Full_Time_12", np.nan),
            "X2": row.get("odds_Double_chance_Full_Time_X2", np.nan),
        }

        ou_odds = {}
        for l in LINHAS_OU:
            key = str(l).replace(".", "_")
            over_col  = f"odds_OverUnder_Full_Time_{key}_Over"
            under_col = f"odds_OverUnder_Full_Time_{key}_Under"
            if over_col not in row or under_col not in row:
                logging.warning(f"Coluna OU {l} não encontrada em {row['home_norm']} vs {row['away_norm']}, pulando.")
                continue
            over = row.get(over_col); under = row.get(under_col)
            if pd.isna(over) or pd.isna(under) or over <= 0 or under <= 0:
                logging.info(f"OU inválido para linha {l} em {row['home_norm']} vs {row['away_norm']}")
                continue
            ou_odds[l] = {"over": over, "under": under}

        if not ou_odds:
            logging.warning(f"Nenhuma linha de OU válida para {row['home_norm']} vs {row['away_norm']}, pulando.")
            continue

        # Handicap Asiático real
        # Regra do modelo: considerar SOMENTE linhas com final .5
        # Ex.: -5.5, -4.5, ..., -0.5, +0.5, ..., +4.5, +5.5
        ALLOWED_HANDS = [x + 0.5 for x in range(-6, 6)]  # -5.5 até +5.5, sem linhas inteiras

        def is_allowed_half_handicap(h: float) -> bool:
            return any(abs(float(h) - allowed) < 1e-9 for allowed in ALLOWED_HANDS)

        odds_handicap_real = {"casa": {}, "fora": {}}
        for idx in hp_indices:
            home_line_col = f"odds_Asian_handicap_Full_Time_Linha{idx}_HANDICAP"
            home_odd_col  = f"odds_Asian_handicap_Full_Time_Linha{idx}_1"
            if home_line_col in row and home_odd_col in row:
                raw_h, odd_h = row[home_line_col], row[home_odd_col]
                if not pd.isna(raw_h) and not pd.isna(odd_h) and odd_h > 0:
                    try:
                        h = float(raw_h)
                        if is_allowed_half_handicap(h):
                            odds_handicap_real["casa"][h] = odd_h
                    except ValueError:
                        logging.error(f"Handicap casa não numérico: {raw_h}")

            opp_line_col = f"odds_Asian_handicap_Full_Time_Linha{idx}_Opp_HANDICAP"
            opp_odd_col  = f"odds_Asian_handicap_Full_Time_Linha{idx}_Opp_Odd"
            if opp_line_col in row and opp_odd_col in row:
                raw_h, odd_h = row[opp_line_col], row[opp_odd_col]
                if not pd.isna(raw_h) and not pd.isna(odd_h) and odd_h > 0:
                    try:
                        h = float(raw_h)
                        if is_allowed_half_handicap(h):
                            odds_handicap_real["fora"][h] = odd_h
                    except ValueError:
                        logging.error(f"Handicap fora não numérico: {raw_h}")

        casa = odds_handicap_real["casa"]
        fora = odds_handicap_real["fora"]
        casa_valid = {h: odd for h, odd in casa.items() if (-h in fora)}
        fora_valid = {h: odd for h, odd in fora.items() if (-h in casa)}
        odds_handicap_real["casa"] = casa_valid
        odds_handicap_real["fora"] = fora_valid

        try:
            results.append(
                analyze_match(
                    base=base,
                    home_team=row["home_norm"],
                    away_team=row["away_norm"],
                    kickoff_date=row["date"],
                    kickoff_time=row["time"],
                    league_key=row["league_key"],
                    odds_full_time=ft_odds,
                    odds_ou=ou_odds,
                    odds_bt=bt_odds,
                    odds_double_chance=dc_odds,
                    odds_handicap=odds_handicap_real,
                    current_seasons=CURRENT_SEASONS,
                    previous_seasons=PREVIOUS_SEASONS,
                )
            )
        except Exception as e:
            logging.error(f"Erro em {row['home_norm']} vs {row['away_norm']}: {e}")

    # 10) Ordena, imprime e exporta para o Lovable
    results.sort(key=lambda x: (x["Date"], x["Kickoff"]))
    for res in results:
        st = standings_by_league.get(res["League"])
        print_analysis(res, st)

    prognosticos_lovable = []
    for res in results:
        prognosticos_lovable.extend(gerar_linhas_prognosticos_lovable(res))

    caminho_lovable = salvar_prognosticos_lovable(prognosticos_lovable)
    logging.info(f"Arquivo de prognósticos para Lovable salvo em: {caminho_lovable}")
    logging.info(f"Total de linhas exportadas para o Lovable: {len(prognosticos_lovable)}")

if __name__ == "__main__":
    main()
