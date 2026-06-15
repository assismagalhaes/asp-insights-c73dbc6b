import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/lib/auth-middleware-public";

const JobParamsSchema = z.object({
  esporte: z.string().min(1),
  liga: z.string().min(1),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mercados: z.array(z.string().min(1)).min(1),
});

const JobIdSchema = z.object({
  job_id: z.string().min(1),
});

type ScraperPayload = Record<string, unknown>;
type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

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

const EXPECTED_JOB_PAYLOAD = {
  esporte: "Baseball",
  liga: "MLB",
  data_inicio: "2026-06-13",
  data_fim: "2026-06-13",
  mercados: ["Moneyline", "Total de Corridas"],
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
        res.status === 422
          ? `HTTP 422 ao chamar API da VM (${path}). Payload enviado: ${requestBody}. JSON esperado: ${stringifyDebug(EXPECTED_JOB_PAYLOAD)}. Resposta da VM: ${stringifyDebug(payload)}`
          : payload && typeof payload === "object" && "message" in payload
            ? String((payload as ScraperPayload).message)
            : `Erro HTTP ${res.status} ao chamar API da VM. Resposta: ${stringifyDebug(payload)}`;
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
