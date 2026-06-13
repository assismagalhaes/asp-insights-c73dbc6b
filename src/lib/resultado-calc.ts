import type { Prognostico } from "./db";

export type ResultadoCalc = "GREEN" | "RED";

export interface PlacarParsed {
  mandante: number;
  visitante: number;
  total: number;
}

/** Aceita "1x0", "1-0", "1 x 0", "1 : 0", "10x7", etc. */
export function parsePlacar(input: string): PlacarParsed | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d+)\s*[xX\-:–—]\s*(\d+)$/);
  if (!m) return null;
  const mandante = parseInt(m[1], 10);
  const visitante = parseInt(m[2], 10);
  if (Number.isNaN(mandante) || Number.isNaN(visitante)) return null;
  return { mandante, visitante, total: mandante + visitante };
}

/** Extrai a linha numérica (ex: 2.5) do texto do pick. */
export function extrairLinha(pick: string): number | null {
  const m = pick.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function linhaDoProg(p: Pick<Prognostico, "linha" | "pick">): number | null {
  if (p.linha) {
    const v = parseFloat(String(p.linha).replace(",", "."));
    if (Number.isFinite(v)) return v;
  }
  return extrairLinha(p.pick ?? "");
}

const has = (s: string, ...tokens: string[]) => tokens.some((t) => s.includes(t));

/**
 * Calcula automaticamente GREEN/RED a partir do placar + mercado + pick.
 * Retorna null quando não é possível decidir automaticamente (ex: "Casa Marcar Primeiro").
 */
export function calcularResultadoAuto(
  prog: Pick<Prognostico, "mercado" | "pick" | "linha">,
  placar: PlacarParsed,
): ResultadoCalc | null {
  const mercado = (prog.mercado ?? "").toLowerCase();
  const pick = (prog.pick ?? "").toLowerCase();
  const { mandante, visitante, total } = placar;

  // Casos não calculáveis automaticamente
  if (has(pick, "marcar primeiro", "primeiro a marcar", "primeiro gol")) return null;

  // ---- Over/Under e totais ----
  const ehTotal =
    has(mercado, "over/under", "total de", "goalmatrix", "cornermatrix") ||
    has(pick, "over ", "under ");
  if (ehTotal && (pick.includes("over") || pick.includes("under"))) {
    const linha = linhaDoProg(prog);
    if (linha == null) return null;
    if (pick.includes("over")) return total > linha ? "GREEN" : "RED";
    if (pick.includes("under")) return total < linha ? "GREEN" : "RED";
  }

  // ---- Ambas Marcam / BTTS ----
  if (has(mercado, "ambas marcam", "btts") || has(pick, "ambas marcam", "btts")) {
    const sim = has(pick, "sim", "yes") && !has(pick, "não", "nao", "no ");
    const nao = has(pick, "não", "nao") || /\bno\b/.test(pick);
    if (sim) return mandante > 0 && visitante > 0 ? "GREEN" : "RED";
    if (nao) return mandante === 0 || visitante === 0 ? "GREEN" : "RED";
  }

  // ---- Dupla Chance ----
  if (has(mercado, "dupla chance") || /\b(1x|x2|12)\b/.test(pick)) {
    if (/\b1x\b/.test(pick) || has(pick, "casa ou empate", "mandante ou empate")) {
      return mandante >= visitante ? "GREEN" : "RED";
    }
    if (/\bx2\b/.test(pick) || has(pick, "empate ou fora", "visitante ou empate", "fora ou empate")) {
      return visitante >= mandante ? "GREEN" : "RED";
    }
    if (/\b12\b/.test(pick) || has(pick, "casa ou fora", "mandante ou visitante")) {
      return mandante !== visitante ? "GREEN" : "RED";
    }
  }

  // ---- Handicap / Spread ----
  if (has(mercado, "handicap", "spread")) {
    const linha = linhaDoProg(prog);
    if (linha == null) return null;
    const ehCasa = has(pick, "casa", "mandante", "home");
    const ehFora = has(pick, "fora", "visitante", "away");
    if (ehCasa) {
      const ajuste = mandante + linha;
      return ajuste > visitante ? "GREEN" : "RED";
    }
    if (ehFora) {
      const ajuste = visitante + linha;
      return ajuste > mandante ? "GREEN" : "RED";
    }
  }

  // ---- CornerMatrix (Casa/Fora Mais Escanteios) ----
  if (has(mercado, "cornermatrix") || has(mercado, "escanteios")) {
    if (has(pick, "casa mais", "mandante mais")) return mandante > visitante ? "GREEN" : "RED";
    if (has(pick, "fora mais", "visitante mais")) return visitante > mandante ? "GREEN" : "RED";
  }

  // ---- Resultado Final / Moneyline ----
  if (has(mercado, "resultado final", "moneyline") || has(mercado, "goalmatrix")) {
    if (has(pick, "empate", "draw") || /\bx\b/.test(pick)) {
      return mandante === visitante ? "GREEN" : "RED";
    }
    if (has(pick, "casa", "mandante", "home") || /\b1\b/.test(pick)) {
      return mandante > visitante ? "GREEN" : "RED";
    }
    if (has(pick, "fora", "visitante", "away") || /\b2\b/.test(pick)) {
      return visitante > mandante ? "GREEN" : "RED";
    }
  }

  return null;
}
