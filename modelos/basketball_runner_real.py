from __future__ import annotations

import contextlib
import csv
import io
import json
import math
import os
import random
import re
import sys
import types
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

BASE_DIR = Path('/home/ubuntu/asp-scraper-api')
JUPYTER_DIR = Path('/home/ubuntu/jupyter')
NOTEBOOKS = {
    'NBA': JUPYTER_DIR / 'prognosticos_basketball_nba.ipynb',
    'WNBA': JUPYTER_DIR / 'prognosticos_basketball_wnba.ipynb',
}

MIN_ODD_EXPORT = 1.25
MAX_ODD_EXPORT = 2.00
BASKETBALL_WNBA_MODEL_VERSION = "BASKETBALL_WNBA_V1_4_SIM_MARKETS"
BASKETBALL_WNBA_HANDICAP_MODEL_VERSION = "BASKETBALL_WNBA_V1_7_HANDICAP_CONTROLLED"
WNBA_CURRENT_SEASON_YEAR = 2026
WNBA_PREVIOUS_SEASON_YEAR = 2025
WNBA_TOTAL_PRIOR = 0.50
WNBA_TOTAL_PRIOR_STRENGTH = 10.0
WNBA_TOTAL_LOW_SAMPLE = 10
WNBA_OVERCONFIDENCE_CUTOFF = 70.0
WNBA_HANDICAP_ENABLED_V1_1 = False
WNBA_HANDICAP_ENABLED_V1_7 = True
WNBA_TOTAL_V1_3_WEIGHTS = {"hist": 0.35, "sim": 0.35, "vig": 0.30}
WNBA_MONEYLINE_V1_4_WEIGHTS = {"hist": 0.35, "sim": 0.35, "vig": 0.30}
WNBA_HANDICAP_V1_8_WEIGHTS = {"hist": 0.35, "sim": 0.35, "vig": 0.30}
WNBA_TOTAL_SIMULATIONS = 10_000
WNBA_TOTAL_MARKET_ANCHOR_WEIGHT = 0.40
WNBA_TOTAL_MIN_TEAM_SD = 8.0


def main() -> None:
    if len(sys.argv) not in (4, 5):
        emit({'ok': False, 'erro': 'Uso inválido', 'detalhe': 'python basketball_runner_real.py CSV_COLETA OUTPUT_PATH NBA|WNBA'})
        return

    csv_coleta_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    league = normalize_league(sys.argv[3])

    try:
        module = load_notebook_module(league)
        games = long_csv_to_wide(csv_coleta_path, league, module)
        if games.empty:
            result = empty_result(league, output_path, 'CSV da coleta não trouxe jogos Basketball válidos para a liga selecionada.')
            write_output_csv(output_path, [])
            emit(result)
            return

        update_model_periods(module, league, games)
        rows: list[dict[str, Any]] = []
        contexts: list[str] = []
        errors: list[str] = []

        linhas_ou = detect_ou_lines(games)
        hc_idxs = detect_hc_indexes(games)

        for _, row in games.iterrows():
            try:
                res = module.analyze_game(row, linhas_ou, hc_idxs)
                home = row['home_sigla']
                away = row['away_sigla']
                if league == 'WNBA':
                    res['H2H_df'], res['H2H_stats'] = module.gerar_h2h(home, away, periodos=(module.TEMPORADA_ATUAL, module.TEMPORADA_PASSADA))
                else:
                    res['H2H_df'], res['H2H_stats'] = module.gerar_h2h(home, away, periodos=(module.PERIODO_ATUAL, module.PERIODO_PASSADO))

                context = capture_context(module, res, row, linhas_ou, hc_idxs)
                contexts.append(context)
                if league == 'WNBA' and hasattr(module, 'montar_linhas_lovable'):
                    game_rows = module.montar_linhas_lovable(row, res)
                    game_rows = [
                        item for item in game_rows
                        if normalize_text(item.get('mercado')) != 'moneyline'
                        and 'handicap' not in normalize_text(item.get('mercado'))
                        and 'overunder' not in normalize_text(item.get('mercado'))
                        and 'total' not in normalize_text(item.get('mercado'))
                        and 'pontos' not in normalize_text(item.get('mercado'))
                    ]
                    game_rows.extend(build_wnba_moneyline_candidate_rows(module, row, res))
                    game_rows.extend(build_wnba_total_candidate_rows(module, row, res))
                    game_rows.extend(build_wnba_handicap_candidate_rows(module, row, res))
                    game_rows = apply_wnba_v1_1_controls(module, row, res, game_rows, lines=linhas_ou)
                else:
                    game_rows = montar_linhas_nba(module, row, res)
                for item in game_rows:
                    item.setdefault('dados_tecnicos', context)
                    item.setdefault('contexto_modelo', context)
                    item.setdefault('parecer_validacao', build_parecer(item))
                    item.setdefault('odd', item.get('odd_ofertada'))
                    item.setdefault('probabilidade', item.get('probabilidade_final'))
                    item.setdefault('stake', stake_sugerida(to_float(item.get('probabilidade_final')), to_float(item.get('edge'))))
                rows.extend(game_rows)
            except Exception as exc:  # keep other games running
                errors.append(f"{row.get('home')} vs {row.get('away')}: {exc}")

        rows = normalize_rows(rows, league)
        handicap_shadow_diagnostics = None
        if league == 'WNBA':
            activation = build_wnba_handicap_controlled_activation_from_csv(csv_coleta_path)
            rows.sort(key=lambda r: (r.get('data') or '', r.get('hora') or '', r.get('jogo') or '', r.get('mercado') or '', -float(r.get('edge') or 0)))
            handicap_shadow_diagnostics = activation.get('handicap_shadow_diagnostics')
        write_output_csv(output_path, rows)
        contexto_modelo = '\n\n'.join(contexts[:20])
        msg = None
        if not rows:
            msg = 'Nenhuma oportunidade EV+ encontrada para os filtros atuais.'
        if errors:
            msg = (msg + ' ' if msg else '') + f"Jogos ignorados/erros: {'; '.join(errors[:5])}"

        result_payload = {
            'ok': True,
            'modelo': f'Basketball {league}',
            'arquivo_saida': str(output_path),
            'arquivo_contexto': None,
            'total_prognosticos': len(rows),
            'contexto_modelo': contexto_modelo,
            'dados_tecnicos': contexto_modelo,
            'mensagem': msg,
            'prognosticos': rows,
        }
        if handicap_shadow_diagnostics is not None:
            result_payload['handicap_shadow_diagnostics'] = handicap_shadow_diagnostics
        emit(result_payload)
    except Exception as exc:
        emit({'ok': False, 'erro': str(exc), 'detalhe': f'csv={csv_coleta_path} output={output_path} league={league}'})


def normalize_league(value: str) -> str:
    league = str(value or '').upper().strip()
    if league in {'NBA', 'WNBA'}:
        return league
    raise RuntimeError('Liga Basketball inválida. Use NBA ou WNBA.')


def build_wnba_handicap_shadow_from_csv(csv_coleta_path: Path) -> dict[str, Any]:
    from modelos.wnba_handicap_shadow_runner_integration_v1_6 import build_wnba_handicap_shadow_diagnostics

    try:
        df = pd.read_csv(csv_coleta_path)
        normalized_rows = df.to_dict(orient='records')
    except Exception as exc:
        return {
            'enabled': True,
            'mode': 'shadow_only',
            'model_version': 'WNBA_HANDICAP_SHADOW_V1_6',
            'published': False,
            'pairs_analyzed': 0,
            'valid_pairs': 0,
            'diagnostics': [],
            'summary': {'erro': str(exc)},
            'warnings': ['SHADOW_READ_ERROR'],
        }
    return build_wnba_handicap_shadow_diagnostics(normalized_rows, {'source': str(csv_coleta_path)})


def build_wnba_handicap_controlled_activation_from_csv(csv_coleta_path: Path) -> dict[str, Any]:
    from modelos.wnba_handicap_controlled_activation_v1_7 import build_wnba_handicap_controlled_activation

    try:
        df = pd.read_csv(csv_coleta_path)
        normalized_rows = df.to_dict(orient='records')
    except Exception as exc:
        return {
            'handicap_shadow_diagnostics': {
                'enabled': WNBA_HANDICAP_ENABLED_V1_7,
                'mode': 'controlled_activation',
                'model_version': BASKETBALL_WNBA_HANDICAP_MODEL_VERSION,
                'published': False,
                'published_count': 0,
                'pairs_analyzed': 0,
                'valid_pairs': 0,
                'diagnostics': [],
                'summary': {'erro': str(exc)},
                'warnings': ['CONTROLLED_ACTIVATION_READ_ERROR'],
            },
            'prognosticos': [],
            'discarded': [],
        }
    if not WNBA_HANDICAP_ENABLED_V1_7:
        shadow = build_wnba_handicap_shadow_from_csv(csv_coleta_path)
        shadow['mode'] = 'shadow_only'
        shadow['published'] = False
        shadow['published_count'] = 0
        return {'handicap_shadow_diagnostics': shadow, 'prognosticos': [], 'discarded': shadow.get('diagnostics', [])}
    return build_wnba_handicap_controlled_activation(normalized_rows, {'source': str(csv_coleta_path)})


