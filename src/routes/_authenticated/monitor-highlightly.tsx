import { createFileRoute } from "@tanstack/react-router";
import { HighlightlyCollectionMonitorView } from "@/components/highlightly-analysis/collection-monitor";

export const Route = createFileRoute("/_authenticated/monitor-highlightly")({
  head: () => ({
    meta: [
      { title: "Monitor Highlightly — ASP Insights" },
      {
        name: "description",
        content: "Monitor administrativo da coleta esportiva Highlightly.",
      },
    ],
  }),
  component: HighlightlyCollectionMonitorView,
});
