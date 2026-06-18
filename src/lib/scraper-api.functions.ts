import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";

const JobParamsSchema = z
  .object({
    esporte: z.string().min(1).optional(),
    sport: z.string().min(1).optional(),
    leagues: z.array(z.string().min(1)).optional().default([]),
    liga: z.string().optional(),
    data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .transform((data) => ({
    esporte: data.esporte ?? data.sport,
    leagues: data.leagues ?? [],
    data_inicio: data.data_inicio,
    data_fim: data.data_fim,
  }))
  .refine((data) => Boolean(data.esporte), { message: "esporte e obrigatorio" });

const JobIdSchema = z.object({
  job_id: z.string().min(1),
});

const PredictiveModelSchema = z.object({
  job_id: z.string().min(1),
  modelo: z.enum(["Futebol", "Baseball"]),
});

const EmptySchema = z.object({}).optional().default({});

const BaseballYearSchema = z.object({
  ano: z.number().int().min(2000).max(2100),
});

const BaseballTeamLinesSchema = BaseballYearSchema.extend({
  sigla: z.string().min(1),
  limite: z.number().int().min(1).max(100).optional().default(10),
});

const BaseballLineSchema = BaseballYearSchema.extend({
  sigla: z.string().min(1),
  linha: z.array(z.string()).min(1, "linha e obrigatoria"),
});

const BaseDataSchema = z.object({
  esporte: z.enum(["baseball", "basketball"]),
  liga: z.enum(["mlb", "nba", "wnba"]),
});

const BaseDataYearSchema = BaseDataSchema.extend({
  ano: z.number().int().min(2000).max(2100),
});

const BaseDataTeamLinesSchema = BaseDataYearSchema.extend({
  sigla: z.string().min(1),
  limite: z.number().int().min(1).max(100).optional().default(10),
});

const BaseDataLineSchema = BaseDataYearSchema.extend({
  sigla: z.string().min(1),
  linha: z.union([z.string().min(1), z.array(z.string()).min(1)]),
});

const CreateBaseSeasonSchema = BaseDataSchema.extend({
  ano_destino: z.number().int().min(2000).max(2100),
  ano_origem: z.number().int().min(2000).max(2100).optional(),
});

type ScraperPayload = Record<string, unknown>;
type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

function normalizeMlbSigla(sigla: string) {
  const value = sigla.toUpperCase().trim();
  return value === "OAK" ? "ATH" : value;
}

function isBaseballBase(data: { esporte: string; liga: string }) {
  return data.esporte === "baseball" && data.liga === "mlb";
}

function basketballBaseUnavailable(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|404|erro http 404/i.test(message)) {
    throw new Error("A API da VM nao encontrou a rota de Basketball solicitada. Verifique se os endpoints /modelos/base/basketball/{liga}/... estao publicados.");
  }
  throw error;
}

function getScraperConfig() {
  const baseUrl = process.env.SCRAPER_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.SCRAPER_API_KEY;
  if (!baseUrl) throw new Error("SCRAPER_API_URL não configurada no servidor.");
  if (!apiKey) throw new Error("SCRAPER_API_KEY não configurada no servidor.");
  return { baseUrl, apiKey };
}

function pickPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const obj = payload as ScraperPayload;
  return obj.data ?? obj.result ?? obj.raw_json ?? obj.normalized_json ?? payload;
}

function stringifyDebug(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pickErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as ScraperPayload;
  const value = obj.message ?? obj.error ?? obj.detail;

  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const issue = item as ScraperPayload;
        const loc = Array.isArray(issue.loc) ? issue.loc.join(".") : null;
        const msg = typeof issue.msg === "string" ? issue.msg : stringifyDebug(issue);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join("; ");
  }
  if (value && typeof value === "object") {
    const nested = value as ScraperPayload;
    if (typeof nested.mensagem === "string") return nested.mensagem;
    if (typeof nested.erro === "string") return nested.erro;
    return stringifyDebug(value);
  }

  return null;
}

const EXPECTED_JOB_PAYLOAD = {
  esporte: "Football",
  leagues: [
    "https://www.flashscore.com/football/brazil/serie-a-betano/fixtures/",
    "https://www.flashscore.com/football/england/premier-league/fixtures/",
  ],
  data_inicio: "2026-06-13",
  data_fim: "2026-06-13",
};

function extractJobId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Resposta da VM não trouxe job_id.");
  }
  const obj = payload as ScraperPayload;
  const nested = typeof obj.data === "object" && obj.data ? (obj.data as ScraperPayload) : null;
  const value = obj.job_id ?? obj.jobId ?? obj.id ?? nested?.job_id ?? nested?.jobId ?? nested?.id;
  if (!value) throw new Error("Resposta da VM não trouxe job_id.");
  return String(value);
}

