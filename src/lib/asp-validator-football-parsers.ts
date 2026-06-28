/**
 * ASP Validator - Parsers modulares por mercado de futebol (texto colado).
 *
 * Cada parser e tolerante a:
 *  - Falta de acentos ("Nautico" vs "Nautico")
 *  - Quebras estranhas / ordem livre dos blocos
 *  - Sinonimos de periodo ("1 tempo", "1o tempo", "1T", "HT", "primeiro tempo")
 *  - Mercados em portugues e ingles
 *
 * Os parsers retornam estruturas independentes para serem combinadas pelo
 * orquestrador `buildStructuredPastedDataByMarket` em
 * `asp-validator-paste-parser.ts`.
 *
 * Importante: o parser de escanteios continua morando em
 * `asp-validator-paste-parser.ts` (corners/general/home_away) e e usado
 * diretamente quando market_type === "corners".
 */

import type { FootballPeriod } from "./asp-validator-market-detector";

/**
 * Particiona o texto colado em duas faixas — "geral" (Todos os locais)
 * e "home_away" (Casa/Fora para locais) — considerando que os marcadores
 * podem aparecer INTERCALADOS por seção (Total Gols, Ambas Marcam,
 * Desempenho geral, etc). Cada trecho entre um marcador e o próximo é
 * atribuído ao escopo do marcador que o abre. Texto antes do primeiro
 * marcador (cabeçalho da partida) é tratado como "geral".
 */
export function partitionByLocationScope(text: string): { generalText: string; homeAwayText: string } {
  const markerRe = /\(\s*(Todos\s+os\s+locais|Casa\s*\/\s*Fora(?:\s+para\s+(?:os\s+)?locais?)?)\s*\)/gi;
  const matches = [...text.matchAll(markerRe)];
  if (matches.length === 0) return { generalText: text, homeAwayText: "" };
  let generalText = "";
  let homeAwayText = "";
  const firstIdx = matches[0].index ?? 0;
  generalText += text.slice(0, firstIdx) + "\n";
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const chunk = text.slice(start, end);
    const isHA = /casa\s*\/\s*fora/i.test(m[1]);
    if (isHA) homeAwayText += chunk + "\n";
    else generalText += chunk + "\n";
  }
  return { generalText, homeAwayText };
}

export type GoalsLines = Record<string, number>;

export type GoalsSide = {
  total_for: number | null;
  total_against: number | null;
  total_goals: number | null;
  avg_for: number | null;
  avg_against: number | null;
  avg_total: number | null;
  over_lines: GoalsLines;
  under_lines: GoalsLines;
  btts_yes_pct: number | null;
  btts_no_pct: number | null;
  first_goal_pct: number | null;
  first_goal_no_pct: number | null;
  first_goal_and_win_pct: number | null;
};

export type GoalsBlock = {
  period: FootballPeriod;
  general: { home: GoalsSide; away: GoalsSide };
  home_away: { home: GoalsSide; away: GoalsSide };
};

export type CardsSide = {
  avg_total_cards: number | null;
  avg_cards_for: number | null;
  avg_cards_against: number | null;
  avg_yellow_total: number | null;
  avg_yellow_for: number | null;
  avg_yellow_against: number | null;
  avg_red_total: number | null;
  avg_red_for: number | null;
  avg_red_against: number | null;
  over_lines: GoalsLines;
  under_lines: GoalsLines;
};

export type CardsBlock = {
  period: FootballPeriod;
  general: { home: CardsSide; away: CardsSide };
  home_away: { home: CardsSide; away: CardsSide };
};

export type GeneralPerformanceSide = {
  wins: number | null;
  draws: number | null;
  losses: number | null;
  win_pct: number | null;
  draw_pct: number | null;
  loss_pct: number | null;
  efficiency_pct: number | null;
  avg_possession_pct: number | null;
  most_possession_1x2_pct: number | null;
  frequent_scores: Record<string, number>;
};

export type GeneralPerformanceBlock = {
  home: GeneralPerformanceSide;
  away: GeneralPerformanceSide;
};

export type BttsBlock = {
  home: { yes_pct: number | null; no_pct: number | null; first_goal_pct: number | null };
  away: { yes_pct: number | null; no_pct: number | null; first_goal_pct: number | null };
};

// ============================================================================
// Helpers compartilhados
// ============================================================================

function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function teamKey(s: string): string {
  return norm(s).replace(/[^a-z0-9]/g, "");
}

