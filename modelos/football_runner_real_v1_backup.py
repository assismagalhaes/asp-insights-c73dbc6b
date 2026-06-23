import sys
import json
import math
import importlib.util
import contextlib
import io
from pathlib import Path

import pandas as pd

from football_adapter import converter_csv_longo_para_wide


BASE_DIR = Path("/home/ubuntu/asp-scraper-api")
MODELOS_DIR = BASE_DIR / "modelos"
REAL_MODEL_PATH = MODELOS_DIR / "prognosticos_football_real.py"


def limpar_json_nan(obj):
    if isinstance(obj, dict):
        return {k: limpar_json_nan(v) for k, v in obj.items()}

    if isinstance(obj, list):
        return [limpar_json_nan(v) for v in obj]

    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj

    return obj


def limpar_contexto_modelo(texto: str) -> str:
    """
    Mantém apenas o bloco técnico útil para a Validação Crítica:
    - Confronto
    - Probabilidades Moneyline
    - Data/Horário
    - Rodada Atual
    - H2H
    - Últimos 5 jogos no local
    - Dados técnicos

    Remove:
    - instrução INPUT APRIMORADO
    - título === PROGNÓSTICOS - FUTEBOL ===
    - top 5 placares
    - mercados/picks do modelo
    """

    if not texto:
        return ""

    linhas = texto.splitlines()
    linhas_limpas = []

    ignorar_blocos = [
        "--- TOP 5 PLACARES MAIS PROVÁVEIS ---",
        "--- RESULTADO DA PARTIDA ---",
        "--- OVER/UNDER GOLS ---",
        "--- AMBOS MARCAM ---",
        "--- DUPLA CHANCE ---",
        "--- HANDICAP ASIÁTICO ---",
        "--- HANDICAP ASIÁTICO. ---",
    ]

    parar_ate_proximo_bloco = False

    for linha in linhas:
        linha_strip = linha.strip()

        # Remove linhas introdutórias que não devem ir para análise crítica
        if linha_strip.startswith("Utilize o INPUT APRIMORADO"):
            continue

        if linha_strip == "=== PROGNÓSTICOS - FUTEBOL ===":
            continue

        # Remove separadores finais
        if linha_strip.startswith("===="):
            continue

        # Se encontrou um bloco que deve ser removido, ignora até o próximo título/bloco
        if any(linha_strip.startswith(bloco) for bloco in ignorar_blocos):
            parar_ate_proximo_bloco = True
            continue

        if parar_ate_proximo_bloco:
            # Se encontrou outro bloco removível, continua ignorando
            if any(linha_strip.startswith(bloco) for bloco in ignorar_blocos):
                continue

            # Se encontrou o fim ou outro separador, continua ignorando
            if linha_strip.startswith("===="):
                continue

            # Se encontrou uma nova seção que queremos manter no futuro, liberar.
            # Neste caso, os blocos removidos ficam no fim do relatório,
            # então normalmente não haverá nova seção útil depois deles.
            secoes_permitidas = [
                "Confronto:",
                "--- Probabilidades",
                "Data/Horário:",
                "Rodada Atual:",
                "--- H2H",
                "Total de jogos:",
                "Vitórias ",
                "Médias H2H",
                "--- ÚLTIMOS 5 JOGOS NO LOCAL ---",
                "--- DADOS TÉCNICOS ---",
                "RPI:",
                "Médias e Expectativas de Gols:",
                "Diferencial de Gols:",
            ]

            if any(linha_strip.startswith(secao) for secao in secoes_permitidas):
                parar_ate_proximo_bloco = False
            else:
                continue

        linhas_limpas.append(linha)

    contexto = "\n".join(linhas_limpas).strip()

    # Limpeza de múltiplas linhas vazias consecutivas
    while "\n\n\n" in contexto:
        contexto = contexto.replace("\n\n\n", "\n\n")

    return contexto


def carregar_modulo_modelo_real():
    if not REAL_MODEL_PATH.exists():
        raise FileNotFoundError(f"Modelo real não encontrado em {REAL_MODEL_PATH}")

    spec = importlib.util.spec_from_file_location(
        "prognosticos_football_real",
        str(REAL_MODEL_PATH)
    )

    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)

    return modulo


def arquivo_csv_mais_recente(pasta: Path):
    if not pasta.exists():
        return None

    candidatos = list(pasta.glob("*.csv"))

    if not candidatos:
        return None

    return max(candidatos, key=lambda p: p.stat().st_mtime)


def salvar_contexto_modelo(texto_contexto: str, caminho_saida: Path):
    contexto_dir = BASE_DIR / "model_outputs" / "contextos"
    contexto_dir.mkdir(parents=True, exist_ok=True)

    nome_base = caminho_saida.stem
    caminho_contexto = contexto_dir / f"{nome_base}_contexto.txt"

    caminho_contexto.write_text(texto_contexto or "", encoding="utf-8")

    return caminho_contexto


