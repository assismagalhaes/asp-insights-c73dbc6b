import pandas as pd
from pathlib import Path
import re


ADAPTER_WARNINGS = []

COUNTRY_CODE_TO_NAME = {
    "ARG": "Argentina",
    "AUT": "Austria",
    "BEL": "Belgium",
    "BRA": "Brazil",
    "CHN": "China",
    "DNK": "Denmark",
    "ENG": "England",
    "FIN": "Finland",
    "FRA": "France",
    "GER": "Germany",
    "GRE": "Greece",
    "IRL": "Ireland",
    "ITA": "Italy",
    "JPN": "Japan",
    "MEX": "Mexico",
    "NED": "Netherlands",
    "NOR": "Norway",
    "POL": "Poland",
    "POR": "Portugal",
    "ROU": "Romania",
    "SCO": "Scotland",
    "SPA": "Spain",
    "SWE": "Sweden",
    "SWZ": "Switzerland",
    "TUR": "Turkey",
    "USA": "USA",
}

COUNTRY_NAMES = {value.casefold(): value for value in COUNTRY_CODE_TO_NAME.values()}


def normalizar_country_league(country, liga):
    country_text = limpar_texto(country)
    liga_text = limpar_texto(liga)

    if " - " in liga_text:
        prefix, league_name = [part.strip() for part in liga_text.split(" - ", 1)]
        prefix_upper = prefix.upper()
        if prefix_upper in COUNTRY_CODE_TO_NAME:
            return COUNTRY_CODE_TO_NAME[prefix_upper], league_name
        country_from_prefix = COUNTRY_NAMES.get(prefix.casefold())
        if country_from_prefix:
            return country_from_prefix, league_name

    country_upper = country_text.upper()
    if country_upper in COUNTRY_CODE_TO_NAME:
        country_text = COUNTRY_CODE_TO_NAME[country_upper]
    elif country_text:
        country_text = country_text.replace("_", " ").title()

    return country_text, liga_text


def normalizar_float(valor):
    if pd.isna(valor):
        return None

    texto = str(valor).strip().replace(",", ".")

    if texto == "":
        return None

    try:
        return float(texto)
    except Exception:
        return None


def limpar_texto(valor):
    if pd.isna(valor):
        return ""
    return str(valor).strip()


def formatar_data_para_modelo(data):
    texto = limpar_texto(data)

    try:
        dayfirst = not bool(re.match(r"^\d{4}-\d{2}-\d{2}$", texto))
        dt = pd.to_datetime(texto, dayfirst=dayfirst, errors="coerce")
        if pd.isna(dt):
            return texto
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return texto


def linha_para_key_ou(linha):
    valor = normalizar_float(linha)
    if valor is None:
        return None

    texto = f"{valor:.1f}"
    return texto.replace(".", "_")


def identificar_pick_1x2(pick, mandante, visitante):
    p = limpar_texto(pick).lower()
    h = limpar_texto(mandante).lower()
    a = limpar_texto(visitante).lower()

    if p in ["empate", "draw", "x"]:
        return "X"

    if p == h or h in p:
        return "1"

    if p == a or a in p:
        return "2"

    return None


def identificar_lado_time(pick, mandante, visitante):
    p = limpar_texto(pick).lower()
    h = limpar_texto(mandante).lower()
    a = limpar_texto(visitante).lower()

    if p == h or h in p:
        return "home"

    if p == a or a in p:
        return "away"

    return None


def is_meia_linha(valor):
    linha = normalizar_float(valor)
    if linha is None:
        return False
    return abs(abs(linha) - int(abs(linha)) - 0.5) < 1e-9


def is_quarter_line(valor):
    linha = normalizar_float(valor)
    if linha is None:
        return False
    quarter = abs(linha * 4 - round(linha * 4)) < 1e-9
    half_or_integer = abs(linha * 2 - round(linha * 2)) < 1e-9
    return quarter and not half_or_integer


def is_asian_line(valor):
    linha = normalizar_float(valor)
    if linha is None:
        return False
    return -5.5 <= linha <= 5.5 and abs(linha * 4 - round(linha * 4)) < 1e-9


