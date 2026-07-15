import { createFileRoute } from "@tanstack/react-router";
import {
  HIGHLIGHTLY_BRIDGE_MAX_BODY_BYTES,
  verifyHighlightlyBridgeRequest,
} from "@/lib/highlightly-ingest-bridge.server";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/hooks/highlightly-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
        const bridgeSecret = (process.env.HIGHLIGHTLY_INGEST_BRIDGE_SECRET ?? "").trim();
        if (!supabaseUrl || !serviceRoleKey || bridgeSecret.length < 32) {
          return jsonError(503, "bridge_not_configured");
        }

        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > HIGHLIGHTLY_BRIDGE_MAX_BODY_BYTES) {
          return jsonError(413, "body_too_large");
        }

        let body: Uint8Array;
        try {
          body = new Uint8Array(await request.arrayBuffer());
        } catch {
          return jsonError(400, "body_unreadable");
        }

        let auth;
        try {
          auth = verifyHighlightlyBridgeRequest(request, body, bridgeSecret);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "request_invalid";
          const status = reason === "body_too_large" ? 413 : 401;
          return jsonError(status, reason);
        }

        const serviceHeaders = {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
        };
        const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
        let claimResponse: Response;
        try {
          claimResponse = await fetch(
            `${supabaseUrl}/rest/v1/rpc/claim_highlightly_ingestion_bridge_nonce`,
            {
              method: "POST",
              headers: serviceHeaders,
              body: JSON.stringify({
                p_nonce: auth.nonce,
                p_request_hash: auth.requestHash,
                p_signed_at: auth.signedAt.toISOString(),
                p_expires_at: expiresAt,
              }),
            },
          );
        } catch {
          return jsonError(503, "nonce_store_unavailable");
        }
        if (!claimResponse.ok) return jsonError(503, "nonce_store_unavailable");
        let claimed = false;
        try {
          claimed = (await claimResponse.json()) === true;
        } catch {
          return jsonError(503, "nonce_store_invalid_response");
        }
        if (!claimed) return jsonError(409, "request_replayed");

        const forwardHeaders: Record<string, string> = {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        };
        if (auth.contentType) forwardHeaders["content-type"] = auth.contentType;
        if (auth.prefer) forwardHeaders.prefer = auth.prefer;
        if (auth.upsert) forwardHeaders["x-upsert"] = auth.upsert;

        let upstream: Response;
        try {
          const forwardBody = new ArrayBuffer(body.byteLength);
          new Uint8Array(forwardBody).set(body);
          upstream = await fetch(`${supabaseUrl}${auth.path}`, {
            method: auth.method,
            headers: forwardHeaders,
            body: auth.method === "GET" ? undefined : forwardBody,
          });
        } catch {
          return jsonError(502, "supabase_unavailable");
        }
        const responseHeaders: Record<string, string> = { "cache-control": "no-store" };
        const upstreamContentType = upstream.headers.get("content-type");
        if (upstreamContentType) responseHeaders["content-type"] = upstreamContentType;
        return new Response(await upstream.arrayBuffer(), {
          status: upstream.status,
          headers: responseHeaders,
        });
      },
    },
  },
});
