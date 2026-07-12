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

PACKBALL_FILE_10 = "PackBall Custom cantos_10 {date}.csv"
PACKBALL_FILE_20 = "PackBall Custom cantos_20 {date}.csv"

try:
    from scipy.special import betainc
    _HAS_BETAINC = True
except Exception:
    _HAS_BETAINC = False

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
base_dir = Path("dados_futebol_cantos")
output_dir = Path("Prognostico")

# Nome comercial do modelo para identificação no Lovable.
# Mantém o campo 'mercado' como nome do modelo, igual ao ASP GoalMatrix.
MODEL_NAME = "ASP CornerMatrix"
MODEL_VERSION = "v2.4"

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
# Histórico e simulação compartilham a mesma origem; o mercado recebe 15% para reduzir eco do modelo.
w_hist, w_sim, w_imp = 0.35, 0.50, 0.15

# Mercados direcionais de cantos são mais voláteis que O/U.
w_hist_dir, w_sim_dir, w_imp_dir = 0.30, 0.55, 0.15

RECENT_WEIGHT_BASE = 0.35
RECENT_WEIGHT_MIN = 0.30
RECENT_WEIGHT_MAX = 0.45
RECENT_DIVERGENCE_START = 0.80
RECENT_DIVERGENCE_RANGE = 2.50
RECENT_DIVERGENCE_MAX_BOOST = 0.10

ths_ft = [7.5, 8.5, 9.5, 10.5, 11.5]
race_targets = [3, 5]
n_sims = 10_000

# Cortes por mercado.
MIN_PROB_OU = 56
MIN_PROB_MAIS = 57
MIN_PROB_RACE = 58

MIN_CV_OU = 50
MIN_CV_OU_INDIVIDUAL = 45
MIN_CV_MAIS = 55
MIN_CV_RACE = 58
MIN_EDGE_OU = 5.0
MIN_EDGE_MAIS = 6.0
MIN_EDGE_RACE = 6.0

COMPONENT_DISAGREEMENT_THRESHOLD = 15.0
COMPONENT_UNCERTAINTY_THRESHOLD = 12.0
STRONG_MARKET_CONFLICT_THRESHOLD = 22.0
DISAGREEMENT_HAIRCUT_STRENGTH = 0.25
DISAGREEMENT_HAIRCUT_MAX_PP = 6.0

# Compatibilidade para funções genéricas/diagnóstico.
MIN_PROB = MIN_PROB_OU
MIN_CV_MARKED = MIN_CV_OU

# Baseline split casa/fora de cantos.
DEFAULT_SHARE_HOME = 0.52
SHARE_HOME_CLIP = (0.44, 0.58)

# Limites de forças.
FORCE_RAW_CLIP = (0.30, 3.00)
LAMBDA_CLIP = (0.0, 30.0)

# Baseline liga (cantos).
L_TOTAL_DEFAULT = 9.80
L_TOTAL_CLIP = (2.00, 20.00)

# Dispersão fixa com Poisson-Gamma bivariado.
# Cantos tendem a ter maior variância que gols, por isso alpha inicial acima do GoalMatrix.
ALPHA_DEFAULT = 0.12
SIM_SEED = 42
MIN_OOS_CALIBRATION_SAMPLE = 100
CALIBRATION_PATH = Path(os.getenv("CORNERMATRIX_CALIBRATION_PATH", Path(__file__).with_name("cornermatrix_calibration.json")))
RUN_PROVENANCE: dict[str, object] = {}

# Amortecimento de força — evita explosão dos lambdas.
LAMBDA_POWER = 0.50

# Filtro de valor.
VALUE_BUFFER = 1.03
MIN_ODD = 1.50
MAX_ODD = 2.00
MIN_ODD_PRINT = MIN_ODD

# Custo de Canto — filtro duro apenas para Over/Under.
# Margem = distância entre Exp. Cantos Modelo e linha.
# Custo = break-even da odd / margem favorável de cantos.
MIN_MARGEM_CANTO_OU = 0.35
MAX_CUSTO_CANTO_OU = 160.0

# Calibração por mercado.
SHRINK_OU = 0.88
SHRINK_MAIS = 0.84
SHRINK_RACE = 0.86

KELLY_FRACTION = 0.10
MAX_PICK_UNITS = 0.75
UNCERTAINTY_MAX_UNITS = 0.50
CONFLICT_MAX_UNITS = 0.25
MAX_MARKET_UNITS = 1.25
MAX_GAME_UNITS = 1.50
MAX_CORRELATED_LINES = 3

# ------------------------------------------------------------
# COLUNAS NORMALIZADAS (CANTOS)
# ------------------------------------------------------------
cols_normalizados = [
    "Pais",
    "Sigla",
    "Liga",
    "Data/Hora",
    "Status",
    "Time Casa",
    "Resultado Casa",
    "Resultado Visitor",
    "Time Visitante",
    "Odd Casa Vencer",
    "Odd Visitante Vencer",
    "Odd Over 7.5 cantos",
    "Odd Over 8.5 cantos",
    "Odd Over 9.5 cantos",
    "Odd Over 10.5 cantos",
    "Odd Over 11.5 cantos",
    "Odd Under 7.5 cantos",
    "Odd Under 8.5 cantos",
    "Odd Under 9.5 cantos",
    "Odd Under 10.5 cantos",
    "Odd Under 11.5 cantos",
    "Odd Casa Mais Cantos",
    "Odd Visitante Mais Cantos",
    "Odd Casa Race 3 Cantos",
    "Odd Visitante Race 3 Cantos",
    "Odd Casa Race 5 Cantos",
    "Odd Visitante Race 5 Cantos",
    "Expectativa de Cantos",
    "CV Média Cantos Casa",
    "CV Média Cantos Visitante",
    "CV Média Cantos Marcados Casa",
    "CV Média Cantos Marcados Visitante",
    "Classificação Casa",
    "Classificação Visitante",
    "Jogos Coletados Casa",
    "Jogos Coletados Visitante",
    "Média Cantos Marcados Casa",
    "Média Cantos Marcados Visitante",
    "Média Cantos Sofridos Casa",
    "Média Cantos Sofridos Visitante",
    "Over 7.5 Cantos Casa",
    "Over 7.5 Cantos Visitante",
    "Over 8.5 Cantos Casa",
    "Over 8.5 Cantos Visitante",
    "Over 9.5 Cantos Casa",
    "Over 9.5 Cantos Visitante",
    "Over 10.5 Cantos Casa",
    "Over 10.5 Cantos Visitante",
    "Over 11.5 Cantos Casa",
    "Over 11.5 Cantos Visitante",
    "Under 11.5 Cantos Casa",
    "Under 11.5 Cantos Visitante",
    "Under 10.5 Cantos Casa",
    "Under 10.5 Cantos Visitante",
    "Under 9.5 Cantos Casa",
    "Under 9.5 Cantos Visitante",
    "Under 8.5 Cantos Casa",
    "Under 8.5 Cantos Visitante",
    "Under 7.5 Cantos Casa",
    "Under 7.5 Cantos Visitante",
    "Casa Marcou Mais Cantos",
    "Visitante Marcou Mais cantos",
    "Média Cantos Liga",
    "Casa Race 3 Cantos",
    "Visitante Race 3 Cantos",
    "Casa Race 5 Cantos",
    "Visitante Race 5 Cantos",
]

SOURCE_HEADERS = [
    "Country ", "Short", "League ", "Hour", "Status", "Home Team", "Result Home",
    "Result Visitor", "Visitor Team", "Odds", "Odds.1", "Odds.2", "Odds.3", "Odds.4",
    "Odds.5", "Odds.6", "Odds.7", "Odds.8", "Odds.9", "Odds.10", "Odds.11", "Odds.12",
    "Odds.13", "Odds.14", "Odds.15", "Odds.16", "Odds.17", "Global", "Casa", "Fora",
    "Casa.1", "Fora.1", "Casa.2", "Fora.2", "Casa.3", "Fora.3", "Casa.4", "Fora.4",
    "Casa.5", "Fora.5", "Casa.6", "Fora.6", "Casa.7", "Fora.7", "Casa.8", "Fora.8",
    "Casa.9", "Fora.9", "Casa.10", "Fora.10", "Casa.11", "Fora.11", "Casa.12",
    "Fora.12", "Casa.13", "Fora.13", "Casa.14", "Fora.14", "Casa.15", "Fora.15",
    "Casa.16", "Fora.16", "Global.1", "Casa.17", "Fora.17", "Casa.18", "Fora.18",
]

PCT_COLS_INPUT = [
    "Over 7.5 Cantos Casa", "Over 7.5 Cantos Visitante",
    "Over 8.5 Cantos Casa", "Over 8.5 Cantos Visitante",
    "Over 9.5 Cantos Casa", "Over 9.5 Cantos Visitante",
    "Over 10.5 Cantos Casa", "Over 10.5 Cantos Visitante",
    "Over 11.5 Cantos Casa", "Over 11.5 Cantos Visitante",
    "Under 7.5 Cantos Casa", "Under 7.5 Cantos Visitante",
    "Under 8.5 Cantos Casa", "Under 8.5 Cantos Visitante",
    "Under 9.5 Cantos Casa", "Under 9.5 Cantos Visitante",
    "Under 10.5 Cantos Casa", "Under 10.5 Cantos Visitante",
    "Under 11.5 Cantos Casa", "Under 11.5 Cantos Visitante",
    "Casa Marcou Mais Cantos", "Visitante Marcou Mais cantos",
    "Casa Race 3 Cantos", "Visitante Race 3 Cantos",
    "Casa Race 5 Cantos", "Visitante Race 5 Cantos",
]

CV_COLS_INPUT = [
    "CV Média Cantos Casa",
    "CV Média Cantos Visitante",
    "CV Média Cantos Marcados Casa",
    "CV Média Cantos Marcados Visitante",
]

# ------------------------------------------------------------
# UTILITÁRIOS I/O + NORMALIZAÇÃO
# ------------------------------------------------------------
def sniff_sep(path: Path) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        sample = f.read(4096)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t"])
        return dialect.delimiter
    except csv.Error:
        return ","


