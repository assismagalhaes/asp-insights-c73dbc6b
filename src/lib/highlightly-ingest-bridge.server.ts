import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const HIGHLIGHTLY_BRIDGE_VERSION = "v1";
export const HIGHLIGHTLY_BRIDGE_MAX_SKEW_SECONDS = 300;
export const HIGHLIGHTLY_BRIDGE_MAX_BODY_BYTES = 26_214_400;

const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "application/json",
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream",
]);
const ALLOWED_PREFER = new Set([
  "",
  "return=representation",
  "resolution=merge-duplicates,return=representation",
]);
const PATCHABLE_TABLES = new Set([
  "sports_providers",
  "hl_ingestion_runs",
  "hl_raw_objects",
  "hl_shadow_windows",
  "hl_shadow_observations",
  "hl_source_reconciliations",
]);

export const HIGHLIGHTLY_BRIDGE_TABLES = new Set([
  "sports_providers",
  "sports",
  "sports_countries",
  "sports_competitions",
  "sports_seasons",
  "sports_teams",
  "sports_players",
  "sports_bookmakers",
  "sports_matches",
  "sports_match_participants",
  "sports_match_period_scores",
  "sports_provider_entities",
  "hl_metric_definitions",
  "sports_market_definitions",
  "sports_lineups",
  "sports_lineup_players",
  "sports_match_team_stats",
  "sports_team_season_stats",
  "sports_player_stats",
  "sports_player_box_scores",
  "sports_match_events",
  "sports_standings_snapshots",
  "sports_highlights",
  "sports_odds_current",
  "sports_odds_history",
  "sports_odds_consensus",
  "hl_ingestion_jobs",
  "hl_ingestion_runs",
  "hl_raw_objects",
  "hl_rate_limit_usage",
  "hl_data_quality_issues",
  "hl_shadow_windows",
  "hl_shadow_observations",
  "hl_source_reconciliations",
  "hl_phase7_window_health_v",
]);

export const HIGHLIGHTLY_BRIDGE_RPCS = new Set([
  "enqueue_highlightly_ingestion_job",
  "claim_highlightly_ingestion_job",
  "finish_highlightly_ingestion_job",
  "upsert_sports_odds_quote",
  "upsert_sports_odds_quotes",
  "refresh_sports_odds_consensus",
  "refresh_highlightly_shadow_observation",
  "refresh_highlightly_source_reconciliation",
  "cancel_highlightly_redundant_shadow_jobs",
  "get_highlightly_daily_request_usage",
]);

export type HighlightlyBridgeTarget = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  contentType: string;
  prefer: string;
  upsert: string;
};

export type HighlightlyBridgeAuth = HighlightlyBridgeTarget & {
  nonce: string;
  signedAt: Date;
  requestHash: string;
};

function header(request: Request, name: string): string {
  return (request.headers.get(name) ?? "").trim();
}

export function buildHighlightlyBridgeSignatureInput(
  timestamp: string,
  nonce: string,
  target: HighlightlyBridgeTarget,
  body: Uint8Array,
): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return [
    HIGHLIGHTLY_BRIDGE_VERSION,
    timestamp,
    nonce,
    target.method,
    target.path,
    `content-type:${target.contentType}`,
    `prefer:${target.prefer}`,
    `x-upsert:${target.upsert}`,
    bodyHash,
  ].join("\n");
}

function authorizeTarget(request: Request): HighlightlyBridgeTarget {
  const method = header(request, "x-highlightly-forward-method").toUpperCase();
  const path = header(request, "x-highlightly-forward-path");
  const contentType = header(request, "x-highlightly-forward-content-type").toLowerCase();
  const prefer = header(request, "x-highlightly-forward-prefer");
  const upsert = header(request, "x-highlightly-forward-x-upsert").toLowerCase();

  if (!ALLOWED_METHODS.has(method)) throw new Error("forward_method_not_allowed");
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 8_192) {
    throw new Error("forward_path_invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(path, "https://highlightly-bridge.invalid");
  } catch {
    throw new Error("forward_path_invalid");
  }
  if (parsed.origin !== "https://highlightly-bridge.invalid") {
    throw new Error("forward_path_invalid");
  }
  if (parsed.hash) throw new Error("forward_path_invalid");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error("forward_path_invalid");
  }
  if (decodedPath.includes("\\") || decodedPath.split("/").includes("..")) {
    throw new Error("forward_path_invalid");
  }
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error("forward_content_type_not_allowed");
  }
  if (!ALLOWED_PREFER.has(prefer)) throw new Error("forward_prefer_not_allowed");
  if (upsert && upsert !== "true") throw new Error("forward_upsert_not_allowed");

  const rpcMatch = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(parsed.pathname);
  const tableMatch = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(parsed.pathname);
  const rawObjectPrefix = "/storage/v1/object/highlightly-raw/";
  const isAllowed = rpcMatch
    ? method === "POST" && !parsed.search && HIGHLIGHTLY_BRIDGE_RPCS.has(rpcMatch[1])
    : tableMatch
      ? HIGHLIGHTLY_BRIDGE_TABLES.has(tableMatch[1]) &&
        (method !== "PATCH" || PATCHABLE_TABLES.has(tableMatch[1]))
      : parsed.pathname.startsWith(rawObjectPrefix) &&
        parsed.pathname.length > rawObjectPrefix.length &&
        !parsed.search &&
        (method === "GET" || method === "POST");
  if (!isAllowed) throw new Error("forward_target_not_allowed");

  return { method: method as HighlightlyBridgeTarget["method"], path, contentType, prefer, upsert };
}

export function verifyHighlightlyBridgeRequest(
  request: Request,
  body: Uint8Array,
  secret: string,
  now = new Date(),
): HighlightlyBridgeAuth {
  if (secret.length < 32) throw new Error("bridge_secret_not_configured");
  if (body.byteLength > HIGHLIGHTLY_BRIDGE_MAX_BODY_BYTES) throw new Error("body_too_large");

  const version = header(request, "x-highlightly-bridge-version");
  const timestamp = header(request, "x-highlightly-timestamp");
  const nonce = header(request, "x-highlightly-nonce");
  const suppliedSignature = header(request, "x-highlightly-signature").toLowerCase();
  if (version !== HIGHLIGHTLY_BRIDGE_VERSION) throw new Error("bridge_version_invalid");
  if (!/^\d{10}$/.test(timestamp)) throw new Error("timestamp_invalid");
  if (!NONCE_PATTERN.test(nonce)) throw new Error("nonce_invalid");
  if (!SIGNATURE_PATTERN.test(suppliedSignature)) throw new Error("signature_invalid");

  const signedAt = new Date(Number(timestamp) * 1_000);
  if (
    !Number.isFinite(signedAt.getTime()) ||
    Math.abs(now.getTime() - signedAt.getTime()) > HIGHLIGHTLY_BRIDGE_MAX_SKEW_SECONDS * 1_000
  ) {
    throw new Error("timestamp_expired");
  }

  const target = authorizeTarget(request);
  const signatureInput = buildHighlightlyBridgeSignatureInput(timestamp, nonce, target, body);
  const expectedSignature = createHmac("sha256", secret).update(signatureInput).digest();
  const supplied = Buffer.from(suppliedSignature, "hex");
  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    throw new Error("signature_mismatch");
  }

  return {
    ...target,
    nonce,
    signedAt,
    requestHash: createHash("sha256").update(signatureInput).digest("hex"),
  };
}
