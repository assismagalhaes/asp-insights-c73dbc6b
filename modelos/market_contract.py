import math
import re
import unicodedata
from typing import Any, Iterable


def _clean(value: Any) -> str:
    if value is None:
        return ""
    try:
        if isinstance(value, float) and math.isnan(value):
            return ""
    except TypeError:
        pass
    return str(value).strip()


def _normalized(value: Any) -> str:
    text = unicodedata.normalize("NFKD", _clean(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9+.-]+", " ", text.lower()).strip()


def _number(value: Any) -> float | None:
    text = _clean(value).replace(",", ".")
    if not text:
        return None
    try:
        number = float(text)
    except (TypeError, ValueError):
        match = re.search(r"(?<!\d)([+-]?\d+(?:[.,]\d+)?)(?!\d)", text)
        if not match:
            return None
        number = float(match.group(1).replace(",", "."))
    return number if math.isfinite(number) else None


def _line_from(row: dict[str, Any]) -> float | None:
    line = _number(row.get("linha"))
    if line is not None:
        return line
    return _number(row.get("pick"))


def _format_line(value: float | None, *, signed: bool = False) -> str:
    if value is None:
        return ""
    absolute = abs(value)
    decimals = 0 if absolute.is_integer() else 2 if not (absolute * 2).is_integer() else 1
    text = f"{value:.{decimals}f}"
    if signed and value >= 0:
        return f"+{text}"
    return text


def _selection_side(row: dict[str, Any]) -> str:
    pick = _normalized(row.get("pick"))
    selection = _normalized(row.get("selection_side"))
    option = _normalized(row.get("opcao_1x2"))
    home = _normalized(row.get("mandante"))
    away = _normalized(row.get("visitante"))

    if option in {"h", "1"} or selection in {"home", "casa", "mandante", "1"}:
        return "home"
    if option in {"a", "2"} or selection in {"away", "fora", "visitante", "2"}:
        return "away"
    if option in {"d", "x"} or selection in {"draw", "empate", "x"}:
        return "draw"
    if "empate" in pick or pick == "x":
        return "draw"
    if any(token in pick for token in ("casa", "mandante", "home")):
        return "home"
    if any(token in pick for token in ("visitante", "fora", "away")):
        return "away"
    if home and (pick == home or home in pick):
        return "home"
    if away and (pick == away or away in pick):
        return "away"
    return ""


def _direction(row: dict[str, Any]) -> str:
    value = f"{_normalized(row.get('selection_side'))} {_normalized(row.get('pick'))} {_normalized(row.get('mercado'))}"
    if "under" in value:
        return "under"
    if "over" in value:
        return "over"
    return ""


def _btts_side(row: dict[str, Any]) -> str:
    value = f"{_normalized(row.get('selection_side'))} {_normalized(row.get('pick'))} {_normalized(row.get('mercado'))}"
    if any(token in value for token in ("nao", " no", "btts no")):
        return "no"
    return "yes" if any(token in value for token in ("sim", "yes", "btts")) else ""


def standardize_prediction(row: dict[str, Any], model_name: str | None = None) -> dict[str, Any]:
    result = dict(row)
    model = _normalized(model_name or row.get("origem_modelo") or row.get("modelo"))
    sport = _normalized(row.get("esporte"))
    market = _normalized(row.get("mercado"))
    pick = _clean(row.get("pick"))
    pick_norm = _normalized(pick)
    line = _line_from(row)
    side = _selection_side(row)
    direction = _direction(row)

    is_goal = "goalmatrix" in model
    is_corner = "cornermatrix" in model
    is_match = "matchmatrix" in model
    is_diamond = "diamond" in model
    is_court = model in {"asp court", "asp court w"} or model.startswith("asp court ")

    if is_goal:
        if direction:
            result["mercado"] = "Over Gols" if direction == "over" else "Under Gols"
            result["pick"] = f"{direction.title()} {_format_line(line)}".strip()
        else:
            btts = _btts_side(row)
            result["mercado"] = "Ambas Marcam Sim" if btts == "yes" else "Ambas Marcam Não"
            result["pick"] = "BTTS Sim" if btts == "yes" else "BTTS Não"
    elif is_corner:
        if direction:
            result["mercado"] = "Over Cantos" if direction == "over" else "Under Cantos"
            result["pick"] = f"{direction.title()} {_format_line(line)}".strip()
        elif "race" in market or "race" in pick_norm:
            result["mercado"] = "Race Cantos"
            location = "Casa" if side == "home" else "Visitante"
            result["pick"] = f"Race {_format_line(line)} Cantos {location}".strip()
        else:
            result["mercado"] = "Mais Cantos"
            result["pick"] = "Mais Cantos Casa" if side == "home" else "Mais Cantos Visitante"
    elif is_match or (sport in {"futebol", "soccer"} and not model):
        if "dupla" in market or "double chance" in market:
            token = pick_norm.replace(" ", "").upper()
            result["mercado"] = "Dupla Chance"
            result["pick"] = token if token in {"1X", "12", "X2"} else pick.upper()
        elif direction:
            result["mercado"] = "Over Gols" if direction == "over" else "Under Gols"
            result["pick"] = f"{direction.title()} {_format_line(line)}".strip()
        elif "ambas" in market or "btts" in market or "ambas" in pick_norm or "btts" in pick_norm:
            btts = _btts_side(row)
            result["mercado"] = "Ambas Marcam Sim" if btts == "yes" else "Ambas Marcam Não"
            result["pick"] = "BTTS Sim" if btts == "yes" else "BTTS Não"
        elif "handicap" in market or pick_norm.startswith("ha "):
            result["mercado"] = "Handicap Asiático"
            location = "Casa" if side == "home" else "Visitante"
            result["pick"] = f"HA {location} {_format_line(line, signed=True)}".strip()
        else:
            result["mercado"] = "Moneyline"
            location = "Casa" if side == "home" else "Visitante" if side == "away" else "Empate"
            result["pick"] = f"Moneyline {location}"
    elif is_diamond:
        if direction:
            result["mercado"] = "Over Corridas" if direction == "over" else "Under Corridas"
            result["pick"] = f"{direction.title()} {_format_line(line)}".strip()
        elif "handicap" in market or "run line" in market or pick_norm.startswith("ha "):
            result["mercado"] = "Handicap Asiático"
            location = "Casa" if side == "home" else "Visitante"
            result["pick"] = f"HA {location} {_format_line(line, signed=True)}".strip()
        else:
            result["mercado"] = "Moneyline"
            result["pick"] = "Moneyline Casa" if side == "home" else "Moneyline Visitante"
    elif is_court:
        if direction:
            result["mercado"] = "Over Pontos" if direction == "over" else "Under Pontos"
            result["pick"] = f"{direction.title()} {_format_line(line)}".strip()
        elif "handicap" in market or "spread" in market or pick_norm.startswith("ha "):
            result["mercado"] = "Handicap Asiático"
            location = "Casa" if side == "home" else "Visitante"
            result["pick"] = f"HA {location} {_format_line(line, signed=True)}".strip()
        else:
            result["mercado"] = "Moneyline"
            result["pick"] = "Moneyline Casa" if side == "home" else "Moneyline Visitante"
    elif line is not None and _format_line(line) not in pick:
        result["pick"] = f"{pick} {_format_line(line, signed='handicap' in market)}".strip()

    result.pop("linha", None)
    return result


def standardize_prediction_rows(
    rows: Iterable[dict[str, Any]], model_name: str | None = None
) -> list[dict[str, Any]]:
    return [standardize_prediction(row, model_name=model_name) for row in rows]


def standardize_prediction_dataframe(frame: Any, model_name: str | None = None) -> Any:
    if frame.empty:
        return frame.drop(columns=["linha"], errors="ignore")
    rows = standardize_prediction_rows(frame.to_dict(orient="records"), model_name=model_name)
    return frame.__class__(rows, index=frame.index)
