import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ClipboardCopy, DatabaseZap, FileJson, RefreshCw, RotateCw, Send, Trophy, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchOddsRows,
  NORMALIZED_PREVIEW_STORAGE_KEY,
  parseStoredNormalizedPreview,
  type NormalizedOdd,
} from "@/lib/coleta-dados";
import { useCreatePrognostico } from "@/lib/db";
import {
  getMlbStandingsSnapshotFn,
  processManualMlbStandingsCsv,
  refreshMlbStandingsFromBaseballReference,
} from "@/lib/mlb-standings.functions";
import {
  createScreenerValidatorHandoffAudit,
  listScreenerValidatorHandoffs,
} from "@/lib/mlb/screenerHandoffAuditService";
import {
  listMlbDailyScreenerSnapshots,
  listMlbOpportunitySnapshots,
  linkMlbOpportunitySnapshotToHandoff,
  saveMlbScreenerRunSnapshot,
} from "@/lib/mlb/screenerSnapshotService";
import { enrichMlbGamesWithStandings } from "@/lib/mlb/standings";
import {
  buildMlbCriticalValidationPayload,
  buildMlbHandicapScreenerRows,
  buildMlbMoneylineScreenerRows,
  buildMlbOpportunityValidationPayload,
  buildMlbOpportunityShortlist,
  buildMlbValidatorHandoffPayload,
  buildMlbTotalsScreenerRows,
  buildMlbValidatorPrompt,
  calculateMlbContextAlignment,
  isMlbOpportunityEligibleForCriticalValidation,
  parseBaseballReferenceMatchupText,
  storeMlbValidatorHandoffDraft,
  validateMlbValidatorHandoffPayload,
} from "@/lib/mlb/projections";
import {
  buildCriticalValidationPrognosticoInput,
  buildMlbCriticalValidationDraft,
  validateCriticalValidationDraft,
} from "@/lib/mlb/screenerToCriticalValidationAdapter";
import type {
  MlbHandicapCandidateStatus,
  MlbHandicapFilter,
  MlbHandicapScreenerRow,
  MlbMoneylineScreenerRow,
  MlbOpportunityFilter,
  MlbProjectionCandidateStatus,
  MlbTotalsFilter,
  MlbTotalsScreenerRow,
  MlbUnifiedOpportunity,
} from "@/types/mlbProjections";
import type { MlbBaseballReferenceMatchupContext, MlbPreparedCriticalValidationPayload } from "@/types/mlbCriticalValidation";
import type { MlbScreenerHandoffAuditRecord, MlbScreenerHandoffAuditStatus } from "@/types/mlbScreenerHandoffAudit";
import type { MlbDailyScreenerSnapshotRecord, MlbOpportunitySnapshotRecord } from "@/types/mlbScreenerSnapshots";
import type { MlbStandingsSnapshot, MlbTeamStanding } from "@/types/mlbStandings";
import type { MlbValidatorHandoffPayload } from "@/types/mlbValidatorHandoff";

export const Route = createFileRoute("/_authenticated/asp-screener")({
  component: AspScreenerPage,
});

type SnapshotResponse = {
  snapshot: MlbStandingsSnapshot | null;
  oddsRowsCount: number;
  fromCache: boolean;
};

function AspScreenerPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const createPrognostico = useCreatePrognostico();
  const [snapshotDate, setSnapshotDate] = useState(todayIso());
  const [season, setSeason] = useState(new Date().getUTCFullYear());
  const [loadedScreenerStateKey, setLoadedScreenerStateKey] = useState(() => buildMlbScreenerUiStateKey(todayIso(), new Date().getUTCFullYear()));
  const [busy, setBusy] = useState<string | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [projectionRows, setProjectionRows] = useState<MlbMoneylineScreenerRow[]>([]);
  const [projectionFilter, setProjectionFilter] = useState<MlbProjectionCandidateStatus | "todos">("todos");
  const [projectionGeneratedAt, setProjectionGeneratedAt] = useState<string | null>(null);
  const [totalsRows, setTotalsRows] = useState<MlbTotalsScreenerRow[]>([]);
  const [totalsFilter, setTotalsFilter] = useState<MlbTotalsFilter>("todos");
  const [totalsGeneratedAt, setTotalsGeneratedAt] = useState<string | null>(null);
  const [handicapRows, setHandicapRows] = useState<MlbHandicapScreenerRow[]>([]);
  const [handicapFilter, setHandicapFilter] = useState<MlbHandicapFilter>("todos");
  const [handicapGeneratedAt, setHandicapGeneratedAt] = useState<string | null>(null);
  const [opportunityRows, setOpportunityRows] = useState<MlbUnifiedOpportunity[]>([]);
  const [opportunityFilter, setOpportunityFilter] = useState<MlbOpportunityFilter>("shortlist");
  const [opportunityGeneratedAt, setOpportunityGeneratedAt] = useState<string | null>(null);
  const [hideCorrelatedAlternatives, setHideCorrelatedAlternatives] = useState(false);
  const [minOpportunityEv, setMinOpportunityEv] = useState("");
  const [minOpportunityScore, setMinOpportunityScore] = useState("");
  const [selectedOpportunityIds, setSelectedOpportunityIds] = useState<string[]>([]);
  const [baseballReferenceText, setBaseballReferenceText] = useState("");
  const [parsedMatchupContext, setParsedMatchupContext] = useState<MlbBaseballReferenceMatchupContext | null>(null);
  const [criticalPayloads, setCriticalPayloads] = useState<MlbPreparedCriticalValidationPayload[]>([]);
  const [auditPeriod, setAuditPeriod] = useState<"all" | "today" | "7d" | "30d">("30d");
  const [auditStatusFilter, setAuditStatusFilter] = useState<MlbScreenerHandoffAuditStatus | "all">("all");
  const [auditMarketFilter, setAuditMarketFilter] = useState("all");
  const [auditDecisionFilter, setAuditDecisionFilter] = useState<"all" | "CONFIRMAR" | "PULAR" | "pending">("all");
  const [auditMinScore, setAuditMinScore] = useState("");
  const [auditMinEv, setAuditMinEv] = useState("");
  const [calibrationStatusFilter, setCalibrationStatusFilter] = useState<MlbScreenerHandoffAuditStatus | "all">("all");
  const [calibrationMarketFilter, setCalibrationMarketFilter] = useState("all");
  const [calibrationDecisionFilter, setCalibrationDecisionFilter] = useState<"all" | "CONFIRMAR" | "PULAR" | "pending">("all");
  const [calibrationPriorityFilter, setCalibrationPriorityFilter] = useState("all");
  const [calibrationReadinessFilter, setCalibrationReadinessFilter] = useState("all");
  const [calibrationAlignmentFilter, setCalibrationAlignmentFilter] = useState("all");
  const [calibrationMinScore, setCalibrationMinScore] = useState("");
  const [calibrationMaxScore, setCalibrationMaxScore] = useState("");
  const [calibrationMinConfidence, setCalibrationMinConfidence] = useState("");
  const [calibrationMaxConfidence, setCalibrationMaxConfidence] = useState("");
  const [calibrationMinEv, setCalibrationMinEv] = useState("");
  const [calibrationHomeTeam, setCalibrationHomeTeam] = useState("");
  const [calibrationAwayTeam, setCalibrationAwayTeam] = useState("");
  const [calibrationSource, setCalibrationSource] = useState<"handoffs" | "snapshots" | "both">("handoffs");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [selectedDailySnapshotId, setSelectedDailySnapshotId] = useState<string | null>(null);
  const [snapshotMarketFilter, setSnapshotMarketFilter] = useState("all");
  const [snapshotStatusFilter, setSnapshotStatusFilter] = useState("all");
  const [snapshotSentFilter, setSnapshotSentFilter] = useState<"all" | "sent" | "not_sent">("all");
  const [snapshotDecisionFilter, setSnapshotDecisionFilter] = useState<"all" | "CONFIRMAR" | "PULAR" | "pending">("all");
  const [snapshotMinScore, setSnapshotMinScore] = useState("");
  const [snapshotMinEv, setSnapshotMinEv] = useState("");
  const [previewOddsRows, setPreviewOddsRows] = useState<NormalizedOdd[]>([]);

  const queryKey = ["mlb-standings-snapshot", snapshotDate, season];
  const { data, isFetching } = useQuery({
    queryKey,
    queryFn: () => getMlbStandingsSnapshotFn({ data: { snapshotDate, season } }) as Promise<SnapshotResponse>,
  });
  const { data: oddsRows = [], error: oddsRowsError, isFetching: loadingOddsRows } = useQuery({
    queryKey: ["odds-jogos-mlb-screener", snapshotDate],
    queryFn: () =>
      fetchOddsRows({
        date: snapshotDate,
        esporte: "Baseball",
        liga: "MLB",
        limit: 20000,
        includeCollectionFallback: true,
      }),
  });

  useEffect(() => {
    const readPreview = () => {
      const raw =
        window.sessionStorage.getItem(NORMALIZED_PREVIEW_STORAGE_KEY) ??
        window.localStorage.getItem(NORMALIZED_PREVIEW_STORAGE_KEY);
      const normalized = parseStoredNormalizedPreview(raw);
      setPreviewOddsRows(normalized?.rows ?? []);
    };
    readPreview();
    window.addEventListener("storage", readPreview);
    return () => window.removeEventListener("storage", readPreview);
  }, [snapshotDate]);
  const {
    data: handoffAuditRows = [],
    isFetching: loadingHandoffAudit,
    refetch: refetchHandoffAudit,
  } = useQuery({
    queryKey: ["mlb-screener-validator-handoffs", auditPeriod],
    queryFn: () => listScreenerValidatorHandoffs({ period: auditPeriod, limit: 500 }),
  });
  const {
    data: dailySnapshots = [],
    isFetching: loadingDailySnapshots,
    refetch: refetchDailySnapshots,
  } = useQuery({
    queryKey: ["mlb-screener-daily-snapshots"],
    queryFn: () => listMlbDailyScreenerSnapshots(25),
  });
  const {
    data: selectedSnapshotOpportunities = [],
    isFetching: loadingSnapshotOpportunities,
    refetch: refetchSnapshotOpportunities,
  } = useQuery({
    queryKey: ["mlb-screener-opportunity-snapshots", selectedDailySnapshotId],
    queryFn: () => selectedDailySnapshotId ? listMlbOpportunitySnapshots({ dailySnapshotId: selectedDailySnapshotId, limit: 1500 }) : Promise.resolve([]),
  });

  const snapshot = data?.snapshot ?? null;
  const mlbDbOddsRows = useMemo(
    () =>
      oddsRows.filter((row) => {
        if (!isSameDate(row.data, snapshotDate)) return false;
        if (!isBaseballSport(row.esporte)) return false;
        return isMlbLeague(row.liga);
      }),
    [oddsRows, snapshotDate],
  );
  const mlbPreviewOddsRows = useMemo(
    () =>
      previewOddsRows.filter((row) => {
        if (!isSameDate(row.data, snapshotDate)) return false;
        if (!isBaseballSport(row.esporte)) return false;
        return isMlbLeague(row.liga);
      }),
    [previewOddsRows, snapshotDate],
  );
  const mlbOddsRows = useMemo(
    () => (mlbDbOddsRows.length ? mlbDbOddsRows : mlbPreviewOddsRows),
    [mlbDbOddsRows, mlbPreviewOddsRows],
  );
  const usingSavedCollectionRows = mlbDbOddsRows.some((row) => row.raw_ref?.screener_source === "coletas_odds_payload");
  const mlbOddsSourceLabel = loadingOddsRows
    ? "Carregando..."
    : usingSavedCollectionRows
      ? "Coleta salva"
      : mlbDbOddsRows.length
        ? "Banco odds_jogos"
        : mlbPreviewOddsRows.length
          ? "Preview normalizado"
          : "-";
  const alerts = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.validation.errors, ...snapshot.validation.warnings];
  }, [snapshot]);
  const projectionStats = useMemo(() => getProjectionStats(projectionRows), [projectionRows]);
  const filteredProjectionRows = useMemo(
    () => projectionFilter === "todos" ? projectionRows : projectionRows.filter((row) => row.candidate_status === projectionFilter),
    [projectionRows, projectionFilter],
  );
  const totalsStats = useMemo(() => getTotalsStats(totalsRows), [totalsRows]);
  const filteredTotalsRows = useMemo(
    () => filterTotalsRows(totalsRows, totalsFilter),
    [totalsRows, totalsFilter],
  );
  const handicapStats = useMemo(() => getHandicapStats(handicapRows), [handicapRows]);
  const filteredHandicapRows = useMemo(
    () => filterHandicapRows(handicapRows, handicapFilter),
    [handicapRows, handicapFilter],
  );
  const opportunityStats = useMemo(() => getOpportunityStats(opportunityRows), [opportunityRows]);
  const filteredOpportunityRows = useMemo(
    () => filterOpportunityRows(opportunityRows, {
      filter: opportunityFilter,
      hideCorrelatedAlternatives,
      minEv: Number(minOpportunityEv),
      minScore: Number(minOpportunityScore),
    }),
    [opportunityRows, opportunityFilter, hideCorrelatedAlternatives, minOpportunityEv, minOpportunityScore],
  );
  const selectedOpportunities = useMemo(
    () => selectedOpportunityIds.map((id) => opportunityRows.find((row) => row.opportunity_id === id)).filter(Boolean) as MlbUnifiedOpportunity[],
    [selectedOpportunityIds, opportunityRows],
  );
  const filteredHandoffAuditRows = useMemo(
    () => filterHandoffAuditRows(handoffAuditRows, {
      status: auditStatusFilter,
      market: auditMarketFilter,
      decision: auditDecisionFilter,
      minScore: Number(auditMinScore),
      minEv: Number(auditMinEv),
    }),
    [handoffAuditRows, auditStatusFilter, auditMarketFilter, auditDecisionFilter, auditMinScore, auditMinEv],
  );
  const handoffAuditStats = useMemo(() => getHandoffAuditStats(handoffAuditRows), [handoffAuditRows]);
  const handoffAuditMarketOptions = useMemo(
    () => Array.from(new Set(handoffAuditRows.map((row) => row.market).filter(Boolean) as string[])),
    [handoffAuditRows],
  );
  const calibrationRows = useMemo(
    () => filterCalibrationRows(handoffAuditRows, {
      status: calibrationStatusFilter,
      market: calibrationMarketFilter,
      decision: calibrationDecisionFilter,
      priorityStatus: calibrationPriorityFilter,
      readinessStatus: calibrationReadinessFilter,
      alignmentStatus: calibrationAlignmentFilter,
      minScore: Number(calibrationMinScore),
      maxScore: Number(calibrationMaxScore),
      minConfidence: Number(calibrationMinConfidence),
      maxConfidence: Number(calibrationMaxConfidence),
      minEv: Number(calibrationMinEv),
      homeTeam: calibrationHomeTeam,
      awayTeam: calibrationAwayTeam,
    }),
    [
      handoffAuditRows,
      calibrationStatusFilter,
      calibrationMarketFilter,
      calibrationDecisionFilter,
      calibrationPriorityFilter,
      calibrationReadinessFilter,
      calibrationAlignmentFilter,
      calibrationMinScore,
      calibrationMaxScore,
      calibrationMinConfidence,
      calibrationMaxConfidence,
      calibrationMinEv,
      calibrationHomeTeam,
      calibrationAwayTeam,
    ],
  );
  const calibrationModel = useMemo(() => buildCalibrationModel(calibrationRows), [calibrationRows]);
  const calibrationOptionSets = useMemo(() => buildCalibrationOptionSets(handoffAuditRows), [handoffAuditRows]);
  const selectedDailySnapshot = useMemo(
    () => dailySnapshots.find((snapshot) => snapshot.id === selectedDailySnapshotId) ?? null,
    [dailySnapshots, selectedDailySnapshotId],
  );
  const filteredSnapshotOpportunities = useMemo(
    () => filterSnapshotOpportunityRows(selectedSnapshotOpportunities, {
      market: snapshotMarketFilter,
      status: snapshotStatusFilter,
      sent: snapshotSentFilter,
      decision: snapshotDecisionFilter,
      minScore: Number(snapshotMinScore),
      minEv: Number(snapshotMinEv),
    }),
    [selectedSnapshotOpportunities, snapshotMarketFilter, snapshotStatusFilter, snapshotSentFilter, snapshotDecisionFilter, snapshotMinScore, snapshotMinEv],
  );
  const snapshotMarketOptions = useMemo(
    () => Array.from(new Set(selectedSnapshotOpportunities.map((row) => row.market_label).filter(Boolean) as string[])),
    [selectedSnapshotOpportunities],
  );

  useEffect(() => {
    const key = buildMlbScreenerUiStateKey(snapshotDate, season);
    const restored = readMlbScreenerUiState(snapshotDate, season);
    setProjectionRows(restored?.projectionRows ?? []);
    setProjectionGeneratedAt(restored?.projectionGeneratedAt ?? null);
    setTotalsRows(restored?.totalsRows ?? []);
    setTotalsGeneratedAt(restored?.totalsGeneratedAt ?? null);
    setHandicapRows(restored?.handicapRows ?? []);
    setHandicapGeneratedAt(restored?.handicapGeneratedAt ?? null);
    setOpportunityRows(restored?.opportunityRows ?? []);
    setOpportunityGeneratedAt(restored?.opportunityGeneratedAt ?? null);
    setSelectedOpportunityIds(restored?.selectedOpportunityIds ?? []);
    setParsedMatchupContext(null);
    setCriticalPayloads(restored?.criticalPayloads ?? []);
    setLoadedScreenerStateKey(key);
  }, [snapshotDate, season]);

  useEffect(() => {
    const key = buildMlbScreenerUiStateKey(snapshotDate, season);
    if (loadedScreenerStateKey !== key) return;
    if (!projectionRows.length && !totalsRows.length && !handicapRows.length && !opportunityRows.length && !criticalPayloads.length) return;
    writeMlbScreenerUiState({
      snapshotDate,
      season,
      projectionRows,
      projectionGeneratedAt,
      totalsRows,
      totalsGeneratedAt,
      handicapRows,
      handicapGeneratedAt,
      opportunityRows,
      opportunityGeneratedAt,
      selectedOpportunityIds,
      criticalPayloads,
    });
  }, [
    snapshotDate,
    season,
    loadedScreenerStateKey,
    projectionRows,
    projectionGeneratedAt,
    totalsRows,
    totalsGeneratedAt,
    handicapRows,
    handicapGeneratedAt,
    opportunityRows,
    opportunityGeneratedAt,
    selectedOpportunityIds,
    criticalPayloads,
  ]);

  async function refresh(forceRefresh = false) {
    setBusy(forceRefresh ? "force" : "refresh");
    setLastError(null);
    try {
      const result = await refreshMlbStandingsFromBaseballReference({
        data: { snapshotDate, season, forceRefresh },
      }) as SnapshotResponse;
      qc.setQueryData(queryKey, result);
      toast.success(result.fromCache ? "Snapshot MLB carregado do cache diario." : "MLB standings atualizado.");
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      toast.error(message);
      setCsvOpen(true);
    } finally {
      setBusy(null);
    }
  }

  async function processCsv() {
    setBusy("csv");
    setLastError(null);
    try {
      const result = await processManualMlbStandingsCsv({
        data: { csv: csvText, snapshotDate, season, forceRefresh: true },
      }) as SnapshotResponse;
      qc.setQueryData(queryKey, result);
      toast.success("CSV manual processado e salvo.");
    } catch (error) {
      const message = formatError(error);
      setLastError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  function generateMoneylineProjections() {
    if (!snapshot?.teams.length) {
      toast.error("Carregue um snapshot MLB antes de gerar projecoes.");
      return;
    }
    const games = enrichMlbGamesWithStandings(mlbOddsRows, snapshot.teams);
    const rows = buildMlbMoneylineScreenerRows(games);
    setProjectionRows(rows);
    setProjectionGeneratedAt(new Date().toISOString());
    toast.success(`${rows.length} jogos avaliados no Moneyline Screener.`);
  }

  function generateTotalsProjections() {
    if (!snapshot?.teams.length) {
      toast.error("Carregue um snapshot MLB antes de gerar projecoes.");
      return;
    }
    const games = enrichMlbGamesWithStandings(mlbOddsRows, snapshot.teams);
    const rows = buildMlbTotalsScreenerRows({
      games,
      standings: snapshot.teams,
      leagueAverageSnapshot: snapshot.league_average,
    });
    setTotalsRows(rows);
    setTotalsGeneratedAt(new Date().toISOString());
    toast.success(`${rows.length} linhas Over/Under avaliadas.`);
  }

  function generateHandicapProjections() {
    if (!snapshot?.teams.length) {
      toast.error("Carregue um snapshot MLB antes de gerar projecoes.");
      return;
    }
    const games = enrichMlbGamesWithStandings(mlbOddsRows, snapshot.teams);
    const rows = buildMlbHandicapScreenerRows({
      games,
      standings: snapshot.teams,
      leagueAverageSnapshot: snapshot.league_average,
    });
    setHandicapRows(rows);
    setHandicapGeneratedAt(new Date().toISOString());
    toast.success(`${rows.length} linhas Handicap avaliadas.`);
  }

  function buildAllProjectionRows() {
    if (!snapshot?.teams.length) {
      toast.error("Carregue um snapshot MLB antes de gerar projecoes.");
      return null;
    }
    const games = enrichMlbGamesWithStandings(mlbOddsRows, snapshot.teams);
    return {
      moneyline: buildMlbMoneylineScreenerRows(games),
      totals: buildMlbTotalsScreenerRows({
        games,
        standings: snapshot.teams,
        leagueAverageSnapshot: snapshot.league_average,
      }),
      handicap: buildMlbHandicapScreenerRows({
        games,
        standings: snapshot.teams,
        leagueAverageSnapshot: snapshot.league_average,
      }),
    };
  }

  function generateOpportunityShortlist() {
    if (!projectionRows.length || !totalsRows.length || !handicapRows.length) {
      toast.error("Execute os screeners de Moneyline, Over/Under e Handicap antes de gerar a shortlist.");
      return;
    }
    const result = buildMlbOpportunityShortlist({
      moneylineRows: projectionRows,
      totalsRows,
      handicapRows,
    });
    setOpportunityRows(result.opportunities);
    setOpportunityGeneratedAt(new Date().toISOString());
    toast.success(`${result.opportunities.length} oportunidades avaliadas no Opportunity Score.`);
  }

  function generateAllScreenersAndShortlist() {
    const rows = buildAllProjectionRows();
    if (!rows) return;
    const generatedAt = new Date().toISOString();
    setProjectionRows(rows.moneyline);
    setProjectionGeneratedAt(generatedAt);
    setTotalsRows(rows.totals);
    setTotalsGeneratedAt(generatedAt);
    setHandicapRows(rows.handicap);
    setHandicapGeneratedAt(generatedAt);
    const result = buildMlbOpportunityShortlist({
      moneylineRows: rows.moneyline,
      totalsRows: rows.totals,
      handicapRows: rows.handicap,
    });
    setOpportunityRows(result.opportunities);
    setOpportunityGeneratedAt(generatedAt);
    toast.success("Screeners MLB atualizados e shortlist recalculada.");
  }

  function toggleOpportunitySelection(opportunity: MlbUnifiedOpportunity) {
    setSelectedOpportunityIds((current) => {
      if (current.includes(opportunity.opportunity_id)) return current.filter((id) => id !== opportunity.opportunity_id);
      if (current.length >= 5) {
        toast.warning("Selecione no maximo 5 oportunidades para preparar validacao critica.");
        return current;
      }
      const selectedGames = current
        .map((id) => opportunityRows.find((row) => row.opportunity_id === id)?.game_id)
        .filter(Boolean);
      if (selectedGames.includes(opportunity.game_id)) {
        toast.warning("Ha mais de uma oportunidade do mesmo jogo; o pacote sera marcado como correlacionado.");
      }
      return [...current, opportunity.opportunity_id];
    });
  }

  function prepareSingleOpportunity(opportunity: MlbUnifiedOpportunity) {
    setSelectedOpportunityIds([opportunity.opportunity_id]);
    toast.success("Oportunidade enviada para a Etapa 05.");
  }

  function processBaseballReferenceContext() {
    if (!baseballReferenceText.trim()) {
      toast.error("Cole o texto do Baseball-Reference antes de processar.");
      return;
    }
    const primary = selectedOpportunities[0];
    const expected = primary
      ? {
          home_team: primary.home_team,
          away_team: primary.away_team,
        }
      : undefined;
    const context = parseBaseballReferenceMatchupText(baseballReferenceText, expected);
    setParsedMatchupContext(context);
    setCriticalPayloads([]);
    if (context.data_quality.warnings.some((w) => typeof w === "string" && w.includes("nao conferem"))) {
      toast.warning("Times do Baseball-Reference nao conferem com a oportunidade selecionada.");
    } else if (context.data_quality.missing_fields.length) {
      toast.warning("Contexto processado com campos ausentes.");
    } else {
      toast.success("Contexto Baseball-Reference processado.");
    }
  }

  function generateCriticalPayloads() {
    if (!selectedOpportunities.length) {
      toast.error("Selecione pelo menos uma oportunidade da shortlist.");
      return;
    }
    if (!parsedMatchupContext) {
      toast.error("Processee o contexto Baseball-Reference antes de gerar o payload critico.");
      return;
    }
    if (!parsedMatchupContext.teams.away.team_name || !parsedMatchupContext.teams.home.team_name) {
      toast.error("O texto colado nao identificou os dois times. Revise o contexto antes de gerar o payload.");
      return;
    }
    const payloads = selectedOpportunities
      .filter((opportunity) => {
        const eligible = isMlbOpportunityEligibleForCriticalValidation(opportunity);
        if (!eligible) toast.warning(`${opportunity.pick_label ?? opportunity.market_label} pode ser visualizada, mas foi bloqueada para payload critico principal.`);
        return eligible;
      })
      .map((opportunity) => {
        const alignment = calculateMlbContextAlignment(opportunity, parsedMatchupContext);
        return buildMlbCriticalValidationPayload(opportunity, parsedMatchupContext, alignment);
      });
    setCriticalPayloads(payloads);
    toast.success(`${payloads.length} payload(s) critico(s) gerado(s).`);
  }

  async function copyCriticalJson() {
    if (!criticalPayloads.length) {
      toast.error("Gere o payload critico antes de copiar.");
      return;
    }
    await copyText(JSON.stringify(criticalPayloads.length === 1 ? criticalPayloads[0] : criticalPayloads, null, 2), "JSON critico copiado.");
  }

  async function copyValidatorPrompt() {
    if (!criticalPayloads.length) {
      toast.error("Gere o payload critico antes de copiar o prompt.");
      return;
    }
    await copyText(criticalPayloads.map(buildMlbValidatorPrompt).join("\n\n---\n\n"), "Prompt para Validator copiado.");
  }

  async function saveCurrentScreenerSnapshot() {
    if (!opportunityRows.length) {
      toast.error("Gere a shortlist unificada antes de salvar o snapshot do Screener.");
      return;
    }
    setSnapshotBusy(true);
    try {
      const result = await saveMlbScreenerRunSnapshot({
        snapshotDate,
        season,
        oddsRowsCount: mlbOddsRows.length,
        gamesCount: new Set(opportunityRows.map((row) => row.game_id)).size,
        standingsSnapshot: snapshot,
        moneylineRowsCount: projectionRows.length,
        totalsRowsCount: totalsRows.length,
        handicapRowsCount: handicapRows.length,
        opportunities: opportunityRows,
        filtersPayload: {
          opportunityFilter,
          hideCorrelatedAlternatives,
          minOpportunityEv,
          minOpportunityScore,
        },
        metadata: {
          saved_from: "asp_screener_mlb_ui",
        },
      });
      setSelectedDailySnapshotId(result.daily.id);
      await refetchDailySnapshots();
      await refetchSnapshotOpportunities();
      toast.success(`Snapshot salvo: ${result.opportunities.length} oportunidades persistidas.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar o snapshot do Screener.");
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function generateAllScreenersAndSaveSnapshot() {
    const rows = buildAllProjectionRows();
    if (!rows) return;
    const generatedAt = new Date().toISOString();
    setProjectionRows(rows.moneyline);
    setProjectionGeneratedAt(generatedAt);
    setTotalsRows(rows.totals);
    setTotalsGeneratedAt(generatedAt);
    setHandicapRows(rows.handicap);
    setHandicapGeneratedAt(generatedAt);
    const result = buildMlbOpportunityShortlist({
      moneylineRows: rows.moneyline,
      totalsRows: rows.totals,
      handicapRows: rows.handicap,
    });
    setOpportunityRows(result.opportunities);
    setOpportunityGeneratedAt(generatedAt);
    setSnapshotBusy(true);
    try {
      const saved = await saveMlbScreenerRunSnapshot({
        snapshotDate,
        season,
        oddsRowsCount: mlbOddsRows.length,
        gamesCount: new Set(result.opportunities.map((row) => row.game_id)).size,
        standingsSnapshot: snapshot,
        moneylineRowsCount: rows.moneyline.length,
        totalsRowsCount: rows.totals.length,
        handicapRowsCount: rows.handicap.length,
        opportunities: result.opportunities,
        metadata: { saved_from: "generate_all_and_save" },
      });
      setSelectedDailySnapshotId(saved.daily.id);
      await refetchDailySnapshots();
      await refetchSnapshotOpportunities();
      toast.success(`Screeners gerados e snapshot salvo com ${saved.opportunities.length} oportunidades.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Screeners gerados, mas falhou ao salvar snapshot.");
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function sendCriticalPayloadToValidator(payload: MlbPreparedCriticalValidationPayload) {
    const handoff = buildMlbValidatorHandoffPayload(payload);
    const validation = validateMlbValidatorHandoffPayload(handoff);
    if (!validation.valid) {
      toast.error(validation.errors[0] ?? "Payload nao esta pronto para envio ao ASP Validator.");
      return;
    }
    if (validation.warnings.length) {
      toast.warning(validation.warnings[0]);
    }
    const storageResult = storeMlbValidatorHandoffDraft(handoff);
    if (!storageResult.valid) {
      toast.error(storageResult.errors[0] ?? "Nao foi possivel salvar o rascunho para o ASP Validator.");
      return;
    }
    let handoffForValidator: MlbValidatorHandoffPayload = handoff;
    try {
      const auditRecord = await createScreenerValidatorHandoffAudit(handoff);
      handoffForValidator = {
        ...handoff,
        audit: {
          record_id: auditRecord.id,
          status: auditRecord.status,
          sent_at: auditRecord.sent_at,
          applied_at: auditRecord.applied_at,
        },
      };
      storeMlbValidatorHandoffDraft(handoffForValidator);
      void refetchHandoffAudit();
    } catch (error) {
      console.warn("Handoff enviado ao Validator, mas auditoria nao foi salva.", error);
      toast.warning("Handoff enviado ao Validator, mas auditoria nao foi salva.");
    }
    const sourceOpportunity = findOpportunityForCriticalPayload(opportunityRows, payload);
    if (sourceOpportunity) {
      void linkMlbOpportunitySnapshotToHandoff(sourceOpportunity.opportunity_id, handoff.handoff_id).catch((error) => {
        console.warn("Handoff enviado, mas snapshot sombra nao foi vinculado.", error);
      });
    }
    toast.success("Rascunho enviado para ASP Validator (teste). Revise antes de validar.");
    void navigate({ to: "/asp-validator" });
  }

  async function sendCriticalPayloadToCriticalValidation(payload: MlbPreparedCriticalValidationPayload) {
    const draft = buildMlbCriticalValidationDraft(payload);
    const validation = validateCriticalValidationDraft(draft);
    if (!validation.valid) {
      toast.error(validation.errors[0] ?? "Rascunho não está pronto para envio à Validação Crítica.");
      return;
    }
    const prognostico = await createPrognostico.mutateAsync(buildCriticalValidationPrognosticoInput(draft));
    if (!prognostico) {
      toast.error("Nao foi possivel criar o prognostico na Validacao Critica.");
      return;
    }
    toast.success(`Enviado para Validacao Critica como ASP Screener: ${String(prognostico.id ?? "").slice(0, 8)}`);
    void navigate({ to: "/validacao" });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <DatabaseZap className="h-6 w-6 text-primary" />
            ASP Screener
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">Etapa 02</Badge>
            <Badge variant="outline">Dados MLB</Badge>
            <Badge variant="outline">Sem projeções</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Snapshot">
            <Input
              type="date"
              value={snapshotDate}
              onChange={(event) => setSnapshotDate(event.target.value)}
              className="[color-scheme:dark] w-40 text-foreground"
            />
          </Field>
          <Field label="Season">
            <Input
              inputMode="numeric"
              value={season}
              onChange={(event) => setSeason(Number(event.target.value) || new Date().getUTCFullYear())}
              className="w-28"
            />
          </Field>
        </div>
      </div>

      <Tabs defaultValue="baseball-mlb" className="space-y-4">
        <TabsList>
          <TabsTrigger value="baseball-mlb" className="gap-2">
            <Trophy className="h-4 w-4" />
            Baseball - MLB
          </TabsTrigger>
        </TabsList>

        <TabsContent value="baseball-mlb" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span>MLB Detailed Standings</span>
                <Badge variant={snapshot?.validation.valid ? "outline" : snapshot ? "destructive" : "secondary"}>
                  {snapshot?.validation.valid ? "validado" : snapshot ? "pendente" : "sem snapshot"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 md:grid-cols-4">
                <Info label="Ultima atualizacao" value={snapshot?.imported_at ? formatDateTime(snapshot.imported_at) : isFetching ? "Carregando..." : "-"} />
                <Info label="Fonte" value={sourceLabel(snapshot?.source)} />
                <Info label="Snapshot" value={snapshot?.snapshot_date ?? snapshotDate} />
                <Info label="Times importados" value={snapshot?.teams.length ?? 0} />
                <Info label="Times conciliados" value={snapshot?.validation.matchedTeams ?? 0} />
                <Info label="Odds MLB do dia" value={data?.oddsRowsCount ?? 0} />
                <Info label="Avisos" value={alerts.length} />
                <Info label="Cache" value={data?.fromCache ? "diario" : snapshot ? "atualizado" : "-"} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => refresh(false)} disabled={Boolean(busy)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {busy === "refresh" ? "Atualizando..." : "Atualizar MLB Standings"}
                </Button>
                <Button variant="outline" onClick={() => refresh(true)} disabled={Boolean(busy)}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  {busy === "force" ? "Forcando..." : "Forcar atualizacao"}
                </Button>
              </div>

              {(lastError || alerts.length > 0) && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    Alertas
                  </div>
                  <ul className="list-inside list-disc space-y-1">
                    {lastError && <li>{formatAlertMessage(lastError)}</li>}
                    {alerts.map((alert, index) => <li key={`alert-${index}`}>{formatAlertMessage(alert)}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Collapsible open={csvOpen} onOpenChange={setCsvOpen}>
            <Card>
              <CardHeader>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between px-0">
                    <span className="flex items-center gap-2 font-semibold">
                      <Upload className="h-4 w-4" />
                      CSV manual
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-3">
                  <Textarea
                    value={csvText}
                    onChange={(event) => setCsvText(event.target.value)}
                    placeholder="Rk,Tm,W,L,W-L%,Strk,R,RA,Rdiff,SOS,SRS,pythWL,Luck,..."
                    className="min-h-44 font-mono text-xs"
                  />
                  <Button onClick={processCsv} disabled={busy === "csv" || !csvText.trim()}>
                    <Upload className="mr-2 h-4 w-4" />
                    {busy === "csv" ? "Processando..." : "Processar CSV manual"}
                  </Button>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview normalizado</CardTitle>
            </CardHeader>
            <CardContent>
              <StandingsTable rows={snapshot?.teams ?? []} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>Etapa 03A - Moneyline Screener</span>
                <Badge variant="outline">Triagem preliminar</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                Modelo simples de screener. Ainda nao considera starters, lineups, bullpen, clima ou validacao critica.
              </div>
              {oddsRowsError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  Falha ao carregar odds MLB para o Screener: {(oddsRowsError as Error).message}
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-4">
                <Info label="Snapshot usado" value={snapshot?.snapshot_date ?? "-"} />
                <Info label="Gerado em" value={projectionGeneratedAt ? formatDateTime(projectionGeneratedAt) : "-"} />
                <Info label="Jogos analisados" value={projectionStats.total} />
                <Info label="Sem dados" value={projectionStats.missing_data} />
                <Info label="Analisar" value={projectionStats.analisar} />
                <Info label="Monitorar" value={projectionStats.monitorar} />
                <Info label="Pular" value={projectionStats.pular} />
                <Info label="Odds MLB carregadas" value={mlbOddsRows.length} />
                <Info label="Origem odds" value={mlbOddsSourceLabel} />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Button onClick={generateMoneylineProjections} disabled={!snapshot?.teams.length || Boolean(busy)}>
                  <Trophy className="mr-2 h-4 w-4" />
                  Gerar projecoes Moneyline
                </Button>
                <Field label="Filtro">
                  <Select value={projectionFilter} onValueChange={(value) => setProjectionFilter(value as MlbProjectionCandidateStatus | "todos")}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="analisar">Analisar</SelectItem>
                      <SelectItem value="monitorar">Monitorar</SelectItem>
                      <SelectItem value="pular">Pular</SelectItem>
                      <SelectItem value="missing_data">Missing data</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <MoneylineProjectionTable rows={filteredProjectionRows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>Etapa 03B - Over/Under Screener</span>
                <Badge variant="outline">Triagem preliminar</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                Modelo simples de screener. Ainda nao considera starters, bullpens, lineups confirmados, park factor ou clima. Use apenas para triagem preliminar.
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <Info label="Snapshot usado" value={snapshot?.snapshot_date ?? "-"} />
                <Info label="Gerado em" value={totalsGeneratedAt ? formatDateTime(totalsGeneratedAt) : "-"} />
                <Info label="Jogos analisados" value={totalsStats.games} />
                <Info label="Linhas O/U" value={totalsStats.total} />
                <Info label="Linhas principais" value={totalsStats.main} />
                <Info label="Alternativas" value={totalsStats.alternate} />
                <Info label="Analisar" value={totalsStats.analisar} />
                <Info label="Monitorar" value={totalsStats.monitorar} />
                <Info label="Pular" value={totalsStats.pular} />
                <Info label="Missing data" value={totalsStats.missing_data} />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Button onClick={generateTotalsProjections} disabled={!snapshot?.teams.length || Boolean(busy)}>
                  <Trophy className="mr-2 h-4 w-4" />
                  Gerar projecoes Over/Under
                </Button>
                <Field label="Filtro">
                  <Select value={totalsFilter} onValueChange={(value) => setTotalsFilter(value as MlbTotalsFilter)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="analisar">Analisar</SelectItem>
                      <SelectItem value="monitorar">Monitorar</SelectItem>
                      <SelectItem value="pular">Pular</SelectItem>
                      <SelectItem value="missing_data">Missing data</SelectItem>
                      <SelectItem value="main">Linha principal</SelectItem>
                      <SelectItem value="alternate">Linhas alternativas</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <TotalsProjectionTable rows={filteredTotalsRows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>Etapa 03C - Asian Handicap / Run Line Screener</span>
                <Badge variant="outline">Triagem preliminar</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                Modelo simples de screener. Ainda nao considera starters, bullpens, lineups confirmados, park factor ou clima. Use apenas para triagem preliminar.
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <Info label="Snapshot usado" value={snapshot?.snapshot_date ?? "-"} />
                <Info label="Gerado em" value={handicapGeneratedAt ? formatDateTime(handicapGeneratedAt) : "-"} />
                <Info label="Jogos analisados" value={handicapStats.games} />
                <Info label="Linhas Handicap" value={handicapStats.total} />
                <Info label="Linhas principais" value={handicapStats.main} />
                <Info label="Alternativas" value={handicapStats.alternate} />
                <Info label="Analisar" value={handicapStats.analisar} />
                <Info label="Monitorar" value={handicapStats.monitorar} />
                <Info label="Pular" value={handicapStats.pular} />
                <Info label="Missing data" value={handicapStats.missing_data} />
                <Info label="Unsupported line" value={handicapStats.unsupported_line} />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Button onClick={generateHandicapProjections} disabled={!snapshot?.teams.length || Boolean(busy)}>
                  <Trophy className="mr-2 h-4 w-4" />
                  Gerar projecoes Handicap
                </Button>
                <Field label="Filtro">
                  <Select value={handicapFilter} onValueChange={(value) => setHandicapFilter(value as MlbHandicapFilter)}>
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="analisar">Analisar</SelectItem>
                      <SelectItem value="monitorar">Monitorar</SelectItem>
                      <SelectItem value="pular">Pular</SelectItem>
                      <SelectItem value="missing_data">Missing data</SelectItem>
                      <SelectItem value="unsupported_line">Unsupported line</SelectItem>
                      <SelectItem value="main">Linha principal</SelectItem>
                      <SelectItem value="alternate">Linhas alternativas</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <HandicapProjectionTable rows={filteredHandicapRows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>Etapa 04 - Opportunity Score / Shortlist</span>
                <Badge variant="outline">Shortlist unificada</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                Opportunity Score e uma triagem preliminar. Ainda nao considera starters, lineups, bullpens, clima, park factor ou validacao critica. Nao representa prognostico final.
              </div>
              <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
                Screener endurecido: linhas alternativas distantes e odds baixas sao limitadas a MONITORAR/PULAR.
              </div>
              <div className="rounded-md border bg-background/50 p-3 text-sm text-muted-foreground">
                A shortlist e uma triagem. O limite final de no maximo 3 prognosticos sera aplicado apos validacao critica.
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <Info label="Gerado em" value={opportunityGeneratedAt ? formatDateTime(opportunityGeneratedAt) : "-"} />
                <Info label="Oportunidades avaliadas" value={opportunityStats.total} />
                <Info label="Analisar" value={opportunityStats.ANALISAR} />
                <Info label="Monitorar" value={opportunityStats.MONITORAR} />
                <Info label="Pular" value={opportunityStats.PULAR} />
                <Info label="Missing data" value={opportunityStats.MISSING_DATA} />
                <Info label="Unsupported line" value={opportunityStats.UNSUPPORTED_LINE} />
                <Info label="Shortlist principal" value={opportunityStats.primaryShortlist} />
                <Info label="Alternativas correl." value={opportunityStats.correlatedAlternatives} />
                <Info label="Melhor score" value={formatScore(opportunityStats.bestScore)} />
                <Info label="Maior EV" value={formatEv(opportunityStats.bestEv)} />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Button onClick={generateOpportunityShortlist} disabled={!projectionRows.length || !totalsRows.length || !handicapRows.length}>
                  <Trophy className="mr-2 h-4 w-4" />
                  Gerar shortlist
                </Button>
                <Button variant="outline" onClick={generateAllScreenersAndShortlist} disabled={!snapshot?.teams.length || Boolean(busy)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Gerar todos os screeners + shortlist
                </Button>
                <Field label="Filtro">
                  <Select value={opportunityFilter} onValueChange={(value) => setOpportunityFilter(value as MlbOpportunityFilter)}>
                    <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="shortlist">Shortlist principal</SelectItem>
                      <SelectItem value="analisar">Analisar</SelectItem>
                      <SelectItem value="monitorar">Monitorar</SelectItem>
                      <SelectItem value="pular">Pular</SelectItem>
                      <SelectItem value="missing_data">Missing data</SelectItem>
                      <SelectItem value="unsupported_line">Unsupported line</SelectItem>
                      <SelectItem value="moneyline">Moneyline</SelectItem>
                      <SelectItem value="totals">Over/Under</SelectItem>
                      <SelectItem value="handicap">Handicap</SelectItem>
                      <SelectItem value="main">Linha principal</SelectItem>
                      <SelectItem value="alternate">Linhas alternativas</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="EV minimo (%)">
                  <Input
                    inputMode="decimal"
                    value={minOpportunityEv}
                    onChange={(event) => setMinOpportunityEv(event.target.value)}
                    placeholder="ex: 5"
                    className="w-28"
                  />
                </Field>
                <Field label="Score minimo">
                  <Input
                    inputMode="decimal"
                    value={minOpportunityScore}
                    onChange={(event) => setMinOpportunityScore(event.target.value)}
                    placeholder="ex: 70"
                    className="w-28"
                  />
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={hideCorrelatedAlternatives}
                    onChange={(event) => setHideCorrelatedAlternatives(event.target.checked)}
                  />
                  Ocultar alternativas correlacionadas
                </label>
              </div>

              <OpportunityTable
                rows={filteredOpportunityRows}
                selectedIds={selectedOpportunityIds}
                onToggleSelection={toggleOpportunitySelection}
                onPrepare={prepareSingleOpportunity}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>Etapa 05 - Pacote de Validacao Critica MLB</span>
                <Badge variant="outline">Preparacao</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                Esta etapa apenas prepara contexto detalhado e payload copiavel. Nao cria prognostico, nao envia ao Validator e nao altera bankroll.
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Oportunidades selecionadas</div>
                  {selectedOpportunities.map((opportunity) => (
                    <div key={opportunity.opportunity_id} className="rounded-md border bg-background/50 p-3 text-sm">
                      <div className="font-medium">{opportunity.matchup}</div>
                      <div className="text-muted-foreground">
                        {opportunity.market_label} | {opportunity.pick_label ?? "-"} | Score {formatScore(opportunity.opportunity_score)} | EV {formatEv(opportunity.ev)}
                      </div>
                      {!isMlbOpportunityEligibleForCriticalValidation(opportunity) && (
                        <div className="mt-1 text-xs text-warning">Visualizacao permitida, mas bloqueada para payload critico principal.</div>
                      )}
                    </div>
                  ))}
                  {!selectedOpportunities.length && (
                    <div className="rounded-md border bg-background/50 p-6 text-sm text-muted-foreground">
                      Selecione oportunidades na Etapa 04. Recomenda-se priorizar no maximo 3 para validacao final.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Texto Baseball-Reference Matchup</Label>
                  <Textarea
                    value={baseballReferenceText}
                    onChange={(event) => setBaseballReferenceText(event.target.value)}
                    placeholder="Cole aqui o texto bruto do Baseball-Reference Matchups/Preview..."
                    className="min-h-56 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={processBaseballReferenceContext} disabled={!baseballReferenceText.trim()}>
                  Processar contexto Baseball-Reference
                </Button>
                <Button onClick={generateCriticalPayloads} disabled={!selectedOpportunities.length || !parsedMatchupContext}>
                  Gerar payload critico
                </Button>
                <Button variant="outline" onClick={copyCriticalJson} disabled={!criticalPayloads.length}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copiar JSON critico
                </Button>
                <Button variant="outline" onClick={copyValidatorPrompt} disabled={!criticalPayloads.length}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copiar prompt para Validator
                </Button>
              </div>

              {parsedMatchupContext && <ParsedContextPanel context={parsedMatchupContext} />}
              {criticalPayloads.length > 0 && (
                <CriticalPayloadPanel
                  payloads={criticalPayloads}
                  onSendToCriticalValidation={sendCriticalPayloadToCriticalValidation}
                  onSendToValidator={sendCriticalPayloadToValidator}
                />
              )}
            </CardContent>
          </Card>

          <HandoffAuditPanel
            rows={filteredHandoffAuditRows}
            stats={handoffAuditStats}
            loading={loadingHandoffAudit}
            marketOptions={handoffAuditMarketOptions}
            period={auditPeriod}
            status={auditStatusFilter}
            market={auditMarketFilter}
            decision={auditDecisionFilter}
            minScore={auditMinScore}
            minEv={auditMinEv}
            onPeriodChange={setAuditPeriod}
            onStatusChange={setAuditStatusFilter}
            onMarketChange={setAuditMarketFilter}
            onDecisionChange={setAuditDecisionFilter}
            onMinScoreChange={setAuditMinScore}
            onMinEvChange={setAuditMinEv}
            onRefresh={() => void refetchHandoffAudit()}
          />

          <MlbShadowSnapshotPanel
            dailySnapshots={dailySnapshots}
            selectedSnapshot={selectedDailySnapshot}
            opportunities={filteredSnapshotOpportunities}
            loading={loadingDailySnapshots || loadingSnapshotOpportunities || snapshotBusy}
            marketOptions={snapshotMarketOptions}
            market={snapshotMarketFilter}
            status={snapshotStatusFilter}
            sent={snapshotSentFilter}
            decision={snapshotDecisionFilter}
            minScore={snapshotMinScore}
            minEv={snapshotMinEv}
            onSaveSnapshot={() => void saveCurrentScreenerSnapshot()}
            onGenerateAndSave={() => void generateAllScreenersAndSaveSnapshot()}
            onSelectSnapshot={setSelectedDailySnapshotId}
            onMarketChange={setSnapshotMarketFilter}
            onStatusChange={setSnapshotStatusFilter}
            onSentChange={setSnapshotSentFilter}
            onDecisionChange={setSnapshotDecisionFilter}
            onMinScoreChange={setSnapshotMinScore}
            onMinEvChange={setSnapshotMinEv}
            onRefresh={() => {
              void refetchDailySnapshots();
              void refetchSnapshotOpportunities();
            }}
          />

          <MlbCalibrationPanel
            rows={calibrationRows}
            model={calibrationModel}
            loading={loadingHandoffAudit}
            snapshotRows={selectedSnapshotOpportunities}
            source={calibrationSource}
            marketOptions={handoffAuditMarketOptions}
            optionSets={calibrationOptionSets}
            status={calibrationStatusFilter}
            market={calibrationMarketFilter}
            decision={calibrationDecisionFilter}
            priority={calibrationPriorityFilter}
            readiness={calibrationReadinessFilter}
            alignment={calibrationAlignmentFilter}
            minScore={calibrationMinScore}
            maxScore={calibrationMaxScore}
            minConfidence={calibrationMinConfidence}
            maxConfidence={calibrationMaxConfidence}
            minEv={calibrationMinEv}
            homeTeam={calibrationHomeTeam}
            awayTeam={calibrationAwayTeam}
            onStatusChange={setCalibrationStatusFilter}
            onMarketChange={setCalibrationMarketFilter}
            onDecisionChange={setCalibrationDecisionFilter}
            onPriorityChange={setCalibrationPriorityFilter}
            onReadinessChange={setCalibrationReadinessFilter}
            onAlignmentChange={setCalibrationAlignmentFilter}
            onMinScoreChange={setCalibrationMinScore}
            onMaxScoreChange={setCalibrationMaxScore}
            onMinConfidenceChange={setCalibrationMinConfidence}
            onMaxConfidenceChange={setCalibrationMaxConfidence}
            onMinEvChange={setCalibrationMinEv}
            onHomeTeamChange={setCalibrationHomeTeam}
            onAwayTeamChange={setCalibrationAwayTeam}
            onRefresh={() => void refetchHandoffAudit()}
            onSourceChange={setCalibrationSource}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StandingsTable({ rows }: { rows: MlbTeamStanding[] }) {
  return (
    <div className="max-h-[560px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {["Rk", "Team", "W", "L", "W-L%", "R/G", "RA/G", "Rdiff", "SOS", "SRS", "pythWL", "Luck", "Home", "Road", "vRHP", "vLHP", "last10", "last20", "last30"].map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team_key} className="border-t">
              <td className="px-3 py-2 font-mono">{row.rank ?? "-"}</td>
              <td className="min-w-48 px-3 py-2 font-medium">{row.team_name}</td>
              <td className="px-3 py-2 font-mono">{row.wins ?? "-"}</td>
              <td className="px-3 py-2 font-mono">{row.losses ?? "-"}</td>
              <td className="px-3 py-2 font-mono">{formatPct(row.win_pct)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber(row.runs_per_game)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber(row.runs_allowed_per_game)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber(row.run_diff_per_game)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber(row.sos)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber(row.srs)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.pyth_wins, row.pyth_losses)}</td>
              <td className="px-3 py-2 font-mono">{row.luck ?? "-"}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.home_wins, row.home_losses)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.road_wins, row.road_losses)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.vs_rhp_wins, row.vs_rhp_losses)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.vs_lhp_wins, row.vs_lhp_losses)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.last10_wins, row.last10_losses)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.last20_wins, row.last20_losses)}</td>
              <td className="px-3 py-2 font-mono">{formatRecord(row.last30_wins, row.last30_losses)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={19} className="px-3 py-12 text-center text-sm text-muted-foreground">
                Nenhum snapshot carregado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MoneylineProjectionTable({ rows }: { rows: MlbMoneylineScreenerRow[] }) {
  return (
    <div className="max-h-[620px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {[
              "Data",
              "Hora",
              "Jogo",
              "Mandante",
              "Visitante",
              "Odd Mandante",
              "Odd Visitante",
              "Mercado Mand. No-Vig",
              "ASP Mandante",
              "Justa Mandante",
              "EV Mandante",
              "Mercado Visit. No-Vig",
              "ASP Visitante",
              "Justa Visitante",
              "EV Visitante",
              "Recomendacao preliminar",
              "Status",
              "Alertas",
            ].map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.game_id} className="border-t align-top">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.date ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.time ?? "-"}</td>
              <td className="min-w-64 px-3 py-2 font-medium">{row.home_team} vs {row.away_team}</td>
              <td className="min-w-44 px-3 py-2">{row.home_team}</td>
              <td className="min-w-44 px-3 py-2">{row.away_team}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.home_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.away_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.home_market_implied_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.home_model_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.home_fair_odd)}</td>
              <td className={evClass(row.home_ev)}>{formatEv(row.home_ev)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.away_market_implied_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.away_model_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.away_fair_odd)}</td>
              <td className={evClass(row.away_ev)}>{formatEv(row.away_ev)}</td>
              <td className="min-w-52 px-3 py-2">
                {row.recommended_side ? (
                  <div className="space-y-1">
                    <div className="font-medium">{row.recommended_side}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      EV {formatEv(row.recommended_ev)} | justa {formatOdd(row.recommended_fair_odd)}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sem EV positivo</span>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge variant={statusBadgeVariant(row.candidate_status)}>{statusLabel(row.candidate_status)}</Badge>
              </td>
              <td className="min-w-72 px-3 py-2 text-xs text-muted-foreground">
                <div className="space-y-1">
                  {row.alerts.slice(0, 4).map((alert, index) => <div key={`${row.game_id}-alert-${index}`}>{formatAlertMessage(alert)}</div>)}
                  {row.reasons.length > 0 && (
                    <div className="pt-1 text-foreground">{row.reasons.slice(0, 2).join(" | ")}</div>
                  )}
                  {row.missing_fields.length > 0 && (
                    <div className="text-destructive">Faltando: {row.missing_fields.join(", ")}</div>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={18} className="px-3 py-12 text-center text-sm text-muted-foreground">
                Nenhuma projecao gerada para o filtro atual.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TotalsProjectionTable({ rows }: { rows: MlbTotalsScreenerRow[] }) {
  return (
    <div className="max-h-[620px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {[
              "Data",
              "Hora",
              "Jogo",
              "Linha",
              "Tipo",
              "Odd Over",
              "Odd Under",
              "Total ASP",
              "Gap",
              "Mercado Over No-Vig",
              "ASP Over",
              "Justa Over",
              "EV Over",
              "Mercado Under No-Vig",
              "ASP Under",
              "Justa Under",
              "EV Under",
              "Recomendacao preliminar",
              "Status",
              "Alertas",
            ].map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.row_id} className="border-t align-top">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.date ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.time ?? "-"}</td>
              <td className="min-w-64 px-3 py-2 font-medium">{row.home_team} vs {row.away_team}</td>
              <td className="px-3 py-2 font-mono">{row.line ?? "-"}</td>
              <td className="px-3 py-2">
                <Badge variant={row.is_main_total_line ? "outline" : "secondary"}>
                  {row.is_main_total_line ? "principal" : "alternativa"}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.over_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.under_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber2(row.projected_total_runs)}</td>
              <td className={gapClass(row.total_gap_vs_line)}>{formatSignedNumber(row.total_gap_vs_line)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.over_market_implied_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.over_model_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.over_fair_odd)}</td>
              <td className={evClass(row.over_ev)}>{formatEv(row.over_ev)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.under_market_implied_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.under_model_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.under_fair_odd)}</td>
              <td className={evClass(row.under_ev)}>{formatEv(row.under_ev)}</td>
              <td className="min-w-52 px-3 py-2">
                {row.recommended_side ? (
                  <div className="space-y-1">
                    <div className="font-medium">{row.recommended_side} {row.line}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      EV {formatEv(row.recommended_ev)} | justa {formatOdd(row.recommended_fair_odd)}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sem EV positivo</span>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge variant={statusBadgeVariant(row.candidate_status)}>{statusLabel(row.candidate_status)}</Badge>
              </td>
              <td className="min-w-80 px-3 py-2 text-xs text-muted-foreground">
                <div className="space-y-1">
                  <div>Media liga: {formatNumber2(row.league_avg_runs_per_team)} ({leagueAverageSourceLabel(row.league_average_source)})</div>
                  {row.push_prob ? <div>Push: {formatProbability(row.push_prob)}</div> : null}
                  {row.alerts.slice(0, 5).map((alert, index) => <div key={`${row.row_id}-alert-${index}`}>{formatAlertMessage(alert)}</div>)}
                  {row.reasons.length > 0 && (
                    <div className="pt-1 text-foreground">{row.reasons.slice(0, 2).join(" | ")}</div>
                  )}
                  {row.missing_fields.length > 0 && (
                    <div className="text-destructive">Faltando: {row.missing_fields.join(", ")}</div>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={20} className="px-3 py-12 text-center text-sm text-muted-foreground">
                Nenhuma projecao Over/Under gerada para o filtro atual.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HandicapProjectionTable({ rows }: { rows: MlbHandicapScreenerRow[] }) {
  return (
    <div className="max-h-[620px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {[
              "Data",
              "Hora",
              "Jogo",
              "Linha mandante",
              "Odd mandante",
              "Linha visitante",
              "Odd visitante",
              "Tipo",
              "Exp. mandante",
              "Exp. visitante",
              "Margem ASP",
              "Mercado Mand. No-Vig",
              "ASP Cover Mand.",
              "Push Mand.",
              "Justa Mand.",
              "EV Mand.",
              "Mercado Visit. No-Vig",
              "ASP Cover Visit.",
              "Push Visit.",
              "Justa Visit.",
              "EV Visit.",
              "Recomendacao preliminar",
              "Status",
              "Alertas",
            ].map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.row_id} className="border-t align-top">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.date ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.time ?? "-"}</td>
              <td className="min-w-64 px-3 py-2 font-medium">{row.home_team} vs {row.away_team}</td>
              <td className="px-3 py-2 font-mono">{formatHandicapLine(row.home_handicap_line)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.home_handicap_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatHandicapLine(row.away_handicap_line)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.away_handicap_odd)}</td>
              <td className="px-3 py-2">
                <Badge variant={row.is_main_handicap_line ? "outline" : "secondary"}>
                  {row.is_main_handicap_line ? "principal" : "alternativa"}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono">{formatNumber2(row.home_expected_runs)}</td>
              <td className="px-3 py-2 font-mono">{formatNumber2(row.away_expected_runs)}</td>
              <td className={gapClass(row.projected_margin)}>{formatSignedNumber(row.projected_margin)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.home_market_implied_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.home_cover_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.home_push_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.home_fair_odd)}</td>
              <td className={evClass(row.home_handicap_ev)}>{formatEv(row.home_handicap_ev)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.away_market_implied_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.away_cover_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.away_push_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.away_fair_odd)}</td>
              <td className={evClass(row.away_handicap_ev)}>{formatEv(row.away_handicap_ev)}</td>
              <td className="min-w-56 px-3 py-2">
                {row.recommended_pick ? (
                  <div className="space-y-1">
                    <div className="font-medium">{row.recommended_pick} {formatHandicapLine(row.recommended_line)}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      EV {formatEv(row.recommended_ev)} | justa {formatOdd(row.recommended_fair_odd)}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sem EV positivo</span>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge variant={statusBadgeVariant(row.candidate_status)}>{statusLabel(row.candidate_status)}</Badge>
              </td>
              <td className="min-w-96 px-3 py-2 text-xs text-muted-foreground">
                <div className="space-y-1">
                  <div>
                    Max runs: {row.components.margin_distribution_summary.distribution_max_runs ?? "-"} |
                    Massa: {formatProbability(row.components.margin_distribution_summary.distribution_mass_before_normalization)}
                  </div>
                  {row.alerts.slice(0, 6).map((alert, index) => <div key={`${row.row_id}-alert-${index}`}>{formatAlertMessage(alert)}</div>)}
                  {row.reasons.length > 0 && (
                    <div className="pt-1 text-foreground">{row.reasons.slice(0, 2).join(" | ")}</div>
                  )}
                  {row.missing_fields.length > 0 && (
                    <div className="text-destructive">Faltando: {row.missing_fields.join(", ")}</div>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={24} className="px-3 py-12 text-center text-sm text-muted-foreground">
                Nenhuma projecao Handicap gerada para o filtro atual.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OpportunityTable({
  rows,
  selectedIds,
  onToggleSelection,
  onPrepare,
}: {
  rows: MlbUnifiedOpportunity[];
  selectedIds: string[];
  onToggleSelection: (row: MlbUnifiedOpportunity) => void;
  onPrepare: (row: MlbUnifiedOpportunity) => void;
}) {
  async function copyPayload(row: MlbUnifiedOpportunity) {
    const payload = buildMlbOpportunityValidationPayload(row);
    try {
      await copyText(JSON.stringify(payload, null, 2), "Payload copiado.");
    } catch (error) {
      toast.error(formatError(error));
    }
  }

  return (
    <div className="max-h-[700px] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {[
              "Selecionar",
              "Acoes",
              "Rank",
              "Data",
              "Hora",
              "Jogo",
              "Mercado",
              "Pick",
              "Linha",
              "Odd Ofertada",
              "Odd Mediana",
              "Bookmaker",
              "Prob. Mercado No-Vig",
              "Prob. ASP",
              "Edge Prob.",
              "Odd Justa",
              "EV",
              "Gap do Modelo",
              "Score",
              "Confianca",
              "Status",
              "Correlacao",
              "Motivos",
              "Alertas",
            ].map((header) => (
              <th key={header} className="whitespace-nowrap px-3 py-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.opportunity_id} className="border-t align-top">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(row.opportunity_id)}
                  onChange={() => onToggleSelection(row)}
                />
              </td>
              <td className="min-w-40 px-3 py-2">
                <Button size="sm" variant="outline" onClick={() => onPrepare(row)}>
                  Preparar validacao critica
                </Button>
              </td>
              <td className="px-3 py-2 font-mono">{row.rank ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.date ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.time ?? "-"}</td>
              <td className="min-w-64 px-3 py-2 font-medium">{row.matchup}</td>
              <td className="px-3 py-2">{row.market_label}</td>
              <td className="min-w-56 px-3 py-2 font-medium">{row.pick_label ?? "-"}</td>
              <td className="px-3 py-2 font-mono">{row.line == null ? "-" : row.market_family === "handicap" ? formatHandicapLine(row.line) : formatNumber2(row.line)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.offered_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.median_odd)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{row.bookmaker_melhor ?? "-"}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.market_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbability(row.model_prob)}</td>
              <td className={edgeClass(row.probability_edge)}>{formatProbabilitySigned(row.probability_edge)}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.fair_odd)}</td>
              <td className={evClass(row.ev)}>{formatEv(row.ev)}</td>
              <td className="min-w-48 px-3 py-2 font-mono">
                {row.model_gap_value == null ? "-" : `${formatNumber2(row.model_gap_value)} | ${row.model_gap_label}`}
              </td>
              <td className={scoreClass(row.opportunity_score)}>{formatScore(row.opportunity_score)}</td>
              <td className="px-3 py-2 font-mono">{formatScore(row.confidence_score)}</td>
              <td className="px-3 py-2">
                <Badge variant={opportunityStatusBadgeVariant(row.priority_status)}>{row.priority_status}</Badge>
              </td>
              <td className="min-w-44 px-3 py-2 text-xs text-muted-foreground">{correlationLabel(row)}</td>
              <td className="min-w-72 px-3 py-2 text-xs text-muted-foreground">
                <details>
                  <summary className="cursor-pointer text-foreground">Detalhes</summary>
                  <div className="mt-2 space-y-2">
                    <div>{row.score_explanation}</div>
                    <div className="text-foreground">{row.reasons.slice(0, 5).join(" | ") || "-"}</div>
                    <div>Componentes: EV {formatScore(row.score_components.ev_quality_score)}, Edge {formatScore(row.score_components.probability_edge_score)}, Linha {formatScore(row.score_components.market_line_quality_score)}, Dados {formatScore(row.score_components.data_quality_score)}, Penalidade {formatScore(row.score_components.risk_penalty)}</div>
                    <div>Score bruto {formatScore(row.score_components.raw_score)} | Score final {formatScore(row.score_components.final_score)}{row.score_components.applied_penalties.length > 0 ? ` | Penalidades aplicadas: ${row.score_components.applied_penalties.map((p) => `${p.flag} ${p.delta}`).join(", ")}` : ""}</div>
                    {row.risk_flags.length > 0 && <div>Penalidades: {row.risk_flags.join(" | ")}</div>}
                    <Button size="sm" variant="outline" onClick={() => copyPayload(row)}>
                      <ClipboardCopy className="mr-2 h-3 w-3" />
                      Copiar payload
                    </Button>
                    <pre className="max-h-56 overflow-auto rounded border bg-background p-2 text-[10px]">
                      {JSON.stringify(buildMlbOpportunityValidationPayload(row), null, 2)}
                    </pre>
                  </div>
                </details>
              </td>
              <td className="min-w-80 px-3 py-2 text-xs text-muted-foreground">
                <div className="space-y-1">
                  {row.alerts.slice(0, 5).map((alert, index) => <div key={`${row.opportunity_id}-alert-${index}`}>{formatAlertMessage(alert)}</div>)}
                  {row.risk_flags.length > 0 && <div className="text-warning">{row.risk_flags.slice(0, 3).join(" | ")}</div>}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={22} className="px-3 py-12 text-center text-sm text-muted-foreground">
                Nenhuma oportunidade gerada para o filtro atual.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ParsedContextPanel({ context }: { context: MlbBaseballReferenceMatchupContext }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-md border bg-background/50 p-3">
        <div className="text-sm font-semibold">Times identificados</div>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <TeamContextLine label="Visitante" team={context.teams.away} />
          <TeamContextLine label="Mandante" team={context.teams.home} />
        </div>
      </div>
      <div className="rounded-md border bg-background/50 p-3">
        <div className="text-sm font-semibold">Starters identificados</div>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <StarterContextLine label="Visitante" starter={context.starting_pitchers.away} />
          <StarterContextLine label="Mandante" starter={context.starting_pitchers.home} />
        </div>
      </div>
      <div className="rounded-md border bg-background/50 p-3">
        <div className="text-sm font-semibold">Qualidade do parser</div>
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          <div>Campos: {context.data_quality.parsed_fields_count}</div>
          <div>Confianca: {formatScore(context.data_quality.confidence)}</div>
          <div>
            Season series: {context.season_series.completed_games.length} concluído{context.season_series.completed_games.length === 1 ? "" : "s"} /{" "}
            {context.season_series.upcoming_games.length} futuro{context.season_series.upcoming_games.length === 1 ? "" : "s"}
            {Object.keys(context.season_series.yearly_summary).length > 0
              ? ` · resumo: ${Object.keys(context.season_series.yearly_summary).length} linhas`
              : ""}
          </div>
          <div>H2H (últimos jogos): {context.head_to_head.last_10_games.length}</div>
          {context.data_quality.missing_fields.length > 0 && (
            <div className="text-warning">Ausentes: {context.data_quality.missing_fields.join(", ")}</div>
          )}
          {context.data_quality.warnings.slice(0, 3).map((warning, index) => (
            <div key={`warning-${index}`} className="text-warning">{formatAlertMessage(warning)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CriticalPayloadPanel({
  payloads,
  onSendToCriticalValidation,
  onSendToValidator,
}: {
  payloads: MlbPreparedCriticalValidationPayload[];
  onSendToCriticalValidation: (payload: MlbPreparedCriticalValidationPayload) => void | Promise<void>;
  onSendToValidator: (payload: MlbPreparedCriticalValidationPayload) => void | Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Pacote para Validação Crítica</div>
      {payloads.map((payload) => {
        const handoffValidation = validateMlbValidatorHandoffPayload(buildMlbValidatorHandoffPayload(payload));
        const prep = payload.validation_preparation;
        const alignmentScore = payload.context_alignment.alignment_score;
        const marketDivergencePP =
          payload.opportunity.model_probability != null && payload.opportunity.market_probability_no_vig != null
            ? Math.abs(payload.opportunity.model_probability - payload.opportunity.market_probability_no_vig) * 100
            : 0;
        const isStrongConflict = prep.critical_adjusted_status === "strong_conflict";
        const isReviewBefore = prep.critical_adjusted_status === "review_before_validator";
        const highDivergence = marketDivergencePP >= 15;
        const shouldConfirm =
          payload.context_alignment.alignment_status === "conflicts_with_screener" ||
          alignmentScore <= 35 ||
          highDivergence;
        const handleSendCritical = () => {
          if (shouldConfirm && typeof window !== "undefined") {
            const isConflict = payload.context_alignment.alignment_status === "conflicts_with_screener";
            let msg: string;
            if (isConflict && highDivergence) {
              msg = "Esta oportunidade possui conflito forte e divergência alta contra o mercado no-vig. Enviar para Validação Crítica apenas para revisão manual?";
            } else if (isConflict) {
              msg = "Esta oportunidade possui conflito forte com o contexto detalhado. Enviar para Validação Crítica apenas para revisão manual?";
            } else if (highDivergence) {
              msg = "Esta oportunidade possui divergência alta contra o mercado no-vig. Enviar para Validação Crítica apenas para revisão manual?";
            } else {
              msg = "Esta oportunidade exige revisão manual antes de decidir. Enviar para Validação Crítica?";
            }
            const ok = window.confirm(msg);
            if (!ok) return;
          }
          void onSendToCriticalValidation(payload);
        };
        const handleSendValidator = () => {
          void onSendToValidator(payload);
        };
        return (
          <div key={`${payload.game.game_id}-${payload.opportunity.market}-${payload.opportunity.pick}`} className="rounded-md border bg-background/50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{payload.game.matchup} | {payload.opportunity.market} | {payload.opportunity.pick}</div>
              <div className="flex flex-wrap items-center gap-2">
                {isStrongConflict && (
                  <Badge variant="destructive">Conflito forte com o Screener</Badge>
                )}
                {isReviewBefore && !isStrongConflict && (
                  <Badge variant="outline" className="border-warning/60 text-warning">Revisar antes de enviar</Badge>
                )}
                {highDivergence && (
                  <Badge variant="outline" className="border-warning/60 text-warning">
                    Divergência alta contra mercado no-vig ({marketDivergencePP.toFixed(1)} p.p.)
                  </Badge>
                )}
                <Badge variant="outline">{prep.readiness_status}</Badge>
                <Button size="sm" onClick={handleSendCritical}>
                  <Send className="mr-2 h-4 w-4" />
                  Enviar para Validação Crítica
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSendValidator}
                  disabled={!handoffValidation.canSend}
                  title="Fluxo em teste. O destino principal agora é a Validação Crítica."
                >
                  ASP Validator (teste)
                </Button>
              </div>
            </div>

            {handoffValidation.warnings.length > 0 && (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {formatAlertMessage(handoffValidation.warnings[0])}
              </div>
            )}
            {handoffValidation.errors.length > 0 && (
              <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formatAlertMessage(handoffValidation.errors[0])}
              </div>
            )}
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <Info label="Alignment" value={payload.context_alignment.alignment_status} />
            <Info label="Alignment score" value={alignmentScore} />
            <Info label="Readiness" value={prep.validation_readiness_score} />
            <Info label="Flags" value={payload.context_alignment.critical_flags.length} />
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <Info label="Opportunity Score (bruto)" value={prep.raw_opportunity_score} />
            <Info label="Confidence (bruto)" value={prep.raw_confidence_score} />
            <Info label="Score pós-contexto" value={prep.critical_adjusted_score} />
            <Info label="Confiança pós-contexto" value={prep.critical_adjusted_confidence} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Fatores de suporte</div>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {payload.context_alignment.supporting_factors.map((item) => <li key={item}>{item}</li>)}
                {!payload.context_alignment.supporting_factors.length && <li>-</li>}
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground">Fatores de conflito</div>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {payload.context_alignment.conflicting_factors.map((item) => <li key={item}>{item}</li>)}
                {!payload.context_alignment.conflicting_factors.length && <li>-</li>}
              </ul>
            </div>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">Payload critico</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded border bg-background p-2 text-[10px]">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
          </div>
        );
      })}
    </div>
  );
}

type HandoffAuditStats = ReturnType<typeof getHandoffAuditStats>;

function HandoffAuditPanel({
  rows,
  stats,
  loading,
  marketOptions,
  period,
  status,
  market,
  decision,
  minScore,
  minEv,
  onPeriodChange,
  onStatusChange,
  onMarketChange,
  onDecisionChange,
  onMinScoreChange,
  onMinEvChange,
  onRefresh,
}: {
  rows: MlbScreenerHandoffAuditRecord[];
  stats: HandoffAuditStats;
  loading: boolean;
  marketOptions: string[];
  period: "all" | "today" | "7d" | "30d";
  status: MlbScreenerHandoffAuditStatus | "all";
  market: string;
  decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
  minScore: string;
  minEv: string;
  onPeriodChange: (value: "all" | "today" | "7d" | "30d") => void;
  onStatusChange: (value: MlbScreenerHandoffAuditStatus | "all") => void;
  onMarketChange: (value: string) => void;
  onDecisionChange: (value: "all" | "CONFIRMAR" | "PULAR" | "pending") => void;
  onMinScoreChange: (value: string) => void;
  onMinEvChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const markets = ["all", ...marketOptions];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span>Historico de Handoffs para Validator</span>
          <Badge variant="outline">Auditoria</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-background/50 p-3 text-sm text-muted-foreground">
          Auditoria de fluxo do Screener para o Validator. Nao cria prognostico, nao altera bankroll e nao alimenta o dashboard geral.
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <Info label="Handoffs enviados" value={stats.sent} />
          <Info label="Aplicados" value={stats.applied} />
          <Info label="Descartados" value={stats.discarded} />
          <Info label="Expirados" value={stats.expired} />
          <Info label="Validacoes concluidas" value={stats.completed} />
          <Info label="CONFIRMAR" value={stats.confirmed} />
          <Info label="PULAR" value={stats.skipped} />
          <Info label="Envio -> validacao" value={`${stats.sentToValidationRate.toFixed(1)}%`} />
          <Info label="Validacao -> confirmar" value={`${stats.validationToConfirmRate.toFixed(1)}%`} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Periodo">
            <Select value={period} onValueChange={(value) => onPeriodChange(value as "all" | "today" | "7d" | "30d")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">7 dias</SelectItem>
                <SelectItem value="30d">30 dias</SelectItem>
                <SelectItem value="all">Tudo</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(value) => onStatusChange(value as MlbScreenerHandoffAuditStatus | "all")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {HANDOFF_AUDIT_STATUSES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Mercado">
            <Select value={market} onValueChange={onMarketChange}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {markets.map((item) => <SelectItem key={item} value={item}>{item === "all" ? "Todos" : item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Decisao Validator">
            <Select value={decision} onValueChange={(value) => onDecisionChange(value as "all" | "CONFIRMAR" | "PULAR" | "pending")}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="CONFIRMAR">CONFIRMAR</SelectItem>
                <SelectItem value="PULAR">PULAR</SelectItem>
                <SelectItem value="pending">Sem decisao</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Score minimo">
            <Input inputMode="decimal" value={minScore} onChange={(event) => onMinScoreChange(event.target.value)} className="w-28" />
          </Field>
          <Field label="EV minimo (%)">
            <Input inputMode="decimal" value={minEv} onChange={(event) => onMinEvChange(event.target.value)} className="w-28" />
          </Field>
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {loading ? "Atualizando..." : "Atualizar historico"}
          </Button>
        </div>

        <div className="overflow-auto rounded-md border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-card text-xs uppercase text-muted-foreground">
              <tr>
                {["Data", "Jogo", "Mercado", "Pick", "Odd", "EV", "Score", "Conf.", "Readiness", "Status", "Decisao", "Validator", "Payload"].map((header) => (
                  <th key={header} className="px-3 py-2 text-left">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2 font-medium">{row.matchup ?? `${row.away_team ?? "-"} @ ${row.home_team ?? "-"}`}</td>
                  <td className="px-3 py-2">{row.market ?? "-"}</td>
                  <td className="px-3 py-2">{row.pick ?? "-"}</td>
                  <td className="px-3 py-2 font-mono">{formatOdd(row.odd)}</td>
                  <td className="px-3 py-2 font-mono">{formatEv(row.ev)}</td>
                  <td className="px-3 py-2 font-mono">{formatScore(row.opportunity_score)}</td>
                  <td className="px-3 py-2 font-mono">{formatScore(row.confidence_score)}</td>
                  <td className="px-3 py-2">{row.readiness_status ?? "-"}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{row.status}</Badge></td>
                  <td className="px-3 py-2">{row.validator_decision ?? "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.validator_record_id ?? "-"}</td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        <FileJson className="mr-1 inline h-3 w-3" />
                        ver
                      </summary>
                      <pre className="mt-2 max-h-72 overflow-auto rounded border bg-background p-2 text-[10px]">
                        {JSON.stringify(row.handoff_payload || row.critical_payload, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhum handoff encontrado para os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function MlbShadowSnapshotPanel({
  dailySnapshots,
  selectedSnapshot,
  opportunities,
  loading,
  marketOptions,
  market,
  status,
  sent,
  decision,
  minScore,
  minEv,
  onSaveSnapshot,
  onGenerateAndSave,
  onSelectSnapshot,
  onMarketChange,
  onStatusChange,
  onSentChange,
  onDecisionChange,
  onMinScoreChange,
  onMinEvChange,
  onRefresh,
}: {
  dailySnapshots: MlbDailyScreenerSnapshotRecord[];
  selectedSnapshot: MlbDailyScreenerSnapshotRecord | null;
  opportunities: MlbOpportunitySnapshotRecord[];
  loading: boolean;
  marketOptions: string[];
  market: string;
  status: string;
  sent: "all" | "sent" | "not_sent";
  decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
  minScore: string;
  minEv: string;
  onSaveSnapshot: () => void;
  onGenerateAndSave: () => void;
  onSelectSnapshot: (id: string) => void;
  onMarketChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSentChange: (value: "all" | "sent" | "not_sent") => void;
  onDecisionChange: (value: "all" | "CONFIRMAR" | "PULAR" | "pending") => void;
  onMinScoreChange: (value: string) => void;
  onMinEvChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const latest = dailySnapshots[0] ?? null;
  const snapshotStats = selectedSnapshot ? getOpportunitySnapshotStats(opportunities) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span>Etapa 08 - Snapshot Diario / Modo Sombra</span>
          <Badge variant="outline">Persistencia do Screener</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-background/50 p-3 text-sm text-muted-foreground">
          Salva o universo completo de oportunidades geradas pelo Screener por acao explicita. Nao envia ao Validator, nao cria prognostico e nao altera bankroll.
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onSaveSnapshot} disabled={loading}>
            <DatabaseZap className="mr-2 h-4 w-4" />
            Salvar snapshot do Screener
          </Button>
          <Button variant="outline" onClick={onGenerateAndSave} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Gerar todos + salvar snapshot
          </Button>
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar snapshots
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <Info label="Ultimo snapshot" value={latest ? formatDateTime(latest.created_at) : "-"} />
          <Info label="Run ID" value={latest?.run_id ?? "-"} />
          <Info label="Oportunidades" value={latest?.unified_opportunities_count ?? 0} />
          <Info label="Status" value={latest?.status ?? "-"} />
          <Info label="Jogos" value={selectedSnapshot?.games_count ?? latest?.games_count ?? 0} />
          <Info label="ANALISAR" value={selectedSnapshot?.analyze_count ?? latest?.analyze_count ?? 0} />
          <Info label="MONITORAR" value={selectedSnapshot?.monitor_count ?? latest?.monitor_count ?? 0} />
          <Info label="PULAR" value={selectedSnapshot?.skip_count ?? latest?.skip_count ?? 0} />
          <Info label="MISSING_DATA" value={selectedSnapshot?.missing_data_count ?? latest?.missing_data_count ?? 0} />
          <Info label="UNSUPPORTED_LINE" value={selectedSnapshot?.unsupported_line_count ?? latest?.unsupported_line_count ?? 0} />
          <Info label="Shortlist principal" value={selectedSnapshot?.shortlist_primary_count ?? latest?.shortlist_primary_count ?? 0} />
          <Info label="Selecionado" value={selectedSnapshot?.run_id ?? "-"} />
        </div>

        <div className="overflow-auto rounded-md border">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-card text-xs uppercase text-muted-foreground">
              <tr>
                {["Data", "Run ID", "Criado em", "Jogos", "Oportunidades", "ANALISAR", "MONITORAR", "PULAR", "Shortlist", "Status", "Acoes"].map((header) => (
                  <th key={header} className="px-3 py-2 text-left">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dailySnapshots.map((snapshot) => (
                <tr key={snapshot.id} className="border-t">
                  <td className="px-3 py-2">{snapshot.snapshot_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{snapshot.run_id}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(snapshot.created_at)}</td>
                  <td className="px-3 py-2">{snapshot.games_count ?? 0}</td>
                  <td className="px-3 py-2">{snapshot.unified_opportunities_count ?? 0}</td>
                  <td className="px-3 py-2">{snapshot.analyze_count ?? 0}</td>
                  <td className="px-3 py-2">{snapshot.monitor_count ?? 0}</td>
                  <td className="px-3 py-2">{snapshot.skip_count ?? 0}</td>
                  <td className="px-3 py-2">{snapshot.shortlist_primary_count ?? 0}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{snapshot.status}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => onSelectSnapshot(snapshot.id)}>Ver detalhes</Button>
                      <Button size="sm" variant="outline" onClick={() => void copyText(snapshot.run_id, "Run ID copiado.")}>Copiar run_id</Button>
                      <Button size="sm" variant="outline" onClick={() => exportDailySnapshotsCsv([snapshot])}>CSV</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!dailySnapshots.length && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">Nenhum snapshot salvo ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedSnapshot && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Mercado">
                <Select value={market} onValueChange={onMarketChange}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {marketOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={status} onValueChange={onStatusChange}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {SNAPSHOT_PRIORITY_STATUSES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Enviado">
                <Select value={sent} onValueChange={(value) => onSentChange(value as "all" | "sent" | "not_sent")}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="sent">Enviados</SelectItem>
                    <SelectItem value="not_sent">Nao enviados</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Decisao">
                <Select value={decision} onValueChange={(value) => onDecisionChange(value as "all" | "CONFIRMAR" | "PULAR" | "pending")}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="CONFIRMAR">CONFIRMAR</SelectItem>
                    <SelectItem value="PULAR">PULAR</SelectItem>
                    <SelectItem value="pending">Sem decisao</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Score minimo">
                <Input inputMode="decimal" value={minScore} onChange={(event) => onMinScoreChange(event.target.value)} className="w-28" />
              </Field>
              <Field label="EV minimo (%)">
                <Input inputMode="decimal" value={minEv} onChange={(event) => onMinEvChange(event.target.value)} className="w-28" />
              </Field>
              <Button variant="outline" onClick={() => exportOpportunitySnapshotsCsv(opportunities)} disabled={!opportunities.length}>
                Exportar oportunidades
              </Button>
            </div>

            {snapshotStats && (
              <div className="grid gap-2 md:grid-cols-4">
                <Info label="Geradas" value={snapshotStats.total} />
                <Info label="Enviadas" value={snapshotStats.sent} />
                <Info label="% enviada" value={formatRate(snapshotStats.sentRate)} />
                <Info label="ANALISAR nao enviadas" value={snapshotStats.analyzeNotSent} />
                <Info label="Score 80+ nao enviadas" value={snapshotStats.highScoreNotSent} />
                <Info label="EV 8%+ nao enviadas" value={snapshotStats.highEvNotSent} />
              </div>
            )}

            <OpportunitySnapshotTable rows={opportunities} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpportunitySnapshotTable({ rows }: { rows: MlbOpportunitySnapshotRecord[] }) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full min-w-[1260px] text-sm">
        <thead className="bg-card text-xs uppercase text-muted-foreground">
          <tr>
            {["Jogo", "Mercado", "Pick", "Linha", "Odd", "Prob. ASP", "Prob. mercado", "Edge", "EV", "Score", "Conf.", "Status", "Shortlist", "Enviado", "Decisao", "Alertas", "Risk flags"].map((header) => (
              <th key={header} className="px-3 py-2 text-left">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t align-top">
              <td className="px-3 py-2 font-medium">{row.matchup ?? `${row.away_team ?? "-"} @ ${row.home_team ?? "-"}`}</td>
              <td className="px-3 py-2">{row.market_label ?? "-"}</td>
              <td className="px-3 py-2">{row.pick_label ?? "-"}</td>
              <td className="px-3 py-2">{row.line ?? "-"}</td>
              <td className="px-3 py-2 font-mono">{formatOdd(row.offered_odd)}</td>
              <td className="px-3 py-2 font-mono">{formatPercentDecimal(row.model_prob)}</td>
              <td className="px-3 py-2 font-mono">{formatPercentDecimal(row.market_prob_no_vig)}</td>
              <td className="px-3 py-2 font-mono">{formatProbabilitySigned(row.probability_edge)}</td>
              <td className="px-3 py-2 font-mono">{formatEv(row.ev)}</td>
              <td className="px-3 py-2 font-mono">{formatScore(row.opportunity_score)}</td>
              <td className="px-3 py-2 font-mono">{formatScore(row.confidence_score)}</td>
              <td className="px-3 py-2">{row.priority_status ?? "-"}</td>
              <td className="px-3 py-2">{row.is_primary_shortlist ? "sim" : "nao"}</td>
              <td className="px-3 py-2">{row.sent_to_validator ? "sim" : "nao"}</td>
              <td className="px-3 py-2">{row.validator_decision ?? "-"}</td>
              <td className="px-3 py-2 text-xs">{row.alerts.join(", ") || "-"}</td>
              <td className="px-3 py-2 text-xs">{row.risk_flags.join(", ") || "-"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={17} className="px-3 py-6 text-center text-muted-foreground">Nenhuma oportunidade salva para os filtros atuais.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type CalibrationModel = ReturnType<typeof buildCalibrationModel>;
type CalibrationOptionSets = ReturnType<typeof buildCalibrationOptionSets>;

function MlbCalibrationPanel({
  rows,
  model,
  loading,
  snapshotRows,
  source,
  marketOptions,
  optionSets,
  status,
  market,
  decision,
  priority,
  readiness,
  alignment,
  minScore,
  maxScore,
  minConfidence,
  maxConfidence,
  minEv,
  homeTeam,
  awayTeam,
  onStatusChange,
  onMarketChange,
  onDecisionChange,
  onPriorityChange,
  onReadinessChange,
  onAlignmentChange,
  onMinScoreChange,
  onMaxScoreChange,
  onMinConfidenceChange,
  onMaxConfidenceChange,
  onMinEvChange,
  onHomeTeamChange,
  onAwayTeamChange,
  onRefresh,
  onSourceChange,
}: {
  rows: MlbScreenerHandoffAuditRecord[];
  model: CalibrationModel;
  loading: boolean;
  snapshotRows: MlbOpportunitySnapshotRecord[];
  source: "handoffs" | "snapshots" | "both";
  marketOptions: string[];
  optionSets: CalibrationOptionSets;
  status: MlbScreenerHandoffAuditStatus | "all";
  market: string;
  decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
  priority: string;
  readiness: string;
  alignment: string;
  minScore: string;
  maxScore: string;
  minConfidence: string;
  maxConfidence: string;
  minEv: string;
  homeTeam: string;
  awayTeam: string;
  onStatusChange: (value: MlbScreenerHandoffAuditStatus | "all") => void;
  onMarketChange: (value: string) => void;
  onDecisionChange: (value: "all" | "CONFIRMAR" | "PULAR" | "pending") => void;
  onPriorityChange: (value: string) => void;
  onReadinessChange: (value: string) => void;
  onAlignmentChange: (value: string) => void;
  onMinScoreChange: (value: string) => void;
  onMaxScoreChange: (value: string) => void;
  onMinConfidenceChange: (value: string) => void;
  onMaxConfidenceChange: (value: string) => void;
  onMinEvChange: (value: string) => void;
  onHomeTeamChange: (value: string) => void;
  onAwayTeamChange: (value: string) => void;
  onRefresh: () => void;
  onSourceChange: (value: "handoffs" | "snapshots" | "both") => void;
}) {
  const snapshotCalibration = getOpportunitySnapshotStats(snapshotRows);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span>Etapa 07 - Calibracao do Screener MLB</span>
          <Badge variant="outline">Somente leitura</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border bg-background/50 p-3 text-sm text-muted-foreground">
          Dashboard de calibracao baseado apenas na auditoria de handoffs. Nao cria prognostico, nao executa IA, nao altera Validator e nao toca na banca.
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Fonte">
            <Select value={source} onValueChange={(value) => onSourceChange(value as "handoffs" | "snapshots" | "both")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="handoffs">Handoffs enviados</SelectItem>
                <SelectItem value="snapshots">Snapshots do Screener</SelectItem>
                <SelectItem value="both">Ambos</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(value) => onStatusChange(value as MlbScreenerHandoffAuditStatus | "all")}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {HANDOFF_AUDIT_STATUSES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Mercado">
            <Select value={market} onValueChange={onMarketChange}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {marketOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Decisao">
            <Select value={decision} onValueChange={(value) => onDecisionChange(value as "all" | "CONFIRMAR" | "PULAR" | "pending")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="CONFIRMAR">CONFIRMAR</SelectItem>
                <SelectItem value="PULAR">PULAR</SelectItem>
                <SelectItem value="pending">Sem decisao</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <FilterSelect label="Priority" value={priority} options={optionSets.priorityStatuses} onChange={onPriorityChange} />
          <FilterSelect label="Readiness" value={readiness} options={optionSets.readinessStatuses} onChange={onReadinessChange} />
          <FilterSelect label="Alignment" value={alignment} options={optionSets.alignmentStatuses} onChange={onAlignmentChange} />
          <Field label="Score min/max">
            <div className="flex gap-2">
              <Input inputMode="decimal" value={minScore} onChange={(event) => onMinScoreChange(event.target.value)} className="w-20" />
              <Input inputMode="decimal" value={maxScore} onChange={(event) => onMaxScoreChange(event.target.value)} className="w-20" />
            </div>
          </Field>
          <Field label="Conf. min/max">
            <div className="flex gap-2">
              <Input inputMode="decimal" value={minConfidence} onChange={(event) => onMinConfidenceChange(event.target.value)} className="w-20" />
              <Input inputMode="decimal" value={maxConfidence} onChange={(event) => onMaxConfidenceChange(event.target.value)} className="w-20" />
            </div>
          </Field>
          <Field label="EV minimo (%)">
            <Input inputMode="decimal" value={minEv} onChange={(event) => onMinEvChange(event.target.value)} className="w-28" />
          </Field>
          <Field label="Mandante">
            <Input value={homeTeam} onChange={(event) => onHomeTeamChange(event.target.value)} className="w-40" />
          </Field>
          <Field label="Visitante">
            <Input value={awayTeam} onChange={(event) => onAwayTeamChange(event.target.value)} className="w-40" />
          </Field>
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {loading ? "Atualizando..." : "Atualizar dados"}
          </Button>
          <Button variant="outline" onClick={() => exportCalibrationCsv(rows)} disabled={!rows.length}>
            Exportar CSV
          </Button>
        </div>

        {(source === "snapshots" || source === "both") && (
          <div className="space-y-3 rounded-md border bg-background/50 p-3">
            <div className="text-sm font-semibold">Fonte Snapshots do Screener</div>
            <div className="grid gap-2 md:grid-cols-4">
              <Info label="Total gerado" value={snapshotCalibration.total} />
              <Info label="Enviado ao Validator" value={snapshotCalibration.sent} />
              <Info label="% enviado" value={formatRate(snapshotCalibration.sentRate)} />
              <Info label="ANALISAR nao enviado" value={snapshotCalibration.analyzeNotSent} />
              <Info label="Score 80+ nao enviado" value={snapshotCalibration.highScoreNotSent} />
              <Info label="EV 8%+ nao enviado" value={snapshotCalibration.highEvNotSent} />
            </div>
            <div className="text-xs text-muted-foreground">
              Selecione um snapshot na Etapa 08 para avaliar o universo completo de oportunidades geradas. Oportunidades nao enviadas nao possuem decisao final.
            </div>
          </div>
        )}

        {(source === "handoffs" || source === "both") && (
          <div className="grid gap-2 md:grid-cols-4">
            <Info label="Handoffs enviados" value={model.funnel.sent} />
            <Info label="Aplicados" value={model.funnel.applied} />
            <Info label="Descartados" value={model.funnel.discarded} />
            <Info label="Expirados" value={model.funnel.expired} />
            <Info label="Validacoes iniciadas" value={model.funnel.started} />
            <Info label="Validacoes concluidas" value={model.funnel.completed} />
            <Info label="Validacoes falhas" value={model.funnel.failed} />
            <Info label="CONFIRMAR" value={model.funnel.confirmed} />
            <Info label="PULAR" value={model.funnel.skipped} />
            <Info label="Envio -> aplicacao" value={formatRate(model.funnel.sentToAppliedRate)} />
            <Info label="Aplicacao -> validacao" value={formatRate(model.funnel.appliedToCompletedRate)} />
            <Info label="Validacao -> confirmar" value={formatRate(model.funnel.completedToConfirmRate)} />
            <Info label="Validacao -> pular" value={formatRate(model.funnel.completedToSkipRate)} />
          </div>
        )}

        {(source === "handoffs" || source === "both") && (
          <>
            <div className="grid gap-3 xl:grid-cols-2">
              <CalibrationAverages title="Medias - todos os handoffs" stats={model.averages.all} />
              <CalibrationAverages title="Medias - validacoes concluidas" stats={model.averages.completed} />
              <CalibrationAverages title="Medias - CONFIRMAR" stats={model.averages.confirmed} />
              <CalibrationAverages title="Medias - PULAR" stats={model.averages.skipped} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <CalibrationGroupTable title="Faixas de Opportunity Score" rows={model.scoreBands} />
              <CalibrationGroupTable title="Faixas de Confidence Score" rows={model.confidenceBands} />
              <CalibrationGroupTable title="Mercados" rows={model.marketGroups} />
              <CalibrationGroupTable title="Readiness" rows={model.readinessGroups} />
              <CalibrationGroupTable title="Alignment" rows={model.alignmentGroups} />
              <CalibrationRankingTable title="Risk flags mais comuns" rows={model.riskFlagRanking} total={rows.length} />
              <CalibrationRankingTable title="Alertas mais comuns" rows={model.alertRanking} total={rows.length} />
            </div>

            <div className="rounded-md border bg-background/50 p-3 text-sm text-muted-foreground">
              Performance financeira indisponivel ate liquidacao confiavel dos resultados vinculados no ASP Validator. Esta etapa nao mistura handoff analisado com aposta real.
            </div>

            <CalibrationDetailTable rows={rows} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CalibrationAverages({ title, stats }: { title: string; stats: CalibrationAverageStats }) {
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      <div className="grid gap-2 md:grid-cols-4">
        <Info label="Score medio" value={formatScore(stats.opportunityScore)} />
        <Info label="Confidence medio" value={formatScore(stats.confidenceScore)} />
        <Info label="EV medio" value={formatEv(stats.ev)} />
        <Info label="Prob. ASP" value={formatPercentDecimal(stats.modelProbability)} />
        <Info label="Prob. mercado" value={formatPercentDecimal(stats.marketProbability)} />
        <Info label="Edge medio" value={formatPercentDecimal(stats.edge)} />
        <Info label="Readiness medio" value={formatScore(stats.readinessScore)} />
        <Info label="Alignment medio" value={formatScore(stats.alignmentScore)} />
      </div>
    </div>
  );
}

function CalibrationGroupTable({ title, rows }: { title: string; rows: CalibrationGroupRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-background/60 px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-card text-xs uppercase text-muted-foreground">
            <tr>
              {["Grupo", "Total", "Aplic.", "Concl.", "CONF.", "PULAR", "Taxa CONF.", "EV", "Score", "Conf.", "Ready", "Align"].map((header) => (
                <th key={header} className="px-3 py-2 text-left">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t">
                <td className="px-3 py-2 font-medium">{row.label}</td>
                <td className="px-3 py-2">{row.total}</td>
                <td className="px-3 py-2">{row.applied}</td>
                <td className="px-3 py-2">{row.completed}</td>
                <td className="px-3 py-2">{row.confirmed}</td>
                <td className="px-3 py-2">{row.skipped}</td>
                <td className="px-3 py-2">
                  <RateBar value={row.confirmRate} />
                </td>
                <td className="px-3 py-2 font-mono">{formatEv(row.averageEv)}</td>
                <td className="px-3 py-2 font-mono">{formatScore(row.averageScore)}</td>
                <td className="px-3 py-2 font-mono">{formatScore(row.averageConfidence)}</td>
                <td className="px-3 py-2 font-mono">{formatScore(row.averageReadiness)}</td>
                <td className="px-3 py-2 font-mono">{formatScore(row.averageAlignment)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">Sem dados para este agrupamento.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalibrationRankingTable({ title, rows, total }: { title: string; rows: CalibrationRankingRow[]; total: number }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-background/60 px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="overflow-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-card text-xs uppercase text-muted-foreground">
            <tr>
              {["Item", "Qtd.", "% handoffs", "Taxa CONF.", "Taxa PULAR"].map((header) => (
                <th key={header} className="px-3 py-2 text-left">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t">
                <td className="px-3 py-2 font-medium">{row.label}</td>
                <td className="px-3 py-2">{row.count}</td>
                <td className="px-3 py-2">{formatRate(total ? (row.count / total) * 100 : 0)}</td>
                <td className="px-3 py-2">{formatRate(row.confirmRate)}</td>
                <td className="px-3 py-2">{formatRate(row.skipRate)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sem itens ranqueados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalibrationDetailTable({ rows }: { rows: MlbScreenerHandoffAuditRecord[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="border-b bg-background/60 px-3 py-2 text-sm font-semibold">Tabela detalhada de calibracao</div>
      <div className="overflow-auto">
        <table className="w-full min-w-[1320px] text-sm">
          <thead className="bg-card text-xs uppercase text-muted-foreground">
            <tr>
              {["Data envio", "Jogo", "Mercado", "Pick", "Linha", "Odd", "EV", "Score", "Confidence", "Readiness", "Alignment", "Status", "Decisao", "Validator", "Risk flags", "Acoes"].map((header) => (
                <th key={header} className="px-3 py-2 text-left">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const riskFlags = getRiskFlags(row);
              return (
                <tr key={row.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2 font-medium">{row.matchup ?? `${row.away_team ?? "-"} @ ${row.home_team ?? "-"}`}</td>
                  <td className="px-3 py-2">{row.market ?? "-"}</td>
                  <td className="px-3 py-2">{row.pick ?? "-"}</td>
                  <td className="px-3 py-2">{row.line ?? "-"}</td>
                  <td className="px-3 py-2 font-mono">{formatOdd(row.odd)}</td>
                  <td className="px-3 py-2 font-mono">{formatEv(row.ev)}</td>
                  <td className="px-3 py-2 font-mono">{formatScore(row.opportunity_score)}</td>
                  <td className="px-3 py-2 font-mono">{formatScore(row.confidence_score)}</td>
                  <td className="px-3 py-2">{row.readiness_status ?? "-"}</td>
                  <td className="px-3 py-2">{row.alignment_status ?? "-"}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{row.status}</Badge></td>
                  <td className="px-3 py-2">{row.validator_decision ?? "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.validator_record_id ?? "-"}</td>
                  <td className="px-3 py-2 text-xs">{riskFlags.join(", ") || "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void copyCalibrationPayload(row)}>
                        <ClipboardCopy className="mr-2 h-3 w-3" />
                        Payload
                      </Button>
                      <details className="w-full">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Ver payload</summary>
                        <pre className="mt-2 max-h-72 overflow-auto rounded border bg-background p-2 text-[10px]">
                          {JSON.stringify(row.handoff_payload || row.critical_payload, null, 2)}
                        </pre>
                      </details>
                      {row.validator_record_id && <Badge variant="secondary">Validator vinculado</Badge>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={16} className="px-3 py-6 text-center text-muted-foreground">Nenhum handoff para os filtros da calibracao.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateBar({ value }: { value: number }) {
  const width = `${Math.max(0, Math.min(100, value))}%`;
  return (
    <div className="min-w-32">
      <div className="mb-1 font-mono text-xs">{formatRate(value)}</div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function TeamContextLine({ label, team }: { label: string; team: MlbBaseballReferenceMatchupContext["teams"]["home"] }) {
  return (
    <div>
      <div className="font-medium text-foreground">{label}: {team.team_name ?? "-"}</div>
      <div>Record: {team.record?.raw ?? "-"} | Last10: {team.last10?.raw ?? "-"} | Last20: {team.last20?.raw ?? "-"} | Last30: {team.last30?.raw ?? "-"}</div>
      <div>Home: {team.home_record?.raw ?? "-"} | Away: {team.away_record?.raw ?? "-"} | vs LHP: {team.vs_lhp_record?.raw ?? "-"} | vs RHP: {team.vs_rhp_record?.raw ?? "-"}</div>
    </div>
  );
}

function StarterContextLine({ label, starter }: { label: string; starter: MlbBaseballReferenceMatchupContext["starting_pitchers"]["home"] }) {
  return (
    <div>
      <div className="font-medium text-foreground">{label}: {starter.name ?? "-"}</div>
      <div>{starter.throwing_hand ?? "-"} | {starter.season_record?.raw ?? "-"} | ERA {starter.era ?? "-"} | IP {starter.innings_pitched_display ?? "-"}</div>
      <div>K {starter.strikeouts ?? "-"} | BB {starter.walks ?? "-"} | HR {starter.home_runs_allowed ?? "-"} | Score {starter.starter_quality_score ?? "-"}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{String(value ?? "-")}</div>
    </div>
  );
}

const HANDOFF_AUDIT_STATUSES: MlbScreenerHandoffAuditStatus[] = [
  "created",
  "sent_to_validator",
  "applied_in_validator",
  "discarded",
  "expired",
  "validation_started",
  "validation_completed",
  "validation_failed",
];
const SNAPSHOT_PRIORITY_STATUSES = ["ANALISAR", "MONITORAR", "PULAR", "MISSING_DATA", "UNSUPPORTED_LINE"];

function filterSnapshotOpportunityRows(
  rows: MlbOpportunitySnapshotRecord[],
  filters: {
    market: string;
    status: string;
    sent: "all" | "sent" | "not_sent";
    decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
    minScore: number;
    minEv: number;
  },
) {
  return rows.filter((row) => {
    if (filters.market !== "all" && row.market_label !== filters.market) return false;
    if (filters.status !== "all" && row.priority_status !== filters.status) return false;
    if (filters.sent === "sent" && !row.sent_to_validator) return false;
    if (filters.sent === "not_sent" && row.sent_to_validator) return false;
    if (filters.decision === "pending" && row.validator_decision) return false;
    if (filters.decision !== "all" && filters.decision !== "pending" && row.validator_decision !== filters.decision) return false;
    if (Number.isFinite(filters.minScore) && filters.minScore > 0 && (row.opportunity_score ?? 0) < filters.minScore) return false;
    if (Number.isFinite(filters.minEv) && filters.minEv > 0 && ((row.ev ?? 0) * 100) < filters.minEv) return false;
    return true;
  });
}

function getOpportunitySnapshotStats(rows: MlbOpportunitySnapshotRecord[]) {
  const total = rows.length;
  const sent = rows.filter((row) => row.sent_to_validator).length;
  return {
    total,
    sent,
    sentRate: total ? (sent / total) * 100 : 0,
    analyzeNotSent: rows.filter((row) => row.priority_status === "ANALISAR" && !row.sent_to_validator).length,
    highScoreNotSent: rows.filter((row) => (row.opportunity_score ?? 0) >= 80 && !row.sent_to_validator).length,
    highEvNotSent: rows.filter((row) => (row.ev ?? 0) >= 0.08 && !row.sent_to_validator).length,
  };
}

function findOpportunityForCriticalPayload(rows: MlbUnifiedOpportunity[], payload: MlbPreparedCriticalValidationPayload) {
  return rows.find((row) =>
    row.game_id === payload.game.game_id &&
    row.market_label === payload.opportunity.market &&
    (row.pick_label ?? null) === (payload.opportunity.pick ?? null) &&
    row.line === payload.opportunity.line,
  );
}

function filterHandoffAuditRows(
  rows: MlbScreenerHandoffAuditRecord[],
  filters: {
    status: MlbScreenerHandoffAuditStatus | "all";
    market: string;
    decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
    minScore: number;
    minEv: number;
  },
) {
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.market !== "all" && row.market !== filters.market) return false;
    if (filters.decision === "pending" && row.validator_decision) return false;
    if (filters.decision !== "all" && filters.decision !== "pending" && row.validator_decision !== filters.decision) return false;
    if (Number.isFinite(filters.minScore) && filters.minScore > 0 && (row.opportunity_score ?? 0) < filters.minScore) return false;
    if (Number.isFinite(filters.minEv) && filters.minEv > 0 && ((row.ev ?? 0) * 100) < filters.minEv) return false;
    return true;
  });
}

function getHandoffAuditStats(rows: MlbScreenerHandoffAuditRecord[]) {
  const sent = rows.length;
  const applied = rows.filter((row) => row.status === "applied_in_validator" || row.applied_at).length;
  const discarded = rows.filter((row) => row.status === "discarded").length;
  const expired = rows.filter((row) => row.status === "expired").length;
  const completed = rows.filter((row) => row.status === "validation_completed").length;
  const confirmed = rows.filter((row) => row.validator_decision === "CONFIRMAR").length;
  const skipped = rows.filter((row) => row.validator_decision === "PULAR").length;
  return {
    sent,
    applied,
    discarded,
    expired,
    completed,
    confirmed,
    skipped,
    sentToValidationRate: sent ? (completed / sent) * 100 : 0,
    validationToConfirmRate: completed ? (confirmed / completed) * 100 : 0,
  };
}

type CalibrationAverageStats = ReturnType<typeof getCalibrationAverages>;
type CalibrationGroupRow = {
  label: string;
  total: number;
  applied: number;
  completed: number;
  confirmed: number;
  skipped: number;
  confirmRate: number;
  averageEv: number | null;
  averageScore: number | null;
  averageConfidence: number | null;
  averageReadiness: number | null;
  averageAlignment: number | null;
};
type CalibrationRankingRow = {
  label: string;
  count: number;
  confirmRate: number;
  skipRate: number;
};

function filterCalibrationRows(
  rows: MlbScreenerHandoffAuditRecord[],
  filters: {
    status: MlbScreenerHandoffAuditStatus | "all";
    market: string;
    decision: "all" | "CONFIRMAR" | "PULAR" | "pending";
    priorityStatus: string;
    readinessStatus: string;
    alignmentStatus: string;
    minScore: number;
    maxScore: number;
    minConfidence: number;
    maxConfidence: number;
    minEv: number;
    homeTeam: string;
    awayTeam: string;
  },
) {
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.market !== "all" && row.market !== filters.market) return false;
    if (filters.decision === "pending" && row.validator_decision) return false;
    if (filters.decision !== "all" && filters.decision !== "pending" && row.validator_decision !== filters.decision) return false;
    if (filters.priorityStatus !== "all" && row.priority_status !== filters.priorityStatus) return false;
    if (filters.readinessStatus !== "all" && row.readiness_status !== filters.readinessStatus) return false;
    if (filters.alignmentStatus !== "all" && row.alignment_status !== filters.alignmentStatus) return false;
    if (Number.isFinite(filters.minScore) && filters.minScore > 0 && (row.opportunity_score ?? 0) < filters.minScore) return false;
    if (Number.isFinite(filters.maxScore) && filters.maxScore > 0 && (row.opportunity_score ?? 0) > filters.maxScore) return false;
    if (Number.isFinite(filters.minConfidence) && filters.minConfidence > 0 && (row.confidence_score ?? 0) < filters.minConfidence) return false;
    if (Number.isFinite(filters.maxConfidence) && filters.maxConfidence > 0 && (row.confidence_score ?? 0) > filters.maxConfidence) return false;
    if (Number.isFinite(filters.minEv) && filters.minEv > 0 && ((row.ev ?? 0) * 100) < filters.minEv) return false;
    if (filters.homeTeam.trim() && !normalizeText(row.home_team).includes(normalizeText(filters.homeTeam))) return false;
    if (filters.awayTeam.trim() && !normalizeText(row.away_team).includes(normalizeText(filters.awayTeam))) return false;
    return true;
  });
}

function buildCalibrationOptionSets(rows: MlbScreenerHandoffAuditRecord[]) {
  return {
    priorityStatuses: uniqueValues(rows.map((row) => row.priority_status)),
    readinessStatuses: uniqueValues(rows.map((row) => row.readiness_status)),
    alignmentStatuses: uniqueValues(rows.map((row) => row.alignment_status)),
  };
}

function buildCalibrationModel(rows: MlbScreenerHandoffAuditRecord[]) {
  const completedRows = rows.filter(isValidationCompleted);
  const confirmedRows = rows.filter((row) => row.validator_decision === "CONFIRMAR");
  const skippedRows = rows.filter((row) => row.validator_decision === "PULAR");
  const applied = rows.filter(isAppliedInValidator).length;
  const started = rows.filter(isValidationStarted).length;
  const completed = completedRows.length;
  const confirmed = confirmedRows.length;
  const skipped = skippedRows.length;

  return {
    funnel: {
      sent: rows.length,
      applied,
      discarded: rows.filter((row) => row.status === "discarded").length,
      expired: rows.filter((row) => row.status === "expired").length,
      started,
      completed,
      failed: rows.filter((row) => row.status === "validation_failed").length,
      confirmed,
      skipped,
      sentToAppliedRate: rows.length ? (applied / rows.length) * 100 : 0,
      appliedToCompletedRate: applied ? (completed / applied) * 100 : 0,
      completedToConfirmRate: completed ? (confirmed / completed) * 100 : 0,
      completedToSkipRate: completed ? (skipped / completed) * 100 : 0,
    },
    averages: {
      all: getCalibrationAverages(rows),
      completed: getCalibrationAverages(completedRows),
      confirmed: getCalibrationAverages(confirmedRows),
      skipped: getCalibrationAverages(skippedRows),
    },
    scoreBands: groupByRanges(rows, [
      ["0-59", 0, 59],
      ["60-69", 60, 69],
      ["70-79", 70, 79],
      ["80-89", 80, 89],
      ["90-100", 90, 100],
    ], (row) => row.opportunity_score),
    confidenceBands: groupByRanges(rows, [
      ["0-49", 0, 49],
      ["50-57", 50, 57],
      ["58-65", 58, 65],
      ["66-72", 66, 72],
      ["73-78", 73, 78],
    ], (row) => row.confidence_score),
    marketGroups: groupByValue(rows, (row) => row.market ?? "Sem mercado"),
    readinessGroups: groupByValue(rows, (row) => row.readiness_status ?? "Sem readiness"),
    alignmentGroups: groupByValue(rows, (row) => row.alignment_status ?? "Sem alignment"),
    riskFlagRanking: rankCalibrationItems(rows, getRiskFlags),
    alertRanking: rankCalibrationItems(rows, getAlerts),
  };
}

function getCalibrationAverages(rows: MlbScreenerHandoffAuditRecord[]) {
  return {
    opportunityScore: average(rows.map((row) => row.opportunity_score)),
    confidenceScore: average(rows.map((row) => row.confidence_score)),
    ev: average(rows.map((row) => row.ev)),
    modelProbability: average(rows.map((row) => row.model_probability)),
    marketProbability: average(rows.map((row) => row.market_probability_no_vig)),
    edge: average(rows.map((row) => getProbabilityEdge(row))),
    readinessScore: average(rows.map((row) => getReadinessScore(row.readiness_status))),
    alignmentScore: average(rows.map((row) => row.alignment_score)),
  };
}

function groupByRanges(
  rows: MlbScreenerHandoffAuditRecord[],
  ranges: Array<[string, number, number]>,
  getValue: (row: MlbScreenerHandoffAuditRecord) => number | null,
) {
  return ranges.map(([label, min, max]) => buildCalibrationGroupRow(
    label,
    rows.filter((row) => {
      const value = getValue(row);
      return value != null && value >= min && value <= max;
    }),
  ));
}

function groupByValue(rows: MlbScreenerHandoffAuditRecord[], getValue: (row: MlbScreenerHandoffAuditRecord) => string) {
  return uniqueValues(rows.map(getValue)).map((label) => buildCalibrationGroupRow(label, rows.filter((row) => getValue(row) === label)));
}

function buildCalibrationGroupRow(label: string, rows: MlbScreenerHandoffAuditRecord[]): CalibrationGroupRow {
  const completed = rows.filter(isValidationCompleted).length;
  const confirmed = rows.filter((row) => row.validator_decision === "CONFIRMAR").length;
  return {
    label,
    total: rows.length,
    applied: rows.filter(isAppliedInValidator).length,
    completed,
    confirmed,
    skipped: rows.filter((row) => row.validator_decision === "PULAR").length,
    confirmRate: completed ? (confirmed / completed) * 100 : 0,
    averageEv: average(rows.map((row) => row.ev)),
    averageScore: average(rows.map((row) => row.opportunity_score)),
    averageConfidence: average(rows.map((row) => row.confidence_score)),
    averageReadiness: average(rows.map((row) => getReadinessScore(row.readiness_status))),
    averageAlignment: average(rows.map((row) => row.alignment_score)),
  };
}

function rankCalibrationItems(rows: MlbScreenerHandoffAuditRecord[], getItems: (row: MlbScreenerHandoffAuditRecord) => string[]): CalibrationRankingRow[] {
  const counts = new Map<string, MlbScreenerHandoffAuditRecord[]>();
  for (const row of rows) {
    for (const item of getItems(row)) {
      counts.set(item, [...(counts.get(item) ?? []), row]);
    }
  }
  return [...counts.entries()]
    .map(([label, itemRows]) => {
      const completed = itemRows.filter(isValidationCompleted).length;
      const confirmed = itemRows.filter((row) => row.validator_decision === "CONFIRMAR").length;
      const skipped = itemRows.filter((row) => row.validator_decision === "PULAR").length;
      return {
        label,
        count: itemRows.length,
        confirmRate: completed ? (confirmed / completed) * 100 : 0,
        skipRate: completed ? (skipped / completed) * 100 : 0,
      };
    })
    .sort((a, b) => b.count - a.count || b.confirmRate - a.confirmRate)
    .slice(0, 12);
}

async function copyCalibrationPayload(row: MlbScreenerHandoffAuditRecord) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(row.handoff_payload || row.critical_payload, null, 2));
    toast.success("Payload de calibracao copiado.");
  } catch {
    toast.error("Nao foi possivel copiar o payload.");
  }
}

function exportCalibrationCsv(rows: MlbScreenerHandoffAuditRecord[]) {
  const headers = [
    "handoff_id",
    "created_at",
    "game_id",
    "matchup",
    "market",
    "pick",
    "line",
    "odd",
    "ev",
    "opportunity_score",
    "confidence_score",
    "readiness_status",
    "alignment_status",
    "status",
    "validator_decision",
    "validator_record_id",
    "risk_flags",
  ];
  const csvRows = rows.map((row) => [
    row.handoff_id,
    row.created_at,
    row.game_id,
    row.matchup,
    row.market,
    row.pick,
    row.line,
    row.odd,
    row.ev,
    row.opportunity_score,
    row.confidence_score,
    row.readiness_status,
    row.alignment_status,
    row.status,
    row.validator_decision,
    row.validator_record_id,
    getRiskFlags(row).join("|"),
  ]);
  const csv = [headers, ...csvRows].map((line) => line.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `asp-screener-mlb-calibracao-${todayIso()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportDailySnapshotsCsv(rows: MlbDailyScreenerSnapshotRecord[]) {
  const headers = [
    "run_id",
    "snapshot_date",
    "created_at",
    "games_count",
    "unified_opportunities_count",
    "analyze_count",
    "monitor_count",
    "skip_count",
    "shortlist_primary_count",
    "status",
  ];
  const csvRows = rows.map((row) => [
    row.run_id,
    row.snapshot_date,
    row.created_at,
    row.games_count,
    row.unified_opportunities_count,
    row.analyze_count,
    row.monitor_count,
    row.skip_count,
    row.shortlist_primary_count,
    row.status,
  ]);
  downloadCsv(`asp-screener-mlb-daily-snapshots-${todayIso()}.csv`, [headers, ...csvRows]);
}

function exportOpportunitySnapshotsCsv(rows: MlbOpportunitySnapshotRecord[]) {
  const headers = [
    "run_id",
    "created_at",
    "game_id",
    "matchup",
    "market_family",
    "market_label",
    "pick_label",
    "line",
    "offered_odd",
    "median_odd",
    "market_base_odd",
    "bookmaker_melhor",
    "model_prob",
    "market_prob_no_vig",
    "probability_edge",
    "fair_odd",
    "ev",
    "opportunity_score",
    "confidence_score",
    "priority_status",
    "is_primary_shortlist",
    "sent_to_validator",
    "validator_decision",
    "risk_flags",
    "alerts",
  ];
  const csvRows = rows.map((row) => [
    row.run_id,
    row.created_at,
    row.game_id,
    row.matchup,
    row.market_family,
    row.market_label,
    row.pick_label,
    row.line,
    row.offered_odd,
    getSnapshotPayloadNumber(row, "median_odd"),
    getSnapshotPayloadNumber(row, "market_base_odd"),
    getSnapshotPayloadString(row, "bookmaker_melhor"),
    row.model_prob,
    row.market_prob_no_vig,
    row.probability_edge,
    row.fair_odd,
    row.ev,
    row.opportunity_score,
    row.confidence_score,
    row.priority_status,
    row.is_primary_shortlist,
    row.sent_to_validator,
    row.validator_decision,
    row.risk_flags.join("|"),
    row.alerts.join("|"),
  ]);
  downloadCsv(`asp-screener-mlb-opportunity-snapshots-${todayIso()}.csv`, [headers, ...csvRows]);
}

function getRiskFlags(row: MlbScreenerHandoffAuditRecord) {
  return safeStringArray(row.opportunity_payload?.risk_flags);
}

function getAlerts(row: MlbScreenerHandoffAuditRecord) {
  return safeStringArray(row.opportunity_payload?.alerts);
}

function getSnapshotPayloadNumber(row: MlbOpportunitySnapshotRecord, key: string) {
  const value = row.opportunity_payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getSnapshotPayloadString(row: MlbOpportunitySnapshotRecord, key: string) {
  const value = row.opportunity_payload?.[key];
  return typeof value === "string" && value ? value : null;
}

function getProbabilityEdge(row: MlbScreenerHandoffAuditRecord) {
  if (row.model_probability == null || row.market_probability_no_vig == null) return null;
  return row.model_probability - row.market_probability_no_vig;
}

function getReadinessScore(status: string | null) {
  if (status === "pronto_para_validator") return 100;
  if (status === "revisar_antes_do_validator") return 70;
  if (status === "contexto_incompleto") return 40;
  if (status === "nao_recomendado_para_validator") return 0;
  return null;
}

function isAppliedInValidator(row: MlbScreenerHandoffAuditRecord) {
  return Boolean(row.applied_at) || ["applied_in_validator", "validation_started", "validation_completed", "validation_failed"].includes(row.status);
}

function isValidationStarted(row: MlbScreenerHandoffAuditRecord) {
  return Boolean(row.validation_started_at) || ["validation_started", "validation_completed", "validation_failed"].includes(row.status);
}

function isValidationCompleted(row: MlbScreenerHandoffAuditRecord) {
  return row.status === "validation_completed" || Boolean(row.validation_completed_at) || Boolean(row.validator_record_id);
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}

function safeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((line) => line.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isBaseballSport(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return /baseball|beisebol|mlb/.test(normalized);
}

function isMlbLeague(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return !normalized || /mlb|major league baseball/.test(normalized);
}

function normalizeDateValue(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  const br = text.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return text;
}

function isSameDate(value: string | null | undefined, expected: string) {
  return normalizeDateValue(value) === normalizeDateValue(expected);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function sourceLabel(source: string | null | undefined) {
  if (source === "baseball_reference") return "Baseball-Reference";
  if (source === "csv_manual") return "CSV manual";
  return "-";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function formatRecord(wins: number | null, losses: number | null) {
  return wins == null || losses == null ? "-" : `${wins}-${losses}`;
}

function formatPct(value: number | null) {
  if (value == null) return "-";
  return value.toFixed(3).replace(/^0/, "");
}

function formatNumber(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(1);
}

function formatNumber2(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(2);
}

function formatOdd(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(2);
}

function formatProbability(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function formatProbabilitySigned(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(1)} p.p.`;
}

function formatEv(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

function formatPercentDecimal(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(2)}%`;
}

function formatRate(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}

function formatSignedNumber(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

function formatHandicapLine(value: number | null) {
  if (value == null) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}`;
}

function formatScore(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(1);
}

function evClass(value: number | null) {
  const base = "px-3 py-2 font-mono";
  if (value == null) return base;
  if (value >= 0.05) return `${base} text-success`;
  if (value >= 0.02) return `${base} text-warning`;
  if (value < 0) return `${base} text-muted-foreground`;
  return base;
}

function edgeClass(value: number | null) {
  const base = "px-3 py-2 font-mono";
  if (value == null) return base;
  if (value >= 0.05) return `${base} text-success`;
  if (value >= 0.025) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

function scoreClass(value: number | null) {
  const base = "px-3 py-2 font-mono font-semibold";
  if (value == null) return base;
  if (value >= 75) return `${base} text-success`;
  if (value >= 60) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

function gapClass(value: number | null) {
  const base = "px-3 py-2 font-mono";
  if (value == null) return base;
  if (Math.abs(value) >= 0.7) return `${base} text-success`;
  if (Math.abs(value) >= 0.45) return `${base} text-warning`;
  return `${base} text-muted-foreground`;
}

function getProjectionStats(rows: MlbMoneylineScreenerRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.candidate_status] += 1;
      return acc;
    },
    { total: 0, analisar: 0, monitorar: 0, pular: 0, missing_data: 0 },
  );
}

function getTotalsStats(rows: MlbTotalsScreenerRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.candidate_status] += 1;
      if (row.is_main_total_line) acc.main += 1;
      else acc.alternate += 1;
      acc.gameIds.add(row.game_id);
      return acc;
    },
    {
      total: 0,
      analisar: 0,
      monitorar: 0,
      pular: 0,
      missing_data: 0,
      main: 0,
      alternate: 0,
      gameIds: new Set<string>(),
      get games() {
        return this.gameIds.size;
      },
    },
  );
}

function filterTotalsRows(rows: MlbTotalsScreenerRow[], filter: MlbTotalsFilter) {
  if (filter === "todos") return rows;
  if (filter === "main") return rows.filter((row) => row.is_main_total_line);
  if (filter === "alternate") return rows.filter((row) => !row.is_main_total_line);
  return rows.filter((row) => row.candidate_status === filter);
}

function getHandicapStats(rows: MlbHandicapScreenerRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.candidate_status] += 1;
      if (row.is_main_handicap_line) acc.main += 1;
      else acc.alternate += 1;
      acc.gameIds.add(row.game_id);
      return acc;
    },
    {
      total: 0,
      analisar: 0,
      monitorar: 0,
      pular: 0,
      missing_data: 0,
      unsupported_line: 0,
      main: 0,
      alternate: 0,
      gameIds: new Set<string>(),
      get games() {
        return this.gameIds.size;
      },
    },
  );
}

function filterHandicapRows(rows: MlbHandicapScreenerRow[], filter: MlbHandicapFilter) {
  if (filter === "todos") return rows;
  if (filter === "main") return rows.filter((row) => row.is_main_handicap_line);
  if (filter === "alternate") return rows.filter((row) => !row.is_main_handicap_line);
  return rows.filter((row) => row.candidate_status === filter);
}

function getOpportunityStats(rows: MlbUnifiedOpportunity[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.priority_status] += 1;
      if (row.is_primary_shortlist) acc.primaryShortlist += 1;
      if (row.correlation_status === "correlated_alternative") acc.correlatedAlternatives += 1;
      if (acc.bestScore == null || row.opportunity_score > acc.bestScore) acc.bestScore = row.opportunity_score;
      if (row.ev != null && (acc.bestEv == null || row.ev > acc.bestEv)) acc.bestEv = row.ev;
      return acc;
    },
    {
      total: 0,
      ANALISAR: 0,
      MONITORAR: 0,
      PULAR: 0,
      MISSING_DATA: 0,
      UNSUPPORTED_LINE: 0,
      primaryShortlist: 0,
      correlatedAlternatives: 0,
      bestScore: null as number | null,
      bestEv: null as number | null,
    },
  );
}

function filterOpportunityRows(
  rows: MlbUnifiedOpportunity[],
  opts: {
    filter: MlbOpportunityFilter;
    hideCorrelatedAlternatives: boolean;
    minEv: number;
    minScore: number;
  },
) {
  const minEv = Number.isFinite(opts.minEv) ? opts.minEv / 100 : null;
  const minScore = Number.isFinite(opts.minScore) ? opts.minScore : null;
  return rows.filter((row) => {
    if (opts.hideCorrelatedAlternatives && row.correlation_status === "correlated_alternative") return false;
    if (minEv != null && (row.ev == null || row.ev < minEv)) return false;
    if (minScore != null && row.opportunity_score < minScore) return false;
    if (opts.filter === "todos") return true;
    if (opts.filter === "shortlist") return row.is_primary_shortlist;
    if (opts.filter === "analisar") return row.priority_status === "ANALISAR";
    if (opts.filter === "monitorar") return row.priority_status === "MONITORAR";
    if (opts.filter === "pular") return row.priority_status === "PULAR";
    if (opts.filter === "missing_data") return row.priority_status === "MISSING_DATA";
    if (opts.filter === "unsupported_line") return row.priority_status === "UNSUPPORTED_LINE";
    if (opts.filter === "moneyline") return row.market_family === "moneyline";
    if (opts.filter === "totals") return row.market_family === "totals";
    if (opts.filter === "handicap") return row.market_family === "handicap";
    if (opts.filter === "main") return row.is_main_line;
    if (opts.filter === "alternate") return !row.is_main_line;
    return true;
  });
}

function correlationLabel(row: MlbUnifiedOpportunity) {
  if (row.correlation_status === "primary") return "Primaria do jogo";
  if (row.correlation_status === "correlated_alternative") return "Alternativa correlacionada";
  return "Standalone";
}

type PersistedMlbScreenerUiState = {
  version: 1;
  snapshotDate: string;
  season: number;
  projectionRows: MlbMoneylineScreenerRow[];
  projectionGeneratedAt: string | null;
  totalsRows: MlbTotalsScreenerRow[];
  totalsGeneratedAt: string | null;
  handicapRows: MlbHandicapScreenerRow[];
  handicapGeneratedAt: string | null;
  opportunityRows: MlbUnifiedOpportunity[];
  opportunityGeneratedAt: string | null;
  selectedOpportunityIds: string[];
  criticalPayloads: MlbPreparedCriticalValidationPayload[];
};

const MLB_SCREENER_UI_STATE_PREFIX = "asp_screener_mlb_ui_state_v1";

function buildMlbScreenerUiStateKey(snapshotDate: string, season: number) {
  return `${MLB_SCREENER_UI_STATE_PREFIX}:${season}:${snapshotDate}`;
}

function readMlbScreenerUiState(snapshotDate: string, season: number): PersistedMlbScreenerUiState | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(buildMlbScreenerUiStateKey(snapshotDate, season));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedMlbScreenerUiState;
    if (parsed.version !== 1 || parsed.snapshotDate !== snapshotDate || parsed.season !== season) return null;
    return parsed;
  } catch {
    window.sessionStorage.removeItem(buildMlbScreenerUiStateKey(snapshotDate, season));
    return null;
  }
}

function writeMlbScreenerUiState(state: Omit<PersistedMlbScreenerUiState, "version">) {
  if (typeof window === "undefined") return;
  const payload: PersistedMlbScreenerUiState = { version: 1, ...state };
  try {
    window.sessionStorage.setItem(buildMlbScreenerUiStateKey(state.snapshotDate, state.season), JSON.stringify(payload));
  } catch (error) {
    console.warn("Nao foi possivel persistir o estado do ASP Screener.", error);
  }
}

function opportunityStatusBadgeVariant(status: MlbUnifiedOpportunity["priority_status"]) {
  if (status === "MISSING_DATA" || status === "UNSUPPORTED_LINE") return "destructive";
  if (status === "ANALISAR") return "outline";
  return "secondary";
}

async function copyText(text: string, successMessage: string) {
  await navigator.clipboard.writeText(text);
  toast.success(successMessage);
}

function leagueAverageSourceLabel(source: MlbTotalsScreenerRow["league_average_source"]) {
  if (source === "average_row") return "Average";
  if (source === "computed_from_teams") return "times";
  return "fallback";
}

function statusLabel(status: MlbProjectionCandidateStatus | MlbHandicapCandidateStatus) {
  const labels: Record<MlbProjectionCandidateStatus | MlbHandicapCandidateStatus, string> = {
    analisar: "ANALISAR",
    monitorar: "MONITORAR",
    pular: "PULAR",
    missing_data: "MISSING_DATA",
    unsupported_line: "UNSUPPORTED_LINE",
  };
  return labels[status];
}

function statusBadgeVariant(status: MlbProjectionCandidateStatus | MlbHandicapCandidateStatus) {
  if (status === "missing_data" || status === "unsupported_line") return "destructive";
  if (status === "analisar") return "outline";
  if (status === "monitorar") return "secondary";
  return "secondary";
}

function formatError(error: unknown) {
  return formatAlertMessage(error);
}

function formatAlertMessage(alert: unknown): string {
  if (alert == null) return "Alerta desconhecido";
  if (typeof alert === "string") return alert;
  if (typeof alert === "number" || typeof alert === "boolean") return String(alert);
  if (alert instanceof Error) return alert.message || "Erro desconhecido";
  if (typeof alert === "object") {
    const obj = alert as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.description === "string" && obj.description) return obj.description;
    if (typeof obj.statusText === "string" && obj.statusText) return obj.statusText;
    try {
      const json = JSON.stringify(obj);
      if (json && json !== "{}") return json;
    } catch {
      /* fallthrough */
    }
    return "Alerta nao estruturado";
  }
  return String(alert);
}