def load_notebook_module(league: str) -> types.SimpleNamespace:
    nb_path = NOTEBOOKS[league]
    if not nb_path.exists():
        raise RuntimeError(f'Notebook do modelo Basketball {league} não encontrado: {nb_path}')
    nb = json.loads(nb_path.read_text(encoding='utf-8'))
    code = '\n\n'.join(''.join(cell.get('source', [])) for cell in nb.get('cells', []) if cell.get('cell_type') == 'code')
    ns: dict[str, Any] = {
        '__name__': f'basketball_{league.lower()}_notebook',
        '__file__': str(nb_path),
        'BASE_DIR': JUPYTER_DIR,
    }
    old_cwd = Path.cwd()
    os.chdir(JUPYTER_DIR)
    try:
        exec(compile(code, str(nb_path), 'exec'), ns)
    finally:
        os.chdir(old_cwd)
    return types.SimpleNamespace(**ns)


def long_csv_to_wide(csv_path: Path, league: str, module: Any) -> pd.DataFrame:
    if not csv_path.exists():
        raise RuntimeError(f'CSV da coleta não encontrado: {csv_path}')
    df = pd.read_csv(csv_path)
    required = {'data', 'hora', 'liga', 'mandante', 'visitante', 'mercado', 'pick', 'linha', 'odd'}
    missing = sorted(required - set(df.columns))
    if missing:
        raise RuntimeError(f'CSV da coleta não tem colunas obrigatórias: {missing}')

    df = df[df['esporte'].astype(str).str.lower().str.contains('basketball', na=False)] if 'esporte' in df.columns else df
    df = df[df['liga'].astype(str).str.upper().str.contains(league, na=False)].copy()
    if df.empty:
        return pd.DataFrame()

    team_mapper = build_team_mapper(league, module)
    grouped: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    handicap_pairs: dict[tuple, dict[str, Any]] = {}

    for _, r in df.iterrows():
        home = clean(r.get('mandante'))
        away = clean(r.get('visitante'))
        if not home or not away:
            continue
        data = normalize_date_for_model(r.get('data'))
        hora = normalize_time(r.get('hora'))
        jogo = clean(r.get('jogo')) or f'{home} vs {away}'
        key = (data, hora, home, away, jogo)
        game = grouped.setdefault(key, {
            'date': data,
            'time': hora,
            'home': home,
            'away': away,
            'league': league,
            'odds_HomeAway_FT_including_OT_1': math.nan,
            'odds_HomeAway_FT_including_OT_2': math.nan,
        })
        mercado = normalize_text(r.get('mercado'))
        pick = clean(r.get('pick'))
        linha = to_float(r.get('linha'))
        odd = to_float(r.get('odd'))
        if odd is None or odd <= 1:
            continue

        pick_norm = normalize_text(pick)
        home_norm = normalize_text(home)
        away_norm = normalize_text(away)

        if any(token in mercado for token in ('moneyline', 'homeaway', 'vencedor', 'winner')):
            if home_norm and (home_norm in pick_norm or pick_norm in home_norm):
                set_best(game, 'odds_HomeAway_FT_including_OT_1', odd)
            elif away_norm and (away_norm in pick_norm or pick_norm in away_norm):
                set_best(game, 'odds_HomeAway_FT_including_OT_2', odd)
            continue

        if any(token in mercado for token in ('overunder', 'over/under', 'total')) and linha is not None:
            line_key = format_line_key(linha)
            if 'over' in pick_norm:
                set_best(game, f'odds_OverUnder_FT_including_OT_{line_key}_Over', odd)
            elif 'under' in pick_norm:
                set_best(game, f'odds_OverUnder_FT_including_OT_{line_key}_Under', odd)
            continue

        if 'handicap' in mercado and linha is not None:
            pair_key = (key, abs(float(linha)))
            pair = handicap_pairs.setdefault(pair_key, {'game': game, 'line': float(linha), 'home_odd': None, 'away_odd': None})
            if home_norm and (home_norm in pick_norm or pick_norm in home_norm):
                pair['home_odd'] = max_odd(pair.get('home_odd'), odd)
                pair['line'] = float(linha)
            elif away_norm and (away_norm in pick_norm or pick_norm in away_norm):
                pair['away_odd'] = max_odd(pair.get('away_odd'), odd)
                pair['line'] = float(linha)

    for idx, pair in enumerate(handicap_pairs.values(), start=1):
        if pair.get('home_odd') is None or pair.get('away_odd') is None:
            continue
        game = pair['game']
        line = float(pair['line'])
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_HANDICAP'] = line
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_1'] = pair['home_odd']
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_HANDICAP'] = -line
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_Odd'] = pair['away_odd']

    rows = list(grouped.values())
    wide = pd.DataFrame(rows)
    if wide.empty:
        return wide

    # The notebooks require ML odds. If the collection has no ML market, use a neutral no-vig placeholder.
    wide['odds_HomeAway_FT_including_OT_1'] = pd.to_numeric(wide['odds_HomeAway_FT_including_OT_1'], errors='coerce')
    wide['odds_HomeAway_FT_including_OT_2'] = pd.to_numeric(wide['odds_HomeAway_FT_including_OT_2'], errors='coerce')
    wide['_ml_home_missing'] = wide['odds_HomeAway_FT_including_OT_1'].isna()
    wide['_ml_away_missing'] = wide['odds_HomeAway_FT_including_OT_2'].isna()
    wide['odds_HomeAway_FT_including_OT_1'] = wide['odds_HomeAway_FT_including_OT_1'].fillna(2.0)
    wide['odds_HomeAway_FT_including_OT_2'] = wide['odds_HomeAway_FT_including_OT_2'].fillna(2.0)
    wide['home_sigla'] = wide['home'].map(team_mapper)
    wide['away_sigla'] = wide['away'].map(team_mapper)
    if wide['home_sigla'].isna().any() or wide['away_sigla'].isna().any():
        bad = wide[wide['home_sigla'].isna() | wide['away_sigla'].isna()][['home', 'away']].drop_duplicates().to_dict(orient='records')
        raise RuntimeError(f'Não foi possível mapear times Basketball {league}: {bad}')
    return wide


def build_team_mapper(league: str, module: Any) -> dict[str, str]:
    mapper: dict[str, str] = {}
    for sigla, nome in getattr(module, 'TEAMS', {}).items():
        mapper[str(nome)] = str(sigla)
        mapper[str(nome).replace(' W', '')] = str(sigla)
    if league == 'WNBA' and hasattr(module, 'team_name_to_sigla'):
        # Keep explicit aliases already implemented in the WNBA notebook.
        for name in list(mapper):
            mapper[name] = module.team_name_to_sigla(name) or mapper[name]
    return mapper


def detect_ou_lines(df: pd.DataFrame) -> list[float]:
    values = set()
    for col in df.columns:
        m = re.search(r'odds_OverUnder_FT_including_OT_(\d+_\d+)_Over', str(col))
        if m:
            values.add(float(m.group(1).replace('_', '.')))
    return sorted(values)


def detect_hc_indexes(df: pd.DataFrame) -> list[str]:
    values = set()
    for col in df.columns:
        m = re.search(r'odds_Asian_handicap_FT_including_OT_Linha(\d+)_HANDICAP', str(col))
        if m:
            values.add(m.group(1))
    return sorted(values, key=int)


def update_model_periods(module: Any, league: str, games: pd.DataFrame) -> None:
    dt = pd.to_datetime(games['date'].iloc[0], errors='coerce')
    if pd.isna(dt):
        dt = datetime.now()
    if league == 'WNBA':
        current, previous = wnba_operational_seasons(dt.to_pydatetime() if hasattr(dt, 'to_pydatetime') else dt)
        module.TEMPORADA_ATUAL = current
        module.TEMPORADA_PASSADA = previous
    else:
        current = module.nba_season_from_date(dt.to_pydatetime() if hasattr(dt, 'to_pydatetime') else dt)
        start_year = int(str(current).split('-')[0]) - 1
        module.PERIODO_ATUAL = current
        module.PERIODO_PASSADO = f'{start_year}-{(start_year + 1) % 100:02d}'


def capture_context(module: Any, res: dict, row: pd.Series, linhas_ou: list[float], hc_idxs: list[str]) -> str:
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        module.print_analysis(res, row, linhas_ou, hc_idxs)
    return filtrar_contexto_tecnico(buffer.getvalue())


def filtrar_contexto_tecnico(texto: str) -> str:
    """Mantém apenas o contexto técnico usado na validação crítica."""
    if not texto:
        return ""

    linhas = texto.splitlines()
    inicio = 0
    for idx, linha in enumerate(linhas):
        if linha.strip().startswith("--- CONFRONTO ---"):
            inicio = idx
            break

    fim = len(linhas)
    marcadores_fim = (
        "--- MONEYLINE",
        "--- OVER/UNDER",
        "--- HANDICAP",
        "=== PROGN",
    )
    for idx in range(inicio + 1, len(linhas)):
        strip = linhas[idx].strip()
        if any(strip.startswith(marcador) for marcador in marcadores_fim):
            fim = idx
            break

    filtradas = linhas[inicio:fim]

    while filtradas and not filtradas[0].strip():
        filtradas.pop(0)
    while filtradas and not filtradas[-1].strip():
        filtradas.pop()

    texto_filtrado = "\n".join(filtradas).strip()
    while "\n\n\n" in texto_filtrado:
        texto_filtrado = texto_filtrado.replace("\n\n\n", "\n\n")
    return texto_filtrado