def load_cantos_data(date_str: str, base_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    files = {
        "10": base_dir / f"PackBall Custom cantos_10 {date_str}.csv",
        "20": base_dir / f"PackBall Custom cantos_20 {date_str}.csv",
    }
    dfs: dict[str, pd.DataFrame] = {}
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
    return hashlib.sha256("\x1f".join(str(column) for column in columns).encode("utf-8")).hexdigest()


def validate_source_schema(df: pd.DataFrame, label: str) -> None:
    actual = list(df.columns)
    if actual != SOURCE_HEADERS:
        mismatch = next(
            (index for index, pair in enumerate(zip(SOURCE_HEADERS, actual)) if pair[0] != pair[1]),
            min(len(actual), len(SOURCE_HEADERS)),
        )
        expected = SOURCE_HEADERS[mismatch] if mismatch < len(SOURCE_HEADERS) else "<missing>"
        received = actual[mismatch] if mismatch < len(actual) else "<missing>"
        raise ValueError(
            f"CORNERMATRIX_SCHEMA_DRIFT:{label}:index={mismatch}:expected={expected!r}:received={received!r}"
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
        "Resultado Casa", "Resultado Visitor",
    }
    num_cols = [c for c in df.columns if c not in keep_text]
    for c in num_cols:
        df[c] = _to_numeric_series(df[c])
    return df


def normalize_consistency_scale(df: pd.DataFrame, label: str) -> tuple[pd.DataFrame, str]:
    df = df.copy()
    scales = []
    for column in CV_COLS_INPUT:
        values = pd.to_numeric(df[column], errors="coerce").dropna()
        if values.empty:
            continue
        positive_fraction = values[(values > 0) & (values <= 1.0)]
        above_one = values[values > 1.0]
        if len(positive_fraction) >= 3 and len(above_one) and len(positive_fraction) / len(values) >= 0.10:
            raise ValueError(f"CORNERMATRIX_CV_MIXED_SCALE:{label}:{column}")
        if float(values.max()) <= 1.0:
            df[column] = pd.to_numeric(df[column], errors="coerce") * 100.0
            scales.append("0-1_to_0-100")
        else:
            scales.append("0-100")
    detected = "0-1_to_0-100" if scales and all(scale == "0-1_to_0-100" for scale in scales) else "0-100"
    return df, detected


def sanitize_pct_like_columns(df: pd.DataFrame, label: str = "") -> pd.DataFrame:
    """
    Para colunas de %/CV:
      - trata -1 como ausência de dado do PackBall;
      - qualquer valor fora de [0,100] vira NaN;
      - reduz ruído de log, sem imprimir dezenas de avisos repetidos.
    """
    df = df.copy()
    pct_cols = [c for c in df.columns if c in PCT_COLS_INPUT or c in CV_COLS_INPUT]

    total_sentinel = 0
    total_invalid = 0

    for c in pct_cols:
        x = df[c].astype(float)
        sentinel = x.notna() & (x < 0)
        invalid_high = x.notna() & (x > 100)

        if sentinel.any():
            total_sentinel += int(sentinel.sum())
            df.loc[sentinel, c] = np.nan

        if invalid_high.any():
            total_invalid += int(invalid_high.sum())
            df.loc[invalid_high, c] = np.nan

    if total_sentinel:
        logging.info(f"[{label}] {total_sentinel} valores -1 em colunas percentuais/CV tratados como NaN.")
    if total_invalid:
        logging.warning(f"[{label}] {total_invalid} valores >100 em colunas percentuais/CV tratados como NaN.")

    return df


def sanity_check_ranges(df: pd.DataFrame, label: str = "") -> None:
    odd_cols = [c for c in df.columns if c.startswith("Odd ")]
    for c in odd_cols:
        x = df[c]
        bad = x.notna() & ((x < 1.01) | (x > 200))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} odds fora do range [1.01,200]. Possível coluna desalinhada.")

    for c in PCT_COLS_INPUT:
        if c not in df.columns:
            continue
        x = df[c]
        bad = x.notna() & ((x < 0) | (x > 100))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} valores fora de [0,100]. Possível coluna desalinhada/placeholder.")

    for c in CV_COLS_INPUT:
        if c not in df.columns:
            continue
        x = df[c]
        bad = x.notna() & ((x < 0) | (x > 100))
        if bad.any():
            logging.warning(f"[{label}] {c}: {bad.sum()} CV fora de [0,100]. Possível coluna desalinhada.")


def filter_by_status_and_games(df: pd.DataFrame, statuses=("NS",), n_games: int = 5) -> pd.DataFrame:
    df = df.copy()

    st = df["Status"].astype(str).str.strip().str.upper()
    st = st.replace({"FT_PEN": "FT", "NF": "NS"})
    df["Status"] = st

    df = df[df["Status"].isin(list(statuses))].copy()

    df["Jogos Coletados Casa"] = pd.to_numeric(df["Jogos Coletados Casa"], errors="coerce")
    df["Jogos Coletados Visitante"] = pd.to_numeric(df["Jogos Coletados Visitante"], errors="coerce")

    df = df[
        (df["Jogos Coletados Casa"] == n_games) &
        (df["Jogos Coletados Visitante"] == n_games)
    ].copy()
    return df


def validate_window_profile(df: pd.DataFrame, expected_games: int, label: str) -> None:
    counts = pd.concat([
        pd.to_numeric(df["Jogos Coletados Casa"], errors="coerce"),
        pd.to_numeric(df["Jogos Coletados Visitante"], errors="coerce"),
    ]).dropna()
    if counts.empty or float(counts.max()) != float(expected_games) or bool((counts > expected_games).any()):
        observed = sorted({int(value) for value in counts.unique()}) if not counts.empty else []
        raise ValueError(f"CORNERMATRIX_WINDOW_MISMATCH:{label}:expected_max={expected_games}:observed={observed}")