def executar_modelo_real(caminho_csv_longo, caminho_saida):
    caminho_csv_longo = Path(caminho_csv_longo)
    caminho_saida = Path(caminho_saida)

    if not caminho_csv_longo.exists():
        raise FileNotFoundError(f"CSV de entrada não encontrado: {caminho_csv_longo}")

    caminho_saida.parent.mkdir(parents=True, exist_ok=True)

    # Remove saída antiga para evitar reaproveitar resultado mock ou antigo
    if caminho_saida.exists():
        caminho_saida.unlink()

    caminho_wide = BASE_DIR / "model_outputs" / f"{caminho_csv_longo.stem}_wide.csv"

    # 1. Converte CSV longo da coleta para CSV wide usado pelo modelo original
    df_wide = converter_csv_longo_para_wide(
        caminho_entrada=str(caminho_csv_longo),
        caminho_saida=str(caminho_wide)
    )

    if df_wide.empty:
        raise ValueError("CSV wide ficou vazio após conversão.")

    # 2. Carrega modelo real extraído do notebook
    modelo = carregar_modulo_modelo_real()

    # 3. Tenta sobrescrever variáveis globais, caso o notebook use alguma delas
    modelo.MATCHES_CSV = caminho_wide
    modelo.LOVABLE_CSV = caminho_saida
    modelo.ARQ_PROGNOSTICOS_LOVABLE = caminho_saida

    if not hasattr(modelo, "main"):
        raise AttributeError("O modelo real não possui função main().")

    pasta_prognostico = BASE_DIR / "Prognostico"

    # 4. Executa o modelo real capturando o relatório técnico impresso no stdout
    buffer_saida = io.StringIO()

    with contextlib.redirect_stdout(buffer_saida):
        modelo.main()

    contexto_bruto = buffer_saida.getvalue()
    contexto_modelo = limpar_contexto_modelo(contexto_bruto)

    # 5. Salva o relatório técnico filtrado em TXT
    caminho_contexto = salvar_contexto_modelo(contexto_modelo, caminho_saida)

    # 6. O notebook original salva em pasta própria.
    # Pegamos o CSV mais recente gerado na pasta Prognostico.
    arquivo_real = arquivo_csv_mais_recente(pasta_prognostico)

    if arquivo_real is None:
        raise FileNotFoundError(
            f"O modelo executou, mas não encontrei CSVs em {pasta_prognostico}"
        )

    df_saida = pd.read_csv(arquivo_real)

    # 7. Padroniza colunas para o Lovable
    colunas_saida = [
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
        "odd_ofertada",
        "odd_valor",
        "probabilidade_final",
        "edge",
        "observacoes",
    ]

    for coluna in colunas_saida:
        if coluna not in df_saida.columns:
            df_saida[coluna] = ""

    df_saida = df_saida[colunas_saida]

    # 8. Adiciona o contexto técnico filtrado em cada prognóstico
    df_saida["dados_tecnicos"] = contexto_modelo
    df_saida["contexto_modelo"] = contexto_modelo
    df_saida["arquivo_contexto"] = str(caminho_contexto)

    # 9. Higieniza NaN/inf
    df_saida = df_saida.replace([float("inf"), float("-inf")], pd.NA)
    df_saida = df_saida.where(pd.notna(df_saida), None)

    # 10. Salva CSV final no caminho esperado pela API
    df_saida.to_csv(caminho_saida, index=False, encoding="utf-8-sig")

    return df_saida, contexto_modelo, caminho_contexto


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({
            "ok": False,
            "erro": "Uso correto: python modelos/football_runner_real.py caminho_entrada.csv caminho_saida.csv"
        }, ensure_ascii=False))
        sys.exit(1)

    caminho_entrada = sys.argv[1]
    caminho_saida = sys.argv[2]

    try:
        prognosticos, contexto_modelo, caminho_contexto = executar_modelo_real(
            caminho_entrada,
            caminho_saida
        )

        resposta = {
            "ok": True,
            "total_prognosticos": len(prognosticos),
            "arquivo_saida": str(caminho_saida),
            "arquivo_contexto": str(caminho_contexto),
            "contexto_modelo": contexto_modelo,
            "dados_tecnicos": contexto_modelo,
            "prognosticos": prognosticos.to_dict(orient="records")
        }

        print(json.dumps(limpar_json_nan(resposta), ensure_ascii=False))

    except Exception as e:
        print(json.dumps({
            "ok": False,
            "erro": str(e)
        }, ensure_ascii=False))
        sys.exit(1)
