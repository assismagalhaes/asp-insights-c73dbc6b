from __future__ import annotations

import pandas as pd


def consolidar_csv_odds(df: pd.DataFrame) -> pd.DataFrame:
    """Keep one executable row per event/market/selection instead of one per bookmaker."""
    group_columns = [
        "data", "hora", "esporte", "liga", "country", "jogo", "mandante",
        "visitante", "mercado", "pick", "linha", "fonte",
    ]
    available_group_columns = [column for column in group_columns if column in df.columns]
    if not available_group_columns or df.empty:
        return df

    executable = pd.to_numeric(df.get("odd_melhor"), errors="coerce")
    offered = pd.to_numeric(df.get("odd"), errors="coerce")
    ranked = df.assign(_odd_executavel=executable.fillna(offered)).sort_values(
        "_odd_executavel", ascending=False, na_position="last"
    )
    consolidated = ranked.drop_duplicates(available_group_columns, keep="first").copy()
    consolidated["odd"] = consolidated["_odd_executavel"].fillna(
        pd.to_numeric(consolidated.get("odd"), errors="coerce")
    )
    if "bookmaker_melhor" in consolidated.columns:
        best = consolidated["bookmaker_melhor"].fillna("").astype(str).str.strip()
        consolidated["bookmaker"] = best.where(best.ne(""), consolidated.get("bookmaker"))

    odds_columns = [
        "odd", "odd_media", "odd_mediana", "odd_minima", "odd_maxima", "odd_melhor",
        "odd_desvio_padrao",
    ]
    probability_columns = [
        "probabilidade_implicita_media", "probabilidade_implicita_mediana",
        "margem_mercado_media", "margem_mercado_mediana",
    ]
    for column in odds_columns:
        if column in consolidated.columns:
            consolidated[column] = pd.to_numeric(consolidated[column], errors="coerce").round(4)
    for column in probability_columns:
        if column in consolidated.columns:
            consolidated[column] = pd.to_numeric(consolidated[column], errors="coerce").round(6)
    return consolidated.drop(columns=["_odd_executavel"], errors="ignore").reset_index(drop=True)
