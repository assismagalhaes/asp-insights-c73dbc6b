import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_validacoes",
  title: "Listar validações",
  description:
    "Lista as validações de IA mais recentes do usuário (decisão, parecer, modo, prognóstico associado).",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(10),
    decisao: z.enum(["CONFIRMAR", "PULAR"]).optional().describe("Filtrar por decisão."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, decisao }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("validacoes")
      .select(
        "id, prognostico_id, decisao, decisao_ia_sugerida, modo_ia, parecer_validacao, data_analise_ia, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (decisao) query = query.eq("decisao", decisao);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