def montar_linhas_nba(module: Any, row: pd.Series, res: dict) -> list[dict[str, Any]]:
    home = row['home_sigla']
    away = row['away_sigla']
    teams = module.TEAMS
    jogo = f'{teams[home]} vs {teams[away]}'
    data = format_date_for_app(row.get('date'))
    hora = normalize_time(row.get('time'))
    obs = observacoes(module, res, home, away)
    common = {
        'data': data,
        'hora': hora,
        'esporte': 'Basketball',
        'liga': 'NBA',
        'jogo': jogo,
        'mandante': teams[home],
        'visitante': teams[away],
    }
    out: list[dict[str, Any]] = []

    def add(mercado: str, pick: str, linha: Any, prob: Any, odd_valor: Any, odd_ofertada: Any, ranged: bool = True) -> None:
        odd_o = to_float(odd_ofertada)
        odd_v = to_float(odd_valor)
        prob_f = to_float(prob)
        if odd_o is None or odd_v is None or prob_f is None:
            return
        if odd_o <= odd_v:
            return
        if ranged and not (odd_o > MIN_ODD_EXPORT and odd_o <= MAX_ODD_EXPORT):
            return
        edge = (odd_o / odd_v - 1) * 100 if odd_v else 0
        out.append({
            **common,
            'mercado': mercado,
            'pick': pick,
            'linha': '' if linha is None else linha,
            'odd_ofertada': round(odd_o, 2),
            'odd_valor': round(odd_v, 2),
            'probabilidade_final': round(prob_f, 2),
            'edge': round(edge, 2),
            'observacoes': obs,
        })

    add('Moneyline', teams[home], '', res.get('prob_c'), res.get('val_c'), res.get('odd_ml_c'), ranged=False)
    add('Moneyline', teams[away], '', res.get('prob_f'), res.get('val_f'), res.get('odd_ml_f'), ranged=False)
    for ln, v in (res.get('ou') or {}).items():
        add('Over/Under Pontos', f'Over {ln}', ln, v.get('prob_over'), v.get('odd_val_over'), v.get('odd_off_over'))
        add('Over/Under Pontos', f'Under {ln}', ln, v.get('prob_under'), v.get('odd_val_under'), v.get('odd_off_under'))
    for (side, h), v in (res.get('hc') or {}).items():
        team = teams[home] if side in ('home', 'casa') else teams[away]
        add('Handicap Asiático', f'{team} {float(h):+.1f}', h, v.get('prob'), v.get('odd_val'), v.get('odd_off'))
    return out


def build_wnba_moneyline_candidate_rows(module: Any, row: pd.Series, res: dict) -> list[dict[str, Any]]:
    """Build both WNBA Moneyline sides before V1.4 recalculates probability and EV."""

    home = row['home_sigla']
    away = row['away_sigla']
    teams = module.TEAMS
    jogo = f'{teams[home]} vs {teams[away]}'
    data = format_date_for_app(row.get('date'))
    hora = normalize_time(row.get('time'))
    obs = observacoes(module, res, home, away)
    common = {
        'data': data,
        'hora': hora,
        'esporte': 'Basketball',
        'liga': 'WNBA',
        'jogo': jogo,
        'mandante': teams[home],
        'visitante': teams[away],
        'mercado': 'Moneyline',
        'linha': '',
        'observacoes': obs,
    }
    rows: list[dict[str, Any]] = []
    for team, odd_key in ((teams[home], 'odd_ml_c'), (teams[away], 'odd_ml_f')):
        odd = to_float(res.get(odd_key))
        if odd is None:
            continue
        rows.append({
            **common,
            'pick': team,
            'odd_ofertada': round(odd, 2),
            'odd_valor': 0.0,
            'probabilidade_final': 0.0,
            'edge': 0.0,
        })
    return rows


def build_wnba_total_candidate_rows(module: Any, row: pd.Series, res: dict) -> list[dict[str, Any]]:
    """Build every WNBA total side, letting the V1.2 controls decide EV+ after recalculation."""

    home = row['home_sigla']
    away = row['away_sigla']
    teams = module.TEAMS
    jogo = f'{teams[home]} vs {teams[away]}'
    data = format_date_for_app(row.get('date'))
    hora = normalize_time(row.get('time'))
    obs = observacoes(module, res, home, away)
    common = {
        'data': data,
        'hora': hora,
        'esporte': 'Basketball',
        'liga': 'WNBA',
        'jogo': jogo,
        'mandante': teams[home],
        'visitante': teams[away],
        'mercado': 'Over/Under Pontos',
        'observacoes': obs,
    }
    rows: list[dict[str, Any]] = []
    for line, values in (res.get('ou') or {}).items():
        for side in ('Over', 'Under'):
            side_key = side.lower()
            odd = to_float(values.get(f'odd_off_{side_key}'))
            odd_value = to_float(values.get(f'odd_val_{side_key}'))
            probability = to_float(values.get(f'prob_{side_key}'))
            if odd is None or odd_value is None or probability is None:
                continue
            rows.append({
                **common,
                'pick': f'{side} {line}',
                'linha': line,
                'odd_ofertada': round(odd, 2),
                'odd_valor': round(odd_value, 2),
                'probabilidade_final': round(probability, 2),
                'edge': round((odd / odd_value - 1.0) * 100.0, 2) if odd_value else 0.0,
            })
    return rows


def build_wnba_handicap_candidate_rows(module: Any, row: pd.Series, res: dict) -> list[dict[str, Any]]:
    """Build every WNBA handicap side before V1.4 applies line-cover logic."""

    home = row['home_sigla']
    away = row['away_sigla']
    teams = module.TEAMS
    jogo = f'{teams[home]} vs {teams[away]}'
    data = format_date_for_app(row.get('date'))
    hora = normalize_time(row.get('time'))
    obs = observacoes(module, res, home, away)
    common = {
        'data': data,
        'hora': hora,
        'esporte': 'Basketball',
        'liga': 'WNBA',
        'jogo': jogo,
        'mandante': teams[home],
        'visitante': teams[away],
        'mercado': 'Handicap Asiático',
        'observacoes': obs,
    }
    rows: list[dict[str, Any]] = []
    for (side, line), values in (res.get('hc') or {}).items():
        odd = to_float((values or {}).get('odd_off') if isinstance(values, dict) else None)
        line_float = to_float(line)
        if odd is None or line_float is None:
            continue
        side_norm = normalize_text(side)
        team = teams[home] if side_norm in {'home', 'casa'} else teams[away]
        rows.append({
            **common,
            'pick': f'{team} {line_float:+.1f}',
            'linha': line_float,
            'odd_ofertada': round(odd, 2),
            'odd_valor': 0.0,
            'probabilidade_final': 0.0,
            'edge': 0.0,
        })
    return rows


def wnba_operational_seasons(value: datetime | None = None) -> tuple[str, str]:
    """Return WNBA operational seasons without leaking future bases into the model."""

    year = int(getattr(value, "year", WNBA_CURRENT_SEASON_YEAR) or WNBA_CURRENT_SEASON_YEAR)
    if year >= WNBA_CURRENT_SEASON_YEAR:
        return str(WNBA_CURRENT_SEASON_YEAR), str(WNBA_PREVIOUS_SEASON_YEAR)
    return str(year), str(year - 1)


def apply_wnba_v1_1_controls(module: Any, row: pd.Series, res: dict, rows: list[dict[str, Any]], lines: list[float] | None = None) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    home = str(row.get('home_sigla') or '')
    away = str(row.get('away_sigla') or '')
    for item in rows:
        adjusted = apply_wnba_v1_1_to_pick(module, row, res, dict(item), home, away, lines=lines)
        if adjusted is not None:
            selected.append(adjusted)
    return selected


