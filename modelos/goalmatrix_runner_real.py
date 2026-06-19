# %% cell 0
import pandas as pd
import numpy as np
import logging
import math
import csv
from pathlib import Path

PACKBALL_FILE_5 = "PackBall Custom over_gols_ft_5 {date}.csv"
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
MODEL_VERSION = "v1.0"

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
      - PackBall Custom over_gols_ft_5  {date_str}.csv
      - PackBall Custom over_gols_ft_20 {date_str}.csv
    """
    files = {
        "5":  base_dir / f"PackBall Custom over_gols_ft_5 {date_str}.csv",
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
    return dfs["5"], dfs["20"]


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


def filter_by_status_and_games(df: pd.DataFrame, statuses=("NS",), n_games: int = 5) -> pd.DataFrame:
    """
    - Trata Status: FT_PEN -> FT
    - Mantém apenas os status definidos pelo RUN_MODE
    - Mantém apenas jogos coletados exatamente n_games/n_games
    """
    df = df.copy()

    st = df["Status"].astype(str).str.strip().str.upper()
    st = st.replace({"FT_PEN": "FT"})
    df["Status"] = st

    df = df[df["Status"].isin(list(statuses))].copy()

    df["Número Jogos Coletados Casa"] = pd.to_numeric(df["Número Jogos Coletados Casa"], errors="coerce")
    df["Número Jogos Coletados Visitante"] = pd.to_numeric(df["Número Jogos Coletados Visitante"], errors="coerce")

    df = df[
        (df["Número Jogos Coletados Casa"] == n_games) &
        (df["Número Jogos Coletados Visitante"] == n_games)
    ].copy()
    return df


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


def audit_merge_keys(df5u: pd.DataFrame, df20u: pd.DataFrame) -> None:
    """Mantém o inner merge, mas avisa se houver divergência entre os arquivos."""
    only_5 = df5u[MERGE_KEYS].merge(df20u[MERGE_KEYS], on=MERGE_KEYS, how="left", indicator=True)
    only_5 = only_5[only_5["_merge"] == "left_only"]

    only_20 = df20u[MERGE_KEYS].merge(df5u[MERGE_KEYS], on=MERGE_KEYS, how="left", indicator=True)
    only_20 = only_20[only_20["_merge"] == "left_only"]

    if len(only_5):
        logging.warning(f"Jogos presentes apenas no arquivo 5j: {len(only_5)}")
    if len(only_20):
        logging.warning(f"Jogos presentes apenas no arquivo 20j: {len(only_20)}")


def merge_5_20(df5: pd.DataFrame, df20: pd.DataFrame) -> pd.DataFrame:
    df5u = dedupe_by_keys_keep_most_complete(df5, MERGE_KEYS)
    df20u = dedupe_by_keys_keep_most_complete(df20, MERGE_KEYS)

    audit_merge_keys(df5u, df20u)

    merged = df5u.merge(
        df20u,
        on=MERGE_KEYS,
        how="inner",
        suffixes=("_5", "_20"),
        validate="one_to_one",
    )
    return merged.reset_index(drop=True)

# ------------------------------------------------------------
# PESOS DINÂMICOS 5/20 via CV + divergência recente
# ------------------------------------------------------------
def build_dynamic_weights(merged: pd.DataFrame) -> pd.DataFrame:
    """
    No PackBall usado aqui: CV maior = maior consistência.

    Lógica adotada:
      - 20j é a âncora estrutural.
      - 5j é ajuste de forma recente.
      - CV alto aumenta o peso do 20j.
      - Divergência forte entre 5j e 20j reduz levemente o peso do 20j,
        permitindo que mudança recente de padrão tenha influência controlada.
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

    # Peso base do 20j:
    #   CV 50 -> 50%
    #   CV 70 -> 58%
    #   CV 90 -> 66%
    #   limite final: 45% a 68%
    w20_base = 0.30 + 0.0040 * merged["_cv_game"]

    # Divergência média entre os dados recentes (5j) e estruturais (20j).
    # Quanto maior a diferença, maior a chance de mudança recente de padrão.
    delta_form = (
        (merged["Média Gols Marcados Casa_5"] - merged["Média Gols Marcados Casa_20"]).abs() +
        (merged["Média Gols Sofridos Casa_5"] - merged["Média Gols Sofridos Casa_20"]).abs() +
        (merged["Média Gols Marcados Visitante_5"] - merged["Média Gols Marcados Visitante_20"]).abs() +
        (merged["Média Gols Sofridos Visitante_5"] - merged["Média Gols Sofridos Visitante_20"]).abs()
    ) / 4.0

    merged["_delta_form_5v20"] = delta_form.round(3)

    # Só reduz o peso do 20j quando a diferença média passa de 0.30 gol.
    # Penalidade máxima: 8 pontos percentuais.
    recency_boost = ((delta_form - 0.30) / 1.20).clip(lower=0.0, upper=0.08)

    merged["_w20"] = (w20_base - recency_boost).clip(lower=0.45, upper=0.68)
    merged["_w5"] = 1.0 - merged["_w20"]
    return merged