async function scraperRequest(path: string, init?: RequestInit) {
  const { baseUrl, apiKey } = getScraperConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }
    if (!res.ok) {
      const requestBody =
        typeof init?.body === "string" ? init.body : init?.body ? "[body não textual]" : "(sem body)";
      console.error("[Scraper API] Erro na chamada", {
        status: res.status,
        path,
        requestBody,
        response: payload,
        expectedPayload: EXPECTED_JOB_PAYLOAD,
      });
      const message =
        res.status === 422 && path === "/scraping/jobs"
          ? `HTTP 422 ao chamar API da VM (${path}). Payload enviado: ${requestBody}. JSON esperado: ${stringifyDebug(EXPECTED_JOB_PAYLOAD)}. Resposta da VM: ${stringifyDebug(payload)}`
          : pickErrorMessage(payload) ?? `Erro HTTP ${res.status} ao chamar API da VM. Resposta: ${stringifyDebug(payload)}`;
      throw new Error(message);
    }
    return payload;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Timeout ao chamar API da VM.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function scraperTextRequest(path: string) {
  const { baseUrl, apiKey } = getScraperConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("[Scraper API] Erro ao baixar CSV", {
        status: res.status,
        path,
        response: text,
      });
      throw new Error(`Erro HTTP ${res.status} ao baixar CSV da VM. Resposta: ${text}`);
    }
    return text;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Timeout ao baixar CSV da VM.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const createScrapingJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobParamsSchema.parse(input))
  .handler(async ({ data }) => {
    const payload = await scraperRequest("/scraping/jobs", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return {
      job_id: extractJobId(payload),
      payload: payload as JsonValue,
    };
  });

export const getScrapingJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobIdSchema.parse(input))
  .handler(async ({ data }) => {
    const payload = await scraperRequest(`/scraping/jobs/${encodeURIComponent(data.job_id)}/status`);
    return {
      job_id: data.job_id,
      payload: payload as JsonValue,
    };
  });

export const getScrapingJobRaw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobIdSchema.parse(input))
  .handler(async ({ data }) => {
    const payload = await scraperRequest(`/scraping/jobs/${encodeURIComponent(data.job_id)}/raw`);
    return {
      job_id: data.job_id,
      raw_json: pickPayload(payload) as JsonValue,
      payload: payload as JsonValue,
    };
  });

export const getScrapingJobNormalized = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobIdSchema.parse(input))
  .handler(async ({ data }) => {
    const payload = await scraperRequest(`/scraping/jobs/${encodeURIComponent(data.job_id)}/normalized`);
    return {
      job_id: data.job_id,
      normalized_json: pickPayload(payload) as JsonValue,
      payload: payload as JsonValue,
    };
  });

export const getScrapingJobCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobIdSchema.parse(input))
  .handler(async ({ data }) => {
    const csv = await scraperTextRequest(`/scraping/jobs/${encodeURIComponent(data.job_id)}/csv`);
    return {
      job_id: data.job_id,
      csv,
    };
  });

export const executePredictiveModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PredictiveModelSchema.parse(input))
  .handler(async ({ data }) => {
    const endpointByModel: Record<string, string> = {
      Futebol: "/modelos/futebol/executar",
      Baseball: "/modelos/baseball/executar",
    };
    const path = endpointByModel[data.modelo];
    try {
      const payload = await scraperRequest(path, {
        method: "POST",
        body: JSON.stringify({ job_id: data.job_id }),
      });
      return payload as JsonValue;
    } catch (e) {
      const message = (e as Error).message;
      if (/404|failed to fetch|network|conex/i.test(message)) {
        throw new Error("O endpoint de execução do modelo ainda não está disponível na VM.");
      }
      throw e;
    }
  });

export const getBaseballYears = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EmptySchema.parse(input))
  .handler(async () => {
    return pickPayload(await scraperRequest("/modelos/baseball/anos")) as JsonValue;
  });

export const getBaseballTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseballYearSchema.parse(input))
  .handler(async ({ data }) => {
    return pickPayload(await scraperRequest(`/modelos/baseball/times?ano=${encodeURIComponent(String(data.ano))}`)) as JsonValue;
  });

export const getBaseballTeamLastLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseballTeamLinesSchema.parse(input))
  .handler(async ({ data }) => {
    const sigla = normalizeMlbSigla(data.sigla);
    return pickPayload(await scraperRequest(
      `/modelos/baseball/time/${encodeURIComponent(sigla)}/ultimas-linhas?ano=${encodeURIComponent(String(data.ano))}&limite=${encodeURIComponent(String(data.limite))}`,
    )) as JsonValue;
  });

export const validateBaseballLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseballLineSchema.parse(input))
  .handler(async ({ data }) => {
    return (await scraperRequest("/modelos/baseball/base/validar-linha", {
      method: "POST",
      body: JSON.stringify({ ...data, sigla: normalizeMlbSigla(data.sigla) }),
    })) as JsonValue;
  });

export const addBaseballLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseballLineSchema.parse(input))
  .handler(async ({ data }) => {
    return (await scraperRequest("/modelos/baseball/base/adicionar", {
      method: "POST",
      body: JSON.stringify({ ...data, sigla: normalizeMlbSigla(data.sigla) }),
    })) as JsonValue;
  });

export const removeBaseballLastLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseballYearSchema.extend({ sigla: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    return (await scraperRequest("/modelos/baseball/base/remover-ultima", {
      method: "POST",
      body: JSON.stringify({ ...data, sigla: normalizeMlbSigla(data.sigla) }),
    })) as JsonValue;
  });

