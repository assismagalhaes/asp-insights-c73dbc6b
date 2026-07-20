// Supabase Edge Function: scraper-api
// Proxies requests to the external scraper API, keeping SCRAPER_API_KEY on the server.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const baseUrl = Deno.env.get("SCRAPER_API_URL")?.replace(/\/+$/, "");
  const apiKey = Deno.env.get("SCRAPER_API_KEY");
  if (!baseUrl || !apiKey) {
    return json({ error: "SCRAPER_API_URL ou SCRAPER_API_KEY não configurados." }, 500);
  }

  let timeoutPath = "API da VM";
  let timeoutMs = 120000;

  try {
    const url = new URL(req.url);
    // Action via query (?action=/health) or JSON body { action, path, method, body, query }
    let action = url.searchParams.get("action") ?? url.searchParams.get("path");
    let method = (url.searchParams.get("method") ?? req.method).toUpperCase();
    let body: unknown = undefined;
    let query: Record<string, string> | undefined;

    if (req.method === "POST") {
      const text = await req.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          action = parsed.action ?? parsed.path ?? action;
          method = (parsed.method ?? method).toUpperCase();
          body = parsed.body ?? parsed.data;
          query = parsed.query;
        } catch {
          // ignore parse error, treat as raw passthrough
          body = text;
        }
      }
    }

    if (!action) {
      return json({ error: "Informe 'action' (ex.: '/health' ou '/scrape')." }, 400);
    }

    // Shortcuts
    const shortcuts: Record<string, string> = {
      health: "/health",
      scrape: "/scrape",
    };
    let path = shortcuts[action] ?? action;
    if (!path.startsWith("/")) path = `/${path}`;

    const target = new URL(`${baseUrl}${path}`);
    timeoutPath = target.pathname;
    if (/\/scraping\/jobs\/[^/]+\/(raw|normalized|csv)$/.test(target.pathname)) {
      timeoutMs = 300000;
    } else if (target.pathname === "/scraping/jobs" && method === "POST") {
      timeoutMs = 180000;
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        target.searchParams.set(k, String(v));
      }
    }

    const init: RequestInit = {
      method,
      headers: {
        "x-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    };
    if (method !== "GET" && method !== "HEAD" && body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    const text = await upstream.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // keep as text
    }

    return new Response(JSON.stringify({ ok: upstream.ok, status: upstream.status, data }), {
      status: upstream.ok ? 200 : upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return json(
        {
          error: `Timeout ao chamar API da VM (${timeoutPath}) após ${Math.round(timeoutMs / 1000)}s.`,
        },
        504,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
