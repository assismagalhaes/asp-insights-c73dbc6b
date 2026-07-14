import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_prognosticos",
  title: "Listar prognósticos",
  description:
    "Lista os prognósticos mais recentes do usuário autenticado (jogo, mercado, odd, edge, resultado).",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(10).describe("Quantos prognósticos retornar."),
    esporte: z.string().optional().describe("Filtrar por esporte (ex.: MLB, WNBA, Futebol)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, esporte }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("prognosticos")
      .select(
        "id, data, hora, esporte, liga, jogo, mercado, pick, odd_ofertada, edge, edge_ajustado, lucro_prejuizo, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (esporte) query = query.ilike("esporte", esporte);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