def apply_wnba_v1_1_to_pick(module: Any, row: pd.Series, res: dict, item: dict[str, Any], home: str, away: str, lines: list[float] | None = None) -> dict[str, Any] | None:
    market = normalize_text(item.get('mercado'))
    reasons: list[str] = []
    debug: dict[str, Any] = {"modelo_versao": BASKETBALL_WNBA_MODEL_VERSION}

    if 'handicap' in market and not (WNBA_HANDICAP_ENABLED_V1_1 or WNBA_HANDICAP_ENABLED_V1_7):
        return mark_wnba_discard(item, "WEAK_HANDICAP_SUPPORT", keep=False)

    if market == 'moneyline':
        recalculated = recalculate_wnba_moneyline_pick(module, row, res, item, home, away, lines=lines)
        if recalculated is None:
            return mark_wnba_discard(item, "NO_MARKET_BASELINE", keep=False)
        item, moneyline_debug = recalculated
        debug.update(moneyline_debug)

    if 'overunder' in market or 'total' in market or 'pontos' in market:
        recalculated = recalculate_wnba_total_pick(module, row, res, item, home, away, lines=lines)
        if recalculated is None:
            return mark_wnba_discard(item, "WEAK_TOTALS_SUPPORT", keep=False)
        item, total_debug = recalculated
        debug.update(total_debug)

    if 'handicap' in market:
        recalculated = recalculate_wnba_handicap_pick(module, row, res, item, home, away, lines=lines)
        if recalculated is None:
            return mark_wnba_discard(item, "WEAK_HANDICAP_SUPPORT", keep=False)
        item, handicap_debug = recalculated
        debug.update(handicap_debug)

    odd = to_float(item.get('odd_ofertada'))
    prob = to_float(item.get('probabilidade_final'))
    odd_valor = to_float(item.get('odd_valor'))
    if odd is None or odd <= 1:
        return mark_wnba_discard(item, "INVALID_ODD", keep=False)
    if odd_valor is None or odd_valor <= 1:
        return mark_wnba_discard(item, "NO_MARKET_BASELINE", keep=False)
    if prob is None or prob <= 0:
        return mark_wnba_discard(item, "INVALID_PROBABILITY", keep=False)
    if prob >= WNBA_OVERCONFIDENCE_CUTOFF:
        return mark_wnba_discard(item, "OVERCONFIDENCE_CAP", keep=False)
    if odd <= odd_valor:
        return mark_wnba_discard(item, "NO_EV_AFTER_V1_1", keep=False)
    if not (odd > MIN_ODD_EXPORT and odd <= MAX_ODD_EXPORT):
        return mark_wnba_discard(item, "ODD_OUT_OF_RANGE", keep=False)

    item['observacoes'] = append_wnba_debug(item.get('observacoes'), debug, reasons)
    item['modelo_versao'] = BASKETBALL_WNBA_MODEL_VERSION
    return item


def recalculate_wnba_moneyline_pick(module: Any, row: pd.Series, res: dict, item: dict[str, Any], home: str, away: str, lines: list[float] | None = None) -> tuple[dict[str, Any], dict[str, Any]] | None:
    odd = to_float(item.get('odd_ofertada'))
    if odd is None:
        return None
    pick_side = identify_wnba_pick_side(item, home, away)
    if pick_side not in {'home', 'away'}:
        return None
    home_odd = to_float(res.get('odd_ml_c'))
    away_odd = to_float(res.get('odd_ml_f'))
    if home_odd is None or away_odd is None:
        return None
    vig = no_vig_pair(home_odd, away_odd)
    if vig is None:
        return None

    hist = wnba_historical_moneyline_probability(module, home, away, pick_side)
    simulation = wnba_simulate_matchup(module, row, res, home, away, lines=lines)
    sim_prob = simulation['home_win_probability'] if pick_side == 'home' else simulation['away_win_probability']
    vig_prob = vig[0] if pick_side == 'home' else vig[1]
    weights = WNBA_MONEYLINE_V1_4_WEIGHTS
    prob = (
        float(weights.get('hist', 0.35)) * hist['taxa_com_shrinkage'] +
        float(weights.get('sim', 0.35)) * sim_prob +
        float(weights.get('vig', 0.30)) * vig_prob
    )
    prob = max(0.0, min(0.99, prob))
    odd_valor = 1.0 / prob if prob else 0.0
    edge = odd * prob - 1.0
    item['probabilidade_final'] = round(prob * 100.0, 2)
    item['probabilidade'] = round(prob * 100.0, 2)
    item['odd_valor'] = round(odd_valor, 2)
    item['edge'] = round(edge * 100.0, 2)
    debug = {
        'mercado': 'Moneyline',
        'side': pick_side,
        'prob_hist': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'prob_sim': round(sim_prob * 100.0, 2),
        'prob_no_vig': round(vig_prob * 100.0, 2),
        'pesos_probabilidade': weights,
        'vitorias_reais': hist['wins'],
        'derrotas_reais': hist['losses'],
        'jogos_considerados': hist['jogos_considerados'],
        'simulacoes': simulation['simulations'],
        'vitorias_sim_home': simulation['home_wins'],
        'vitorias_sim_away': simulation['away_wins'],
        'total_calibrado': round(simulation['calibrated_total_expected'], 2),
        'margem_media_simulada': round(simulation['average_margin'], 2),
        'warnings': hist['warnings'],
    }
    return item, debug


def recalculate_wnba_handicap_pick(module: Any, row: pd.Series, res: dict, item: dict[str, Any], home: str, away: str, lines: list[float] | None = None) -> tuple[dict[str, Any], dict[str, Any]] | None:
    line = to_float(item.get('linha'))
    odd = to_float(item.get('odd_ofertada'))
    if line is None or odd is None:
        return None
    pick_side = identify_wnba_pick_side(item, home, away)
    if pick_side not in {'home', 'away'}:
        return None
    no_vig = wnba_handicap_no_vig_probability(res, pick_side, line)
    if no_vig is None:
        return None

    hist = wnba_historical_handicap_probability(module, home, away, pick_side, line)
    simulation = wnba_simulate_matchup(module, row, res, home, away, handicap_line=line, handicap_side=pick_side, lines=lines)
    sim_prob = simulation['handicap_cover_probability']
    weights = WNBA_HANDICAP_V1_8_WEIGHTS
    prob = (
        float(weights.get('hist', 0.35)) * hist['taxa_com_shrinkage'] +
        float(weights.get('sim', 0.35)) * sim_prob +
        float(weights.get('vig', 0.30)) * no_vig
    )
    prob = max(0.0, min(0.99, prob))
    odd_valor = 1.0 / prob if prob else 0.0
    edge = odd * prob - 1.0
    item['probabilidade_final'] = round(prob * 100.0, 2)
    item['probabilidade'] = round(prob * 100.0, 2)
    item['odd_valor'] = round(odd_valor, 2)
    item['edge'] = round(edge * 100.0, 2)
    debug = {
        'mercado': 'Handicap',
        'side': pick_side,
        'linha_avaliada': line,
        'prob_hist': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'prob_sim': round(sim_prob * 100.0, 2),
        'prob_no_vig': round(no_vig * 100.0, 2),
        'pesos_probabilidade': weights,
        'coberturas_reais': hist['wins'],
        'falhas_reais': hist['losses'],
        'pushes': hist['pushes'],
        'jogos_considerados': hist['jogos_considerados'],
        'simulacoes': simulation['simulations'],
        'coberturas_simuladas': simulation['handicap_wins'],
        'pushes_simulados': simulation['handicap_pushes'],
        'total_calibrado': round(simulation['calibrated_total_expected'], 2),
        'margem_media_simulada': round(simulation['average_margin'], 2),
        'warnings': hist['warnings'],
    }
    return item, debug


def recalculate_wnba_total_pick(module: Any, row: pd.Series, res: dict, item: dict[str, Any], home: str, away: str, lines: list[float] | None = None) -> tuple[dict[str, Any], dict[str, Any]] | None:
    line = to_float(item.get('linha'))
    odd = to_float(item.get('odd_ofertada'))
    if line is None or odd is None:
        return None
    side = 'over' if 'over' in normalize_text(item.get('pick')) else 'under' if 'under' in normalize_text(item.get('pick')) else ''
    if not side:
        return None
    market_info = (res.get('ou') or {}).get(line) or (res.get('ou') or {}).get(float(line)) or {}
    over_odd = to_float(market_info.get('odd_off_over'))
    under_odd = to_float(market_info.get('odd_off_under'))
    if over_odd is None or under_odd is None:
        return None
    vig = no_vig_pair(over_odd, under_odd)
    if vig is None:
        return None
    hist = wnba_historical_total_probability(module, home, away, line, side)
    try:
        simulation = wnba_simulated_total_probability(module, row, res, home, away, line, side, lines=lines)
    except Exception:
        return None
    sim_prob = simulation['probability'] * 100.0
    vig_prob = (vig[0] if side == 'over' else vig[1]) * 100.0
    weights = WNBA_TOTAL_V1_3_WEIGHTS
    prob = (
        float(weights.get('hist', 0.30)) * hist['taxa_com_shrinkage'] * 100.0 +
        float(weights.get('sim', 0.40)) * sim_prob +
        float(weights.get('vig', 0.30)) * vig_prob
    )
    prob = max(0.0, min(99.0, prob))
    odd_valor = 100.0 / prob if prob else 0.0
    edge = (odd / odd_valor - 1.0) * 100.0 if odd_valor else 0.0
    item['probabilidade_final'] = round(prob, 2)
    item['odd_valor'] = round(odd_valor, 2)
    item['edge'] = round(edge, 2)
    debug = {
        'mercado': 'Total de Pontos',
        'linha_avaliada': line,
        'side': side,
        'prob_hist': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'prob_sim': round(sim_prob, 2),
        'prob_no_vig': round(vig_prob, 2),
        'total_modelo_pre_mercado': round(simulation['model_total_expected'], 2),
        'total_ancora_mercado': round(simulation['market_anchor_line'], 2),
        'total_calibrado': round(simulation['calibrated_total_expected'], 2),
        'media_pontos_casa': round(simulation['home_expected'], 2),
        'media_pontos_visitante': round(simulation['away_expected'], 2),
        'desvio_pontos_casa': round(simulation['home_sd'], 2),
        'desvio_pontos_visitante': round(simulation['away_sd'], 2),
        'simulacoes': simulation['simulations'],
        'media_total_simulada': round(simulation['average_total'], 2),
        'pesos_probabilidade': weights,
        'jogos_considerados': hist['jogos_considerados'],
        'pushes': hist['pushes'],
        'taxa_bruta': round(hist['taxa_bruta'] * 100.0, 2),
        'taxa_com_shrinkage': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'componentes_historicos': compact_wnba_total_components(hist.get('componentes')),
        'fallback': hist['fallback'],
        'warnings': hist['warnings'],
    }
    return item, debug


