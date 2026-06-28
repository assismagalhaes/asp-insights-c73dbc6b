import { createFileRoute } from "@tanstack/react-router";
import type { ClipboardEvent, DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BrainCircuit, CheckCircle2, ClipboardCheck, Cloud, Eye, FileJson, ImageUp, Loader2, Microscope, Plus, RefreshCw, Search, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { validateAspValidatorWithAi, type AspValidatorAiResult } from "@/lib/asp-validator-ai.functions";
import { validateAspValidatorWithOnlineAi, type AspValidatorOnlineAiResult } from "@/lib/asp-validator-ai-online.functions";
import { runAspValidatorSimulation, type AspValidatorSimulationResult } from "@/lib/asp-validator-simulation";
import { useConfiguracao } from "@/lib/db";
import { processAspValidatorOcr } from "@/lib/scraper-api.functions";
import { supabase } from "@/lib/supabase-public";

export const Route = createFileRoute("/_authenticated/asp-validator")({
  component: AspValidatorPage,
});

type Decision = "CONFIRMAR" | "PULAR";

type ValidatorForm = {
  sport: string;
  source_platform: string;
  league: string;
  match_date: string;
  home_team: string;
  away_team: string;
  market: string;
  pick: string;
  line: string;
  offered_odd: string;
  source_probability: string;
  source_ev: string;
  user_context: string;
};

type ValidationResult = {
  decision: Decision;
  confidence: string;
  validator_model: string;
  source_probability: number | null;
  source_fair_odd: number | null;
  offered_odd: number | null;
  source_ev: number | null;
  adjusted_probability: number;
  adjusted_fair_odd: number;
  adjusted_ev: number | null;
  simulation_summary: string;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  analysis_context: string;
};

type ValidatorUploadDraft = {
  local_id: string;
  file: File;
  upload_category: string;
  user_comment: string;
  upload_order: number;
  upload_source: "manual" | "drag_drop" | "clipboard";
};

type ValidatorRecord = {
  id: string;
  source_platform: string;
  sport: string;
  league: string | null;
  match_date: string | null;
  home_team: string;
  away_team: string;
  market: string;
  pick: string;
  line: string | null;
  offered_odd: number | null;
  source_probability: number | null;
  source_ev: number | null;
  source_fair_odd: number | null;
  adjusted_probability: number | null;
  adjusted_fair_odd: number | null;
  adjusted_ev: number | null;
  decision: Decision;
  confidence: string;
  validator_model: string;
  user_context: string | null;
  analysis_context: string | null;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  simulation_json: Record<string, unknown> | null;
  online_context_json: Record<string, unknown> | null;
  ocr_raw_text: string | null;
  ocr_structured_data: Record<string, unknown> | null;
  ocr_data_quality_score: number | null;
  ocr_structured_fields_count: number | null;
  simulation_type: string | null;
  structured_json: Record<string, unknown> | null;
  structured_status: "pending" | "processing" | "completed" | "failed" | string;
  structured_error: string | null;
  result_status: string | null;
  result_settled_at: string | null;
  final_score: string | null;
  result_notes: string | null;
  created_at: string;
  updated_at: string;
  stake_units: number | null;
  unit_value_brl: number | null;
  profit_units: number | null;
  profit_brl: number | null;
  clv: number | null;
  is_simulated_result: boolean | null;
  bankroll_applied: boolean | null;
};

type ValidatorUploadRecord = {
  id: string;
  validator_id: string;
  file_name: string;
  file_path: string | null;
  storage_bucket: string | null;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  upload_source: string | null;
  upload_category: string;
  user_comment: string | null;
  upload_order: number;
  ocr_status: string;
  ocr_text: string | null;
  ocr_error: string | null;
  ocr_structured_data: Record<string, unknown> | null;
  ocr_data_quality_score: number | null;
  ocr_structured_fields_count: number | null;
  structured_json: Record<string, unknown> | null;
  structured_status: "pending" | "processing" | "completed" | "failed" | string;
  structured_error: string | null;
  created_at: string;
  updated_at: string;
};

type EditableRecord = Pick<
  ValidatorForm,
  | "sport"
  | "source_platform"
  | "league"
  | "match_date"
  | "home_team"
  | "away_team"
  | "market"
  | "pick"
  | "line"
  | "offered_odd"
  | "source_probability"
  | "source_ev"
  | "user_context"
> & {
  source_fair_odd: string;
};

type ResultForm = {
  result_status: string;
  final_odd: string;
  stake_units: string;
  unit_value_brl: string;
  clv: string;
  final_score: string;
  result_notes: string;
  result_settled_at: string;
};

type ValidatorDashboardFilters = {
  period: "all" | "7d" | "30d" | "month" | "year";
  sport: string;
  league: string;
  source_platform: string;
  validator_model: string;
  market: string;
  decision: string;
  result: string;
};

type ValidatorInsert = Omit<ValidatorForm, "offered_odd" | "source_probability" | "source_ev"> & {
  offered_odd: number | null;
  source_probability: number | null;
  source_ev: number | null;
  source_fair_odd: number | null;
  adjusted_probability: number;
  adjusted_fair_odd: number;
  adjusted_ev: number | null;
  decision: Decision;
  confidence: string;
  validator_model: string;
  analysis_context: string;
  favorable_blocks: string[];
  against_blocks: string[];
  alerts: string[];
  final_analysis: string;
  simulation_json: Record<string, unknown>;
  online_context_json: Record<string, unknown>;
  ocr_raw_text: string | null;
  ocr_structured_data: Record<string, unknown>;
  ocr_data_quality_score: number | null;
  ocr_structured_fields_count: number | null;
  structured_json: Record<string, unknown>;
  structured_status: "pending" | "processing" | "completed" | "failed";
  structured_error: string | null;
  result_status: string | null;
  stake_units: number | null;
  unit_value_brl: number | null;
  profit_units: number | null;
  profit_brl: number | null;
  clv: number | null;
  result_settled_at: string | null;
  final_score: string | null;
  result_notes: string | null;
  simulation_type: string | null;
  is_simulated_result: boolean;
  bankroll_applied: boolean;
};

const validatorDb = supabase as unknown as {
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

const ASP_VALIDATOR_UPLOAD_BUCKET = "asp-validator-uploads";

const INITIAL_FORM: ValidatorForm = {
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

const SPORTS = ["Futebol", "Baseball", "Basketball", "Hockey", "American Football", "Tenis", "Outro"];
const PLATFORMS = ["Manual", "PackBall", "Forebet", "BetClan", "Flashscore", "Outro"];
const MARKETS = [
  "Moneyline",
  "Resultado da Partida",
  "Total de Gols",
  "Total de Pontos",
  "Total de Corridas",
  "Handicap Asiatico",
  "Dupla Chance",
  "Ambas Marcam",
  "Escanteios",
  "Cartoes",
  "HT/ST",
  "Outro",
];
const UPLOAD_CATEGORIES = [
  "Prognostico principal",
  "Ultimos jogos gerais",
  "Casa/Fora",
  "Estatisticas do mercado",
  "Classificacao/contexto",
  "Outro",
];

const INITIAL_DASHBOARD_FILTERS: ValidatorDashboardFilters = {
  period: "all",
  sport: "all",
  league: "all",
  source_platform: "all",
  validator_model: "all",
  market: "all",
  decision: "all",
  result: "all",
};

function AspValidatorPage() {
  const { data: cfg } = useConfiguracao();
  const [form, setForm] = useState<ValidatorForm>(INITIAL_FORM);
  const [uploads, setUploads] = useState<ValidatorUploadDraft[]>([]);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<ValidatorRecord[]>([]);
  const [uploadsByRecord, setUploadsByRecord] = useState<Record<string, ValidatorUploadRecord[]>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [dashboardFilters, setDashboardFilters] = useState<ValidatorDashboardFilters>(INITIAL_DASHBOARD_FILTERS);
  const [selectedRecord, setSelectedRecord] = useState<ValidatorRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<EditableRecord | null>(null);
  const [ocrAppliedFields, setOcrAppliedFields] = useState<Partial<Record<keyof EditableRecord, boolean>>>({});
  const [resultForm, setResultForm] = useState<ResultForm | null>(null);
  const [editingUploadComments, setEditingUploadComments] = useState<Record<string, string>>({});
  const [ocrFilesByUpload, setOcrFilesByUpload] = useState<Record<string, File>>({});
  const [processingOcr, setProcessingOcr] = useState<Record<string, boolean>>({});
  const [structuringRecord, setStructuringRecord] = useState(false);
  const [simulatingRecord, setSimulatingRecord] = useState(false);
  const [validatingAiRecord, setValidatingAiRecord] = useState(false);
  const [validatingOnlineRecord, setValidatingOnlineRecord] = useState(false);
  const [updatingRecord, setUpdatingRecord] = useState(false);

  const validatorModel = useMemo(() => inferValidatorModel(form.market, form.pick), [form.market, form.pick]);
  const hasManualCore = useMemo(
    () => Boolean(form.sport && form.source_platform && form.home_team && form.away_team && form.market && form.pick),
    [form],
  );
  // Permite validar tambem quando ha uploads (OCR podera preencher campos automaticamente)
  const canValidate = hasManualCore || uploads.length > 0;

  const update = (field: keyof ValidatorForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await validatorDb.from("asp_validator_registros").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      const nextRecords = data ?? [];
      setRecords(nextRecords);

      if (!nextRecords.length) {
        setUploadsByRecord({});
        return;
      }

      const ids = nextRecords.map((record) => record.id);
      const { data: uploadRows, error: uploadError } = await validatorDb
        .from("asp_validator_uploads")
        .select("*")
        .in("validator_id", ids)
        .order("upload_order", { ascending: true });
      if (uploadError) throw uploadError;
      setUploadsByRecord(groupUploads(uploadRows ?? []));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel carregar o historico do ASP Validator.");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const addUploads = (files: FileList | null, uploadSource: ValidatorUploadDraft["upload_source"] = "manual") => {
    if (!files?.length) return;
    setUploads((prev) => {
      const nextFiles = Array.from(files).map((file, index) => ({
        local_id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
        file,
        upload_category: UPLOAD_CATEGORIES[0],
        user_comment: "",
        upload_order: prev.length + index + 1,
        upload_source: uploadSource,
      }));
      return [...prev, ...nextFiles];
    });
  };
  const updateUpload = (localId: string, patch: Partial<Pick<ValidatorUploadDraft, "upload_category" | "user_comment">>) => {
    setUploads((prev) => prev.map((upload) => (upload.local_id === localId ? { ...upload, ...patch } : upload)));
  };
  const removeUpload = (localId: string) => {
    setUploads((prev) => prev.filter((upload) => upload.local_id !== localId).map((upload, index) => ({ ...upload, upload_order: index + 1 })));
  };

  const validate = async () => {
    if (!canValidate) {
      toast.error("Preencha esporte, origem, confronto, mercado e pick, ou adicione uploads para OCR.");
      return;
    }
    if (!hasManualCore && uploads.length > 0) {
      toast.info("Validando com base nos uploads/OCR. Campos manuais ausentes serao inferidos quando possivel.");
    }
    setSaving(true);
    const next = await validateWithAiFallback(buildFormValidationContext(form, uploads, validatorModel));
    setSaving(false);
    setResult(next);
    const saved = await saveValidation(form, next, uploads, setSaving);
    if (saved) {
      setUploads([]);
      await loadHistory();
    }
  };

  const openRecord = (record: ValidatorRecord) => {
    setSelectedRecord(record);
    setEditingRecord(recordToEditable(record));
    setOcrAppliedFields({});
    setResultForm(recordToResultForm(record, cfg?.valor_unidade_padrao ?? 10));
    setEditingUploadComments(
      Object.fromEntries((uploadsByRecord[record.id] ?? []).map((upload) => [upload.id, upload.user_comment ?? ""])),
    );
    setOcrFilesByUpload({});
  };

  const updateEdit = (field: keyof EditableRecord, value: string) => {
    setEditingRecord((prev) => (prev ? { ...prev, [field]: value } : prev));
    setOcrAppliedFields((prev) => ({ ...prev, [field]: false }));
  };

  const applyOcrDataToEditingRecord = () => {
    if (!selectedRecord || !editingRecord) return;
    const patch = buildEditablePatchFromStructured(selectedRecord);
    const entries = Object.entries(patch).filter((entry): entry is [keyof EditableRecord, string] => Boolean(entry[1]?.trim()));
    if (!entries.length) {
      toast.message("Nenhum dado OCR estruturado disponivel para aplicar ao formulario.");
      return;
    }

    const next = { ...editingRecord };
    const applied: Partial<Record<keyof EditableRecord, boolean>> = {};
    const conflicts: Array<[keyof EditableRecord, string]> = [];

    for (const [field, value] of entries) {
      const current = String(next[field] ?? "").trim();
      if (!current) {
        next[field] = value as never;
        applied[field] = true;
      } else if (normalize(current) !== normalize(value)) {
        conflicts.push([field, value]);
      }
    }

    if (conflicts.length) {
      const shouldOverwrite = window.confirm(
        `O OCR encontrou ${conflicts.length} campo(s) diferente(s) do formulario. Deseja substituir esses campos pelos dados OCR?`,
      );
      if (shouldOverwrite) {
        for (const [field, value] of conflicts) {
          next[field] = value as never;
          applied[field] = true;
        }
      }
    }

    if (!Object.keys(applied).length) {
      toast.message("Dados OCR revisados; nenhum campo vazio foi alterado.");
      return;
    }

    setEditingRecord(next);
    setOcrAppliedFields((prev) => ({ ...prev, ...applied }));
    toast.success("Dados OCR aplicados ao formulario. Revise e salve as alteracoes.");
  };

  const updateResultForm = (field: keyof ResultForm, value: string) => {
    setResultForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveRecordEdit = async () => {
    if (!selectedRecord || !editingRecord) return;
    if (selectedRecord.result_status) {
      toast.error("Registro com resultado nao pode ser editado.");
      return;
    }
    setUpdatingRecord(true);
    try {
      const sourceProbability = normalizeProbability(parseNumber(editingRecord.source_probability));
      const offeredOdd = parseNumber(editingRecord.offered_odd);
      const sourceEv = normalizeSourceEv(parseNumber(editingRecord.source_ev), editingRecord.source_platform);
      const sourceFairOdd = parseNumber(editingRecord.source_fair_odd);
      const validatorModel = inferValidatorModel(editingRecord.market, editingRecord.pick);
      const { error } = await validatorDb
        .from("asp_validator_registros")
        .update({
          sport: editingRecord.sport,
          source_platform: editingRecord.source_platform,
          league: editingRecord.league || null,
          match_date: editingRecord.match_date || null,
          home_team: editingRecord.home_team,
          away_team: editingRecord.away_team,
          market: editingRecord.market,
          pick: editingRecord.pick,
          line: editingRecord.line || null,
          offered_odd: offeredOdd,
          source_probability: sourceProbability,
          source_ev: sourceEv,
          source_fair_odd: sourceFairOdd ?? (sourceProbability ? round(1 / (sourceProbability / 100), 2) : null),
          validator_model: validatorModel,
          user_context: editingRecord.user_context || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedRecord.id);
      if (error) throw error;

      const currentUploads = uploadsByRecord[selectedRecord.id] ?? [];
      for (const upload of currentUploads) {
        const comment = editingUploadComments[upload.id] ?? "";
        const { error: uploadError } = await validatorDb
          .from("asp_validator_uploads")
          .update({ user_comment: comment || null, updated_at: new Date().toISOString() })
          .eq("id", upload.id);
        if (uploadError) throw uploadError;
      }

      toast.success("Registro atualizado.");
      await loadHistory();
      setSelectedRecord(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel atualizar o registro.");
    } finally {
      setUpdatingRecord(false);
    }
  };

  const deleteRecord = async (record: ValidatorRecord) => {
    if (record.result_status) {
      toast.error("Registro com resultado nao pode ser excluido.");
      return;
    }
    if (!window.confirm("Excluir este registro do ASP Validator?")) return;
    try {
      const { error } = await validatorDb.from("asp_validator_registros").delete().eq("id", record.id);
      if (error) throw error;
      toast.success("Registro excluido.");
      await loadHistory();
      if (selectedRecord?.id === record.id) setSelectedRecord(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel excluir o registro.");
    }
  };

  const attachOcrFile = (uploadId: string, file: File | null) => {
    if (!file) return;
    setOcrFilesByUpload((prev) => ({ ...prev, [uploadId]: file }));
  };

  const processUploadOcr = async (upload: ValidatorUploadRecord): Promise<boolean> => {
    if (!selectedRecord) return false;

    setProcessingOcr((prev) => ({ ...prev, [upload.id]: true }));
    try {
      const file = await getUploadFileForOcr(upload, ocrFilesByUpload[upload.id]);
      await validatorDb.from("asp_validator_uploads").update({ ocr_status: "processing", ocr_error: null, updated_at: new Date().toISOString() }).eq("id", upload.id);
      const contentBase64 = await fileToBase64(file);
      const payload = await processAspValidatorOcr({
        data: {
          validator_id: selectedRecord.id,
          upload_id: upload.id,
          upload_category: upload.upload_category,
          user_comment: editingUploadComments[upload.id] ?? upload.user_comment ?? "",
          file: {
            name: file.name,
            type: file.type || "application/octet-stream",
            content_base64: contentBase64,
          },
        },
      });
      const ocrPayload = parseOcrPayload(payload);
      const baseUploads = uploadsByRecord[selectedRecord.id] ?? [];
      const nextUploads = updateUploadInList(baseUploads.length ? baseUploads : [upload], upload.id, ocrPayload);
      await persistOcrResult(selectedRecord, baseUploads, upload, ocrPayload);
      const structured = await persistStructuredOcr(selectedRecord, nextUploads);
      const recordWithStructured = {
        ...selectedRecord,
        ocr_raw_text: buildCombinedOcrText(nextUploads),
        structured_json: structured,
        ocr_structured_data: structured,
        ocr_data_quality_score: structured.data_quality_score,
        ocr_structured_fields_count: structured.structured_fields_count,
        structured_status: "completed",
        structured_error: null,
      };
      const simulationUpdate = await persistSimulationResult(recordWithStructured);
      setOcrFilesByUpload((prev) => {
        const next = { ...prev };
        delete next[upload.id];
        return next;
      });
      toast[ocrPayload.ocr_status === "completed" ? "success" : "error"](
        ocrPayload.ocr_status === "completed" ? "OCR concluido." : ocrPayload.ocr_error || "OCR falhou.",
      );
      await loadHistory();
      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              ...recordWithStructured,
              ...simulationUpdate,
            }
          : prev,
      );
      setUploadsByRecord((prev) => ({ ...prev, [selectedRecord.id]: applyStructuredUploads(nextUploads, structured) }));
      return ocrPayload.ocr_status === "completed";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao processar OCR.";
      await validatorDb
        .from("asp_validator_uploads")
        .update({ ocr_status: "failed", ocr_error: message, updated_at: new Date().toISOString() })
        .eq("id", upload.id);
      toast.error(message);
      return false;
    } finally {
      setProcessingOcr((prev) => ({ ...prev, [upload.id]: false }));
    }
  };

  const processAllAvailableOcr = async () => {
    if (!selectedRecord) return;
    const currentUploads = uploadsByRecord[selectedRecord.id] ?? [];
    const available = currentUploads.filter((upload) => Boolean(ocrFilesByUpload[upload.id]) || Boolean(upload.file_path));
    if (!available.length) {
      toast.error("Nenhum arquivo salvo esta disponivel para OCR.");
      return;
    }
    let processed = 0;
    let failed = 0;
    for (const upload of available) {
      const ok = await processUploadOcr(upload);
      if (ok) {
        processed += 1;
      } else {
        failed += 1;
      }
    }
    toast.message(`OCR em lote finalizado: ${available.length} encontrado(s), ${processed} processado(s), ${failed} falha(s).`);
  };

  const structureSelectedRecordOcr = async () => {
    if (!selectedRecord) return;
    const currentUploads = uploadsByRecord[selectedRecord.id] ?? [];
    setStructuringRecord(true);
    try {
      const structured = await persistStructuredOcr(selectedRecord, currentUploads);
      const recordWithStructured = {
        ...selectedRecord,
        structured_json: structured,
        ocr_structured_data: structured,
        ocr_data_quality_score: structured.data_quality_score,
        ocr_structured_fields_count: structured.structured_fields_count,
        structured_status: "completed",
        structured_error: null,
      };
      const simulationUpdate = await persistSimulationResult(recordWithStructured);

      toast.success("OCR estruturado em JSON.");
      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              ...recordWithStructured,
              ...simulationUpdate,
            }
          : prev,
      );
      setUploadsByRecord((prev) => ({ ...prev, [selectedRecord.id]: applyStructuredUploads(prev[selectedRecord.id] ?? currentUploads, structured) }));
      await loadHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel estruturar o OCR.";
      await validatorDb
        .from("asp_validator_registros")
        .update({ structured_status: "failed", structured_error: message, updated_at: new Date().toISOString() })
        .eq("id", selectedRecord.id);
      setSelectedRecord((prev) => (prev ? { ...prev, structured_status: "failed", structured_error: message } : prev));
      toast.error(message);
    } finally {
      setStructuringRecord(false);
    }
  };

  const runSelectedRecordSimulation = async () => {
    if (!selectedRecord) return;
    setSimulatingRecord(true);
    try {
      const simulationUpdate = await persistSimulationResult(selectedRecord);
      const simulation = simulationUpdate.simulation_json;

      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              ...simulationUpdate,
            }
          : prev,
      );
      toast[simulation.status === "completed" ? "success" : simulation.status === "failed" ? "error" : "message"](
        simulation.status === "completed"
          ? "Simulacao concluida."
          : simulation.status === "low_confidence"
            ? "Simulacao concluida com baixa confiabilidade."
            : simulation.status === "not_applicable"
              ? "Simulacao nao aplicada para este mercado."
              : "Simulacao falhou.",
      );
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel executar a simulacao.");
    } finally {
      setSimulatingRecord(false);
    }
  };

  const ensureOcrForStoredUploads = async (): Promise<ValidatorUploadRecord[]> => {
    if (!selectedRecord) return [];
    const currentUploads = uploadsByRecord[selectedRecord.id] ?? [];
    const pending = currentUploads.filter(
      (upload) => Boolean(upload.file_path) && upload.ocr_status !== "completed",
    );
    if (!pending.length) return currentUploads;
    toast.info(`Processando OCR de ${pending.length} arquivo(s) salvo(s) no Storage...`);
    for (const upload of pending) {
      await processUploadOcr(upload);
    }
    return uploadsByRecord[selectedRecord.id] ?? currentUploads;
  };

  const validateSelectedRecordWithAi = async () => {
    if (!selectedRecord) return;
    setValidatingAiRecord(true);
    try {
      const currentUploads = await ensureOcrForStoredUploads();
      const next = await validateWithAiFallback(buildRecordValidationContext(selectedRecord, currentUploads));
      const { error } = await validatorDb
        .from("asp_validator_registros")
        .update({
          decision: next.decision,
          confidence: next.confidence,
          source_fair_odd: next.source_fair_odd,
          source_ev: next.source_ev,
          adjusted_probability: next.adjusted_probability,
          adjusted_fair_odd: next.adjusted_fair_odd,
          adjusted_ev: next.adjusted_ev,
          favorable_blocks: next.favorable_blocks,
          against_blocks: next.against_blocks,
          alerts: next.alerts,
          final_analysis: next.final_analysis,
          analysis_context: next.analysis_context,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedRecord.id);
      if (error) throw error;
      setSelectedRecord((prev) =>
        prev
          ? {
              ...prev,
              decision: next.decision,
              confidence: next.confidence,
              source_fair_odd: next.source_fair_odd,
              source_ev: next.source_ev,
              adjusted_probability: next.adjusted_probability,
              adjusted_fair_odd: next.adjusted_fair_odd,
              adjusted_ev: next.adjusted_ev,
              favorable_blocks: next.favorable_blocks,
              against_blocks: next.against_blocks,
              alerts: next.alerts,
              final_analysis: next.final_analysis,
              analysis_context: next.analysis_context,
            }
          : prev,
      );
      toast.success("Validacao IA atualizada.");
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel validar com IA.");
    } finally {
      setValidatingAiRecord(false);
    }
  };

  const validateSelectedRecordWithOnlineAi = async () => {
    if (!selectedRecord) return;
    setValidatingOnlineRecord(true);
    try {
      const currentUploads = await ensureOcrForStoredUploads();
      const context = {
        ...buildRecordValidationContext(selectedRecord, currentUploads),
        previous_ai_analysis: {
          decision: selectedRecord.decision,
          confidence: selectedRecord.confidence,
          favorable_blocks: selectedRecord.favorable_blocks,
          against_blocks: selectedRecord.against_blocks,
          alerts: selectedRecord.alerts,
          final_analysis: selectedRecord.final_analysis,
          analysis_context: selectedRecord.analysis_context,
        },
      };
      const next = await validateAspValidatorWithOnlineAi({ data: { context } });
      const { error } = await validatorDb
        .from("asp_validator_registros")
        .update({
          decision: next.decision,
          confidence: next.confidence,
          source_fair_odd: next.source_fair_odd,
          source_ev: next.source_ev,
          adjusted_probability: next.adjusted_probability,
          adjusted_fair_odd: next.adjusted_fair_odd,
          adjusted_ev: next.adjusted_ev,
          online_context_json: next.online_context_json,
          favorable_blocks: next.favorable_blocks,
          against_blocks: next.against_blocks,
          alerts: next.alerts,
          final_analysis: next.final_analysis,
          analysis_context: next.analysis_context,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedRecord.id);
      if (error) throw error;
      setSelectedRecord((prev) => (prev ? applyOnlineAiResult(prev, next) : prev));
      toast.success("IA + Pesquisa concluida.");
      await loadHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha na IA + Pesquisa.";
      const failedOnline = buildFailedOnlineContext(selectedRecord.online_context_json, message);
      await validatorDb
        .from("asp_validator_registros")
        .update({ online_context_json: failedOnline, updated_at: new Date().toISOString() })
        .eq("id", selectedRecord.id);
      setSelectedRecord((prev) => (prev ? { ...prev, online_context_json: failedOnline } : prev));
      toast.error(message);
    } finally {
      setValidatingOnlineRecord(false);
    }
  };

  const saveRecordResult = async () => {
    if (!selectedRecord || !resultForm) return;
    if (selectedRecord.result_status && !window.confirm("Este registro ja possui resultado. Deseja editar o resultado mesmo assim?")) return;
    const status = resultForm.result_status.toUpperCase();
    if (!["GREEN", "RED", "PUSH", "VOID"].includes(status)) {
      toast.error("Selecione Green, Red, Push ou Void.");
      return;
    }
    const odd = parseNumber(resultForm.final_odd) ?? selectedRecord.offered_odd ?? 1;
    const stake = parseNumber(resultForm.stake_units) ?? (selectedRecord.decision === "PULAR" ? 1 : 0);
    const unitValue = parseNumber(resultForm.unit_value_brl) ?? cfg?.valor_unidade_padrao ?? 0;
    if (selectedRecord.decision === "CONFIRMAR" && stake <= 0) {
      toast.error("Informe a stake em unidades para uma entrada CONFIRMADA.");
      return;
    }
    const profitUnits = calculateValidatorProfitUnits(status, stake, odd);
    const profitBrl = round(profitUnits * unitValue, 2);
    const isSimulated = selectedRecord.decision === "PULAR";
    const bankrollApplied = selectedRecord.decision === "CONFIRMAR" && !isSimulated;
    try {
      const payload = {
        result_status: status,
        result_settled_at: resultForm.result_settled_at || new Date().toISOString().slice(0, 10),
        final_score: resultForm.final_score || null,
        result_notes: resultForm.result_notes || null,
        stake_units: selectedRecord.decision === "PULAR" ? 1 : stake,
        unit_value_brl: unitValue,
        profit_units: profitUnits,
        profit_brl: profitBrl,
        clv: parseNumber(resultForm.clv),
        is_simulated_result: isSimulated,
        bankroll_applied: bankrollApplied,
        updated_at: new Date().toISOString(),
      };
      const { error } = await validatorDb.from("asp_validator_registros").update(payload).eq("id", selectedRecord.id);
      if (error) throw error;
      setSelectedRecord((prev) => (prev ? { ...prev, ...payload } : prev));
      setResultForm((prev) => (prev ? { ...prev, stake_units: String(payload.stake_units), unit_value_brl: String(unitValue) } : prev));
      toast.success(bankrollApplied ? "Resultado registrado e incluído na banca oficial." : "Resultado simulado registrado sem impacto na banca.");
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel registrar o resultado.");
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          ASP Validator
        </h1>
        <p className="text-sm text-muted-foreground">
          Valide prognosticos externos ou manuais. A previsao original e apenas ponto de partida; a decisao final e CONFIRMAR ou PULAR.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="h-4 w-4" />
              Prognostico manual
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Esporte" value={form.sport} options={SPORTS} onChange={(value) => update("sport", value)} />
              <SelectField label="Plataforma de origem" value={form.source_platform} options={PLATFORMS} onChange={(value) => update("source_platform", value)} />
              <TextField label="Liga" value={form.league} onChange={(value) => update("league", value)} placeholder="Ex.: MLB, WNBA, Premier League" />
              <TextField label="Data do jogo" type="date" value={form.match_date} onChange={(value) => update("match_date", value)} />
              <TextField label="Mandante" value={form.home_team} onChange={(value) => update("home_team", value)} />
              <TextField label="Visitante" value={form.away_team} onChange={(value) => update("away_team", value)} />
              <SelectField label="Mercado" value={form.market} options={MARKETS} onChange={(value) => update("market", value)} placeholder="Selecione" />
              <TextField label="Pick" value={form.pick} onChange={(value) => update("pick", value)} placeholder="Ex.: Over 2.5, Time +1.5" />
              <TextField label="Linha" value={form.line} onChange={(value) => update("line", value)} placeholder="Opcional" />
              <TextField label="Odd" value={form.offered_odd} onChange={(value) => update("offered_odd", value)} placeholder="Ex.: 1.85" />
              <TextField label="Probabilidade original (%)" value={form.source_probability} onChange={(value) => update("source_probability", value)} placeholder="Opcional" />
              <TextField label="EV original (%)" value={form.source_ev} onChange={(value) => update("source_ev", value)} placeholder="Opcional" />
            </div>

            <div className="rounded-md border border-border bg-muted/15 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Modelo Validator</div>
              <div className="mt-1 font-semibold">{validatorModel}</div>
            </div>

            <div className="space-y-2">
              <Label>Contexto geral do usuario</Label>
              <Textarea
                value={form.user_context}
                onChange={(event) => update("user_context", event.target.value)}
                placeholder="Cole observacoes, leitura do jogo, dados tecnicos, resumo de print ou contexto da fonte externa."
                className="min-h-32"
              />
            </div>

            <UploadsWithComments uploads={uploads} onAddFiles={addUploads} onUpdate={updateUpload} onRemove={removeUpload} />

            <Button onClick={validate} disabled={!canValidate || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
              Validar com IA
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultado da validacao</CardTitle>
            </CardHeader>
            <CardContent>{result ? <ResultPanel result={result} /> : <EmptyResult />}</CardContent>
          </Card>
          <FuturePhases />
        </div>
      </div>

      <AspValidatorDashboard records={records} filters={dashboardFilters} onChangeFilters={setDashboardFilters} />

      <HistorySection
        records={records}
        uploadsByRecord={uploadsByRecord}
        loading={loadingHistory}
        onRefresh={loadHistory}
        onOpen={openRecord}
        onDelete={deleteRecord}
      />

      <RecordDetailDialog
        record={selectedRecord}
        uploads={selectedRecord ? uploadsByRecord[selectedRecord.id] ?? [] : []}
        editingRecord={editingRecord}
        resultForm={resultForm}
        uploadComments={editingUploadComments}
        saving={updatingRecord}
        onOpenChange={(open) => {
          if (!open) setSelectedRecord(null);
        }}
        onUpdateRecord={updateEdit}
        ocrAppliedFields={ocrAppliedFields}
        onApplyOcrToForm={applyOcrDataToEditingRecord}
        onUpdateResult={updateResultForm}
        onUpdateUploadComment={(uploadId, value) => setEditingUploadComments((prev) => ({ ...prev, [uploadId]: value }))}
        ocrFilesByUpload={ocrFilesByUpload}
        processingOcr={processingOcr}
        structuringRecord={structuringRecord}
        simulatingRecord={simulatingRecord}
        validatingAiRecord={validatingAiRecord}
        validatingOnlineRecord={validatingOnlineRecord}
        onAttachOcrFile={attachOcrFile}
        onProcessUploadOcr={processUploadOcr}
        onProcessAllAvailableOcr={processAllAvailableOcr}
        onStructureOcr={structureSelectedRecordOcr}
        onRunSimulation={runSelectedRecordSimulation}
        onValidateAi={validateSelectedRecordWithAi}
        onValidateOnlineAi={validateSelectedRecordWithOnlineAi}
        onSaveResult={saveRecordResult}
        onSave={saveRecordEdit}
        onDelete={selectedRecord ? () => deleteRecord(selectedRecord) : undefined}
      />
    </div>
  );
}

function AspValidatorDashboard({
  records,
  filters,
  onChangeFilters,
}: {
  records: ValidatorRecord[];
  filters: ValidatorDashboardFilters;
  onChangeFilters: (filters: ValidatorDashboardFilters) => void;
}) {
  const options = useMemo(() => buildDashboardOptions(records), [records]);
  const filtered = useMemo(() => filterDashboardRecords(records, filters), [records, filters]);
  const stats = useMemo(() => calculateValidatorDashboardStats(filtered), [filtered]);
  const byModel = useMemo(() => groupValidatorRecords(filtered, (record) => record.validator_model || "ASP Validator"), [filtered]);
  const byMarket = useMemo(() => groupValidatorRecords(filtered, (record) => record.market || "-"), [filtered]);
  const byPlatform = useMemo(() => groupValidatorRecords(filtered, (record) => record.source_platform || "-"), [filtered]);
  const byLeague = useMemo(() => groupValidatorRecords(filtered, (record) => record.league || "-"), [filtered]);
  const byDecision = useMemo(() => groupValidatorRecords(filtered, (record) => record.decision || "-"), [filtered]);

  const setFilter = (field: keyof ValidatorDashboardFilters, value: string) => {
    onChangeFilters({ ...filters, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Dashboard ASP Validator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <SelectField label="Periodo" value={filters.period} options={["all", "7d", "30d", "month", "year"]} onChange={(value) => setFilter("period", value)} />
          <SelectField label="Esporte" value={filters.sport} options={["all", ...options.sports]} onChange={(value) => setFilter("sport", value)} />
          <SelectField label="Liga" value={filters.league} options={["all", ...options.leagues]} onChange={(value) => setFilter("league", value)} />
          <SelectField label="Plataforma" value={filters.source_platform} options={["all", ...options.platforms]} onChange={(value) => setFilter("source_platform", value)} />
          <SelectField label="Modelo Validator" value={filters.validator_model} options={["all", ...options.models]} onChange={(value) => setFilter("validator_model", value)} />
          <SelectField label="Mercado" value={filters.market} options={["all", ...options.markets]} onChange={(value) => setFilter("market", value)} />
          <SelectField label="Decisao" value={filters.decision} options={["all", "CONFIRMAR", "PULAR"]} onChange={(value) => setFilter("decision", value)} />
          <SelectField label="Resultado" value={filters.result} options={["all", "GREEN", "RED", "PUSH", "VOID", "PENDENTE"]} onChange={(value) => setFilter("result", value)} />
        </div>

        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          <DashboardMetric label="Total validacoes" value={String(stats.total)} />
          <DashboardMetric label="Confirmadas" value={String(stats.confirmed)} />
          <DashboardMetric label="Puladas" value={String(stats.skipped)} />
          <DashboardMetric label="Greens confirmados" value={String(stats.confirmedGreen)} tone="good" />
          <DashboardMetric label="Reds confirmados" value={String(stats.confirmedRed)} tone="bad" />
          <DashboardMetric label="Win rate confirmado" value={`${stats.confirmedWinRate.toFixed(1)}%`} />
          <DashboardMetric label="ROI confirmado" value={`${signed(stats.confirmedRoi)}%`} tone={stats.confirmedRoi >= 0 ? "good" : "bad"} />
          <DashboardMetric label="Yield confirmado" value={`${signed(stats.confirmedYield)}%`} tone={stats.confirmedYield >= 0 ? "good" : "bad"} />
          <DashboardMetric label="Lucro confirmado (u)" value={`${signed(stats.confirmedProfitUnits)}u`} tone={stats.confirmedProfitUnits >= 0 ? "good" : "bad"} />
          <DashboardMetric label="Lucro confirmado (R$)" value={`${stats.confirmedProfitBrl >= 0 ? "+" : "-"}R$ ${Math.abs(stats.confirmedProfitBrl).toFixed(2)}`} tone={stats.confirmedProfitBrl >= 0 ? "good" : "bad"} />
          <DashboardMetric label="PULAR que seriam Green" value={String(stats.skippedGreen)} tone="bad" />
          <DashboardMetric label="PULAR que seriam Red" value={String(stats.skippedRed)} tone="good" />
          <DashboardMetric label="Assertividade PULAR" value={`${stats.skipAccuracy.toFixed(1)}%`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <GroupTable title="Desempenho por modelo validator" rows={byModel} />
          <GroupTable title="Desempenho por mercado" rows={byMarket} />
          <GroupTable title="Desempenho por plataforma" rows={byPlatform} />
          <GroupTable title="Desempenho por liga" rows={byLeague} />
          <GroupTable title="Desempenho por decisao" rows={byDecision} />
        </div>
      </CardContent>
    </Card>
  );
}

function HistorySection({
  records,
  uploadsByRecord,
  loading,
  onRefresh,
  onOpen,
  onDelete,
}: {
  records: ValidatorRecord[];
  uploadsByRecord: Record<string, ValidatorUploadRecord[]>;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpen: (record: ValidatorRecord) => void;
  onDelete: (record: ValidatorRecord) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4" />
          Historico do ASP Validator
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {records.length ? (
          <div className="space-y-3">
            {records.map((record) => (
              <div key={record.id} className="rounded-md border border-border bg-background/50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{record.sport}</Badge>
                      {record.league ? <Badge variant="secondary">{record.league}</Badge> : null}
                      <Badge className={record.decision === "CONFIRMAR" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}>
                        {record.decision}
                      </Badge>
                      <Badge variant="outline">{record.confidence}</Badge>
                      <Badge variant="secondary">{record.validator_model}</Badge>
                    </div>
                    <div>
                      <div className="text-base font-semibold">
                        {record.home_team} x {record.away_team}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDate(record.match_date)} | {record.source_platform} | criado em {formatDateTime(record.created_at)}
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                      <span>Mercado: {record.market}</span>
                      <span>Pick: {record.pick}</span>
                      <span>Linha: {record.line || "-"}</span>
                      <span>Odd: {formatOdd(record.offered_odd)}</span>
                      <span>Prob. original: {formatPercent(record.source_probability)}</span>
                      <span>Uploads: {(uploadsByRecord[record.id] ?? []).length}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpen(record)} className="gap-2">
                      <Eye className="h-4 w-4" />
                      Detalhe
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => onDelete(record)} disabled={Boolean(record.result_status)} className="gap-2">
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {loading ? "Carregando historico..." : "Nenhum registro salvo no ASP Validator ainda."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecordDetailDialog({
  record,
  uploads,
  editingRecord,
  resultForm,
  uploadComments,
  saving,
  ocrFilesByUpload,
  processingOcr,
  structuringRecord,
  simulatingRecord,
  validatingAiRecord,
  validatingOnlineRecord,
  onOpenChange,
  onUpdateRecord,
  onUpdateResult,
  onUpdateUploadComment,
  ocrAppliedFields,
  onApplyOcrToForm,
  onAttachOcrFile,
  onProcessUploadOcr,
  onProcessAllAvailableOcr,
  onStructureOcr,
  onRunSimulation,
  onValidateAi,
  onValidateOnlineAi,
  onSaveResult,
  onSave,
  onDelete,
}: {
  record: ValidatorRecord | null;
  uploads: ValidatorUploadRecord[];
  editingRecord: EditableRecord | null;
  resultForm: ResultForm | null;
  uploadComments: Record<string, string>;
  saving: boolean;
  ocrFilesByUpload: Record<string, File>;
  processingOcr: Record<string, boolean>;
  structuringRecord: boolean;
  simulatingRecord: boolean;
  validatingAiRecord: boolean;
  validatingOnlineRecord: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateRecord: (field: keyof EditableRecord, value: string) => void;
  onUpdateResult: (field: keyof ResultForm, value: string) => void;
  onUpdateUploadComment: (uploadId: string, value: string) => void;
  ocrAppliedFields: Partial<Record<keyof EditableRecord, boolean>>;
  onApplyOcrToForm: () => void;
  onAttachOcrFile: (uploadId: string, file: File | null) => void;
  onProcessUploadOcr: (upload: ValidatorUploadRecord) => Promise<boolean>;
  onProcessAllAvailableOcr: () => Promise<void>;
  onStructureOcr: () => Promise<void>;
  onRunSimulation: () => Promise<void>;
  onValidateAi: () => Promise<void>;
  onValidateOnlineAi: () => Promise<void>;
  onSaveResult: () => Promise<void>;
  onSave: () => Promise<void>;
  onDelete?: () => void;
}) {
  const canEdit = Boolean(record && !record.result_status && editingRecord);
  return (
    <Dialog open={Boolean(record)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalhe do ASP Validator</DialogTitle>
        </DialogHeader>

        {record && editingRecord ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={record.decision === "CONFIRMAR" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}>
                {record.decision}
              </Badge>
              <Badge variant="outline">Confianca: {record.confidence}</Badge>
              <Badge variant="secondary">{record.validator_model}</Badge>
              {record.result_status ? <Badge variant="outline">Resultado: {record.result_status}</Badge> : <Badge variant="outline">Sem resultado registrado</Badge>}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onApplyOcrToForm} disabled={!canEdit} className="gap-2">
                <FileJson className="h-4 w-4" />
                Aplicar dados OCR ao formulario
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SelectField
                label="Esporte"
                value={editingRecord.sport}
                options={SPORTS}
                onChange={(value) => onUpdateRecord("sport", value)}
                disabled={!canEdit}
                hint={ocrAppliedFields.sport ? "preenchido via OCR" : undefined}
              />
              <SelectField
                label="Plataforma de origem"
                value={editingRecord.source_platform}
                options={PLATFORMS}
                onChange={(value) => onUpdateRecord("source_platform", value)}
                disabled={!canEdit}
                hint={ocrAppliedFields.source_platform ? "preenchido via OCR" : undefined}
              />
              <TextField label="Liga" value={editingRecord.league} onChange={(value) => onUpdateRecord("league", value)} disabled={!canEdit} hint={ocrAppliedFields.league ? "preenchido via OCR" : undefined} />
              <TextField label="Data do jogo" type="date" value={editingRecord.match_date} onChange={(value) => onUpdateRecord("match_date", value)} disabled={!canEdit} hint={ocrAppliedFields.match_date ? "preenchido via OCR" : undefined} />
              <TextField label="Mandante" value={editingRecord.home_team} onChange={(value) => onUpdateRecord("home_team", value)} disabled={!canEdit} hint={ocrAppliedFields.home_team ? "preenchido via OCR" : undefined} />
              <TextField label="Visitante" value={editingRecord.away_team} onChange={(value) => onUpdateRecord("away_team", value)} disabled={!canEdit} hint={ocrAppliedFields.away_team ? "preenchido via OCR" : undefined} />
              <SelectField label="Mercado" value={editingRecord.market} options={MARKETS} onChange={(value) => onUpdateRecord("market", value)} disabled={!canEdit} hint={ocrAppliedFields.market ? "preenchido via OCR" : undefined} />
              <TextField label="Pick" value={editingRecord.pick} onChange={(value) => onUpdateRecord("pick", value)} disabled={!canEdit} hint={ocrAppliedFields.pick ? "preenchido via OCR" : undefined} />
              <TextField label="Linha" value={editingRecord.line} onChange={(value) => onUpdateRecord("line", value)} disabled={!canEdit} hint={ocrAppliedFields.line ? "preenchido via OCR" : undefined} />
              <TextField label="Odd" value={editingRecord.offered_odd} onChange={(value) => onUpdateRecord("offered_odd", value)} disabled={!canEdit} hint={ocrAppliedFields.offered_odd ? "preenchido via OCR" : undefined} />
              <TextField
                label="Probabilidade original (%)"
                value={editingRecord.source_probability}
                onChange={(value) => onUpdateRecord("source_probability", value)}
                disabled={!canEdit}
                hint={ocrAppliedFields.source_probability ? "preenchido via OCR" : undefined}
              />
              <TextField label="Odd justa original" value={editingRecord.source_fair_odd} onChange={(value) => onUpdateRecord("source_fair_odd", value)} disabled={!canEdit} hint={ocrAppliedFields.source_fair_odd ? "preenchido via OCR" : undefined} />
              <TextField label="EV original (%)" value={editingRecord.source_ev} onChange={(value) => onUpdateRecord("source_ev", value)} disabled={!canEdit} hint={ocrAppliedFields.source_ev ? "preenchido via OCR" : undefined} />
            </div>

            <div className="space-y-2">
              <Label>Contexto do usuario</Label>
              <Textarea
                value={editingRecord.user_context}
                disabled={!canEdit}
                onChange={(event) => onUpdateRecord("user_context", event.target.value)}
                className="min-h-28"
              />
            </div>

            {!canEdit ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                Este registro ja possui resultado e nao pode ser editado ou excluido.
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <Info label="Esporte" value={record.sport} />
              <Info label="Origem" value={record.source_platform} />
              <Info label="Criado em" value={formatDateTime(record.created_at)} />
              <Info label="Odd justa original" value={formatOdd(record.source_fair_odd)} />
              <Info label="Prob. ajustada" value={formatPercent(record.adjusted_probability)} />
              <Info label="EV ajustado" value={formatPercent(record.adjusted_ev)} />
            </div>

            <UploadsDetail
              uploads={uploads}
              uploadComments={uploadComments}
              canEdit={canEdit}
              ocrFilesByUpload={ocrFilesByUpload}
              processingOcr={processingOcr}
              onUpdateUploadComment={onUpdateUploadComment}
              onAttachOcrFile={onAttachOcrFile}
              onProcessUploadOcr={onProcessUploadOcr}
            />

            <SignalBlock title="Blocos favoraveis" items={record.favorable_blocks ?? []} tone="good" />
            <SignalBlock title="Blocos contrarios" items={record.against_blocks ?? []} tone="bad" />
            <SignalBlock title="Alertas" items={record.alerts ?? []} tone="warn" />

            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Parecer final</p>
              <p className="text-sm leading-relaxed">{record.final_analysis}</p>
            </div>

            <PendingTechFields record={record} />

            <StructuredOcrPanel record={record} uploads={uploads} />

            <OcrDiagnosticsPanel record={record} uploads={uploads} />

            <SimulationPanel record={record} />

            <AiAnalysisContextPanel record={record} />

            <OnlineContextPanel record={record} />

            <ResultRegistrationPanel record={record} form={resultForm} onUpdate={onUpdateResult} onSave={onSaveResult} />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void onValidateAi()} disabled={validatingAiRecord} className="gap-2">
                {validatingAiRecord ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                Validar com IA
              </Button>
              <Button variant="outline" onClick={() => void onProcessAllAvailableOcr()} className="gap-2">
                <ImageUp className="h-4 w-4" />
                Processar todos os OCRs disponiveis
              </Button>
              <Button variant="outline" onClick={() => void onStructureOcr()} disabled={structuringRecord} className="gap-2">
                {structuringRecord ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
                {record.structured_status === "completed" ? "Reestruturar OCR" : "Estruturar OCR"}
              </Button>
              <Button variant="outline" onClick={() => void onRunSimulation()} disabled={simulatingRecord} className="gap-2">
                {simulatingRecord ? <Loader2 className="h-4 w-4 animate-spin" /> : <Microscope className="h-4 w-4" />}
                Executar simulacao
              </Button>
              <Button variant="outline" onClick={() => void onValidateOnlineAi()} disabled={validatingOnlineRecord} className="gap-2">
                {validatingOnlineRecord ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                Validar com IA + Pesquisa
              </Button>
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              <Button variant="destructive" onClick={onDelete} disabled={!canEdit} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Excluir registro
              </Button>
              <Button onClick={() => void onSave()} disabled={!canEdit || saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar alteracoes
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UploadsDetail({
  uploads,
  uploadComments,
  canEdit,
  ocrFilesByUpload,
  processingOcr,
  onUpdateUploadComment,
  onAttachOcrFile,
  onProcessUploadOcr,
}: {
  uploads: ValidatorUploadRecord[];
  uploadComments: Record<string, string>;
  canEdit: boolean;
  ocrFilesByUpload: Record<string, File>;
  processingOcr: Record<string, boolean>;
  onUpdateUploadComment: (uploadId: string, value: string) => void;
  onAttachOcrFile: (uploadId: string, file: File | null) => void;
  onProcessUploadOcr: (upload: ValidatorUploadRecord) => Promise<boolean>;
}) {
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const loadPreviewUrls = async () => {
      const imageUploads = uploads.filter((upload) => upload.file_path && (upload.mime_type || "").startsWith("image/"));
      const entries = await Promise.all(
        imageUploads.map(async (upload) => {
          try {
            const url = await createUploadSignedUrl(upload);
            return [upload.id, url] as const;
          } catch {
            return [upload.id, null] as const;
          }
        }),
      );
      if (!active) return;
      setPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))));
    };
    void loadPreviewUrls();
    return () => {
      active = false;
    };
  }, [uploads]);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div>
        <div className="text-sm font-semibold">Uploads vinculados</div>
        <p className="mt-1 text-xs text-muted-foreground">Arquivos armazenados no Supabase Storage e vinculados ao registro para auditoria e reprocessamento.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Storage: {uploads.filter((upload) => upload.file_path).length}/{uploads.length}</Badge>
          <Badge variant="outline">OCR completed: {uploads.filter((upload) => upload.ocr_status === "completed").length}</Badge>
          <Badge variant="outline">Falhas: {uploads.filter((upload) => upload.ocr_status === "failed").length}</Badge>
        </div>
      </div>
      {uploads.length ? (
        uploads.map((upload) => (
          <div key={upload.id} className="rounded-md border border-border bg-background/50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">#{upload.upload_order}</Badge>
              <Badge variant="secondary">{upload.upload_category}</Badge>
              <Badge variant={upload.ocr_status === "completed" ? "default" : upload.ocr_status === "failed" ? "destructive" : "outline"}>
                OCR: {upload.ocr_status}
              </Badge>
              <Badge variant={upload.structured_status === "completed" ? "default" : upload.structured_status === "failed" ? "destructive" : "outline"}>
                JSON: {upload.structured_status === "completed" && upload.ocr_status !== "completed" ? "completed (manual/comentario)" : upload.structured_status || "pending"}
              </Badge>
              <span className="text-sm font-semibold">{upload.file_name}</span>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(upload.file_size ?? 0)} | {upload.mime_type || "mime type desconhecido"} | origem {formatUploadSource(upload.upload_source)}
              </span>
              {upload.file_path ? <Badge variant="outline">Storage OK</Badge> : <Badge variant="destructive">Sem arquivo salvo</Badge>}
            </div>
            {previewUrls[upload.id] ? (
              <div className="mb-3 overflow-hidden rounded-md border border-border bg-muted/10">
                <img src={previewUrls[upload.id]} alt={upload.file_name} className="max-h-72 w-full object-contain" />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Comentario</Label>
              <Textarea
                value={uploadComments[upload.id] ?? ""}
                disabled={!canEdit}
                onChange={(event) => onUpdateUploadComment(upload.id, event.target.value)}
                className="min-h-20"
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label>Arquivo alternativo para reprocessar OCR</Label>
                <Input type="file" onChange={(event) => onAttachOcrFile(upload.id, event.target.files?.[0] ?? null)} />
                <p className="text-xs text-muted-foreground">
                  {ocrFilesByUpload[upload.id]
                    ? `Arquivo pronto para OCR: ${ocrFilesByUpload[upload.id].name}`
                    : upload.file_path
                      ? "OCR usara o arquivo salvo no Storage. Reenvie apenas se quiser substituir para este processamento."
                      : "Arquivo original nao encontrado. Reenvie o arquivo para processar."}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {upload.file_path ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void createUploadSignedUrl(upload).then((url) => url && window.open(url, "_blank"))}
                    className="gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Visualizar
                  </Button>
                ) : null}
                <Button onClick={() => void onProcessUploadOcr(upload)} disabled={processingOcr[upload.id]} className="gap-2">
                  {processingOcr[upload.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                  {upload.ocr_text ? "Reprocessar OCR" : "Processar OCR"}
                </Button>
              </div>
            </div>

            {upload.ocr_error ? (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{upload.ocr_error}</div>
            ) : null}
            {upload.ocr_text ? (
              <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Texto OCR extraido</p>
                <pre className="max-h-56 whitespace-pre-wrap text-xs text-muted-foreground">{upload.ocr_text}</pre>
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum upload vinculado a este registro.</div>
      )}
    </div>
  );
}

function PendingTechFields({ record }: { record: ValidatorRecord }) {
  const items = [
    { title: "OCR", value: record.ocr_raw_text ? "OCR processado e texto bruto salvo." : "Aguardando processamento OCR dos uploads." },
    {
      title: "Simulacao probabilistica",
      value: hasJsonContent(record.simulation_json) ? "Dados de simulacao registrados." : "Disponivel apos OCR estruturado ou dados manuais suficientes.",
    },
    {
      title: "IA + Pesquisa",
      value: hasJsonContent(record.online_context_json) ? "Contexto online registrado." : "Disponivel para validacao complementar quando necessario.",
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="rounded-md border border-dashed border-border bg-muted/10 p-3">
          <div className="text-sm font-semibold">{item.title}</div>
          <p className="mt-1 text-xs text-muted-foreground">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function StructuredOcrPanel({ record, uploads }: { record: ValidatorRecord; uploads: ValidatorUploadRecord[] }) {
  const structured = record.structured_json;
  const quality = extractDataQuality(structured);
  const uploadStructuredCount = uploads.filter((upload) => hasJsonContent(upload.structured_json)).length;
  const dbQualityScore = typeof record.ocr_data_quality_score === "number" ? record.ocr_data_quality_score : null;
  const dbFieldsCount = typeof record.ocr_structured_fields_count === "number" ? record.ocr_structured_fields_count : null;
  const dbStructuredData = record.ocr_structured_data;
  const hasDbStructured = hasJsonContent(dbStructuredData);
  const qualityTone = dbQualityScore === null
    ? "text-muted-foreground"
    : dbQualityScore >= 0.75
      ? "text-emerald-400"
      : dbQualityScore >= 0.5
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">OCR estruturado</div>
          <p className="mt-1 text-xs text-muted-foreground">
            JSON preparado para as proximas fases de simulacao probabilistica, IA Local e IA + Pesquisa.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={record.structured_status === "completed" ? "default" : record.structured_status === "failed" ? "destructive" : "outline"}>
            Estrutura: {record.structured_status || "pending"}
          </Badge>
          <Badge variant="outline">Uploads estruturados: {uploadStructuredCount}/{uploads.length}</Badge>
          {dbQualityScore !== null ? (
            <Badge variant="outline" className={qualityTone}>
              Qualidade OCR: {(dbQualityScore * 100).toFixed(0)}%
            </Badge>
          ) : null}
          {dbFieldsCount !== null ? (
            <Badge variant="outline">Campos estruturados: {dbFieldsCount}</Badge>
          ) : null}
        </div>
      </div>

      {record.structured_error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{record.structured_error}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Info
          label="Qualidade OCR (score)"
          value={dbQualityScore === null ? (quality ? String(quality.ocr_quality ?? "-") : "-") : `${(dbQualityScore * 100).toFixed(0)}%`}
        />
        <Info
          label="Campos faltantes"
          value={Array.isArray(quality?.missing_fields) ? String(quality?.missing_fields.length) : "0"}
        />
        <Info
          label="Revisao manual"
          value={quality?.needs_manual_review ? "Sim" : "Nao"}
        />
      </div>

      {quality?.missing_fields && Array.isArray(quality.missing_fields) && quality.missing_fields.length ? (
        <SignalBlock title="Campos faltantes" items={quality.missing_fields.map(String)} tone="warn" />
      ) : null}
      {hasJsonContent((structured as { field_sources?: Record<string, string> } | null)?.field_sources ?? null) ? (
        <SignalBlock
          title="Origem dos dados estruturados"
          items={Object.entries(((structured as { field_sources?: Record<string, string> } | null)?.field_sources ?? {})).map(([key, value]) => `${key}: ${value}`)}
          tone="good"
        />
      ) : null}
      {quality?.conflicts && Array.isArray(quality.conflicts) && quality.conflicts.length ? (
        <SignalBlock title="Conflitos detectados" items={quality.conflicts.map(String)} tone="bad" />
      ) : null}

      {hasDbStructured ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-emerald-300">Dados estruturados (OCR inteligente)</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(dbStructuredData, null, 2)}</pre>
        </div>
      ) : null}

      {hasJsonContent(structured) ? <ExtractedImageDataPanel structured={structured as StructuredValidatorJson} /> : null}

      {hasJsonContent(structured) ? (
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">JSON estruturado</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(structured, null, 2)}</pre>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nenhum JSON estruturado ainda. Use o botao Estruturar OCR apos processar ou reenviar arquivos.
        </div>
      )}
    </div>
  );
}

function ExtractedImageDataPanel({ structured }: { structured: StructuredValidatorJson }) {
  const market = structured.market ?? structured.prediction;
  const corners = structured.corners;
  const preMatchAverage = structured.pre_match_odds?.length ? average(structured.pre_match_odds.map((item) => item.odd)) : null;
  return (
    <details className="rounded-md border border-border bg-background/50 p-3" open>
      <summary className="cursor-pointer text-sm font-semibold">Dados extraidos por recorte</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Info label="Mercado identificado" value={market?.name || structured.prediction?.market || "-"} />
        <Info label="Pick" value={market?.pick || structured.prediction?.pick || "-"} />
        <Info label="Odd" value={formatOdd(Number(market?.offered_odd ?? structured.prediction?.offered_odd ?? 0) || null)} />
        <Info label="Probabilidade" value={formatPercent(Number(market?.probability_original ?? structured.prediction?.source_probability ?? 0) || null)} />
        <Info label="Odd justa" value={formatOdd(Number(market?.fair_odd_original ?? structured.prediction?.source_fair_odd ?? 0) || null)} />
        <Info label="EV" value={formatPercent(Number(market?.ev_original ?? structured.prediction?.source_ev ?? 0) || null)} />
        <Info label="Horario OCR" value={structured.match?.time || "-"} />
        <Info label="Qualidade" value={`${Math.round((structured.data_quality_score ?? 0) * 100)}%`} />
        <Info label="Campos extraidos" value={String(structured.structured_fields_count ?? 0)} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Geral - {structured.match?.home_team || "Mandante"}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <Info label="Corners marcados" value={formatNumber(corners?.home?.avg_for)} />
            <Info label="Corners sofridos" value={formatNumber(corners?.home?.avg_against)} />
            <Info label="Total medio" value={formatNumber(corners?.home?.avg_total)} />
            <Info label="Total cantos" value={formatNumber(corners?.home?.total_corners)} />
            <Info label="Marcados total" value={formatNumber(corners?.home?.total_for)} />
            <Info label="Sofridos total" value={formatNumber(corners?.home?.total_against)} />
          </div>
          <LinePercentBadges title="Mais escanteios" values={corners?.home?.over_lines ?? {}} prefix="+" />
          <LinePercentBadges title="Menos escanteios" values={corners?.home?.under_lines ?? {}} prefix="-" />
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Geral - {structured.match?.away_team || "Visitante"}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <Info label="Corners marcados" value={formatNumber(corners?.away?.avg_for)} />
            <Info label="Corners sofridos" value={formatNumber(corners?.away?.avg_against)} />
            <Info label="Total medio" value={formatNumber(corners?.away?.avg_total)} />
            <Info label="Total cantos" value={formatNumber(corners?.away?.total_corners)} />
            <Info label="Marcados total" value={formatNumber(corners?.away?.total_for)} />
            <Info label="Sofridos total" value={formatNumber(corners?.away?.total_against)} />
          </div>
          <LinePercentBadges title="Mais escanteios" values={corners?.away?.over_lines ?? {}} prefix="+" />
          <LinePercentBadges title="Menos escanteios" values={corners?.away?.under_lines ?? {}} prefix="-" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Casa/Fora - {structured.match?.home_team || "Mandante"}</div>
          <div className="grid gap-2 md:grid-cols-3">
            <Info label="Marcados" value={formatNumber(corners?.home?.home_away_avg_for)} />
            <Info label="Sofridos" value={formatNumber(corners?.home?.home_away_avg_against)} />
            <Info label="Total medio" value={formatNumber(corners?.home?.home_away_avg_total)} />
          </div>
          <LinePercentBadges title="Mais casa/fora" values={corners?.home?.home_away_over_lines ?? {}} prefix="+" />
          <LinePercentBadges title="Menos casa/fora" values={corners?.home?.home_away_under_lines ?? {}} prefix="-" />
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Casa/Fora - {structured.match?.away_team || "Visitante"}</div>
          <div className="grid gap-2 md:grid-cols-3">
            <Info label="Marcados" value={formatNumber(corners?.away?.home_away_avg_for)} />
            <Info label="Sofridos" value={formatNumber(corners?.away?.home_away_avg_against)} />
            <Info label="Total medio" value={formatNumber(corners?.away?.home_away_avg_total)} />
          </div>
          <LinePercentBadges title="Mais casa/fora" values={corners?.away?.home_away_over_lines ?? {}} prefix="+" />
          <LinePercentBadges title="Menos casa/fora" values={corners?.away?.home_away_under_lines ?? {}} prefix="-" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Race/primeiro - {structured.match?.home_team || "Mandante"}</div>
          <div className="grid gap-2 md:grid-cols-3">
            <Info label="Primeiro escanteio" value={formatPercent(corners?.home?.first_corner_pct ?? null)} />
            <Info label="Race 3" value={formatPercent(corners?.home?.race_to_3_pct ?? null)} />
            <Info label="Race 5" value={formatPercent(corners?.home?.race_to_5_pct ?? null)} />
            <Info label="Race 7" value={formatPercent(corners?.home?.race_to_7_pct ?? null)} />
            <Info label="Race 9" value={formatPercent(corners?.home?.race_to_9_pct ?? null)} />
            <Info label="Mais escanteios 1x2" value={formatPercent(corners?.home?.most_corners_1x2_pct ?? null)} />
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Race/primeiro - {structured.match?.away_team || "Visitante"}</div>
          <div className="grid gap-2 md:grid-cols-3">
            <Info label="Primeiro escanteio" value={formatPercent(corners?.away?.first_corner_pct ?? null)} />
            <Info label="Race 3" value={formatPercent(corners?.away?.race_to_3_pct ?? null)} />
            <Info label="Race 5" value={formatPercent(corners?.away?.race_to_5_pct ?? null)} />
            <Info label="Race 7" value={formatPercent(corners?.away?.race_to_7_pct ?? null)} />
            <Info label="Race 9" value={formatPercent(corners?.away?.race_to_9_pct ?? null)} />
            <Info label="Mais escanteios 1x2" value={formatPercent(corners?.away?.most_corners_1x2_pct ?? null)} />
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Odds pre-jogo</div>
          <div className="grid gap-2 md:grid-cols-2">
            {(structured.pre_match_odds ?? []).map((item) => (
              <Info key={item.bookmaker} label={item.bookmaker} value={formatOdd(item.odd)} />
            ))}
            <Info label="Media" value={formatOdd(preMatchAverage)} />
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recomendacao PackBall</div>
          <div className="grid gap-2 md:grid-cols-2">
            <Info label="Mercado" value={structured.packball_recommendation?.market || "-"} />
            <Info label="Pick" value={structured.packball_recommendation?.pick || "-"} />
            <Info label="Odd ofertada" value={formatOdd(structured.packball_recommendation?.offered_odd ?? null)} />
            <Info label="Chance" value={formatPercent(structured.packball_recommendation?.probability_original ?? null)} />
            <Info label="Odd justa" value={formatOdd(structured.packball_recommendation?.fair_odd_original ?? null)} />
            <Info label="EV" value={formatPercent(structured.packball_recommendation?.ev_original ?? null)} />
          </div>
        </div>
      </div>
      {structured.missing_critical_fields?.length ? <SignalBlock title="Campos criticos ausentes" items={structured.missing_critical_fields} tone="warn" /> : null}
    </details>
  );
}

function LinePercentBadges({ title, values, prefix }: { title: string; values: Record<string, number>; prefix: string }) {
  const entries = Object.entries(values).sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/10 p-2">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-2">
        {entries.map(([line, pct]) => (
          <Badge key={`${prefix}${line}`} variant="outline">
            {prefix}{line}: {formatPercent(pct)}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function OcrDiagnosticsPanel({ record, uploads }: { record: ValidatorRecord; uploads: ValidatorUploadRecord[] }) {
  const structured = record.ocr_structured_data ?? record.structured_json;
  const quality = extractDataQuality(structured);
  const missing = Array.isArray(quality?.missing_fields)
    ? quality.missing_fields.map(String)
    : Array.isArray((structured as { missing_critical_fields?: unknown[] } | null)?.missing_critical_fields)
      ? ((structured as { missing_critical_fields?: unknown[] }).missing_critical_fields ?? []).map(String)
      : [];
  const fieldsCount = record.ocr_structured_fields_count ?? countStructuredFields(structured);
  const sources = ((structured as { field_sources?: Record<string, string> } | null)?.field_sources ?? {}) as Record<string, string>;
  const score = record.ocr_data_quality_score ?? (typeof (structured as { data_quality_score?: unknown } | null)?.data_quality_score === "number"
    ? ((structured as { data_quality_score?: number }).data_quality_score ?? 0)
    : null);
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Diagnostico OCR</div>
          <p className="mt-1 text-xs text-muted-foreground">Rastreio do arquivo processado, texto bruto, extracao inteligente e simulacao.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={record.ocr_raw_text ? "default" : "outline"}>OCR: {record.ocr_raw_text ? "completed" : "pending"}</Badge>
          <Badge variant={record.structured_status === "completed" ? "default" : record.structured_status === "failed" ? "destructive" : "outline"}>
            JSON: {record.structured_status || "pending"}
          </Badge>
          <Badge variant="outline">Simulacao: {record.simulation_type || (hasJsonContent(record.simulation_json) ? "completed" : "pending")}</Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Info label="Arquivos" value={`${uploads.length}`} />
        <Info label="Campos extraidos" value={String(fieldsCount || 0)} />
        <Info label="Qualidade extracao" value={score === null ? "-" : `${(score * 100).toFixed(0)}%`} />
        <Info label="Usou OCR real" value={sources.raw_ocr ? "Sim" : "Nao"} />
        <Info label="Usou comentarios" value={sources.upload_comment ? "Sim" : "Nao"} />
        <Info label="Usou dados manuais" value={sources.manual_form ? "Sim" : "Nao"} />
      </div>

      {uploads.length ? (
        <div className="grid gap-2">
          {uploads.map((upload) => (
            <div key={upload.id} className="rounded-md border border-border bg-background/40 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">#{upload.upload_order}</Badge>
                <Badge variant={upload.ocr_status === "completed" ? "default" : upload.ocr_status === "failed" ? "destructive" : "outline"}>
                  OCR: {upload.ocr_status}
                </Badge>
                <Badge variant={upload.structured_status === "completed" ? "default" : upload.structured_status === "failed" ? "destructive" : "outline"}>
                  JSON: {upload.structured_status === "completed" && upload.ocr_status !== "completed" ? "completed (manual/comentario)" : upload.structured_status || "pending"}
                </Badge>
                <span className="font-semibold">{upload.file_name}</span>
                <span className="text-muted-foreground">{formatFileSize(upload.file_size ?? 0)}</span>
                <span className="text-muted-foreground">origem {formatUploadSource(upload.upload_source)}</span>
              </div>
              {upload.ocr_error ? <div className="mt-2 text-red-300">{upload.ocr_error}</div> : null}
              {upload.ocr_text ? (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/20 p-2 text-muted-foreground">
                  {upload.ocr_text}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {missing.length ? <SignalBlock title="Campos criticos ausentes" items={missing} tone="warn" /> : null}

      {hasJsonContent(structured) ? (
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Campos extraidos / JSON OCR</p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(structured, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function SimulationPanel({ record }: { record: ValidatorRecord }) {
  const simulation = parseSimulationResult(record.simulation_json);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Simulacao probabilistica</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Sinal tecnico por matriz de placares Poisson. A simulacao nao confirma nem pula prognostico sozinha.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {record.simulation_type ? <Badge variant="secondary">Tipo: {record.simulation_type}</Badge> : null}
          <Badge variant={simulation?.status === "completed" ? "default" : simulation?.status === "failed" ? "destructive" : "outline"}>
            {simulation?.status ?? "pending"}
          </Badge>
        </div>
      </div>



      {simulation ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Info label="Lambda mandante" value={simulation.lambda_home === null ? "-" : String(simulation.lambda_home)} />
            <Info label="Lambda visitante" value={simulation.lambda_away === null ? "-" : String(simulation.lambda_away)} />
            <Info label="Prob. simulada" value={formatDecimalProbability(simulation.market_probability)} />
            <Info label="Odd justa simulada" value={formatOdd(simulation.fair_odd)} />
            <Info label="EV simulado" value={formatDecimalEv(simulation.ev)} />
            <Info label="Modelo" value={simulation.model} />
            <Info label="Tipo" value={record.simulation_type || (simulation.notes.some((note) => normalize(note).includes("simplificada")) ? "simplificada OCR" : "padrao")} />
          </div>

          {simulation.most_likely_scores.length ? (
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Placares mais provaveis</p>
              <div className="flex flex-wrap gap-2">
                {simulation.most_likely_scores.map((score) => (
                  <Badge key={score.score} variant="secondary">
                    {score.score} - {formatDecimalProbability(score.probability)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <SignalBlock title="Notas da simulacao" items={simulation.notes} tone="good" />
          <SignalBlock title="Alertas da simulacao" items={simulation.warnings} tone="warn" />

          <div className="rounded-md border border-border bg-background/50 p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">JSON da simulacao</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(simulation, null, 2)}</pre>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nenhuma simulacao executada ainda. Use o botao Executar simulacao depois de estruturar o OCR ou preencher os dados manuais.
        </div>
      )}
    </div>
  );
}

function AiAnalysisContextPanel({ record }: { record: ValidatorRecord }) {
  const usedOcr = Boolean(record.ocr_raw_text?.trim());
  const usedStructured = hasJsonContent(record.structured_json);
  const usedSimulation = hasJsonContent(record.simulation_json);
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div>
        <div className="text-sm font-semibold">Dados usados na analise IA</div>
        <p className="mt-1 text-xs text-muted-foreground">
          A validacao IA consolidada usa campos manuais como prioridade e OCR/JSON/simulacao como apoio tecnico.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Info label="Usou OCR" value={usedOcr ? "Sim" : "Nao"} />
        <Info label="Usou JSON estruturado" value={usedStructured ? "Sim" : "Nao"} />
        <Info label="Usou simulacao" value={usedSimulation ? "Sim" : "Nao"} />
      </div>
      {record.analysis_context ? (
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Contexto da IA</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{record.analysis_context}</pre>
        </div>
      ) : null}
    </div>
  );
}

function OnlineContextPanel({ record }: { record: ValidatorRecord }) {
  const online = parseOnlineContext(record.online_context_json);
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">IA + Pesquisa</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Verificacao online complementar. Ausencia de achados nao altera a analise automaticamente.
          </p>
        </div>
        <Badge variant={online?.status === "completed" ? "default" : online?.status === "failed" ? "destructive" : "outline"}>
          {online?.status ?? "pending"}
        </Badge>
      </div>

      {online ? (
        <>
          <div className="rounded-md border border-border bg-background/50 p-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Resumo online</p>
            <p className="text-sm leading-relaxed">{online.online_summary}</p>
          </div>
          <SignalBlock title="Achados relevantes" items={online.relevant_findings} tone="good" />
          <SignalBlock title="Ausencia de achados" items={online.no_relevant_findings} tone="warn" />
          <SignalBlock title="Alertas contextuais" items={online.contextual_alerts} tone="bad" />
          {online.error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{online.error}</div> : null}
          {online.sources.length ? (
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Fontes consultadas</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {online.sources.map((source) => (
                  <div key={source.url} className="truncate">
                    {source.title}: {source.url}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-md border border-border bg-background/50 p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">JSON online</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(online, null, 2)}</pre>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          IA + Pesquisa ainda nao executada. Execute depois da simulacao para manter o fluxo tecnico correto.
        </div>
      )}
    </div>
  );
}

function ResultRegistrationPanel({
  record,
  form,
  onUpdate,
  onSave,
}: {
  record: ValidatorRecord;
  form: ResultForm | null;
  onUpdate: (field: keyof ResultForm, value: string) => void;
  onSave: () => Promise<void>;
}) {
  if (!form) return null;
  const status = form.result_status.toUpperCase();
  const odd = parseNumber(form.final_odd) ?? record.offered_odd ?? 1;
  const stake = parseNumber(form.stake_units) ?? (record.decision === "PULAR" ? 1 : 0);
  const unitValue = parseNumber(form.unit_value_brl) ?? 0;
  const profitUnits = calculateValidatorProfitUnits(status, record.decision === "PULAR" ? 1 : stake, odd);
  const profitBrl = round(profitUnits * unitValue, 2);
  const simulated = record.decision === "PULAR";
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Registrar Resultado</div>
          <p className="mt-1 text-xs text-muted-foreground">
            CONFIRMAR impacta banca oficial. PULAR fica como resultado simulado para avaliar a qualidade da recusa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={simulated ? "outline" : "default"}>{simulated ? "Simulado - nao afeta banca" : "Banca oficial"}</Badge>
          {record.bankroll_applied ? <Badge variant="default">Aplicado na banca</Badge> : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SelectField label="Status" value={form.result_status} options={["GREEN", "RED", "PUSH", "VOID"]} onChange={(value) => onUpdate("result_status", value)} />
        <TextField label="Odd final usada" value={form.final_odd} onChange={(value) => onUpdate("final_odd", value)} />
        <TextField
          label="Stake (u)"
          value={simulated ? "1" : form.stake_units}
          onChange={(value) => onUpdate("stake_units", value)}
          disabled={simulated}
        />
        <TextField label="Valor da unidade (R$)" value={form.unit_value_brl} onChange={(value) => onUpdate("unit_value_brl", value)} />
        <TextField label="CLV" value={form.clv} onChange={(value) => onUpdate("clv", value)} placeholder="Opcional" />
        <TextField label="Data de liquidacao" type="date" value={form.result_settled_at} onChange={(value) => onUpdate("result_settled_at", value)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Placar final / observacao curta" value={form.final_score} onChange={(value) => onUpdate("final_score", value)} />
        <div className="space-y-2">
          <Label>Observacao do resultado</Label>
          <Textarea value={form.result_notes} onChange={(event) => onUpdate("result_notes", event.target.value)} className="min-h-20" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Info label="Lucro (u)" value={`${profitUnits >= 0 ? "+" : ""}${profitUnits.toFixed(2)}u`} />
        <Info label="Lucro (R$)" value={`${profitBrl >= 0 ? "+" : "-"}R$ ${Math.abs(profitBrl).toFixed(2)}`} />
        <Info label="Modelo/Metodo" value={record.validator_model || "ASP Validator"} />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void onSave()} className="gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {record.result_status ? "Atualizar resultado" : "Registrar resultado"}
        </Button>
      </div>
    </div>
  );
}

type DashboardStats = {
  total: number;
  confirmed: number;
  skipped: number;
  confirmedGreen: number;
  confirmedRed: number;
  confirmedRoi: number;
  confirmedYield: number;
  confirmedProfitUnits: number;
  confirmedProfitBrl: number;
  confirmedWinRate: number;
  skippedGreen: number;
  skippedRed: number;
  skipAccuracy: number;
};

type GroupRow = {
  label: string;
  total: number;
  green: number;
  red: number;
  pushVoid: number;
  winRate: number;
  profitUnits: number;
  profitBrl: number;
  roi: number;
  averageOdd: number;
  averageProbability: number;
};

function DashboardMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/15 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/20 px-3 py-2 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-muted/10 text-muted-foreground">
            <tr>
              {["Grupo", "Total", "G", "R", "P/V", "WR", "Lucro u", "Lucro R$", "ROI", "Odd med.", "Prob. med."].map((header) => (
                <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <td className="px-3 py-2 font-semibold">{row.label}</td>
                  <td className="px-3 py-2">{row.total}</td>
                  <td className="px-3 py-2 text-emerald-300">{row.green}</td>
                  <td className="px-3 py-2 text-red-300">{row.red}</td>
                  <td className="px-3 py-2">{row.pushVoid}</td>
                  <td className="px-3 py-2">{row.winRate.toFixed(1)}%</td>
                  <td className={`px-3 py-2 ${row.profitUnits >= 0 ? "text-emerald-300" : "text-red-300"}`}>{signed(row.profitUnits)}u</td>
                  <td className={`px-3 py-2 ${row.profitBrl >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {row.profitBrl >= 0 ? "+" : "-"}R$ {Math.abs(row.profitBrl).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{signed(row.roi)}%</td>
                  <td className="px-3 py-2">{row.averageOdd ? row.averageOdd.toFixed(2) : "-"}</td>
                  <td className="px-3 py-2">{row.averageProbability ? `${row.averageProbability.toFixed(1)}%` : "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">Nenhum dado para os filtros selecionados.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {hint ? <span className="text-[10px] uppercase tracking-wide text-emerald-300">{hint}</span> : null}
      </div>
      <Input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {hint ? <span className="text-[10px] uppercase tracking-wide text-emerald-300">{hint}</span> : null}
      </div>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ResultPanel({ result }: { result: ValidationResult }) {
  const isConfirm = result.decision === "CONFIRMAR";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={isConfirm ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}>
          {isConfirm ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
          {result.decision}
        </Badge>
        <Badge variant="outline">Confianca: {result.confidence}</Badge>
        <Badge variant="secondary">{result.validator_model}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Info label="Prob. original" value={formatPercent(result.source_probability)} />
        <Info label="Odd justa original" value={formatOdd(result.source_fair_odd)} />
        <Info label="Odd ofertada" value={formatOdd(result.offered_odd)} />
        <Info label="EV original" value={formatPercent(result.source_ev)} />
        <Info label="Prob. ajustada" value={formatPercent(result.adjusted_probability)} />
        <Info label="Odd justa ajustada" value={formatOdd(result.adjusted_fair_odd)} />
        <Info label="EV ajustado" value={formatPercent(result.adjusted_ev)} />
      </div>

      <SignalBlock title="Blocos favoraveis" items={result.favorable_blocks} tone="good" />
      <SignalBlock title="Blocos contrarios" items={result.against_blocks} tone="bad" />
      <SignalBlock title="Alertas" items={result.alerts} tone="warn" />

      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Resumo da simulacao</p>
        <p className="text-sm leading-relaxed">{result.simulation_summary || "Simulacao nao disponivel."}</p>
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Parecer final</p>
        <p className="text-sm leading-relaxed">{result.final_analysis}</p>
      </div>
    </div>
  );
}

function FuturePhases() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Proximas fases</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Placeholder icon={ClipboardCheck} title="OCR e JSON estruturado" text="OCR real ativo; estrutura inicial em JSON ja prepara as proximas fases." />
        <Placeholder icon={Microscope} title="Simulacao probabilistica" text="Estrutura reservada para simulacoes por mercado." />
        <Placeholder icon={Cloud} title="IA + Pesquisa" text="Pesquisa online/contexto externo ficara para proxima etapa." />
      </CardContent>
    </Card>
  );
}

function UploadsWithComments({
  uploads,
  onAddFiles,
  onUpdate,
  onRemove,
}: {
  uploads: ValidatorUploadDraft[];
  onAddFiles: (files: FileList | null, uploadSource?: ValidatorUploadDraft["upload_source"]) => void;
  onUpdate: (localId: string, patch: Partial<Pick<ValidatorUploadDraft, "upload_category" | "user_comment">>) => void;
  onRemove: (localId: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteFeedback, setPasteFeedback] = useState("");
  const pasteTimerRef = useRef<number | null>(null);

  const addFileArray = (files: File[], uploadSource: ValidatorUploadDraft["upload_source"]) => {
    if (!files.length) return;
    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));
    onAddFiles(dataTransfer.files, uploadSource);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    event.preventDefault();
    addFileArray(
      imageFiles.map((file, index) => {
        const extension = file.type.includes("png") ? "png" : file.type.includes("jpeg") || file.type.includes("jpg") ? "jpg" : "png";
        return new File([file], file.name || `screenshot-colado-${Date.now()}-${index + 1}.${extension}`, { type: file.type || "image/png" });
      }),
      "clipboard",
    );
    setPasteFeedback(`${imageFiles.length} imagem(ns) colada(s) e adicionada(s) aos uploads.`);
    if (pasteTimerRef.current) window.clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = window.setTimeout(() => setPasteFeedback(""), 3500);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onAddFiles(event.dataTransfer.files, "drag_drop");
  };

  return (
    <div
      className={`space-y-3 rounded-md border bg-muted/10 p-3 transition ${isDragging ? "border-primary bg-primary/10" : "border-border"}`}
      tabIndex={0}
      onPaste={handlePaste}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>Uploads com comentario</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique, arraste arquivos ou cole prints com CTRL+V. Imagens coladas entram no mesmo fluxo de OCR.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild className="gap-2">
          <label>
            <Plus className="h-4 w-4" />
            Adicionar arquivo
            <input type="file" multiple className="hidden" onChange={(event) => onAddFiles(event.target.files, "manual")} />
          </label>
        </Button>
      </div>
      {pasteFeedback ? <div className="rounded-md border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-200">{pasteFeedback}</div> : null}
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        Area ativa para drag and drop e CTRL+V. Use screenshots do Windows Snipping Tool ou imagens copiadas da area de transferencia.
      </div>

      {uploads.length ? (
        <div className="space-y-3">
          {uploads.map((upload) => (
            <div key={upload.local_id} className="rounded-md border border-border bg-background/50 p-3">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{upload.file.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatFileSize(upload.file.size)} | {upload.file.type || "mime type desconhecido"} | origem {formatUploadSource(upload.upload_source)} | ordem {upload.upload_order}
                  </div>
                </div>
                <Button variant="destructive" size="sm" onClick={() => onRemove(upload.local_id)} className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
                <SelectField
                  label="Tipo do material"
                  value={upload.upload_category}
                  options={UPLOAD_CATEGORIES}
                  onChange={(value) => onUpdate(upload.local_id, { upload_category: value })}
                />
                <div className="space-y-2">
                  <Label>Comentario do arquivo</Label>
                  <Textarea
                    value={upload.user_comment}
                    onChange={(event) => onUpdate(upload.local_id, { user_comment: event.target.value })}
                    placeholder="Descreva por que este arquivo importa para a validacao."
                    className="min-h-20"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nenhum arquivo adicionado. Use o botao Adicionar arquivo para anexar materiais de apoio.
        </div>
      )}
    </div>
  );
}

function Placeholder({ icon: Icon, title, text }: { icon: typeof Search; title: string; text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/10 p-3">
      <Icon className="mb-2 h-4 w-4 text-muted-foreground" />
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      Preencha o formulario e clique em Validar com IA para gerar a decisao.
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function SignalBlock({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-amber-300";
  return (
    <div className="rounded-md border border-border p-3">
      <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</p>
      {items.length ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum ponto relevante identificado nesta fase.</p>
      )}
    </div>
  );
}

async function validateWithAiFallback(context: Record<string, unknown>): Promise<ValidationResult> {
  try {
    const result = await validateAspValidatorWithAi({ data: { context } });
    return aiResultToValidationResult(result, context);
  } catch {
    const fallbackForm = contextToForm(context);
    return {
      ...buildValidatorDecision(fallbackForm),
      decision: "PULAR",
      confidence: "Baixo",
      alerts: ["Falha ao interpretar resposta da IA", "Fallback seguro aplicado."],
      final_analysis: "Por protecao de banca, a validacao foi marcada como PULAR ate nova analise manual.",
      analysis_context: buildLocalAnalysisContext(context, false),
    };
  }
}

function aiResultToValidationResult(result: AspValidatorAiResult, context: Record<string, unknown>): ValidationResult {
  return {
    decision: result.decision,
    confidence: result.confidence,
    validator_model: String(context.validator_model || "ASP Market Validator"),
    source_probability: result.source_probability,
    source_fair_odd: result.source_fair_odd,
    offered_odd: result.offered_odd,
    source_ev: result.source_ev,
    adjusted_probability: result.adjusted_probability,
    adjusted_fair_odd: result.adjusted_fair_odd,
    adjusted_ev: result.adjusted_ev,
    simulation_summary: result.simulation_summary,
    favorable_blocks: result.favorable_blocks,
    against_blocks: result.against_blocks,
    alerts: result.alerts,
    final_analysis: result.final_analysis,
    analysis_context: result.analysis_context,
  };
}

function applyOnlineAiResult(record: ValidatorRecord, result: AspValidatorOnlineAiResult): ValidatorRecord {
  return {
    ...record,
    decision: result.decision,
    confidence: result.confidence,
    source_fair_odd: result.source_fair_odd,
    source_ev: result.source_ev,
    adjusted_probability: result.adjusted_probability,
    adjusted_fair_odd: result.adjusted_fair_odd,
    adjusted_ev: result.adjusted_ev,
    online_context_json: result.online_context_json,
    favorable_blocks: result.favorable_blocks,
    against_blocks: result.against_blocks,
    alerts: result.alerts,
    final_analysis: result.final_analysis,
    analysis_context: result.analysis_context,
  };
}

function buildFailedOnlineContext(previous: Record<string, unknown> | null, error: string): Record<string, unknown> {
  const existing = parseOnlineContext(previous);
  return {
    status: "failed",
    online_summary: existing?.online_summary || "IA + Pesquisa falhou antes de concluir a verificacao online.",
    relevant_findings: existing?.relevant_findings ?? [],
    no_relevant_findings: existing?.no_relevant_findings ?? [],
    contextual_alerts: [...(existing?.contextual_alerts ?? []), "Falha na IA + Pesquisa. Analise anterior foi preservada."],
    sources: existing?.sources ?? [],
    searches: existing?.searches ?? [],
    error,
  };
}

function buildFormValidationContext(form: ValidatorForm, uploads: ValidatorUploadDraft[], validatorModel: string): Record<string, unknown> {
  const sourceProbability = normalizeProbability(parseNumber(form.source_probability));
  const offeredOdd = parseNumber(form.offered_odd);
  const sourceEv = parseNumber(form.source_ev);
  return {
    source_platform: form.source_platform,
    sport: form.sport,
    validator_model: validatorModel,
    fixture: {
      league: form.league,
      date: form.match_date,
      home_team: form.home_team,
      away_team: form.away_team,
    },
    prediction: {
      market: form.market,
      pick: form.pick,
      line: form.line || null,
      offered_odd: offeredOdd,
      source_probability: sourceProbability,
      source_ev: sourceEv,
      source_fair_odd: sourceProbability ? round(100 / sourceProbability, 2) : null,
    },
    user_context: form.user_context,
    upload_comments: uploads.map((upload) => ({
      file_name: upload.file.name,
      category: upload.upload_category,
      comment: upload.user_comment,
      order: upload.upload_order,
    })),
    ocr_raw_text: null,
    structured_json: null,
    simulation_json: null,
    data_usage: {
      used_ocr: false,
      used_structured_json: false,
      used_simulation: false,
      used_upload_comments: uploads.some((upload) => upload.user_comment.trim()),
    },
  };
}

function buildRecordValidationContext(record: ValidatorRecord, uploads: ValidatorUploadRecord[]): Record<string, unknown> {
  return {
    source_platform: record.source_platform,
    sport: record.sport,
    validator_model: record.validator_model,
    fixture: {
      league: record.league,
      date: record.match_date,
      home_team: record.home_team,
      away_team: record.away_team,
    },
    prediction: {
      market: record.market,
      pick: record.pick,
      line: record.line,
      offered_odd: record.offered_odd,
      source_probability: record.source_probability,
      source_ev: record.source_ev,
      source_fair_odd: record.source_fair_odd,
    },
    user_context: record.user_context,
    upload_comments: uploads.map((upload) => ({
      upload_id: upload.id,
      file_name: upload.file_name,
      category: upload.upload_category,
      comment: upload.user_comment,
      ocr_status: upload.ocr_status,
      structured_status: upload.structured_status,
    })),
    ocr_raw_text: record.ocr_raw_text,
    ocr_structured_data: record.ocr_structured_data,
    ocr_data_quality_score: record.ocr_data_quality_score,
    ocr_structured_fields_count: record.ocr_structured_fields_count,
    simulation_type: record.simulation_type,
    structured_json: record.structured_json,
    simulation_json: record.simulation_json,
    data_usage: {
      used_ocr: Boolean(record.ocr_raw_text?.trim()),
      used_structured_json: hasJsonContent(record.structured_json),
      used_simulation: hasJsonContent(record.simulation_json),
      used_upload_comments: uploads.some((upload) => upload.user_comment?.trim()),
      used_online_search: hasJsonContent(record.online_context_json),
      has_structured_ocr_data: Boolean((record.structured_json as { has_structured_ocr_data?: unknown } | null)?.has_structured_ocr_data) || Number(record.ocr_structured_fields_count ?? 0) > 0,
      structured_fields_count: record.ocr_structured_fields_count ?? countStructuredFields(record.structured_json),
    },
  };
}

function contextToForm(context: Record<string, unknown>): ValidatorForm {
  const fixture = context.fixture && typeof context.fixture === "object" ? (context.fixture as Record<string, unknown>) : {};
  const prediction = context.prediction && typeof context.prediction === "object" ? (context.prediction as Record<string, unknown>) : {};
  return {
    sport: String(context.sport || "Futebol"),
    source_platform: String(context.source_platform || "Manual"),
    league: String(fixture.league || ""),
    match_date: String(fixture.date || ""),
    home_team: String(fixture.home_team || ""),
    away_team: String(fixture.away_team || ""),
    market: String(prediction.market || ""),
    pick: String(prediction.pick || ""),
    line: prediction.line == null ? "" : String(prediction.line),
    offered_odd: prediction.offered_odd == null ? "" : String(prediction.offered_odd),
    source_probability: prediction.source_probability == null ? "" : String(prediction.source_probability),
    source_ev: prediction.source_ev == null ? "" : String(prediction.source_ev),
    user_context: String(context.user_context || ""),
  };
}

function buildLocalAnalysisContext(context: Record<string, unknown>, aiParsed: boolean): string {
  const usage = context.data_usage && typeof context.data_usage === "object" ? (context.data_usage as Record<string, unknown>) : {};
  return [
    "ASP Validator - Validacao IA consolidada",
    `Resposta IA interpretada: ${aiParsed ? "sim" : "nao"}`,
    `Usou OCR real: ${usage.used_ocr ? "sim" : "nao"}`,
    `Usou comentarios dos uploads: ${usage.used_upload_comments ? "sim" : "nao"}`,
    `Usou dados manuais: ${context.prediction ? "sim" : "nao"}`,
    `Usou JSON estruturado: ${usage.used_structured_json ? "sim" : "nao"}`,
    `Usou simulacao: ${usage.used_simulation ? "sim" : "nao"}`,
    `Usou IA + Pesquisa: ${usage.used_online_search ? "sim" : "nao"}`,
    "Regras: previsao externa e apenas ponto de partida; EV+/55% nao sao gatilhos obrigatorios; em duvida relevante, PULAR; foco em protecao de banca.",
  ].join("\n");
}

function buildValidatorDecision(form: ValidatorForm): ValidationResult {
  const offeredOdd = parseNumber(form.offered_odd);
  const sourceProbability = normalizeProbability(parseNumber(form.source_probability));
  const sourceEv = normalizeSourceEv(parseNumber(form.source_ev), form.source_platform);
  const sourceFairOdd = sourceProbability ? round(1 / (sourceProbability / 100), 2) : null;
  const context = form.user_context.toLowerCase();
  const validatorModel = inferValidatorModel(form.market, form.pick);

  const favorableBlocks: string[] = [];
  const againstBlocks: string[] = [];
  const alerts: string[] = [];
  let score = sourceProbability ?? 50;

  favorableBlocks.push("A previsao externa foi tratada como ponto de partida, nao como confirmacao automatica.");
  if (sourceProbability !== null) {
    favorableBlocks.push(`Probabilidade original informada: ${formatPercent(sourceProbability)}.`);
    if (sourceProbability >= 55) score += 4;
    if (sourceProbability < 50) {
      againstBlocks.push("Probabilidade original abaixo de 50%; pede protecao de banca e justificativa tecnica mais forte.");
      score -= 3;
    }
  } else {
    alerts.push("Probabilidade original ausente; isso nao impede a analise.");
  }

  if (sourceEv !== null) {
    if (sourceEv > 0) {
      favorableBlocks.push(`EV original positivo: ${formatPercent(sourceEv)}.`);
      score += Math.min(5, Math.max(1, sourceEv / 2));
    } else {
      alerts.push(`EV original informado como ${formatPercent(sourceEv)}; sera tratado como sinal de cautela, nao bloqueio automatico.`);
      score -= 2;
    }
  } else {
    alerts.push("EV original ausente/desconhecido; isso nao bloqueia a validacao.");
  }

  if (offeredOdd !== null && offeredOdd > 1) {
    const implied = 100 / offeredOdd;
    favorableBlocks.push(`Odd ofertada ${formatOdd(offeredOdd)} implica aproximadamente ${formatPercent(implied)} pelo mercado.`);
    if (sourceProbability !== null && sourceProbability > implied) score += 3;
    if (sourceProbability !== null && sourceProbability + 3 < implied) score -= 3;
  } else {
    alerts.push("Odd ofertada ausente ou invalida; EV ajustado fica indisponivel.");
  }

  const positiveTokens = ["valor", "edge", "desfalque", "linha baixa", "linha alta", "tendencia", "consistencia", "boa odd", "vantagem"];
  const negativeTokens = ["risco", "incerto", "sem dados", "baixa amostra", "odd caiu", "linha esticada", "duvida", "lesao"];
  const positiveHits = positiveTokens.filter((token) => context.includes(token));
  const negativeHits = negativeTokens.filter((token) => context.includes(token));
  if (positiveHits.length) {
    favorableBlocks.push(`Contexto possui sinais favoraveis: ${positiveHits.join(", ")}.`);
    score += Math.min(5, positiveHits.length * 1.5);
  }
  if (negativeHits.length) {
    againstBlocks.push(`Contexto possui pontos de cautela: ${negativeHits.join(", ")}.`);
    score -= Math.min(6, negativeHits.length * 1.5);
  }
  if (!context.trim()) alerts.push("Contexto do usuario vazio; em duvida relevante, a recomendacao deve ser PULAR.");

  const adjustedProbability = round(Math.max(35, Math.min(72, score)), 2);
  const adjustedFairOdd = round(100 / adjustedProbability, 2);
  const adjustedEv = offeredOdd && offeredOdd > 1 ? round((offeredOdd * (adjustedProbability / 100) - 1) * 100, 2) : null;
  const decision: Decision = adjustedProbability >= 54 && (adjustedEv === null || adjustedEv >= -2) && negativeHits.length < 3 ? "CONFIRMAR" : "PULAR";
  const confidence = adjustedProbability >= 62 ? "Alta" : adjustedProbability >= 55 ? "Moderada" : "Baixa";
  const finalAnalysis =
    decision === "CONFIRMAR"
      ? "A validacao encontrou valor suficiente para confirmar com protecao de banca. A previsao externa nao confirmou sozinha; a decisao veio da combinacao entre odd, contexto, sinais tecnicos e risco."
      : "A validacao recomenda PULAR. Quando ha duvida relevante, falta de suporte ou risco superior ao valor estimado, a protecao de banca prevalece.";

  return {
    decision,
    confidence,
    validator_model: validatorModel,
    source_probability: sourceProbability,
    source_fair_odd: sourceFairOdd,
    offered_odd: offeredOdd,
    source_ev: sourceEv,
    adjusted_probability: adjustedProbability,
    adjusted_fair_odd: adjustedFairOdd,
    adjusted_ev: adjustedEv,
    simulation_summary: "Simulacao ainda nao executada.",
    favorable_blocks: favorableBlocks,
    against_blocks: againstBlocks,
    alerts,
    final_analysis: finalAnalysis,
    analysis_context: [
      "Prompt interno ASP Validator:",
      "A previsao externa e apenas ponto de partida.",
      "Probabilidade abaixo de 55%, EV ausente ou EV negativo nao bloqueiam a analise.",
      "A decisao final deve ser somente CONFIRMAR ou PULAR.",
      "Em duvida relevante, PULAR.",
      "Priorizar protecao de banca e explicar se existe valor real.",
    ].join("\n"),
  };
}

function inferValidatorModel(market: string, pick: string): string {
  const text = normalize(`${market} ${pick}`);
  if (text.includes("corner") || text.includes("escanteio") || text.includes("canto")) return "ASP Corner Validator";
  if (text.includes("card") || text.includes("cartao") || text.includes("cartoes")) return "ASP Card Validator";
  if (text.includes("ht") || text.includes("st") || text.includes("intervalo") || text.includes("1 tempo") || text.includes("2 tempo")) return "ASP HT/ST Validator";
  if (
    text.includes("goal") ||
    text.includes("gol") ||
    text.includes("btts") ||
    text.includes("ambas") ||
    text.includes("1x2") ||
    text.includes("double chance") ||
    text.includes("dupla chance") ||
    text.includes("handicap") ||
    text.includes("resultado")
  ) {
    return "ASP Goal Validator";
  }
  return "ASP Market Validator";
}

async function saveValidation(form: ValidatorForm, result: ValidationResult, uploads: ValidatorUploadDraft[], setSaving: (saving: boolean) => void): Promise<boolean> {
  setSaving(true);
  try {
    const payload: ValidatorInsert = {
      ...form,
      match_date: form.match_date || "",
      offered_odd: result.offered_odd,
      source_probability: result.source_probability,
      source_ev: result.source_ev,
      source_fair_odd: result.source_fair_odd,
      adjusted_probability: result.adjusted_probability,
      adjusted_fair_odd: result.adjusted_fair_odd,
      adjusted_ev: result.adjusted_ev,
      decision: result.decision,
      confidence: result.confidence,
      validator_model: result.validator_model,
      analysis_context: result.analysis_context,
      favorable_blocks: result.favorable_blocks,
      against_blocks: result.against_blocks,
      alerts: result.alerts,
      final_analysis: result.final_analysis,
      simulation_json: {},
      online_context_json: {},
      ocr_raw_text: null,
      ocr_structured_data: {},
      ocr_data_quality_score: null,
      ocr_structured_fields_count: 0,
      structured_json: {
        form,
        result,
        uploads: uploads.map((upload) => uploadMetadata(upload)),
      },
      structured_status: "pending",
      structured_error: null,
      result_status: null,
      stake_units: null,
      unit_value_brl: null,
      profit_units: null,
      profit_brl: null,
      clv: null,
      result_settled_at: null,
      final_score: null,
      result_notes: null,
      simulation_type: null,
      is_simulated_result: false,
      bankroll_applied: false,
    };
    const insertPayload = {
      ...payload,
      match_date: payload.match_date || null,
      line: payload.line || null,
      league: payload.league || null,
      user_context: payload.user_context || null,
    };
    const { data, error } = await validatorDb.from("asp_validator_registros").insert(insertPayload).select("id").single();
    if (error) throw error;
    const uploadWarnings: string[] = [];
    if (uploads.length && data?.id) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userError || !userId) {
        uploadWarnings.push("Uploads nao foram salvos porque o usuario autenticado nao foi identificado.");
      } else {
        const uploadPayloads = [];
        for (const upload of uploads) {
          const uploadId = crypto.randomUUID();
          const filePath = buildStoragePath(userId, data.id, uploadId, upload.file.name);
          let savedPath: string | null = filePath;
          let ocrStatus = "pending";
          let ocrError: string | null = null;

          try {
            const { error: storageError } = await supabase.storage
              .from(ASP_VALIDATOR_UPLOAD_BUCKET)
              .upload(filePath, upload.file, {
                cacheControl: "3600",
                contentType: upload.file.type || "application/octet-stream",
                upsert: false,
              });
            if (storageError) throw storageError;
          } catch (storageError) {
            savedPath = null;
            ocrStatus = "failed";
            ocrError = buildStorageTechnicalMessage(storageError, filePath);
            uploadWarnings.push(ocrError);
          }

          uploadPayloads.push({
            id: uploadId,
            validator_id: data.id,
            user_id: userId,
            file_name: upload.file.name,
            file_path: savedPath,
            storage_bucket: ASP_VALIDATOR_UPLOAD_BUCKET,
            file_type: upload.file.type || null,
            mime_type: upload.file.type || null,
            file_size: upload.file.size,
            upload_source: upload.upload_source,
            upload_category: upload.upload_category,
            user_comment: upload.user_comment || null,
            upload_order: upload.upload_order,
            ocr_status: ocrStatus,
            ocr_text: null,
            ocr_error: ocrError,
            ocr_structured_data: {},
            ocr_data_quality_score: null,
            ocr_structured_fields_count: 0,
            structured_json: {},
            structured_status: "pending",
            structured_error: null,
          });
        }
        const { error: uploadError } = await validatorDb.from("asp_validator_uploads").insert(uploadPayloads);
        if (uploadError) uploadWarnings.push(`Registro salvo, mas falhou ao vincular uploads: ${uploadError.message}`);
      }
    }
    if (uploadWarnings.length) {
      toast.warning(`Validacao salva no historico. ${uploadWarnings[0]}`);
    } else {
      toast.success(uploads.length ? "Validacao e arquivos salvos para OCR." : "Validacao salva no ASP Validator.");
    }
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar a validacao.");
    return false;
  } finally {
    setSaving(false);
  }
}

function uploadMetadata(upload: ValidatorUploadDraft) {
  return {
    file_name: upload.file.name,
    file_type: upload.file.type || null,
    mime_type: upload.file.type || null,
    file_size: upload.file.size,
    upload_source: upload.upload_source,
    upload_category: upload.upload_category,
    user_comment: upload.user_comment || null,
    upload_order: upload.upload_order,
    ocr_status: "pending",
  };
}

function buildStorageTechnicalMessage(error: unknown, filePath: string): string {
  const rawMessage = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message) : String(error || "erro desconhecido");
  const bucketHint = rawMessage.toLowerCase().includes("bucket") || rawMessage.toLowerCase().includes("not found")
    ? "Bucket possivelmente ausente. Aplique a migration que cria asp-validator-uploads e suas policies."
    : "Falha de Storage ao salvar arquivo.";
  return `${bucketHint} bucket=${ASP_VALIDATOR_UPLOAD_BUCKET} file_path=${filePath}. Detalhe: ${rawMessage}`;
}

type StructuredUpload = {
  upload_id: string;
  category: string;
  comment: string;
  ocr_text: string;
  detected_content_type: string;
  extracted_data: Record<string, unknown>;
};

type StructuredValidatorJson = {
  extracted_from_ocr: boolean;
  field_sources: Record<string, string>;
  data_quality_score: number;
  has_structured_ocr_data: boolean;
  structured_fields_count: number;
  missing_critical_fields: string[];
  source_platform: string;
  sport: string;
  match: {
    sport: string;
    competition: string;
    round: string;
    date: string;
    time: string;
    home_team: string;
    away_team: string;
  };
  market: {
    name: string;
    line: string | number | null;
    pick: string;
    selection_team: string;
    offered_odd: number | null;
    fair_odd_original: number | null;
    probability_original: number | null;
    ev_original: number | null;
    market_normalized: string | null;
  };
  corners: {
    home: CornerSideStats;
    away: CornerSideStats;
  };
  pre_match_odds: Array<{ bookmaker: string; odd: number }>;
  packball_recommendation: {
    market: string;
    pick: string;
    offered_odd: number | null;
    probability_original: number | null;
    fair_odd_original: number | null;
    ev_original: number | null;
  };
  goals: Record<string, unknown>;
  raw_ocr_text: string;
  fixture: {
    league: string;
    date: string;
    home_team: string;
    away_team: string;
  };
  prediction: {
    market: string;
    pick: string;
    line: string | number | null;
    offered_odd: number | null;
    source_probability: number | null;
    source_ev: number | null;
    source_fair_odd: number | null;
  };
  uploads: StructuredUpload[];
  recent_form: {
    home_last_games: string[];
    away_last_games: string[];
  };
  home_away_split: {
    home_team_home_games: string[];
    away_team_away_games: string[];
  };
  market_specific_data: {
    goals: Record<string, unknown>;
    btts: Record<string, unknown>;
    corners: Record<string, unknown>;
    cards: Record<string, unknown>;
    handicap: Record<string, unknown>;
    double_chance: Record<string, unknown>;
    ht_st: Record<string, unknown>;
  };
  notes: string[];
  data_quality: {
    ocr_quality: "low" | "medium" | "high";
    score: number;
    structured_fields_count: number;
    has_structured_ocr_data: boolean;
    missing_fields: string[];
    missing_critical_fields: string[];
    conflicts: string[];
    critical_missing_fields: string[];
    needs_manual_review: boolean;
  };
};

type NormalizedCornerLine = {
  label: string;
  side: "over" | "under";
  line_value: number;
  market_normalized: string;
  value_pct: number;
  scope: "general" | "home_away";
};

type CornerSideStats = {
  avg_for: number | null;
  avg_against: number | null;
  avg_total: number | null;
  total_corners: number | null;
  total_for: number | null;
  total_against: number | null;
  home_away_avg_for: number | null;
  home_away_avg_against: number | null;
  home_away_avg_total: number | null;
  first_corner_pct: number | null;
  race_to_3_pct: number | null;
  race_to_5_pct: number | null;
  race_to_7_pct: number | null;
  race_to_9_pct: number | null;
  most_corners_1x2_pct: number | null;
  over_lines: Record<string, number>;
  under_lines: Record<string, number>;
  home_away_over_lines: Record<string, number>;
  home_away_under_lines: Record<string, number>;
  normalized_market_lines: NormalizedCornerLine[];
};

type OcrIntelligenceData = {
  extracted_from_ocr: boolean;
  data_quality_score: number;
  has_structured_ocr_data: boolean;
  structured_fields_count: number;
  missing_critical_fields: string[];
  match: {
    sport: string;
    competition: string;
    round: string;
    date: string;
    time: string;
    home_team: string;
    away_team: string;
  };
  market: {
    name: string;
    line: string | number | null;
    pick: string;
    selection_team: string;
    offered_odd: number | null;
    fair_odd_original: number | null;
    probability_original: number | null;
    ev_original: number | null;
    market_normalized: string | null;
  };
  corners: {
    home: CornerSideStats;
    away: CornerSideStats;
  };
  pre_match_odds: Array<{ bookmaker: string; odd: number }>;
  packball_recommendation: {
    market: string;
    pick: string;
    offered_odd: number | null;
    probability_original: number | null;
    fair_odd_original: number | null;
    ev_original: number | null;
  };
  goals: Record<string, unknown>;
  raw_ocr_text: string;
  notes: string[];
};

function buildStructuredOcrJson(record: ValidatorRecord, uploads: ValidatorUploadRecord[]): StructuredValidatorJson {
  const manualLine = record.line || null;
  const manualOdd = record.offered_odd;
  const manualProbability = record.source_probability;
  const manualEv = record.source_ev;
  const combinedText = [record.user_context, record.ocr_raw_text, ...uploads.map((upload) => `${upload.user_comment || ""}\n${upload.ocr_text || ""}`)]
    .filter(Boolean)
    .join("\n\n");
  const inferred = extractPredictionSignals(combinedText);
  const intelligence = buildOcrIntelligence(record, uploads, combinedText, inferred);

  const structuredUploads = uploads.map((upload): StructuredUpload => {
    const text = upload.ocr_text || "";
    const comment = upload.user_comment || "";
    return {
      upload_id: upload.id,
      category: upload.upload_category,
      comment,
      ocr_text: text,
      detected_content_type: detectContentType(upload.upload_category, `${comment}\n${text}`),
      extracted_data: {
        ...extractPredictionSignals(`${comment}\n${text}`),
        ocr_intelligence: buildOcrIntelligence(record, [upload], `${comment}\n${text}`, extractPredictionSignals(`${comment}\n${text}`)),
        games: extractGameLikeLines(text),
      },
    };
  });

  const marketData = buildMarketSpecificData(record, structuredUploads, combinedText);
  const missingFields = buildMissingFields(record, structuredUploads, intelligence);
  const conflicts = buildStructuredConflicts(record, inferred);
  const totalOcrChars = structuredUploads.reduce((sum, upload) => sum + upload.ocr_text.length, 0);
  const completedUploads = uploads.filter((upload) => upload.ocr_status === "completed" && upload.ocr_text?.trim()).length;
  const ocrQuality: "low" | "medium" | "high" =
    totalOcrChars > 1200 && completedUploads >= 2 ? "high" : totalOcrChars > 250 || completedUploads >= 1 ? "medium" : "low";

  return {
    extracted_from_ocr: intelligence.extracted_from_ocr,
    field_sources: buildFieldSources(record, structuredUploads, intelligence),
    data_quality_score: intelligence.data_quality_score,
    has_structured_ocr_data: intelligence.has_structured_ocr_data,
    structured_fields_count: intelligence.structured_fields_count,
    missing_critical_fields: intelligence.missing_critical_fields,
    source_platform: record.source_platform || "",
    sport: record.sport || "",
    match: intelligence.match,
    market: intelligence.market,
    corners: intelligence.corners,
    pre_match_odds: intelligence.pre_match_odds,
    packball_recommendation: intelligence.packball_recommendation,
    goals: intelligence.goals,
    raw_ocr_text: combinedText,
    fixture: {
      league: record.league || intelligence.match.competition || "",
      date: record.match_date || "",
      home_team: record.home_team || intelligence.match.home_team || "",
      away_team: record.away_team || intelligence.match.away_team || "",
    },
    prediction: {
      market: record.market || intelligence.market.name || "",
      pick: record.pick || intelligence.market.pick || "",
      line: manualLine ?? inferred.line ?? intelligence.market.line ?? null,
      offered_odd: manualOdd ?? inferred.offered_odd ?? intelligence.market.offered_odd ?? null,
      source_probability: manualProbability ?? inferred.source_probability ?? intelligence.market.probability_original ?? null,
      source_ev: manualEv ?? inferred.source_ev ?? intelligence.market.ev_original ?? null,
      source_fair_odd: record.source_fair_odd ?? inferred.source_fair_odd ?? intelligence.market.fair_odd_original ?? null,
    },
    uploads: structuredUploads,
    recent_form: {
      home_last_games: extractGamesForTeam(combinedText, record.home_team),
      away_last_games: extractGamesForTeam(combinedText, record.away_team),
    },
    home_away_split: {
      home_team_home_games: extractCategoryGames(structuredUploads, "Casa/Fora", record.home_team),
      away_team_away_games: extractCategoryGames(structuredUploads, "Casa/Fora", record.away_team),
    },
    market_specific_data: marketData,
    notes: [...buildStructuredNotes(record, structuredUploads, inferred), ...intelligence.notes],
    data_quality: {
      ocr_quality: ocrQuality,
      score: intelligence.data_quality_score,
      structured_fields_count: intelligence.structured_fields_count,
      has_structured_ocr_data: intelligence.has_structured_ocr_data,
      missing_fields: missingFields,
      missing_critical_fields: intelligence.missing_critical_fields,
      critical_missing_fields: intelligence.missing_critical_fields,
      conflicts,
      needs_manual_review: intelligence.data_quality_score < 0.55 || conflicts.length > 0 || ocrQuality === "low",
    },
  };
}

function extractPredictionSignals(text: string): {
  offered_odd?: number | null;
  source_probability?: number | null;
  source_ev?: number | null;
  source_fair_odd?: number | null;
  line?: string | null;
} {
  const normalizedText = text.replace(/,/g, ".");
  const odd = matchNumber(normalizedText, /\b(?:odd|odds|cotacao|cota[cç][aã]o)\s*(?:ofertada)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const probability = matchNumber(normalizedText, /\b(?:probabilidade|prob\.?|probability)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?/i);
  const ev = matchNumber(normalizedText, /\b(?:ev|edge|valor esperado)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*%?/i);
  const fairOdd = matchNumber(normalizedText, /\b(?:odd justa|odd valor|fair odd)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const lineMatch = normalizedText.match(/\b(?:linha|line|over|under|handicap)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  return {
    offered_odd: odd,
    source_probability: probability !== null ? normalizeProbability(probability) : null,
    source_ev: normalizeExtractedEv(ev, text),
    source_fair_odd: fairOdd,
    line: lineMatch?.[1] ?? null,
  };
}

function buildOcrIntelligence(
  record: ValidatorRecord,
  uploads: ValidatorUploadRecord[],
  combinedText: string,
  inferred: ReturnType<typeof extractPredictionSignals>,
): OcrIntelligenceData {
  const normalizedText = combinedText.replace(/,/g, ".");
  const match = extractMatchFromOcr(record, normalizedText);
  const robustSignals = extractRobustPredictionSignals(normalizedText);
  const mergedSignals = {
    offered_odd: inferred.offered_odd ?? robustSignals.offered_odd,
    source_probability: inferred.source_probability ?? robustSignals.source_probability,
    source_ev: inferred.source_ev ?? robustSignals.source_ev,
    source_fair_odd: inferred.source_fair_odd ?? robustSignals.source_fair_odd,
    line: inferred.line ?? robustSignals.line,
  };
  const market = extractMarketFromOcr(record, normalizedText, mergedSignals, match);
  const corners = extractCornerStats(normalizedText, match.home_team || record.home_team, match.away_team || record.away_team);
  const preMatchOdds = extractPreMatchOdds(normalizedText);
  const packballRecommendation = {
    market: market.name,
    pick: market.pick,
    offered_odd: market.offered_odd,
    probability_original: market.probability_original,
    fair_odd_original: market.fair_odd_original,
    ev_original: market.ev_original,
  };
  const goals = extractGoalStats(normalizedText);
  const structuredFieldsCount = countStructuredFields({
    match,
    market,
    corners,
    pre_match_odds: preMatchOdds,
    packball_recommendation: packballRecommendation,
    goals,
    extracted_numbers: extractPercentagesAndNumbers(combinedText),
  });
  const missingCriticalFields = buildOcrCriticalMissingFields(match, market, corners, structuredFieldsCount);
  const textVolume = uploads.reduce((sum, upload) => sum + (upload.ocr_text?.trim().length ?? 0), 0);
  const hasStructuredOcrData =
    structuredFieldsCount >= 4 ||
    Boolean(market.offered_odd || market.probability_original || market.ev_original || market.fair_odd_original) ||
    Boolean(corners.home.avg_for || corners.away.avg_for || corners.home.avg_against || corners.away.avg_against || corners.home.race_to_5_pct || corners.away.race_to_5_pct || Object.keys(corners.home.over_lines).length || Object.keys(corners.away.over_lines).length);
  const dataQualityScore = calculateOcrDataQualityScore(structuredFieldsCount, missingCriticalFields.length, textVolume, hasStructuredOcrData);

  return {
    extracted_from_ocr: uploads.some((upload) => Boolean(upload.ocr_text?.trim())),
    data_quality_score: dataQualityScore,
    has_structured_ocr_data: hasStructuredOcrData,
    structured_fields_count: structuredFieldsCount,
    missing_critical_fields: missingCriticalFields,
    match,
    market,
    corners,
    pre_match_odds: preMatchOdds,
    packball_recommendation: packballRecommendation,
    goals,
    raw_ocr_text: combinedText,
    notes: [
      hasStructuredOcrData
        ? `OCR Intelligence identificou ${structuredFieldsCount} campo(s) estruturado(s).`
        : "OCR Intelligence nao encontrou campos quantitativos suficientes.",
      dataQualityScore >= 0.75 ? "Qualidade dos dados OCR considerada alta para uso auxiliar." : "Dados OCR devem ser usados como apoio, com revisao manual.",
    ],
  };
}

function extractRobustPredictionSignals(text: string): ReturnType<typeof extractPredictionSignals> {
  const odd =
    matchNumber(text, /\b(?:odd|odds|cotacao|cotacao)\s*(?:ofertada|oferecida|oferecidas)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i) ??
    matchNumber(text, /\(odds?\s*oferecid[ao]s?\)\s*=?\s*(\d+(?:\.\d+)?)/i);
  const probability =
    matchNumber(text, /\b(?:probabilidade|prob\.?|probability|chance)\s*(?:\(\s*%\s*\))?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?/i) ??
    matchNumber(text, /\b(\d+(?:\.\d+)?)\s*%\b[^\n]{0,70}(?:chance|previs|recomend|best)/i);
  const ev = matchNumber(text, /\b(?:ev|edge|valor esperado)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*%?/i);
  const fairOdd =
    matchNumber(text, /\b(?:odd justa|odd valor|fair odd|odds esperadas|odd esperada)\s*[:=]?\s*(\d+(?:\.\d+)?)/i) ??
    matchNumber(text, /\bVE\s*(?:\([^)]*\))?\s*=?\s*(\d+(?:\.\d+)?)/i);
  const lineMatch = text.match(/\b(?:linha|line|over|under|handicap|race to|corrida de escanteios)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  return {
    offered_odd: odd,
    source_probability: probability !== null ? normalizeProbability(probability) : null,
    source_ev: normalizeExtractedEv(ev, text),
    source_fair_odd: fairOdd,
    line: lineMatch?.[1] ?? null,
  };
}

function extractMatchFromOcr(record: ValidatorRecord, text: string): OcrIntelligenceData["match"] {
  const competitionMatch =
    text.match(/(?:World|Mundo|Competicao|Competição|Liga)\s*[:\-]\s*([^\n\r]+?)(?:\s*-\s*Rodada\s*[:\-]?\s*([^\n\r]+))?(?:\n|$)/i) ??
    text.match(/\b(Brazil\s*:\s*Serie\s*B)\s*-\s*(Rodada\s*\d+)/i) ??
    text.match(/\b([A-Z][A-Za-z\s]+(?:Cup|League|Liga|Division|Championship))[^\n\r]*/);
  const fixtureMatch = text.match(/([A-Za-zÀ-ÿ .'-]{2,40})\s+(?:vs|x)\s+([A-Za-zÀ-ÿ .'-]{2,40})/i);
  const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  return {
    sport: record.sport || inferSportFromText(text),
    competition: record.league || cleanOcrValue(competitionMatch?.[1] ?? ""),
    round: cleanOcrValue(competitionMatch?.[2] ?? ""),
    date: record.match_date || cleanOcrValue(dateMatch ? `${dateMatch[1]}${dateMatch[2] ? ` ${dateMatch[2]}` : ""}` : ""),
    time: cleanOcrValue(dateMatch?.[2] ?? ""),
    home_team: record.home_team || cleanOcrValue(fixtureMatch?.[1] ?? ""),
    away_team: record.away_team || cleanOcrValue(fixtureMatch?.[2] ?? ""),
  };
}

function extractMarketFromOcr(
  record: ValidatorRecord,
  text: string,
  inferred: ReturnType<typeof extractPredictionSignals>,
  match: OcrIntelligenceData["match"],
): OcrIntelligenceData["market"] {
  const normalized = normalize(text);
  const raceMatch = text.match(/(?:fora|visitante|away|casa|mandante|home)?\s*(?:cobrar|chegar|marcar)?\s*(\d+)\s*(?:escanteios|cantos|corners?)\s*(?:primeiro|first)/i);
  const raceLine = raceMatch?.[1] ?? text.match(/(\d+)\s*primeiro/i)?.[1] ?? null;
  const isCornerRace = Boolean(raceLine) || normalized.includes("corrida de escanteios") || normalized.includes("race to");
  const totalCornerMatch =
    text.match(/\b(?:mais\s+de|over)\s*(\d+(?:\.\d+)?)\s*(?:escanteios|cantos|corners?)/i) ??
    text.match(/\b(?:menos\s+de|under)\s*(\d+(?:\.\d+)?)\s*(?:escanteios|cantos|corners?)/i);
  const totalCornerLine = totalCornerMatch?.[1] ?? null;
  const isCornerTotal = Boolean(totalCornerLine) && !isCornerRace;
  const selectionTeam =
    inferSelectionTeam(record.pick, match, text) ||
    (/\bfora\b|\bvisitante\b|\baway\b/i.test(text) ? match.away_team : "") ||
    (/\bcasa\b|\bmandante\b|\bhome\b/i.test(text) ? match.home_team : "");
  const manualMarketIsGeneric = !record.market || ["escanteios", "outro"].includes(normalize(record.market));
  const detectedTotalName = totalCornerLine ? `${normalized.includes("under") || normalized.includes("menos de") ? "Menos de" : "Mais de"} ${totalCornerLine} escanteios` : "";
  const marketName = manualMarketIsGeneric
    ? isCornerTotal
      ? detectedTotalName
      : isCornerRace
        ? `Race to ${raceLine ?? ""} Corners`.trim()
        : inferMarketNameFromText(text)
    : record.market;
  const pick = record.pick || (isCornerTotal ? `${normalized.includes("under") || normalized.includes("menos de") ? "Under" : "Over"} ${totalCornerLine} escanteios` : isCornerRace ? `${selectionTeam || "Visitante"} cobrar ${raceLine ?? ""} escanteios primeiro`.trim() : "");

  const finalLine = record.line || inferred.line || totalCornerLine || raceLine || null;
  const market_normalized = buildCornerMarketNormalized(marketName, pick, finalLine, isCornerTotal, normalized);

  return {
    name: marketName,
    line: finalLine,
    pick,
    selection_team: selectionTeam,
    offered_odd: record.offered_odd ?? inferred.offered_odd ?? null,
    fair_odd_original: record.source_fair_odd ?? inferred.source_fair_odd ?? null,
    probability_original: record.source_probability ?? inferred.source_probability ?? null,
    ev_original: record.source_ev ?? inferred.source_ev ?? null,
    market_normalized,
  };
}

/**
 * Convencao da planilha/OCR para mercados de escanteios:
 *   "+N" significa "Mais de N.5 escanteios" (ex.: +9 = Over 9.5)
 *   "-N" significa "Menos de N.5 escanteios" (ex.: -9 = Under 9.5)
 * Para linhas ja decimais (ex.: 9.5), preserva a linha original.
 */
function normalizeCornerLineToken(token: string): { line_value: number; market_normalized: string; side: "over" | "under" } | null {
  if (!token) return null;
  const trimmed = token.replace(/\s+/g, "").replace(",", ".");
  const match = trimmed.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const sign = match[1];
  const raw = Number(match[2]);
  if (!Number.isFinite(raw)) return null;
  const isInteger = !match[2].includes(".");
  const side: "over" | "under" = sign === "-" ? "under" : "over";
  // +N -> Over (N).5 ; -N -> Under (N).5 ; decimal stays as-is
  const line_value = isInteger ? raw + 0.5 : raw;
  const prefix = side === "over" ? "Mais de" : "Menos de";
  return { line_value, market_normalized: `${prefix} ${line_value} escanteios`, side };
}

function buildCornerMarketNormalized(
  marketName: string,
  pick: string,
  line: string | number | null,
  isCornerTotal: boolean,
  normalizedText: string,
): string | null {
  const blob = `${marketName} ${pick}`.toLowerCase();
  const isCornerContext = isCornerTotal || /escanteio|canto|corner/.test(blob) || /escanteio|canto|corner/.test(normalizedText);
  if (!isCornerContext) return null;
  const explicit = `${pick} ${marketName} ${line ?? ""}`.match(/([+-]?\d+(?:[.,]\d+)?)/);
  const token = explicit?.[1] ?? (typeof line === "number" ? String(line) : line ?? "");
  if (!token) return null;
  // If pick already says under/menos, force that side regardless of sign
  const forced: "over" | "under" | null = /\b(under|menos)\b/i.test(`${pick} ${marketName}`) ? "under" : /\b(over|mais)\b/i.test(`${pick} ${marketName}`) ? "over" : null;
  const parsed = normalizeCornerLineToken(String(token));
  if (!parsed) return null;
  if (forced && forced !== parsed.side) {
    const prefix = forced === "over" ? "Mais de" : "Menos de";
    return `${prefix} ${parsed.line_value} escanteios`;
  }
  return parsed.market_normalized;
}

function extractCornerStats(text: string, homeTeam: string, awayTeam: string): OcrIntelligenceData["corners"] {
  const avgFor = metricPairNumbers(text, /marcados/i, { requireDecimal: true }) ?? labelNumbers(text, /marcados/gi);
  const avgAgainst = metricPairNumbers(text, /sofridos/i, { requireDecimal: true }) ?? labelNumbers(text, /sofridos/gi);
  const avgTotal = labelNumbers(text, /marcados\s*\+\s*sofridos|total\s+escanteios|m[eé]dia\s+escanteios/gi);
  const avgTotalPair = metricPairNumbers(text, /marcados\s*\+\s*sofridos|m[eÃ©]dia\s+escanteios/i, { requireDecimal: true }) ?? avgTotal;
  const first = twoSidedPercent(text, /primeiro\s+do\s+jogo/i);
  const race3 = twoSidedPercent(text, /3\s*primeiro/i);
  const race5 = twoSidedPercent(text, /5\s*primeiro/i);
  const race7 = twoSidedPercent(text, /7\s*primeiro/i);
  const race9 = twoSidedPercent(text, /9\s*primeiro/i);
  const mostCorners = twoSidedPercent(text, /mais\s+escanteios|1x2/i);
  const overLines = extractCornerOverLines(text);
  const totalCorners = metricPairNumbers(text, /total\s+(?:cantos|corners|escanteios)/i);
  const totalFor = metricPairNumbers(text, /marcados\s+total|total\s+marcados/i);
  const totalAgainst = metricPairNumbers(text, /sofridos\s+total|total\s+sofridos/i);
  const homeBlockStats = extractCornerSideStatsFromBlock(extractTeamTextBlock(text, homeTeam, awayTeam));
  const awayBlockStats = extractCornerSideStatsFromBlock(extractTeamTextBlock(text, awayTeam, homeTeam));
  const homeAwaySplit = extractHomeAwayCornerSplit(text, homeTeam, awayTeam);

  return {
    home: {
      avg_for: homeBlockStats.avg_for ?? numberAt(avgFor, 0) ?? numberNearTeam(text, homeTeam, /marcados/i),
      avg_against: homeBlockStats.avg_against ?? numberAt(avgAgainst, 0) ?? numberNearTeam(text, homeTeam, /sofridos/i),
      avg_total: homeBlockStats.avg_total ?? numberAt(avgTotalPair, 0),
      total_corners: homeBlockStats.total_corners ?? numberAt(totalCorners, 0),
      total_for: homeBlockStats.total_for ?? numberAt(totalFor, 0),
      total_against: homeBlockStats.total_against ?? numberAt(totalAgainst, 0),
      home_away_avg_for: homeAwaySplit.home.avg_for,
      home_away_avg_against: homeAwaySplit.home.avg_against,
      home_away_avg_total: homeAwaySplit.home.avg_total,
      first_corner_pct: homeBlockStats.first_corner_pct ?? first.home,
      race_to_3_pct: homeBlockStats.race_to_3_pct ?? race3.home,
      race_to_5_pct: homeBlockStats.race_to_5_pct ?? race5.home,
      race_to_7_pct: homeBlockStats.race_to_7_pct ?? race7.home,
      race_to_9_pct: homeBlockStats.race_to_9_pct ?? race9.home,
      most_corners_1x2_pct: homeBlockStats.most_corners_1x2_pct ?? mostCorners.home,
      over_lines: { ...overLines.home, ...homeBlockStats.over_lines },
      under_lines: { ...overLines.home_under, ...homeBlockStats.under_lines },
      home_away_over_lines: homeAwaySplit.home.over_lines,
      home_away_under_lines: homeAwaySplit.home.under_lines,
    },
    away: {
      avg_for: awayBlockStats.avg_for ?? numberAt(avgFor, 1) ?? numberNearTeam(text, awayTeam, /marcados/i),
      avg_against: awayBlockStats.avg_against ?? numberAt(avgAgainst, 1) ?? numberNearTeam(text, awayTeam, /sofridos/i),
      avg_total: awayBlockStats.avg_total ?? numberAt(avgTotalPair, 1),
      total_corners: awayBlockStats.total_corners ?? numberAt(totalCorners, 1),
      total_for: awayBlockStats.total_for ?? numberAt(totalFor, 1),
      total_against: awayBlockStats.total_against ?? numberAt(totalAgainst, 1),
      home_away_avg_for: homeAwaySplit.away.avg_for,
      home_away_avg_against: homeAwaySplit.away.avg_against,
      home_away_avg_total: homeAwaySplit.away.avg_total,
      first_corner_pct: awayBlockStats.first_corner_pct ?? first.away,
      race_to_3_pct: awayBlockStats.race_to_3_pct ?? race3.away,
      race_to_5_pct: awayBlockStats.race_to_5_pct ?? race5.away,
      race_to_7_pct: awayBlockStats.race_to_7_pct ?? race7.away,
      race_to_9_pct: awayBlockStats.race_to_9_pct ?? race9.away,
      most_corners_1x2_pct: awayBlockStats.most_corners_1x2_pct ?? mostCorners.away,
      over_lines: { ...overLines.away, ...awayBlockStats.over_lines },
      under_lines: { ...overLines.away_under, ...awayBlockStats.under_lines },
      home_away_over_lines: homeAwaySplit.away.over_lines,
      home_away_under_lines: homeAwaySplit.away.under_lines,
    },
  };
}

function metricPairNumbers(text: string, label: RegExp, options: { requireDecimal?: boolean } = {}): number[] | null {
  for (const rawLine of text.replace(/,/g, ".").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!label.test(line)) continue;
    if (/total\s+escanteios/i.test(line) && !/m[eé]dia|marcados\s*\+\s*sofridos/i.test(line)) continue;
    const values = [...line.matchAll(/(\d+(?:\.\d+)?)/g)]
      .map((match) => match[1])
      .filter((value) => !options.requireDecimal || value.includes("."))
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 15);
    if (values.length >= 2) return values.slice(0, 2);
  }

  const compact = text.replace(/,/g, ".").replace(/\s+/g, " ");
  const beforeAfter = compact.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s+${label.source}\\s+(\\d+(?:\\.\\d+)?)`, "i"));
  if (beforeAfter) {
    const values = [beforeAfter[1], beforeAfter[2]]
      .filter((value) => !options.requireDecimal || value.includes("."))
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 15);
    if (values.length === 2) return values;
  }

  return null;
}

function extractGoalStats(text: string): Record<string, unknown> {
  const normalized = normalize(text);
  if (!normalized.includes("gol") && !normalized.includes("goal") && !normalized.includes("btts")) return {};
  return {
    extracted_numbers: extractPercentagesAndNumbers(text),
    over_1_5_pct: matchNumber(text, /over\s*1\.5[^\d]*(\d+(?:\.\d+)?)\s*%/i),
    over_2_5_pct: matchNumber(text, /over\s*2\.5[^\d]*(\d+(?:\.\d+)?)\s*%/i),
    btts_yes_pct: matchNumber(text, /btts[^\d]*(?:sim|yes)?[^\d]*(\d+(?:\.\d+)?)\s*%/i),
  };
}

function twoSidedPercent(text: string, label: RegExp): { home: number | null; away: number | null } {
  const line = text.split(/\r?\n/).find((item) => label.test(item));
  if (line) {
    let values = [...line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1])).filter(Number.isFinite);
    if (values.length < 2) {
      values = [...line.replace(/,/g, ".").matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
      const labelNumber = line.match(/\b(3|5|7|9)\s*primeiro\b/i)?.[1];
      if (labelNumber && values[0] === Number(labelNumber)) values = values.slice(1);
    }
    if (values.length >= 2) return { home: values[0], away: values[1] };
  }
  const compact = text.replace(/\s+/g, " ");
  const match = compact.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%?[^%]{0,80}${label.source}[^%]{0,80}(\\d+(?:\\.\\d+)?)\\s*%?`, "i"));
  return { home: match ? Number(match[1]) : null, away: match ? Number(match[2]) : null };
}

function labelNumbers(text: string, label: RegExp): number[] {
  return text
    .split(/\r?\n/)
    .filter((line) => label.test(line))
    .flatMap((line) => [...line.replace(/,/g, ".").matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])))
    .filter((value) => Number.isFinite(value) && value <= 100)
    .slice(0, 8);
}

function extractCornerOverLines(text: string): { home: Record<string, number>; away: Record<string, number>; home_under: Record<string, number>; away_under: Record<string, number> } {
  const home: Record<string, number> = {};
  const away: Record<string, number> = {};
  const homeUnder: Record<string, number> = {};
  const awayUnder: Record<string, number> = {};
  for (const line of text.replace(/,/g, ".").split(/\r?\n/)) {
    const lineMatch = line.match(/([+-]?\d+(?:\.\d+)?)/);
    const pctMatches = [...line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
    if (!lineMatch || pctMatches.length < 1 || !/(over|under|mais\/menos|\+\d|-?\d)/i.test(line)) continue;
    const key = lineMatch[1].replace(/^[+-]/, "");
    const isUnder = /under|menos|-\d/i.test(line);
    const targetHome = isUnder ? homeUnder : home;
    const targetAway = isUnder ? awayUnder : away;
    if (pctMatches[0] !== undefined) targetHome[key] = pctMatches[0];
    if (pctMatches[1] !== undefined) targetAway[key] = pctMatches[1];
  }
  return { home, away, home_under: homeUnder, away_under: awayUnder };
}

function extractTeamTextBlock(text: string, team: string, otherTeam: string): string {
  if (!team) return "";
  const lines = text.split(/\r?\n/);
  const teamKey = normalize(team);
  const otherKey = normalize(otherTeam || "");
  const start = lines.findIndex((line) => normalize(line).includes(teamKey));
  if (start < 0) return "";
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalize(line);
    if (index > start && otherKey && normalizedLine.includes(otherKey)) break;
    if (index > start + 2 && /^\s*$/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

function extractCornerSideStatsFromBlock(block: string): Pick<
  CornerSideStats,
  | "avg_for"
  | "avg_against"
  | "avg_total"
  | "total_corners"
  | "total_for"
  | "total_against"
  | "first_corner_pct"
  | "race_to_3_pct"
  | "race_to_5_pct"
  | "race_to_7_pct"
  | "race_to_9_pct"
  | "most_corners_1x2_pct"
  | "over_lines"
  | "under_lines"
> {
  return {
    avg_for: labeledNumber(block, /(?:corners?|cantos?|escanteios)?\s*marcados/i),
    avg_against: labeledNumber(block, /(?:corners?|cantos?|escanteios)?\s*sofridos/i),
    avg_total: labeledNumber(block, /total\s+medio|total\s+medio|media\s+total|marcados\s*\+\s*sofridos/i),
    total_corners: labeledNumber(block, /total\s+(?:cantos|corners|escanteios)/i),
    total_for: labeledNumber(block, /marcados\s+total|total\s+marcados/i),
    total_against: labeledNumber(block, /sofridos\s+total|total\s+sofridos/i),
    first_corner_pct: labeledPercent(block, /primeiro\s+(?:escanteio|canto)|primeiro\s+do\s+jogo/i),
    race_to_3_pct: labeledPercent(block, /race\s*3|3\s*primeiro/i),
    race_to_5_pct: labeledPercent(block, /race\s*5|5\s*primeiro/i),
    race_to_7_pct: labeledPercent(block, /race\s*7|7\s*primeiro/i),
    race_to_9_pct: labeledPercent(block, /race\s*9|9\s*primeiro/i),
    most_corners_1x2_pct: labeledPercent(block, /mais\s+escanteios\s*1x2|mais\s+escanteios/i),
    over_lines: extractSingleSideLinePercents(block, "over"),
    under_lines: extractSingleSideLinePercents(block, "under"),
  };
}

function extractHomeAwayCornerSplit(
  text: string,
  homeTeam: string,
  awayTeam: string,
): { home: Pick<CornerSideStats, "avg_for" | "avg_against" | "avg_total" | "over_lines" | "under_lines">; away: Pick<CornerSideStats, "avg_for" | "avg_against" | "avg_total" | "over_lines" | "under_lines"> } {
  const lower = normalize(text);
  const markerIndex = Math.max(lower.indexOf("casa/fora"), lower.indexOf("home/away"));
  if (markerIndex < 0) {
    return {
      home: { avg_for: null, avg_against: null, avg_total: null, over_lines: {}, under_lines: {} },
      away: { avg_for: null, avg_against: null, avg_total: null, over_lines: {}, under_lines: {} },
    };
  }
  const slice = text.slice(markerIndex);
  return {
    home: extractCornerSideStatsFromBlock(extractTeamTextBlock(slice, homeTeam, awayTeam)),
    away: extractCornerSideStatsFromBlock(extractTeamTextBlock(slice, awayTeam, homeTeam)),
  };
}

function labeledNumber(text: string, label: RegExp): number | null {
  const line = text.split(/\r?\n/).find((item) => label.test(item));
  if (!line) return null;
  const values = [...line.replace(/,/g, ".").matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite);
  return values.find((value) => value >= 0 && value <= 200) ?? null;
}

function labeledPercent(text: string, label: RegExp): number | null {
  const line = text.split(/\r?\n/).find((item) => label.test(item));
  if (!line) return null;
  const match = line.replace(/,/g, ".").match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractSingleSideLinePercents(text: string, side: "over" | "under"): Record<string, number> {
  const values: Record<string, number> = {};
  for (const line of text.replace(/,/g, ".").split(/\r?\n/)) {
    const isOver = /\+\s*\d|over|mais/i.test(line);
    const isUnder = /-\s*\d|under|menos/i.test(line);
    if (side === "over" ? !isOver : !isUnder) continue;
    const lineMatch = line.match(/[+-]?\s*(\d+(?:\.\d+)?)/);
    const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!lineMatch?.[1] || !pctMatch?.[1]) continue;
    values[lineMatch[1]] = Number(pctMatch[1]);
  }
  return values;
}

function extractPreMatchOdds(text: string): Array<{ bookmaker: string; odd: number }> {
  const bookmakers = ["Pinnacle", "1xbet", "Unibet"];
  return bookmakers
    .map((bookmaker) => {
      const match = text.replace(/,/g, ".").match(new RegExp(`${bookmaker}\\s*[:=\\-]?\\s*(\\d+(?:\\.\\d+)?)`, "i"));
      const odd = match?.[1] ? Number(match[1]) : null;
      return odd && Number.isFinite(odd) ? { bookmaker, odd } : null;
    })
    .filter((item): item is { bookmaker: string; odd: number } => Boolean(item));
}

function numberAt(values: number[] | null, index: number): number | null {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberNearTeam(text: string, team: string, label: RegExp): number | null {
  if (!team) return null;
  const teamKey = normalize(team);
  const line = text.split(/\r?\n/).find((item) => normalize(item).includes(teamKey) && label.test(item));
  if (!line) return null;
  return matchNumber(line.replace(/,/g, "."), /(\d+(?:\.\d+)?)/);
}

function countStructuredFields(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? 1 : 0;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countStructuredFields(item), 0);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).reduce<number>((sum, item) => sum + countStructuredFields(item), 0);
  return 0;
}

function buildOcrCriticalMissingFields(
  match: OcrIntelligenceData["match"],
  market: OcrIntelligenceData["market"],
  corners: OcrIntelligenceData["corners"],
  structuredFieldsCount: number,
): string[] {
  const missing: string[] = [];
  if (!match.home_team) missing.push("mandante");
  if (!match.away_team) missing.push("visitante");
  if (!market.name) missing.push("mercado");
  if (!market.pick) missing.push("pick");
  if (!market.offered_odd) missing.push("odd ofertada");
  if (!market.probability_original) missing.push("probabilidade original");
  if (normalize(`${market.name} ${market.pick}`).includes("escanteio") || normalize(`${market.name} ${market.pick}`).includes("corner")) {
    const isTotal = normalize(`${market.name} ${market.pick}`).includes("over") || normalize(`${market.name} ${market.pick}`).includes("under") || normalize(`${market.name} ${market.pick}`).includes("mais de") || normalize(`${market.name} ${market.pick}`).includes("menos de");
    if (!isTotal && !corners.home.race_to_5_pct && !corners.away.race_to_5_pct) missing.push("race_to_5 corners");
    if (isTotal && !Object.keys(corners.home.over_lines).length && !Object.keys(corners.away.over_lines).length) missing.push("percentuais over/under corners");
    if (!corners.home.avg_for) missing.push("corners marcados mandante");
    if (!corners.away.avg_for) missing.push("corners marcados visitante");
    if (!corners.home.avg_against) missing.push("corners sofridos mandante");
    if (!corners.away.avg_against) missing.push("corners sofridos visitante");
  }
  if (structuredFieldsCount < 4) missing.push("dados quantitativos OCR");
  return missing;
}

function calculateOcrDataQualityScore(fieldCount: number, missingCount: number, textVolume: number, hasStructuredData: boolean): number {
  const fieldScore = Math.min(0.5, fieldCount * 0.022);
  const textScore = Math.min(0.2, textVolume / 5000);
  const structuredBonus = hasStructuredData ? 0.2 : 0;
  const penalty = Math.min(0.5, missingCount * 0.08);
  return round(Math.max(0, Math.min(1, 0.1 + fieldScore + textScore + structuredBonus - penalty)), 2);
}

function inferSportFromText(text: string): string {
  const value = normalize(text);
  if (value.includes("escanteio") || value.includes("corner") || value.includes("gol") || value.includes("world cup")) return "Futebol";
  return "";
}

function inferMarketNameFromText(text: string): string {
  const value = normalize(text);
  if (value.includes("escanteio") || value.includes("corner")) return "Escanteios";
  if (value.includes("btts")) return "BTTS";
  if (value.includes("over") || value.includes("under")) return "Over/Under";
  return "";
}

function inferSelectionTeam(pick: string, match: OcrIntelligenceData["match"], text: string): string {
  const pickKey = normalize(pick || text);
  if (match.home_team && pickKey.includes(normalize(match.home_team))) return match.home_team;
  if (match.away_team && pickKey.includes(normalize(match.away_team))) return match.away_team;
  return "";
}

function cleanOcrValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[|•]+/g, "").trim();
}

function normalizeExtractedEv(value: number | null, text: string): number | null {
  if (value === null) return null;
  const source = normalize(text);
  const looksLikePackballDecimal =
    source.includes("packball") ||
    source.includes("chance") ||
    source.includes("odds esperadas") ||
    source.includes("odds oferecidas") ||
    source.includes("base de calculo simples");
  if (looksLikePackballDecimal && value > 5 && value < 100) return round(value / 100, 2);
  return round(value, 2);
}

function matchNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectContentType(category: string, text: string): string {
  const value = normalize(`${category} ${text}`);
  if (value.includes("casa") || value.includes("fora") || value.includes("home") || value.includes("away")) return "home_away_split";
  if (value.includes("ultimo") || value.includes("last") || value.includes("form")) return "recent_form";
  if (value.includes("classificacao") || value.includes("rank") || value.includes("stand")) return "classification_context";
  if (value.includes("corner") || value.includes("escanteio") || value.includes("cartao") || value.includes("card") || value.includes("gol") || value.includes("goal")) {
    return "market_statistics";
  }
  if (value.includes("odd") || value.includes("pick") || value.includes("prob")) return "main_prediction";
  return "general_context";
}

function buildMarketSpecificData(record: ValidatorRecord, uploads: StructuredUpload[], combinedText: string): StructuredValidatorJson["market_specific_data"] {
  const text = normalize(`${record.market} ${record.pick} ${combinedText}`);
  const base = {
    extracted_numbers: extractPercentagesAndNumbers(combinedText),
    related_uploads: uploads.filter((upload) => upload.detected_content_type === "market_statistics").map((upload) => upload.upload_id),
  };
  return {
    goals: text.includes("gol") || text.includes("goal") || text.includes("btts") ? base : {},
    btts: text.includes("btts") || text.includes("ambas") ? base : {},
    corners: text.includes("corner") || text.includes("escanteio") || text.includes("canto") ? base : {},
    cards: text.includes("card") || text.includes("cartao") || text.includes("cartoes") ? base : {},
    handicap: text.includes("handicap") ? base : {},
    double_chance: text.includes("dupla chance") || text.includes("double chance") ? base : {},
    ht_st: text.includes("ht") || text.includes("st") || text.includes("intervalo") ? base : {},
  };
}

function extractPercentagesAndNumbers(text: string): Record<string, string[]> {
  return {
    percentages: [...text.matchAll(/-?\d+(?:[,.]\d+)?\s*%/g)].slice(0, 30).map((match) => match[0]),
    odds: [...text.replace(/,/g, ".").matchAll(/\b[1-9]\d?\.\d{2}\b/g)].slice(0, 30).map((match) => match[0]),
    lines: [...text.replace(/,/g, ".").matchAll(/\b[+-]?\d+(?:\.\d+)?\b/g)].slice(0, 50).map((match) => match[0]),
  };
}

function extractGameLikeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(?:vs| x |@|home|away|casa|fora|w-|l-|win|loss|\d+\s*-\s*\d+)\b/i.test(line))
    .slice(0, 20);
}

function extractGamesForTeam(text: string, team: string): string[] {
  if (!team) return [];
  const teamKey = normalize(team);
  return extractGameLikeLines(text).filter((line) => normalize(line).includes(teamKey)).slice(0, 10);
}

function extractCategoryGames(uploads: StructuredUpload[], category: string, team: string): string[] {
  return uploads
    .filter((upload) => normalize(upload.category).includes(normalize(category)))
    .flatMap((upload) => extractGamesForTeam(upload.ocr_text, team))
    .slice(0, 10);
}

function buildMissingFields(record: ValidatorRecord, uploads: StructuredUpload[], intelligence: OcrIntelligenceData): string[] {
  const missing: string[] = [];
  if (!record.league && !intelligence.match.competition) missing.push("fixture.league");
  if (!record.match_date && !intelligence.match.date) missing.push("fixture.date");
  if (record.offered_odd === null && !intelligence.market.offered_odd) missing.push("prediction.offered_odd");
  if (record.source_probability === null && !intelligence.market.probability_original) missing.push("prediction.source_probability");
  if (record.source_ev === null && intelligence.market.ev_original === null) missing.push("prediction.source_ev");
  if (!uploads.some((upload) => upload.ocr_text.trim())) missing.push("uploads.ocr_text");
  return missing;
}

function buildFieldSources(record: ValidatorRecord, uploads: StructuredUpload[], intelligence: OcrIntelligenceData): Record<string, string> {
  const sources: Record<string, string> = {};
  const hasUploadComment = uploads.some((upload) => upload.comment.trim());
  const hasRawOcr = uploads.some((upload) => upload.ocr_text.trim());
  if (record.league || record.match_date || record.home_team || record.away_team || record.market || record.pick || record.offered_odd !== null) {
    sources.manual_form = "Campos principais informados pelo usuario";
  }
  if (record.user_context?.trim()) sources.user_context = "Contexto geral informado pelo usuario";
  if (hasUploadComment) sources.upload_comment = "Comentarios vinculados aos uploads";
  if (hasRawOcr) sources.raw_ocr = "Texto bruto extraido dos arquivos por OCR";
  if (intelligence.has_structured_ocr_data) {
    sources.ocr_intelligence = intelligence.extracted_from_ocr ? "Parser aplicado ao OCR real" : "Parser aplicado a dados manuais/comentarios";
  }
  return sources;
}

function buildStructuredConflicts(record: ValidatorRecord, inferred: ReturnType<typeof extractPredictionSignals>): string[] {
  const conflicts: string[] = [];
  if (record.offered_odd && inferred.offered_odd && Math.abs(record.offered_odd - inferred.offered_odd) > 0.05) {
    conflicts.push(`Odd manual (${formatOdd(record.offered_odd)}) difere da odd lida no OCR (${formatOdd(inferred.offered_odd)}).`);
  }
  if (record.source_probability && inferred.source_probability && Math.abs(record.source_probability - inferred.source_probability) > 3) {
    conflicts.push(`Probabilidade manual (${formatPercent(record.source_probability)}) difere da probabilidade lida no OCR (${formatPercent(inferred.source_probability)}).`);
  }
  if (record.source_ev !== null && inferred.source_ev !== null && inferred.source_ev !== undefined && Math.abs(record.source_ev - inferred.source_ev) > 3) {
    conflicts.push(`EV manual (${formatPercent(record.source_ev)}) difere do EV lido no OCR (${formatPercent(inferred.source_ev)}).`);
  }
  return conflicts;
}

function buildStructuredNotes(record: ValidatorRecord, uploads: StructuredUpload[], inferred: ReturnType<typeof extractPredictionSignals>): string[] {
  const notes = [
    "Campos manuais possuem prioridade sobre comentarios e OCR.",
    "Parser inicial usa regex simples; revisar manualmente antes de usar em decisao automatizada.",
  ];
  if (record.user_context) notes.push("Contexto manual do usuario incluido como guia interpretativo.");
  if (uploads.some((upload) => upload.comment)) notes.push("Comentarios dos uploads foram considerados para categorizar o material.");
  if (Object.values(inferred).some((value) => value !== null && value !== undefined)) notes.push("Sinais numericos foram extraidos automaticamente do OCR/comentarios.");
  return notes;
}

function extractDataQuality(value: Record<string, unknown> | null): StructuredValidatorJson["data_quality"] | null {
  const dataQuality = value?.data_quality;
  if (!dataQuality || typeof dataQuality !== "object") return null;
  return dataQuality as StructuredValidatorJson["data_quality"];
}

function parseSimulationResult(value: Record<string, unknown> | null): AspValidatorSimulationResult | null {
  if (!value || !Object.keys(value).length) return null;
  const status = typeof value.status === "string" ? value.status : "";
  const model = typeof value.model === "string" ? value.model : "";
  if (!["poisson_score_matrix", "corner_race_simplified", "corner_volume_matrix", "corner_total_over_simplified", "low_confidence_corner_race"].includes(model) || !["completed", "low_confidence", "not_applicable", "failed"].includes(status)) return null;
  return {
    model: model as AspValidatorSimulationResult["model"],
    status: status as AspValidatorSimulationResult["status"],
    lambda_home: typeof value.lambda_home === "number" ? value.lambda_home : null,
    lambda_away: typeof value.lambda_away === "number" ? value.lambda_away : null,
    market_probability: typeof value.market_probability === "number" ? value.market_probability : null,
    fair_odd: typeof value.fair_odd === "number" ? value.fair_odd : null,
    ev: typeof value.ev === "number" ? value.ev : null,
    most_likely_scores: Array.isArray(value.most_likely_scores)
      ? value.most_likely_scores
          .filter((item): item is { score: string; probability: number } => {
            const maybe = item as Record<string, unknown>;
            return typeof maybe.score === "string" && typeof maybe.probability === "number";
          })
          .slice(0, 10)
      : [],
    goal_distribution: value.goal_distribution && typeof value.goal_distribution === "object" ? (value.goal_distribution as Record<string, number>) : {},
    notes: Array.isArray(value.notes) ? value.notes.map(String) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.map(String) : [],
  };
}

type OnlineContextView = {
  status: "completed" | "failed";
  online_summary: string;
  relevant_findings: string[];
  no_relevant_findings: string[];
  contextual_alerts: string[];
  sources: Array<{ title: string; url: string }>;
  searches: string[];
  error?: string;
};

function parseOnlineContext(value: Record<string, unknown> | null): OnlineContextView | null {
  if (!value || !Object.keys(value).length) return null;
  const status = value.status === "completed" ? "completed" : value.status === "failed" ? "failed" : null;
  if (!status) return null;
  return {
    status,
    online_summary:
      typeof value.online_summary === "string"
        ? value.online_summary
        : "Verificacao online sem achados relevantes. Nao ha noticia ou contexto externo suficiente para alterar a analise.",
    relevant_findings: Array.isArray(value.relevant_findings) ? value.relevant_findings.map(String) : [],
    no_relevant_findings: Array.isArray(value.no_relevant_findings) ? value.no_relevant_findings.map(String) : [],
    contextual_alerts: Array.isArray(value.contextual_alerts) ? value.contextual_alerts.map(String) : [],
    sources: Array.isArray(value.sources)
      ? value.sources
          .map((source) => source as Record<string, unknown>)
          .filter((source) => typeof source.url === "string")
          .map((source) => ({ title: String(source.title || source.url), url: String(source.url) }))
      : [],
    searches: Array.isArray(value.searches) ? value.searches.map(String) : [],
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

type SimulationRecordUpdate = {
  simulation_json: AspValidatorSimulationResult;
  simulation_type: string;
  adjusted_probability: number | null;
  adjusted_fair_odd: number | null;
  adjusted_ev: number | null;
};

async function persistSimulationResult(record: ValidatorRecord): Promise<SimulationRecordUpdate> {
  const simulation = runAspValidatorSimulation({
    sport: record.sport,
    market: record.market,
    pick: record.pick,
    line: record.line,
    offered_odd: record.offered_odd,
    home_team: record.home_team,
    away_team: record.away_team,
    user_context: record.user_context,
    structured_json: record.structured_json,
  });
  const adjustedProbability = simulation.market_probability !== null ? round(simulation.market_probability * 100, 2) : record.adjusted_probability;
  const adjustedFairOdd = simulation.fair_odd ?? record.adjusted_fair_odd;
  const adjustedEv = simulation.ev !== null ? round(simulation.ev * 100, 2) : record.adjusted_ev;
  const simulationType = simulation.model !== "poisson_score_matrix"
    ? simulation.model
    : simulation.status === "completed" && simulation.notes.some((note) => normalize(note).includes("simplificada"))
      ? "simplified_ocr"
      : simulation.status;
  const update = {
    simulation_json: simulation,
    simulation_type: simulationType,
    adjusted_probability: adjustedProbability,
    adjusted_fair_odd: adjustedFairOdd,
    adjusted_ev: adjustedEv,
  };
  const { error } = await validatorDb
    .from("asp_validator_registros")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", record.id);
  if (error) throw error;
  return update;
}

async function persistOcrResult(record: ValidatorRecord, allUploads: ValidatorUploadRecord[], upload: ValidatorUploadRecord, result: OcrResultPayload) {
  const { error } = await validatorDb
    .from("asp_validator_uploads")
    .update({
      ocr_status: result.ocr_status,
      ocr_text: result.ocr_text || null,
      ocr_error: result.ocr_error || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", upload.id);
  if (error) throw error;

  const baseUploads = allUploads.length ? allUploads : [upload];
  const nextText = buildCombinedOcrText(updateUploadInList(baseUploads, upload.id, result)).trim();
  const { error: recordError } = await validatorDb
    .from("asp_validator_registros")
    .update({ ocr_raw_text: nextText || null, updated_at: new Date().toISOString() })
    .eq("id", record.id);
  if (recordError) throw recordError;
}

async function persistStructuredOcr(record: ValidatorRecord, uploads: ValidatorUploadRecord[]): Promise<StructuredValidatorJson> {
  await validatorDb
    .from("asp_validator_registros")
    .update({ structured_status: "processing", structured_error: null, updated_at: new Date().toISOString() })
    .eq("id", record.id);

  const recordWithLatestOcr = { ...record, ocr_raw_text: buildCombinedOcrText(uploads) };
  const structured = buildStructuredOcrJson(recordWithLatestOcr, uploads);
  const uploadStructures = structured.uploads.filter((upload) => upload.upload_id);

  for (const upload of uploadStructures) {
    const fieldsCount = countStructuredFields(upload.extracted_data);
    const uploadIntelligence = (upload.extracted_data as { ocr_intelligence?: OcrIntelligenceData }).ocr_intelligence;
    const qualityScore = calculateOcrDataQualityScore(
      fieldsCount,
      uploadIntelligence?.missing_critical_fields.length ?? 0,
      String(upload.ocr_text || "").length,
      Boolean(uploadIntelligence?.has_structured_ocr_data || fieldsCount > 0),
    );
    const { error: uploadError } = await validatorDb
      .from("asp_validator_uploads")
      .update({
        structured_json: upload,
        structured_status: "completed",
        structured_error: null,
        ocr_structured_data: upload.extracted_data,
        ocr_data_quality_score: qualityScore,
        ocr_structured_fields_count: fieldsCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(upload.upload_id));
    if (uploadError) throw uploadError;
  }

  const { error } = await validatorDb
    .from("asp_validator_registros")
    .update({
      ocr_raw_text: recordWithLatestOcr.ocr_raw_text || null,
      structured_json: structured,
      ocr_structured_data: structured,
      ocr_data_quality_score: structured.data_quality_score,
      ocr_structured_fields_count: structured.structured_fields_count,
      structured_status: "completed",
      structured_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.id);
  if (error) throw error;

  return structured;
}

function applyStructuredUploads(uploads: ValidatorUploadRecord[], structured: StructuredValidatorJson): ValidatorUploadRecord[] {
  return uploads.map((upload) => {
    const nextStructured = structured.uploads.find((item) => item.upload_id === upload.id);
    if (!nextStructured) return upload;
    const fieldsCount = countStructuredFields(nextStructured.extracted_data);
    const uploadIntelligence = (nextStructured.extracted_data as { ocr_intelligence?: OcrIntelligenceData }).ocr_intelligence;
    const qualityScore = calculateOcrDataQualityScore(
      fieldsCount,
      uploadIntelligence?.missing_critical_fields.length ?? 0,
      String(nextStructured.ocr_text || "").length,
      Boolean(uploadIntelligence?.has_structured_ocr_data || fieldsCount > 0),
    );
    return {
      ...upload,
      structured_json: nextStructured,
      structured_status: "completed",
      structured_error: null,
      ocr_structured_data: nextStructured.extracted_data,
      ocr_data_quality_score: qualityScore,
      ocr_structured_fields_count: fieldsCount,
    };
  });
}

async function getUploadFileForOcr(upload: ValidatorUploadRecord, localFile?: File): Promise<File> {
  if (localFile) return localFile;
  if (!upload.file_path) {
    throw new Error(
      `Arquivo original nao encontrado no Storage para este upload. file_path=${upload.file_path ?? "null"} bucket=${upload.storage_bucket || ASP_VALIDATOR_UPLOAD_BUCKET}. Reenvie o arquivo ou valide se a migration de Storage foi aplicada.`,
    );
  }
  const bucket = upload.storage_bucket || ASP_VALIDATOR_UPLOAD_BUCKET;
  const { data, error } = await supabase.storage.from(bucket).download(upload.file_path);
  if (error) throw new Error(`Falha ao baixar arquivo do Storage. bucket=${bucket} file_path=${upload.file_path}. ${error.message}`);
  return new File([data], upload.file_name || "asp-validator-upload", {
    type: upload.mime_type || data.type || "application/octet-stream",
  });
}

async function createUploadSignedUrl(upload: ValidatorUploadRecord): Promise<string | null> {
  if (!upload.file_path) return null;
  const bucket = upload.storage_bucket || ASP_VALIDATOR_UPLOAD_BUCKET;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(upload.file_path, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

type OcrResultPayload = {
  ocr_status: "pending" | "processing" | "completed" | "failed";
  ocr_text: string;
  ocr_error: string | null;
};

function parseOcrPayload(payload: unknown): OcrResultPayload {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const status = typeof obj.ocr_status === "string" ? obj.ocr_status : obj.ok ? "completed" : "failed";
  return {
    ocr_status: ["pending", "processing", "completed", "failed"].includes(status) ? (status as OcrResultPayload["ocr_status"]) : "failed",
    ocr_text: typeof obj.ocr_text === "string" ? obj.ocr_text : "",
    ocr_error: typeof obj.ocr_error === "string" ? obj.ocr_error : null,
  };
}

function updateUploadInList(uploads: ValidatorUploadRecord[], uploadId: string, result: OcrResultPayload): ValidatorUploadRecord[] {
  return uploads.map((upload) =>
    upload.id === uploadId
      ? {
          ...upload,
          ocr_status: result.ocr_status,
          ocr_text: result.ocr_text || null,
          ocr_error: result.ocr_error,
        }
      : upload,
  );
}

function buildCombinedOcrText(uploads: ValidatorUploadRecord[]): string {
  return uploads
    .filter((upload) => upload.ocr_text?.trim())
    .map((upload, index) =>
      [
        `[UPLOAD ${index + 1}]`,
        `Tipo: ${upload.upload_category}`,
        `Comentario: ${upload.user_comment || "-"}`,
        "Texto OCR:",
        upload.ocr_text?.trim() || "",
      ].join("\n"),
    )
    .join("\n\n");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",", 2)[1] : value);
    };
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo para OCR."));
    reader.readAsDataURL(file);
  });
}

function groupUploads(uploads: ValidatorUploadRecord[]): Record<string, ValidatorUploadRecord[]> {
  return uploads.reduce<Record<string, ValidatorUploadRecord[]>>((acc, upload) => {
    acc[upload.validator_id] = [...(acc[upload.validator_id] ?? []), upload];
    return acc;
  }, {});
}

function buildEditablePatchFromStructured(record: ValidatorRecord): Partial<Record<keyof EditableRecord, string>> {
  const structured = (record.ocr_structured_data && hasJsonContent(record.ocr_structured_data) ? record.ocr_structured_data : record.structured_json) as
    | StructuredValidatorJson
    | null;
  if (!structured || !hasJsonContent(structured as unknown as Record<string, unknown>)) return {};
  const match = structured.match ?? {};
  const market = structured.market ?? {};
  const prediction = structured.prediction ?? {};
  const league = [readStringValue(match.competition), readStringValue(match.round)].filter(Boolean).join(" - ");
  const matchDate = parseOcrDateToInput(readStringValue(match.date || structured.fixture?.date));
  const platform = readStringValue(structured.source_platform) || inferSourcePlatformFromStructured(structured);
  const sourceProbability = readNumberLike(market.probability_original ?? prediction.source_probability);
  const sourceEv = readNumberLike(market.ev_original ?? prediction.source_ev);
  const sourceFairOdd = readNumberLike(market.fair_odd_original ?? prediction.source_fair_odd);
  const offeredOdd = readNumberLike(market.offered_odd ?? prediction.offered_odd);
  const line = market.line ?? prediction.line;

  return {
    sport: readStringValue(match.sport || structured.sport),
    source_platform: platform,
    league,
    match_date: matchDate,
    home_team: readStringValue(match.home_team || structured.fixture?.home_team),
    away_team: readStringValue(match.away_team || structured.fixture?.away_team),
    market: readStringValue(market.name || prediction.market),
    pick: readStringValue(market.pick || prediction.pick),
    line: line === null || line === undefined ? "" : String(line),
    offered_odd: numberToInput(offeredOdd),
    source_probability: numberToInput(sourceProbability),
    source_fair_odd: numberToInput(sourceFairOdd),
    source_ev: numberToInput(sourceEv),
    user_context: "",
  };
}

function readStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function readNumberLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseNumber(value);
  return null;
}

function parseOcrDateToInput(value: string): string {
  const text = value.trim();
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return "";
}

function inferSourcePlatformFromStructured(structured: StructuredValidatorJson): string {
  const text = normalize(`${structured.raw_ocr_text || ""} ${JSON.stringify(structured.packball_recommendation ?? {})}`);
  if (text.includes("packball")) return "PackBall";
  if (text.includes("flashscore")) return "Flashscore";
  return "";
}

function recordToEditable(record: ValidatorRecord): EditableRecord {
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

function recordToResultForm(record: ValidatorRecord, defaultUnitValue: number): ResultForm {
  return {
    result_status: record.result_status || "GREEN",
    final_odd: numberToInput(record.offered_odd),
    stake_units: numberToInput(record.stake_units ?? (record.decision === "PULAR" ? 1 : null)),
    unit_value_brl: numberToInput(record.unit_value_brl ?? defaultUnitValue),
    clv: numberToInput(record.clv),
    final_score: record.final_score ?? "",
    result_notes: record.result_notes ?? "",
    result_settled_at: record.result_settled_at ?? new Date().toISOString().slice(0, 10),
  };
}

function calculateValidatorProfitUnits(status: string, stake: number, odd: number): number {
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

function buildDashboardOptions(records: ValidatorRecord[]) {
  const unique = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
  return {
    sports: unique(records.map((record) => record.sport)),
    leagues: unique(records.map((record) => record.league)),
    platforms: unique(records.map((record) => record.source_platform)),
    models: unique(records.map((record) => record.validator_model)),
    markets: unique(records.map((record) => record.market)),
  };
}

function filterDashboardRecords(records: ValidatorRecord[], filters: ValidatorDashboardFilters): ValidatorRecord[] {
  const minDate = getDashboardMinDate(filters.period);
  return records.filter((record) => {
    const date = record.result_settled_at || record.match_date || record.created_at.slice(0, 10);
    if (minDate && date < minDate) return false;
    if (filters.sport !== "all" && record.sport !== filters.sport) return false;
    if (filters.league !== "all" && record.league !== filters.league) return false;
    if (filters.source_platform !== "all" && record.source_platform !== filters.source_platform) return false;
    if (filters.validator_model !== "all" && record.validator_model !== filters.validator_model) return false;
    if (filters.market !== "all" && record.market !== filters.market) return false;
    if (filters.decision !== "all" && record.decision !== filters.decision) return false;
    if (filters.result !== "all") {
      const result = record.result_status || "PENDENTE";
      if (result !== filters.result) return false;
    }
    return true;
  });
}

function getDashboardMinDate(period: ValidatorDashboardFilters["period"]): string | null {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "all") return null;
  if (period === "7d") date.setDate(date.getDate() - 6);
  if (period === "30d") date.setDate(date.getDate() - 29);
  if (period === "month") date.setDate(1);
  if (period === "year") {
    date.setMonth(0);
    date.setDate(1);
  }
  return date.toISOString().slice(0, 10);
}

function calculateValidatorDashboardStats(records: ValidatorRecord[]): DashboardStats {
  const confirmed = records.filter((record) => record.decision === "CONFIRMAR" && record.bankroll_applied && !record.is_simulated_result);
  const skipped = records.filter((record) => record.decision === "PULAR" && record.is_simulated_result);
  const confirmedResolved = confirmed.filter(isResolvedResult);
  const confirmedStake = confirmedResolved.reduce((sum, record) => sum + Number(record.stake_units ?? 0), 0);
  const confirmedProfitUnits = confirmed.reduce((sum, record) => sum + Number(record.profit_units ?? 0), 0);
  const confirmedProfitBrl = confirmed.reduce((sum, record) => sum + Number(record.profit_brl ?? 0), 0);
  const confirmedGreen = confirmed.filter((record) => record.result_status === "GREEN").length;
  const confirmedRed = confirmed.filter((record) => record.result_status === "RED").length;
  const skippedGreen = skipped.filter((record) => record.result_status === "GREEN").length;
  const skippedRed = skipped.filter((record) => record.result_status === "RED").length;
  const skippedResolved = skipped.filter(isResolvedResult);
  return {
    total: records.length,
    confirmed: records.filter((record) => record.decision === "CONFIRMAR").length,
    skipped: records.filter((record) => record.decision === "PULAR").length,
    confirmedGreen,
    confirmedRed,
    confirmedRoi: confirmedStake > 0 ? (confirmedProfitUnits / confirmedStake) * 100 : 0,
    confirmedYield: confirmedStake > 0 ? (confirmedProfitUnits / confirmedStake) * 100 : 0,
    confirmedProfitUnits,
    confirmedProfitBrl,
    confirmedWinRate: confirmedResolved.length ? (confirmedGreen / confirmedResolved.length) * 100 : 0,
    skippedGreen,
    skippedRed,
    skipAccuracy: skippedResolved.length ? (skippedRed / skippedResolved.length) * 100 : 0,
  };
}

function groupValidatorRecords(records: ValidatorRecord[], keyFn: (record: ValidatorRecord) => string): GroupRow[] {
  const map = new Map<string, ValidatorRecord[]>();
  for (const record of records) {
    const key = keyFn(record) || "-";
    map.set(key, [...(map.get(key) ?? []), record]);
  }
  return Array.from(map.entries())
    .map(([label, rows]) => {
      const resolved = rows.filter((row) => isResolvedResult(row));
      const green = rows.filter((row) => row.result_status === "GREEN").length;
      const red = rows.filter((row) => row.result_status === "RED").length;
      const pushVoid = rows.filter((row) => row.result_status === "PUSH" || row.result_status === "VOID").length;
      const stake = resolved.reduce((sum, row) => sum + Number(row.stake_units ?? (row.decision === "PULAR" ? 1 : 0)), 0);
      const profitUnits = rows.reduce((sum, row) => sum + Number(row.profit_units ?? 0), 0);
      const profitBrl = rows.reduce((sum, row) => sum + Number(row.profit_brl ?? 0), 0);
      const odds = rows.map((row) => Number(row.offered_odd ?? 0)).filter((value) => value > 0);
      const probs = rows.map((row) => Number(row.adjusted_probability ?? 0)).filter((value) => value > 0);
      return {
        label,
        total: rows.length,
        green,
        red,
        pushVoid,
        winRate: resolved.length ? (green / resolved.length) * 100 : 0,
        profitUnits,
        profitBrl,
        roi: stake > 0 ? (profitUnits / stake) * 100 : 0,
        averageOdd: odds.length ? average(odds) : 0,
        averageProbability: probs.length ? average(probs) : 0,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
}

function isResolvedResult(record: ValidatorRecord): boolean {
  return record.result_status === "GREEN" || record.result_status === "RED";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}`;
}

function hasJsonContent(value: Record<string, unknown> | null): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

function parseNumber(value: string): number | null {
  const clean = String(value || "").replace("%", "").replace(",", ".").trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProbability(value: number | null): number | null {
  if (value === null) return null;
  if (value > 0 && value <= 1) return round(value * 100, 2);
  return round(Math.max(0, Math.min(100, value)), 2);
}

function normalizeSourceEv(value: number | null, sourcePlatform?: string | null): number | null {
  if (value === null) return null;
  const platform = normalize(sourcePlatform || "");
  // PackBall: EV vem como inteiro percentual (ex.: 18 = 0.18%, 41 = 0.41%).
  // Se o usuario digitar 0.18 mantemos. Threshold > 1 cobre 18, 41, etc.
  if (platform.includes("packball") && value > 1 && value < 100) return round(value / 100, 2);
  return round(value, 2);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${round(value, 2).toFixed(2)}%`;
}

function formatDecimalProbability(value: number | null): string {
  return value === null ? "-" : `${round(value * 100, 2).toFixed(2)}%`;
}

function formatDecimalEv(value: number | null): string {
  return value === null ? "-" : `${round(value * 100, 2).toFixed(2)}%`;
}

function formatOdd(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "-" : round(value, 2).toFixed(2);
}

function numberToInput(value: number | null): string {
  return value === null || value === undefined ? "" : String(value);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${round(bytes / 1024 ** index, index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatUploadSource(source?: string | null): string {
  if (source === "clipboard") return "CTRL+V";
  if (source === "drag_drop") return "drag/drop";
  if (source === "manual") return "upload manual";
  return "nao informado";
}

function buildStoragePath(userId: string, validatorId: string, uploadId: string, fileName: string): string {
  const cleanName = (fileName || "upload")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "upload";
  return `${userId}/${validatorId}/${uploadId}/${cleanName}`;
}
