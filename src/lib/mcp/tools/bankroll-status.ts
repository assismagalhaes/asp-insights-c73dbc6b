import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "bankroll_status",
  title: "Status da banca",
  description:
    "Retorna o snapshot mais recente da banca (banca atual, ROI, yield, drawdown, lucro acumulado).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("bankroll_historico")
      .select(
        "data, banca_inicial, banca_atual, lucro_acumulado, roi, yield, drawdown, valor_unidade",
      )
      .order("data", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Sem histórico de banca ainda." }] };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { snapshot: data },
    };
  },
});
