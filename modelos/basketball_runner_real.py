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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from modelos.market_contract import standardize_prediction_rows

BASE_DIR = Path('/home/ubuntu/asp-scraper-api')
JUPYTER_DIR = Path('/home/ubuntu/jupyter')
NOTEBOOKS = {
    'NBA': JUPYTER_DIR / 'prognosticos_basketball_nba.ipynb',
    'WNBA': JUPYTER_DIR / 'prognosticos_basketball_wnba.ipynb',
}
MODEL_NAMES = {
    'NBA': 'ASP Court',
    'WNBA': 'ASP Court W',
}

MIN_ODD_EXPORT = 1.25
MAX_ODD_EXPORT = 2.00
BASKETBALL_WNBA_MODEL_VERSION = "BASKETBALL_WNBA_V2_2_ROBUST_GATES"
BASKETBALL_WNBA_HANDICAP_MODEL_VERSION = BASKETBALL_WNBA_MODEL_VERSION
WNBA_CURRENT_SEASON_YEAR = datetime.now().year
WNBA_PREVIOUS_SEASON_YEAR = WNBA_CURRENT_SEASON_YEAR - 1
WNBA_TOTAL_PRIOR = 0.50
WNBA_TOTAL_PRIOR_STRENGTH = 10.0
WNBA_TOTAL_LOW_SAMPLE = 10
WNBA_OVERCONFIDENCE_CUTOFF = 70.0
WNBA_HANDICAP_ENABLED_V1_1 = False
WNBA_HANDICAP_ENABLED_V1_7 = True
WNBA_TOTAL_BLEND_WEIGHTS = {"hist": 0.40, "sim": 0.45, "vig": 0.15}
WNBA_MONEYLINE_BLEND_WEIGHTS = {"hist": 0.40, "sim": 0.45, "vig": 0.15}
WNBA_HANDICAP_BLEND_WEIGHTS = {"hist": 0.40, "sim": 0.45, "vig": 0.15}
WNBA_TOTAL_SIMULATIONS = 10_000
WNBA_TOTAL_MARKET_ANCHOR_WEIGHT = 0.15
WNBA_HANDICAP_MARKET_ANCHOR_WEIGHT = 0.15
WNBA_COMPONENT_DISAGREEMENT_THRESHOLD = 0.15
WNBA_COMPONENT_DISAGREEMENT_STRENGTH = 0.25
WNBA_COMPONENT_DISAGREEMENT_MAX_HAIRCUT = 0.05
WNBA_STRONG_MARKET_CONFLICT_THRESHOLD = 0.20
WNBA_TOTAL_MIN_TEAM_SD = 8.0
WNBA_MAX_DATA_AGE_DAYS = 14
WNBA_MIN_EDGE_BY_MARKET = {"moneyline": 2.0, "total": 3.0, "handicap": 3.0}
WNBA_MIN_HANDICAP_PROBABILITY = 54.0
WNBA_MAX_CORRELATED_LINES = 3
WNBA_KELLY_FRACTION = 0.125
WNBA_MAX_PICK_UNITS = 1.0
WNBA_MAX_MARKET_UNITS = 1.5
WNBA_MAX_GAME_UNITS = 2.0
WNBA_MAX_BEST_TO_MEDIAN_RATIO = 1.20
WNBA_LOW_SAMPLE_MIN_EDGE = 5.0
WNBA_LOW_SAMPLE_MIN_MEDIAN_EV = 1.0
WNBA_STRENGTH_MARGIN_WEIGHT = float(os.getenv('WNBA_STRENGTH_MARGIN_WEIGHT', '0.0'))
WNBA_STRENGTH_MARGIN_MAX_ADJUSTMENT = float(os.getenv('WNBA_STRENGTH_MARGIN_MAX_ADJUSTMENT', '4.0'))
WNBA_MARGIN_CALIBRATION_PATH = Path(os.getenv(
    'WNBA_MARGIN_CALIBRATION_PATH',
    Path(__file__).with_name('wnba_margin_calibration.json'),
))


