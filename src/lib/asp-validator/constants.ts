// Constantes extraídas de src/routes/_authenticated/asp-validator.tsx
import { supabase } from "@/lib/supabase-public";
import type {
  ValidatorForm,
  ValidatorRecord,
  ValidatorUploadRecord,
  ValidatorDashboardFilters,
} from "./types";

export const validatorDb = supabase as unknown as {
  from: (table: "asp_validator_registros") => {
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => Promise<{ data: ValidatorRecord[] | null; error: Error | null }>;
      };
    };
    insert: (payload: unknown) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: Error | null }>;
      };
    };
    update: (payload: unknown) => {
      eq: (column: string, value: string) => Promise<{ error: Error | null }>;
    };
    delete: () => {
      eq: (column: string, value: string) => Promise<{ error: Error | null }>;
    };
  };
} & {
  from: (table: "asp_validator_uploads") => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: ValidatorUploadRecord[] | null; error: Error | null }>;
      };
    };
    insert: (payload: unknown) => Promise<{ error: Error | null }>;
    update: (payload: unknown) => {
      eq: (column: string, value: string) => Promise<{ error: Error | null }>;
    };
  };
};

export const ASP_VALIDATOR_RECORD_LIST_COLUMNS = [
  "id",
  "source_platform",
  "sport",
  "league",
  "match_date",
  "home_team",
  "away_team",
  "market",
  "pick",
  "line",
  "offered_odd",
  "source_probability",
  "source_ev",
  "source_fair_odd",
  "adjusted_probability",
  "adjusted_fair_odd",
  "adjusted_ev",
  "decision",
  "confidence",
  "validator_model",
  "user_context",
  "analysis_context",
  "favorable_blocks",
  "against_blocks",
  "alerts",
  "final_analysis",
  "simulation_json",
  "online_context_json",
  "ocr_raw_text",
  "ocr_structured_data",
  "ocr_data_quality_score",
  "ocr_structured_fields_count",
  "simulation_type",
  "structured_json",
  "structured_status",
  "structured_error",
  "result_status",
  "result_settled_at",
  "final_score",
  "result_notes",
  "created_at",
  "updated_at",
  "stake_units",
  "unit_value_brl",
  "profit_units",
  "profit_brl",
  "clv",
  "is_simulated_result",
  "bankroll_applied",
].join(",");

export const ASP_VALIDATOR_UPLOAD_LIST_COLUMNS = [
  "id",
  "validator_id",
  "file_name",
  "file_path",
  "storage_bucket",
  "file_type",
  "mime_type",
  "file_size",
  "upload_source",
  "upload_category",
  "user_comment",
  "upload_order",
  "ocr_status",
  "ocr_text",
  "ocr_error",
  "ocr_structured_data",
  "ocr_data_quality_score",
  "ocr_structured_fields_count",
  "structured_json",
  "structured_status",
  "structured_error",
  "created_at",
  "updated_at",
].join(",");

export const ASP_VALIDATOR_UPLOAD_BUCKET = "asp-validator-uploads";

export const INITIAL_FORM: ValidatorForm = {
  sport: "Futebol",
  source_platform: "Manual",
  league: "",
  match_date: "",
  home_team: "",
  away_team: "",
  market: "",
  pick: "",
  line: "",
  offered_odd: "",
  source_probability: "",
  source_ev: "",
  user_context: "",
};

export const SPORTS = [
  "Futebol",
  "Baseball",
  "Basketball",
  "Hockey",
  "American Football",
  "Tenis",
  "Outro",
];
export const PLATFORMS = [
  "Manual",
  "ASP Screener MLB",
  "PackBall",
  "Forebet",
  "BetClan",
  "Flashscore",
  "Outro",
];
export const MARKETS = [
  "Moneyline",
  "Resultado da Partida",
  "Total de Gols",
  "Total de Pontos",
  "Total de Corridas",
  "Over/Under",
  "Handicap Asiatico",
  "Asian Handicap",
  "Dupla Chance",
  "Ambas Marcam",
  "Escanteios",
  "Cartoes",
  "HT/ST",
  "Outro",
];
export const UPLOAD_CATEGORIES = [
  "Prognostico principal",
  "Ultimos jogos gerais",
  "Casa/Fora",
  "Estatisticas do mercado",
  "Classificacao/contexto",
  "Outro",
];

export const INITIAL_DASHBOARD_FILTERS: ValidatorDashboardFilters = {
  period: "all",
  sport: "all",
  league: "all",
  source_platform: "all",
  validator_model: "all",
  market: "all",
  decision: "all",
  result: "all",
};
