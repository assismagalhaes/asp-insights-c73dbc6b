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
      order: (column: string, options: { ascending: boolean }) => {
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
      in: (column: string, values: string[]) => {
        order: (column: string, options: { ascending: boolean }) => Promise<{ data: ValidatorUploadRecord[] | null; error: Error | null }>;
      };
    };
    insert: (payload: unknown) => Promise<{ error: Error | null }>;
    update: (payload: unknown) => {
      eq: (column: string, value: string) => Promise<{ error: Error | null }>;
    };
  };
};

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

export const SPORTS = ["Futebol", "Baseball", "Basketball", "Hockey", "American Football", "Tenis", "Outro"];
export const PLATFORMS = ["Manual", "ASP Screener MLB", "PackBall", "Forebet", "BetClan", "Flashscore", "Outro"];
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