export const getBaseYears = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseDataSchema.parse(input))
  .handler(async ({ data }) => {
    if (isBaseballBase(data)) {
      return pickPayload(await scraperRequest("/modelos/baseball/anos")) as JsonValue;
    }
    try {
      return pickPayload(await scraperRequest(`/modelos/base/basketball/${encodeURIComponent(data.liga)}/anos`)) as JsonValue;
    } catch (error) {
      basketballBaseUnavailable(error);
    }
  });

export const getBaseTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseDataYearSchema.parse(input))
  .handler(async ({ data }) => {
    if (isBaseballBase(data)) {
      return pickPayload(await scraperRequest(`/modelos/baseball/times?ano=${encodeURIComponent(String(data.ano))}`)) as JsonValue;
    }
    try {
      return pickPayload(await scraperRequest(
        `/modelos/base/basketball/${encodeURIComponent(data.liga)}/${encodeURIComponent(String(data.ano))}/times`,
      )) as JsonValue;
    } catch (error) {
      basketballBaseUnavailable(error);
    }
  });

export const getBaseTeamLastLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseDataTeamLinesSchema.parse(input))
  .handler(async ({ data }) => {
    if (isBaseballBase(data)) {
      const sigla = normalizeMlbSigla(data.sigla);
      return pickPayload(await scraperRequest(
        `/modelos/baseball/time/${encodeURIComponent(sigla)}/ultimas-linhas?ano=${encodeURIComponent(String(data.ano))}&limite=${encodeURIComponent(String(data.limite))}`,
      )) as JsonValue;
    }
    try {
      return pickPayload(await scraperRequest(
        `/modelos/base/basketball/${encodeURIComponent(data.liga)}/${encodeURIComponent(String(data.ano))}/${encodeURIComponent(data.sigla.toLowerCase())}/ultimas`,
      )) as JsonValue;
    } catch (error) {
      basketballBaseUnavailable(error);
    }
  });

export const validateBaseLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseDataLineSchema.parse(input))
  .handler(async ({ data }) => {
    if (isBaseballBase(data)) {
      return (await scraperRequest("/modelos/baseball/base/validar-linha", {
        method: "POST",
        body: JSON.stringify({ ano: data.ano, sigla: normalizeMlbSigla(data.sigla), linha: data.linha }),
      })) as JsonValue;
    }
    try {
      return (await scraperRequest(`/modelos/base/basketball/${encodeURIComponent(data.liga)}/${encodeURIComponent(String(data.ano))}/${encodeURIComponent(data.sigla.toLowerCase())}/validar`, {
        method: "POST",
        body: JSON.stringify({ linha: data.linha }),
      })) as JsonValue;
    } catch (error) {
      basketballBaseUnavailable(error);
    }
  });

export const addBaseLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseDataLineSchema.parse(input))
  .handler(async ({ data }) => {
    if (isBaseballBase(data)) {
      return (await scraperRequest("/modelos/baseball/base/adicionar", {
        method: "POST",
        body: JSON.stringify({ ano: data.ano, sigla: normalizeMlbSigla(data.sigla), linha: data.linha }),
      })) as JsonValue;
    }
    try {
      return (await scraperRequest(`/modelos/base/basketball/${encodeURIComponent(data.liga)}/${encodeURIComponent(String(data.ano))}/${encodeURIComponent(data.sigla.toLowerCase())}/adicionar`, {
        method: "POST",
        body: JSON.stringify({ linha: data.linha }),
      })) as JsonValue;
    } catch (error) {
      basketballBaseUnavailable(error);
    }
  });

export const removeBaseLastLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BaseDataYearSchema.extend({ sigla: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    if (isBaseballBase(data)) {
      return (await scraperRequest("/modelos/baseball/base/remover-ultima", {
        method: "POST",
        body: JSON.stringify({ ano: data.ano, sigla: normalizeMlbSigla(data.sigla) }),
      })) as JsonValue;
    }
    try {
      return (await scraperRequest(`/modelos/base/basketball/${encodeURIComponent(data.liga)}/${encodeURIComponent(String(data.ano))}/${encodeURIComponent(data.sigla.toLowerCase())}/remover-ultima`, {
        method: "POST",
        body: JSON.stringify({}),
      })) as JsonValue;
    } catch (error) {
      basketballBaseUnavailable(error);
    }
  });

export const createBaseSeason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateBaseSeasonSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const path = data.esporte === "basketball"
        ? `/modelos/base/basketball/${encodeURIComponent(data.liga)}/${encodeURIComponent(String(data.ano_destino))}/temporada`
        : "/modelos/base/criar-temporada";
      const body = data.esporte === "basketball"
        ? { ano_origem: data.ano_origem, ano_destino: data.ano_destino }
        : data;
      return (await scraperRequest(path, {
        method: "POST",
        body: JSON.stringify(body),
      })) as JsonValue;
    } catch (error) {
      if (data.esporte === "basketball") basketballBaseUnavailable(error);
      throw error;
    }
  });
