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
  const m = input.trim().match(/^(\d+)\s*[xX\-:]\s*(\d+)$/);
  if (!m) return null;
  const mandante = parseInt(m[1], 10);
  const visitante = parseInt(m[2], 10);
  if (Number.isNaN(mandante) || Number.isNaN(visitante)) return null;
  return { mandante, visitante, total: mandante + visitante };
}

/** Extrai linha numerica, preservando sinal: +1.5, -1.5, 2.5. */
export function extrairLinha(texto: string): number | null {
  const m = texto.match(/[+-]?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function linhaDoProg(p: Pick<Prognostico, "linha" | "pick">): number | null {
  const fromPick = extrairLinha(p.pick ?? "");
  if (fromPick != null) return fromPick;
  if (p.linha) {
    const v = parseFloat(String(p.linha).replace(",", "."));
    if (Number.isFinite(v)) return v;
  }
  return null;
}

const has = (s: string, ...tokens: string[]) => tokens.some((t) => s.includes(t));

const norm = (s: string | null | undefined) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function mentionsTeam(pickNorm: string, team: string | null | undefined): boolean {
  const teamNorm = norm(team);
  if (!teamNorm) return false;
  if (pickNorm.includes(teamNorm)) return true;
  const parts = teamNorm.split(" ").filter((part) => part.length >= 3);
  return parts.length > 0 && parts.some((part) => pickNorm.includes(part));
}

function pickSide(
  prog: Pick<Prognostico, "pick" | "mandante" | "visitante">,
): "casa" | "fora" | null {
  const pick = norm(prog.pick);
  if (has(pick, "casa", "mandante", "home")) return "casa";
  if (has(pick, "fora", "visitante", "away")) return "fora";

  const home = mentionsTeam(pick, prog.mandante);
  const away = mentionsTeam(pick, prog.visitante);
  if (home && !away) return "casa";
  if (away && !home) return "fora";
  return null;
}

export function calcularResultadoAuto(
  prog: Pick<Prognostico, "mercado" | "pick" | "linha" | "mandante" | "visitante">,
  placar: PlacarParsed,
): ResultadoCalc | null {
  const mercado = norm(prog.mercado);
  const pick = norm(prog.pick);
  const { mandante, visitante, total } = placar;

  if (has(pick, "marcar primeiro", "primeiro a marcar", "primeiro gol")) return null;

  const ehTotal =
    has(mercado, "over under", "total de", "goalmatrix", "cornermatrix", "over", "under") ||
    has(pick, "over", "under");
  if (ehTotal && (has(pick, "over") || has(pick, "under") || has(mercado, "over", "under"))) {
    const linha = linhaDoProg(prog);
    if (linha == null) return null;
    const pickOver = has(pick, "over");
    const pickUnder = has(pick, "under");
    if (pickOver) return total > linha ? "GREEN" : "RED";
    if (pickUnder) return total < linha ? "GREEN" : "RED";
    if (has(mercado, "over")) return total > linha ? "GREEN" : "RED";
    if (has(mercado, "under")) return total < linha ? "GREEN" : "RED";
  }

  if (has(mercado, "ambas marcam", "btts") || has(pick, "ambas marcam", "btts")) {
    const sim = has(pick, "sim", "yes") && !has(pick, "nao", "no");
    const nao = has(pick, "nao", "no");
    if (sim) return mandante > 0 && visitante > 0 ? "GREEN" : "RED";
    if (nao) return mandante === 0 || visitante === 0 ? "GREEN" : "RED";
  }

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

  if (has(mercado, "handicap", "spread")) {
    const linha = linhaDoProg(prog);
    if (linha == null) return null;
    const lado = pickSide(prog);
    if (lado === "casa") return mandante + linha > visitante ? "GREEN" : "RED";
    if (lado === "fora") return visitante + linha > mandante ? "GREEN" : "RED";
  }

  if (has(mercado, "cornermatrix") || has(mercado, "escanteios", "cantos")) {
    if (has(pick, "casa mais", "mandante mais")) return mandante > visitante ? "GREEN" : "RED";
    if (has(pick, "fora mais", "visitante mais")) return visitante > mandante ? "GREEN" : "RED";
  }

  if (has(mercado, "resultado final", "moneyline")) {
    if (has(pick, "empate", "draw") || /\bx\b/.test(pick)) return mandante === visitante ? "GREEN" : "RED";
    const lado = pickSide(prog);
    if (lado === "casa" || /\b1\b/.test(pick)) return mandante > visitante ? "GREEN" : "RED";
    if (lado === "fora" || /\b2\b/.test(pick)) return visitante > mandante ? "GREEN" : "RED";
  }

  return null;
}
