# %% cell 0
import pandas as pd
import numpy as np
import logging
import math
import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PACKBALL_FILE_10 = "PackBall Custom over_gols_ft_10 {date}.csv"
PACKBALL_FILE_20 = "PackBall Custom over_gols_ft_20 {date}.csv"

try:
    from IPython.display import display
except Exception:
    display = None

# ------------------------------------------------------------
# LOGGING
# ------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# ------------------------------------------------------------
# CONFIGURAÇÕES
# ------------------------------------------------------------
date_str = "18-06-2026"  # dd-mm-YYYY (precisa casar com o sufixo dos CSVs)
base_dir = Path("dados_futebol_gols")
output_dir = Path("Prognostico")

# Nome comercial do modelo para identificação no Lovable.
MODEL_NAME = "ASP GoalMatrix"
MODEL_VERSION = "v2.1"

# Modo de execução:
#   prognostico = apenas jogos NS
#   backtest    = apenas jogos FT/FT_PEN
#   ambos       = NS + FT/FT_PEN
RUN_MODE = "prognostico"
STATUSES_BY_MODE = {
    "prognostico": ("NS",),
    "backtest": ("FT",),
    "ambos": ("NS", "FT"),
}
STATUSES = STATUSES_BY_MODE.get(RUN_MODE, ("NS",))

# Pesos finais — odds entram apenas como ajuste mínimo de mercado.
w_hist, w_sim, w_imp = 0.40, 0.50, 0.10

# Pesos específicos para Primeiro a Marcar: mercado mais volátil.
w_hist_first, w_sim_first, w_imp_first = 0.35, 0.55, 0.10

FIRST_GOAL_ENABLED = False
MIN_EDGE_OU = 4.0
MIN_EDGE_BTTS = 5.0
COMPONENT_DISAGREEMENT_THRESHOLD = 12.0
STRONG_MARKET_CONFLICT_THRESHOLD = 20.0
DISAGREEMENT_HAIRCUT_STRENGTH = 0.25
DISAGREEMENT_HAIRCUT_MAX_PP = 5.0

RECENT_WEIGHT_MIN = 0.25
RECENT_WEIGHT_MAX = 0.50
RECENT_WEIGHT_BASE = 0.35
RECENT_DIVERGENCE_START = 0.30
RECENT_DIVERGENCE_RANGE = 1.20
RECENT_DIVERGENCE_MAX_BOOST = 0.10
RECENT_WINDOW_GAMES = 10
VENUE_WINDOW_GAMES = 20
MIN_RECENT_GAMES = 2
MIN_VENUE_GAMES = 5

KELLY_FRACTION = 0.125
MAX_PICK_UNITS = 1.0
MAX_MARKET_UNITS = 1.5
MAX_GAME_UNITS = 2.0
MAX_CORRELATED_LINES = 3

MIN_OOS_CALIBRATION_SAMPLE = 100
CALIBRATION_PATH = Path(os.getenv("GOALMATRIX_CALIBRATION_PATH", Path(__file__).with_name("goalmatrix_calibration.json")))
RUN_PROVENANCE: dict[str, object] = {}

ths_ft = [1.5, 2.5, 3.5, 4.5]
n_sims = 10_000

# Cortes por mercado
# Over/Under mantém corte mais aberto porque já tem filtro duro de custo de gol.
# BTTS e Primeiro a Marcar exigem maior consistência por serem mercados mais voláteis.
MIN_PROB_OU = 55
MIN_PROB_BTTS = 56
MIN_PROB_FIRST = 58
MIN_PROB_SEM_GOL = 60

MIN_CV_OU = 50
MIN_CV_BTTS = 55
MIN_CV_FIRST = 60
MIN_CV_SEM_GOL = 60

# Compatibilidade para funções genéricas/diagnóstico.
MIN_PROB = MIN_PROB_OU
MIN_CV_MARKED = MIN_CV_OU

# Baseline split casa/fora
DEFAULT_SHARE_HOME = 0.55
SHARE_HOME_CLIP = (0.45, 0.62)

# Limites de forças
FORCE_RAW_CLIP = (0.30, 3.00)
LAMBDA_CLIP = (0.0, 10.0)

# Baseline liga (gols)
L_TOTAL_DEFAULT = 2.60
L_TOTAL_CLIP = (0.20, 6.50)

# DISPERSÃO (ALPHA) - FIXO
ALPHA_DEFAULT = 0.10  # sugestão inicial: 0.08–0.15 (ajuste fino depois)
SIM_SEED = 42         # reprodutibilidade

LAMBDA_POWER = 0.50  # 0.50 = sqrt; 0.65 = menos amortecimento; 0.35 = mais amortecimento

VALUE_BUFFER = 1.03  # 3% de folga (recomendado)

SHRINK_OU = 0.88
SHRINK_BTTS = 0.86
SHRINK_FIRST = 0.82

# Filtro seletivo para CSV Lovable e impressão.
MIN_ODD = 1.50
MAX_ODD = 2.00
MIN_ODD_PRINT = MIN_ODD

# Custo de Gol — filtro duro apenas para Over/Under.
# Margem = distância entre Exp. Gols Modelo e linha.
# Custo = break-even da odd / margem favorável de gols.
MIN_MARGEM_GOL_OU = 0.20
MAX_CUSTO_GOL_OU = 220.0

# ------------------------------------------------------------
# COLUNAS NORMALIZADAS (GOLS)
# ------------------------------------------------------------
cols_normalizados = [
    "Pais",
    "Sigla",
    "Liga",
    "Data/Hora",
    "Status",
    "Time Casa",
    "Resultado Casa",
    "Resultado Visitante",
    "Time Visitante",
    "Odd Casa Vencer",
    "Odd Visitante Vencer",
    "Odd BTTS Sim",
    "Odd Over 1.5 Gols",
    "Odd Over 2.5 Gols",
    "Odd Over 3.5 Gols",
    "Odd Over 4.5 Gols",
    "Odd Under 1.5 Gols",
    "Odd Under 2.5 Gols",
    "Odd Under 3.5 Gols",
    "Odd Under 4.5 Gols",
    "Odd Casa Marcar Primeiro",
    "Odd Visitante Marcar Primeiro",
    "Odd BTTS Não",
    "Odd Sem Gol",
    "Expectativa de Gols",
    "CV Média Gols Casa",
    "CV Média Gols Visitante",
    "CV Média Gols Marcados Casa",
    "CV Média Gols Marcados Visitante",
    "H2H Ocorrência de Over 1.5 Gols",
    "H2H Ocorrência de Over 2.5 Gols",
    "H2H Ocorrência de Over 3.5 Gols",
    "H2H Ocorrência de BTTS Sim",
    "H2H Casa Marcou Primeiro",
    "H2H Visitante Marcou Primeiro",
    "Colocação Time Casa",
    "Colocação Time Visitante",
    "Número Jogos Coletados Casa",
    "Número Jogos Coletados Visitante",
    "Média Gols Marcados Casa",
    "Média Gols Marcados Visitante",
    "Média Gols Sofridos Casa",
    "Média Gols Sofridos Visitante",
    "Média Gols Liga",
    "Ocorrência Over 1.5 Gols Casa",
    "Ocorrência Over 1.5 Gols Visitante",
    "Ocorrência Over 2.5 Gols Casa",
    "Ocorrência Over 2.5 Gols Visitante",
    "Ocorrência Over 3.5 Gols Casa",
    "Ocorrência Over 3.5 Gols Visitante",
    "Ocorrência Over 4.5 Gols Casa",
    "Ocorrência Over 4.5 Gols Visitante",
    "Ocorrência Under 1.5 Gols Casa",
    "Ocorrência Under 1.5 Gols Visitante",
    "Ocorrência Under 2.5 Gols Casa",
    "Ocorrência Under 2.5 Gols Visitante",
    "Ocorrência Under 3.5 Gols Casa",
    "Ocorrência Under 3.5 Gols Visitante",
    "Ocorrência Under 4.5 Gols Casa",
    "Ocorrência Under 4.5 Gols Visitante",
    "Ocorrência BTTS Sim Casa",
    "Ocorrência BTTS Sim Visitante",
    "Ocorrência Casa Marcou Primeiro",
    "Ocorrência Visitante Marcou Primeiro",
]

# ------------------------------------------------------------
# UTILITÁRIOS I/O + NORMALIZAÇÃO
# ------------------------------------------------------------
SOURCE_HEADERS = [
    "Country ", "Short", "League ", "Hour", "Status", "Home Team", "Result Home",
    "Result Visitor", "Visitor Team", "Odds", "Odds.1", "Odds.2", "Odds.3", "Odds.4",
    "Odds.5", "Odds.6", "Odds.7", "Odds.8", "Odds.9", "Odds.10", "Odds.11", "Odds.12",
    "Odds.13", "Odds.14", "Global", "Casa", "Fora", "Casa.1", "Fora.1", "Global.1",
    "Global.2", "Global.3", "Global.4", "Casa.2", "Fora.2", "Casa.3", "Fora.3",
    "Casa.4", "Fora.4", "Casa.5", "Fora.5", "Casa.6", "Fora.6", "Global.5",
    "Casa.7", "Fora.7", "Casa.8", "Fora.8", "Casa.9", "Fora.9", "Casa.10",
    "Fora.10", "Casa.11", "Fora.11", "Casa.12", "Fora.12", "Casa.13", "Fora.13",
    "Casa.14", "Fora.14", "Casa.15", "Fora.15", "Casa.16", "Fora.16",
]


def sniff_sep(path: Path) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        sample = f.read(4096)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t"])
        return dialect.delimiter
    except csv.Error:
        return ","