function num(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const v = Number(String(raw).replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function emptyGoalsSide(): GoalsSide {
  return {
    total_for: null,
    total_against: null,
    total_goals: null,
    avg_for: null,
    avg_against: null,
    avg_total: null,
    over_lines: {},
    under_lines: {},
    btts_yes_pct: null,
    btts_no_pct: null,
    first_goal_pct: null,
    first_goal_no_pct: null,
    first_goal_and_win_pct: null,
  };
}

function emptyCardsSide(): CardsSide {
  return {
    avg_total_cards: null,
    avg_cards_for: null,
    avg_cards_against: null,
    avg_yellow_total: null,
    avg_yellow_for: null,
    avg_yellow_against: null,
    avg_red_total: null,
    avg_red_for: null,
    avg_red_against: null,
    over_lines: {},
    under_lines: {},
  };
}

function emptyGeneralSide(): GeneralPerformanceSide {
  return {
    wins: null,
    draws: null,
    losses: null,
    win_pct: null,
    draw_pct: null,
    loss_pct: null,
    efficiency_pct: null,
    avg_possession_pct: null,
    most_possession_1x2_pct: null,
    frequent_scores: {},
  };
}

/**
 * Extrai blocos por time. Detecta cabecalhos do tipo:
 *   "Nautico:" / "Nautico (Casa):" / "Nautico (Casa/Fora):"
 * Le ate a proxima ocorrencia de cabecalho de time, secao "---" ou linha em branco dupla.
 */
function extractTeamBlocks(text: string, team: string): string[] {
  const tKey = teamKey(team);
  if (!tKey) return [];
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const isHeader = /:\s*$/.test(stripped) && teamKey(stripped).includes(tKey);
    if (!isHeader) {
      i += 1;
      continue;
    }
    const buf: string[] = [];
    let j = i + 1;
    let blank = 0;
    while (j < lines.length) {
      const next = lines[j];
      if (/^\s*$/.test(next)) {
        blank += 1;
        if (blank >= 2) break;
        j += 1;
        continue;
      }
      blank = 0;
      if (/:\s*$/.test(next.trim()) && !/^\s*-/.test(next)) break;
      if (/^---/.test(next.trim())) break;
      buf.push(next);
      j += 1;
    }
    blocks.push(buf.join("\n"));
    i = j;
  }
  return blocks;
}

/**
 * Para linhas "Mais de X.X: TimeA 70% | TimeB 50%", retorna o valor do time
 * cujo nome aparece compatível.
 */
function parseTwoSidedPercent(line: string, team: string): number | null {
  const tKey = teamKey(team);
  if (!tKey) return null;
  for (const part of line.split(/\s*\|\s*/)) {
    const pct = part.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
    if (!pct) continue;
    const key = teamKey(part);
    if (key.includes(tKey)) return num(pct[1]);
  }
  // fallback: primeiro percentual encontrado
  return null;
}

function extractSection(text: string, titles: string[]): string {
  for (const t of titles) {
    const re = new RegExp(`---\\s*${t}[^\\n]*---([\\s\\S]*?)(?:---|$)`, "i");
    const m = text.match(re);
    if (m) return m[1];
  }
  return "";
}

function extractPreferredSection(text: string, titles: string[], period?: FootballPeriod): string {
  const candidates: Array<{ body: string; context: string }> = [];
  for (const title of titles) {
    const re = new RegExp(`---\\s*${title}[^\\n]*---([\\s\\S]*?)(?=\\n\\s*---|$)`, "gi");
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      candidates.push({
        body: match[1] ?? "",
        context: text.slice(Math.max(0, start - 280), start),
      });
    }
  }
  if (candidates.length === 0) return "";

  const explicitPeriod = (candidate: { body: string; context: string }) => {
    const haystack = norm(`${candidate.context}\n${candidate.body}`);
    if (period === "HT") return /\b(1t|ht|primeiro\s+tempo|1\s*[oº°]?\s*tempo)\b/.test(haystack);
    if (period === "ST") return /\b(2t|st|segundo\s+tempo|2\s*[oº°]?\s*tempo)\b/.test(haystack);
    return /\bft\b|jogo\s+completo|full\s*time/.test(haystack);
  };

  const periodMatches = period ? candidates.filter(explicitPeriod) : [];
  return (periodMatches.at(-1) ?? candidates.at(-1))?.body ?? "";
}

function extractTeamPercent(block: string, team: string): number | null {
  const tKey = teamKey(team);
  if (!tKey) return null;
  for (const line of block.split(/\r?\n/)) {
    for (const part of line.split(/\s*\|\s*/)) {
      if (!teamKey(part).includes(tKey)) continue;
      const pct = part.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
      if (pct) return num(pct[1]);
    }
  }
  return null;
}