def main() -> None:
    if len(sys.argv) not in (4, 5):
        emit({'ok': False, 'erro': 'Uso inválido', 'detalhe': 'python basketball_runner_real.py CSV_COLETA OUTPUT_PATH NBA|WNBA'})
        return

    csv_coleta_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    league = normalize_league(sys.argv[3])

    try:
        module = load_notebook_module(league)
        if league == 'WNBA':
            configure_wnba_data_access(module)
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
        walk_forward_rows: list[dict[str, Any]] = []

        linhas_ou = detect_ou_lines(games)
        hc_idxs = detect_hc_indexes(games)

        for _, row in games.iterrows():
            try:
                if league == 'WNBA':
                    prepare_wnba_game_context(module, row)
                res = module.analyze_game(row, linhas_ou, hc_idxs)
                home = row['home_sigla']
                away = row['away_sigla']
                if league == 'WNBA':
                    res['H2H_df'], res['H2H_stats'] = module.gerar_h2h(home, away, periodos=(module.TEMPORADA_ATUAL, module.TEMPORADA_PASSADA))
                else:
                    res['H2H_df'], res['H2H_stats'] = module.gerar_h2h(home, away, periodos=(module.PERIODO_ATUAL, module.PERIODO_PASSADO))

                context = capture_context(module, res, row, linhas_ou, hc_idxs)
                if league != 'WNBA':
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
                    walk_forward_rows.extend(res.get('_wnba_walk_forward_candidates') or [])
                else:
                    game_rows = montar_linhas_nba(module, row, res)
                for item in game_rows:
                    if league == 'WNBA':
                        active_context = build_wnba_active_technical_context(item, res, home, away, row=row)
                        technical_context = merge_wnba_technical_context(context, active_context)
                        item['dados_tecnicos'] = technical_context
                        item['contexto_modelo'] = technical_context
                    else:
                        item.setdefault('dados_tecnicos', context)
                        item.setdefault('contexto_modelo', context)
                    item.setdefault('parecer_validacao', build_parecer(item))
                    item.setdefault('odd', item.get('odd_ofertada'))
                    item.setdefault('probabilidade', item.get('probabilidade_final'))
                    item.setdefault('stake', stake_sugerida(to_float(item.get('probabilidade_final')), to_float(item.get('edge')), to_float(item.get('odd_ofertada'))))
                rows.extend(game_rows)
            except Exception as exc:  # keep other games running
                errors.append(f"{row.get('home')} vs {row.get('away')}: {exc}")

        if league == 'WNBA':
            rows = apply_wnba_exposure_caps(rows)
        rows = normalize_rows(rows, league)
        rows = standardize_prediction_rows(rows, model_name(league))
        handicap_shadow_diagnostics = None
        if league == 'WNBA':
            rows.sort(key=lambda r: (r.get('data') or '', r.get('hora') or '', r.get('jogo') or '', r.get('mercado') or '', -float(r.get('edge') or 0)))
            handicap_shadow_diagnostics = build_wnba_runtime_diagnostics(rows, errors)
        write_output_csv(output_path, rows)
        if league == 'WNBA':
            active_contexts = list(dict.fromkeys(
                str(row.get('contexto_modelo') or row.get('dados_tecnicos') or '').strip()
                for row in rows
                if str(row.get('contexto_modelo') or row.get('dados_tecnicos') or '').strip()
            ))
            contexto_modelo = '\n\n'.join(active_contexts[:20])
        else:
            contexto_modelo = '\n\n'.join(contexts[:20])
        msg = None
        if not rows:
            msg = 'Nenhuma oportunidade EV+ encontrada para os filtros atuais.'
        if errors:
            msg = (msg + ' ' if msg else '') + f"Jogos ignorados/erros: {'; '.join(errors[:5])}"

        result_payload = {
            'ok': True,
            'modelo': model_name(league),
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
            result_payload['walk_forward_rows'] = walk_forward_rows
        emit(result_payload)
    except Exception as exc:
        emit({'ok': False, 'erro': str(exc), 'detalhe': f'csv={csv_coleta_path} output={output_path} league={league}'})


def normalize_league(value: str) -> str:
    league = str(value or '').upper().strip()
    if league in {'NBA', 'WNBA'}:
        return league
    raise RuntimeError('Liga Basketball inválida. Use NBA ou WNBA.')


def model_name(league: str) -> str:
    return MODEL_NAMES[normalize_league(league)]


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
    module = types.SimpleNamespace(**ns)
    module._notebook_globals = ns
    return module


def set_notebook_runtime_value(module: Any, name: str, value: Any) -> None:
    setattr(module, name, value)
    notebook_globals = getattr(module, '_notebook_globals', None)
    if isinstance(notebook_globals, dict):
        notebook_globals[name] = value


def configure_wnba_data_access(module: Any) -> None:
    """Read the consolidated WNBA files and enforce an as-of prediction cutoff."""

    original_loader = module.carregar_dados_time
    cache: dict[tuple[str, str, str, bool, str], pd.DataFrame] = {}

    def load_team(team: str, season: str, local: str | None = None, filtrar_ot: bool = False) -> pd.DataFrame:
        cutoff = getattr(module, '_wnba_prediction_cutoff', None)
        cutoff_key = cutoff.isoformat() if isinstance(cutoff, datetime) else ''
        key = (str(team).upper(), str(season), str(local), bool(filtrar_ot), cutoff_key)
        if key in cache:
            return cache[key].copy()

        base = Path(getattr(module, 'HIST_DIR', JUPYTER_DIR / 'dados_basquete'))
        merged_path = base / 'wnba' / str(season) / 'merged' / f'dados_basquete_{str(team).lower()}.csv'
        if merged_path.exists():
            try:
                frame = normalize_wnba_merged_frame(module, module._read_csv_flex(merged_path))
            except Exception as exc:
                raise RuntimeError(f'WNBA_MERGED_READ_ERROR:{team}:{season}:{exc}') from exc
        else:
            frame = original_loader(team, season, local=None, filtrar_ot=False)

        if frame is None or getattr(frame, 'empty', True):
            cache[key] = pd.DataFrame()
            return cache[key].copy()

        frame = frame.copy()
        date_col = 'Date' if 'Date' in frame.columns else 'date' if 'date' in frame.columns else None
        if cutoff is not None and date_col:
            dates = parse_mixed_dates(frame[date_col])
            frame = frame[dates < pd.Timestamp(cutoff).normalize()].copy()
        if filtrar_ot and 'OT' in frame.columns:
            overtime = frame['OT'].fillna('').astype(str).str.strip()
            frame = frame[overtime.eq('') | overtime.str.lower().eq('nan')].copy()
        if local == 'casa' and 'Loc' in frame.columns:
            frame = frame[frame['Loc'].fillna('').astype(str).str.strip().ne('@')].copy()
        elif local == 'fora' and 'Loc' in frame.columns:
            frame = frame[frame['Loc'].fillna('').astype(str).str.strip().eq('@')].copy()
        if date_col and date_col in frame.columns:
            frame = frame.assign(_wnba_sort_date=parse_mixed_dates(frame[date_col])).sort_values('_wnba_sort_date').drop(columns='_wnba_sort_date')
        cache[key] = frame.reset_index(drop=True)
        return cache[key].copy()

    set_notebook_runtime_value(module, 'carregar_dados_time', load_team)
    module._wnba_data_access_cache = cache


def normalize_wnba_merged_frame(module: Any, raw: pd.DataFrame) -> pd.DataFrame:
    legacy = module.normalizar_schema_wnba(raw)
    required_manual = {'data', 'adversario', 'pontos_time', 'pontos_adversario'}
    if not required_manual.issubset(raw.columns):
        return legacy
    manual_source = raw[raw['data'].notna()].copy()
    if manual_source.empty:
        return legacy
    manual = pd.DataFrame(index=manual_source.index)
    manual['Date'] = parse_mixed_dates(manual_source['data'])
    local_values = manual_source['local'] if 'local' in manual_source.columns else pd.Series('', index=manual_source.index)
    result_values = manual_source['resultado'] if 'resultado' in manual_source.columns else pd.Series('', index=manual_source.index)
    manual['Loc'] = local_values.fillna('').astype(str).str.strip()
    manual['Opponent'] = manual_source['adversario'].fillna('').astype(str).str.upper().str.strip()
    manual['opp_sigla'] = manual['Opponent'].apply(lambda value: value if value in getattr(module, 'TEAMS', {}) else (module.team_name_to_sigla(value) or value))
    manual['Rslt'] = result_values.fillna('').astype(str).str.upper().str.strip()
    manual['Tm'] = pd.to_numeric(manual_source['pontos_time'], errors='coerce')
    manual['Opp'] = pd.to_numeric(manual_source['pontos_adversario'], errors='coerce')
    manual['Unnamed: 2'] = manual['Loc']
    manual['Unnamed: 4'] = manual['Rslt']
    manual['ORtg'] = merged_numeric_column(manual_source, 'off_rtg', 'ORtg')
    manual['DRtg'] = merged_numeric_column(manual_source, 'def_rtg', 'DRtg')
    manual['Pace'] = merged_numeric_column(manual_source, 'pace', 'Pace')
    manual['NetRtg'] = manual['ORtg'] - manual['DRtg']
    manual['OT'] = manual_source['OT'] if 'OT' in manual_source.columns else math.nan
    manual = manual.dropna(subset=['Date', 'Tm', 'Opp'])
    combined = pd.concat([legacy, manual], ignore_index=True)
    combined = combined.drop_duplicates(subset=['Date', 'Opponent', 'Tm', 'Opp'], keep='last')
    return combined.sort_values('Date').reset_index(drop=True)


def merged_numeric_column(frame: pd.DataFrame, primary: str, fallback: str) -> pd.Series:
    values = pd.to_numeric(frame[primary], errors='coerce') if primary in frame.columns else pd.Series(index=frame.index, dtype=float)
    if fallback in frame.columns:
        values = values.combine_first(pd.to_numeric(frame[fallback], errors='coerce'))
    return values


def parse_mixed_dates(values: Any) -> pd.Series:
    series = values if isinstance(values, pd.Series) else pd.Series(values)
    text = series.astype(str).str.strip()
    iso_mask = text.str.match(r'^\d{4}-\d{2}-\d{2}(?:[ T].*)?$')
    parsed = pd.Series(pd.NaT, index=series.index, dtype='datetime64[ns]')
    parsed.loc[iso_mask] = pd.to_datetime(text.loc[iso_mask].str.slice(0, 10), format='%Y-%m-%d', errors='coerce')
    parsed.loc[~iso_mask] = pd.to_datetime(text.loc[~iso_mask], errors='coerce', dayfirst=True)
    return parsed


def parse_single_date(value: Any) -> pd.Timestamp:
    text = clean(value)
    if re.match(r'^\d{4}-\d{2}-\d{2}(?:[ T].*)?$', text):
        return pd.to_datetime(text[:10], format='%Y-%m-%d', errors='coerce')
    return pd.to_datetime(text, errors='coerce', dayfirst=True)


def prepare_wnba_game_context(module: Any, row: pd.Series) -> None:
    game_date = parse_single_date(row.get('date'))
    if pd.isna(game_date):
        raise RuntimeError('WNBA_DATA_INVALID_GAME_DATE')
    module._wnba_prediction_cutoff = game_date.to_pydatetime()
    module._wnba_dataframe_cache = {}
    module._wnba_expected_points_cache = {}
    current, previous = wnba_operational_seasons(module._wnba_prediction_cutoff)
    set_notebook_runtime_value(module, 'TEMPORADA_ATUAL', current)
    set_notebook_runtime_value(module, 'TEMPORADA_PASSADA', previous)
    for team in (str(row.get('home_sigla') or ''), str(row.get('away_sigla') or '')):
        frame = module.carregar_dados_time(team, current, local=None, filtrar_ot=False)
        if frame.empty:
            raise RuntimeError(f'WNBA_DATA_MISSING_CURRENT_SEASON:{team}')
        date_col = 'Date' if 'Date' in frame.columns else 'date' if 'date' in frame.columns else None
        latest = parse_mixed_dates(frame[date_col]).max() if date_col else pd.NaT
        if pd.isna(latest):
            raise RuntimeError(f'WNBA_DATA_MISSING_DATES:{team}')
        age_days = (pd.Timestamp(game_date).normalize() - pd.Timestamp(latest).normalize()).days
        if age_days > WNBA_MAX_DATA_AGE_DAYS:
            raise RuntimeError(f'WNBA_DATA_STALE:{team}:{age_days}d')


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
        odd = row_offered_odd(r)
        market_odd = row_market_odd(r) or odd
        bookmaker = clean(r.get('bookmaker_melhor')) or clean(r.get('bookmaker'))
        if odd is None or odd <= 1:
            continue

        pick_norm = normalize_text(pick)
        home_norm = normalize_text(home)
        away_norm = normalize_text(away)

        if any(token in mercado for token in ('moneyline', 'homeaway', 'vencedor', 'winner')):
            if home_norm and (home_norm in pick_norm or pick_norm in home_norm):
                set_odd_columns(game, 'odds_HomeAway_FT_including_OT_1', odd, market_odd, bookmaker)
            elif away_norm and (away_norm in pick_norm or pick_norm in away_norm):
                set_odd_columns(game, 'odds_HomeAway_FT_including_OT_2', odd, market_odd, bookmaker)
            continue

        if any(token in mercado for token in ('overunder', 'over/under', 'total')) and linha is not None:
            line_key = format_line_key(linha)
            if 'over' in pick_norm:
                set_odd_columns(game, f'odds_OverUnder_FT_including_OT_{line_key}_Over', odd, market_odd, bookmaker)
            elif 'under' in pick_norm:
                set_odd_columns(game, f'odds_OverUnder_FT_including_OT_{line_key}_Under', odd, market_odd, bookmaker)
            continue

        if 'handicap' in mercado and linha is not None:
            if not is_supported_half_handicap_line(linha):
                continue
            if home_norm and (home_norm in pick_norm or pick_norm in home_norm):
                pair_key = (key, float(linha))
                pair = handicap_pairs.setdefault(
                    pair_key,
                    {'game': game, 'home_line': None, 'away_line': None, 'home_odd': None, 'away_odd': None},
                )
                pair['home_odd'] = max_odd(pair.get('home_odd'), odd)
                pair['home_market_odd'] = market_odd
                pair['home_bookmaker_melhor'] = bookmaker
                pair['home_line'] = float(linha)
            elif away_norm and (away_norm in pick_norm or pick_norm in away_norm):
                pair_key = (key, -float(linha))
                pair = handicap_pairs.setdefault(
                    pair_key,
                    {'game': game, 'home_line': None, 'away_line': None, 'home_odd': None, 'away_odd': None},
                )
                pair['away_odd'] = max_odd(pair.get('away_odd'), odd)
                pair['away_market_odd'] = market_odd
                pair['away_bookmaker_melhor'] = bookmaker
                pair['away_line'] = float(linha)

    handicap_index_by_game: dict[int, int] = {}
    for pair in handicap_pairs.values():
        if pair.get('home_odd') is None or pair.get('away_odd') is None:
            continue
        if pair.get('home_line') is None or pair.get('away_line') is None:
            continue
        game = pair['game']
        game_identity = id(game)
        idx = handicap_index_by_game.get(game_identity, 0) + 1
        handicap_index_by_game[game_identity] = idx
        home_line = float(pair['home_line'])
        away_line = float(pair['away_line'])
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_HANDICAP'] = home_line
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_1'] = pair['home_odd']
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_1_MEDIANA'] = pair.get('home_market_odd') or pair['home_odd']
        if pair.get('home_bookmaker_melhor'):
            game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_1_BOOKMAKER_MELHOR'] = pair['home_bookmaker_melhor']
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_HANDICAP'] = away_line
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_Odd'] = pair['away_odd']
        game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_Odd_MEDIANA'] = pair.get('away_market_odd') or pair['away_odd']
        if pair.get('away_bookmaker_melhor'):
            game[f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_Odd_BOOKMAKER_MELHOR'] = pair['away_bookmaker_melhor']

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
    dt = parse_single_date(games['date'].iloc[0])
    if pd.isna(dt):
        dt = datetime.now()
    if league == 'WNBA':
        current, previous = wnba_operational_seasons(dt.to_pydatetime() if hasattr(dt, 'to_pydatetime') else dt)
        set_notebook_runtime_value(module, 'TEMPORADA_ATUAL', current)
        set_notebook_runtime_value(module, 'TEMPORADA_PASSADA', previous)
    else:
        current = module.nba_season_from_date(dt.to_pydatetime() if hasattr(dt, 'to_pydatetime') else dt)
        start_year = int(str(current).split('-')[0]) - 1
        set_notebook_runtime_value(module, 'PERIODO_ATUAL', current)
        set_notebook_runtime_value(module, 'PERIODO_PASSADO', f'{start_year}-{(start_year + 1) % 100:02d}')


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
    for team, odd_key, base_col in (
        (teams[home], 'odd_ml_c', 'odds_HomeAway_FT_including_OT_1'),
        (teams[away], 'odd_ml_f', 'odds_HomeAway_FT_including_OT_2'),
    ):
        odd = to_float(res.get(odd_key))
        if odd is None:
            continue
        market_odd = market_odd_from_wide(row, base_col, odd)
        rows.append({
            **common,
            'pick': team,
            'odd_ofertada': round(odd, 2),
            'odd_mediana': round(market_odd, 3) if market_odd is not None else None,
            'odd_mercado_base': round(market_odd, 3) if market_odd is not None else None,
            'odd_melhor': round(odd, 2),
            'bookmaker_melhor': bookmaker_from_wide(row, base_col),
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
            line_float = to_float(line)
            if line_float is None:
                continue
            base_col = f'odds_OverUnder_FT_including_OT_{format_line_key(line_float)}_{side}'
            odd = to_float(values.get(f'odd_off_{side_key}'))
            odd_value = to_float(values.get(f'odd_val_{side_key}'))
            probability = to_float(values.get(f'prob_{side_key}'))
            if odd is None or odd_value is None or probability is None:
                continue
            market_odd = market_odd_from_wide(row, base_col, odd)
            rows.append({
                **common,
                'pick': f'{side} {line}',
                'linha': line,
                'odd_ofertada': round(odd, 2),
                'odd_mediana': round(market_odd, 3) if market_odd is not None else None,
                'odd_mercado_base': round(market_odd, 3) if market_odd is not None else None,
                'odd_melhor': round(odd, 2),
                'bookmaker_melhor': bookmaker_from_wide(row, base_col),
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
        market_pair = wnba_handicap_market_pair(row, 'home' if side_norm in {'home', 'casa'} else 'away', line_float)
        market_odd = market_pair[0] if market_pair else odd
        bookmaker = market_pair[2] if market_pair else ''
        rows.append({
            **common,
            'pick': f'{team} {line_float:+.1f}',
            'linha': line_float,
            'odd_ofertada': round(odd, 2),
            'odd_mediana': round(market_odd, 3) if market_odd is not None else None,
            'odd_mercado_base': round(market_odd, 3) if market_odd is not None else None,
            'odd_melhor': round(odd, 2),
            'bookmaker_melhor': bookmaker,
            'odd_valor': 0.0,
            'probabilidade_final': 0.0,
            'edge': 0.0,
        })
    return rows


def wnba_operational_seasons(value: datetime | None = None) -> tuple[str, str]:
    """Return WNBA operational seasons without leaking future bases into the model."""

    year = int(getattr(value, "year", WNBA_CURRENT_SEASON_YEAR) or WNBA_CURRENT_SEASON_YEAR)
    return str(year), str(year - 1)


def apply_wnba_v1_1_controls(module: Any, row: pd.Series, res: dict, rows: list[dict[str, Any]], lines: list[float] | None = None) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    home = str(row.get('home_sigla') or '')
    away = str(row.get('away_sigla') or '')
    for item in rows:
        adjusted = apply_wnba_v1_1_to_pick(module, row, res, dict(item), home, away, lines=lines)
        if adjusted is not None:
            selected.append(adjusted)
    return limit_wnba_correlated_lines(selected)


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

    item['_wnba_debug'] = dict(debug)
    res.setdefault('_wnba_walk_forward_candidates', []).append(
        build_wnba_walk_forward_candidate(item, debug, row, home, away)
    )

    if item.get('_strong_market_conflict'):
        return mark_wnba_discard(item, "STRONG_MARKET_CONFLICT", keep=False)

    odd = to_float(item.get('odd_ofertada'))
    prob = to_float(item.get('probabilidade_final'))
    odd_valor = to_float(item.get('odd_valor'))
    median_odd = to_float(item.get('odd_mediana'))
    if odd is None or odd <= 1:
        return mark_wnba_discard(item, "INVALID_ODD", keep=False)
    if odd_valor is None or odd_valor <= 1:
        return mark_wnba_discard(item, "NO_MARKET_BASELINE", keep=False)
    if prob is None or prob <= 0:
        return mark_wnba_discard(item, "INVALID_PROBABILITY", keep=False)
    if median_odd is not None and median_odd > 1 and odd / median_odd > WNBA_MAX_BEST_TO_MEDIAN_RATIO:
        return mark_wnba_discard(item, "SUSPICIOUS_BEST_ODD", keep=False)
    if prob >= WNBA_OVERCONFIDENCE_CUTOFF:
        return mark_wnba_discard(item, "OVERCONFIDENCE_CAP", keep=False)
    market_key = 'handicap' if 'handicap' in market else 'total' if any(token in market for token in ('overunder', 'total', 'pontos')) else 'moneyline'
    if market_key == 'handicap' and prob < WNBA_MIN_HANDICAP_PROBABILITY:
        return mark_wnba_discard(item, "LOW_HANDICAP_PROBABILITY", keep=False)
    if market_key == 'handicap' and int(item.get('_hist_games') or 0) < WNBA_TOTAL_LOW_SAMPLE:
        return mark_wnba_discard(item, "LOW_HANDICAP_HISTORY", keep=False)
    if odd <= odd_valor:
        return mark_wnba_discard(item, "NO_EV_AFTER_V1_1", keep=False)
    value_gate_reason = wnba_robust_value_gate_reason(item, market_key)
    if value_gate_reason:
        return mark_wnba_discard(item, value_gate_reason, keep=False)
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
    home_odd = market_odd_from_wide(row, 'odds_HomeAway_FT_including_OT_1', res.get('odd_ml_c'))
    away_odd = market_odd_from_wide(row, 'odds_HomeAway_FT_including_OT_2', res.get('odd_ml_f'))
    if home_odd is None or away_odd is None:
        return None
    vig = no_vig_pair(home_odd, away_odd)
    if vig is None:
        return None

    hist = wnba_historical_moneyline_probability(module, home, away, pick_side)
    simulation = wnba_simulate_matchup(module, row, res, home, away, lines=lines)
    sim_prob = simulation['home_win_probability'] if pick_side == 'home' else simulation['away_win_probability']
    vig_prob = vig[0] if pick_side == 'home' else vig[1]
    weights = WNBA_MONEYLINE_BLEND_WEIGHTS
    raw_prob = (
        float(weights.get('hist', 0.35)) * hist['taxa_com_shrinkage'] +
        float(weights.get('sim', 0.35)) * sim_prob +
        float(weights.get('vig', 0.30)) * vig_prob
    )
    raw_prob = max(0.0, min(0.99, raw_prob))
    effective_games = float(hist.get('jogos_efetivos') or hist['jogos_considerados'])
    prob, haircut = conservative_wnba_probability(raw_prob, effective_games, 'moneyline')
    odd_valor = 1.0 / prob if prob else 0.0
    edge = odd * prob - 1.0
    selected_base_col = 'odds_HomeAway_FT_including_OT_1' if pick_side == 'home' else 'odds_HomeAway_FT_including_OT_2'
    market_odd = home_odd if pick_side == 'home' else away_odd
    item['probabilidade_final'] = round(prob * 100.0, 2)
    item['probabilidade'] = round(prob * 100.0, 2)
    item['odd_valor'] = round(odd_valor, 2)
    item['edge'] = round(edge * 100.0, 2)
    item['odd_mediana'] = round(market_odd, 3)
    item['odd_mercado_base'] = round(market_odd, 3)
    item['odd_melhor'] = round(odd, 2)
    item['bookmaker_melhor'] = bookmaker_from_wide(row, selected_base_col) or item.get('bookmaker_melhor')
    item['_hist_games'] = hist['jogos_considerados']
    item['_effective_hist_games'] = effective_games
    item['_hist_warnings'] = list(hist['warnings'])
    item['_median_ev'] = (market_odd * prob - 1.0) * 100.0
    debug = {
        'mercado': 'Moneyline',
        'side': pick_side,
        'prob_hist': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'prob_sim': round(sim_prob * 100.0, 2),
        'prob_no_vig': round(vig_prob * 100.0, 2),
        'prob_bruta_blend': round(raw_prob * 100.0, 2),
        'haircut_incerteza_pp': round(haircut * 100.0, 2),
        'odd_mediana': round(market_odd, 3),
        'odd_mercado_base': round(market_odd, 3),
        'odd_melhor': round(odd, 2),
        'bookmaker_melhor': item.get('bookmaker_melhor'),
        'pesos_probabilidade': weights,
        'vitorias_reais': hist['wins'],
        'derrotas_reais': hist['losses'],
        'jogos_considerados': hist['jogos_considerados'],
        'jogos_efetivos': round(effective_games, 2),
        'ev_odd_mediana': round(item['_median_ev'], 2),
        'simulacoes': simulation['simulations'],
        'vitorias_sim_home': simulation['home_wins'],
        'vitorias_sim_away': simulation['away_wins'],
        'total_calibrado': round(simulation['calibrated_total_expected'], 2),
        'margem_placar_pre_forca': round(simulation['score_margin_expected'], 2),
        'margem_referencia_forca': round(simulation['strength_margin_reference'], 2) if simulation['strength_margin_reference'] is not None else None,
        'ajuste_margem_forca': round(simulation['strength_margin_adjustment'], 2),
        'peso_margem_forca': round(simulation['strength_margin_weight'], 4),
        'calibracao_margem_status': simulation['margin_calibration_status'],
        'calibracao_margem_intercept': simulation['margin_calibration_intercept'],
        'calibracao_margem_slope': simulation['margin_calibration_slope'],
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
    market_pair = wnba_handicap_market_pair(row, pick_side, line)
    no_vig = wnba_handicap_no_vig_probability(res, pick_side, line, row=row)
    if no_vig is None:
        return None

    hist = wnba_historical_handicap_probability(module, home, away, pick_side, line)
    simulation = wnba_simulate_matchup(module, row, res, home, away, handicap_line=line, handicap_side=pick_side, lines=lines)
    sim_prob = simulation['handicap_cover_probability']
    weights = WNBA_HANDICAP_BLEND_WEIGHTS
    components = {
        'hist': hist['taxa_com_shrinkage'],
        'sim': sim_prob,
        'vig': no_vig,
    }
    raw_prob = (
        float(weights.get('hist', 0.35)) * hist['taxa_com_shrinkage'] +
        float(weights.get('sim', 0.35)) * sim_prob +
        float(weights.get('vig', 0.30)) * no_vig
    )
    raw_prob = max(0.0, min(0.99, raw_prob))
    effective_games = float(hist.get('jogos_efetivos') or hist['jogos_considerados'])
    sample_adjusted_prob, sample_haircut = conservative_wnba_probability(raw_prob, effective_games, 'handicap')
    prob, disagreement = wnba_component_disagreement_haircut(sample_adjusted_prob, components, no_vig)
    disagreement_haircut = float(disagreement['haircut'])
    total_haircut = sample_haircut + disagreement_haircut
    strong_market_conflict = abs(sim_prob - no_vig) >= WNBA_STRONG_MARKET_CONFLICT_THRESHOLD
    odd_valor = 1.0 / prob if prob else 0.0
    edge = odd * prob - 1.0
    market_odd = market_pair[0] if market_pair else odd
    item['probabilidade_final'] = round(prob * 100.0, 2)
    item['probabilidade'] = round(prob * 100.0, 2)
    item['odd_valor'] = round(odd_valor, 2)
    item['edge'] = round(edge * 100.0, 2)
    item['odd_mediana'] = round(market_odd, 3)
    item['odd_mercado_base'] = round(market_odd, 3)
    item['odd_melhor'] = round(odd, 2)
    item['bookmaker_melhor'] = (market_pair[2] if market_pair else '') or item.get('bookmaker_melhor')
    item['_hist_games'] = hist['jogos_considerados']
    item['_effective_hist_games'] = effective_games
    item['_hist_warnings'] = list(hist['warnings'])
    item['_median_ev'] = (market_odd * prob - 1.0) * 100.0
    item['_selection_side'] = pick_side
    item['_market_anchor_line'] = wnba_handicap_anchor_for_side(row, pick_side)
    item['_strong_market_conflict'] = strong_market_conflict
    item['selection_role'] = 'RESERVA_CONFLITO_MERCADO' if strong_market_conflict else item.get('selection_role')
    item['market_conflict_status'] = 'CONFLITO_FORTE_COM_MERCADO' if strong_market_conflict else 'ALINHADO'
    item['observacoes'] = replace_wnba_legacy_margin_context(item.get('observacoes'), home, away, simulation)
    warnings = list(hist['warnings'])
    if disagreement_haircut > 0:
        warnings.append('COMPONENT_DISAGREEMENT_HAIRCUT')
    if strong_market_conflict:
        warnings.append('CONFLITO_FORTE_COM_MERCADO')
    debug = {
        'mercado': 'Handicap',
        'side': pick_side,
        'linha_avaliada': line,
        'prob_hist': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'prob_sim': round(sim_prob * 100.0, 2),
        'prob_no_vig': round(no_vig * 100.0, 2),
        'prob_bruta_blend': round(raw_prob * 100.0, 2),
        'haircut_amostra_pp': round(sample_haircut * 100.0, 2),
        'haircut_divergencia_pp': round(disagreement_haircut * 100.0, 2),
        'haircut_incerteza_pp': round(total_haircut * 100.0, 2),
        'amplitude_componentes_pp': round(float(disagreement['component_spread']) * 100.0, 2),
        'odd_mediana': round(market_odd, 3),
        'odd_mercado_base': round(market_odd, 3),
        'odd_melhor': round(odd, 2),
        'bookmaker_melhor': item.get('bookmaker_melhor'),
        'pesos_probabilidade': weights,
        'coberturas_reais': hist['wins'],
        'falhas_reais': hist['losses'],
        'pushes': hist['pushes'],
        'jogos_considerados': hist['jogos_considerados'],
        'jogos_efetivos': round(effective_games, 2),
        'ev_odd_mediana': round(item['_median_ev'], 2),
        'simulacoes': simulation['simulations'],
        'coberturas_simuladas': simulation['handicap_wins'],
        'pushes_simulados': simulation['handicap_pushes'],
        'total_calibrado': round(simulation['calibrated_total_expected'], 2),
        'pontos_esperados_casa': round(simulation['home_expected'], 2),
        'pontos_esperados_visitante': round(simulation['away_expected'], 2),
        'margem_modelo_pre_mercado': round(simulation['model_margin_expected'], 2),
        'margem_placar_pre_forca': round(simulation['score_margin_expected'], 2),
        'margem_referencia_forca': round(simulation['strength_margin_reference'], 2) if simulation['strength_margin_reference'] is not None else None,
        'ajuste_margem_forca': round(simulation['strength_margin_adjustment'], 2),
        'peso_margem_forca': round(simulation['strength_margin_weight'], 4),
        'calibracao_margem_status': simulation['margin_calibration_status'],
        'calibracao_margem_intercept': simulation['margin_calibration_intercept'],
        'calibracao_margem_slope': simulation['margin_calibration_slope'],
        'margem_ancora_mercado': round(simulation['market_margin_anchor'], 2) if simulation['market_margin_anchor'] is not None else None,
        'margem_calibrada': round(simulation['calibrated_margin_expected'], 2),
        'margem_media_simulada': round(simulation['average_margin'], 2),
        'market_conflict_status': item['market_conflict_status'],
        'selection_role': item['selection_role'],
        'warnings': warnings,
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
    line_key = format_line_key(line)
    over_col = f'odds_OverUnder_FT_including_OT_{line_key}_Over'
    under_col = f'odds_OverUnder_FT_including_OT_{line_key}_Under'
    over_odd = market_odd_from_wide(row, over_col, market_info.get('odd_off_over'))
    under_odd = market_odd_from_wide(row, under_col, market_info.get('odd_off_under'))
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
    weights = WNBA_TOTAL_BLEND_WEIGHTS
    raw_prob = (
        float(weights.get('hist', 0.30)) * hist['taxa_com_shrinkage'] * 100.0 +
        float(weights.get('sim', 0.40)) * sim_prob +
        float(weights.get('vig', 0.30)) * vig_prob
    )
    raw_prob = max(0.0, min(99.0, raw_prob))
    effective_games = float(hist.get('jogos_efetivos') or hist['jogos_considerados'])
    conservative_prob, haircut = conservative_wnba_probability(raw_prob / 100.0, effective_games, 'total')
    prob = conservative_prob * 100.0
    odd_valor = 100.0 / prob if prob else 0.0
    edge = (odd / odd_valor - 1.0) * 100.0 if odd_valor else 0.0
    selected_col = over_col if side == 'over' else under_col
    market_odd = over_odd if side == 'over' else under_odd
    item['probabilidade_final'] = round(prob, 2)
    item['odd_valor'] = round(odd_valor, 2)
    item['edge'] = round(edge, 2)
    item['odd_mediana'] = round(market_odd, 3)
    item['odd_mercado_base'] = round(market_odd, 3)
    item['odd_melhor'] = round(odd, 2)
    item['bookmaker_melhor'] = bookmaker_from_wide(row, selected_col) or item.get('bookmaker_melhor')
    item['_hist_games'] = hist['jogos_considerados']
    item['_effective_hist_games'] = effective_games
    item['_hist_warnings'] = list(hist['warnings'])
    item['_median_ev'] = (market_odd * conservative_prob - 1.0) * 100.0
    item['_selection_side'] = side
    item['_market_anchor_line'] = simulation['market_anchor_line']
    debug = {
        'mercado': 'Total de Pontos',
        'linha_avaliada': line,
        'side': side,
        'prob_hist': round(hist['taxa_com_shrinkage'] * 100.0, 2),
        'prob_sim': round(sim_prob, 2),
        'prob_no_vig': round(vig_prob, 2),
        'prob_bruta_blend': round(raw_prob, 2),
        'haircut_incerteza_pp': round(haircut * 100.0, 2),
        'odd_mediana': round(market_odd, 3),
        'odd_mercado_base': round(market_odd, 3),
        'odd_melhor': round(odd, 2),
        'bookmaker_melhor': item.get('bookmaker_melhor'),
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
        'jogos_efetivos': round(effective_games, 2),
        'ev_odd_mediana': round(item['_median_ev'], 2),
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
    market_anchor = wnba_market_total_anchor(res, fallback=line, row=row)
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
        f"{round(home_expected, 3)}|{round(away_expected, 3)}|"
        f"{round(expectation['home_sd'], 3)}|{round(expectation['away_sd'], 3)}|"
        f"{round(expectation['score_correlation'], 4)}"
    )
    simulation = run_wnba_total_monte_carlo(
        home_expected,
        away_expected,
        expectation['home_sd'],
        expectation['away_sd'],
        expectation['score_correlation'],
        line,
        side,
        simulations=WNBA_TOTAL_SIMULATIONS,
        seed=seed,
        cache=res.setdefault('_wnba_total_sim_cache', {}),
    )
    simulation.update(
        {
            'home_expected': home_expected,
            'away_expected': away_expected,
            'home_sd': expectation['home_sd'],
            'away_sd': expectation['away_sd'],
            'score_correlation': expectation['score_correlation'],
            'projected_pace': expectation['projected_pace'],
            'model_total_expected': model_total,
            'market_anchor_line': market_anchor,
            'calibrated_total_expected': calibrated_total,
        }
    )
    return simulation


def wnba_calculate_expected_points(module: Any, home: str, away: str, lines: list[float] | None = None) -> dict[str, float]:
    metric_lines = lines or []
    cache = getattr(module, '_wnba_expected_points_cache', None)
    if cache is None:
        cache = {}
        setattr(module, '_wnba_expected_points_cache', cache)
    cache_key = (
        home,
        away,
        str(getattr(module, '_wnba_prediction_cutoff', '')),
        tuple(round(float(line), 3) for line in metric_lines if to_float(line) is not None),
    )
    if cache_key in cache:
        return dict(cache[cache_key])
    home_metrics = wnba_team_metric_profile(module, home, 'casa')
    away_metrics = wnba_team_metric_profile(module, away, 'fora')
    home_scored = require_float_metric(home_metrics, 'media_tm', f'{home} media_tm')
    home_allowed = require_float_metric(home_metrics, 'media_opp', f'{home} media_opp')
    away_scored = require_float_metric(away_metrics, 'media_tm', f'{away} media_tm')
    away_allowed = require_float_metric(away_metrics, 'media_opp', f'{away} media_opp')
    home_scored_sd = require_float_metric(home_metrics, 'std_tm', f'{home} std_tm')
    home_allowed_sd = require_float_metric(home_metrics, 'std_opp', f'{home} std_opp')
    away_scored_sd = require_float_metric(away_metrics, 'std_tm', f'{away} std_tm')
    away_allowed_sd = require_float_metric(away_metrics, 'std_opp', f'{away} std_opp')

    raw_home = home_scored * 0.55 + away_allowed * 0.45
    raw_away = away_scored * 0.55 + home_allowed * 0.45
    projected_pace = average_valid(home_metrics.get('pace'), away_metrics.get('pace'))
    efficiency_home = None
    efficiency_away = None
    if projected_pace and projected_pace > 0:
        home_efficiency = weighted_valid(home_metrics.get('ortg'), away_metrics.get('drtg'), 0.55, 0.45)
        away_efficiency = weighted_valid(away_metrics.get('ortg'), home_metrics.get('drtg'), 0.55, 0.45)
        if home_efficiency is not None:
            efficiency_home = home_efficiency * projected_pace / 100.0
        if away_efficiency is not None:
            efficiency_away = away_efficiency * projected_pace / 100.0
    home_expected = max(0.0, 0.65 * raw_home + 0.35 * efficiency_home) if efficiency_home is not None else max(0.0, raw_home)
    away_expected = max(0.0, 0.65 * raw_away + 0.35 * efficiency_away) if efficiency_away is not None else max(0.0, raw_away)
    home_sd = max(
        WNBA_TOTAL_MIN_TEAM_SD,
        math.sqrt((home_scored_sd * 0.55) ** 2 + (away_allowed_sd * 0.45) ** 2),
    )
    away_sd = max(
        WNBA_TOTAL_MIN_TEAM_SD,
        math.sqrt((away_scored_sd * 0.55) ** 2 + (home_allowed_sd * 0.45) ** 2),
    )
    result = {
        'home_expected': home_expected,
        'away_expected': away_expected,
        'home_sd': home_sd,
        'away_sd': away_sd,
        'score_correlation': max(-0.25, min(0.35, average_valid(home_metrics.get('score_correlation'), away_metrics.get('score_correlation')) or 0.0)),
        'projected_pace': projected_pace or 0.0,
        'home_raw_expected': raw_home,
        'away_raw_expected': raw_away,
        'home_efficiency_expected': efficiency_home or raw_home,
        'away_efficiency_expected': efficiency_away or raw_away,
    }
    cache[cache_key] = dict(result)
    return result


def wnba_team_metric_profile(module: Any, team: str, local: str) -> dict[str, float]:
    frames, weights = wnba_non_overlapping_period_frames(module, team, local)
    period_stats: dict[str, dict[str, float]] = {}
    for period, frame in frames.items():
        if frame is None or frame.empty or weights.get(period, 0.0) <= 0:
            continue
        scored = numeric_series(frame, ('pontos_time', 'Tm', 'PTS', 'R', 'Pontos'))
        allowed = numeric_series(frame, ('pontos_adversario', 'Opp.1', 'Opp', 'RA', 'Pontos_Adv'))
        if scored.empty or allowed.empty:
            continue
        period_stats[period] = {
            'media_tm': float(scored.mean()),
            'media_opp': float(allowed.mean()),
            'std_tm': float(scored.std(ddof=1)) if len(scored) > 1 else WNBA_TOTAL_MIN_TEAM_SD,
            'std_opp': float(allowed.std(ddof=1)) if len(allowed) > 1 else WNBA_TOTAL_MIN_TEAM_SD,
            'ortg': numeric_mean(frame, ('ORtg', 'off_rtg')),
            'drtg': numeric_mean(frame, ('DRtg', 'def_rtg')),
            'pace': numeric_mean(frame, ('Pace', 'pace')),
        }
    if not period_stats:
        raise ValueError(f'Metricas WNBA ausentes para {team}')
    normalized = normalize_weight_subset(weights, tuple(period_stats))
    result: dict[str, float] = {}
    for metric in ('media_tm', 'media_opp', 'ortg', 'drtg', 'pace'):
        usable = {key: value[metric] for key, value in period_stats.items() if math.isfinite(value[metric]) and value[metric] > 0}
        metric_weights = normalize_weight_subset(normalized, tuple(usable)) if usable else {}
        result[metric] = sum(metric_weights[key] * value for key, value in usable.items()) if usable else 0.0
    for mean_key, sd_key in (('media_tm', 'std_tm'), ('media_opp', 'std_opp')):
        variance = sum(
            normalized[key] * (max(WNBA_TOTAL_MIN_TEAM_SD, stats[sd_key]) ** 2 + (stats[mean_key] - result[mean_key]) ** 2)
            for key, stats in period_stats.items()
        )
        result[sd_key] = math.sqrt(max(variance, WNBA_TOTAL_MIN_TEAM_SD ** 2))
    current_all = wnba_current_all_frame(module, team)
    scored_all = numeric_series(current_all, ('pontos_time', 'Tm', 'PTS', 'R', 'Pontos'))
    allowed_all = numeric_series(current_all, ('pontos_adversario', 'Opp.1', 'Opp', 'RA', 'Pontos_Adv'))
    paired = pd.concat([scored_all.rename('scored'), allowed_all.rename('allowed')], axis=1).dropna()
    correlation = paired['scored'].corr(paired['allowed']) if len(paired) >= 6 else 0.0
    result['score_correlation'] = float(correlation) if pd.notna(correlation) else 0.0
    return result


def wnba_current_all_frame(module: Any, team: str) -> pd.DataFrame:
    current, _ = wnba_operational_seasons(getattr(module, '_wnba_prediction_cutoff', None))
    return wnba_load_team_dataframe(module, team, current, local=None)


def wnba_non_overlapping_period_frames(module: Any, team: str, local: str) -> tuple[dict[str, pd.DataFrame], dict[str, float]]:
    current, previous = wnba_operational_seasons(getattr(module, '_wnba_prediction_cutoff', None))
    current_all = wnba_load_team_dataframe(module, team, current, local=None)
    current_local = wnba_load_team_dataframe(module, team, current, local=local)
    recent = current_all.tail(10).copy() if not current_all.empty else pd.DataFrame()
    date_col = 'Date' if 'Date' in recent.columns else 'date' if 'date' in recent.columns else None
    if date_col and not current_local.empty:
        recent_dates = set(parse_mixed_dates(recent[date_col]).dropna().dt.normalize())
        current_dates = parse_mixed_dates(current_local[date_col]).dt.normalize()
        current_local = current_local[~current_dates.isin(recent_dates)].copy()
    frames = {
        'passada': wnba_load_team_dataframe(module, team, previous, local=local),
        'atual': current_local,
        'recente': recent,
    }
    weights = reliability_adjusted_period_weights(
        wnba_get_season_weights(module, len(current_all)),
        frames,
    )
    available = tuple(key for key, frame in frames.items() if frame is not None and not frame.empty and weights.get(key, 0) > 0)
    return frames, normalize_weight_subset(weights, available) if available else weights


def numeric_series(frame: Any, keys: tuple[str, ...]) -> pd.Series:
    if frame is None or getattr(frame, 'empty', True):
        return pd.Series(dtype=float)
    combined = pd.Series(index=frame.index, dtype=float)
    for key in keys:
        if key in frame.columns:
            combined = combined.combine_first(pd.to_numeric(frame[key], errors='coerce'))
    return combined.dropna().reset_index(drop=True)


def numeric_mean(frame: Any, keys: tuple[str, ...]) -> float:
    values = numeric_series(frame, keys)
    return float(values.mean()) if not values.empty else 0.0


def weighted_valid(first: Any, second: Any, first_weight: float, second_weight: float) -> float | None:
    values = [(to_float(first), first_weight), (to_float(second), second_weight)]
    valid = [(value, weight) for value, weight in values if value is not None and value > 0]
    total = sum(weight for _, weight in valid)
    return sum(value * weight for value, weight in valid) / total if total else None


def average_valid(*values: Any) -> float | None:
    valid = [value for value in (to_float(item) for item in values) if value is not None and value > 0]
    return sum(valid) / len(valid) if valid else None


def require_float_metric(metrics: dict[str, Any], key: str, label: str) -> float:
    value = to_float(metrics.get(key) if isinstance(metrics, dict) else None)
    if value is None:
        raise ValueError(f'Metrica WNBA ausente para Total de Pontos: {label}')
    return value


def wnba_market_total_anchor(res: dict, fallback: float, row: Any = None) -> float:
    best_line = fallback
    best_distance = float('inf')
    for raw_line, values in (res.get('ou') or {}).items():
        line = to_float(raw_line)
        if line is None and isinstance(values, dict):
            line = to_float(values.get('linha'))
        if line is None:
            continue
        line_key = format_line_key(line)
        over_odd = market_odd_from_wide(
            row,
            f'odds_OverUnder_FT_including_OT_{line_key}_Over',
            (values or {}).get('odd_off_over') if isinstance(values, dict) else None,
        )
        under_odd = market_odd_from_wide(
            row,
            f'odds_OverUnder_FT_including_OT_{line_key}_Under',
            (values or {}).get('odd_off_under') if isinstance(values, dict) else None,
        )
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
    score_correlation: float,
    line: float,
    side: str,
    simulations: int,
    seed: str,
    cache: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if simulations <= 0:
        raise ValueError('simulations must be positive')
    cache_key = f"{seed}|{simulations}"
    cache = cache if cache is not None else {}
    if cache_key not in cache:
        rng = random.Random(seed)
        totals: list[float] = []
        total_sum = 0.0
        rho = max(-0.95, min(0.95, score_correlation))
        residual_scale = math.sqrt(max(0.0, 1.0 - rho * rho))
        for _ in range(simulations):
            home_z = rng.gauss(0.0, 1.0)
            away_z = rho * home_z + residual_scale * rng.gauss(0.0, 1.0)
            home_points = max(0.0, home_mean + home_sd * home_z)
            away_points = max(0.0, away_mean + away_sd * away_z)
            total_points = home_points + away_points
            totals.append(total_points)
            total_sum += total_points
        cache[cache_key] = {'totals': totals, 'total_sum': total_sum}
    cached = cache[cache_key]
    wins = 0
    pushes = 0
    normalized_side = normalize_text(side)
    for total_points in cached['totals']:
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
        'average_total': cached['total_sum'] / simulations,
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
    market_anchor = wnba_market_total_anchor(res, fallback=expectation['home_expected'] + expectation['away_expected'], row=row)
    model_total = expectation['home_expected'] + expectation['away_expected']
    calibrated_total = (
        (1.0 - WNBA_TOTAL_MARKET_ANCHOR_WEIGHT) * model_total +
        WNBA_TOTAL_MARKET_ANCHOR_WEIGHT * market_anchor
    )
    calibration_delta = calibrated_total - model_total
    home_expected = max(0.0, expectation['home_expected'] + calibration_delta / 2.0)
    away_expected = max(0.0, expectation['away_expected'] + calibration_delta / 2.0)
    score_margin_expected = home_expected - away_expected
    strength_margin_reference = wnba_strength_margin_reference(res, expectation['projected_pace'])
    margin_calibration = load_wnba_margin_calibration()
    strength_margin_weight = WNBA_STRENGTH_MARGIN_WEIGHT
    if strength_margin_weight <= 0 and margin_calibration.get('active'):
        strength_margin_weight = float(margin_calibration.get('strength_weight') or 0.0)
    strength_margin_adjustment = 0.0
    if strength_margin_reference is not None:
        strength_margin_adjustment = max(
            -WNBA_STRENGTH_MARGIN_MAX_ADJUSTMENT,
            min(
                WNBA_STRENGTH_MARGIN_MAX_ADJUSTMENT,
                (strength_margin_reference - score_margin_expected) * strength_margin_weight,
            ),
        )
        home_expected = max(0.0, home_expected + strength_margin_adjustment / 2.0)
        away_expected = max(0.0, away_expected - strength_margin_adjustment / 2.0)
    strength_adjusted_margin_expected = home_expected - away_expected
    model_margin_expected, margin_calibration = apply_wnba_margin_calibration(
        strength_adjusted_margin_expected,
        margin_calibration,
    )
    calibration_margin_delta = model_margin_expected - strength_adjusted_margin_expected
    if calibration_margin_delta:
        home_expected = max(0.0, home_expected + calibration_margin_delta / 2.0)
        away_expected = max(0.0, away_expected - calibration_margin_delta / 2.0)
    market_margin_anchor = wnba_market_home_margin_anchor(row)
    calibrated_margin_expected = model_margin_expected
    if market_margin_anchor is not None:
        calibrated_margin_expected = (
            (1.0 - WNBA_HANDICAP_MARKET_ANCHOR_WEIGHT) * model_margin_expected +
            WNBA_HANDICAP_MARKET_ANCHOR_WEIGHT * market_margin_anchor
        )
        margin_delta = calibrated_margin_expected - model_margin_expected
        home_expected = max(0.0, home_expected + margin_delta / 2.0)
        away_expected = max(0.0, away_expected - margin_delta / 2.0)
    cache_key = (
        f"{row.get('date')}|{row.get('time')}|{home}|{away}|"
        f"{round(home_expected, 3)}|{round(away_expected, 3)}|"
        f"{round(expectation['home_sd'], 3)}|{round(expectation['away_sd'], 3)}|"
        f"{round(expectation['score_correlation'], 4)}"
    )
    cache = res.setdefault('_wnba_matchup_sim_cache', {})
    if cache_key not in cache:
        rng = random.Random(cache_key)
        margins: list[float] = []
        home_wins = 0
        away_wins = 0
        margin_sum = 0.0
        total_sum = 0.0
        rho = max(-0.95, min(0.95, expectation['score_correlation']))
        residual_scale = math.sqrt(max(0.0, 1.0 - rho * rho))
        for _ in range(WNBA_TOTAL_SIMULATIONS):
            home_z = rng.gauss(0.0, 1.0)
            away_z = rho * home_z + residual_scale * rng.gauss(0.0, 1.0)
            home_points = max(0.0, home_expected + expectation['home_sd'] * home_z)
            away_points = max(0.0, away_expected + expectation['away_sd'] * away_z)
            margin = home_points - away_points
            margins.append(margin)
            margin_sum += margin
            total_sum += home_points + away_points
            if margin > 0:
                home_wins += 1
            elif margin < 0:
                away_wins += 1
            else:
                home_wins += 0.5
                away_wins += 0.5
        cache[cache_key] = {
            'margins': margins,
            'home_wins': home_wins,
            'away_wins': away_wins,
            'margin_sum': margin_sum,
            'total_sum': total_sum,
        }
    cached = cache[cache_key]
    margins = cached['margins']
    home_wins = cached['home_wins']
    away_wins = cached['away_wins']
    handicap_wins = 0
    handicap_pushes = 0
    if handicap_line is not None and handicap_side in {'home', 'away'}:
        for margin in margins:
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
        'average_margin': cached['margin_sum'] / WNBA_TOTAL_SIMULATIONS,
        'average_total': cached['total_sum'] / WNBA_TOTAL_SIMULATIONS,
        'home_expected': home_expected,
        'away_expected': away_expected,
        'home_sd': expectation['home_sd'],
        'away_sd': expectation['away_sd'],
        'score_correlation': expectation['score_correlation'],
        'projected_pace': expectation['projected_pace'],
        'model_total_expected': model_total,
        'market_anchor_line': market_anchor,
        'calibrated_total_expected': calibrated_total,
        'model_margin_expected': model_margin_expected,
        'score_margin_expected': score_margin_expected,
        'strength_margin_reference': strength_margin_reference,
        'strength_margin_adjustment': strength_margin_adjustment,
        'strength_margin_weight': strength_margin_weight,
        'strength_adjusted_margin_expected': strength_adjusted_margin_expected,
        'margin_calibration_status': margin_calibration['status'],
        'margin_calibration_intercept': margin_calibration['intercept'],
        'margin_calibration_slope': margin_calibration['slope'],
        'market_margin_anchor': market_margin_anchor,
        'calibrated_margin_expected': calibrated_margin_expected,
    }


def wnba_strength_margin_reference(res: dict[str, Any], projected_pace: float | None) -> float | None:
    home_net = to_float(res.get('net_c'))
    away_net = to_float(res.get('net_f'))
    pace = to_float(projected_pace)
    if pace is None or pace <= 0:
        pace = average_valid(res.get('pace_c'), res.get('pace_f'))
    if home_net is None or away_net is None or pace is None or pace <= 0:
        return None
    return (home_net - away_net) * pace / 100.0


def load_wnba_margin_calibration(path: Path | None = None) -> dict[str, Any]:
    config_path = path or WNBA_MARGIN_CALIBRATION_PATH
    try:
        payload = json.loads(config_path.read_text(encoding='utf-8'))
    except Exception:
        payload = {}
    active = bool(payload.get('active'))
    intercept = to_float(payload.get('intercept'))
    slope = to_float(payload.get('slope'))
    strength_weight = to_float(payload.get('strength_weight'))
    if not active or intercept is None or slope is None or not 0.25 <= slope <= 2.0:
        return {
            'active': False,
            'status': str(payload.get('status') or 'identity_no_valid_oos_calibration'),
            'intercept': 0.0,
            'slope': 1.0,
            'strength_weight': 0.0,
        }
    return {
        'active': True,
        'status': str(payload.get('status') or 'active_oos_calibration'),
        'intercept': intercept,
        'slope': slope,
        'strength_weight': max(0.0, min(0.50, strength_weight or 0.0)),
    }


def apply_wnba_margin_calibration(margin: float, config: dict[str, Any] | None = None) -> tuple[float, dict[str, Any]]:
    calibration = dict(config or load_wnba_margin_calibration())
    intercept = float(calibration.get('intercept') or 0.0)
    slope = float(calibration.get('slope') or 1.0)
    if not calibration.get('active'):
        return float(margin), {**calibration, 'intercept': 0.0, 'slope': 1.0}
    calibrated = intercept + slope * float(margin)
    return calibrated, calibration


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
    period_frames, base_weights = wnba_non_overlapping_period_frames(module, team, local)
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
    period_frames, base_weights = wnba_non_overlapping_period_frames(module, team, local)

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
            'jogos_efetivos': 0.0,
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
        'jogos_efetivos': weighted_effective_sample(periodos, weights),
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
            'jogos_efetivos': 0.0,
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
            'jogos_efetivos': 0.0,
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
    effective = combine_effective_samples(valid_components)
    warnings = sorted({warning for item in valid_components for warning in item.get('warnings', [])})
    if considered < WNBA_TOTAL_LOW_SAMPLE * len(valid_components):
        warnings.append('LOW_SAMPLE_COMBINADO')
    if any(str(warning).startswith('LOW_SAMPLE') for warning in warnings) and 'LOW_SAMPLE' not in warnings:
        warnings.insert(0, 'LOW_SAMPLE')
    return {
        'jogos_considerados': considered,
        'jogos_efetivos': effective,
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


def wnba_handicap_no_vig_probability(res: dict, pick_side: str, line: float, row: Any = None) -> float | None:
    market_pair = wnba_handicap_market_pair(row, pick_side, line)
    if market_pair is not None:
        vig = no_vig_pair(market_pair[0], market_pair[1])
        return vig[0] if vig is not None else None

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
            'jogos_efetivos': 0.0,
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
    effective = combine_effective_samples(valid_components)
    pushes = sum(item['pushes'] for item in valid_components)
    warnings = sorted({warning for item in valid_components for warning in item.get('warnings', [])})
    if considered < WNBA_TOTAL_LOW_SAMPLE * len(valid_components):
        warnings.append('LOW_SAMPLE_COMBINADO')
    if any(str(warning).startswith('LOW_SAMPLE') for warning in warnings) and 'LOW_SAMPLE' not in warnings:
        warnings.insert(0, 'LOW_SAMPLE')

    return {
        'jogos_considerados': considered,
        'jogos_efetivos': effective,
        'pushes': pushes,
        'taxa_bruta': combined_raw,
        'taxa_com_shrinkage': combined_shrunk,
        'fallback': None,
        'warnings': warnings,
        'componentes': components,
    }


def wnba_team_total_component_probability(module: Any, team: str, local: str, line: float, side: str) -> dict[str, Any]:
    period_frames, base_weights = wnba_non_overlapping_period_frames(module, team, local)
    available_keys = tuple(key for key, frame in period_frames.items() if frame is not None and not getattr(frame, 'empty', True) and base_weights.get(key, 0) > 0)
    if not available_keys:
        return {
            'jogos_considerados': 0,
            'jogos_efetivos': 0.0,
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
        'jogos_efetivos': weighted_effective_sample(periodos, weights),
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
            'jogos_efetivos': round(float(component.get('jogos_efetivos') or 0.0), 2),
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
    cache = getattr(module, '_wnba_dataframe_cache', None)
    if cache is None:
        cache = {}
        setattr(module, '_wnba_dataframe_cache', cache)
    cache_key = (str(team), str(season), str(local), str(getattr(module, '_wnba_prediction_cutoff', '')))
    if cache_key in cache:
        return cache[cache_key]
    try:
        df = module.carregar_dados_time(team, season, local=local, filtrar_ot=False)
    except TypeError:
        df = module.carregar_dados_time(team, season, local=local)
    except Exception:
        cache[cache_key] = pd.DataFrame()
        return cache[cache_key]
    if df is None or getattr(df, 'empty', True):
        cache[cache_key] = pd.DataFrame()
        return cache[cache_key]
    cache[cache_key] = df
    return cache[cache_key]


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


def reliability_adjusted_period_weights(weights: dict[str, float], frames: dict[str, pd.DataFrame]) -> dict[str, float]:
    adjusted: dict[str, float] = {}
    for key, base_weight in weights.items():
        frame = frames.get(key)
        sample_size = len(frame) if frame is not None and not getattr(frame, 'empty', True) else 0
        reliability = min(1.0, sample_size / float(WNBA_TOTAL_LOW_SAMPLE))
        adjusted[key] = max(0.0, float(base_weight)) * reliability
    available = tuple(key for key, value in adjusted.items() if value > 0)
    return normalize_weight_subset(adjusted, available) if available else adjusted


def weighted_effective_sample(periods: dict[str, Any], weights: dict[str, float]) -> float:
    variance_factor = 0.0
    for key, weight in weights.items():
        stats = periods.get(key) if isinstance(periods, dict) else None
        sample_size = int((stats or {}).get('jogos_considerados') or 0) if isinstance(stats, dict) else 0
        if sample_size > 0 and weight > 0:
            variance_factor += float(weight) ** 2 / sample_size
    return 1.0 / variance_factor if variance_factor > 0 else 0.0


def combine_effective_samples(components: list[dict[str, Any]]) -> float:
    valid = [float(item.get('jogos_efetivos') or 0.0) for item in components if float(item.get('jogos_efetivos') or 0.0) > 0]
    if not valid:
        return 0.0
    component_weight = 1.0 / len(valid)
    variance_factor = sum(component_weight ** 2 / sample_size for sample_size in valid)
    return 1.0 / variance_factor if variance_factor > 0 else 0.0


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


def conservative_wnba_probability(probability: float, historical_games: float, market: str) -> tuple[float, float]:
    effective_n = max(10.0, float(historical_games or 0.0))
    standard_error = math.sqrt(max(0.0, probability * (1.0 - probability)) / effective_n)
    factor = 0.75 if market == 'total' else 0.50
    haircut = min(0.06 if market == 'total' else 0.04, factor * standard_error)
    return max(0.01, min(0.99, probability - haircut)), haircut


def wnba_robust_value_gate_reason(item: dict[str, Any], market_key: str) -> str | None:
    low_sample = any(str(warning).startswith('LOW_SAMPLE') for warning in item.get('_hist_warnings', []))
    minimum_edge = max(
        WNBA_MIN_EDGE_BY_MARKET[market_key],
        WNBA_LOW_SAMPLE_MIN_EDGE if low_sample else 0.0,
    )
    if float(item.get('edge') or 0.0) < minimum_edge:
        return f"EDGE_BELOW_{minimum_edge:.1f}"
    median_ev = to_float(item.get('_median_ev'))
    if low_sample and (median_ev is None or median_ev < WNBA_LOW_SAMPLE_MIN_MEDIAN_EV):
        return f"LOW_SAMPLE_MEDIAN_EV_BELOW_{WNBA_LOW_SAMPLE_MIN_MEDIAN_EV:.1f}"
    return None


def wnba_component_disagreement_haircut(
    probability: float,
    components: dict[str, float],
    market_probability: float,
) -> tuple[float, dict[str, float | str]]:
    values = [float(value) for value in components.values() if value is not None]
    spread = max(values) - min(values) if len(values) >= 2 else 0.0
    excess = max(0.0, spread - WNBA_COMPONENT_DISAGREEMENT_THRESHOLD)
    requested = min(
        WNBA_COMPONENT_DISAGREEMENT_MAX_HAIRCUT,
        excess * WNBA_COMPONENT_DISAGREEMENT_STRENGTH,
    )
    applied = min(max(0.0, probability - market_probability), requested)
    return max(0.01, min(0.99, probability - applied)), {
        'status': 'haircut_applied' if applied > 0 else 'within_tolerance',
        'component_spread': spread,
        'haircut': applied,
    }


def is_supported_half_handicap_line(line: Any) -> bool:
    value = to_float(line)
    if value is None:
        return False
    return math.isclose(abs(value) % 1.0, 0.5, abs_tol=1e-9)


def limit_wnba_correlated_lines(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    moneylines = [row for row in rows if normalize_text(row.get('mercado')) == 'moneyline']
    restricted = [row for row in rows if normalize_text(row.get('mercado')) != 'moneyline']
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in restricted:
        grouped.setdefault(normalize_text(row.get('mercado')), []).append(row)
    selected = [max(moneylines, key=lambda item: float(item.get('edge') or 0.0))] if moneylines else []
    for group in grouped.values():
        valid = [
            row for row in group
            if to_float(row.get('linha')) is not None and not row.get('_strong_market_conflict')
        ]
        if not valid:
            continue
        principal = min(
            valid,
            key=lambda item: (
                abs(float(item.get('linha')) - float(item.get('_market_anchor_line') if item.get('_market_anchor_line') is not None else item.get('linha'))),
                -float(item.get('edge') or 0.0),
            ),
        )
        side = principal.get('_selection_side')
        same_side = [row for row in valid if row.get('_selection_side') == side]
        same_side.sort(
            key=lambda item: (
                abs(float(item.get('linha')) - float(principal.get('_market_anchor_line') if principal.get('_market_anchor_line') is not None else principal.get('linha'))),
                -float(item.get('edge') or 0.0),
            )
        )
        chosen = same_side[:WNBA_MAX_CORRELATED_LINES]
        for index, item in enumerate(chosen):
            item['selection_role'] = 'PRINCIPAL' if index == 0 else 'ALTERNATIVA'
        selected.extend(chosen)
    return selected


def wnba_handicap_anchor_for_side(row: Any, pick_side: str) -> float | None:
    best: tuple[float, float] | None = None
    for idx in wnba_handicap_indexes_from_row(row):
        home_line = to_float(get_row_value(row, (f'odds_Asian_handicap_FT_including_OT_Linha{idx}_HANDICAP',)))
        away_line = to_float(get_row_value(row, (f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_HANDICAP',)))
        home_odd = market_odd_from_wide(row, f'odds_Asian_handicap_FT_including_OT_Linha{idx}_1')
        away_odd = market_odd_from_wide(row, f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_Odd')
        if None in (home_line, away_line, home_odd, away_odd):
            continue
        no_vig = no_vig_pair(float(home_odd), float(away_odd))
        if no_vig is None:
            continue
        distance = abs(no_vig[0] - 0.5)
        line = float(home_line) if pick_side == 'home' else float(away_line)
        if best is None or distance < best[0]:
            best = (distance, line)
    return best[1] if best else None


def wnba_market_home_margin_anchor(row: Any) -> float | None:
    home_line = wnba_handicap_anchor_for_side(row, 'home')
    return -home_line if home_line is not None else None


def apply_wnba_exposure_caps(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    game_used: dict[str, float] = {}
    market_used: dict[tuple[str, str], float] = {}
    kept: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda item: -float(item.get('edge') or 0.0)):
        if row.get('_strong_market_conflict'):
            continue
        game = str(row.get('jogo') or '')
        market = normalize_text(row.get('mercado'))
        requested = parse_units(stake_sugerida(row.get('probabilidade_final'), row.get('edge'), row.get('odd_ofertada')))
        available = min(
            WNBA_MAX_GAME_UNITS - game_used.get(game, 0.0),
            WNBA_MAX_MARKET_UNITS - market_used.get((game, market), 0.0),
            WNBA_MAX_PICK_UNITS,
        )
        allocated = math.floor(max(0.0, min(requested, available)) * 4.0 + 1e-9) / 4.0
        if allocated < 0.25:
            continue
        row['stake'] = f'{allocated:.2f}'.rstrip('0').rstrip('.') + 'u'
        game_used[game] = game_used.get(game, 0.0) + allocated
        market_used[(game, market)] = market_used.get((game, market), 0.0) + allocated
        kept.append(row)
    return kept


def parse_units(value: Any) -> float:
    try:
        return float(str(value or '').lower().replace('u', '').strip())
    except ValueError:
        return 0.0


def build_wnba_runtime_diagnostics(rows: list[dict[str, Any]], errors: list[str]) -> dict[str, Any]:
    return {
        'enabled': True,
        'mode': 'single_controlled_engine',
        'model_version': BASKETBALL_WNBA_MODEL_VERSION,
        'published_count': len(rows),
        'handicap_count': sum(1 for row in rows if 'handicap' in normalize_text(row.get('mercado'))),
        'data_errors': [error for error in errors if 'WNBA_DATA_' in error][:20],
        'limits': {
            'max_lines_per_market': WNBA_MAX_CORRELATED_LINES,
            'max_market_units': WNBA_MAX_MARKET_UNITS,
            'max_game_units': WNBA_MAX_GAME_UNITS,
        },
    }


def mark_wnba_discard(item: dict[str, Any], reason: str, keep: bool = False) -> dict[str, Any] | None:
    item['wnba_v1_1_discard_reason'] = reason
    item['observacoes'] = append_wnba_debug(item.get('observacoes'), {'discard_reason': reason}, [reason])
    return item if keep else None


def build_wnba_walk_forward_candidate(
    item: dict[str, Any],
    debug: dict[str, Any],
    row: Any,
    home: str,
    away: str,
) -> dict[str, Any]:
    return {
        'snapshot_at_utc': datetime.now(timezone.utc).isoformat(),
        'game_date': normalize_date_for_model(get_row_value(row, ('date', 'data'))),
        'game_time': normalize_time(get_row_value(row, ('time', 'hora'))),
        'home': home,
        'away': away,
        'market': item.get('mercado'),
        'pick': item.get('pick'),
        'line': to_float(item.get('linha')),
        'model_version': BASKETBALL_WNBA_MODEL_VERSION,
        'pregame_verified': None,
        'probability_final': to_float(item.get('probabilidade_final')),
        'probability_historical': to_float(debug.get('prob_hist')),
        'probability_simulation': to_float(debug.get('prob_sim')),
        'probability_market_no_vig': to_float(debug.get('prob_no_vig')),
        'raw_sample_size': int(debug.get('jogos_considerados') or 0),
        'effective_sample_size': to_float(debug.get('jogos_efetivos')),
        'score_margin_pre_strength': to_float(debug.get('margem_placar_pre_forca')),
        'strength_margin_reference': to_float(debug.get('margem_referencia_forca')),
        'strength_margin_adjustment': to_float(debug.get('ajuste_margem_forca')),
        'model_margin_pre_market': to_float(debug.get('margem_modelo_pre_mercado')),
        'market_margin_anchor': to_float(debug.get('margem_ancora_mercado')),
        'calibrated_margin': to_float(debug.get('margem_calibrada')),
        'market_conflict_status': item.get('market_conflict_status'),
        'warnings': list(debug.get('warnings') or []),
        'actual_home_points': None,
        'actual_away_points': None,
        'actual_margin': None,
    }


def replace_wnba_legacy_margin_context(
    observation: Any,
    home: str,
    away: str,
    simulation: dict[str, Any],
) -> str:
    text = str(observation or '').strip()
    active_context = (
        f"Margem ativa V2.2 {home} {float(simulation['average_margin']):+.2f}; "
        f"Pontos esperados V2.2 {home} {float(simulation['home_expected']):.2f} x "
        f"{away} {float(simulation['away_expected']):.2f}"
    )
    replaced, count = re.subn(
        r'Delta pontos\s+[+-]?\d+(?:[.,]\d+)?',
        active_context,
        text,
        count=1,
        flags=re.IGNORECASE,
    )
    return replaced if count else " | ".join(part for part in (text, active_context) if part)


def merge_wnba_technical_context(legacy_context: Any, active_context: Any) -> str:
    """Preserva o contexto completo do notebook e acrescenta a decisao ativa V2.2."""
    legacy = str(legacy_context or '').strip()
    active = str(active_context or '').strip()
    if not legacy:
        return active
    if not active:
        return legacy
    return f"{legacy}\n\n--- DECISAO ATIVA WNBA V2.2 ---\n{active}"


def format_wnba_historical_components(components: Any) -> list[str]:
    if not isinstance(components, dict):
        return []
    labels = {'home': 'Mandante', 'away': 'Visitante', 'h2h': 'Confronto direto'}
    formatted: list[str] = []
    for key, component in components.items():
        if not isinstance(component, dict):
            continue
        values = [
            f"jogos={component.get('jogos')}",
            f"efetivos={component.get('jogos_efetivos')}",
            f"taxa_bruta={component.get('raw')}%",
            f"taxa_shrinkage={component.get('shrunk')}%",
        ]
        if component.get('pesos'):
            values.append(f"pesos_periodos={component.get('pesos')}")
        if component.get('warnings'):
            values.append(f"alertas={','.join(str(value) for value in component['warnings'])}")
        formatted.append(f"{labels.get(str(key), str(key))}: " + '; '.join(values))
    return formatted


def build_wnba_active_technical_context(
    item: dict[str, Any],
    res: dict[str, Any],
    home: str,
    away: str,
    row: pd.Series | dict[str, Any] | None = None,
) -> str:
    debug = item.get('_wnba_debug') if isinstance(item.get('_wnba_debug'), dict) else {}
    lines = [
        f"Modelo: {BASKETBALL_WNBA_MODEL_VERSION}",
        f"Confronto: {home} vs {away}",
        (
            "Identificacao: "
            f"liga=WNBA; data={format_date_for_app(get_row_value(row, ('date', 'data'))) if row is not None else item.get('data')}; "
            f"horario={normalize_time(get_row_value(row, ('time', 'hora'))) if row is not None else item.get('hora')}; "
            f"mandante={item.get('mandante') or home}; visitante={item.get('visitante') or away}"
        ),
        f"Mercado/Pick ativo: {item.get('mercado')} | {item.get('pick')}",
        (
            f"RPI: {home} {float(res.get('rpi_c') or 0.0):.3f} x {away} {float(res.get('rpi_f') or 0.0):.3f}; "
            f"NetRtg: {home} {float(res.get('net_c') or 0.0):.2f} x {away} {float(res.get('net_f') or 0.0):.2f}; "
            f"Pace: {home} {float(res.get('pace_c') or 0.0):.2f} x {away} {float(res.get('pace_f') or 0.0):.2f}"
        ),
    ]
    calculation_fields = (
        ('total_modelo_pre_mercado', 'Total do modelo pre-mercado'),
        ('total_ancora_mercado', 'Ancora de total do mercado'),
        ('total_calibrado', 'Total calibrado ativo'),
        ('media_total_simulada', 'Media total simulada'),
        ('media_pontos_casa', 'Pontos esperados casa'),
        ('media_pontos_visitante', 'Pontos esperados visitante'),
        ('desvio_pontos_casa', 'Desvio padrao casa'),
        ('desvio_pontos_visitante', 'Desvio padrao visitante'),
        ('simulacoes', 'Simulacoes Monte Carlo'),
        ('margem_placar_pre_forca', 'Margem antes da forca'),
        ('margem_referencia_forca', 'Referencia de margem por forca'),
        ('ajuste_margem_forca', 'Ajuste de margem por forca'),
        ('peso_margem_forca', 'Peso da margem por forca'),
        ('margem_modelo_pre_mercado', 'Margem ativa pre-mercado'),
        ('margem_ancora_mercado', 'Ancora de handicap do mercado'),
        ('margem_calibrada', 'Margem calibrada ativa'),
        ('margem_media_simulada', 'Margem media simulada'),
        ('calibracao_margem_status', 'Calibracao walk-forward da margem'),
    )
    active_values = [f"{label}: {debug[key]}" for key, label in calculation_fields if debug.get(key) is not None]
    if active_values:
        lines.append("Calculos ativos: " + "; ".join(active_values))
    lines.append(
        "Probabilidades ativas: "
        f"historica={debug.get('prob_hist')}%; simulacao={debug.get('prob_sim')}%; "
        f"no-vig={debug.get('prob_no_vig')}%; blend_bruto={debug.get('prob_bruta_blend')}%; "
        f"final={item.get('probabilidade_final')}%; pesos={debug.get('pesos_probabilidade')}"
    )
    lines.append(
        "Amostra: "
        f"bruta={debug.get('jogos_considerados')}; efetiva={debug.get('jogos_efetivos')}; "
        f"taxa_bruta={debug.get('taxa_bruta')}%; taxa_shrinkage={debug.get('taxa_com_shrinkage')}%; "
        f"pushes={debug.get('pushes')}; haircut={debug.get('haircut_incerteza_pp', debug.get('haircut_amostra_pp'))} p.p.; "
        f"fallback={debug.get('fallback')}"
    )
    for component in format_wnba_historical_components(debug.get('componentes_historicos')):
        lines.append("Historico - " + component)
    lines.append(
        "Mercado/Odds/EV: "
        f"linha={item.get('linha', debug.get('linha_avaliada'))}; "
        f"melhor={item.get('odd_melhor', item.get('odd_ofertada'))}; mediana={item.get('odd_mediana')}; "
        f"bookmaker_melhor={item.get('bookmaker_melhor') or debug.get('bookmaker_melhor')}; "
        f"edge_melhor={item.get('edge')}%; ev_mediana={debug.get('ev_odd_mediana')}%"
    )
    market_key = 'handicap' if 'handicap' in normalize_text(item.get('mercado')) else 'total' if any(
        token in normalize_text(item.get('mercado')) for token in ('overunder', 'total', 'pontos')
    ) else 'moneyline'
    low_sample = any(str(value).startswith('LOW_SAMPLE') for value in (debug.get('warnings') or []))
    minimum_edge = max(WNBA_MIN_EDGE_BY_MARKET[market_key], WNBA_LOW_SAMPLE_MIN_EDGE if low_sample else 0.0)
    median_ev = to_float(debug.get('ev_odd_mediana'))
    edge = to_float(item.get('edge'))
    best_odd = to_float(item.get('odd_melhor', item.get('odd_ofertada')))
    median_odd = to_float(item.get('odd_mediana'))
    gate_results = [
        f"edge {'PASS' if edge is not None and edge >= minimum_edge else 'FAIL'} ({edge}% >= {minimum_edge:.1f}%)",
        (
            f"EV mediano {'PASS' if not low_sample or (median_ev is not None and median_ev >= WNBA_LOW_SAMPLE_MIN_MEDIAN_EV) else 'FAIL'} "
            f"({median_ev}% >= {WNBA_LOW_SAMPLE_MIN_MEDIAN_EV:.1f}% quando baixa amostra)"
        ),
        f"confianca {'PASS' if float(item.get('probabilidade_final') or 0.0) < WNBA_OVERCONFIDENCE_CUTOFF else 'FAIL'} "
        f"({item.get('probabilidade_final')}% < {WNBA_OVERCONFIDENCE_CUTOFF:.1f}%)",
    ]
    if best_odd is not None and median_odd is not None and median_odd > 0:
        ratio = best_odd / median_odd
        gate_results.append(
            f"melhor/mediana {'PASS' if ratio <= WNBA_MAX_BEST_TO_MEDIAN_RATIO else 'FAIL'} "
            f"({ratio:.3f} <= {WNBA_MAX_BEST_TO_MEDIAN_RATIO:.2f})"
        )
    lines.append("Robust gates: " + '; '.join(gate_results))
    warnings = debug.get('warnings') or []
    if warnings:
        lines.append("Alertas: " + ", ".join(str(value) for value in warnings))
    if item.get('market_conflict_status'):
        lines.append(f"Status de conflito com mercado: {item.get('market_conflict_status')}")
    return "\n".join(lines)


def append_wnba_debug(observacao: Any, debug: dict[str, Any], reasons: list[str] | None = None) -> str:
    base = str(observacao or '').strip()
    parts = [base] if base else []
    reason_text = ','.join(reasons or [])
    debug_items = [f"{key}={value}" for key, value in debug.items() if value not in (None, '', [])]
    if reason_text:
        debug_items.append(f"motivos={reason_text}")
    if debug_items:
        parts.append("WNBA V2.2: " + "; ".join(debug_items))
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
            'odd_mediana': to_float(row.get('odd_mediana')),
            'odd_mercado_base': to_float(row.get('odd_mercado_base') or row.get('odd_mediana')),
            'odd_melhor': to_float(row.get('odd_melhor')) or odd,
            'bookmaker_melhor': str(row.get('bookmaker_melhor') or '') or None,
            'odd_valor': to_float(row.get('odd_valor')) or 0,
            'probabilidade': prob,
            'probabilidade_final': prob,
            'edge': edge,
            'stake': row.get('stake') or stake_sugerida(prob, edge, odd),
            'selection_role': row.get('selection_role'),
            'market_conflict_status': row.get('market_conflict_status'),
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
    cols = ['data','hora','esporte','liga','jogo','mandante','visitante','mercado','pick','odd','odd_ofertada','odd_mediana','odd_mercado_base','odd_melhor','bookmaker_melhor','odd_valor','probabilidade','probabilidade_final','edge','stake','selection_role','market_conflict_status','observacoes','dados_tecnicos','contexto_adicional','parecer_validacao']
    with path.open('w', encoding='utf-8-sig', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)


def empty_result(league: str, output_path: Path, message: str) -> dict[str, Any]:
    return {'ok': True, 'modelo': model_name(league), 'arquivo_saida': str(output_path), 'arquivo_contexto': None, 'total_prognosticos': 0, 'contexto_modelo': message, 'dados_tecnicos': message, 'mensagem': message, 'prognosticos': []}


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


def row_offered_odd(row: Any) -> float | None:
    return to_float(get_row_value(row, ('odd_melhor',))) or to_float(get_row_value(row, ('odd', 'odd_ofertada')))


def row_market_odd(row: Any) -> float | None:
    return (
        to_float(get_row_value(row, ('odd_mediana',))) or
        to_float(get_row_value(row, ('odd_media',))) or
        to_float(get_row_value(row, ('odd', 'odd_ofertada')))
    )


def set_odd_columns(row: dict[str, Any], base_col: str, offered_odd: float, market_odd: float | None = None, bookmaker: str = '') -> None:
    current = to_float(row.get(base_col))
    if current is None or offered_odd > current:
        row[base_col] = offered_odd
        if bookmaker:
            row[f'{base_col}_BOOKMAKER_MELHOR'] = bookmaker
    if market_odd is not None and market_odd > 1:
        row[f'{base_col}_MEDIANA'] = market_odd


def market_odd_from_wide(row: Any, base_col: str, fallback: Any = None) -> float | None:
    value = get_row_value(row, (f'{base_col}_MEDIANA',))
    market = to_float(value)
    if market is not None and market > 1:
        return market
    return to_float(fallback if fallback is not None else get_row_value(row, (base_col,)))


def bookmaker_from_wide(row: Any, base_col: str) -> str:
    return clean(get_row_value(row, (f'{base_col}_BOOKMAKER_MELHOR',)))


def wnba_handicap_market_pair(row: Any, pick_side: str, line: float) -> tuple[float, float, str] | None:
    if row is None:
        return None
    for idx in wnba_handicap_indexes_from_row(row):
        home_line_col = f'odds_Asian_handicap_FT_including_OT_Linha{idx}_HANDICAP'
        home_odd_col = f'odds_Asian_handicap_FT_including_OT_Linha{idx}_1'
        away_line_col = f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_HANDICAP'
        away_odd_col = f'odds_Asian_handicap_FT_including_OT_Linha{idx}_Opp_Odd'

        home_line = to_float(get_row_value(row, (home_line_col,)))
        away_line = to_float(get_row_value(row, (away_line_col,)))
        if home_line is None or away_line is None:
            continue
        home_odd = market_odd_from_wide(row, home_odd_col)
        away_odd = market_odd_from_wide(row, away_odd_col)
        if home_odd is None or away_odd is None:
            continue
        if pick_side == 'home' and math.isclose(home_line, line, abs_tol=1e-9):
            return home_odd, away_odd, bookmaker_from_wide(row, home_odd_col)
        if pick_side == 'away' and math.isclose(away_line, line, abs_tol=1e-9):
            return away_odd, home_odd, bookmaker_from_wide(row, away_odd_col)
    return None


def wnba_handicap_indexes_from_row(row: Any) -> list[int]:
    try:
        keys = row.index if hasattr(row, 'index') else row.keys()
    except Exception:
        return []
    indexes = {
        int(match.group(1))
        for key in keys
        if (match := re.search(r'odds_Asian_handicap_FT_including_OT_Linha(\d+)_HANDICAP$', str(key)))
    }
    return sorted(indexes)


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
    dt = parse_single_date(text)
    if pd.notna(dt):
        return dt.strftime('%Y-%m-%d')
    return text


def format_date_for_app(value: Any) -> str:
    # dayfirst=True: as entradas do fluxo brasileiro chegam como DD/MM/YYYY.
    # Sem esse flag, o pandas assume mês-primeiro e "09/07/2026" (9 de julho)
    # vira 2026-09-07, quebrando o filtro "Hoje" na Validação Crítica.
    dt = parse_single_date(value)
    if pd.notna(dt):
        return dt.strftime('%d/%m/%Y')
    return clean(value)


def normalize_time(value: Any) -> str:
    text = clean(value)
    m = re.search(r'(\d{1,2}:\d{2})', text)
    return m.group(1) if m else text


def stake_sugerida(prob: float | None, edge: float | None, odd: float | None = None) -> str:
    probability = (to_float(prob) or 0.0) / 100.0
    edge_decimal = (to_float(edge) or 0.0) / 100.0
    offered_odd = to_float(odd)
    if offered_odd is None and probability > 0:
        offered_odd = (1.0 + edge_decimal) / probability
    if probability <= 0 or offered_odd is None or offered_odd <= 1:
        return '0.25u'
    full_kelly = max(0.0, (offered_odd * probability - 1.0) / (offered_odd - 1.0))
    units = min(WNBA_MAX_PICK_UNITS, full_kelly * WNBA_KELLY_FRACTION * 100.0)
    rounded = math.floor(units * 4.0 + 1e-9) / 4.0
    rounded = max(0.25, rounded)
    return f'{rounded:.2f}'.rstrip('0').rstrip('.') + 'u'


def build_parecer(row: dict[str, Any]) -> str:
    league = 'WNBA' if 'WNBA' in str(row.get('liga') or '').upper() else 'NBA'
    return f"EV+ pelo {model_name(league)}: probabilidade {to_float(row.get('probabilidade_final')) or 0:.2f}%, odd valor {to_float(row.get('odd_valor')) or 0:.2f}, odd ofertada {to_float(row.get('odd_ofertada')) or 0:.2f}, edge {to_float(row.get('edge')) or 0:.2f}%."


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