def odd_ofertada(item):
    return normalizar_float(item.get("odd_melhor")) or normalizar_float(item.get("odd"))


def odd_consenso(item):
    return normalizar_float(item.get("odd_mediana")) or normalizar_float(item.get("odd_media")) or normalizar_float(item.get("odd"))


def set_odd_columns(row, base_col: str, item) -> None:
    offered = odd_ofertada(item)
    consensus = odd_consenso(item) or offered
    if offered is None:
        return
    row[base_col] = offered
    if consensus is not None:
        row[f"{base_col}_MEDIANA"] = consensus
    bookmaker = limpar_texto(item.get("bookmaker_melhor")) or limpar_texto(item.get("bookmaker"))
    if bookmaker:
        row[f"{base_col}_BOOKMAKER_MELHOR"] = bookmaker


def adicionar_handicaps_asiaticos(row, handicap_items, jogo):
    handicap_index = 1
    used = set()

    for idx, home_item in enumerate(handicap_items):
        if idx in used or home_item["side"] != "home":
            continue

        match_idx = None
        for jdx, away_item in enumerate(handicap_items):
            if jdx in used or away_item["side"] != "away":
                continue

            if abs(float(away_item["line"]) - float(home_item["line"])) < 1e-9:
                match_idx = jdx
                break

        if match_idx is None:
            ADAPTER_WARNINGS.append(
                f"Handicap sem par Home/Away no adapter: {jogo} | linha={home_item['line']}"
            )
            continue

        away_item = handicap_items[match_idx]
        home_line = float(home_item["line"])
        away_line = -home_line

        row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_HANDICAP"] = home_line
        row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_1"] = home_item["odd"]
        row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_1_MEDIANA"] = home_item["odd_mediana"]
        if home_item.get("bookmaker_melhor"):
            row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_1_BOOKMAKER_MELHOR"] = home_item["bookmaker_melhor"]
        row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_Opp_HANDICAP"] = away_line
        row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_Opp_Odd"] = away_item["odd"]
        row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_Opp_Odd_MEDIANA"] = away_item["odd_mediana"]
        if away_item.get("bookmaker_melhor"):
            row[f"odds_Asian_handicap_Full_Time_Linha{handicap_index}_Opp_Odd_BOOKMAKER_MELHOR"] = away_item["bookmaker_melhor"]

        used.add(idx)
        used.add(match_idx)
        handicap_index += 1

    for idx, item in enumerate(handicap_items):
        if idx not in used:
            ADAPTER_WARNINGS.append(
                f"Handicap descartado sem par seguro no adapter: {jogo} | pick={item['pick']} | linha={item['line']}"
            )