// ============================================================================
// parseFootballGeneralPerformance
// ============================================================================

export function parseFootballGeneralPerformance(
  text: string,
  homeTeam: string,
  awayTeam: string,
  period: FootballPeriod = "FT",
): GeneralPerformanceBlock {
  const out: GeneralPerformanceBlock = { home: emptyGeneralSide(), away: emptyGeneralSide() };
  if (!homeTeam && !awayTeam) return out;

  const perfSection =
    extractPreferredSection(text, ["DESEMPENHO\\s+GERAL", "DESEMPENHO"], period) || text;
  const possSection = extractPreferredSection(text, ["M[ÉE]DIA\\s+POSSE\\s+DE\\s+BOLA", "POSSE\\s+DE\\s+BOLA", "POSSE"], period) || "";
  const scoresSection = extractPreferredSection(text, [
    "RESULTADOS\\s+MAIS\\s+FREQUENTES",
    "PLACARES?\\s+MAIS\\s+FREQUENTES",
    "PLACARES?",
  ], period) || "";

  for (const [team, side] of [
    [homeTeam, out.home] as const,
    [awayTeam, out.away] as const,
  ]) {
    if (!team) continue;
    for (const block of extractTeamBlocks(perfSection, team)) {
      const wins = num(block.match(/Vit[oó]rias?\s*:?\s*(\d+(?:[.,]\d+)?)/i)?.[1]);
      const draws = num(block.match(/Empates?\s*:?\s*(\d+(?:[.,]\d+)?)/i)?.[1]);
      const losses = num(block.match(/Derrotas?\s*:?\s*(\d+(?:[.,]\d+)?)/i)?.[1]);
      const efic = num(
        block.match(/Efici[eê]ncia\s*:?\s*(-?\d+(?:[.,]\d+)?)\s*%?/i)?.[1] ??
          block.match(/Aproveitamento\s*:?\s*(-?\d+(?:[.,]\d+)?)\s*%?/i)?.[1],
      );
      if (wins !== null) side.wins = side.wins ?? wins;
      if (draws !== null) side.draws = side.draws ?? draws;
      if (losses !== null) side.losses = side.losses ?? losses;
      if (efic !== null) side.efficiency_pct = side.efficiency_pct ?? efic;
      const total = (side.wins ?? 0) + (side.draws ?? 0) + (side.losses ?? 0);
      if (total > 0) {
        side.win_pct = side.win_pct ?? Math.round(((side.wins ?? 0) / total) * 100);
        side.draw_pct = side.draw_pct ?? Math.round(((side.draws ?? 0) / total) * 100);
        side.loss_pct = side.loss_pct ?? Math.round(((side.losses ?? 0) / total) * 100);
      }
    }
    if (possSection) {
      const poss = extractTeamPercent(possSection, team);
      if (poss !== null) side.avg_possession_pct = poss;
      const mostPoss = possSection.match(
        new RegExp(`mais\\s+posse[^\\n]*\\n[\\s\\S]{0,200}?${teamKey(team)}[^%]*?(\\d+(?:[.,]\\d+)?)\\s*%`, "i"),
      );
      if (mostPoss) side.most_possession_1x2_pct = num(mostPoss[1]);
    }
    if (scoresSection) {
      for (const line of scoresSection.split(/\r?\n/)) {
        const score = line.match(/(\d+)\s*x\s*(\d+)/);
        const pct = line.match(/(-?\d+(?:[.,]\d+)?)\s*%/);
        if (score && pct) {
          side.frequent_scores[`${score[1]}x${score[2]}`] = num(pct[1]) ?? 0;
        }
      }
    }
  }
  return out;
}

// ============================================================================
// parseFootballGoalsData
// ============================================================================

export function parseFootballGoalsData(
  text: string,
  homeTeam: string,
  awayTeam: string,
  period: FootballPeriod,
): GoalsBlock {
  const out: GoalsBlock = {
    period,
    general: { home: emptyGoalsSide(), away: emptyGoalsSide() },
    home_away: { home: emptyGoalsSide(), away: emptyGoalsSide() },
  };

  const { generalText, homeAwayText } = partitionByLocationScope(text);

  fillGoalsSection(out.general, generalText, homeTeam, awayTeam);
  if (homeAwayText) fillGoalsSection(out.home_away, homeAwayText, homeTeam, awayTeam);

  return out;
}

