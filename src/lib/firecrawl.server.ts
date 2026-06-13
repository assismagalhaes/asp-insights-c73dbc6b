// Helpers do Firecrawl para uso no servidor. NUNCA importar do client.
// FIRECRAWL_API_KEY é injetada pelo conector Firecrawl.

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

export interface FirecrawlSearchResult {
  url: string;
  title: string;
  description?: string;
}

function getKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new Error(
      "Firecrawl não está conectado. Conecte o Firecrawl em Conectores para usar a pesquisa online.",
    );
  }
  return key;
}

export async function firecrawlSearch(
  query: string,
  opts: { limit?: number; recency?: "day" | "week" | "month" } = {},
): Promise<FirecrawlSearchResult[]> {
  const key = getKey();
  const tbsMap = { day: "qdr:d", week: "qdr:w", month: "qdr:m" } as const;
  const body: Record<string, unknown> = {
    query,
    limit: opts.limit ?? 5,
  };
  if (opts.recency) body.tbs = tbsMap[opts.recency];

  const res = await fetch(`${FIRECRAWL_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl search ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { web?: FirecrawlSearchResult[] } | FirecrawlSearchResult[];
  };
  // v2 pode retornar { data: { web: [...] } } ou { data: [...] }
  const data = json.data;
  if (Array.isArray(data)) return data;
  return data?.web ?? [];
}

export async function firecrawlScrape(url: string): Promise<{ markdown: string; title?: string }> {
  const key = getKey();
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl scrape ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string } };
    markdown?: string;
    metadata?: { title?: string };
  };
  const markdown = json.data?.markdown ?? json.markdown ?? "";
  const title = json.data?.metadata?.title ?? json.metadata?.title;
  // Limita para evitar estouro de contexto
  return { markdown: markdown.slice(0, 8000), title };
}
