import { todayBR } from "@/lib/date-br";
import type { EditableRecord, ResultForm, ValidatorRecord } from "./types";
import { numberToInput, round } from "./formatters";

export function recordToEditable(record: ValidatorRecord): EditableRecord {
  return {
    sport: record.sport,
    source_platform: record.source_platform,
    league: record.league ?? "",
    match_date: record.match_date ?? "",
    home_team: record.home_team,
    away_team: record.away_team,
    market: record.market,
    pick: record.pick,
    line: record.line ?? "",
    offered_odd: numberToInput(record.offered_odd),
    source_probability: numberToInput(record.source_probability),
    source_fair_odd: numberToInput(record.source_fair_odd),
    source_ev: numberToInput(record.source_ev),
    user_context: record.user_context ?? "",
  };
}

export function recordToResultForm(record: ValidatorRecord, defaultUnitValue: number): ResultForm {
  return {
    result_status: record.result_status || "PENDENTE",
    final_odd: numberToInput(record.offered_odd),
    stake_units: numberToInput(record.stake_units ?? 1),
    unit_value_brl: numberToInput(record.unit_value_brl ?? defaultUnitValue),
    clv: numberToInput(record.clv),
    final_score: record.final_score ?? "",
    result_notes: record.result_notes ?? "",
    result_settled_at: record.result_settled_at ?? todayBR(),
  };
}

export function calculateValidatorProfitUnits(status: string, stake: number, odd: number): number {
  switch (status.toUpperCase()) {
    case "GREEN":
      return round(stake * (odd - 1), 4);
    case "RED":
      return round(-stake, 4);
    case "PUSH":
    case "VOID":
      return 0;
    default:
      return 0;
  }
}