def converter_csv_longo_para_wide(caminho_entrada, caminho_saida):
    ADAPTER_WARNINGS.clear()
    df = pd.read_csv(caminho_entrada)

    obrigatorias = [
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

    faltando = [c for c in obrigatorias if c not in df.columns]
    if faltando:
        raise ValueError(f"CSV da coleta sem colunas obrigatorias: {faltando}")

    df["odd"] = df["odd"].apply(normalizar_float)
    if "odd_melhor" in df.columns:
        df["odd_melhor"] = df["odd_melhor"].apply(normalizar_float)
    if "odd_mediana" in df.columns:
        df["odd_mediana"] = df["odd_mediana"].apply(normalizar_float)
    if "odd_media" in df.columns:
        df["odd_media"] = df["odd_media"].apply(normalizar_float)
    df = df.dropna(subset=["odd"]).copy()

    linhas_saida = []

    grupos = df.groupby(
        ["data", "hora", "liga", "jogo", "mandante", "visitante"],
        dropna=False
    )

    for (data, hora, liga, jogo, mandante, visitante), grupo in grupos:
        country_raw = grupo["country"].iloc[0] if "country" in grupo.columns and not grupo.empty else ""
        country_modelo, liga_modelo = normalizar_country_league(country_raw, liga)
        row = {
            "date": formatar_data_para_modelo(data),
            "time": limpar_texto(hora),
            "country": country_modelo,
            "league": liga_modelo,
            "home": limpar_texto(mandante),
            "away": limpar_texto(visitante),
        }
        handicap_items = []

        for _, item in grupo.iterrows():
            mercado = limpar_texto(item["mercado"]).lower()
            pick = limpar_texto(item["pick"])
            consistency_status = limpar_texto(item.get("odds_consistency_status")).lower()
            if consistency_status == "invalid":
                ADAPTER_WARNINGS.append(
                    f"Odd bloqueada por incoerencia de mercado: {jogo} | mercado={mercado} | pick={pick}"
                )
                continue
            linha = item["linha"]
            odd = odd_ofertada(item)
            median_odd = odd_consenso(item) or odd

            if odd is None:
                continue

            if mercado in ["1x2", "resultado final", "moneyline", "vencedor"]:
                lado = identificar_pick_1x2(pick, mandante, visitante)

                if lado == "1":
                    set_odd_columns(row, "odds_1X2_Full_Time_1", item)
                elif lado == "X":
                    set_odd_columns(row, "odds_1X2_Full_Time_X", item)
                elif lado == "2":
                    set_odd_columns(row, "odds_1X2_Full_Time_2", item)

            elif "dupla" in mercado or "double" in mercado:
                p = pick.upper().replace(" ", "")

                if "1X" in p:
                    set_odd_columns(row, "odds_Double_chance_Full_Time_1X", item)
                elif "12" in p:
                    set_odd_columns(row, "odds_Double_chance_Full_Time_12", item)
                elif "X2" in p:
                    set_odd_columns(row, "odds_Double_chance_Full_Time_X2", item)

            elif "ambas" in mercado or "btts" in mercado or "both" in mercado:
                p = pick.lower()

                if "sim" in p or "yes" in p:
                    set_odd_columns(row, "odds_Both_teams_to_score_Full_Time_YES", item)
                elif "nao" in p or "não" in p or "no" in p:
                    set_odd_columns(row, "odds_Both_teams_to_score_Full_Time_NO", item)

            elif "over" in pick.lower() or "under" in pick.lower() or "total" in mercado or "gols" in mercado:
                key = linha_para_key_ou(linha)

                if key:
                    p = pick.lower()

                    if "over" in p:
                        set_odd_columns(row, f"odds_OverUnder_Full_Time_{key}_Over", item)
                    elif "under" in p:
                        set_odd_columns(row, f"odds_OverUnder_Full_Time_{key}_Under", item)

            elif "handicap" in mercado:
                if "europe" in mercado or "europeu" in mercado or "3 vias" in mercado:
                    ADAPTER_WARNINGS.append(f"Handicap europeu bloqueado no adapter: {jogo}")
                    continue

                linha_num = normalizar_float(linha)
                if linha_num is None:
                    ADAPTER_WARNINGS.append(f"Handicap sem linha valida no adapter: {jogo} | pick={pick}")
                    continue

                if not is_asian_line(linha_num):
                    ADAPTER_WARNINGS.append(f"Handicap fora dos incrementos asiaticos suportados: {jogo} | linha={linha_num}")
                    continue

                lado = identificar_lado_time(pick, mandante, visitante)
                if lado is None:
                    ADAPTER_WARNINGS.append(f"Handicap ambiguo no adapter: {jogo} | pick={pick}")
                    continue

                handicap_items.append({
                    "side": lado,
                    "line": linha_num,
                    "odd": odd,
                    "odd_mediana": median_odd,
                    "bookmaker_melhor": limpar_texto(item.get("bookmaker_melhor")) or limpar_texto(item.get("bookmaker")),
                    "pick": pick,
                })

        adicionar_handicaps_asiaticos(row, handicap_items, jogo)

        if ADAPTER_WARNINGS:
            row["adapter_warnings"] = " | ".join(ADAPTER_WARNINGS[-10:])

        linhas_saida.append(row)

    df_wide = pd.DataFrame(linhas_saida)

    Path(caminho_saida).parent.mkdir(parents=True, exist_ok=True)
    df_wide.to_csv(caminho_saida, index=False, encoding="utf-8-sig")

    return df_wide