def weighted_mix_pct(parts: list[pd.Series], weights: list[float]) -> pd.Series:
    """Mistura em % ignorando NaNs e renormalizando os pesos por linha."""
    w = np.asarray(weights, dtype=float)
    X = np.vstack([p.astype(float).values for p in parts])
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

    CV é um índice de consistência: quanto maior, mais confiável.
    O/U usa índice com maior peso no total da partida; mercados direcionais
    usam maior peso na consistência de cantos marcados.
    """
    merged = merged.copy()

    total_home = 0.60 * merged["CV Média Cantos Casa_20"] + 0.40 * merged["CV Média Cantos Marcados Casa_20"]
    total_away = 0.60 * merged["CV Média Cantos Visitante_20"] + 0.40 * merged["CV Média Cantos Marcados Visitante_20"]
    direction_home = 0.30 * merged["CV Média Cantos Casa_20"] + 0.70 * merged["CV Média Cantos Marcados Casa_20"]
    direction_away = 0.30 * merged["CV Média Cantos Visitante_20"] + 0.70 * merged["CV Média Cantos Marcados Visitante_20"]
    force_home = 0.50 * merged["CV Média Cantos Casa_20"] + 0.50 * merged["CV Média Cantos Marcados Casa_20"]
    force_away = 0.50 * merged["CV Média Cantos Visitante_20"] + 0.50 * merged["CV Média Cantos Marcados Visitante_20"]

    merged["_cv_total_home_20"], merged["_cv_total_away_20"] = total_home, total_away
    merged["_cv_direction_home_20"], merged["_cv_direction_away_20"] = direction_home, direction_away
    merged["_cv_idx_home_20"], merged["_cv_idx_away_20"] = force_home, force_away
    merged["_cv_game"] = (force_home + force_away) / 2.0

    delta_form = (
        (merged["Média Cantos Marcados Casa_10"] - merged["Média Cantos Marcados Casa_20"]).abs() +
        (merged["Média Cantos Sofridos Casa_10"] - merged["Média Cantos Sofridos Casa_20"]).abs() +
        (merged["Média Cantos Marcados Visitante_10"] - merged["Média Cantos Marcados Visitante_20"]).abs() +
        (merged["Média Cantos Sofridos Visitante_10"] - merged["Média Cantos Sofridos Visitante_20"]).abs()
    ) / 4.0

    merged["_delta_form_10v20"] = delta_form.round(3)
    recency_boost = (((delta_form - RECENT_DIVERGENCE_START) / RECENT_DIVERGENCE_RANGE).clip(0.0, 1.0) * RECENT_DIVERGENCE_MAX_BOOST)
    consistency_adjustment = ((50.0 - merged["_cv_game"]) / 100.0).clip(-0.03, 0.05)
    merged["_w10"] = (RECENT_WEIGHT_BASE + recency_boost + consistency_adjustment).clip(RECENT_WEIGHT_MIN, RECENT_WEIGHT_MAX)
    merged["_w20"] = 1.0 - merged["_w10"]
    return merged


def blend(merged: pd.DataFrame, col_base: str) -> pd.Series:
    """Mistura forma geral de 10j e estrutura de mando de 20j."""
    c10 = f"{col_base}_10"
    c20 = f"{col_base}_20"

    if c10 not in merged.columns or c20 not in merged.columns:
        raise KeyError(f"Colunas esperadas não encontradas para blend: {c10} / {c20}")

    if ("_w10" not in merged.columns) or ("_w20" not in merged.columns):
        w10 = pd.Series(RECENT_WEIGHT_BASE, index=merged.index, dtype=float)
        w20 = 1.0 - w10
    else:
        w10 = merged["_w10"].astype(float)
        w20 = merged["_w20"].astype(float)

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


def blend_optional(merged: pd.DataFrame, col_base: str, default: float | None = None) -> pd.Series:
    """
    Versão tolerante do blend:
      - usa 10j/20j quando as duas colunas existem;
      - usa a coluna disponível quando apenas uma existir;
      - aplica default quando tudo estiver ausente.
    """
    c10 = f"{col_base}_10"
    c20 = f"{col_base}_20"

    if c10 in merged.columns and c20 in merged.columns:
        out = blend(merged, col_base)
    elif c10 in merged.columns:
        out = merged[c10].astype(float)
    elif c20 in merged.columns:
        out = merged[c20].astype(float)
    elif col_base in merged.columns:
        out = merged[col_base].astype(float)
    else:
        out = pd.Series(np.nan, index=merged.index, dtype=float)

    if default is not None:
        out = out.fillna(float(default))
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


def calibrate_to_center(prob: pd.Series, center: pd.Series | float, shrink: float = 0.85) -> pd.Series:
    p = prob.astype(float)
    if isinstance(center, pd.Series):
        c = center.astype(float).reindex(p.index)
    else:
        c = float(center)
    return (c + (p - c) * float(shrink)).clip(0.0, 100.0)


def load_cornermatrix_calibration() -> dict:
    if not CALIBRATION_PATH.exists():
        return {}
    try:
        payload = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def apply_oos_calibration(
    market: str,
    probability_pct: pd.Series,
    *,
    fallback_market: str | None = None,
) -> tuple[pd.Series, dict]:
    markets = load_cornermatrix_calibration().get("markets", {})
    config = markets.get(market, {})
    calibration_key = market
    primary_sample = int(config.get("sample_size") or 0)
    primary_active = bool(config.get("active")) and bool(config.get("out_of_sample"))
    if fallback_market and (not primary_active or primary_sample < MIN_OOS_CALIBRATION_SAMPLE):
        fallback = markets.get(fallback_market, {})
        fallback_sample = int(fallback.get("sample_size") or 0)
        fallback_active = bool(fallback.get("active")) and bool(fallback.get("out_of_sample"))
        if fallback_active and fallback_sample >= MIN_OOS_CALIBRATION_SAMPLE:
            config = fallback
            calibration_key = fallback_market
    sample_size = int(config.get("sample_size") or 0)
    active = bool(config.get("active")) and bool(config.get("out_of_sample"))
    if not active or sample_size < MIN_OOS_CALIBRATION_SAMPLE:
        return probability_pct.astype(float), {
            "status": "identity_insufficient_oos_sample",
            "sample_size": sample_size,
            "calibration_key": calibration_key,
        }
    intercept = float(config.get("intercept", 0.0))
    slope = float(config.get("slope", 1.0))
    p = (probability_pct.astype(float) / 100.0).clip(1e-6, 1.0 - 1e-6)
    logit = np.log(p / (1.0 - p))
    calibrated = 1.0 / (1.0 + np.exp(-(intercept + slope * logit)))
    return calibrated * 100.0, {
        "status": "platt_logit_oos", "sample_size": sample_size,
        "intercept": intercept, "slope": slope, "calibration_key": calibration_key,
    }


def apply_component_disagreement_haircut(
    probability_pct: pd.Series,
    components: list[pd.Series],
    market_probability_pct: pd.Series,
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    component_frame = pd.concat([component.astype(float) for component in components], axis=1)
    spread = component_frame.max(axis=1, skipna=True) - component_frame.min(axis=1, skipna=True)
    requested = ((spread - COMPONENT_DISAGREEMENT_THRESHOLD).clip(lower=0.0) * DISAGREEMENT_HAIRCUT_STRENGTH).clip(
        upper=DISAGREEMENT_HAIRCUT_MAX_PP
    )
    delta = probability_pct.astype(float) - market_probability_pct.astype(float)
    haircut = pd.concat([requested, delta.abs()], axis=1).min(axis=1)
    adjusted = (probability_pct.astype(float) - np.sign(delta) * haircut).clip(0.0, 100.0)
    return adjusted, haircut, spread, spread >= STRONG_MARKET_CONFLICT_THRESHOLD


def finalize_two_way_probabilities(
    hist_a: pd.Series, hist_b: pd.Series,
    sim_a: pd.Series, sim_b: pd.Series,
    market_a: pd.Series, market_b: pd.Series,
    weights: list[float], shrink: float, market_key: str,
    market_key_b: str | None = None,
    fallback_market: str | None = None,
) -> dict[str, object]:
    paired = np.isfinite(market_a.astype(float)) & np.isfinite(market_b.astype(float))
    raw_a = weighted_mix_pct([hist_a, sim_a, market_a], weights)
    raw_b = weighted_mix_pct([hist_b, sim_b, market_b], weights)
    total = raw_a + raw_b
    valid = np.isfinite(total) & (total > 0) & paired
    normalized_a = pd.Series(np.nan, index=hist_a.index, dtype=float)
    normalized_a.loc[valid] = raw_a.loc[valid] / total.loc[valid] * 100.0
    heuristic_a = calibrate(normalized_a, shrink=shrink)
    calibrated_a, calibration_a = apply_oos_calibration(
        market_key, heuristic_a, fallback_market=fallback_market
    )
    calibration_b = calibration_a
    if market_key_b:
        calibrated_b, calibration_b = apply_oos_calibration(
            market_key_b, 100.0 - heuristic_a, fallback_market=fallback_market
        )
        calibrated_total = calibrated_a + calibrated_b
        calibrated_a = (calibrated_a / calibrated_total * 100.0).where(calibrated_total > 0)
    final_a, haircut, spread, conflict = apply_component_disagreement_haircut(
        calibrated_a, [hist_a, sim_a, market_a], market_a
    )
    final_a = final_a.where(valid)
    return {
        "a": final_a.round(2), "b": (100.0 - final_a).where(valid).round(2),
        "raw_a": normalized_a.round(2), "pre_haircut_a": calibrated_a.round(2),
        "haircut": haircut.round(2), "spread": spread.round(2),
        "conflict": conflict.fillna(False), "paired": pd.Series(paired, index=hist_a.index),
        "calibration": {
            **calibration_a,
            "status_b": calibration_b.get("status"),
            "calibration_key_b": calibration_b.get("calibration_key"),
        },
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


def _is_candidate_pick(
    prob,
    odd,
    min_prob: float = MIN_PROB,
    min_odd: float = MIN_ODD,
    max_odd: float = MAX_ODD,
) -> bool:
    try:
        prob = float(prob)
        odd = float(odd)
    except (TypeError, ValueError):
        return False
    return np.isfinite(prob) and np.isfinite(odd) and prob >= min_prob and min_odd <= odd <= max_odd


def _passes_cv_filter(
    row: pd.Series,
    min_cv: float,
    cv_field_home: str,
    cv_field_away: str,
    min_cv_individual: float | None = None,
) -> bool:
    """Exige consistência mínima dos dois times para o mercado."""
    try:
        cv_home = float(row.get(cv_field_home))
        cv_away = float(row.get(cv_field_away))
    except Exception:
        return False

    if not np.isfinite(cv_home) or not np.isfinite(cv_away):
        return False
    individual_floor = float(min_cv if min_cv_individual is None else min_cv_individual)
    return (
        cv_home >= individual_floor
        and cv_away >= individual_floor
        and ((cv_home + cv_away) / 2.0) >= float(min_cv)
    )


def _market_thresholds(mercado: str, pick: str = "") -> tuple[float, float, float]:
    mercado = str(mercado).strip().lower()

    if mercado == "over/under cantos":
        return MIN_PROB_OU, MIN_CV_OU, MIN_EDGE_OU
    if mercado == "mais cantos":
        return MIN_PROB_MAIS, MIN_CV_MAIS, MIN_EDGE_MAIS
    if mercado == "race cantos":
        return MIN_PROB_RACE, MIN_CV_RACE, MIN_EDGE_RACE
    return MIN_PROB, MIN_CV_MARKED, MIN_EDGE_OU


def apply_value_filter(
    base: pd.DataFrame,
    prob_col: str,
    odd_col: str,
    min_prob: float = MIN_PROB,
    min_cv: float | None = None,
    min_edge: float = 0.0,
    cv_fields: tuple[str, str] = ("CV Index Total Casa", "CV Index Total Visitante"),
    min_cv_individual: float | None = None,
) -> pd.DataFrame:
    """Aplica filtro de valor, faixa de odd, probabilidade mínima e CV mínimo do mercado."""
    base = base.copy()

    def _row_ok(r: pd.Series) -> bool:
        value_ok = _is_candidate_pick(r.get(prob_col), r.get(odd_col), min_prob=min_prob)
        if not value_ok:
            return False
        if min_cv is None:
            return True
        return _passes_cv_filter(
            r,
            min_cv=min_cv,
            cv_field_home=cv_fields[0],
            cv_field_away=cv_fields[1],
            min_cv_individual=min_cv_individual,
        )

    mask = base.apply(_row_ok, axis=1)
    base.loc[~mask, [prob_col, odd_col]] = np.nan
    return base


def _safe_break_even_pct(odd: pd.Series) -> pd.Series:
    odd = odd.astype(float)
    out = pd.Series(np.nan, index=odd.index, dtype=float)
    valid = np.isfinite(odd) & (odd > 1.0)
    out.loc[valid] = 100.0 / odd.loc[valid]
    return out


def add_ou_corner_cost_and_filter(
    base: pd.DataFrame,
    prob_col: str,
    odd_col: str,
    linha: float,
    side: str,
) -> pd.DataFrame:
    """
    Aplica custo de canto apenas em Over/Under.

    Over:  margem = Exp. Cantos Modelo - linha
    Under: margem = linha - Exp. Cantos Modelo
    """
    base = base.copy()
    line_key = f"{float(linha)}"
    margem_col = f"{side} {line_key} Margem Canto"
    custo_col = f"{side} {line_key} Custo Canto"

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

    mask_cost = (margem >= MIN_MARGEM_CANTO_OU) & (custo <= MAX_CUSTO_CANTO_OU)
    base.loc[~mask_cost, [prob_col, odd_col]] = np.nan
    return base


def add_directional_cost_indicators(base: pd.DataFrame) -> pd.DataFrame:
    """Indicadores técnicos para Mais Cantos. Não filtra automaticamente."""
    base = base.copy()
    eps = 1e-9
    lam_h = base["Lambda Casa"].astype(float)
    lam_a = base["Lambda Visitante"].astype(float)
    lam_t = (lam_h + lam_a).replace(0, np.nan)

    share_h = lam_h / (lam_t + eps)
    share_a = lam_a / (lam_t + eps)

    mappings = [
        ("Casa Mais Cantos", share_h, "Odd Casa Mais Cantos"),
        ("Visitante Mais Cantos", share_a, "Odd Visitante Mais Cantos"),
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


def add_race_cost_indicators(base: pd.DataFrame, k: int) -> pd.DataFrame:
    """Indicadores técnicos para Race k Cantos. Não filtra automaticamente."""
    base = base.copy()
    mappings = [
        (f"Casa Race {k} Cantos", f"Casa Race {k} Cantos prob", f"Odd Casa Race {k} Cantos"),
        (f"Visitante Race {k} Cantos", f"Visitante Race {k} Cantos prob", f"Odd Visitante Race {k} Cantos"),
    ]
    for prefix, prob_col, odd_col in mappings:
        strength = base[prob_col].astype(float) / 100.0 if prob_col in base.columns else pd.Series(np.nan, index=base.index)
        odd = base[odd_col].astype(float) if odd_col in base.columns else pd.Series(np.nan, index=base.index)
        break_even = _safe_break_even_pct(odd)
        cost = pd.Series(np.nan, index=base.index, dtype=float)
        ok = np.isfinite(strength) & np.isfinite(break_even) & (strength > 0)
        cost.loc[ok] = break_even.loc[ok] / strength.loc[ok]

        base[f"{prefix} Força %"] = (strength * 100.0).round(2)
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

    alpha_arr = np.broadcast_to(np.asarray(alpha, dtype=float), (n_games,))
    positive = np.isfinite(alpha_arr) & (alpha_arr > 0)
    g = np.ones((n_games, n_sims), dtype=float)
    if positive.any():
        k = 1.0 / alpha_arr[positive, None]
        g[positive] = rng.gamma(shape=k, scale=1.0 / k, size=(int(positive.sum()), n_sims))
    home = rng.poisson(lam_home[:, None] * g)
    away = rng.poisson(lam_away[:, None] * g)
    return home, away

# ------------------------------------------------------------
# RACE: fórmula fechada
# P(T_h < T_a) = I_{ λ_h/(λ_h+λ_a) }(k, k)
# ------------------------------------------------------------
def race_prob_home_closed_form(lam_h: np.ndarray, lam_a: np.ndarray, k: int) -> np.ndarray:
    lam_h = np.asarray(lam_h, dtype=float)
    lam_a = np.asarray(lam_a, dtype=float)
    out = np.full_like(lam_h, np.nan, dtype=float)

    valid = np.isfinite(lam_h) & np.isfinite(lam_a) & (lam_h > 0) & (lam_a > 0)
    x = np.zeros_like(lam_h, dtype=float)
    x[valid] = lam_h[valid] / (lam_h[valid] + lam_a[valid])

    if _HAS_BETAINC:
        out[valid] = betainc(k, k, x[valid])
    else:
        logging.warning("scipy.special.betainc indisponível. Race cairá para fallback por simulação.")
        rng = np.random.default_rng(SIM_SEED)
        sims = 5000
        for i in np.where(valid)[0]:
            t_h = rng.gamma(shape=k, scale=1.0 / lam_h[i], size=sims)
            t_a = rng.gamma(shape=k, scale=1.0 / lam_a[i], size=sims)
            out[i] = np.mean(t_h < t_a)
    return out

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
    config = load_cornermatrix_calibration().get("league_baselines", {})
    totals, shares, statuses = [], [], []
    for _, row in out.iterrows():
        country = str(row.get("Pais") or "")
        league = str(row.get("Liga") or "")
        keys = ("|".join(str(row.get(column) or "") for column in LEAGUE_KEYS), f"{country} - {league}", league)
        item = next((config[key] for key in keys if isinstance(config, dict) and key in config), {})
        sample_size = int(item.get("sample_size") or 0)
        active = bool(item.get("active")) and bool(item.get("out_of_sample")) and sample_size >= 50
        source_total = row.get("Média Cantos Liga_20")
        source_total = float(source_total) if pd.notna(source_total) and float(source_total) > 0 else L_TOTAL_DEFAULT
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
    config = load_cornermatrix_calibration().get("league_alpha", {})
    values, statuses = [], []
    for _, row in merged.iterrows():
        country = str(row.get("Pais") or "")
        league = str(row.get("Liga") or "")
        keys = ("|".join(str(row.get(column) or "") for column in LEAGUE_KEYS), f"{country} - {league}", league)
        item = next((config[key] for key in keys if isinstance(config, dict) and key in config), {})
        sample_size = int(item.get("sample_size") or 0)
        active = bool(item.get("active")) and bool(item.get("out_of_sample")) and sample_size >= 50
        if active:
            shrink = sample_size / (sample_size + 100.0)
            observed = float(item.get("alpha", ALPHA_DEFAULT))
            values.append(float(np.clip(shrink * observed + (1.0 - shrink) * ALPHA_DEFAULT, 0.0, 0.80)))
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

    gamma_home = _gamma_from_cv(cvh)
    gamma_away = _gamma_from_cv(cva)

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

    merged2["_L_total"] = L_total
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
    if mercado == "Over/Under Cantos" and linha not in (None, ""):
        line_key = f"{float(linha)}"
        prob = row.get(f"{pick} {line_key} Cantos prob")
        margem = row.get(f"{pick} {line_key} Margem Canto")
        custo = row.get(f"{pick} {line_key} Custo Canto")
        return (
            f"  • Linha {line_key}: {pick} {_fmt_obs_num(prob, 2)}% | "
            f"Margem: {_fmt_obs_num(margem, 2, signed=True)} | Custo Canto: {_fmt_obs_num(custo, 2)}"
        )
    if mercado == "Mais Cantos":
        if pick == "Casa":
            prefix = "Casa Mais Cantos"
        elif pick == "Visitante":
            prefix = "Visitante Mais Cantos"
        else:
            prefix = pick
        return (
            f"  • {prefix}: {_fmt_obs_num(row.get(f'{prefix} prob'), 2)}% | "
            f"Força: {_fmt_obs_num(row.get(f'{prefix} Força %'), 2)} | "
            f"Custo: {_fmt_obs_num(row.get(f'{prefix} Custo'), 2)}"
        )
    if mercado == "Race Cantos":
        prefix = str(pick)
        return (
            f"  • {prefix}: {_fmt_obs_num(row.get(f'{prefix} prob'), 2)}% | "
            f"Força: {_fmt_obs_num(row.get(f'{prefix} Força %'), 2)} | "
            f"Custo: {_fmt_obs_num(row.get(f'{prefix} Custo'), 2)}"
        )
    return ""


def _technical_context(row: pd.Series, mercado: str = "", pick: str = "", linha=None) -> str:
    home = str(row.get("Time Casa", "") or "").strip()
    away = str(row.get("Time Visitante", "") or "").strip()
    home_rank = _fmt_obs_num(row.get("Classificação Casa"), 0)
    away_rank = _fmt_obs_num(row.get("Classificação Visitante"), 0)
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
            "Força esperada cantos C/V/T:   "
            f"{_fmt_obs_num(row.get('Lambda Casa'), 3)} / "
            f"{_fmt_obs_num(row.get('Lambda Visitante'), 3)} / "
            f"{_fmt_obs_num(row.get('Lambda Total'), 3)}"
        ),
        f"Exp. de Cantos (modelo):       {_fmt_obs_num(row.get('Lambda Total'), 2)}",
        f"Exp. de Cantos (Packball):     {_fmt_obs_num(row.get('Expectativa de Cantos'), 2)}",
        f"Média Cantos Liga:             {_fmt_obs_num(row.get('Média Cantos Liga'), 2)}",
        f"Odd Casa MO:                   {_fmt_obs_num(row.get('Odd Casa MO'), 2)}",
        f"Odd Visitante MO:              {_fmt_obs_num(row.get('Odd Visitante MO'), 2)}",
        f"CV Cantos Marcados Casa:       {_fmt_obs_num(row.get('CV Cantos Marcados Casa'), 2)}%",
        f"CV Cantos Marcados Visitante:  {_fmt_obs_num(row.get('CV Cantos Marcados Visitante'), 2)}%",
    ]
    detail = _pick_technical_line(row, mercado=mercado, pick=pick, linha=linha)
    if detail:
        lines.append("")
        lines.append(detail)
    return "\n".join(line for line in lines if line is not None)


def _fmt_obs(row: pd.Series, mercado: str = "", pick: str = "", linha=None) -> str:
    base_obs = (
        f"Média de Cantos Marcados/Sofridos: Casa {_fmt_obs_num(row.get('Média Marcados Casa'), 2)}/"
        f"{_fmt_obs_num(row.get('Média Sofridos Casa'), 2)}; Visitante {_fmt_obs_num(row.get('Média Marcados Visitante'), 2)}/"
        f"{_fmt_obs_num(row.get('Média Sofridos Visitante'), 2)} | "
        f"Força esperada de cantos: Casa {_fmt_obs_num(row.get('Lambda Casa'), 3)}; "
        f"Visitante {_fmt_obs_num(row.get('Lambda Visitante'), 3)}; Total {_fmt_obs_num(row.get('Lambda Total'), 3)} | "
        f"Exp Cantos Modelo: {_fmt_obs_num(row.get('Lambda Total'), 2)} | "
        f"Média Cantos Liga: {_fmt_obs_num(row.get('Média Cantos Liga'), 2)} | "
        f"CV Times: Casa {_fmt_obs_num(row.get('CV Cantos Marcados Casa'), 2)}%; "
        f"Visitante {_fmt_obs_num(row.get('CV Cantos Marcados Visitante'), 2)}%"
    )

    extra = ""
    if mercado == "Over/Under Cantos" and linha not in (None, ""):
        line_key = f"{float(linha)}"
        margem = row.get(f"{pick} {line_key} Margem Canto")
        custo = row.get(f"{pick} {line_key} Custo Canto")
        extra = (
            f" | Margem Cantos Modelo ({pick} {line_key}): {_fmt_obs_num(margem, 2, signed=True)}; "
            f"Custo de Canto: {_fmt_obs_num(custo, 2)}"
        )
    elif mercado == "Mais Cantos":
        prefix = "Casa Mais Cantos" if pick == "Casa" else "Visitante Mais Cantos" if pick == "Visitante" else ""
        if prefix:
            extra = (
                f" | Força {prefix}: {_fmt_obs_num(row.get(f'{prefix} Força %'), 2)}%; "
                f"Custo {prefix}: {_fmt_obs_num(row.get(f'{prefix} Custo'), 2)}; "
                f"Empate cantos simulado: {_fmt_obs_num(row.get('Empate Mais Cantos prob'), 2)}%"
            )
    elif mercado == "Race Cantos":
        prefix = str(pick)
        if prefix:
            extra = (
                f" | Força {prefix}: {_fmt_obs_num(row.get(f'{prefix} Força %'), 2)}%; "
                f"Custo {prefix}: {_fmt_obs_num(row.get(f'{prefix} Custo'), 2)}"
            )

    return base_obs + extra


def _lovable_pick_label(mercado: str, pick: str) -> str:
    mercado_norm = str(mercado).strip().lower()
    pick_norm = str(pick).strip()

    if mercado_norm == "over/under cantos":
        return f"{pick_norm} Cantos"
    if mercado_norm == "mais cantos":
        mapping = {
            "Casa": "Casa Mais Cantos",
            "Visitante": "Visitante Mais Cantos",
        }
        return mapping.get(pick_norm, pick_norm)
    if mercado_norm == "race cantos":
        return pick_norm

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
    mercado_norm = str(mercado).strip().lower()
    pick_norm = str(pick).strip().lower()
    if mercado_norm == "over/under cantos":
        side_a = pick_norm == "over"
        prefix = f"OU {float(linha)}"
        hist_a = float(row.get(f"{prefix} Hist Over"))
        sim_a = float(row.get(f"{prefix} Sim Over"))
        no_vig_a = float(row.get(f"{prefix} NoVig Over"))
        raw_a = float(row.get(f"{prefix} Prob Raw Over"))
        pre_a = float(row.get(f"{prefix} Prob PreHaircut Over"))
        result = {
            "market_type": "OU", "selection_side": "OVER" if side_a else "UNDER",
            "prob_hist": hist_a if side_a else 100.0 - hist_a,
            "prob_sim": sim_a if side_a else 100.0 - sim_a,
            "prob_no_vig": no_vig_a if side_a else 100.0 - no_vig_a,
            "prob_raw": raw_a if side_a else 100.0 - raw_a,
            "prob_pre_haircut": pre_a if side_a else 100.0 - pre_a,
            "haircut_pp": row.get(f"{prefix} Haircut"), "component_spread_pp": row.get(f"{prefix} Spread"),
            "market_conflict_status": row.get(f"{prefix} Conflict"),
            "calibration_status": row.get(f"{prefix} Calibration {'Over' if side_a else 'Under'}"),
            "calibration_key": row.get(f"{prefix} Calibration Key {'Over' if side_a else 'Under'}"),
        }
        result["paired_odds_status"] = "ODDS_PAREADAS_VALIDAS" if np.isfinite(no_vig_a) else "SEM_ODDS_PAREADAS"
        return result
    if mercado_norm == "mais cantos":
        side_a = pick_norm == "casa"
        result = {
            "market_type": "MAIS_CANTOS", "selection_side": "CASA" if side_a else "VISITANTE",
            "prob_hist": row.get("Mais Hist Casa") if side_a else 100.0 - float(row.get("Mais Hist Casa")),
            "prob_sim": row.get("Mais Sim Casa") if side_a else 100.0 - float(row.get("Mais Sim Casa")),
            "prob_no_vig": row.get("Mais NoVig Casa") if side_a else 100.0 - float(row.get("Mais NoVig Casa")),
            "prob_raw": row.get("Mais Prob Raw Casa") if side_a else 100.0 - float(row.get("Mais Prob Raw Casa")),
            "prob_pre_haircut": row.get("Mais Prob PreHaircut Casa") if side_a else 100.0 - float(row.get("Mais Prob PreHaircut Casa")),
            "haircut_pp": row.get("Mais Haircut"), "component_spread_pp": row.get("Mais Spread"),
            "market_conflict_status": row.get("Mais Conflict"), "calibration_status": row.get("Mais Calibration"),
        }
        result["paired_odds_status"] = "ODDS_PAREADAS_VALIDAS" if np.isfinite(float(result["prob_no_vig"])) else "SEM_ODDS_PAREADAS"
        return result
    k = int(float(linha))
    side_a = pick_norm.startswith("casa")
    result = {
        "market_type": f"RACE_{k}", "selection_side": "CASA" if side_a else "VISITANTE",
        "prob_hist": row.get(f"Race {k} Hist Casa") if side_a else 100.0 - float(row.get(f"Race {k} Hist Casa")),
        "prob_sim": row.get(f"Race {k} Sim Casa") if side_a else 100.0 - float(row.get(f"Race {k} Sim Casa")),
        "prob_no_vig": row.get(f"Race {k} NoVig Casa") if side_a else 100.0 - float(row.get(f"Race {k} NoVig Casa")),
        "prob_raw": row.get(f"Race {k} Prob Raw Casa") if side_a else 100.0 - float(row.get(f"Race {k} Prob Raw Casa")),
        "prob_pre_haircut": row.get(f"Race {k} Prob PreHaircut Casa") if side_a else 100.0 - float(row.get(f"Race {k} Prob PreHaircut Casa")),
        "haircut_pp": row.get(f"Race {k} Haircut"), "component_spread_pp": row.get(f"Race {k} Spread"),
        "market_conflict_status": row.get(f"Race {k} Conflict"), "calibration_status": row.get(f"Race {k} Calibration"),
    }
    result["paired_odds_status"] = "ODDS_PAREADAS_VALIDAS" if np.isfinite(float(result["prob_no_vig"])) else "SEM_ODDS_PAREADAS"
    return result


def _component_conflict_status(spread) -> str:
    try:
        value = float(spread)
    except (TypeError, ValueError):
        return "COMPONENTES_INDETERMINADOS"
    if not np.isfinite(value):
        return "COMPONENTES_INDETERMINADOS"
    if value >= STRONG_MARKET_CONFLICT_THRESHOLD:
        return "CONFLITO_FORTE_ENTRE_COMPONENTES"
    if value >= COMPONENT_UNCERTAINTY_THRESHOLD:
        return "COMPONENTES_DIVERGENTES"
    return "COMPONENTES_ALINHADOS"


def _diagnostic_text(row: pd.Series, diagnostics: dict) -> str:
    return (
        f"modelo_versao={MODEL_VERSION}; market_type={diagnostics.get('market_type')}; "
        f"prob_hist={_fmt_obs_num(diagnostics.get('prob_hist'), 2)}; prob_sim={_fmt_obs_num(diagnostics.get('prob_sim'), 2)}; "
        f"prob_no_vig={_fmt_obs_num(diagnostics.get('prob_no_vig'), 2)}; prob_raw={_fmt_obs_num(diagnostics.get('prob_raw'), 2)}; "
        f"prob_pre_haircut={_fmt_obs_num(diagnostics.get('prob_pre_haircut'), 2)}; haircut_pp={_fmt_obs_num(diagnostics.get('haircut_pp'), 2)}; "
        f"component_spread_pp={_fmt_obs_num(diagnostics.get('component_spread_pp'), 2)}; "
        f"component_conflict_status={diagnostics.get('component_conflict_status')}; "
        f"market_conflict_status={diagnostics.get('market_conflict_status')}; "
        f"paired_odds_status={diagnostics.get('paired_odds_status')}; calibration_status={diagnostics.get('calibration_status')}; "
        f"calibration_key={diagnostics.get('calibration_key')}; "
        f"w10={_fmt_obs_num(row.get('w10'), 3)}; w20={_fmt_obs_num(row.get('w20'), 3)}; "
        f"league_baseline_status={row.get('League Baseline Status')}; alpha={_fmt_obs_num(row.get('Alpha Liga'), 4)}; "
        f"alpha_status={row.get('Alpha Status')}; cv_scale_10={RUN_PROVENANCE.get('cv_scale_10', '-')}; "
        f"cv_scale_20={RUN_PROVENANCE.get('cv_scale_20', '-')}; input_hash_10={RUN_PROVENANCE.get('sha256_10', '-')}; "
        f"input_hash_20={RUN_PROVENANCE.get('sha256_20', '-')}; schema_hash={RUN_PROVENANCE.get('schema_hash', '-')}"
    )

def _add_lovable_row(rows: list[dict], row: pd.Series, mercado: str, pick: str, linha, prob, odd) -> None:
    min_prob, min_cv, min_edge = _market_thresholds(mercado, pick)
    if not _is_candidate_pick(prob, odd, min_prob=min_prob):
        return
    cv_fields = (
        ("CV Index Total Casa", "CV Index Total Visitante")
        if str(mercado).strip().lower() == "over/under cantos"
        else ("CV Index Direcional Casa", "CV Index Direcional Visitante")
    )
    min_cv_individual = MIN_CV_OU_INDIVIDUAL if str(mercado).strip().lower() == "over/under cantos" else None
    if not _passes_cv_filter(
        row,
        min_cv=min_cv,
        cv_field_home=cv_fields[0],
        cv_field_away=cv_fields[1],
        min_cv_individual=min_cv_individual,
    ):
        return

    prob = float(prob)
    odd = float(odd)
    odd_valor = 100.0 / prob
    edge = ((odd * prob / 100.0) - 1.0) * 100.0
    minimum_executable_odd = odd_valor * (1.0 + min_edge / 100.0)
    diagnostics = _pick_probability_diagnostics(row, mercado, pick, linha)
    diagnostics["component_conflict_status"] = _component_conflict_status(diagnostics.get("component_spread_pp"))
    diagnostic_text = _diagnostic_text(row, diagnostics)
    technical_context = _technical_context(row, mercado=mercado, pick=pick, linha=linha)
    technical_context = (
        f"{technical_context}\n--- MODELO ---\n{diagnostic_text}\n"
        "Status operacional: CANDIDATO_CORNER - exige odd executavel na Validacao Critica.\n"
        "Odds PackBall sao referencia media de 1 a 5 casas; quantidade de casas nao disponivel.\n"
        f"Edge referencial: {edge:.2f}% | Edge exigido: {min_edge:.2f}% | "
        f"Odd minima publicacao: {minimum_executable_odd:.3f}"
    )

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
        "edge_referencial": round(edge, 2),
        "required_edge": round(min_edge, 2),
        "odd_minima_publicacao": round(minimum_executable_odd, 3),
        "requires_executable_odd": True,
        "odd_mercado_base": round(odd, 2),
        "odd_mediana": None,
        "stake": 0.0,
        "modelo_versao": MODEL_VERSION,
        "market_type": diagnostics.get("market_type"), "selection_side": diagnostics.get("selection_side"),
        "market_conflict_status": diagnostics.get("market_conflict_status") or "ALINHADO",
        "component_conflict_status": diagnostics.get("component_conflict_status"),
        "paired_odds_status": diagnostics.get("paired_odds_status"),
        "prob_hist": round(float(diagnostics.get("prob_hist")), 2), "prob_sim": round(float(diagnostics.get("prob_sim")), 2),
        "prob_no_vig": round(float(diagnostics.get("prob_no_vig")), 2), "prob_raw": round(float(diagnostics.get("prob_raw")), 2),
        "prob_pre_haircut": round(float(diagnostics.get("prob_pre_haircut")), 2),
        "haircut_pp": round(float(diagnostics.get("haircut_pp")), 2),
        "component_spread_pp": round(float(diagnostics.get("component_spread_pp")), 2),
        "calibration_status": diagnostics.get("calibration_status"),
        "calibration_key": diagnostics.get("calibration_key"),
        "price_status": "AGUARDANDO_ODD_EXECUTAVEL",
        "observacoes": (
            _fmt_obs(row, mercado=mercado, pick=pick, linha=linha)
            + " | "
            + diagnostic_text
            + f"; Edge referencial: {edge:.2f}%; Edge exigido: {min_edge:.2f}%; "
            + f"Odd minima publicacao: {minimum_executable_odd:.3f}"
        ),
        "dados_tecnicos": technical_context, "contexto_adicional": technical_context, "contexto_modelo": technical_context,
        "parecer_validacao": "AGUARDAR_ODD_EXECUTAVEL",
    })


def classify_executable_price(probability_pct, odd, required_edge: float) -> tuple[str, float | None]:
    try:
        probability = float(probability_pct) / 100.0
        executable_odd = float(odd)
    except (TypeError, ValueError):
        return "AGUARDANDO_ODD_EXECUTAVEL", None
    if not (0.0 < probability < 1.0) or executable_odd <= 1.0:
        return "AGUARDANDO_ODD_EXECUTAVEL", None
    edge = (executable_odd * probability - 1.0) * 100.0
    return ("ODD_APROVADA" if edge >= float(required_edge) else "SEM_VALOR"), edge


def kelly_stake_units(
    probability_pct,
    odd,
    *,
    conflict: bool = False,
    component_spread_pp: float | None = None,
    calibration_status: str | None = None,
) -> float:
    try:
        probability = float(probability_pct) / 100.0
        decimal_odd = float(odd)
    except (TypeError, ValueError):
        return 0.0
    if not (0.0 < probability < 1.0) or decimal_odd <= 1.0:
        return 0.0
    b = decimal_odd - 1.0
    full_kelly = max(0.0, (b * probability - (1.0 - probability)) / b)
    units = min(MAX_PICK_UNITS, full_kelly * KELLY_FRACTION * 100.0)
    if conflict:
        units = min(units, CONFLICT_MAX_UNITS)
    else:
        try:
            spread = float(component_spread_pp)
        except (TypeError, ValueError):
            spread = 0.0
        if spread >= COMPONENT_UNCERTAINTY_THRESHOLD:
            units = min(units, UNCERTAINTY_MAX_UNITS)
        elif "insufficient_oos" in str(calibration_status or "").lower():
            units = min(units, MAX_PICK_UNITS)
    return math.floor(units * 4.0 + 1e-9) / 4.0


def limit_correlated_picks(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        grouped.setdefault((str(row.get("jogo")), str(row.get("market_type"))), []).append(row)
    selected: list[dict] = []
    for (_game, market_type), group in grouped.items():
        ranked = sorted(
            group,
            key=lambda item: (
                float(item.get("probabilidade_final") or 0.0),
                float(item.get("edge_referencial") or item.get("edge") or 0.0),
            ),
            reverse=True,
        )
        if market_type == "OU" and ranked:
            principal = ranked[0]
            same_side = [item for item in ranked if item.get("selection_side") == principal.get("selection_side")]
            principal_line = float(principal.get("linha"))
            same_side.sort(key=lambda item: (0 if item is principal else 1, abs(float(item.get("linha")) - principal_line), -float(item.get("edge") or 0.0)))
            chosen = same_side[:MAX_CORRELATED_LINES]
        else:
            chosen = ranked[:1]
        for index, item in enumerate(chosen):
            if item.get("market_conflict_status") == "CONFLITO_FORTE_COM_MERCADO":
                item["selection_role"] = "CANDIDATO_CORNER_CONFLITO"
            else:
                item["selection_role"] = "CANDIDATO_CORNER_PRINCIPAL" if index == 0 else "CANDIDATO_CORNER_ALTERNATIVA"
        selected.extend(chosen)
    return selected


def apply_exposure_caps(rows: list[dict]) -> list[dict]:
    for row in rows:
        row["stake"] = 0.0
    return rows


def build_lovable_export(base: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, row in base.iterrows():
        for t in ths_ft:
            _add_lovable_row(
                rows, row,
                mercado="Over/Under Cantos",
                pick="Over",
                linha=t,
                prob=row.get(f"Over {t} Cantos prob"),
                odd=row.get(f"Odd Over {t} Cantos"),
            )
            _add_lovable_row(
                rows, row,
                mercado="Over/Under Cantos",
                pick="Under",
                linha=t,
                prob=row.get(f"Under {t} Cantos prob"),
                odd=row.get(f"Odd Under {t} Cantos"),
            )

        _add_lovable_row(rows, row, "Mais Cantos", "Casa", "", row.get("Casa Mais Cantos prob"), row.get("Odd Casa Mais Cantos"))
        _add_lovable_row(rows, row, "Mais Cantos", "Visitante", "", row.get("Visitante Mais Cantos prob"), row.get("Odd Visitante Mais Cantos"))

        for k in race_targets:
            _add_lovable_row(rows, row, "Race Cantos", f"Casa Race {k} Cantos", k, row.get(f"Casa Race {k} Cantos prob"), row.get(f"Odd Casa Race {k} Cantos"))
            _add_lovable_row(rows, row, "Race Cantos", f"Visitante Race {k} Cantos", k, row.get(f"Visitante Race {k} Cantos prob"), row.get(f"Odd Visitante Race {k} Cantos"))

    rows = apply_exposure_caps(limit_correlated_picks(rows))

    cols = [
        "data", "hora", "esporte", "liga", "jogo", "mandante", "visitante",
        "mercado", "pick", "linha", "odd_ofertada", "odd_valor",
        "probabilidade_final", "edge", "edge_referencial", "required_edge", "odd_minima_publicacao",
        "requires_executable_odd", "odd_mercado_base", "odd_mediana", "stake",
        "modelo_versao", "market_type", "selection_side",
        "selection_role", "market_conflict_status", "component_conflict_status", "paired_odds_status",
        "prob_hist", "prob_sim", "prob_no_vig",
        "prob_raw", "prob_pre_haircut", "haircut_pp", "component_spread_pp", "calibration_status", "calibration_key",
        "price_status", "observacoes", "dados_tecnicos", "contexto_adicional", "contexto_modelo", "parecer_validacao",
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
    df10_raw, df20_raw = load_cantos_data(date_str, base_dir)
    validate_source_schema(df10_raw, "10j")
    validate_source_schema(df20_raw, "20j")
    if list(df10_raw.columns) != list(df20_raw.columns):
        raise ValueError("CORNERMATRIX_SCHEMA_MISMATCH:10j_vs_20j")
    df10 = coerce_numeric(normalize_columns(df10_raw))
    df20 = coerce_numeric(normalize_columns(df20_raw))
    validate_window_profile(df10, 10, "recent10")
    validate_window_profile(df20, 20, "venue20")
    df10, cv_scale_10 = normalize_consistency_scale(df10, "10j")
    df20, cv_scale_20 = normalize_consistency_scale(df20, "20j")
    RUN_PROVENANCE["cv_scale_10"] = cv_scale_10
    RUN_PROVENANCE["cv_scale_20"] = cv_scale_20

    df10 = sanitize_pct_like_columns(df10, "df10")
    df20 = sanitize_pct_like_columns(df20, "df20")

    sanity_check_ranges(df10, "df10")
    sanity_check_ranges(df20, "df20")

    # 2) Filtrar conforme RUN_MODE
    df10_f = filter_by_status_and_games(df10, STATUSES, n_games=10)
    df20_f = filter_by_status_and_games(df20, STATUSES, n_games=20)
    logging.info(f"RUN_MODE={RUN_MODE} | STATUS={STATUSES}")
    logging.info(f"df10_filtrado: {df10_f.shape} | df20_filtrado: {df20_f.shape}")

    # 3) Merge
    merged = merge_10_20(df10_f, df20_f)
    logging.info(f"merged (10+20) shape: {merged.shape}")

    # Mantemos também as colunas _20 de Expectativa/Média Liga para compor baseline estrutural.
    # 4) Pesos dinâmicos
    merged = build_dynamic_weights(merged)

    # 5) Métricas blend + lambdas
    mu_home_marked = blend(merged, "Média Cantos Marcados Casa")
    mu_away_marked = blend(merged, "Média Cantos Marcados Visitante")
    mu_home_conceded = blend(merged, "Média Cantos Sofridos Casa")
    mu_away_conceded = blend(merged, "Média Cantos Sofridos Visitante")

    lambda_home, lambda_away, merged = build_lambdas_force_model(
        merged,
        mu_home_for=mu_home_marked,
        mu_away_for=mu_away_marked,
        mu_home_against=mu_home_conceded,
        mu_away_against=mu_away_conceded,
    )

    alpha, alpha_status = league_alpha_series(merged)
    logging.info("Alpha Poisson-Gamma: mean=%.4f statuses=%s", float(alpha.mean()), alpha_status.value_counts().to_dict())

    # 6) Simular cantos
    sim_home_ft, sim_away_ft = simulate_poisson_gamma_bivariate(
        lambda_home.values,
        lambda_away.values,
        alpha=alpha.values,
        n_sims=n_sims,
        seed=SIM_SEED,
    )
    total_ft = sim_home_ft + sim_away_ft

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

        "Expectativa de Cantos": blend_optional(merged, "Expectativa de Cantos").round(2),
        "Média Cantos Liga": blend_optional(merged, "Média Cantos Liga").round(2),

        "Classificação Casa": merged["Classificação Casa_10"],
        "Classificação Visitante": merged["Classificação Visitante_10"],

        "w10": merged["_w10"].round(3),
        "w20": merged["_w20"].round(3),
        "CV Game": merged["_cv_game"].round(2),
        "Delta Form 10v20": merged["_delta_form_10v20"].round(3),

        "Share Home": merged["_share_home"].round(3),
        "Gamma Home": merged["_gamma_home"].round(3),
        "Gamma Away": merged["_gamma_away"].round(3),
        "League Baseline Status": merged["_league_baseline_status"],
        "Alpha Liga": alpha.round(4),
        "Alpha Status": alpha_status,

        "CV Cantos Casa": blend(merged, "CV Média Cantos Casa").round(2),
        "CV Cantos Visitante": blend(merged, "CV Média Cantos Visitante").round(2),
        "CV Cantos Marcados Casa": blend(merged, "CV Média Cantos Marcados Casa").round(2),
        "CV Cantos Marcados Visitante": blend(merged, "CV Média Cantos Marcados Visitante").round(2),

        "CV Index Casa": (blend(merged, "CV Média Cantos Casa") * 0.30 + blend(merged, "CV Média Cantos Marcados Casa") * 0.70).round(2),
        "CV Index Visitante": (blend(merged, "CV Média Cantos Visitante") * 0.30 + blend(merged, "CV Média Cantos Marcados Visitante") * 0.70).round(2),
        "CV Index Total Casa": merged["_cv_total_home_20"].round(2),
        "CV Index Total Visitante": merged["_cv_total_away_20"].round(2),
        "CV Index Direcional Casa": merged["_cv_direction_home_20"].round(2),
        "CV Index Direcional Visitante": merged["_cv_direction_away_20"].round(2),

        "Média Marcados Casa": mu_home_marked.round(2),
        "Média Sofridos Casa": mu_home_conceded.round(2),
        "Média Marcados Visitante": mu_away_marked.round(2),
        "Média Sofridos Visitante": mu_away_conceded.round(2),

        "Lambda Casa": lambda_home.round(3),
        "Lambda Visitante": lambda_away.round(3),
        "Lambda Total": (lambda_home + lambda_away).round(3),
    })

    base["MatchID"] = (
        base["Pais"].astype(str) + "|" +
        base["Sigla"].astype(str) + "|" +
        base["Liga"].astype(str) + "|" +
        base["Data/Hora"].dt.strftime("%Y%m%d%H%M") + "|" +
        base["Time Casa"].astype(str) + "|" +
        base["Time Visitante"].astype(str)
    )

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
    # 8) Over/Under Cantos — usa colunas próprias de Under
    # ------------------------------------------------------------
    for t in ths_ft:
        thr_over = math.ceil(t)

        hist_over_home = blend(merged, f"Over {t} Cantos Casa")
        hist_over_away = blend(merged, f"Over {t} Cantos Visitante")
        hist_under_home = blend(merged, f"Under {t} Cantos Casa")
        hist_under_away = blend(merged, f"Under {t} Cantos Visitante")

        hist_o_raw = (hist_over_home + hist_over_away) / 2.0
        hist_u_raw = (hist_under_home + hist_under_away) / 2.0

        # Normaliza Over/Under para fechar 100 quando ambos existem.
        hist_total = hist_o_raw + hist_u_raw
        hist_ok = np.isfinite(hist_total) & (hist_total > 0)
        hist_o = hist_o_raw.copy()
        hist_u = hist_u_raw.copy()
        hist_o.loc[hist_ok] = hist_o_raw.loc[hist_ok] / hist_total.loc[hist_ok] * 100.0
        hist_u.loc[hist_ok] = hist_u_raw.loc[hist_ok] / hist_total.loc[hist_ok] * 100.0

        hist_u = hist_u.where(np.isfinite(hist_u), 100.0 - hist_o)
        hist_o = hist_o.where(np.isfinite(hist_o), 100.0 - hist_u)

        sim_o = pd.Series((total_ft >= thr_over).mean(axis=1) * 100.0, index=base.index)
        sim_u = 100.0 - sim_o

        odd_o_src = f"Odd Over {t} cantos"
        odd_u_src = f"Odd Under {t} cantos"
        odd_o = merged[f"{odd_o_src}_10"].astype(float)
        odd_u = merged[f"{odd_u_src}_10"].astype(float)

        imp_o, imp_u = vig_free_probs_from_odds_2way(odd_o.values, odd_u.values)
        imp_o = pd.Series(imp_o * 100.0, index=base.index)
        imp_u = pd.Series(imp_u * 100.0, index=base.index)

        finalized = finalize_two_way_probabilities(
            hist_o, hist_u, sim_o, sim_u, imp_o, imp_u,
            [w_hist, w_sim, w_imp], SHRINK_OU,
            f"ou_over_{str(t).replace('.', '_')}",
            market_key_b=f"ou_under_{str(t).replace('.', '_')}",
            fallback_market="ou",
        )
        prob_o = finalized["a"]
        prob_u = finalized["b"]

        prob_o_col = f"Over {t} Cantos prob"
        prob_u_col = f"Under {t} Cantos prob"
        odd_o_col = f"Odd Over {t} Cantos"
        odd_u_col = f"Odd Under {t} Cantos"

        base[prob_o_col] = prob_o
        base[odd_o_col] = odd_o
        base[prob_u_col] = prob_u
        base[odd_u_col] = odd_u
        base[f"OU {t} Hist Over"] = hist_o.round(2)
        base[f"OU {t} Sim Over"] = sim_o.round(2)
        base[f"OU {t} NoVig Over"] = imp_o.round(2)
        base[f"OU {t} Prob Raw Over"] = finalized["raw_a"]
        base[f"OU {t} Prob PreHaircut Over"] = finalized["pre_haircut_a"]
        base[f"OU {t} Haircut"] = finalized["haircut"]
        base[f"OU {t} Spread"] = finalized["spread"]
        base[f"OU {t} Conflict"] = np.where(finalized["conflict"], "CONFLITO_FORTE_COM_MERCADO", "ALINHADO")
        base[f"OU {t} Calibration Over"] = finalized["calibration"]["status"]
        base[f"OU {t} Calibration Under"] = finalized["calibration"]["status_b"]
        base[f"OU {t} Calibration Key Over"] = finalized["calibration"].get("calibration_key")
        base[f"OU {t} Calibration Key Under"] = finalized["calibration"].get("calibration_key_b")

        base = apply_value_filter(
            base, prob_o_col, odd_o_col,
            min_prob=MIN_PROB_OU, min_cv=MIN_CV_OU, min_edge=MIN_EDGE_OU,
            min_cv_individual=MIN_CV_OU_INDIVIDUAL,
        )
        base = add_ou_corner_cost_and_filter(base, prob_o_col, odd_o_col, t, "Over")

        base = apply_value_filter(
            base, prob_u_col, odd_u_col,
            min_prob=MIN_PROB_OU, min_cv=MIN_CV_OU, min_edge=MIN_EDGE_OU,
            min_cv_individual=MIN_CV_OU_INDIVIDUAL,
        )
        base = add_ou_corner_cost_and_filter(base, prob_u_col, odd_u_col, t, "Under")

    # ------------------------------------------------------------
    # 9) Mais Cantos — mercado 2-way tratado como empate anulado/push
    # ------------------------------------------------------------
    hist_c = blend(merged, "Casa Marcou Mais Cantos")
    hist_v = blend(merged, "Visitante Marcou Mais cantos")

    gt = sim_home_ft > sim_away_ft
    lt = sim_away_ft > sim_home_ft
    eq = sim_home_ft == sim_away_ft

    sim_c = pd.Series(gt.mean(axis=1) * 100.0, index=base.index)
    sim_v = pd.Series(lt.mean(axis=1) * 100.0, index=base.index)
    sim_t = pd.Series(eq.mean(axis=1) * 100.0, index=base.index)

    odd_c = merged["Odd Casa Mais Cantos_10"].astype(float)
    odd_v = merged["Odd Visitante Mais Cantos_10"].astype(float)

    imp_c_arr, imp_v_arr = vig_free_probs_from_odds_2way(odd_c.values, odd_v.values)
    imp_c = pd.Series(imp_c_arr * 100.0, index=base.index)
    imp_v = pd.Series(imp_v_arr * 100.0, index=base.index)

    hist_sum = hist_c + hist_v
    hist_c_cond = (hist_c / hist_sum * 100.0).where(np.isfinite(hist_sum) & (hist_sum > 0))
    hist_v_cond = (100.0 - hist_c_cond).where(hist_c_cond.notna())
    sim_sum = sim_c + sim_v
    sim_c_cond = (sim_c / sim_sum * 100.0).where(np.isfinite(sim_sum) & (sim_sum > 0))
    sim_v_cond = (100.0 - sim_c_cond).where(sim_c_cond.notna())
    finalized_mais = finalize_two_way_probabilities(
        hist_c_cond, hist_v_cond, sim_c_cond, sim_v_cond, imp_c, imp_v,
        [w_hist_dir, w_sim_dir, w_imp_dir], SHRINK_MAIS, "mais_cantos",
    )
    final_c = finalized_mais["a"]
    final_v = finalized_mais["b"]

    base["Casa Mais Cantos prob"] = final_c
    base["Odd Casa Mais Cantos"] = odd_c
    base["Visitante Mais Cantos prob"] = final_v
    base["Odd Visitante Mais Cantos"] = odd_v
    base["Empate Mais Cantos prob"] = sim_t.round(2)
    base["Mais Hist Casa"] = hist_c_cond.round(2)
    base["Mais Sim Casa"] = sim_c_cond.round(2)
    base["Mais NoVig Casa"] = imp_c.round(2)
    base["Mais Prob Raw Casa"] = finalized_mais["raw_a"]
    base["Mais Prob PreHaircut Casa"] = finalized_mais["pre_haircut_a"]
    base["Mais Haircut"] = finalized_mais["haircut"]
    base["Mais Spread"] = finalized_mais["spread"]
    base["Mais Conflict"] = np.where(finalized_mais["conflict"], "CONFLITO_FORTE_COM_MERCADO", "ALINHADO")
    base["Mais Calibration"] = finalized_mais["calibration"]["status"]

    base = add_directional_cost_indicators(base)

    directional_cv = ("CV Index Direcional Casa", "CV Index Direcional Visitante")
    base = apply_value_filter(base, "Casa Mais Cantos prob", "Odd Casa Mais Cantos", min_prob=MIN_PROB_MAIS, min_cv=MIN_CV_MAIS, min_edge=MIN_EDGE_MAIS, cv_fields=directional_cv)
    base = apply_value_filter(base, "Visitante Mais Cantos prob", "Odd Visitante Mais Cantos", min_prob=MIN_PROB_MAIS, min_cv=MIN_CV_MAIS, min_edge=MIN_EDGE_MAIS, cv_fields=directional_cv)

    # ------------------------------------------------------------
    # 10) Race 3 e 5 Cantos
    # ------------------------------------------------------------
    for k in race_targets:
        hist_home = blend(merged, f"Casa Race {k} Cantos")
        hist_away = blend(merged, f"Visitante Race {k} Cantos")

        p_home_cf = race_prob_home_closed_form(lambda_home.values, lambda_away.values, k=k) * 100.0
        sim_home = pd.Series(p_home_cf, index=base.index)
        sim_away = pd.Series(100.0 - p_home_cf, index=base.index)

        odd_home = merged[f"Odd Casa Race {k} Cantos_10"].astype(float)
        odd_away = merged[f"Odd Visitante Race {k} Cantos_10"].astype(float)

        imp_home, imp_away = vig_free_probs_from_odds_2way(odd_home.values, odd_away.values)
        imp_home = pd.Series(imp_home * 100.0, index=base.index)
        imp_away = pd.Series(imp_away * 100.0, index=base.index)

        finalized_race = finalize_two_way_probabilities(
            hist_home, hist_away, sim_home, sim_away, imp_home, imp_away,
            [w_hist_dir, w_sim_dir, w_imp_dir], SHRINK_RACE, f"race_{k}",
        )
        prob_home = finalized_race["a"]
        prob_away = finalized_race["b"]

        base[f"Casa Race {k} Cantos prob"] = prob_home
        base[f"Odd Casa Race {k} Cantos"] = odd_home
        base[f"Visitante Race {k} Cantos prob"] = prob_away
        base[f"Odd Visitante Race {k} Cantos"] = odd_away
        base[f"Race {k} Hist Casa"] = hist_home.round(2)
        base[f"Race {k} Sim Casa"] = sim_home.round(2)
        base[f"Race {k} NoVig Casa"] = imp_home.round(2)
        base[f"Race {k} Prob Raw Casa"] = finalized_race["raw_a"]
        base[f"Race {k} Prob PreHaircut Casa"] = finalized_race["pre_haircut_a"]
        base[f"Race {k} Haircut"] = finalized_race["haircut"]
        base[f"Race {k} Spread"] = finalized_race["spread"]
        base[f"Race {k} Conflict"] = np.where(finalized_race["conflict"], "CONFLITO_FORTE_COM_MERCADO", "ALINHADO")
        base[f"Race {k} Calibration"] = finalized_race["calibration"]["status"]

        base = add_race_cost_indicators(base, k=k)

        base = apply_value_filter(base, f"Casa Race {k} Cantos prob", f"Odd Casa Race {k} Cantos", min_prob=MIN_PROB_RACE, min_cv=MIN_CV_RACE, min_edge=MIN_EDGE_RACE, cv_fields=directional_cv)
        base = apply_value_filter(base, f"Visitante Race {k} Cantos prob", f"Odd Visitante Race {k} Cantos", min_prob=MIN_PROB_RACE, min_cv=MIN_CV_RACE, min_edge=MIN_EDGE_RACE, cv_fields=directional_cv)

    # ------------------------------------------------------------
    # 11) Filtros finais de qualidade
    # ------------------------------------------------------------

    market_prob_cols = [c for c in base.columns if c.endswith(" prob") and c != "Empate Mais Cantos prob"]
    mask_any_market = base[market_prob_cols].notna().any(axis=1)
    base = base.loc[mask_any_market].reset_index(drop=True)

    # 12) Exportar apenas Lovable em formato longo
    lovable = build_lovable_export(base)
    output_name = f"asp_cornermatrix_lovable_{date_str.replace('-', '_')}.csv"
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


def print_cantos_prognostics(base: pd.DataFrame, status_filter=None):
    if status_filter is None:
        status_filter = STATUSES

    base_print = base.loc[base["Status"].isin(status_filter)].copy()
    base_print = base_print.sort_values(
        ["Data/Hora", "Liga", "Time Casa", "Time Visitante"],
        ascending=True,
    ).reset_index(drop=True)

    print("Utilize o INPUT ULTRA RÁPIDO — CONFIRMAÇÃO (GOLS & CANTOS) v2 para confirmação do prognóstico\n")
    print("=== PROGNÓSTICOS PARA CANTOS ===\n")
    print(
        f"Filtros por mercado: OU prob >= {MIN_PROB_OU}% / CV individual >= {MIN_CV_OU_INDIVIDUAL}% "
        f"e CV médio >= {MIN_CV_OU}% | "
        f"Mais Cantos prob >= {MIN_PROB_MAIS}% / CV >= {MIN_CV_MAIS}% | "
        f"Race prob >= {MIN_PROB_RACE}% / CV >= {MIN_CV_RACE}%\n"
        f"Odd entre {MIN_ODD:.2f} e {MAX_ODD:.2f} | buffer valor {VALUE_BUFFER:.2f} | "
        f"margem OU >= {MIN_MARGEM_CANTO_OU:.2f} | custo canto OU <= {MAX_CUSTO_CANTO_OU:.0f}\n"
    )

    for _, row in base_print.iterrows():
        market_ou = []
        market_mais = []
        market_race = []

        for t in ths_ft:
            parts = []

            prob_u = row.get(f"Under {t} Cantos prob", pd.NA)
            odd_u = row.get(f"Odd Under {t} Cantos", pd.NA)
            if _is_printable_value_pick(prob_u, odd_u, min_prob=MIN_PROB_OU):
                ov = round(100 / float(prob_u), 2)
                edge = ((float(odd_u) * float(prob_u) / 100.0) - 1.0) * 100.0
                margem = row.get(f"Under {t} Margem Canto", pd.NA)
                custo = row.get(f"Under {t} Custo Canto", pd.NA)
                parts.append(
                    f"Under {float(prob_u):.2f}% | Valor: {ov:.2f} | Ofertada: {float(odd_u):.2f} | "
                    f"Edge: {edge:.2f}% | Margem: {_fmt_float(margem, 2, signed=True)} | Custo Canto: {_fmt_float(custo, 2)}"
                )

            prob_o = row.get(f"Over {t} Cantos prob", pd.NA)
            odd_o = row.get(f"Odd Over {t} Cantos", pd.NA)
            if _is_printable_value_pick(prob_o, odd_o, min_prob=MIN_PROB_OU):
                ov = round(100 / float(prob_o), 2)
                edge = ((float(odd_o) * float(prob_o) / 100.0) - 1.0) * 100.0
                margem = row.get(f"Over {t} Margem Canto", pd.NA)
                custo = row.get(f"Over {t} Custo Canto", pd.NA)
                parts.append(
                    f"Over {float(prob_o):.2f}% | Valor: {ov:.2f} | Ofertada: {float(odd_o):.2f} | "
                    f"Edge: {edge:.2f}% | Margem: {_fmt_float(margem, 2, signed=True)} | Custo Canto: {_fmt_float(custo, 2)}"
                )

            if parts:
                market_ou.append((f"Linha {t}", parts))

        p_c = row.get("Casa Mais Cantos prob", pd.NA)
        o_c = row.get("Odd Casa Mais Cantos", pd.NA)
        if _is_printable_value_pick(p_c, o_c, min_prob=MIN_PROB_MAIS):
            ov = round(100 / float(p_c), 2)
            edge = ((float(o_c) * float(p_c) / 100.0) - 1.0) * 100.0
            market_mais.append(
                f"Casa {float(p_c):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_c):.2f} | Edge: {edge:.2f}% | "
                f"Força Casa Mais: {_fmt_float(row.get('Casa Mais Cantos Força %'), 2)}% | "
                f"Custo: {_fmt_float(row.get('Casa Mais Cantos Custo'), 2)} | "
                f"Empate Sim: {_fmt_float(row.get('Empate Mais Cantos prob'), 2)}%"
            )

        p_v = row.get("Visitante Mais Cantos prob", pd.NA)
        o_v = row.get("Odd Visitante Mais Cantos", pd.NA)
        if _is_printable_value_pick(p_v, o_v, min_prob=MIN_PROB_MAIS):
            ov = round(100 / float(p_v), 2)
            edge = ((float(o_v) * float(p_v) / 100.0) - 1.0) * 100.0
            market_mais.append(
                f"Visitante {float(p_v):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_v):.2f} | Edge: {edge:.2f}% | "
                f"Força Visitante Mais: {_fmt_float(row.get('Visitante Mais Cantos Força %'), 2)}% | "
                f"Custo: {_fmt_float(row.get('Visitante Mais Cantos Custo'), 2)} | "
                f"Empate Sim: {_fmt_float(row.get('Empate Mais Cantos prob'), 2)}%"
            )

        for k in race_targets:
            p_h = row.get(f"Casa Race {k} Cantos prob", pd.NA)
            o_h = row.get(f"Odd Casa Race {k} Cantos", pd.NA)
            if _is_printable_value_pick(p_h, o_h, min_prob=MIN_PROB_RACE):
                ov = round(100 / float(p_h), 2)
                edge = ((float(o_h) * float(p_h) / 100.0) - 1.0) * 100.0
                market_race.append(
                    f"Casa Race {k} {float(p_h):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_h):.2f} | "
                    f"Edge: {edge:.2f}% | Custo Race: {_fmt_float(row.get(f'Casa Race {k} Cantos Custo'), 2)}"
                )

            p_a = row.get(f"Visitante Race {k} Cantos prob", pd.NA)
            o_a = row.get(f"Odd Visitante Race {k} Cantos", pd.NA)
            if _is_printable_value_pick(p_a, o_a, min_prob=MIN_PROB_RACE):
                ov = round(100 / float(p_a), 2)
                edge = ((float(o_a) * float(p_a) / 100.0) - 1.0) * 100.0
                market_race.append(
                    f"Visitante Race {k} {float(p_a):.2f}% | Valor: {ov:.2f} | Ofertada: {float(o_a):.2f} | "
                    f"Edge: {edge:.2f}% | Custo Race: {_fmt_float(row.get(f'Visitante Race {k} Cantos Custo'), 2)}"
                )

        if not market_ou and not market_mais and not market_race:
            continue

        home = row["Time Casa"]
        away = row["Time Visitante"]
        pais = row["Pais"]
        liga = row["Liga"]
        dth = row["Data/Hora"]
        date_txt = dth.strftime("%d-%m-%Y / %H:%M") if pd.notna(dth) else "Data/Hora inválida"

        print("Utilize o INPUT ULTRA RÁPIDO — CONFIRMAÇÃO (GOLS & CANTOS) v2 para confirmação do prognóstico\n")
        print(f"Confronto: {home} ({_fmt_int(row.get('Classificação Casa'))}°) vs {away} ({_fmt_int(row.get('Classificação Visitante'))}°)")
        print(f"{pais} - {liga}")
        print(f"Data/Hora: {date_txt}")
        print(f"Status: {row['Status']}\n")

        lam_h = row.get("Lambda Casa", pd.NA)
        lam_a = row.get("Lambda Visitante", pd.NA)
        lam_t = row.get("Lambda Total", pd.NA)

        print("--- DADOS TÉCNICOS ---")
        print(f"w10/w20:                       {_fmt_float(row.get('w10'), 3)} / {_fmt_float(row.get('w20'), 3)}")
        print(f"Delta Form 5v20:               {_fmt_float(row.get('Delta Form 5v20'), 3)}")
        print(f"Share Home (liga):             {_fmt_float(row.get('Share Home'), 3)}")
        print(f"Gamma Home/Away:               {_fmt_float(row.get('Gamma Home'), 3)} / {_fmt_float(row.get('Gamma Away'), 3)}\n")

        print(f"Média Marcados Casa:           {_fmt_float(row.get('Média Marcados Casa'), 2)}")
        print(f"Média Sofridos Casa:           {_fmt_float(row.get('Média Sofridos Casa'), 2)}")
        print(f"Média Marcados Visitante:      {_fmt_float(row.get('Média Marcados Visitante'), 2)}")
        print(f"Média Sofridos Visitante:      {_fmt_float(row.get('Média Sofridos Visitante'), 2)}\n")

        print(f"Força esperada cantos C/V/T:   {_fmt_float(lam_h, 3)} / {_fmt_float(lam_a, 3)} / {_fmt_float(lam_t, 3)}")
        print(f"Exp. de Cantos (modelo):       {_fmt_float(lam_t, 2)}")
        print(f"Exp. de Cantos (Packball):     {_fmt_float(row.get('Expectativa de Cantos'), 2)}")
        print(f"Média Cantos Liga:             {_fmt_float(row.get('Média Cantos Liga'), 2)}\n")

        print(f"Odd Casa MO:                   {_fmt_float(row.get('Odd Casa MO'), 2)}")
        print(f"Odd Visitante MO:              {_fmt_float(row.get('Odd Visitante MO'), 2)}\n")

        print(f"CV Cantos Marcados Casa:       {_fmt_float(row.get('CV Cantos Marcados Casa'), 2)}%")
        print(f"CV Cantos Marcados Visitante:  {_fmt_float(row.get('CV Cantos Marcados Visitante'), 2)}%")

        if market_ou:
            print("--- OVER/UNDER CANTOS ---")
            for label, parts in market_ou:
                print(f"  • {label}: " + " || ".join(parts))
            print()

        if market_mais:
            print("--- MAIS CANTOS ---")
            for p in market_mais:
                print(f"  • {p}")
            print()

        if market_race:
            print("--- RACE CANTOS ---")
            for p in market_race:
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
        row["stake"] = 0.0
        row["dados_tecnicos"] = row.get("dados_tecnicos") or obs or None
        row["contexto_adicional"] = row.get("contexto_adicional") or row.get("dados_tecnicos") or obs or None
        row["contexto_modelo"] = row.get("contexto_modelo") or row.get("dados_tecnicos") or obs or None
        row["parecer_validacao"] = "AGUARDAR_ODD_EXECUTAVEL"
        records.append(_clean_json(row))
    return records


def build_walk_forward_snapshot_rows(records: list[dict]) -> list[dict]:
    prediction_at = str(RUN_PROVENANCE.get("generated_at") or datetime.now(timezone.utc).isoformat())
    local_timezone = ZoneInfo("America/Sao_Paulo")
    output = []
    for record in records:
        kickoff_local = pd.to_datetime(f"{record.get('data', '')} {record.get('hora', '')}", dayfirst=True, errors="coerce")
        kickoff = None
        if pd.notna(kickoff_local):
            kickoff = kickoff_local.to_pydatetime().replace(tzinfo=local_timezone).astimezone(timezone.utc).isoformat()
        game_key = "|".join(str(record.get(key) or "") for key in ("data", "hora", "liga", "jogo"))
        output.append({
            "prediction_at": prediction_at, "kickoff": kickoff,
            "game_id": hashlib.sha256(game_key.encode("utf-8")).hexdigest()[:24],
            "league": record.get("liga"), "market_type": str(record.get("market_type") or "").lower(),
            "pick": record.get("pick"), "line": record.get("linha"),
            "probability": float(record.get("probabilidade_final")) / 100.0,
            "odd": record.get("odd_ofertada"), "outcome": None,
            "home_corners": None, "away_corners": None,
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
            "erro": "Uso: python runner.py CSV_10 CSV_20 OUTPUT_CSV [DD-MM-YYYY] [prognostico|backtest]",
        }
        print(json.dumps(payload, ensure_ascii=False))
        return

    csv10 = Path(sys.argv[1]).resolve()
    csv20 = Path(sys.argv[2]).resolve()
    output_path = Path(sys.argv[3]).resolve()
    cli_date = sys.argv[4].strip() if len(sys.argv) >= 5 and sys.argv[4].strip() else _infer_date_str([csv10, csv20])
    cli_run_mode = sys.argv[5].strip().lower() if len(sys.argv) >= 6 else "prognostico"
    if cli_run_mode not in {"prognostico", "backtest"}:
        print(json.dumps({"ok": False, "erro": f"RUN_MODE inválido: {cli_run_mode}"}, ensure_ascii=False))
        return
    globals()["RUN_MODE"] = cli_run_mode
    globals()["STATUSES"] = STATUSES_BY_MODE[cli_run_mode]

    if not csv10.exists():
        print(json.dumps({"ok": False, "erro": f"Arquivo 10j não encontrado: {csv10}"}, ensure_ascii=False))
        return
    if not csv20.exists():
        print(json.dumps({"ok": False, "erro": f"Arquivo 20j n?o encontrado: {csv20}"}, ensure_ascii=False))
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)

    source_preview = pd.read_csv(csv10, sep=sniff_sep(csv10), encoding="utf-8", engine="python", nrows=1)
    globals()["RUN_PROVENANCE"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "source": "PackBall external CSV import",
        "market_odds_profile": "average odds from 1 to 5 bookmakers; bookmaker count unavailable per match",
        "source_file_10": csv10.name, "source_file_20": csv20.name,
        "sha256_10": file_sha256(csv10), "sha256_20": file_sha256(csv20),
        "schema_hash": schema_sha256(source_preview.columns), "model_version": MODEL_VERSION,
        "prediction_date": cli_date, "run_mode": cli_run_mode, "kickoff_timezone": "America/Sao_Paulo",
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
            **RUN_PROVENANCE, "input_path_10": str(csv10), "input_path_20": str(csv20),
            "output_path": str(output_path), "calibration_path": str(CALIBRATION_PATH),
            "predictions": records, "walk_forward_rows": build_walk_forward_snapshot_rows(records),
        }
        snapshot_path = output_path.with_suffix(".snapshot.json")
        snapshot_path.write_text(json.dumps(_clean_json(snapshot), ensure_ascii=False, indent=2), encoding="utf-8")
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