def wnba_simulated_total_probability(
    module: Any,
    row: pd.Series,
    res: dict,
    home: str,
    away: str,
    line: float,
    side: str,
    lines: list[float] | None = None,
) -> dict[str, Any]:
    expectation = wnba_calculate_expected_points(module, home, away, lines=lines)
    market_anchor = wnba_market_total_anchor(res, fallback=line)
    model_total = expectation['home_expected'] + expectation['away_expected']
    calibrated_total = (
        (1.0 - WNBA_TOTAL_MARKET_ANCHOR_WEIGHT) * model_total +
        WNBA_TOTAL_MARKET_ANCHOR_WEIGHT * market_anchor
    )
    calibration_delta = calibrated_total - model_total
    home_expected = max(0.0, expectation['home_expected'] + calibration_delta / 2.0)
    away_expected = max(0.0, expectation['away_expected'] + calibration_delta / 2.0)
    seed = (
        f"{row.get('date')}|{row.get('time')}|{home}|{away}|"
        f"{line}|{side}|{round(home_expected, 3)}|{round(away_expected, 3)}"
    )
    simulation = run_wnba_total_monte_carlo(
        home_expected,
        away_expected,
        expectation['home_sd'],
        expectation['away_sd'],
        line,
        side,
        simulations=WNBA_TOTAL_SIMULATIONS,
        seed=seed,
    )
    simulation.update(
        {
            'home_expected': home_expected,
            'away_expected': away_expected,
            'home_sd': expectation['home_sd'],
            'away_sd': expectation['away_sd'],
            'model_total_expected': model_total,
            'market_anchor_line': market_anchor,
            'calibrated_total_expected': calibrated_total,
        }
    )
    return simulation


def wnba_calculate_expected_points(module: Any, home: str, away: str, lines: list[float] | None = None) -> dict[str, float]:
    metric_lines = lines or []
    home_metrics = module.calcular_metricas_time(home, 'casa', metric_lines)
    away_metrics = module.calcular_metricas_time(away, 'fora', metric_lines)
    home_scored = require_float_metric(home_metrics, 'media_tm', f'{home} media_tm')
    home_allowed = require_float_metric(home_metrics, 'media_opp', f'{home} media_opp')
    away_scored = require_float_metric(away_metrics, 'media_tm', f'{away} media_tm')
    away_allowed = require_float_metric(away_metrics, 'media_opp', f'{away} media_opp')
    home_scored_sd = require_float_metric(home_metrics, 'std_tm', f'{home} std_tm')
    home_allowed_sd = require_float_metric(home_metrics, 'std_opp', f'{home} std_opp')
    away_scored_sd = require_float_metric(away_metrics, 'std_tm', f'{away} std_tm')
    away_allowed_sd = require_float_metric(away_metrics, 'std_opp', f'{away} std_opp')

    home_expected = max(0.0, home_scored * 0.55 + away_allowed * 0.45)
    away_expected = max(0.0, away_scored * 0.55 + home_allowed * 0.45)
    home_sd = max(
        WNBA_TOTAL_MIN_TEAM_SD,
        math.sqrt((home_scored_sd * 0.55) ** 2 + (away_allowed_sd * 0.45) ** 2),
    )
    away_sd = max(
        WNBA_TOTAL_MIN_TEAM_SD,
        math.sqrt((away_scored_sd * 0.55) ** 2 + (home_allowed_sd * 0.45) ** 2),
    )
    return {
        'home_expected': home_expected,
        'away_expected': away_expected,
        'home_sd': home_sd,
        'away_sd': away_sd,
    }


def require_float_metric(metrics: dict[str, Any], key: str, label: str) -> float:
    value = to_float(metrics.get(key) if isinstance(metrics, dict) else None)
    if value is None:
        raise ValueError(f'Metrica WNBA ausente para Total de Pontos: {label}')
    return value


def wnba_market_total_anchor(res: dict, fallback: float) -> float:
    best_line = fallback
    best_distance = float('inf')
    for raw_line, values in (res.get('ou') or {}).items():
        line = to_float(raw_line)
        if line is None and isinstance(values, dict):
            line = to_float(values.get('linha'))
        if line is None:
            continue
        over_odd = to_float((values or {}).get('odd_off_over') if isinstance(values, dict) else None)
        under_odd = to_float((values or {}).get('odd_off_under') if isinstance(values, dict) else None)
        if over_odd is None or under_odd is None:
            continue
        vig = no_vig_pair(over_odd, under_odd)
        if vig is None:
            continue
        distance = abs(vig[0] - 0.5)
        if distance < best_distance:
            best_distance = distance
            best_line = line
    return float(best_line)


def run_wnba_total_monte_carlo(
    home_mean: float,
    away_mean: float,
    home_sd: float,
    away_sd: float,
    line: float,
    side: str,
    simulations: int,
    seed: str,
) -> dict[str, Any]:
    if simulations <= 0:
        raise ValueError('simulations must be positive')
    rng = random.Random(seed)
    wins = 0
    pushes = 0
    total_sum = 0.0
    normalized_side = normalize_text(side)
    for _ in range(simulations):
        home_points = max(0.0, rng.normalvariate(home_mean, home_sd))
        away_points = max(0.0, rng.normalvariate(away_mean, away_sd))
        total_points = home_points + away_points
        total_sum += total_points
        if math.isclose(total_points, line, abs_tol=1e-9):
            pushes += 1
            continue
        if normalized_side == 'over' and total_points > line:
            wins += 1
        elif normalized_side == 'under' and total_points < line:
            wins += 1
    decisions = simulations - pushes
    probability = wins / decisions if decisions else WNBA_TOTAL_PRIOR
    return {
        'probability': max(0.0, min(1.0, probability)),
        'simulations': simulations,
        'wins': wins,
        'pushes': pushes,
        'decisions': decisions,
        'average_total': total_sum / simulations,
    }


def wnba_simulate_matchup(
    module: Any,
    row: pd.Series,
    res: dict,
    home: str,
    away: str,
    handicap_line: float | None = None,
    handicap_side: str | None = None,
    lines: list[float] | None = None,
) -> dict[str, Any]:
    expectation = wnba_calculate_expected_points(module, home, away, lines=lines)
    market_anchor = wnba_market_total_anchor(res, fallback=expectation['home_expected'] + expectation['away_expected'])
    model_total = expectation['home_expected'] + expectation['away_expected']
    calibrated_total = (
        (1.0 - WNBA_TOTAL_MARKET_ANCHOR_WEIGHT) * model_total +
        WNBA_TOTAL_MARKET_ANCHOR_WEIGHT * market_anchor
    )
    calibration_delta = calibrated_total - model_total
    home_expected = max(0.0, expectation['home_expected'] + calibration_delta / 2.0)
    away_expected = max(0.0, expectation['away_expected'] + calibration_delta / 2.0)
    seed = (
        f"{row.get('date')}|{row.get('time')}|{home}|{away}|"
        f"{handicap_line}|{handicap_side}|{round(home_expected, 3)}|{round(away_expected, 3)}"
    )
    rng = random.Random(seed)
    home_wins = 0
    away_wins = 0
    handicap_wins = 0
    handicap_pushes = 0
    margin_sum = 0.0
    total_sum = 0.0
    for _ in range(WNBA_TOTAL_SIMULATIONS):
        home_points = max(0.0, rng.normalvariate(home_expected, expectation['home_sd']))
        away_points = max(0.0, rng.normalvariate(away_expected, expectation['away_sd']))
        margin = home_points - away_points
        margin_sum += margin
        total_sum += home_points + away_points
        if margin > 0:
            home_wins += 1
        elif margin < 0:
            away_wins += 1
        else:
            home_wins += 0.5
            away_wins += 0.5
        if handicap_line is not None and handicap_side in {'home', 'away'}:
            selected_margin = margin if handicap_side == 'home' else -margin
            adjusted = selected_margin + handicap_line
            if math.isclose(adjusted, 0.0, abs_tol=1e-9):
                handicap_pushes += 1
            elif adjusted > 0:
                handicap_wins += 1
    handicap_decisions = WNBA_TOTAL_SIMULATIONS - handicap_pushes
    return {
        'home_win_probability': home_wins / WNBA_TOTAL_SIMULATIONS,
        'away_win_probability': away_wins / WNBA_TOTAL_SIMULATIONS,
        'handicap_cover_probability': handicap_wins / handicap_decisions if handicap_decisions else WNBA_TOTAL_PRIOR,
        'simulations': WNBA_TOTAL_SIMULATIONS,
        'home_wins': home_wins,
        'away_wins': away_wins,
        'handicap_wins': handicap_wins,
        'handicap_pushes': handicap_pushes,
        'average_margin': margin_sum / WNBA_TOTAL_SIMULATIONS,
        'average_total': total_sum / WNBA_TOTAL_SIMULATIONS,
        'home_expected': home_expected,
        'away_expected': away_expected,
        'home_sd': expectation['home_sd'],
        'away_sd': expectation['away_sd'],
        'model_total_expected': model_total,
        'market_anchor_line': market_anchor,
        'calibrated_total_expected': calibrated_total,
    }