def blend(merged: pd.DataFrame, col_base: str) -> pd.Series:
    """
    Mistura 5j e 20j com pesos dinâmicos.
    Se uma das bases estiver ausente, renormaliza o peso para usar a base disponível.
    """
    c5 = f"{col_base}_5"
    c20 = f"{col_base}_20"

    if c5 not in merged.columns or c20 not in merged.columns:
        raise KeyError(f"Colunas esperadas não encontradas para blend: {c5} / {c20}")

    if ("_w5" not in merged.columns) or ("_w20" not in merged.columns):
        w5 = pd.Series(0.50, index=merged.index, dtype=float)
        w20 = pd.Series(0.50, index=merged.index, dtype=float)
    else:
        w5 = merged["_w5"].astype(float)
        w20 = merged["_w20"].astype(float)

    x5 = merged[c5].astype(float)
    x20 = merged[c20].astype(float)

    valid5 = x5.notna()
    valid20 = x20.notna()

    den = valid5.astype(float) * w5 + valid20.astype(float) * w20
    num = (
        x5.fillna(0.0) * w5 * valid5.astype(float) +
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


def _is_value_pick(
    prob,
    odd,
    min_prob: float = MIN_PROB,
    min_odd: float = MIN_ODD,
    max_odd: float = MAX_ODD,
    buffer: float = VALUE_BUFFER,
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
    return odd >= odd_valor * float(buffer)


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


def _market_thresholds(mercado: str, pick: str = "") -> tuple[float, float]:
    """Retorna (probabilidade mínima, CV mínimo) por mercado/pick."""
    mercado = str(mercado).strip().lower()
    pick = str(pick).strip().lower()

    if mercado == "over/under gols":
        return MIN_PROB_OU, MIN_CV_OU
    if mercado == "btts":
        return MIN_PROB_BTTS, MIN_CV_BTTS
    if mercado == "primeiro a marcar":
        if pick == "sem gol":
            return MIN_PROB_SEM_GOL, MIN_CV_SEM_GOL
        return MIN_PROB_FIRST, MIN_CV_FIRST
    return MIN_PROB, MIN_CV_MARKED


def apply_value_filter(
    base: pd.DataFrame,
    prob_col: str,
    odd_col: str,
    min_prob: float = MIN_PROB,
    min_cv: float | None = None,
) -> pd.DataFrame:
    """Aplica filtro de valor, faixa de odd, probabilidade mínima e CV mínimo do mercado."""
    base = base.copy()

    def _row_ok(r: pd.Series) -> bool:
        value_ok = _is_value_pick(r.get(prob_col), r.get(odd_col), min_prob=min_prob)
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
                                     alpha: float,
                                     n_sims: int,
                                     seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    lam_home = np.asarray(lam_home, dtype=float)
    lam_away = np.asarray(lam_away, dtype=float)

    lam_home = np.clip(lam_home, 0.0, None)
    lam_away = np.clip(lam_away, 0.0, None)

    rng = np.random.default_rng(seed)
    n_games = lam_home.shape[0]

    if not np.isfinite(alpha) or alpha <= 0:
        home = rng.poisson(lam_home[:, None], size=(n_games, n_sims))
        away = rng.poisson(lam_away[:, None], size=(n_games, n_sims))
        return home, away

    k = 1.0 / alpha
    g = rng.gamma(shape=k, scale=1.0 / k, size=(n_games, n_sims))  # mean=1
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


def build_lambdas_force_model(
    merged: pd.DataFrame,
    mu_home_for: pd.Series,
    mu_away_for: pd.Series,
    mu_home_against: pd.Series,
    mu_away_against: pd.Series,
) -> tuple[pd.Series, pd.Series, pd.DataFrame]:
    eps = 1e-6
    merged2 = merged.copy()

    merged2["_share_home"] = estimate_share_home_from_averages(merged2, mu_home_for, mu_away_for)

    L_total = merged2["Média Gols Liga_5"].astype(float)
    fallback = merged2["Expectativa de Gols_5"].astype(float)
    L_total = L_total.where(np.isfinite(L_total) & (L_total > 0), fallback)
    L_total = L_total.where(np.isfinite(L_total) & (L_total > 0), np.nan)
    L_total = L_total.fillna(L_TOTAL_DEFAULT).clip(lower=L_TOTAL_CLIP[0], upper=L_TOTAL_CLIP[1])

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

def _add_lovable_row(rows: list[dict], row: pd.Series, mercado: str, pick: str, linha, prob, odd) -> None:
    min_prob, min_cv = _market_thresholds(mercado, pick)
    if not _is_value_pick(prob, odd, min_prob=min_prob):
        return
    if not _passes_cv_filter(row, min_cv=min_cv):
        return

    prob = float(prob)
    odd = float(odd)
    odd_valor = 100.0 / prob
    edge = ((odd * prob / 100.0) - 1.0) * 100.0

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
        "observacoes": _fmt_obs(row, mercado=mercado, pick=pick, linha=linha),
        "dados_tecnicos": _technical_context(row, mercado=mercado, pick=pick, linha=linha),
        "contexto_adicional": _technical_context(row, mercado=mercado, pick=pick, linha=linha),
        "contexto_modelo": _technical_context(row, mercado=mercado, pick=pick, linha=linha),
    })


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

        _add_lovable_row(rows, row, "Primeiro a Marcar", "Casa", "", row.get("Casa 1º a Marcar prob"), row.get("Odd Casa 1º a Marcar"))
        _add_lovable_row(rows, row, "Primeiro a Marcar", "Visitante", "", row.get("Visitante 1º a Marcar prob"), row.get("Odd Visitante 1º a Marcar"))
        _add_lovable_row(rows, row, "Primeiro a Marcar", "Sem Gol", "", row.get("Sem Gol prob"), row.get("Odd Sem Gol"))

    cols = [
        "data", "hora", "esporte", "liga", "jogo", "mandante", "visitante",
        "mercado", "pick", "linha", "odd_ofertada", "odd_valor",
        "probabilidade_final", "edge", "observacoes", "dados_tecnicos", "contexto_adicional", "contexto_modelo",
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

    # 1) Ler e normalizar (5 + 20)
    df5_raw, df20_raw = load_gols_data(date_str, base_dir)
    df5 = coerce_numeric(normalize_columns(df5_raw))
    df20 = coerce_numeric(normalize_columns(df20_raw))

    df5 = sanitize_pct_like_columns(df5, "df5")
    df20 = sanitize_pct_like_columns(df20, "df20")

    sanity_check_ranges(df5, "df5")
    sanity_check_ranges(df20, "df20")

    # 2) Filtrar conforme RUN_MODE
    df5_f = filter_by_status_and_games(df5, STATUSES, n_games=5)
    df20_f = filter_by_status_and_games(df20, STATUSES, n_games=20)
    logging.info(f"RUN_MODE={RUN_MODE} | STATUS={STATUSES}")
    logging.info(f"df5_filtrado: {df5_f.shape} | df20_filtrado: {df20_f.shape}")

    # 3) Merge
    merged = merge_5_20(df5_f, df20_f)
    logging.info(f"merged (5+20) shape: {merged.shape}")

    # Campos invariantes: mantém _5
    for _c in ("Expectativa de Gols", "Média Gols Liga"):
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

    alpha = ALPHA_DEFAULT
    logging.info(f"α fixo (Poisson-Gamma): {alpha:.4f}")

    # 6) Simular gols
    sim_home_ft, sim_away_ft = simulate_poisson_gamma_bivariate(
        lambda_home.values,
        lambda_away.values,
        alpha=alpha,
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

        "Odd Casa MO": merged["Odd Casa Vencer_5"],
        "Odd Visitante MO": merged["Odd Visitante Vencer_5"],

        "Expectativa de Gols": merged["Expectativa de Gols_5"].round(2),
        "Média Gols Liga": merged["Média Gols Liga_5"].round(2),

        "Colocação Time Casa": merged["Colocação Time Casa_5"],
        "Colocação Time Visitante": merged["Colocação Time Visitante_5"],

        "w5": merged["_w5"].round(3),
        "w20": merged["_w20"].round(3),
        "CV Game": merged["_cv_game"].round(2),

        "Share Home": merged["_share_home"].round(3),
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
        odd_o = merged[f"{odd_o_col}_5"]
        odd_u = merged[f"{odd_u_col}_5"]

        imp_o, imp_u = vig_free_probs_from_odds_2way(odd_o.values, odd_u.values)
        imp_o = pd.Series(imp_o * 100.0, index=base.index)
        imp_u = pd.Series(imp_u * 100.0, index=base.index)

        prob_o_raw = weighted_mix_pct([hist_o, sim_o, imp_o], [w_hist, w_sim, w_imp])
        prob_u_raw = weighted_mix_pct([hist_u, sim_u, imp_u], [w_hist, w_sim, w_imp])

        tot = prob_o_raw + prob_u_raw
        tot_ok = np.isfinite(tot) & (tot > 0)

        prob_o = pd.Series(np.nan, index=base.index)
        prob_u = pd.Series(np.nan, index=base.index)
        prob_o.loc[tot_ok] = (prob_o_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)
        prob_u.loc[tot_ok] = (prob_u_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)

        prob_o = calibrate(prob_o.round(2), shrink=SHRINK_OU)
        prob_u = (100.0 - prob_o).round(2)

        prob_o_col = f"Over {t} Gols prob"
        prob_u_col = f"Under {t} Gols prob"
        base[prob_o_col] = prob_o
        base[odd_o_col] = odd_o
        base[prob_u_col] = prob_u
        base[odd_u_col] = odd_u

        base = apply_value_filter(base, prob_o_col, odd_o_col, min_prob=MIN_PROB_OU, min_cv=MIN_CV_OU)
        base = add_ou_goal_cost_and_filter(base, prob_o_col, odd_o_col, t, "Over")

        base = apply_value_filter(base, prob_u_col, odd_u_col, min_prob=MIN_PROB_OU, min_cv=MIN_CV_OU)
        base = add_ou_goal_cost_and_filter(base, prob_u_col, odd_u_col, t, "Under")

    # ------------------------------------------------------------
    # 9) BTTS (Sim/Não) 2-way com vig-free
    # ------------------------------------------------------------
    hist_btts_sim = occ_btts_sim_avg
    hist_btts_nao = 100.0 - hist_btts_sim

    sim_btts_sim = pd.Series(((sim_home_ft > 0) & (sim_away_ft > 0)).mean(axis=1) * 100.0, index=base.index)
    sim_btts_nao = 100.0 - sim_btts_sim

    odd_sim = merged["Odd BTTS Sim_5"].astype(float)
    odd_nao = merged["Odd BTTS Não_5"].astype(float)

    imp_sim, imp_nao = vig_free_probs_from_odds_2way(odd_sim.values, odd_nao.values)
    imp_sim = pd.Series(imp_sim * 100.0, index=base.index)
    imp_nao = pd.Series(imp_nao * 100.0, index=base.index)

    prob_sim_raw = weighted_mix_pct([hist_btts_sim, sim_btts_sim, imp_sim], [w_hist, w_sim, w_imp])
    prob_nao_raw = weighted_mix_pct([hist_btts_nao, sim_btts_nao, imp_nao], [w_hist, w_sim, w_imp])

    tot = prob_sim_raw + prob_nao_raw
    tot_ok = np.isfinite(tot) & (tot > 0)

    prob_sim = pd.Series(np.nan, index=base.index)
    prob_nao = pd.Series(np.nan, index=base.index)
    prob_sim.loc[tot_ok] = (prob_sim_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)
    prob_nao.loc[tot_ok] = (prob_nao_raw.loc[tot_ok] / tot.loc[tot_ok] * 100.0)

    prob_sim = calibrate(prob_sim.round(2), shrink=SHRINK_BTTS)
    prob_nao = (100.0 - prob_sim).round(2)

    base["BTTS Sim prob"] = prob_sim
    base["Odd BTTS Sim"] = odd_sim
    base["BTTS Não prob"] = prob_nao
    base["Odd BTTS Não"] = odd_nao

    base = add_btts_cost_indicators(base)

    base = apply_value_filter(base, "BTTS Sim prob", "Odd BTTS Sim", min_prob=MIN_PROB_BTTS, min_cv=MIN_CV_BTTS)
    base = apply_value_filter(base, "BTTS Não prob", "Odd BTTS Não", min_prob=MIN_PROB_BTTS, min_cv=MIN_CV_BTTS)

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

    odd_h = merged["Odd Casa Marcar Primeiro_5"].astype(float)
    odd_a = merged["Odd Visitante Marcar Primeiro_5"].astype(float)
    odd_ng = merged["Odd Sem Gol_5"].astype(float)

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
        print(f"w5/w20:                        {_fmt_float(row.get('w5'), 3)} / {_fmt_float(row.get('w20'), 3)}")
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


def run_cli() -> None:
    import contextlib
    import json
    import shutil
    import sys
    import tempfile

    if len(sys.argv) < 4:
        payload = {
            "ok": False,
            "erro": "Uso: python runner.py CSV_5 CSV_20 OUTPUT_CSV [DD-MM-YYYY]",
        }
        print(json.dumps(payload, ensure_ascii=False))
        return

    csv5 = Path(sys.argv[1]).resolve()
    csv20 = Path(sys.argv[2]).resolve()
    output_path = Path(sys.argv[3]).resolve()
    cli_date = sys.argv[4].strip() if len(sys.argv) >= 5 and sys.argv[4].strip() else _infer_date_str([csv5, csv20])

    if not csv5.exists():
        print(json.dumps({"ok": False, "erro": f"Arquivo 5j n?o encontrado: {csv5}"}, ensure_ascii=False))
        return
    if not csv20.exists():
        print(json.dumps({"ok": False, "erro": f"Arquivo 20j n?o encontrado: {csv20}"}, ensure_ascii=False))
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="asp_packball_model_") as tmp_name:
        tmp_dir = Path(tmp_name)
        expected5 = tmp_dir / PACKBALL_FILE_5.format(date=cli_date)
        expected20 = tmp_dir / PACKBALL_FILE_20.format(date=cli_date)
        shutil.copy2(csv5, expected5)
        shutil.copy2(csv20, expected20)

        globals()["date_str"] = cli_date
        globals()["base_dir"] = tmp_dir
        globals()["output_dir"] = output_path.parent

        with contextlib.redirect_stdout(sys.stderr):
            base, lovable = main()

        lovable.to_csv(output_path, index=False, encoding="utf-8-sig")
        records = _to_records(lovable)
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
            "total_prognosticos": len(records),
            "contexto_modelo": "\n".join(line for line in context_lines if line),
            "dados_tecnicos": "\n\n".join(str(r.get("dados_tecnicos") or "") for r in records[:20] if r.get("dados_tecnicos")),
            "prognosticos": records,
        }
        print(json.dumps(_clean_json(payload), ensure_ascii=False))


if __name__ == "__main__":
    run_cli()
