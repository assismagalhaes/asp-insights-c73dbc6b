export interface PredictionContractInput {
  mercado?: string | null;
  pick?: string | null;
  linha?: string | number | null;
  esporte?: string | null;
  mandante?: string | null;
  visitante?: string | null;
  origem_modelo?: string | null;
  modelo?: string | null;
  selection_side?: string | null;
  opcao_1x2?: string | null;
}

export interface StandardPredictionContract {
  mercado: string;
  pick: string;
  linha: null;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+.-]+/g, " ")
    .trim();
}

function numericLine(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const match = text.match(/(^|\s)([+-]?\d+(?:\.\d+)?)(?=\s|$)/);
  if (!match) return null;
  const parsed = Number(match[2]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLine(value: number | null, signed = false) {
  if (value == null) return "";
  const decimals = Number.isInteger(Math.abs(value)) ? 0 : Number.isInteger(Math.abs(value) * 2) ? 1 : 2;
  const text = value.toFixed(decimals);
  return signed && value >= 0 ? `+${text}` : text;
}

function selectionSide(input: PredictionContractInput) {
  const pick = normalized(input.pick);
  const selection = normalized(input.selection_side);
  const option = normalized(input.opcao_1x2);
  const home = normalized(input.mandante);
  const away = normalized(input.visitante);

  if (["h", "1"].includes(option) || ["home", "casa", "mandante", "1"].includes(selection))
    return "home";
  if (["a", "2"].includes(option) || ["away", "fora", "visitante", "2"].includes(selection))
    return "away";
  if (["d", "x"].includes(option) || ["draw", "empate", "x"].includes(selection))
    return "draw";
  if (pick.includes("empate") || pick === "x") return "draw";
  if (/\b(casa|mandante|home)\b/.test(pick)) return "home";
  if (/\b(visitante|fora|away)\b/.test(pick)) return "away";
  if (home && (pick === home || pick.includes(home))) return "home";
  if (away && (pick === away || pick.includes(away))) return "away";
  return "";
}

function direction(input: PredictionContractInput) {
  const value = `${normalized(input.selection_side)} ${normalized(input.pick)} ${normalized(input.mercado)}`;
  if (value.includes("under")) return "under";
  if (value.includes("over")) return "over";
  return "";
}

function bttsSide(input: PredictionContractInput) {
  const value = `${normalized(input.selection_side)} ${normalized(input.pick)} ${normalized(input.mercado)}`;
  if (/\b(nao|no)\b/.test(value)) return "no";
  return /\b(sim|yes|btts)\b/.test(value) ? "yes" : "";
}

export function standardizePredictionContract(
  input: PredictionContractInput,
  modelName?: string | null,
): StandardPredictionContract {
  const explicitModel = modelName || input.origem_modelo || input.modelo;
  const marketAsModel = /matrix/i.test(String(input.mercado ?? "")) ? input.mercado : "";
  const model = normalized(explicitModel || marketAsModel);
  const sport = normalized(input.esporte);
  const market = normalized(input.mercado);
  const rawPick = String(input.pick ?? "").trim();
  const pick = normalized(rawPick);
  const line = numericLine(input.linha) ?? numericLine(input.pick);
  const side = selectionSide(input);
  const movement = direction(input);
  const isCornerContract = model.includes("cornermatrix") || /cantos|corner|race/.test(`${market} ${pick}`);
  let mercado = String(input.mercado ?? "").trim();
  let normalizedPick = rawPick;

  if (model.includes("goalmatrix")) {
    if (movement) {
      mercado = movement === "over" ? "Over Gols" : "Under Gols";
      normalizedPick = `${movement === "over" ? "Over" : "Under"} ${formatLine(line)}`.trim();
    } else {
      const btts = bttsSide(input);
      mercado = btts === "yes" ? "Ambas Marcam Sim" : "Ambas Marcam Não";
      normalizedPick = btts === "yes" ? "BTTS Sim" : "BTTS Não";
    }
  } else if (isCornerContract) {
    if (movement) {
      mercado = movement === "over" ? "Over Cantos" : "Under Cantos";
      normalizedPick = `${movement === "over" ? "Over" : "Under"} ${formatLine(line)}`.trim();
    } else if (market.includes("race") || pick.includes("race")) {
      mercado = "Race Cantos";
      normalizedPick = `Race ${formatLine(line)} Cantos ${side === "home" ? "Casa" : "Visitante"}`.trim();
    } else {
      mercado = "Mais Cantos";
      normalizedPick = side === "home" ? "Mais Cantos Casa" : "Mais Cantos Visitante";
    }
  } else if (model.includes("matchmatrix") || (["futebol", "soccer"].includes(sport) && !model)) {
    if (market.includes("dupla") || market.includes("double chance")) {
      mercado = "Dupla Chance";
      const token = pick.replace(/\s/g, "").toUpperCase();
      normalizedPick = ["1X", "12", "X2"].includes(token) ? token : rawPick.toUpperCase();
    } else if (movement) {
      mercado = movement === "over" ? "Over Gols" : "Under Gols";
      normalizedPick = `${movement === "over" ? "Over" : "Under"} ${formatLine(line)}`.trim();
    } else if (/ambas|btts/.test(`${market} ${pick}`)) {
      const btts = bttsSide(input);
      mercado = btts === "yes" ? "Ambas Marcam Sim" : "Ambas Marcam Não";
      normalizedPick = btts === "yes" ? "BTTS Sim" : "BTTS Não";
    } else if (market.includes("handicap") || pick.startsWith("ha ")) {
      mercado = "Handicap Asiático";
      normalizedPick = `HA ${side === "home" ? "Casa" : "Visitante"} ${formatLine(line, true)}`.trim();
    } else {
      mercado = "Moneyline";
      normalizedPick = `Moneyline ${side === "home" ? "Casa" : side === "away" ? "Visitante" : "Empate"}`;
    }
  } else if (model.includes("diamond")) {
    if (movement) {
      mercado = movement === "over" ? "Over Corridas" : "Under Corridas";
      normalizedPick = `${movement === "over" ? "Over" : "Under"} ${formatLine(line)}`.trim();
    } else if (/handicap|run line/.test(market) || pick.startsWith("ha ")) {
      mercado = "Handicap Asiático";
      normalizedPick = `HA ${side === "home" ? "Casa" : "Visitante"} ${formatLine(line, true)}`.trim();
    } else {
      mercado = "Moneyline";
      normalizedPick = side === "home" ? "Moneyline Casa" : "Moneyline Visitante";
    }
  } else if (model === "asp court" || model === "asp court w") {
    if (movement) {
      mercado = movement === "over" ? "Over Pontos" : "Under Pontos";
      normalizedPick = `${movement === "over" ? "Over" : "Under"} ${formatLine(line)}`.trim();
    } else if (/handicap|spread/.test(market) || pick.startsWith("ha ")) {
      mercado = "Handicap Asiático";
      normalizedPick = `HA ${side === "home" ? "Casa" : "Visitante"} ${formatLine(line, true)}`.trim();
    } else {
      mercado = "Moneyline";
      normalizedPick = side === "home" ? "Moneyline Casa" : "Moneyline Visitante";
    }
  } else if (line != null && !rawPick.includes(formatLine(line))) {
    normalizedPick = `${rawPick} ${formatLine(line, market.includes("handicap"))}`.trim();
  }

  return { mercado, pick: normalizedPick, linha: null };
}

export function getStandardMarket(input: PredictionContractInput) {
  return standardizePredictionContract(input).mercado;
}

export function getStandardPick(input: PredictionContractInput) {
  return standardizePredictionContract(input).pick;
}