def identify_wnba_pick_side(item: dict[str, Any], home: str, away: str) -> str | None:
    pick_norm = normalize_text(item.get('pick'))
    home_name = normalize_text(item.get('mandante') or home)
    away_name = normalize_text(item.get('visitante') or away)
    home_code = normalize_text(home)
    away_code = normalize_text(away)
    if home_name and (home_name in pick_norm or pick_norm in home_name):
        return 'home'
    if away_name and (away_name in pick_norm or pick_norm in away_name):
        return 'away'
    if home_code and home_code in pick_norm:
        return 'home'
    if away_code and away_code in pick_norm:
        return 'away'
    return None


def wnba_historical_moneyline_probability(module: Any, home: str, away: str, pick_side: str) -> dict[str, Any]:
    home_component = wnba_team_win_component_probability(module, home, 'casa', win=True if pick_side == 'home' else False)
    away_component = wnba_team_win_component_probability(module, away, 'fora', win=True if pick_side == 'away' else False)
    return combine_wnba_binary_components(home_component, away_component)


def wnba_team_win_component_probability(module: Any, team: str, local: str, win: bool) -> dict[str, Any]:
    current, previous = wnba_operational_seasons(datetime(WNBA_CURRENT_SEASON_YEAR, 1, 1))
    current_all = wnba_load_team_dataframe(module, team, current, local=None)
    base_weights = wnba_get_season_weights(module, len(current_all))
    period_frames = {
        'passada': wnba_load_team_dataframe(module, team, previous, local=local),
        'atual': wnba_load_team_dataframe(module, team, current, local=local),
        'recente': current_all.tail(10).copy() if current_all is not None and not getattr(current_all, 'empty', True) else pd.DataFrame(),
    }
    return wnba_binary_rate_by_period(period_frames, base_weights, lambda row: wnba_row_is_win(row) is win)


def wnba_historical_handicap_probability(module: Any, home: str, away: str, pick_side: str, line: float) -> dict[str, Any]:
    if pick_side == 'home':
        home_component = wnba_team_handicap_component_probability(module, home, 'casa', line)
        away_component = wnba_team_handicap_component_probability(module, away, 'fora', -line, invert=True)
    else:
        home_component = wnba_team_handicap_component_probability(module, home, 'casa', -line, invert=True)
        away_component = wnba_team_handicap_component_probability(module, away, 'fora', line)
    return combine_wnba_binary_components(home_component, away_component)


def wnba_team_handicap_component_probability(module: Any, team: str, local: str, line: float, invert: bool = False) -> dict[str, Any]:
    current, previous = wnba_operational_seasons(datetime(WNBA_CURRENT_SEASON_YEAR, 1, 1))
    current_all = wnba_load_team_dataframe(module, team, current, local=None)
    base_weights = wnba_get_season_weights(module, len(current_all))
    period_frames = {
        'passada': wnba_load_team_dataframe(module, team, previous, local=local),
        'atual': wnba_load_team_dataframe(module, team, current, local=local),
        'recente': current_all.tail(10).copy() if current_all is not None and not getattr(current_all, 'empty', True) else pd.DataFrame(),
    }

    def covers(row: Any) -> bool | None:
        team_points = first_float(row, ('pontos_time', 'PTS', 'Tm', 'R', 'Pontos'))
        opp_points = first_float(row, ('pontos_adversario', 'Opp', 'Opp.1', 'RA', 'Pontos_Adv'))
        if team_points is None or opp_points is None:
            return None
        adjusted = team_points + line - opp_points
        if math.isclose(adjusted, 0.0, abs_tol=1e-12):
            return None
        result = adjusted > 0
        return (not result) if invert else result

    return wnba_binary_rate_by_period(period_frames, base_weights, covers)


def wnba_binary_rate_by_period(period_frames: dict[str, pd.DataFrame], base_weights: dict[str, float], evaluator: Any) -> dict[str, Any]:
    available_keys = tuple(key for key, frame in period_frames.items() if frame is not None and not getattr(frame, 'empty', True) and base_weights.get(key, 0) > 0)
    if not available_keys:
        return {
            'jogos_considerados': 0,
            'wins': 0,
            'losses': 0,
            'pushes': 0,
            'taxa_bruta': WNBA_TOTAL_PRIOR,
            'taxa_com_shrinkage': WNBA_TOTAL_PRIOR,
            'fallback': 'FALLBACK_NEUTRO_SEM_HISTORICO',
            'warnings': ['LOW_SAMPLE', 'FALLBACK_NEUTRO_050'],
            'periodos': {},
        }
    weights = normalize_weight_subset(base_weights, available_keys)
    raw = 0.0
    shrunk = 0.0
    wins_total = 0
    losses_total = 0
    pushes_total = 0
    periodos: dict[str, Any] = {}
    warnings: list[str] = []
    for key in available_keys:
        stats = wnba_binary_rate_from_dataframe(period_frames[key], evaluator)
        periodos[key] = stats
        raw += weights[key] * stats['taxa_bruta']
        shrunk += weights[key] * stats['taxa_com_shrinkage']
        wins_total += stats['wins']
        losses_total += stats['losses']
        pushes_total += stats['pushes']
        if stats['jogos_considerados'] < WNBA_TOTAL_LOW_SAMPLE:
            warnings.append(f'LOW_SAMPLE_{key.upper()}')
    if warnings and 'LOW_SAMPLE' not in warnings:
        warnings.insert(0, 'LOW_SAMPLE')
    return {
        'jogos_considerados': wins_total + losses_total,
        'wins': wins_total,
        'losses': losses_total,
        'pushes': pushes_total,
        'taxa_bruta': raw,
        'taxa_com_shrinkage': shrunk,
        'fallback': None,
        'warnings': sorted(set(warnings)),
        'pesos_periodos': weights,
        'periodos': periodos,
    }


def wnba_binary_rate_from_dataframe(df: Any, evaluator: Any) -> dict[str, Any]:
    wins = 0
    losses = 0
    pushes = 0
    if df is not None and not getattr(df, 'empty', True):
        for _, hist_row in df.iterrows():
            result = evaluator(hist_row)
            if result is None:
                pushes += 1
                continue
            wins += 1 if result else 0
            losses += 0 if result else 1
    considered = wins + losses
    if considered == 0:
        return {
            'jogos_considerados': 0,
            'wins': wins,
            'losses': losses,
            'pushes': pushes,
            'taxa_bruta': WNBA_TOTAL_PRIOR,
            'taxa_com_shrinkage': WNBA_TOTAL_PRIOR,
            'fallback': 'FALLBACK_NEUTRO_SEM_HISTORICO_PERIODO',
        }
    raw = wins / considered
    return {
        'jogos_considerados': considered,
        'wins': wins,
        'losses': losses,
        'pushes': pushes,
        'taxa_bruta': raw,
        'taxa_com_shrinkage': apply_probability_shrinkage(raw, considered, WNBA_TOTAL_PRIOR, WNBA_TOTAL_PRIOR_STRENGTH),
        'fallback': None,
    }


def combine_wnba_binary_components(*components: dict[str, Any]) -> dict[str, Any]:
    valid_components = [item for item in components if item.get('jogos_considerados', 0) > 0]
    if not valid_components:
        return {
            'jogos_considerados': 0,
            'wins': 0,
            'losses': 0,
            'pushes': sum(int(item.get('pushes') or 0) for item in components),
            'taxa_bruta': WNBA_TOTAL_PRIOR,
            'taxa_com_shrinkage': WNBA_TOTAL_PRIOR,
            'fallback': 'FALLBACK_NEUTRO_SEM_HISTORICO',
            'warnings': ['LOW_SAMPLE', 'FALLBACK_NEUTRO_050'],
            'componentes': components,
        }
    considered = sum(int(item.get('jogos_considerados') or 0) for item in valid_components)
    warnings = sorted({warning for item in valid_components for warning in item.get('warnings', [])})
    if considered < WNBA_TOTAL_LOW_SAMPLE * len(valid_components):
        warnings.append('LOW_SAMPLE_COMBINADO')
    if any(str(warning).startswith('LOW_SAMPLE') for warning in warnings) and 'LOW_SAMPLE' not in warnings:
        warnings.insert(0, 'LOW_SAMPLE')
    return {
        'jogos_considerados': considered,
        'wins': sum(int(item.get('wins') or 0) for item in valid_components),
        'losses': sum(int(item.get('losses') or 0) for item in valid_components),
        'pushes': sum(int(item.get('pushes') or 0) for item in valid_components),
        'taxa_bruta': sum(float(item.get('taxa_bruta') or 0.0) for item in valid_components) / len(valid_components),
        'taxa_com_shrinkage': sum(float(item.get('taxa_com_shrinkage') or 0.0) for item in valid_components) / len(valid_components),
        'fallback': None,
        'warnings': warnings,
        'componentes': components,
    }