function fillGoalsSection(
  target: { home: GoalsSide; away: GoalsSide },
  text: string,
  homeTeam: string,
  awayTeam: string,
): void {
  // Blocos "TIME:" com Marcados/Sofridos/Total e medias
  for (const [team, side] of [
    [homeTeam, target.home] as const,
    [awayTeam, target.away] as const,
  ]) {
    if (!team) continue;
    for (const block of extractTeamBlocks(text, team)) {
      const marcados = num(block.match(/Marcados?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const sofridos = num(block.match(/Sofridos?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const total = num(block.match(/Total(?:\s*\([^)]*\))?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const isAverage =
        (marcados !== null && !Number.isInteger(marcados)) ||
        (sofridos !== null && !Number.isInteger(sofridos)) ||
        (total !== null && !Number.isInteger(total));
      if (isAverage) {
        side.avg_for = side.avg_for ?? marcados;
        side.avg_against = side.avg_against ?? sofridos;
        side.avg_total = side.avg_total ?? total;
      } else {
        side.total_for = side.total_for ?? marcados;
        side.total_against = side.total_against ?? sofridos;
        side.total_goals = side.total_goals ?? total;
      }
    }
  }

  // Over/Under gols: "Mais de X.X: TimeA 70% | TimeB 50%"
  for (const line of text.split(/\r?\n/)) {
    const overM = line.match(/^\s*(?:Mais\s+de|Over|\+)\s*(\d+(?:[.,]\d+)?)\s*(?:gols?)?\s*[:\-]?\s*(.+)$/i);
    const underM = line.match(/^\s*(?:Menos\s+de|Under|-)\s*(\d+(?:[.,]\d+)?)\s*(?:gols?)?\s*[:\-]?\s*(.+)$/i);
    if (overM) {
      const lk = overM[1].replace(",", ".");
      const hv = parseTwoSidedPercent(overM[2], homeTeam);
      const av = parseTwoSidedPercent(overM[2], awayTeam);
      if (hv !== null) target.home.over_lines[lk] = hv;
      if (av !== null) target.away.over_lines[lk] = av;
    } else if (underM) {
      const lk = underM[1].replace(",", ".");
      const hv = parseTwoSidedPercent(underM[2], homeTeam);
      const av = parseTwoSidedPercent(underM[2], awayTeam);
      if (hv !== null) target.home.under_lines[lk] = hv;
      if (av !== null) target.away.under_lines[lk] = av;
    }
  }

  // BTTS Sim/Nao
  const bttsSect = extractSection(text, ["AMBAS\\s+MARCAM", "BTTS"]);
  if (bttsSect) {
    const simSect = bttsSect.match(/Sim:?([\s\S]*?)(?:N[aã]o|$)/i)?.[1] ?? "";
    const naoSect = bttsSect.match(/N[aã]o:?([\s\S]*?)$/i)?.[1] ?? "";
    const hYes = extractTeamPercent(simSect, homeTeam);
    const aYes = extractTeamPercent(simSect, awayTeam);
    const hNo = extractTeamPercent(naoSect, homeTeam);
    const aNo = extractTeamPercent(naoSect, awayTeam);
    if (hYes !== null) target.home.btts_yes_pct = hYes;
    if (aYes !== null) target.away.btts_yes_pct = aYes;
    if (hNo !== null) target.home.btts_no_pct = hNo;
    if (aNo !== null) target.away.btts_no_pct = aNo;
  }

  // Marcou primeiro
  const firstSect = extractSection(text, ["MARCOU\\s+(?:O\\s+)?PRIMEIRO(?:\\s+GOL)?", "PRIMEIRO\\s+GOL"]);
  if (firstSect) {
    const simSect = firstSect.match(/Sim:?([\s\S]*?)(?:N[aã]o|---|$)/i)?.[1] ?? firstSect;
    const naoSect = firstSect.match(/N[aã]o:?([\s\S]*?)(?:---|$)/i)?.[1] ?? "";
    const hY = extractTeamPercent(simSect, homeTeam);
    const aY = extractTeamPercent(simSect, awayTeam);
    const hN = extractTeamPercent(naoSect, homeTeam);
    const aN = extractTeamPercent(naoSect, awayTeam);
    if (hY !== null) target.home.first_goal_pct = hY;
    if (aY !== null) target.away.first_goal_pct = aY;
    if (hN !== null) target.home.first_goal_no_pct = hN;
    if (aN !== null) target.away.first_goal_no_pct = aN;
  }

  const firstWinSect = extractSection(text, [
    "MARCOU\\s+PRIMEIRO\\s+E\\s+GANHOU\\s+O\\s+JOGO",
    "MARCOU\\s+PRIMEIRO\\s+E\\s+VENCEU",
  ]);
  if (firstWinSect) {
    const h = extractTeamPercent(firstWinSect, homeTeam);
    const a = extractTeamPercent(firstWinSect, awayTeam);
    if (h !== null) target.home.first_goal_and_win_pct = h;
    if (a !== null) target.away.first_goal_and_win_pct = a;
  }
}

// ============================================================================
// parseFootballCardsData
// ============================================================================

export function parseFootballCardsData(
  text: string,
  homeTeam: string,
  awayTeam: string,
  period: FootballPeriod,
): CardsBlock {
  const out: CardsBlock = {
    period,
    general: { home: emptyCardsSide(), away: emptyCardsSide() },
    home_away: { home: emptyCardsSide(), away: emptyCardsSide() },
  };

  const { generalText, homeAwayText } = partitionByLocationScope(text);

  fillCardsSection(out.general, generalText, homeTeam, awayTeam);
  if (homeAwayText) fillCardsSection(out.home_away, homeAwayText, homeTeam, awayTeam);

  return out;
}

function fillCardsSection(
  target: { home: CardsSide; away: CardsSide },
  text: string,
  homeTeam: string,
  awayTeam: string,
): void {
  for (const [team, side] of [
    [homeTeam, target.home] as const,
    [awayTeam, target.away] as const,
  ]) {
    if (!team) continue;
    for (const block of extractTeamBlocks(text, team)) {
      const lower = block.toLowerCase();
      const totalAvg = num(block.match(/Total(?:\s+de\s+cart[oõ]es)?(?:\s+por\s+jogo)?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const yellow = num(block.match(/(?:Amarel[oa]s?)\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const red = num(block.match(/(?:Vermelh[oa]s?)\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const marcados = num(block.match(/(?:Marcad|Recebid|Aplicad|Tomad)[oa]s?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      const sofridos = num(block.match(/Sofridos?\s*:?\s*(-?\d+(?:[.,]\d+)?)/i)?.[1]);
      if (totalAvg !== null) side.avg_total_cards = side.avg_total_cards ?? totalAvg;
      if (yellow !== null) side.avg_yellow_total = side.avg_yellow_total ?? yellow;
      if (red !== null) side.avg_red_total = side.avg_red_total ?? red;
      if (marcados !== null) side.avg_cards_for = side.avg_cards_for ?? marcados;
      if (sofridos !== null) side.avg_cards_against = side.avg_cards_against ?? sofridos;
      void lower;
    }
  }
  // Over/Under cartoes
  for (const line of text.split(/\r?\n/)) {
    const overM = line.match(/^\s*(?:Mais\s+de|Over|\+)\s*(\d+(?:[.,]\d+)?)\s*(?:cart[oõ]es)?\s*[:\-]?\s*(.+)$/i);
    const underM = line.match(/^\s*(?:Menos\s+de|Under|-)\s*(\d+(?:[.,]\d+)?)\s*(?:cart[oõ]es)?\s*[:\-]?\s*(.+)$/i);
    if (overM && /cart/i.test(line)) {
      const lk = overM[1].replace(",", ".");
      const hv = parseTwoSidedPercent(overM[2], homeTeam);
      const av = parseTwoSidedPercent(overM[2], awayTeam);
      if (hv !== null) target.home.over_lines[lk] = hv;
      if (av !== null) target.away.over_lines[lk] = av;
    } else if (underM && /cart/i.test(line)) {
      const lk = underM[1].replace(",", ".");
      const hv = parseTwoSidedPercent(underM[2], homeTeam);
      const av = parseTwoSidedPercent(underM[2], awayTeam);
      if (hv !== null) target.home.under_lines[lk] = hv;
      if (av !== null) target.away.under_lines[lk] = av;
    }
  }
}

// ============================================================================
// parseFootballBttsData - deriva de GoalsBlock
// ============================================================================

export function parseFootballBttsData(goals: GoalsBlock): BttsBlock {
  return {
    home: {
      yes_pct: goals.general.home.btts_yes_pct,
      no_pct: goals.general.home.btts_no_pct,
      first_goal_pct: goals.general.home.first_goal_pct,
    },
    away: {
      yes_pct: goals.general.away.btts_yes_pct,
      no_pct: goals.general.away.btts_no_pct,
      first_goal_pct: goals.general.away.first_goal_pct,
    },
  };
}
