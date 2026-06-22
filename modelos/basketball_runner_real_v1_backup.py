from __future__ import annotations

import contextlib
import csv
import io
import json
import math
import os
import re
import sys
import types
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

BASE_DIR = Path('/home/ubuntu/asp-scraper-api')
JUPYTER_DIR = Path('/home/ubuntu/jupyter')
NOTEBOOKS = {
    'NBA': JUPYTER_DIR / 'prognosticos_basketball_nba.ipynb',
    'WNBA': JUPYTER_DIR / 'prognosticos_basketball_wnba.ipynb',
}

MIN_ODD_EXPORT = 1.25
MAX_ODD_EXPORT = 2.00


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
        write_output_csv(output_path, rows)
        contexto_modelo = '\n\n'.join(contexts[:20])
        msg = None
        if not rows:
            msg = 'Nenhuma oportunidade EV+ encontrada para os filtros atuais.'
        if errors:
            msg = (msg + ' ' if msg else '') + f"Jogos ignorados/erros: {'; '.join(errors[:5])}"

        emit({
            'ok': True,
            'modelo': f'Basketball {league}',
            'arquivo_saida': str(output_path),
            'arquivo_contexto': None,
            'total_prognosticos': len(rows),
            'contexto_modelo': contexto_modelo,
            'dados_tecnicos': contexto_modelo,
            'mensagem': msg,
            'prognosticos': rows,
        })
    except Exception as exc:
        emit({'ok': False, 'erro': str(exc), 'detalhe': f'csv={csv_coleta_path} output={output_path} league={league}'})


def normalize_league(value: str) -> str:
    league = str(value or '').upper().strip()
    if league in {'NBA', 'WNBA'}:
        return league
    raise RuntimeError('Liga Basketball inválida. Use NBA ou WNBA.')


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
    wide['odds_HomeAway_FT_including_OT_1'] = pd.to_numeric(wide['odds_HomeAway_FT_including_OT_1'], errors='coerce').fillna(2.0)
    wide['odds_HomeAway_FT_including_OT_2'] = pd.to_numeric(wide['odds_HomeAway_FT_including_OT_2'], errors='coerce').fillna(2.0)
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
        module.TEMPORADA_ATUAL = str(int(dt.year))
        module.TEMPORADA_PASSADA = str(int(dt.year) - 1)
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
            'observacoes': row.get('observacoes') or None,
            'dados_tecnicos': row.get('dados_tecnicos') or None,
            'contexto_adicional': row.get('contexto_modelo') or row.get('dados_tecnicos') or None,
            'contexto_modelo': row.get('contexto_modelo') or row.get('dados_tecnicos') or None,
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