def wnba_row_is_win(row: Any) -> bool | None:
    result_text = str(get_row_value(row, ('resultado', 'Rslt', 'W/L', 'Unnamed: 4')) or '').strip().upper()
    if result_text.startswith('W'):
        return True
    if result_text.startswith('L'):
        return False
    team_points = first_float(row, ('pontos_time', 'PTS', 'Tm', 'R', 'Pontos'))
    opp_points = first_float(row, ('pontos_adversario', 'Opp', 'Opp.1', 'RA', 'Pontos_Adv'))
    if team_points is None or opp_points is None or math.isclose(team_points, opp_points, abs_tol=1e-12):
        return None
    return team_points > opp_points


def wnba_handicap_no_vig_probability(res: dict, pick_side: str, line: float) -> float | None:
    home_odd = None
    away_odd = None
    for (side, handicap), values in (res.get('hc') or {}).items():
        h = to_float(handicap)
        odd = to_float((values or {}).get('odd_off') if isinstance(values, dict) else None)
        if h is None or odd is None:
            continue
        side_norm = normalize_text(side)
        if side_norm in {'home', 'casa'} and math.isclose(h, line if pick_side == 'home' else -line, abs_tol=1e-9):
            home_odd = odd
        if side_norm in {'away', 'fora'} and math.isclose(h, line if pick_side == 'away' else -line, abs_tol=1e-9):
            away_odd = odd
    if home_odd is None or away_odd is None:
        return None
    vig = no_vig_pair(home_odd, away_odd)
    if vig is None:
        return None
    return vig[0] if pick_side == 'home' else vig[1]


def wnba_historical_total_probability(module: Any, home: str, away: str, line: float, side: str) -> dict[str, Any]:
    home_component = wnba_team_total_component_probability(module, home, 'casa', line, side)
    away_component = wnba_team_total_component_probability(module, away, 'fora', line, side)
    components = {'home': home_component, 'away': away_component}
    valid_components = [item for item in components.values() if item['jogos_considerados'] > 0]

    if not valid_components:
        return {
            'jogos_considerados': 0,
            'pushes': home_component['pushes'] + away_component['pushes'],
            'taxa_bruta': WNBA_TOTAL_PRIOR,
            'taxa_com_shrinkage': WNBA_TOTAL_PRIOR,
            'fallback': 'FALLBACK_NEUTRO_SEM_HISTORICO',
            'warnings': ['LOW_SAMPLE', 'FALLBACK_NEUTRO_050'],
            'componentes': components,
        }

    combined_raw = sum(item['taxa_bruta'] for item in valid_components) / len(valid_components)
    combined_shrunk = sum(item['taxa_com_shrinkage'] for item in valid_components) / len(valid_components)
    considered = sum(item['jogos_considerados'] for item in valid_components)
    pushes = sum(item['pushes'] for item in valid_components)
    warnings = sorted({warning for item in valid_components for warning in item.get('warnings', [])})
    if considered < WNBA_TOTAL_LOW_SAMPLE * len(valid_components):
        warnings.append('LOW_SAMPLE_COMBINADO')
    if any(str(warning).startswith('LOW_SAMPLE') for warning in warnings) and 'LOW_SAMPLE' not in warnings:
        warnings.insert(0, 'LOW_SAMPLE')

    return {
        'jogos_considerados': considered,
        'pushes': pushes,
        'taxa_bruta': combined_raw,
        'taxa_com_shrinkage': combined_shrunk,
        'fallback': None,
        'warnings': warnings,
        'componentes': components,
    }


def wnba_team_total_component_probability(module: Any, team: str, local: str, line: float, side: str) -> dict[str, Any]:
    current, previous = wnba_operational_seasons(datetime(WNBA_CURRENT_SEASON_YEAR, 1, 1))
    current_all = wnba_load_team_dataframe(module, team, current, local=None)
    base_weights = wnba_get_season_weights(module, len(current_all))
    period_frames = {
        'passada': wnba_load_team_dataframe(module, team, previous, local=local),
        'atual': wnba_load_team_dataframe(module, team, current, local=local),
        'recente': current_all.tail(10).copy() if current_all is not None and not getattr(current_all, 'empty', True) else pd.DataFrame(),
    }
    available_keys = tuple(key for key, frame in period_frames.items() if frame is not None and not getattr(frame, 'empty', True) and base_weights.get(key, 0) > 0)
    if not available_keys:
        return {
            'jogos_considerados': 0,
            'pushes': 0,
            'taxa_bruta': WNBA_TOTAL_PRIOR,
            'taxa_com_shrinkage': WNBA_TOTAL_PRIOR,
            'fallback': 'FALLBACK_NEUTRO_SEM_HISTORICO_TIME',
            'warnings': ['LOW_SAMPLE', 'FALLBACK_NEUTRO_050'],
            'periodos': {},
        }

    weights = normalize_weight_subset(base_weights, available_keys)
    periodos: dict[str, dict[str, Any]] = {}
    raw = 0.0
    shrunk = 0.0
    considered_total = 0
    pushes_total = 0
    warnings: list[str] = []

    for key in available_keys:
        stats = wnba_total_rate_from_dataframe(period_frames[key], line, side)
        periodos[key] = stats
        raw += weights[key] * stats['taxa_bruta']
        shrunk += weights[key] * stats['taxa_com_shrinkage']
        considered_total += stats['jogos_considerados']
        pushes_total += stats['pushes']
        if stats['jogos_considerados'] < WNBA_TOTAL_LOW_SAMPLE:
            warnings.append(f'LOW_SAMPLE_{key.upper()}')

    if warnings and 'LOW_SAMPLE' not in warnings:
        warnings.insert(0, 'LOW_SAMPLE')

    return {
        'jogos_considerados': considered_total,
        'pushes': pushes_total,
        'taxa_bruta': raw,
        'taxa_com_shrinkage': shrunk,
        'fallback': None,
        'warnings': sorted(set(warnings)),
        'pesos_periodos': weights,
        'periodos': periodos,
    }


def compact_wnba_total_components(components: Any) -> dict[str, Any]:
    if not isinstance(components, dict):
        return {}
    compact: dict[str, Any] = {}
    for side_name, component in components.items():
        if not isinstance(component, dict):
            continue
        compact[side_name] = {
            'jogos': component.get('jogos_considerados'),
            'raw': round(float(component.get('taxa_bruta') or 0.0) * 100.0, 2),
            'shrunk': round(float(component.get('taxa_com_shrinkage') or 0.0) * 100.0, 2),
            'pesos': component.get('pesos_periodos'),
            'warnings': component.get('warnings'),
        }
    return compact


def wnba_total_rate_from_dataframe(df: Any, line: float, side: str) -> dict[str, Any]:
    hits = 0
    misses = 0
    pushes = 0
    if df is not None and not getattr(df, 'empty', True):
        for _, hist_row in df.iterrows():
            total = basketball_points_total(hist_row)
            if total is None:
                continue
            if math.isclose(total, line, abs_tol=1e-12):
                pushes += 1
                continue
            hit = total > line if side == 'over' else total < line
            hits += 1 if hit else 0
            misses += 0 if hit else 1

    considered = hits + misses
    if considered == 0:
        return {
            'jogos_considerados': 0,
            'pushes': pushes,
            'taxa_bruta': WNBA_TOTAL_PRIOR,
            'taxa_com_shrinkage': WNBA_TOTAL_PRIOR,
            'fallback': 'FALLBACK_NEUTRO_SEM_HISTORICO_PERIODO',
        }

    raw = hits / considered
    return {
        'jogos_considerados': considered,
        'pushes': pushes,
        'taxa_bruta': raw,
        'taxa_com_shrinkage': apply_probability_shrinkage(raw, considered, WNBA_TOTAL_PRIOR, WNBA_TOTAL_PRIOR_STRENGTH),
        'fallback': None,
    }


def apply_probability_shrinkage(prob_observed: float, n: int, prior: float = WNBA_TOTAL_PRIOR, prior_strength: float = WNBA_TOTAL_PRIOR_STRENGTH) -> float:
    if n <= 0:
        return prior
    return ((n * prob_observed) + (prior_strength * prior)) / (n + prior_strength)


def wnba_load_team_dataframe(module: Any, team: str, season: str, local: str | None) -> pd.DataFrame:
    try:
        df = module.carregar_dados_time(team, season, local=local, filtrar_ot=False)
    except TypeError:
        df = module.carregar_dados_time(team, season, local=local)
    except Exception:
        return pd.DataFrame()
    if df is None or getattr(df, 'empty', True):
        return pd.DataFrame()
    return df


