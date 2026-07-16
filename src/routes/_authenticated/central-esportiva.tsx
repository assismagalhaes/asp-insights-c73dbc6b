import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import {
  CentralEsportiva,
  type CentralEsportivaSearch,
} from "@/components/highlightly-analysis/central-esportiva";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { featureFlags } from "@/lib/feature-flags";
import type { AnalysisSportFilter } from "@/lib/highlightly-analysis";

function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

function validSport(value: unknown): AnalysisSportFilter {
  return ["all", "football", "baseball", "basketball"].includes(String(value))
    ? (value as AnalysisSportFilter)
    : "all";
}

export const Route = createFileRoute("/_authenticated/central-esportiva")({
  validateSearch: (search: Record<string, unknown>): CentralEsportivaSearch => ({
    sport: validSport(search.sport),
    date:
      typeof search.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.date)
        ? search.date
        : today(),
    match: typeof search.match === "string" && search.match ? search.match : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Central de Análises — ASP Insights" },
      {
        name: "description",
        content: "Partidas, estatísticas e odds normalizadas da Highlightly.",
      },
    ],
  }),
  component: CentralEsportivaRoute,
});

function CentralEsportivaRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  if (!featureFlags.highlightlyAnalysis) {
    return (
      <div className="flex min-h-[calc(100dvh-6.5rem)] items-center justify-center p-4">
        <Alert className="max-w-lg">
          <LockKeyhole />
          <AlertTitle>Central Esportiva em rollout controlado</AlertTitle>
          <AlertDescription>
            A interface está instalada, mas a feature flag permanece desligada até a etapa de shadow
            e ativação administrativa.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <CentralEsportiva
      search={search}
      onSearchChange={(next, replace = false) => navigate({ search: next, replace })}
    />
  );
}