def load_gols_data(date_str: str, base_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Arquivos esperados:
      - PackBall Custom over_gols_ft_10 {date_str}.csv
      - PackBall Custom over_gols_ft_20 {date_str}.csv
    """
    files = {
        "10": base_dir / f"PackBall Custom over_gols_ft_10 {date_str}.csv",
        "20": base_dir / f"PackBall Custom over_gols_ft_20 {date_str}.csv",
    }
    dfs = {}
    for label, path in files.items():
        if not path.exists():
            raise FileNotFoundError(f"Arquivo não encontrado: {path}")
        sep = sniff_sep(path)
        df = pd.read_csv(path, sep=sep, encoding="utf-8", engine="python")
        logging.info(f"{label} jogos lido com sep='{sep}': {path.name} -> {df.shape}")
        dfs[label] = df
    return dfs["10"], dfs["20"]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def schema_sha256(columns) -> str:
    payload = json.dumps([str(column) for column in columns], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def validate_source_schema(df: pd.DataFrame, label: str) -> None:
    actual = [str(column) for column in df.columns]
    if actual != SOURCE_HEADERS:
        mismatch = next(
            (
                index
                for index, (expected, received) in enumerate(zip(SOURCE_HEADERS, actual))
                if expected != received
            ),
            min(len(actual), len(SOURCE_HEADERS)),
        )
        expected = SOURCE_HEADERS[mismatch] if mismatch < len(SOURCE_HEADERS) else "<missing>"
        received = actual[mismatch] if mismatch < len(actual) else "<missing>"
        raise ValueError(
            f"GOALMATRIX_SCHEMA_DRIFT:{label}:index={mismatch}:expected={expected!r}:received={received!r}"
        )


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    if len(df.columns) != len(cols_normalizados):
        raise ValueError(
            f"Número de colunas no CSV ({len(df.columns)}) diferente do esperado ({len(cols_normalizados)})."
        )
    df = df.copy()
    df.columns = cols_normalizados

    for c in ["Pais", "Sigla", "Liga", "Status", "Time Casa", "Time Visitante"]:
        df[c] = df[c].astype(str).str.strip()

    df["Data/Hora"] = pd.to_datetime(df["Data/Hora"], errors="coerce", dayfirst=True)
    before = len(df)
    df = df.loc[df["Data/Hora"].notna()].copy()
    dropped = before - len(df)
    if dropped:
        logging.warning(f"{dropped} linhas descartadas por Data/Hora inválida (NaT).")
    return df


def _to_numeric_series(s: pd.Series) -> pd.Series:
    x = s.astype(str).str.strip()
    x = x.str.replace("%", "", regex=False)

    mask_comma = x.str.contains(",", na=False) & ~x.str.contains(r"\.", na=False)
    x.loc[mask_comma] = x.loc[mask_comma].str.replace(",", ".", regex=False)

    x = x.replace({"": np.nan, "nan": np.nan, "None": np.nan, "NaN": np.nan, "-": np.nan})
    return pd.to_numeric(x, errors="coerce")


def coerce_numeric(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    keep_text = {
        "Pais", "Sigla", "Liga", "Data/Hora", "Status", "Time Casa", "Time Visitante",
        "Resultado Casa", "Resultado Visitante",
    }
    num_cols = [c for c in df.columns if c not in keep_text]
    for c in num_cols:
        df[c] = _to_numeric_series(df[c])
    return df


def sanitize_pct_like_columns(df: pd.DataFrame, label: str = "") -> pd.DataFrame:
    """
    Para colunas do tipo % (Ocorrência/H2H/CV): qualquer valor fora [0,100] vira NaN.
    """
    df = df.copy()
    pct_cols = [c for c in df.columns if ("Ocorrência" in c) or c.startswith("H2H ") or c.startswith("CV ")]
    for c in pct_cols:
        x = df[c]
        bad = x.notna() & ((x < 0) | (x > 100))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} -> setando NaN (fora de [0,100]).")
            df.loc[bad, c] = np.nan
    return df


def sanity_check_ranges(df: pd.DataFrame, label: str = "") -> None:
    odd_cols = [c for c in df.columns if c.startswith("Odd ")]
    for c in odd_cols:
        x = df[c]
        bad = x.notna() & ((x < 1.01) | (x > 200))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} odds fora do range [1.01,200]. Possível coluna desalinhada.")

    occ_cols = [c for c in df.columns if ("Ocorrência" in c) or c.startswith("H2H ")]
    for c in occ_cols:
        x = df[c]
        bad = x.notna() & ((x < 0) | (x > 100))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} valores fora de [0,100]. Possível coluna desalinhada/placeholder.")

    cv_cols = [c for c in df.columns if c.startswith("CV ")]
    for c in cv_cols:
        x = df[c]
        bad = x.notna() & ((x < 0) | (x > 100))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} CV fora de [0,100]. Possível coluna desalinhada.")


def filter_by_status_and_games(df: pd.DataFrame, statuses=("NS",), min_games: int = 5) -> pd.DataFrame:
    """
    - Trata Status: FT_PEN -> FT
    - Mantém apenas os status definidos pelo RUN_MODE
    - Mantém apenas equipes com ao menos min_games; cobertura parcial vira shrinkage.
    """
    df = df.copy()

    st = df["Status"].astype(str).str.strip().str.upper()
    st = st.replace({"FT_PEN": "FT"})
    df["Status"] = st

    df = df[df["Status"].isin(list(statuses))].copy()

    df["Número Jogos Coletados Casa"] = pd.to_numeric(df["Número Jogos Coletados Casa"], errors="coerce")
    df["Número Jogos Coletados Visitante"] = pd.to_numeric(df["Número Jogos Coletados Visitante"], errors="coerce")

    df = df[
        (df["Número Jogos Coletados Casa"] >= min_games) &
        (df["Número Jogos Coletados Visitante"] >= min_games)
    ].copy()
    return df


def validate_window_profile(df: pd.DataFrame, expected_games: int, label: str) -> None:
    counts = pd.concat([
        pd.to_numeric(df["Número Jogos Coletados Casa"], errors="coerce"),
        pd.to_numeric(df["Número Jogos Coletados Visitante"], errors="coerce"),
    ]).dropna()
    if counts.empty or float(counts.max()) != float(expected_games) or bool((counts > expected_games).any()):
        observed = sorted({int(value) for value in counts.unique()}) if not counts.empty else []
        raise ValueError(
            f"GOALMATRIX_WINDOW_MISMATCH:{label}:expected_max={expected_games}:observed={observed}"
        )


def weighted_mix_pct(parts: list[pd.Series], weights: list[float]) -> pd.Series:
    """
    Mistura em % ignorando NaNs: renormaliza os pesos por linha.
    """
    w = np.asarray(weights, dtype=float)
    X = np.vstack([p.astype(float).values for p in parts])  # (k, n)
    M = np.isfinite(X)
    ww = (M * w[:, None]).astype(float)
    den = ww.sum(axis=0)
    num = np.nansum(X * ww, axis=0)

    out = np.full(X.shape[1], np.nan, dtype=float)
    ok = den > 0
    out[ok] = num[ok] / den[ok]
    return pd.Series(out, index=parts[0].index)

# ------------------------------------------------------------
# MERGE ROBUSTO 5J/20J
# ------------------------------------------------------------
BASE_KEYS = ["Pais", "Sigla", "Liga", "Data/Hora", "Time Casa", "Time Visitante"]
MERGE_KEYS = BASE_KEYS + ["Status"]


def dedupe_by_keys_keep_most_complete(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    df = df.copy()
    df["_nn"] = df.notna().sum(axis=1).astype(int)
    df = df.sort_values(by=["_nn"], ascending=False)
    df = df.drop_duplicates(subset=keys, keep="first").drop(columns=["_nn"]).reset_index(drop=True)
    return df


def audit_merge_keys(df10u: pd.DataFrame, df20u: pd.DataFrame) -> None:
    """Mantém o inner merge, mas avisa se houver divergência entre os arquivos."""
    only_10 = df10u[MERGE_KEYS].merge(df20u[MERGE_KEYS], on=MERGE_KEYS, how="left", indicator=True)
    only_10 = only_10[only_10["_merge"] == "left_only"]

    only_20 = df20u[MERGE_KEYS].merge(df10u[MERGE_KEYS], on=MERGE_KEYS, how="left", indicator=True)
    only_20 = only_20[only_20["_merge"] == "left_only"]

    if len(only_10):
        logging.warning(f"Jogos presentes apenas no arquivo 10j: {len(only_10)}")
    if len(only_20):
        logging.warning(f"Jogos presentes apenas no arquivo 20j: {len(only_20)}")


def merge_10_20(df10: pd.DataFrame, df20: pd.DataFrame) -> pd.DataFrame:
    df10u = dedupe_by_keys_keep_most_complete(df10, MERGE_KEYS)
    df20u = dedupe_by_keys_keep_most_complete(df20, MERGE_KEYS)

    audit_merge_keys(df10u, df20u)

    merged = df10u.merge(
        df20u,
        on=MERGE_KEYS,
        how="inner",
        suffixes=("_10", "_20"),
        validate="one_to_one",
    )
    return merged.reset_index(drop=True)

# ------------------------------------------------------------
# PESOS DINÂMICOS: FORMA 10J + ESTRUTURA DE MANDO 20J
# ------------------------------------------------------------
def build_dynamic_weights(merged: pd.DataFrame) -> pd.DataFrame:
    """
    No PackBall usado aqui: CV maior = maior consistência.

    Lógica adotada:
      - 20j por mando é a âncora estrutural.
      - 10j gerais da temporada atual representam forma recente.
      - As janelas são sinais independentes, não subconjuntos subtraíveis.
      - Cobertura parcial reduz a evidência e encolhe forças ao baseline.
    """
    merged = merged.copy()

    cv_idx_home_20 = (
        0.30 * merged["CV Média Gols Casa_20"] +
        0.70 * merged["CV Média Gols Marcados Casa_20"]
    )
    cv_idx_away_20 = (
        0.30 * merged["CV Média Gols Visitante_20"] +
        0.70 * merged["CV Média Gols Marcados Visitante_20"]
    )

    merged["_cv_idx_home_20"] = cv_idx_home_20
    merged["_cv_idx_away_20"] = cv_idx_away_20
    merged["_cv_game"] = (cv_idx_home_20 + cv_idx_away_20) / 2.0

    component_names = (
        "Média Gols Marcados Casa",
        "Média Gols Sofridos Casa",
        "Média Gols Marcados Visitante",
        "Média Gols Sofridos Visitante",
    )
    deltas = []
    for name in component_names:
        deltas.append((merged[f"{name}_10"].astype(float) - merged[f"{name}_20"].astype(float)).abs())
    delta_form = sum(deltas) / float(len(deltas))

    merged["_delta_form_10v20"] = delta_form.round(3)

    recency_boost = (
        ((delta_form - RECENT_DIVERGENCE_START) / RECENT_DIVERGENCE_RANGE)
        .clip(lower=0.0, upper=1.0)
        * RECENT_DIVERGENCE_MAX_BOOST
    )
    consistency_adjustment = ((50.0 - merged["_cv_game"].astype(float)) / 100.0).clip(-0.05, 0.05)
    raw_recent = (RECENT_WEIGHT_BASE + recency_boost + consistency_adjustment).clip(
        lower=RECENT_WEIGHT_MIN, upper=RECENT_WEIGHT_MAX
    )
    recent_home = (merged["Número Jogos Coletados Casa_10"] / RECENT_WINDOW_GAMES).clip(0.0, 1.0)
    recent_away = (merged["Número Jogos Coletados Visitante_10"] / RECENT_WINDOW_GAMES).clip(0.0, 1.0)
    venue_home = (merged["Número Jogos Coletados Casa_20"] / VENUE_WINDOW_GAMES).clip(0.0, 1.0)
    venue_away = (merged["Número Jogos Coletados Visitante_20"] / VENUE_WINDOW_GAMES).clip(0.0, 1.0)
    recent_reliability = np.sqrt(recent_home * recent_away)
    venue_reliability = np.sqrt(venue_home * venue_away)

    recent_evidence = raw_recent * recent_reliability
    venue_evidence = (1.0 - raw_recent) * venue_reliability
    evidence_total = (recent_evidence + venue_evidence).replace(0.0, np.nan)
    merged["_w_recent10"] = (recent_evidence / evidence_total).fillna(raw_recent)
    merged["_w_venue20"] = 1.0 - merged["_w_recent10"]
    merged["_recent_reliability"] = recent_reliability
    merged["_venue_reliability"] = venue_reliability
    merged["_feature_reliability"] = (
        raw_recent * recent_reliability + (1.0 - raw_recent) * venue_reliability
    ).clip(0.0, 1.0)
    merged["_feature_reliability_home"] = (
        raw_recent * recent_home + (1.0 - raw_recent) * venue_home
    ).clip(0.0, 1.0)
    merged["_feature_reliability_away"] = (
        raw_recent * recent_away + (1.0 - raw_recent) * venue_away
    ).clip(0.0, 1.0)
    merged["_w10"] = merged["_w_recent10"]
    merged["_w20"] = merged["_w_venue20"]
    return merged


def blend(merged: pd.DataFrame, col_base: str) -> pd.Series:
    """
    Mistura forma geral de 10j e estrutura de mando de 20j.
    Se uma das bases estiver ausente, renormaliza o peso para usar a base disponível.
    """
    c10 = f"{col_base}_10"
    c20 = f"{col_base}_20"

    if c10 not in merged.columns or c20 not in merged.columns:
        raise KeyError(f"Colunas esperadas não encontradas para blend: {c10} / {c20}")

    if col_base.startswith("CV "):
        return merged[c20].astype(float)

    if ("_w_recent10" not in merged.columns) or ("_w_venue20" not in merged.columns):
        w10 = pd.Series(RECENT_WEIGHT_BASE, index=merged.index, dtype=float)
        w20 = 1.0 - w10
    else:
        w10 = merged["_w_recent10"].astype(float)
        w20 = merged["_w_venue20"].astype(float)

    x10 = merged[c10].astype(float)
    x20 = merged[c20].astype(float)
    valid10 = x10.notna()
    valid20 = x20.notna()
    den = valid10.astype(float) * w10 + valid20.astype(float) * w20
    num = (
        x10.fillna(0.0) * w10 * valid10.astype(float) +
        x20.fillna(0.0) * w20 * valid20.astype(float)
    )

    out = pd.Series(np.nan, index=merged.index, dtype=float)
    ok = den > 0
    out.loc[ok] = num.loc[ok] / den.loc[ok]
    return out

# ------------------------------------------------------------
# VIG-FREE + ODD DE VALOR + CALIBRAÇÃO
# ------------------------------------------------------------
def vig_free_probs_from_odds_2way(odd_a, odd_b) -> tuple[np.ndarray, np.ndarray]:
    oa = np.asarray(odd_a, dtype=float)
    ob = np.asarray(odd_b, dtype=float)

    pa = np.full_like(oa, np.nan, dtype=float)
    pb = np.full_like(ob, np.nan, dtype=float)

    valid = np.isfinite(oa) & np.isfinite(ob) & (oa > 1e-9) & (ob > 1e-9)
    inv_a = np.zeros_like(oa, dtype=float)
    inv_b = np.zeros_like(ob, dtype=float)
    inv_a[valid] = 1.0 / oa[valid]
    inv_b[valid] = 1.0 / ob[valid]
    s = inv_a + inv_b

    valid2 = valid & (s > 0)
    pa[valid2] = inv_a[valid2] / s[valid2]
    pb[valid2] = inv_b[valid2] / s[valid2]
    return pa, pb


def vig_free_probs_from_odds_3way(odd_a, odd_b, odd_c) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    oa = np.asarray(odd_a, dtype=float)
    ob = np.asarray(odd_b, dtype=float)
    oc = np.asarray(odd_c, dtype=float)

    pa = np.full_like(oa, np.nan, dtype=float)
    pb = np.full_like(ob, np.nan, dtype=float)
    pc = np.full_like(oc, np.nan, dtype=float)

    valid = np.isfinite(oa) & np.isfinite(ob) & np.isfinite(oc) & (oa > 1e-9) & (ob > 1e-9) & (oc > 1e-9)
    inv_a = np.zeros_like(oa, dtype=float)
    inv_b = np.zeros_like(ob, dtype=float)
    inv_c = np.zeros_like(oc, dtype=float)

    inv_a[valid] = 1.0 / oa[valid]
    inv_b[valid] = 1.0 / ob[valid]
    inv_c[valid] = 1.0 / oc[valid]

    s = inv_a + inv_b + inv_c
    valid2 = valid & (s > 0)

    pa[valid2] = inv_a[valid2] / s[valid2]
    pb[valid2] = inv_b[valid2] / s[valid2]
    pc[valid2] = inv_c[valid2] / s[valid2]
    return pa, pb, pc


def safe_odd_value(prob_pct: pd.Series) -> pd.Series:
    p = prob_pct.astype(float)
    out = pd.Series(np.nan, index=p.index, dtype=float)
    valid = np.isfinite(p) & (p > 0)
    out.loc[valid] = 100.0 / p.loc[valid]
    return out


def calibrate(prob: pd.Series, shrink: float = 0.85) -> pd.Series:
    """Calibração para mercados 2-way, puxando para 50%."""
    p = prob.astype(float)
    return (50.0 + (p - 50.0) * float(shrink)).clip(0.0, 100.0)


def calibrate_multiclass(probs: pd.DataFrame, shrink: float = 0.85) -> pd.DataFrame:
    """
    Calibração correta para mercados com 3 ou mais saídas.
    Em vez de puxar para 50%, puxa para 100/n classes e normaliza a soma para 100%.
    """
    probs = probs.astype(float)
    center = 100.0 / probs.shape[1]
    out = center + (probs - center) * float(shrink)
    out = out.clip(lower=0.0)
    row_sum = out.sum(axis=1).replace(0, np.nan)
    out = out.div(row_sum, axis=0) * 100.0
    return out


def load_goalmatrix_calibration() -> dict:
    if not CALIBRATION_PATH.exists():
        return {}
    try:
        payload = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def apply_oos_calibration(market: str, probability_pct: pd.Series) -> tuple[pd.Series, dict]:
    config = load_goalmatrix_calibration().get("markets", {}).get(market, {})
    sample_size = int(config.get("sample_size") or 0)
    active = bool(config.get("active")) and bool(config.get("out_of_sample"))
    if not active or sample_size < MIN_OOS_CALIBRATION_SAMPLE:
        return probability_pct.astype(float), {
            "status": "identity_insufficient_oos_sample",
            "sample_size": sample_size,
        }
    intercept = float(config.get("intercept", 0.0))
    slope = float(config.get("slope", 1.0))
    p = (probability_pct.astype(float) / 100.0).clip(1e-6, 1.0 - 1e-6)
    logit = np.log(p / (1.0 - p))
    calibrated = 1.0 / (1.0 + np.exp(-(intercept + slope * logit)))
    return (calibrated * 100.0).clip(0.0, 100.0), {
        "status": "platt_logit_oos",
        "sample_size": sample_size,
        "intercept": intercept,
        "slope": slope,
    }


def apply_component_disagreement_haircut(
    probability_pct: pd.Series,
    components: list[pd.Series],
    market_probability_pct: pd.Series,
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    matrix = np.vstack([component.astype(float).values for component in components])
    spread = pd.Series(np.nanmax(matrix, axis=0) - np.nanmin(matrix, axis=0), index=probability_pct.index)
    requested = (
        (spread - COMPONENT_DISAGREEMENT_THRESHOLD).clip(lower=0.0)
        * DISAGREEMENT_HAIRCUT_STRENGTH
    ).clip(upper=DISAGREEMENT_HAIRCUT_MAX_PP)
    delta = probability_pct.astype(float) - market_probability_pct.astype(float)
    distance = delta.abs()
    haircut = pd.concat([requested, distance], axis=1).min(axis=1)
    direction = pd.Series(np.sign(delta), index=probability_pct.index)
    adjusted = (probability_pct.astype(float) - direction * haircut).clip(0.0, 100.0)
    conflict = spread >= STRONG_MARKET_CONFLICT_THRESHOLD
    return adjusted, haircut, spread, conflict


def finalize_two_way_probabilities(
    hist_a: pd.Series,
    hist_b: pd.Series,
    sim_a: pd.Series,
    sim_b: pd.Series,
    market_a: pd.Series,
    market_b: pd.Series,
    weights: list[float],
    shrink: float,
    market_key: str,
) -> dict[str, object]:
    paired = (
        np.isfinite(market_a.astype(float)) & np.isfinite(market_b.astype(float))
    )
    raw_a = weighted_mix_pct([hist_a, sim_a, market_a], weights)
    raw_b = weighted_mix_pct([hist_b, sim_b, market_b], weights)
    total = raw_a + raw_b
    valid_total = np.isfinite(total) & (total > 0) & paired
    normalized_a = pd.Series(np.nan, index=hist_a.index, dtype=float)
    normalized_a.loc[valid_total] = raw_a.loc[valid_total] / total.loc[valid_total] * 100.0
    heuristic_a = calibrate(normalized_a, shrink=shrink)
    oos_a, calibration = apply_oos_calibration(market_key, heuristic_a)
    final_a, haircut, spread, conflict = apply_component_disagreement_haircut(
        oos_a,
        [hist_a, sim_a, market_a],
        market_a,
    )
    final_a = final_a.where(valid_total)
    final_b = (100.0 - final_a).where(valid_total)
    return {
        "a": final_a.round(2),
        "b": final_b.round(2),
        "raw_a": normalized_a.round(2),
        "pre_haircut_a": oos_a.round(2),
        "haircut": haircut.round(2),
        "spread": spread.round(2),
        "conflict": conflict.fillna(False),
        "paired": pd.Series(paired, index=hist_a.index),
        "calibration": calibration,
    }


def _is_value_pick(
    prob,
    odd,
    min_prob: float = MIN_PROB,
    min_odd: float = MIN_ODD,
    max_odd: float = MAX_ODD,
    buffer: float = VALUE_BUFFER,
    min_edge: float = 0.0,
) -> bool:
    try:
        if pd.isna(prob) or pd.isna(odd):
            return False
        prob = float(prob)
        odd = float(odd)
    except Exception:
        return False

    if prob <= 0:
        return False
    if prob < float(min_prob):
        return False
    if odd < float(min_odd):
        return False
    if odd > float(max_odd):
        return False

    odd_valor = 100.0 / prob
    edge = (odd * prob / 100.0 - 1.0) * 100.0
    return odd >= odd_valor * float(buffer) and edge >= float(min_edge)


def _passes_cv_filter(row: pd.Series, min_cv: float) -> bool:
    """Exige consistência mínima dos dois times para o mercado."""
    try:
        cv_home = float(row.get("CV Gols Marcados Casa"))
        cv_away = float(row.get("CV Gols Marcados Visitante"))
    except Exception:
        return False

    if not np.isfinite(cv_home) or not np.isfinite(cv_away):
        return False
    return (cv_home >= float(min_cv)) and (cv_away >= float(min_cv))


def _market_thresholds(mercado: str, pick: str = "") -> tuple[float, float, float]:
    """Return minimum probability, consistency and edge by market."""
    mercado = str(mercado).strip().lower()
    pick = str(pick).strip().lower()

    if mercado == "over/under gols":
        return MIN_PROB_OU, MIN_CV_OU, MIN_EDGE_OU
    if mercado == "btts":
        return MIN_PROB_BTTS, MIN_CV_BTTS, MIN_EDGE_BTTS
    if mercado == "primeiro a marcar":
        if pick == "sem gol":
            return MIN_PROB_SEM_GOL, MIN_CV_SEM_GOL, MIN_EDGE_BTTS
        return MIN_PROB_FIRST, MIN_CV_FIRST, MIN_EDGE_BTTS
    return MIN_PROB, MIN_CV_MARKED, MIN_EDGE_OU


def apply_value_filter(
    base: pd.DataFrame,
    prob_col: str,
    odd_col: str,
    min_prob: float = MIN_PROB,
    min_cv: float | None = None,
    min_edge: float = 0.0,
) -> pd.DataFrame:
    """Aplica filtro de valor, faixa de odd, probabilidade mínima e CV mínimo do mercado."""
    base = base.copy()

    def _row_ok(r: pd.Series) -> bool:
        value_ok = _is_value_pick(
            r.get(prob_col), r.get(odd_col), min_prob=min_prob, min_edge=min_edge
        )
        if not value_ok:
            return False
        if min_cv is None:
            return True
        return _passes_cv_filter(r, min_cv=min_cv)

    mask = base.apply(_row_ok, axis=1)
    base.loc[~mask, [prob_col, odd_col]] = np.nan
    return base


def _safe_break_even_pct(odd: pd.Series) -> pd.Series:
    odd = odd.astype(float)
    out = pd.Series(np.nan, index=odd.index, dtype=float)
    valid = np.isfinite(odd) & (odd > 1.0)
    out.loc[valid] = 100.0 / odd.loc[valid]
    return out


def add_ou_goal_cost_and_filter(
    base: pd.DataFrame,
    prob_col: str,
    odd_col: str,
    linha: float,
    side: str,
) -> pd.DataFrame:
    """
    Aplica custo de gol apenas em Over/Under.

    Over:  margem = Exp. Gols Modelo - linha
    Under: margem = linha - Exp. Gols Modelo

    A pick só permanece se:
      - margem favorável >= MIN_MARGEM_GOL_OU
      - custo de gol <= MAX_CUSTO_GOL_OU
    """
    base = base.copy()
    line_key = f"{float(linha)}"
    margem_col = f"{side} {line_key} Margem Gol"
    custo_col = f"{side} {line_key} Custo Gol"

    lambda_total = base["Lambda Total"].astype(float)
    odd = base[odd_col].astype(float)

    if side == "Over":
        margem = lambda_total - float(linha)
    elif side == "Under":
        margem = float(linha) - lambda_total
    else:
        raise ValueError(f"side inválido para custo OU: {side}")

    break_even = _safe_break_even_pct(odd)
    custo = pd.Series(np.nan, index=base.index, dtype=float)
    ok_cost = np.isfinite(margem) & np.isfinite(break_even) & (margem > 0)
    custo.loc[ok_cost] = break_even.loc[ok_cost] / margem.loc[ok_cost]

    base[margem_col] = margem.round(3)
    base[custo_col] = custo.round(2)

    mask_cost = (margem >= MIN_MARGEM_GOL_OU) & (custo <= MAX_CUSTO_GOL_OU)
    base.loc[~mask_cost, [prob_col, odd_col]] = np.nan
    return base


def add_btts_cost_indicators(base: pd.DataFrame) -> pd.DataFrame:
    """Indicador técnico para BTTS Sim. Não filtra automaticamente."""
    base = base.copy()
    strength = np.minimum(base["Lambda Casa"].astype(float), base["Lambda Visitante"].astype(float))
    odd = base["Odd BTTS Sim"].astype(float) if "Odd BTTS Sim" in base.columns else pd.Series(np.nan, index=base.index)
    break_even = _safe_break_even_pct(odd)

    cost = pd.Series(np.nan, index=base.index, dtype=float)
    ok = np.isfinite(strength) & np.isfinite(break_even) & (strength > 0)
    cost.loc[ok] = break_even.loc[ok] / strength.loc[ok]

    base["BTTS Sim Força Gols"] = pd.Series(strength, index=base.index).round(3)
    base["BTTS Sim Custo"] = cost.round(2)
    return base


def add_first_goal_cost_indicators(base: pd.DataFrame, sim_ng_pct: pd.Series) -> pd.DataFrame:
    """Indicadores técnicos para Primeiro a Marcar. Não filtra automaticamente."""
    base = base.copy()
    eps = 1e-9
    lam_h = base["Lambda Casa"].astype(float)
    lam_a = base["Lambda Visitante"].astype(float)
    lam_t = (lam_h + lam_a).replace(0, np.nan)

    share_h = lam_h / (lam_t + eps)
    share_a = lam_a / (lam_t + eps)
    share_ng = sim_ng_pct.astype(float) / 100.0

    mappings = [
        ("Casa 1º a Marcar", share_h, "Odd Casa 1º a Marcar"),
        ("Visitante 1º a Marcar", share_a, "Odd Visitante 1º a Marcar"),
        ("Sem Gol", share_ng, "Odd Sem Gol"),
    ]

    for prefix, strength, odd_col in mappings:
        odd = base[odd_col].astype(float) if odd_col in base.columns else pd.Series(np.nan, index=base.index)
        break_even = _safe_break_even_pct(odd)
        cost = pd.Series(np.nan, index=base.index, dtype=float)
        ok = np.isfinite(strength) & np.isfinite(break_even) & (strength > 0)
        cost.loc[ok] = break_even.loc[ok] / strength.loc[ok]

        base[f"{prefix} Força %"] = (pd.Series(strength, index=base.index) * 100.0).round(2)
        base[f"{prefix} Custo"] = cost.round(2)

    return base

# ------------------------------------------------------------
# SIMULAÇÃO: Poisson-Gamma bivariado
# ------------------------------------------------------------
def simulate_poisson_gamma_bivariate(lam_home: np.ndarray,
                                     lam_away: np.ndarray,
                                     alpha,
                                     n_sims: int,
                                     seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    lam_home = np.asarray(lam_home, dtype=float)
    lam_away = np.asarray(lam_away, dtype=float)

    lam_home = np.clip(lam_home, 0.0, None)
    lam_away = np.clip(lam_away, 0.0, None)

    rng = np.random.default_rng(seed)
    n_games = lam_home.shape[0]

    alpha_values = np.asarray(alpha, dtype=float)
    if alpha_values.ndim == 0:
        alpha_values = np.full(n_games, float(alpha_values), dtype=float)
    alpha_values = np.broadcast_to(alpha_values, (n_games,)).astype(float)
    if not np.isfinite(alpha_values).any() or np.nanmax(alpha_values) <= 0:
        home = rng.poisson(lam_home[:, None], size=(n_games, n_sims))
        away = rng.poisson(lam_away[:, None], size=(n_games, n_sims))
        return home, away

    safe_alpha = np.where(np.isfinite(alpha_values) & (alpha_values > 0), alpha_values, 1e-9)
    k = (1.0 / safe_alpha)[:, None]
    g = rng.gamma(shape=k, scale=1.0 / k, size=(n_games, n_sims))
    home = rng.poisson(lam_home[:, None] * g)
    away = rng.poisson(lam_away[:, None] * g)
    return home, away

# ------------------------------------------------------------
# MODELO DE FORÇAS: baseline liga + attack/defense + shrink por CV
# ------------------------------------------------------------
LEAGUE_KEYS = ["Pais", "Sigla", "Liga"]


def _gamma_from_cv(cv: pd.Series) -> pd.Series:
    g = (cv - 40.0) / 40.0
    return g.clip(lower=0.2, upper=0.9)


def estimate_share_home_from_averages(merged: pd.DataFrame, mu_home_for: pd.Series, mu_away_for: pd.Series) -> pd.Series:
    eps = 1e-9
    ratio = (mu_home_for / (mu_home_for + mu_away_for + eps)).astype(float)
    ratio = ratio.where(np.isfinite(ratio), np.nan)
    ratio = ratio.clip(lower=SHARE_HOME_CLIP[0], upper=SHARE_HOME_CLIP[1])

    global_share = np.nanmedian(ratio.values)
    if not np.isfinite(global_share):
        global_share = DEFAULT_SHARE_HOME
    global_share = float(np.clip(global_share, SHARE_HOME_CLIP[0], SHARE_HOME_CLIP[1]))

    tmp = merged[LEAGUE_KEYS].copy()
    tmp["_ratio"] = ratio.values
    share_by_league = (
        tmp.groupby(LEAGUE_KEYS, dropna=False)["_ratio"]
           .median().reset_index()
           .rename(columns={"_ratio": "_share_home"})
    )

    merged2 = merged.merge(share_by_league, on=LEAGUE_KEYS, how="left")
    sh = merged2["_share_home"].astype(float).fillna(global_share).fillna(DEFAULT_SHARE_HOME)
    sh = sh.clip(lower=SHARE_HOME_CLIP[0], upper=SHARE_HOME_CLIP[1])
    return sh


def build_league_season_baselines(merged: pd.DataFrame) -> pd.DataFrame:
    out = merged.copy()
    out["_season"] = pd.to_datetime(out["Data/Hora"], errors="coerce").dt.year.fillna(0).astype(int)
    config = load_goalmatrix_calibration().get("league_baselines", {})
    totals = []
    shares = []
    statuses = []
    for _, row in out.iterrows():
        country = str(row.get("Pais") or "")
        league = str(row.get("Liga") or "")
        candidate_keys = (
            "|".join(str(row.get(column) or "") for column in LEAGUE_KEYS),
            f"{country} - {league}",
            league,
        )
        item = next((config[key] for key in candidate_keys if isinstance(config, dict) and key in config), {})
        sample_size = int(item.get("sample_size") or 0)
        active = bool(item.get("active")) and bool(item.get("out_of_sample")) and sample_size >= 50
        source_total = float(row.get("Média Gols Liga_20")) if pd.notna(row.get("Média Gols Liga_20")) else L_TOTAL_DEFAULT
        source_total = float(np.clip(source_total, L_TOTAL_CLIP[0], L_TOTAL_CLIP[1]))
        if active:
            reliability = sample_size / (sample_size + 100.0)
            total = reliability * float(item.get("total_mean", source_total)) + (1.0 - reliability) * source_total
            share = reliability * float(item.get("home_share", DEFAULT_SHARE_HOME)) + (1.0 - reliability) * DEFAULT_SHARE_HOME
            statuses.append("league_oos_shrunk")
        else:
            total = 0.75 * source_total + 0.25 * L_TOTAL_DEFAULT
            share = DEFAULT_SHARE_HOME
            statuses.append("external_league20_plus_global_prior")
        totals.append(float(np.clip(total, L_TOTAL_CLIP[0], L_TOTAL_CLIP[1])))
        shares.append(float(np.clip(share, SHARE_HOME_CLIP[0], SHARE_HOME_CLIP[1])))
    out["_L_total"] = totals
    out["_share_home"] = shares
    out["_league_baseline_status"] = statuses
    return out


def league_alpha_series(merged: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    config = load_goalmatrix_calibration().get("league_alpha", {})
    values = []
    statuses = []
    for _, row in merged.iterrows():
        country = str(row.get("Pais") or "")
        league = str(row.get("Liga") or "")
        candidate_keys = (
            "|".join(str(row.get(column) or "") for column in LEAGUE_KEYS),
            f"{country} - {league}",
            league,
        )
        item = {}
        if isinstance(config, dict):
            item = next((config[key] for key in candidate_keys if key in config), {})
        sample_size = int(item.get("sample_size") or 0)
        active = bool(item.get("active")) and bool(item.get("out_of_sample")) and sample_size >= 50
        if active:
            observed = float(item.get("alpha", ALPHA_DEFAULT))
            shrink = sample_size / (sample_size + 100.0)
            values.append(float(np.clip(shrink * observed + (1.0 - shrink) * ALPHA_DEFAULT, 0.0, 0.50)))
            statuses.append("league_oos_shrunk")
        else:
            values.append(ALPHA_DEFAULT)
            statuses.append("global_prior_insufficient_oos")
    return pd.Series(values, index=merged.index), pd.Series(statuses, index=merged.index)


def build_lambdas_force_model(
    merged: pd.DataFrame,
    mu_home_for: pd.Series,
    mu_away_for: pd.Series,
    mu_home_against: pd.Series,
    mu_away_against: pd.Series,
) -> tuple[pd.Series, pd.Series, pd.DataFrame]:
    eps = 1e-6
    merged2 = build_league_season_baselines(merged)
    L_total = merged2["_L_total"].astype(float)

    L_home = (L_total * merged2["_share_home"]).clip(lower=eps)
    L_away = (L_total * (1.0 - merged2["_share_home"])).clip(lower=eps)

    cvh = merged2["_cv_idx_home_20"].astype(float).fillna(merged2["_cv_game"]).fillna(70.0)
    cva = merged2["_cv_idx_away_20"].astype(float).fillna(merged2["_cv_game"]).fillna(70.0)

    gamma_home = _gamma_from_cv(cvh) * merged2["_feature_reliability_home"].fillna(0.0)
    gamma_away = _gamma_from_cv(cva) * merged2["_feature_reliability_away"].fillna(0.0)

    merged2["_gamma_home"] = gamma_home
    merged2["_gamma_away"] = gamma_away

    A_home_raw = (mu_home_for / L_home).clip(lower=FORCE_RAW_CLIP[0], upper=FORCE_RAW_CLIP[1])
    D_away_raw = (mu_away_against / L_home).clip(lower=FORCE_RAW_CLIP[0], upper=FORCE_RAW_CLIP[1])

    A_away_raw = (mu_away_for / L_away).clip(lower=FORCE_RAW_CLIP[0], upper=FORCE_RAW_CLIP[1])
    D_home_raw = (mu_home_against / L_away).clip(lower=FORCE_RAW_CLIP[0], upper=FORCE_RAW_CLIP[1])

    A_home = 1.0 + gamma_home * (A_home_raw - 1.0)
    D_home = 1.0 + gamma_home * (D_home_raw - 1.0)
    A_away = 1.0 + gamma_away * (A_away_raw - 1.0)
    D_away = 1.0 + gamma_away * (D_away_raw - 1.0)

    lam_home = (L_home * (A_home * D_away) ** LAMBDA_POWER).clip(lower=LAMBDA_CLIP[0], upper=LAMBDA_CLIP[1]).fillna(0.0)
    lam_away = (L_away * (A_away * D_home) ** LAMBDA_POWER).clip(lower=LAMBDA_CLIP[0], upper=LAMBDA_CLIP[1]).fillna(0.0)

    merged2["_L_home"] = L_home
    merged2["_L_away"] = L_away
    return lam_home, lam_away, merged2

# ------------------------------------------------------------
# EXPORTAÇÃO LOVABLE
# ------------------------------------------------------------
def _fmt_obs_num(value, nd: int = 2, signed: bool = False) -> str:
    try:
        if pd.isna(value):
            return "-"
        value = float(value)
        if not np.isfinite(value):
            return "-"
        sign = "+" if signed else ""
        return f"{value:{sign}.{nd}f}"
    except Exception:
        return "-"


def _format_match_datetime(row: pd.Series) -> str:
    dth = row.get("Data/Hora")
    if pd.notna(dth):
        return dth.strftime("%d-%m-%Y / %H:%M")
    return "Data/Hora inválida"


def _pick_technical_line(row: pd.Series, mercado: str = "", pick: str = "", linha=None) -> str:
    if mercado == "Over/Under Gols" and linha not in (None, ""):
        line_key = f"{float(linha)}"
        prob = row.get(f"{pick} {line_key} Gols prob")
        margem = row.get(f"{pick} {line_key} Margem Gol")
        custo = row.get(f"{pick} {line_key} Custo Gol")
        return (
            f"  • Linha {line_key}: {pick} {_fmt_obs_num(prob, 2)}% | "
            f"Margem: {_fmt_obs_num(margem, 2, signed=True)} | Custo Gol: {_fmt_obs_num(custo, 2)}"
        )
    if mercado == "BTTS" and pick == "BTTS Sim":
        return (
            f"  • BTTS Sim {_fmt_obs_num(row.get('BTTS Sim prob'), 2)}% | "
            f"Força BTTS: {_fmt_obs_num(row.get('BTTS Sim Força Gols'), 3)} | "
            f"Custo BTTS: {_fmt_obs_num(row.get('BTTS Sim Custo'), 2)}"
        )
    if mercado == "Primeiro a Marcar":
        if pick == "Casa":
            label = "Casa 1º Gol"
            prefix = "Casa 1º a Marcar"
        elif pick == "Visitante":
            label = "Visitante 1º Gol"
            prefix = "Visitante 1º a Marcar"
        elif pick == "Sem Gol":
            label = "Sem Gol"
            prefix = "Sem Gol"
        else:
            label = pick
            prefix = pick
        return (
            f"  • {label}: {_fmt_obs_num(row.get(f'{prefix} prob'), 2)}% | "
            f"Força: {_fmt_obs_num(row.get(f'{prefix} Força %'), 2)} | "
            f"Custo: {_fmt_obs_num(row.get(f'{prefix} Custo'), 2)}"
        )
    return ""


def _technical_context(row: pd.Series, mercado: str = "", pick: str = "", linha=None) -> str:
    home = str(row.get("Time Casa", "") or "").strip()
    away = str(row.get("Time Visitante", "") or "").strip()
    home_rank = _fmt_obs_num(row.get("Colocação Time Casa"), 0)
    away_rank = _fmt_obs_num(row.get("Colocação Time Visitante"), 0)
    lines = [
        f"Confronto: {home} ({home_rank}°) vs {away} ({away_rank}°)",
        _country_league(row),
        f"Data/Hora: {_format_match_datetime(row)}",
        "--- DADOS TÉCNICOS ---",
        f"Média Marcados Casa:           {_fmt_obs_num(row.get('Média Marcados Casa'), 2)}",
        f"Média Sofridos Casa:           {_fmt_obs_num(row.get('Média Sofridos Casa'), 2)}",
        f"Média Marcados Visitante:      {_fmt_obs_num(row.get('Média Marcados Visitante'), 2)}",
        f"Média Sofridos Visitante:      {_fmt_obs_num(row.get('Média Sofridos Visitante'), 2)}",
        (
            "Força esperada gols C/V/T:     "
            f"{_fmt_obs_num(row.get('Lambda Casa'), 3)} / "
            f"{_fmt_obs_num(row.get('Lambda Visitante'), 3)} / "
            f"{_fmt_obs_num(row.get('Lambda Total'), 3)}"
        ),
        f"Exp. de Gols (modelo):         {_fmt_obs_num(row.get('Lambda Total'), 2)}",
        f"Exp. de Gols (Packball):       {_fmt_obs_num(row.get('Expectativa de Gols'), 2)}",
        f"Média Gols Liga:               {_fmt_obs_num(row.get('Média Gols Liga'), 2)}",
        f"Odd Casa MO:                   {_fmt_obs_num(row.get('Odd Casa MO'), 2)}",
        f"Odd Visitante MO:              {_fmt_obs_num(row.get('Odd Visitante MO'), 2)}",
        f"CV Gols Marcados Casa:         {_fmt_obs_num(row.get('CV Gols Marcados Casa'), 2)}%",
        f"CV Gols Marcados Visitante:    {_fmt_obs_num(row.get('CV Gols Marcados Visitante'), 2)}%",
        "--- OCORRÊNCIAS (HIST - MÉDIAS) ---",
        (
            "BTTS Sim/Não (avg):            "
            f"{_fmt_obs_num(row.get('Occ BTTS Sim Avg'), 2)}% / "
            f"{_fmt_obs_num(row.get('Occ BTTS Não Avg'), 2)}%"
        ),
        (
            "1º Gol Casa/Vis/Sem Gol:       "
            f"{_fmt_obs_num(row.get('Occ Casa 1º Gol'), 2)}% / "
            f"{_fmt_obs_num(row.get('Occ Visit 1º Gol'), 2)}% / "
            f"{_fmt_obs_num(row.get('Occ Sem Gol'), 2)}%"
        ),
        "--- H2H (INSIGHTS) ---",
        (
            f"Over 1.5: {_fmt_obs_num(row.get('H2H Over 1.5'), 2)}% | "
            f"Over 2.5: {_fmt_obs_num(row.get('H2H Over 2.5'), 2)}% | "
            f"Over 3.5: {_fmt_obs_num(row.get('H2H Over 3.5'), 2)}%"
        ),
        (
            f"BTTS Sim: {_fmt_obs_num(row.get('H2H BTTS Sim'), 2)}% | "
            f"Casa 1º Gol: {_fmt_obs_num(row.get('H2H Casa 1º Gol'), 2)}% | "
            f"Visit 1º Gol: {_fmt_obs_num(row.get('H2H Visit 1º Gol'), 2)}%"
        ),
    ]
    detail = _pick_technical_line(row, mercado=mercado, pick=pick, linha=linha)
    if detail:
        lines.append(detail)
    return "\n".join(line for line in lines if line and str(line).strip())


def _fmt_obs(row: pd.Series, mercado: str = "", pick: str = "", linha=None) -> str:
    base_obs = (
        f"Média de Gols Marcados/Sofridos: Casa {_fmt_obs_num(row.get('Média Marcados Casa'), 2)}/"
        f"{_fmt_obs_num(row.get('Média Sofridos Casa'), 2)}; Visitante {_fmt_obs_num(row.get('Média Marcados Visitante'), 2)}/"
        f"{_fmt_obs_num(row.get('Média Sofridos Visitante'), 2)} | "
        f"Força esperada de gols: Casa {_fmt_obs_num(row.get('Lambda Casa'), 3)}; "
        f"Visitante {_fmt_obs_num(row.get('Lambda Visitante'), 3)}; Total {_fmt_obs_num(row.get('Lambda Total'), 3)} | "
        f"Exp Gols Modelo: {_fmt_obs_num(row.get('Lambda Total'), 2)} | "
        f"Média Gols Liga: {_fmt_obs_num(row.get('Média Gols Liga'), 2)} | "
        f"CV Times: Casa {_fmt_obs_num(row.get('CV Gols Marcados Casa'), 2)}%; "
        f"Visitante {_fmt_obs_num(row.get('CV Gols Marcados Visitante'), 2)}%"
    )

    extra = ""
    if mercado == "Over/Under Gols" and linha not in (None, ""):
        line_key = f"{float(linha)}"
        margem = row.get(f"{pick} {line_key} Margem Gol")
        custo = row.get(f"{pick} {line_key} Custo Gol")
        extra = (
            f" | Margem Gols Modelo ({pick} {line_key}): {_fmt_obs_num(margem, 2, signed=True)}; "
            f"Custo de Gol: {_fmt_obs_num(custo, 2)}"
        )
    elif mercado == "BTTS" and pick == "BTTS Sim":
        extra = (
            f" | Força BTTS Sim: {_fmt_obs_num(row.get('BTTS Sim Força Gols'), 3)}; "
            f"Custo BTTS Sim: {_fmt_obs_num(row.get('BTTS Sim Custo'), 2)}"
        )
    elif mercado == "Primeiro a Marcar":
        if pick == "Casa":
            prefix = "Casa 1º a Marcar"
        elif pick == "Visitante":
            prefix = "Visitante 1º a Marcar"
        elif pick == "Sem Gol":
            prefix = "Sem Gol"
        else:
            prefix = ""
        if prefix:
            extra = (
                f" | Força {prefix}: {_fmt_obs_num(row.get(f'{prefix} Força %'), 2)}%; "
                f"Custo {prefix}: {_fmt_obs_num(row.get(f'{prefix} Custo'), 2)}"
            )

    return base_obs + extra



def _lovable_pick_label(mercado: str, pick: str) -> str:
    """
    Mantém o campo 'mercado' do Lovable como o nome do modelo,
    e usa o campo 'pick' para identificar a seleção validada.
    """
    mercado_norm = str(mercado).strip().lower()
    pick_norm = str(pick).strip()

    if mercado_norm == "primeiro a marcar":
        mapping = {
            "Casa": "Casa Marcar Primeiro",
            "Visitante": "Visitante Marcar Primeiro",
            "Sem Gol": "Sem Gol",
        }
        return mapping.get(pick_norm, pick_norm)

    return pick_norm


def _country_league(row: pd.Series) -> str:
    pais = str(row.get("Pais", "") or "").strip()
    liga = str(row.get("Liga", "") or "").strip()
    if pais and liga:
        prefix = pais.casefold() + " - "
        if liga.casefold().startswith(prefix):
            return liga
        return f"{pais} - {liga}"
    return liga or pais


def _pick_probability_diagnostics(row: pd.Series, mercado: str, pick: str, linha) -> dict:
    if mercado == "Over/Under Gols" and linha not in (None, ""):
        key = f"{float(linha)}"
        is_over = pick == "Over"
        hist_over = float(row.get(f"OU {key} Hist Over"))
        sim_over = float(row.get(f"OU {key} Sim Over"))
        vig_over = float(row.get(f"OU {key} NoVig Over"))
        raw_over = float(row.get(f"OU {key} Prob Raw Over"))
        pre_over = float(row.get(f"OU {key} Prob PreHaircut Over"))
        return {
            "market_type": "OU",
            "selection_side": pick.upper(),
            "prob_hist": hist_over if is_over else 100.0 - hist_over,
            "prob_sim": sim_over if is_over else 100.0 - sim_over,
            "prob_no_vig": vig_over if is_over else 100.0 - vig_over,
            "prob_raw": raw_over if is_over else 100.0 - raw_over,
            "prob_pre_haircut": pre_over if is_over else 100.0 - pre_over,
            "haircut_pp": float(row.get(f"OU {key} Haircut")),
            "component_spread_pp": float(row.get(f"OU {key} Spread")),
            "market_conflict_status": row.get(f"OU {key} Conflict"),
            "calibration_status": row.get(f"OU {key} Calibration"),
        }
    if mercado == "BTTS":
        is_yes = pick == "BTTS Sim"
        hist_yes = float(row.get("BTTS Hist Sim"))
        sim_yes = float(row.get("BTTS Sim Model"))
        vig_yes = float(row.get("BTTS NoVig Sim"))
        raw_yes = float(row.get("BTTS Prob Raw Sim"))
        pre_yes = float(row.get("BTTS Prob PreHaircut Sim"))
        return {
            "market_type": "BTTS",
            "selection_side": "SIM" if is_yes else "NAO",
            "prob_hist": hist_yes if is_yes else 100.0 - hist_yes,
            "prob_sim": sim_yes if is_yes else 100.0 - sim_yes,
            "prob_no_vig": vig_yes if is_yes else 100.0 - vig_yes,
            "prob_raw": raw_yes if is_yes else 100.0 - raw_yes,
            "prob_pre_haircut": pre_yes if is_yes else 100.0 - pre_yes,
            "haircut_pp": float(row.get("BTTS Haircut")),
            "component_spread_pp": float(row.get("BTTS Spread")),
            "market_conflict_status": row.get("BTTS Conflict"),
            "calibration_status": row.get("BTTS Calibration"),
        }
    return {"market_type": mercado, "selection_side": pick}


def _diagnostic_text(row: pd.Series, diagnostics: dict) -> str:
    return (
        f"modelo_versao={MODEL_VERSION}; market_type={diagnostics.get('market_type')}; "
        f"prob_hist={_fmt_obs_num(diagnostics.get('prob_hist'), 2)}; "
        f"prob_sim={_fmt_obs_num(diagnostics.get('prob_sim'), 2)}; "
        f"prob_no_vig={_fmt_obs_num(diagnostics.get('prob_no_vig'), 2)}; "
        f"prob_raw={_fmt_obs_num(diagnostics.get('prob_raw'), 2)}; "
        f"prob_pre_haircut={_fmt_obs_num(diagnostics.get('prob_pre_haircut'), 2)}; "
        f"haircut_pp={_fmt_obs_num(diagnostics.get('haircut_pp'), 2)}; "
        f"component_spread_pp={_fmt_obs_num(diagnostics.get('component_spread_pp'), 2)}; "
        f"market_conflict_status={diagnostics.get('market_conflict_status') or 'ALINHADO'}; "
        f"calibration_status={diagnostics.get('calibration_status') or 'identity'}; "
        f"w_recent10={_fmt_obs_num(row.get('w10'), 3)}; "
        f"w_venue20={_fmt_obs_num(row.get('w20'), 3)}; "
        f"feature_reliability={_fmt_obs_num(row.get('Feature Reliability'), 3)}; "
        f"league_baseline_status={row.get('League Baseline Status')}; "
        f"alpha={_fmt_obs_num(row.get('Alpha Liga'), 4)}; alpha_status={row.get('Alpha Status')}; "
        f"input_hash_10={RUN_PROVENANCE.get('sha256_10', '-')}; "
        f"input_hash_20={RUN_PROVENANCE.get('sha256_20', '-')}; "
        f"schema_hash={RUN_PROVENANCE.get('schema_hash', '-')}"
    )

def _add_lovable_row(rows: list[dict], row: pd.Series, mercado: str, pick: str, linha, prob, odd) -> None:
    min_prob, min_cv, min_edge = _market_thresholds(mercado, pick)
    if not _is_value_pick(prob, odd, min_prob=min_prob, min_edge=min_edge):
        return
    if not _passes_cv_filter(row, min_cv=min_cv):
        return

    prob = float(prob)
    odd = float(odd)
    odd_valor = 100.0 / prob
    edge = ((odd * prob / 100.0) - 1.0) * 100.0
    diagnostics = _pick_probability_diagnostics(row, mercado, pick, linha)
    diagnostic_text = _diagnostic_text(row, diagnostics)
    technical_context = _technical_context(row, mercado=mercado, pick=pick, linha=linha)
    technical_context = f"{technical_context}\n--- MODELO ---\n{diagnostic_text}"

    dth = row.get("Data/Hora")
    data = dth.strftime("%d/%m/%Y") if pd.notna(dth) else ""
    hora = dth.strftime("%H:%M") if pd.notna(dth) else ""
    mandante = str(row.get("Time Casa", ""))
    visitante = str(row.get("Time Visitante", ""))

    rows.append({
        "data": data,
        "hora": hora,
        "esporte": "Futebol",
        "liga": _country_league(row),
        "jogo": f"{mandante} vs {visitante}",
        "mandante": mandante,
        "visitante": visitante,
        "mercado": MODEL_NAME,
        "pick": _lovable_pick_label(mercado, pick),
        "linha": linha if linha is not None else "",
        "odd_ofertada": round(odd, 2),
        "odd_valor": round(odd_valor, 2),
        "probabilidade_final": round(prob, 2),
        "edge": round(edge, 2),
        "modelo_versao": MODEL_VERSION,
        "market_type": diagnostics.get("market_type"),
        "selection_side": diagnostics.get("selection_side"),
        "market_conflict_status": diagnostics.get("market_conflict_status") or "ALINHADO",
        "prob_hist": round(float(diagnostics.get("prob_hist")), 2),
        "prob_sim": round(float(diagnostics.get("prob_sim")), 2),
        "prob_no_vig": round(float(diagnostics.get("prob_no_vig")), 2),
        "prob_raw": round(float(diagnostics.get("prob_raw")), 2),
        "prob_pre_haircut": round(float(diagnostics.get("prob_pre_haircut")), 2),
        "haircut_pp": round(float(diagnostics.get("haircut_pp")), 2),
        "component_spread_pp": round(float(diagnostics.get("component_spread_pp")), 2),
        "calibration_status": diagnostics.get("calibration_status"),
        "observacoes": _fmt_obs(row, mercado=mercado, pick=pick, linha=linha) + " | " + diagnostic_text,
        "dados_tecnicos": technical_context,
        "contexto_adicional": technical_context,
        "contexto_modelo": technical_context,
    })


def kelly_stake_units(probability_pct, odd, *, conflict: bool = False) -> float:
    try:
        probability = float(probability_pct) / 100.0
        decimal_odd = float(odd)
    except (TypeError, ValueError):
        return 0.0
    if not (0.0 < probability < 1.0) or decimal_odd <= 1.0:
        return 0.0
    b = decimal_odd - 1.0
    full_kelly = max(0.0, (b * probability - (1.0 - probability)) / b)
    units = min(MAX_PICK_UNITS, full_kelly * KELLY_FRACTION * 10.0)
    if conflict:
        units = min(units, 0.25)
    return math.floor(units * 4.0 + 1e-9) / 4.0


def limit_correlated_picks(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        grouped.setdefault((str(row.get("jogo")), str(row.get("market_type"))), []).append(row)
    selected: list[dict] = []
    for (_game, market_type), group in grouped.items():
        ranked = sorted(group, key=lambda item: float(item.get("edge") or 0.0), reverse=True)
        if not ranked:
            continue
        if market_type == "OU":
            principal = ranked[0]
            same_side = [item for item in ranked if item.get("selection_side") == principal.get("selection_side")]
            principal_line = float(principal.get("linha"))
            same_side.sort(
                key=lambda item: (
                    0 if item is principal else 1,
                    abs(float(item.get("linha")) - principal_line),
                    -float(item.get("edge") or 0.0),
                )
            )
            chosen = same_side[:MAX_CORRELATED_LINES]
        else:
            chosen = ranked[:1]
        for index, item in enumerate(chosen):
            if item.get("market_conflict_status") == "CONFLITO_FORTE_COM_MERCADO":
                item["selection_role"] = "RESERVA_CONFLITO_MERCADO"
            else:
                item["selection_role"] = "PRINCIPAL" if index == 0 else "ALTERNATIVA"
        selected.extend(chosen)
    return selected


def apply_exposure_caps(rows: list[dict]) -> list[dict]:
    game_used: dict[str, float] = {}
    market_used: dict[tuple[str, str], float] = {}
    kept: list[dict] = []
    ordered = sorted(
        rows,
        key=lambda item: (
            item.get("selection_role") == "RESERVA_CONFLITO_MERCADO",
            item.get("selection_role") != "PRINCIPAL",
            -float(item.get("edge") or 0.0),
        ),
    )
    for row in ordered:
        game = str(row.get("jogo") or "")
        market = str(row.get("market_type") or "")
        conflict = row.get("market_conflict_status") == "CONFLITO_FORTE_COM_MERCADO"
        requested = kelly_stake_units(row.get("probabilidade_final"), row.get("odd_ofertada"), conflict=conflict)
        available = min(
            MAX_GAME_UNITS - game_used.get(game, 0.0),
            MAX_MARKET_UNITS - market_used.get((game, market), 0.0),
            MAX_PICK_UNITS,
        )
        allocated = math.floor(max(0.0, min(requested, available)) * 4.0 + 1e-9) / 4.0
        if allocated < 0.25:
            continue
        row["stake"] = f"{allocated:.2f}".rstrip("0").rstrip(".") + "u"
        game_used[game] = game_used.get(game, 0.0) + allocated
        market_used[(game, market)] = market_used.get((game, market), 0.0) + allocated
        kept.append(row)
    return kept


def build_lovable_export(base: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, row in base.iterrows():
        for t in ths_ft:
            _add_lovable_row(
                rows, row,
                mercado="Over/Under Gols",
                pick="Over",
                linha=t,
                prob=row.get(f"Over {t} Gols prob"),
                odd=row.get(f"Odd Over {t} Gols"),
            )
            _add_lovable_row(
                rows, row,
                mercado="Over/Under Gols",
                pick="Under",
                linha=t,
                prob=row.get(f"Under {t} Gols prob"),
                odd=row.get(f"Odd Under {t} Gols"),
            )

        _add_lovable_row(rows, row, "BTTS", "BTTS Sim", "", row.get("BTTS Sim prob"), row.get("Odd BTTS Sim"))
        _add_lovable_row(rows, row, "BTTS", "BTTS Não", "", row.get("BTTS Não prob"), row.get("Odd BTTS Não"))

        if FIRST_GOAL_ENABLED:
            _add_lovable_row(rows, row, "Primeiro a Marcar", "Casa", "", row.get("Casa 1º a Marcar prob"), row.get("Odd Casa 1º a Marcar"))
            _add_lovable_row(rows, row, "Primeiro a Marcar", "Visitante", "", row.get("Visitante 1º a Marcar prob"), row.get("Odd Visitante 1º a Marcar"))
            _add_lovable_row(rows, row, "Primeiro a Marcar", "Sem Gol", "", row.get("Sem Gol prob"), row.get("Odd Sem Gol"))

    rows = apply_exposure_caps(limit_correlated_picks(rows))

    cols = [
        "data", "hora", "esporte", "liga", "jogo", "mandante", "visitante",
        "mercado", "pick", "linha", "odd_ofertada", "odd_valor",
        "probabilidade_final", "edge", "stake", "modelo_versao", "market_type", "selection_side",
        "selection_role", "market_conflict_status", "prob_hist", "prob_sim", "prob_no_vig",
        "prob_raw", "prob_pre_haircut", "haircut_pp", "component_spread_pp", "calibration_status",
        "observacoes", "dados_tecnicos", "contexto_adicional", "contexto_modelo",
    ]
    out = pd.DataFrame(rows, columns=cols)
    if not out.empty:
        out = out.sort_values(["data", "hora", "liga", "jogo", "mercado", "linha", "pick"]).reset_index(drop=True)
    return out

# ------------------------------------------------------------
# PIPELINE PRINCIPAL
# ------------------------------------------------------------
def main() -> tuple[pd.DataFrame, pd.DataFrame]:
    base_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1) Ler e normalizar (forma geral 10j + mando 20j)
    df10_raw, df20_raw = load_gols_data(date_str, base_dir)
    validate_source_schema(df10_raw, "10j")
    validate_source_schema(df20_raw, "20j")
    if list(df10_raw.columns) != list(df20_raw.columns):
        raise ValueError("GOALMATRIX_SCHEMA_MISMATCH:10j_vs_20j")
    df10 = coerce_numeric(normalize_columns(df10_raw))
    df20 = coerce_numeric(normalize_columns(df20_raw))
    validate_window_profile(df10, RECENT_WINDOW_GAMES, "recent10")
    validate_window_profile(df20, VENUE_WINDOW_GAMES, "venue20")

    df10 = sanitize_pct_like_columns(df10, "df10")
    df20 = sanitize_pct_like_columns(df20, "df20")

    sanity_check_ranges(df10, "df10")
    sanity_check_ranges(df20, "df20")

    # 2) Filtrar conforme RUN_MODE
    df10_f = filter_by_status_and_games(df10, STATUSES, min_games=MIN_RECENT_GAMES)
    df20_f = filter_by_status_and_games(df20, STATUSES, min_games=MIN_VENUE_GAMES)
    logging.info(f"RUN_MODE={RUN_MODE} | STATUS={STATUSES}")
    logging.info(f"df10_filtrado: {df10_f.shape} | df20_filtrado: {df20_f.shape}")

    # 3) Merge
    merged = merge_10_20(df10_f, df20_f)
    logging.info(f"merged (10+20) shape: {merged.shape}")

    # Odds e campos de contexto vêm do arquivo recente.
    for _c in ("Expectativa de Gols",):
        c20 = f"{_c}_20"
        if c20 in merged.columns:
            merged.drop(columns=[c20], inplace=True)

    # 4) Pesos dinâmicos
    merged = build_dynamic_weights(merged)

    # 5) Métricas blend + lambdas
    mu_home_marked = blend(merged, "Média Gols Marcados Casa")
    mu_away_marked = blend(merged, "Média Gols Marcados Visitante")
    mu_home_conceded = blend(merged, "Média Gols Sofridos Casa")
    mu_away_conceded = blend(merged, "Média Gols Sofridos Visitante")

    lambda_home, lambda_away, merged = build_lambdas_force_model(
        merged,
        mu_home_for=mu_home_marked,
        mu_away_for=mu_away_marked,
        mu_home_against=mu_home_conceded,
        mu_away_against=mu_away_conceded,
    )

    alpha, alpha_status = league_alpha_series(merged)
    logging.info(
        "Alpha Poisson-Gamma: mean=%.4f statuses=%s",
        float(alpha.mean()) if len(alpha) else ALPHA_DEFAULT,
        alpha_status.value_counts().to_dict(),
    )

    # 6) Simular gols
    sim_home_ft, sim_away_ft = simulate_poisson_gamma_bivariate(
        lambda_home.values,
        lambda_away.values,
        alpha=alpha.values,
        n_sims=n_sims,
        seed=SIM_SEED,
    )
    total_ft = sim_home_ft + sim_away_ft

    # Ocorrências históricas
    occ_btts_sim_avg = (blend(merged, "Ocorrência BTTS Sim Casa") + blend(merged, "Ocorrência BTTS Sim Visitante")) / 2.0
    occ_btts_nao_avg = 100.0 - occ_btts_sim_avg

    occ_first_h = blend(merged, "Ocorrência Casa Marcou Primeiro")
    occ_first_a = blend(merged, "Ocorrência Visitante Marcou Primeiro")
    occ_first_ng = (100.0 - (occ_first_h + occ_first_a)).clip(lower=0.0)

    # 7) Base interna de cálculo/print
    base = pd.DataFrame({
        "Pais": merged["Pais"],
        "Sigla": merged["Sigla"],
        "Liga": merged["Liga"],
        "Data/Hora": merged["Data/Hora"],
        "Status": merged["Status"],
        "Time Casa": merged["Time Casa"],
        "Time Visitante": merged["Time Visitante"],

        "Odd Casa MO": merged["Odd Casa Vencer_10"],
        "Odd Visitante MO": merged["Odd Visitante Vencer_10"],

        "Expectativa de Gols": merged["Expectativa de Gols_10"].round(2),
        "Média Gols Liga": merged["Média Gols Liga_10"].round(2),

        "Colocação Time Casa": merged["Colocação Time Casa_10"],
        "Colocação Time Visitante": merged["Colocação Time Visitante_10"],

        "w10": merged["_w_recent10"].round(3),
        "w20": merged["_w_venue20"].round(3),
        "Recent Reliability": merged["_recent_reliability"].round(3),
        "Venue Reliability": merged["_venue_reliability"].round(3),
        "Feature Reliability": merged["_feature_reliability"].round(3),
        "CV Game": merged["_cv_game"].round(2),

        "Share Home": merged["_share_home"].round(3),
        "League Baseline Status": merged["_league_baseline_status"],
        "Gamma Home": merged["_gamma_home"].round(3),
        "Gamma Away": merged["_gamma_away"].round(3),

        "CV Gols Casa": blend(merged, "CV Média Gols Casa").round(2),
        "CV Gols Visitante": blend(merged, "CV Média Gols Visitante").round(2),
        "CV Gols Marcados Casa": blend(merged, "CV Média Gols Marcados Casa").round(2),
        "CV Gols Marcados Visitante": blend(merged, "CV Média Gols Marcados Visitante").round(2),

        "CV Index Casa": (blend(merged, "CV Média Gols Casa") * 0.30 + blend(merged, "CV Média Gols Marcados Casa") * 0.70).round(2),
        "CV Index Visitante": (blend(merged, "CV Média Gols Visitante") * 0.30 + blend(merged, "CV Média Gols Marcados Visitante") * 0.70).round(2),

        "Média Marcados Casa": mu_home_marked.round(2),
        "Média Sofridos Casa": mu_home_conceded.round(2),
        "Média Marcados Visitante": mu_away_marked.round(2),
        "Média Sofridos Visitante": mu_away_conceded.round(2),

        "Lambda Casa": lambda_home.round(3),
        "Lambda Visitante": lambda_away.round(3),
        "Lambda Total": (lambda_home + lambda_away).round(3),
        "Alpha Liga": alpha.round(4),
        "Alpha Status": alpha_status,

        "Occ BTTS Sim Avg": occ_btts_sim_avg.round(2),
        "Occ BTTS Não Avg": occ_btts_nao_avg.round(2),
        "Occ Casa 1º Gol": occ_first_h.round(2),
        "Occ Visit 1º Gol": occ_first_a.round(2),
        "Occ Sem Gol": occ_first_ng.round(2),

        "H2H Over 1.5": merged["H2H Ocorrência de Over 1.5 Gols_20"].round(2),
        "H2H Over 2.5": merged["H2H Ocorrência de Over 2.5 Gols_20"].round(2),
        "H2H Over 3.5": merged["H2H Ocorrência de Over 3.5 Gols_20"].round(2),
        "H2H BTTS Sim": merged["H2H Ocorrência de BTTS Sim_20"].round(2),
        "H2H Casa 1º Gol": merged["H2H Casa Marcou Primeiro_20"].round(2),
        "H2H Visit 1º Gol": merged["H2H Visitante Marcou Primeiro_20"].round(2),
    })

    base["MatchID"] = (
        base["Pais"].astype(str) + "|" +
        base["Sigla"].astype(str) + "|" +
        base["Liga"].astype(str) + "|" +
        base["Data/Hora"].dt.strftime("%Y%m%d%H%M") + "|" +
        base["Time Casa"].astype(str) + "|" +
        base["Time Visitante"].astype(str)
    )

    # Direcional útil para diagnóstico do Primeiro a Marcar
    eps = 1e-9
    base["Dir Side"] = np.where(
        base["Lambda Casa"] > base["Lambda Visitante"], "Casa",
        np.where(base["Lambda Visitante"] > base["Lambda Casa"], "Visitante", "Neutro")
    )
    base["Dir Strength %"] = (
        (base["Lambda Casa"] - base["Lambda Visitante"]).abs() /
        (base["Lambda Total"].abs() + eps) * 100.0
    ).round(2)

    def _dir_bucket(x):
        if pd.isna(x): return "-"
        if x < 10: return "Muito baixa (0-10)"
        if x < 20: return "Baixa (10-20)"
        if x < 35: return "Média (20-35)"
        return "Alta (35+)"

    base["Dir Strength Tier"] = base["Dir Strength %"].apply(_dir_bucket)

    # ------------------------------------------------------------
    # 8) Over/Under — usa colunas próprias de Under
    # ------------------------------------------------------------
    for t in ths_ft:
        thr_over = math.ceil(t)

        hist_over_home = blend(merged, f"Ocorrência Over {t} Gols Casa")
        hist_over_away = blend(merged, f"Ocorrência Over {t} Gols Visitante")
        hist_under_home = blend(merged, f"Ocorrência Under {t} Gols Casa")
        hist_under_away = blend(merged, f"Ocorrência Under {t} Gols Visitante")

        hist_o_raw = (hist_over_home + hist_over_away) / 2.0
        hist_u_raw = (hist_under_home + hist_under_away) / 2.0

        # Normaliza Over/Under para fechar 100 quando ambos existem.
        hist_total = hist_o_raw + hist_u_raw
        hist_ok = np.isfinite(hist_total) & (hist_total > 0)
        hist_o = hist_o_raw.copy()
        hist_u = hist_u_raw.copy()
        hist_o.loc[hist_ok] = hist_o_raw.loc[hist_ok] / hist_total.loc[hist_ok] * 100.0
        hist_u.loc[hist_ok] = hist_u_raw.loc[hist_ok] / hist_total.loc[hist_ok] * 100.0

        # Fallback se Under vier ausente.
        hist_u = hist_u.where(np.isfinite(hist_u), 100.0 - hist_o)
        hist_o = hist_o.where(np.isfinite(hist_o), 100.0 - hist_u)

        sim_o = pd.Series((total_ft >= thr_over).mean(axis=1) * 100.0, index=base.index)
        sim_u = 100.0 - sim_o

        odd_o_col = f"Odd Over {t} Gols"
        odd_u_col = f"Odd Under {t} Gols"
        odd_o = merged[f"{odd_o_col}_10"]
        odd_u = merged[f"{odd_u_col}_10"]

        imp_o, imp_u = vig_free_probs_from_odds_2way(odd_o.values, odd_u.values)
        imp_o = pd.Series(imp_o * 100.0, index=base.index)
        imp_u = pd.Series(imp_u * 100.0, index=base.index)

        controls = finalize_two_way_probabilities(
            hist_o, hist_u, sim_o, sim_u, imp_o, imp_u,
            [w_hist, w_sim, w_imp], SHRINK_OU, "ou",
        )
        prob_o = controls["a"]
        prob_u = controls["b"]

        prob_o_col = f"Over {t} Gols prob"
        prob_u_col = f"Under {t} Gols prob"
        base[prob_o_col] = prob_o
        base[odd_o_col] = odd_o
        base[prob_u_col] = prob_u
        base[odd_u_col] = odd_u
        base[f"OU {t} Hist Over"] = hist_o.round(2)
        base[f"OU {t} Sim Over"] = sim_o.round(2)
        base[f"OU {t} NoVig Over"] = imp_o.round(2)
        base[f"OU {t} Prob Raw Over"] = controls["raw_a"]
        base[f"OU {t} Prob PreHaircut Over"] = controls["pre_haircut_a"]
        base[f"OU {t} Haircut"] = controls["haircut"]
        base[f"OU {t} Spread"] = controls["spread"]
        base[f"OU {t} Conflict"] = np.where(controls["conflict"], "CONFLITO_FORTE_COM_MERCADO", "ALINHADO")
        base[f"OU {t} Calibration"] = str(controls["calibration"].get("status"))

        base = apply_value_filter(base, prob_o_col, odd_o_col, min_prob=MIN_PROB_OU, min_cv=MIN_CV_OU, min_edge=MIN_EDGE_OU)
        base = add_ou_goal_cost_and_filter(base, prob_o_col, odd_o_col, t, "Over")

        base = apply_value_filter(base, prob_u_col, odd_u_col, min_prob=MIN_PROB_OU, min_cv=MIN_CV_OU, min_edge=MIN_EDGE_OU)
        base = add_ou_goal_cost_and_filter(base, prob_u_col, odd_u_col, t, "Under")

    # ------------------------------------------------------------
    # 9) BTTS (Sim/Não) 2-way com vig-free
    # ------------------------------------------------------------
    hist_btts_sim = occ_btts_sim_avg
    hist_btts_nao = 100.0 - hist_btts_sim

    sim_btts_sim = pd.Series(((sim_home_ft > 0) & (sim_away_ft > 0)).mean(axis=1) * 100.0, index=base.index)
    sim_btts_nao = 100.0 - sim_btts_sim

    odd_sim = merged["Odd BTTS Sim_10"].astype(float)
    odd_nao = merged["Odd BTTS Não_10"].astype(float)

    imp_sim, imp_nao = vig_free_probs_from_odds_2way(odd_sim.values, odd_nao.values)
    imp_sim = pd.Series(imp_sim * 100.0, index=base.index)
    imp_nao = pd.Series(imp_nao * 100.0, index=base.index)

    btts_controls = finalize_two_way_probabilities(
        hist_btts_sim, hist_btts_nao, sim_btts_sim, sim_btts_nao, imp_sim, imp_nao,
        [w_hist, w_sim, w_imp], SHRINK_BTTS, "btts",
    )
    prob_sim = btts_controls["a"]
    prob_nao = btts_controls["b"]

    base["BTTS Sim prob"] = prob_sim
    base["Odd BTTS Sim"] = odd_sim
    base["BTTS Não prob"] = prob_nao
    base["Odd BTTS Não"] = odd_nao
    base["BTTS Hist Sim"] = hist_btts_sim.round(2)
    base["BTTS Sim Model"] = sim_btts_sim.round(2)
    base["BTTS NoVig Sim"] = imp_sim.round(2)
    base["BTTS Prob Raw Sim"] = btts_controls["raw_a"]
    base["BTTS Prob PreHaircut Sim"] = btts_controls["pre_haircut_a"]
    base["BTTS Haircut"] = btts_controls["haircut"]
    base["BTTS Spread"] = btts_controls["spread"]
    base["BTTS Conflict"] = np.where(btts_controls["conflict"], "CONFLITO_FORTE_COM_MERCADO", "ALINHADO")
    base["BTTS Calibration"] = str(btts_controls["calibration"].get("status"))

    base = add_btts_cost_indicators(base)

    base = apply_value_filter(base, "BTTS Sim prob", "Odd BTTS Sim", min_prob=MIN_PROB_BTTS, min_cv=MIN_CV_BTTS, min_edge=MIN_EDGE_BTTS)
    base = apply_value_filter(base, "BTTS Não prob", "Odd BTTS Não", min_prob=MIN_PROB_BTTS, min_cv=MIN_CV_BTTS, min_edge=MIN_EDGE_BTTS)

    # ------------------------------------------------------------
    # 10) Primeiro a Marcar (Casa/Visitante/Sem Gol) 3-way
    # ------------------------------------------------------------
    sim_ng = pd.Series((total_ft == 0).mean(axis=1) * 100.0, index=base.index)
    goal_mass = (100.0 - sim_ng).clip(lower=0.0)

    lam_h = base["Lambda Casa"].astype(float).values
    lam_a = base["Lambda Visitante"].astype(float).values
    den = lam_h + lam_a
    frac_h = np.where(den > 0, lam_h / den, np.nan)
    frac_a = np.where(den > 0, lam_a / den, np.nan)

    sim_h = pd.Series(goal_mass.values * frac_h, index=base.index)
    sim_a = pd.Series(goal_mass.values * frac_a, index=base.index)

    odd_h = merged["Odd Casa Marcar Primeiro_10"].astype(float)
    odd_a = merged["Odd Visitante Marcar Primeiro_10"].astype(float)
    odd_ng = merged["Odd Sem Gol_10"].astype(float)

    imp_h, imp_a, imp_ng = vig_free_probs_from_odds_3way(odd_h.values, odd_a.values, odd_ng.values)
    imp_h = pd.Series(imp_h * 100.0, index=base.index)
    imp_a = pd.Series(imp_a * 100.0, index=base.index)
    imp_ng = pd.Series(imp_ng * 100.0, index=base.index)

    prob_h_raw = weighted_mix_pct([occ_first_h, sim_h, imp_h], [w_hist_first, w_sim_first, w_imp_first])
    prob_a_raw = weighted_mix_pct([occ_first_a, sim_a, imp_a], [w_hist_first, w_sim_first, w_imp_first])
    prob_ng_raw = weighted_mix_pct([occ_first_ng, sim_ng, imp_ng], [w_hist_first, w_sim_first, w_imp_first])

    tot = prob_h_raw + prob_a_raw + prob_ng_raw
    tot_ok = np.isfinite(tot) & (tot > 0)

    prob_h = pd.Series(np.nan, index=base.index)
    prob_a = pd.Series(np.nan, index=base.index)
    prob_ng = pd.Series(np.nan, index=base.index)

    prob_h.loc[tot_ok] = (prob_h_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)
    prob_a.loc[tot_ok] = (prob_a_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)
    prob_ng.loc[tot_ok] = (prob_ng_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)

    first_probs = pd.DataFrame({
        "Casa": prob_h,
        "Visitante": prob_a,
        "Sem Gol": prob_ng,
    })
    first_probs = calibrate_multiclass(first_probs, shrink=SHRINK_FIRST)

    base["Casa 1º a Marcar prob"] = first_probs["Casa"].round(2)
    base["Odd Casa 1º a Marcar"] = odd_h
    base["Visitante 1º a Marcar prob"] = first_probs["Visitante"].round(2)
    base["Odd Visitante 1º a Marcar"] = odd_a
    base["Sem Gol prob"] = first_probs["Sem Gol"].round(2)
    base["Odd Sem Gol"] = odd_ng

    base = add_first_goal_cost_indicators(base, sim_ng_pct=sim_ng)

    base = apply_value_filter(base, "Casa 1º a Marcar prob", "Odd Casa 1º a Marcar", min_prob=MIN_PROB_FIRST, min_cv=MIN_CV_FIRST)
    base = apply_value_filter(base, "Visitante 1º a Marcar prob", "Odd Visitante 1º a Marcar", min_prob=MIN_PROB_FIRST, min_cv=MIN_CV_FIRST)
    base = apply_value_filter(base, "Sem Gol prob", "Odd Sem Gol", min_prob=MIN_PROB_SEM_GOL, min_cv=MIN_CV_SEM_GOL)
    if not FIRST_GOAL_ENABLED:
        first_goal_columns = [
            "Casa 1º a Marcar prob", "Odd Casa 1º a Marcar",
            "Visitante 1º a Marcar prob", "Odd Visitante 1º a Marcar",
            "Sem Gol prob", "Odd Sem Gol",
        ]
        base.loc[:, first_goal_columns] = np.nan
        logging.info("Primeiro a Marcar desativado: aguardando eventos historicos mutuamente exclusivos.")

    # ------------------------------------------------------------
    # 11) Filtros finais de qualidade
    # ------------------------------------------------------------
    # O CV mínimo agora é aplicado por mercado em apply_value_filter(),
    # evitando cortar Over/Under com CV 50 só porque BTTS/1º gol exigem CV maior.
    market_prob_cols = [c for c in base.columns if c.endswith(" prob")]
    mask_any_market = base[market_prob_cols].notna().any(axis=1)
    base = base.loc[mask_any_market].reset_index(drop=True)

    # 12) Exportar apenas Lovable em formato longo
    lovable = build_lovable_export(base)
    output_name = f"asp_goalmatrix_lovable_{date_str.replace('-', '_')}.csv"
    output_path = output_dir / output_name
    lovable.to_csv(output_path, index=False, encoding="utf-8-sig")
    print("Planilha Lovable gerada:", str(output_path))
    print(f"Total de picks exportadas: {len(lovable)}")

    return base, lovable

# ------------------------------------------------------------
# PRINT
# ------------------------------------------------------------
def _fmt_int(x):
    try:
        if pd.isna(x): return "-"
        return str(int(float(x)))
    except Exception:
        return "-"


def _fmt_float(x, nd=2, signed=False):
    try:
        if pd.isna(x):
            return "-"
        x = float(x)
        if not np.isfinite(x):
            return "-"
        sign = "+" if signed else ""
        return f"{x:{sign}.{nd}f}"
    except Exception:
        return "-"


def _is_printable_value_pick(prob, odd, min_prob=MIN_PROB, min_odd=MIN_ODD_PRINT, max_odd=MAX_ODD, buffer=VALUE_BUFFER):
    return _is_value_pick(prob, odd, min_prob=min_prob, min_odd=min_odd, max_odd=max_odd, buffer=buffer)


def print_gols_prognostics(base: pd.DataFrame, status_filter=None):
    thresholds = [1.5, 2.5, 3.5, 4.5]
    if status_filter is None:
        status_filter = STATUSES

    base_print = base.loc[base["Status"].isin(status_filter)].copy()
    base_print = base_print.sort_values(
        ["Data/Hora", "Liga", "Time Casa", "Time Visitante"],
        ascending=True,
    ).reset_index(drop=True)

    print("Utilize o INPUT ULTRA RÁPIDO — CONFIRMAÇÃO (GOLS & CANTOS) v2 para confirmação do prognóstico\n")
    print("=== PROGNÓSTICOS PARA GOLS ===\n")
    print(
        f"Filtros por mercado: OU prob >= {MIN_PROB_OU}% / CV >= {MIN_CV_OU}% | "
        f"BTTS prob >= {MIN_PROB_BTTS}% / CV >= {MIN_CV_BTTS}% | "
        f"1º Gol prob >= {MIN_PROB_FIRST}% / CV >= {MIN_CV_FIRST}% | "
        f"Sem Gol prob >= {MIN_PROB_SEM_GOL}% / CV >= {MIN_CV_SEM_GOL}%\n"
        f"Odd entre {MIN_ODD:.2f} e {MAX_ODD:.2f} | buffer valor {VALUE_BUFFER:.2f} | "
        f"margem OU >= {MIN_MARGEM_GOL_OU:.2f} | custo gol OU <= {MAX_CUSTO_GOL_OU:.0f}\n"
    )

    for _, row in base_print.iterrows():
        market_ou = []
        market_btts = []
        market_first = []

        for t in thresholds:
            parts = []

            prob_u = row.get(f"Under {t} Gols prob", pd.NA)
            odd_u = row.get(f"Odd Under {t} Gols", pd.NA)
            if _is_printable_value_pick(prob_u, odd_u, min_prob=MIN_PROB_OU):
                ov = round(100 / float(prob_u), 2)
                edge = ((float(odd_u) * float(prob_u) / 100.0) - 1.0) * 100.0
                margem = row.get(f"Under {t} Margem Gol", pd.NA)
                custo = row.get(f"Under {t} Custo Gol", pd.NA)
                parts.append(
                    f"Under {float(prob_u):.2f}% | Valor: {ov:.2f} | Ofertada: {float(odd_u):.2f} | "
                    f"Edge: {edge:.2f}% | Margem: {_fmt_float(margem, 2, signed=True)} | Custo Gol: {_fmt_float(custo, 2)}"
                )

            prob_o = row.get(f"Over {t} Gols prob", pd.NA)
            odd_o = row.get(f"Odd Over {t} Gols", pd.NA)
            if _is_printable_value_pick(prob_o, odd_o, min_prob=MIN_PROB_OU):
                ov = round(100 / float(prob_o), 2)
                edge = ((float(odd_o) * float(prob_o) / 100.0) - 1.0) * 100.0
                margem = row.get(f"Over {t} Margem Gol", pd.NA)
                custo = row.get(f"Over {t} Custo Gol", pd.NA)
                parts.append(
                    f"Over {float(prob_o):.2f}% | Valor: {ov:.2f} | Ofertada: {float(odd_o):.2f} | "
                    f"Edge: {edge:.2f}% | Margem: {_fmt_float(margem, 2, signed=True)} | Custo Gol: {_fmt_float(custo, 2)}"
                )

            if parts:
                market_ou.append((f"Linha {t}", parts))

        p_sim = row.get("BTTS Sim prob", pd.NA)
        o_sim = row.get("Odd BTTS Sim", pd.NA)
        if _is_printable_value_pick(p_sim, o_sim, min_prob=MIN_PROB_BTTS):
            ov = round(100 / float(p_sim), 2)
            edge = ((float(o_sim) * float(p_sim) / 100.0) - 1.0) * 100.0
            market_btts.append(
                f"BTTS Sim {float(p_sim):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_sim):.2f} | "
                f"Edge: {edge:.2f}% | Força BTTS: {_fmt_float(row.get('BTTS Sim Força Gols'), 3)} | "
                f"Custo BTTS: {_fmt_float(row.get('BTTS Sim Custo'), 2)}"
            )

        p_nao = row.get("BTTS Não prob", pd.NA)
        o_nao = row.get("Odd BTTS Não", pd.NA)
        if _is_printable_value_pick(p_nao, o_nao, min_prob=MIN_PROB_BTTS):
            ov = round(100 / float(p_nao), 2)
            edge = ((float(o_nao) * float(p_nao) / 100.0) - 1.0) * 100.0
            market_btts.append(f"BTTS Não {float(p_nao):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_nao):.2f} | Edge: {edge:.2f}%")

        p_h = row.get("Casa 1º a Marcar prob", pd.NA)
        o_h = row.get("Odd Casa 1º a Marcar", pd.NA)
        if _is_printable_value_pick(p_h, o_h, min_prob=MIN_PROB_FIRST):
            ov = round(100 / float(p_h), 2)
            edge = ((float(o_h) * float(p_h) / 100.0) - 1.0) * 100.0
            market_first.append(
                f"Casa {float(p_h):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_h):.2f} | Edge: {edge:.2f}% | "
                f"Força 1º Gol: {_fmt_float(row.get('Casa 1º a Marcar Força %'), 2)}% | "
                f"Custo 1º Gol: {_fmt_float(row.get('Casa 1º a Marcar Custo'), 2)}"
            )

        p_a = row.get("Visitante 1º a Marcar prob", pd.NA)
        o_a = row.get("Odd Visitante 1º a Marcar", pd.NA)
        if _is_printable_value_pick(p_a, o_a, min_prob=MIN_PROB_FIRST):
            ov = round(100 / float(p_a), 2)
            edge = ((float(o_a) * float(p_a) / 100.0) - 1.0) * 100.0
            market_first.append(
                f"Visitante {float(p_a):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_a):.2f} | Edge: {edge:.2f}% | "
                f"Força 1º Gol: {_fmt_float(row.get('Visitante 1º a Marcar Força %'), 2)}% | "
                f"Custo 1º Gol: {_fmt_float(row.get('Visitante 1º a Marcar Custo'), 2)}"
            )

        p_ng = row.get("Sem Gol prob", pd.NA)
        o_ng = row.get("Odd Sem Gol", pd.NA)
        if _is_printable_value_pick(p_ng, o_ng, min_prob=MIN_PROB_SEM_GOL):
            ov = round(100 / float(p_ng), 2)
            edge = ((float(o_ng) * float(p_ng) / 100.0) - 1.0) * 100.0
            market_first.append(
                f"Sem Gol {float(p_ng):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_ng):.2f} | Edge: {edge:.2f}% | "
                f"Força Sem Gol: {_fmt_float(row.get('Sem Gol Força %'), 2)}% | "
                f"Custo Sem Gol: {_fmt_float(row.get('Sem Gol Custo'), 2)}"
            )

        if not market_ou and not market_btts and not market_first:
            continue

        home = row["Time Casa"]
        away = row["Time Visitante"]
        pais = row["Pais"]
        liga = row["Liga"]
        dth = row["Data/Hora"]
        date_txt = dth.strftime("%d-%m-%Y / %H:%M") if pd.notna(dth) else "Data/Hora inválida"

        print("Utilize o INPUT ULTRA RÁPIDO — CONFIRMAÇÃO (GOLS & CANTOS) v2 para confirmação do prognóstico\n")
        print(f"Confronto: {home} ({_fmt_int(row.get('Colocação Time Casa'))}°) vs {away} ({_fmt_int(row.get('Colocação Time Visitante'))}°)")
        print(f"{pais} - {liga}")
        print(f"Data/Hora: {date_txt}")
        print(f"Status: {row['Status']}\n")

        lam_h = row.get("Lambda Casa", pd.NA)
        lam_a = row.get("Lambda Visitante", pd.NA)
        lam_t = row.get("Lambda Total", pd.NA)

        print("--- DADOS TÉCNICOS ---")
        print(f"w10/w20 mando:                {_fmt_float(row.get('w10'), 3)} / {_fmt_float(row.get('w20'), 3)}")
        print(f"Share Home (liga):             {_fmt_float(row.get('Share Home'), 3)}")
        print(f"Gamma Home/Away:               {_fmt_float(row.get('Gamma Home'), 3)} / {_fmt_float(row.get('Gamma Away'), 3)}\n")

        print(f"Média Marcados Casa:           {_fmt_float(row.get('Média Marcados Casa'), 2)}")
        print(f"Média Sofridos Casa:           {_fmt_float(row.get('Média Sofridos Casa'), 2)}")
        print(f"Média Marcados Visitante:      {_fmt_float(row.get('Média Marcados Visitante'), 2)}")
        print(f"Média Sofridos Visitante:      {_fmt_float(row.get('Média Sofridos Visitante'), 2)}\n")

        print(f"Força esperada gols C/V/T:     {_fmt_float(lam_h, 3)} / {_fmt_float(lam_a, 3)} / {_fmt_float(lam_t, 3)}")
        print(f"Exp. de Gols (modelo):         {_fmt_float(lam_t, 2)}")
        print(f"Exp. de Gols (Packball):       {_fmt_float(row.get('Expectativa de Gols'), 2)}")
        print(f"Média Gols Liga:               {_fmt_float(row.get('Média Gols Liga'), 2)}\n")

        print(f"Odd Casa MO:                   {_fmt_float(row.get('Odd Casa MO'), 2)}")
        print(f"Odd Visitante MO:              {_fmt_float(row.get('Odd Visitante MO'), 2)}\n")

        print(f"CV Gols Marcados Casa:         {_fmt_float(row.get('CV Gols Marcados Casa'), 2)}%")
        print(f"CV Gols Marcados Visitante:    {_fmt_float(row.get('CV Gols Marcados Visitante'), 2)}%\n")

        print("--- OCORRÊNCIAS (HIST - MÉDIAS) ---")
        print(f"BTTS Sim/Não (avg):            {_fmt_float(row.get('Occ BTTS Sim Avg'), 2)}% / {_fmt_float(row.get('Occ BTTS Não Avg'), 2)}%")
        print(f"1º Gol Casa/Vis/Sem Gol:       {_fmt_float(row.get('Occ Casa 1º Gol'), 2)}% / {_fmt_float(row.get('Occ Visit 1º Gol'), 2)}% / {_fmt_float(row.get('Occ Sem Gol'), 2)}%")
        print()

        print("--- H2H (INSIGHTS) ---")
        print(f"Over 1.5: {_fmt_float(row.get('H2H Over 1.5'), 2)}% | Over 2.5: {_fmt_float(row.get('H2H Over 2.5'), 2)}% | Over 3.5: {_fmt_float(row.get('H2H Over 3.5'), 2)}%")
        print(f"BTTS Sim: {_fmt_float(row.get('H2H BTTS Sim'), 2)}% | Casa 1º Gol: {_fmt_float(row.get('H2H Casa 1º Gol'), 2)}% | Visit 1º Gol: {_fmt_float(row.get('H2H Visit 1º Gol'), 2)}%")
        print()

        if market_ou:
            print("--- OVER/UNDER ---")
            for label, parts in market_ou:
                print(f"  • {label}: " + " || ".join(parts))
            print()

        if market_btts:
            print("--- BTTS ---")
            for p in market_btts:
                print(f"  • {p}")
            print()

        if market_first:
            print("--- PRIMEIRO A MARCAR (3-WAY) ---")
            for p in market_first:
                print(f"  • {p}")
            print()

        print("=" * 60 + "\n")


def _infer_date_str(paths: list[Path]) -> str:
    import re
    for path in paths:
        match = re.search(r"(\d{2}-\d{2}-\d{4})", path.name)
        if match:
            return match.group(1)
    return pd.Timestamp.now().strftime("%d-%m-%Y")


def _clean_json(value):
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {str(k): _clean_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean_json(v) for v in value]
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    return value


def _to_records(lovable: pd.DataFrame) -> list[dict]:
    records: list[dict] = []
    for row in lovable.to_dict(orient="records"):
        obs = str(row.get("observacoes") or "").strip()
        row["odd"] = row.get("odd_ofertada")
        row["probabilidade"] = row.get("probabilidade_final")
        row["stake"] = row.get("stake") or 0.5
        row["dados_tecnicos"] = row.get("dados_tecnicos") or obs or None
        row["contexto_adicional"] = row.get("contexto_adicional") or row.get("dados_tecnicos") or obs or None
        row["contexto_modelo"] = row.get("contexto_modelo") or row.get("dados_tecnicos") or obs or None
        row["parecer_validacao"] = row.get("parecer_validacao") or "AGUARDAR_VALIDACAO"
        records.append(_clean_json(row))
    return records


def build_walk_forward_snapshot_rows(records: list[dict]) -> list[dict]:
    prediction_at = str(RUN_PROVENANCE.get("generated_at") or datetime.now(timezone.utc).isoformat())
    local_timezone = ZoneInfo("America/Sao_Paulo")
    output = []
    for record in records:
        kickoff_local = pd.to_datetime(
            f"{record.get('data', '')} {record.get('hora', '')}",
            dayfirst=True,
            errors="coerce",
        )
        kickoff = None
        if pd.notna(kickoff_local):
            kickoff = kickoff_local.to_pydatetime().replace(tzinfo=local_timezone).astimezone(timezone.utc).isoformat()
        game_key = "|".join(
            str(record.get(key) or "") for key in ("data", "hora", "liga", "jogo")
        )
        output.append({
            "prediction_at": prediction_at,
            "kickoff": kickoff,
            "game_id": hashlib.sha256(game_key.encode("utf-8")).hexdigest()[:24],
            "league": record.get("liga"),
            "market_type": str(record.get("market_type") or "").lower(),
            "pick": record.get("pick"),
            "line": record.get("linha"),
            "probability": (float(record.get("probabilidade_final")) / 100.0) if record.get("probabilidade_final") is not None else None,
            "odd": record.get("odd_ofertada"),
            "outcome": None,
            "home_goals": None,
            "away_goals": None,
        })
    return output


def run_cli() -> None:
    import contextlib
    import json
    import shutil
    import sys
    import tempfile

    if len(sys.argv) < 4:
        payload = {
            "ok": False,
            "erro": "Uso: python runner.py CSV_10 CSV_20 OUTPUT_CSV [DD-MM-YYYY]",
        }
        print(json.dumps(payload, ensure_ascii=False))
        return

    csv10 = Path(sys.argv[1]).resolve()
    csv20 = Path(sys.argv[2]).resolve()
    output_path = Path(sys.argv[3]).resolve()
    cli_date = sys.argv[4].strip() if len(sys.argv) >= 5 and sys.argv[4].strip() else _infer_date_str([csv10, csv20])

    if not csv10.exists():
        print(json.dumps({"ok": False, "erro": f"Arquivo 10j não encontrado: {csv10}"}, ensure_ascii=False))
        return
    if not csv20.exists():
        print(json.dumps({"ok": False, "erro": f"Arquivo 20j n?o encontrado: {csv20}"}, ensure_ascii=False))
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)

    source_preview = pd.read_csv(
        csv10,
        sep=sniff_sep(csv10),
        encoding="utf-8",
        engine="python",
        nrows=1,
    )
    globals()["RUN_PROVENANCE"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "PackBall external CSV import",
        "recent_profile": "10 games, all venues, all leagues, current season only",
        "venue_profile": "20 games, home-at-home/away-at-away, all leagues, previous season allowed",
        "source_file_10": csv10.name,
        "source_file_20": csv20.name,
        "sha256_10": file_sha256(csv10),
        "sha256_20": file_sha256(csv20),
        "schema_hash": schema_sha256(source_preview.columns),
        "model_version": MODEL_VERSION,
        "prediction_date": cli_date,
        "kickoff_timezone": "America/Sao_Paulo",
    }

    with tempfile.TemporaryDirectory(prefix="asp_packball_model_") as tmp_name:
        tmp_dir = Path(tmp_name)
        expected10 = tmp_dir / PACKBALL_FILE_10.format(date=cli_date)
        expected20 = tmp_dir / PACKBALL_FILE_20.format(date=cli_date)
        shutil.copy2(csv10, expected10)
        shutil.copy2(csv20, expected20)

        globals()["date_str"] = cli_date
        globals()["base_dir"] = tmp_dir
        globals()["output_dir"] = output_path.parent

        with contextlib.redirect_stdout(sys.stderr):
            base, lovable = main()

        lovable.to_csv(output_path, index=False, encoding="utf-8-sig")
        records = _to_records(lovable)
        snapshot = {
            **RUN_PROVENANCE,
            "input_path_10": str(csv10),
            "input_path_20": str(csv20),
            "output_path": str(output_path),
            "first_goal_enabled": FIRST_GOAL_ENABLED,
            "calibration_path": str(CALIBRATION_PATH),
            "predictions": records,
            "walk_forward_rows": build_walk_forward_snapshot_rows(records),
        }
        snapshot_path = output_path.with_suffix(".snapshot.json")
        snapshot_path.write_text(
            json.dumps(_clean_json(snapshot), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        context_lines = [
            f"{MODEL_NAME} - PackBall {cli_date}",
            f"Jogos processados: {len(base)}",
            f"Progn?sticos gerados: {len(records)}",
        ]
        if records:
            context_lines.append("Amostra t?cnica:")
            for item in records[:8]:
                context_lines.append(str(item.get("observacoes") or ""))

        payload = {
            "ok": True,
            "modelo": MODEL_NAME,
            "arquivo_saida": str(output_path),
            "arquivo_contexto": None,
            "arquivo_snapshot": str(snapshot_path),
            "provenance": RUN_PROVENANCE,
            "total_prognosticos": len(records),
            "contexto_modelo": "\n".join(line for line in context_lines if line),
            "dados_tecnicos": "\n\n".join(str(r.get("dados_tecnicos") or "") for r in records[:20] if r.get("dados_tecnicos")),
            "prognosticos": records,
        }
        print(json.dumps(_clean_json(payload), ensure_ascii=False))


if __name__ == "__main__":
    run_cli()
