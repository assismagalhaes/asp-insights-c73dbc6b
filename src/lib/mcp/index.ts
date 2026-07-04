import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listPrognosticos from "./tools/list-prognosticos";
import listValidacoes from "./tools/list-validacoes";
import bankrollStatus from "./tools/bankroll-status";

// The OAuth issuer MUST be the direct Supabase host (not the .lovable.cloud proxy).
// Read the project ref via VITE_SUPABASE_PROJECT_ID so it's inlined at build.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "asp-insights-mcp",
  title: "ASP Insights",
  version: "0.1.0",
  instructions:
    "Ferramentas para consultar prognósticos esportivos, validações de IA e status da banca no ASP Insights. Todas as leituras são escopadas ao usuário autenticado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listPrognosticos, listValidacoes, bankrollStatus],
});