def wnba_get_season_weights(module: Any, current_games: int) -> dict[str, float]:
    try:
        weights = module.get_pesos_temporada_wnba(current_games)
    except Exception:
        weights = {'passada': 0.35, 'atual': 0.40, 'recente': 0.25}
    return {str(key): float(value) for key, value in dict(weights).items()}


def normalize_weight_subset(weights: dict[str, float], keys: tuple[str, ...]) -> dict[str, float]:
    total = sum(float(weights.get(key, 0.0)) for key in keys)
    if total <= 0:
        return {key: 1.0 / len(keys) for key in keys}
    return {key: float(weights.get(key, 0.0)) / total for key in keys}


def basketball_points_total(row: Any) -> float | None:
    team = first_float(row, ('pontos_time', 'PTS', 'Tm', 'R', 'Pontos'))
    opp = first_float(row, ('pontos_adversario', 'Opp', 'Opp.1', 'RA', 'Pontos_Adv'))
    if team is None or opp is None:
        return None
    return team + opp


def first_float(row: Any, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        try:
            if key in row:
                value = to_float(row.get(key))
                if value is not None:
                    return value
        except Exception:
            continue
    return None


def get_row_value(row: Any, keys: tuple[str, ...]) -> Any:
    for key in keys:
        try:
            if key in row:
                return row.get(key)
        except Exception:
            continue
    return None


def no_vig_pair(odd_a: float, odd_b: float) -> tuple[float, float] | None:
    if odd_a <= 1 or odd_b <= 1:
        return None
    inv_a = 1.0 / odd_a
    inv_b = 1.0 / odd_b
    total = inv_a + inv_b
    if total <= 0:
        return None
    return inv_a / total, inv_b / total


def mark_wnba_discard(item: dict[str, Any], reason: str, keep: bool = False) -> dict[str, Any] | None:
    item['wnba_v1_1_discard_reason'] = reason
    item['observacoes'] = append_wnba_debug(item.get('observacoes'), {'discard_reason': reason}, [reason])
    return item if keep else None


def append_wnba_debug(observacao: Any, debug: dict[str, Any], reasons: list[str] | None = None) -> str:
    base = str(observacao or '').strip()
    parts = [base] if base else []
    reason_text = ','.join(reasons or [])
    debug_items = [f"{key}={value}" for key, value in debug.items() if value not in (None, '', [])]
    if reason_text:
        debug_items.append(f"motivos={reason_text}")
    if debug_items:
        parts.append("WNBA V1.1: " + "; ".join(debug_items))
    return " | ".join(parts)


def enrich_wnba_observacoes(row: dict[str, Any], league: str) -> str | None:
    obs = row.get('observacoes')
    if league == 'WNBA' and BASKETBALL_WNBA_MODEL_VERSION not in str(obs or ''):
        return append_wnba_debug(obs, {'modelo_versao': BASKETBALL_WNBA_MODEL_VERSION}, [])
    return obs or None


def enrich_wnba_context(context: Any, row: dict[str, Any], league: str) -> str | None:
    text = str(context or '').strip()
    if league != 'WNBA':
        return text or None
    header = f"Modelo: {BASKETBALL_WNBA_MODEL_VERSION}"
    if header in text:
        return text
    return f"{header}\n{text}".strip()


def normalize_rows(rows: list[dict[str, Any]], league: str) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        odd = to_float(row.get('odd_ofertada')) or 0
        prob = to_float(row.get('probabilidade_final')) or 0
        edge = to_float(row.get('edge')) or 0
        normalized.append({
            'data': str(row.get('data') or ''),
            'hora': str(row.get('hora') or '') or None,
            'esporte': 'Basketball',
            'liga': str(row.get('liga') or league),
            'jogo': str(row.get('jogo') or ''),
            'mandante': str(row.get('mandante') or '') or None,
            'visitante': str(row.get('visitante') or '') or None,
            'mercado': str(row.get('mercado') or ''),
            'pick': str(row.get('pick') or ''),
            'linha': None if row.get('linha') in (None, '') else str(row.get('linha')),
            'odd': odd,
            'odd_ofertada': odd,
            'odd_valor': to_float(row.get('odd_valor')) or 0,
            'probabilidade': prob,
            'probabilidade_final': prob,
            'edge': edge,
            'stake': row.get('stake') or stake_sugerida(prob, edge),
            'observacoes': enrich_wnba_observacoes(row, league),
            'dados_tecnicos': enrich_wnba_context(row.get('dados_tecnicos'), row, league),
            'contexto_adicional': enrich_wnba_context(row.get('contexto_modelo') or row.get('dados_tecnicos'), row, league),
            'contexto_modelo': enrich_wnba_context(row.get('contexto_modelo') or row.get('dados_tecnicos'), row, league),
            'parecer_validacao': row.get('parecer_validacao') or build_parecer(row),
        })
    normalized.sort(key=lambda r: (r['data'], r['hora'] or '', r['jogo'], r['mercado'], -float(r['edge'] or 0)))
    return normalized


def write_output_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = ['data','hora','esporte','liga','jogo','mandante','visitante','mercado','pick','linha','odd','odd_ofertada','odd_valor','probabilidade','probabilidade_final','edge','stake','observacoes','dados_tecnicos','contexto_adicional','parecer_validacao']
    with path.open('w', encoding='utf-8-sig', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)


def empty_result(league: str, output_path: Path, message: str) -> dict[str, Any]:
    return {'ok': True, 'modelo': f'Basketball {league}', 'arquivo_saida': str(output_path), 'arquivo_contexto': None, 'total_prognosticos': 0, 'contexto_modelo': message, 'dados_tecnicos': message, 'mensagem': message, 'prognosticos': []}


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(clean_json(payload), ensure_ascii=False))


def clean_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: clean_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_json(v) for v in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if pd.isna(value) if not isinstance(value, (dict, list, tuple, str, bytes)) else False:
        return None
    return value


def set_best(row: dict[str, Any], key: str, odd: float) -> None:
    current = to_float(row.get(key))
    if current is None or odd > current:
        row[key] = odd


def max_odd(current: Any, odd: float) -> float:
    current_float = to_float(current)
    return odd if current_float is None or odd > current_float else current_float


def clean(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, float) and math.isnan(value):
        return ''
    return str(value).strip()


def normalize_text(value: Any) -> str:
    import unicodedata
    text = clean(value)
    text = unicodedata.normalize('NFD', text).encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]+', '', text.lower())


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, str) and not value.strip():
            return None
        out = float(str(value).replace(',', '.'))
        return out if math.isfinite(out) else None
    except Exception:
        return None


def format_line_key(value: float) -> str:
    return f'{float(value):.1f}'.replace('.', '_')


def normalize_date_for_model(value: Any) -> str:
    text = clean(value)
    dt = pd.to_datetime(text, errors='coerce', dayfirst=True)
    if pd.notna(dt):
        return dt.strftime('%Y-%m-%d')
    return text


def format_date_for_app(value: Any) -> str:
    dt = pd.to_datetime(value, errors='coerce', dayfirst=False)
    if pd.notna(dt):
        return dt.strftime('%d/%m/%Y')
    return clean(value)


def normalize_time(value: Any) -> str:
    text = clean(value)
    m = re.search(r'(\d{1,2}:\d{2})', text)
    return m.group(1) if m else text


def stake_sugerida(prob: float | None, edge: float | None) -> str:
    prob = prob or 0
    edge = edge or 0
    if prob >= 65 and edge >= 8:
        return '1.5u'
    if prob >= 60 and edge >= 4:
        return '1.0u'
    return '0.5u'


def build_parecer(row: dict[str, Any]) -> str:
    return f"EV+ pelo modelo Basketball: probabilidade {to_float(row.get('probabilidade_final')) or 0:.2f}%, odd valor {to_float(row.get('odd_valor')) or 0:.2f}, odd ofertada {to_float(row.get('odd_ofertada')) or 0:.2f}, edge {to_float(row.get('edge')) or 0:.2f}%."


def observacoes(module: Any, res: dict, home: str, away: str) -> str:
    return (
        f"RPI {home} {res.get('rpi_c', 0):.3f} x {away} {res.get('rpi_f', 0):.3f}; "
        f"Delta RPI {res.get('delta_rpi', 0):+.3f}; "
        f"Sim Win% {home} {res.get('win_c', 0):.1f}% x {away} {res.get('win_f', 0):.1f}%; "
        f"Delta pontos {res.get('delta_pontos', 0):+.2f}; "
        f"ORtg {home} {res.get('ortg_c', 0):.2f} x {away} {res.get('ortg_f', 0):.2f}; "
        f"DRtg {home} {res.get('drtg_c', 0):.2f} x {away} {res.get('drtg_f', 0):.2f}; "
        f"Pace {home} {res.get('pace_c', 0):.2f} x {away} {res.get('pace_f', 0):.2f}; "
        f"NetRtg {home} {res.get('net_c', 0):.2f} x {away} {res.get('net_f', 0):.2f}; "
        f"Delta NetRtg {res.get('delta_netrtg', 0):+.2f}"
    )


if __name__ == '__main__':
    main()
