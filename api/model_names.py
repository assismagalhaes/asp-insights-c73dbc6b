MODEL_NAME_FOOTBALL = "ASP MatchMatrix"
MODEL_NAME_BASEBALL = "ASP Diamond"

BASKETBALL_MODEL_NAMES = {
    "NBA": "ASP Court",
    "WNBA": "ASP Court W",
}


def basketball_model_name(league: str) -> str:
    normalized = str(league or "").strip().upper()
    try:
        return BASKETBALL_MODEL_NAMES[normalized]
    except KeyError as exc:
        raise ValueError(f"Liga de basketball sem nome de modelo: {league}") from exc
