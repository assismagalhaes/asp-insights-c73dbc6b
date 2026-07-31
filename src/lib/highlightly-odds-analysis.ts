import { jsonNumber, jsonString, type JsonRecord } from "@/lib/highlightly-analysis";

function key(record: JsonRecord, camel: string, snake = camel): string | null {
  return jsonString(record[camel]) ?? jsonString(record[snake]);
}

function number(record: JsonRecord, camel: string, snake = camel): number | null {
  return jsonNumber(record[camel]) ?? jsonNumber(record[snake]);
}

function lineIdentity(record: JsonRecord): string {
  return (
    key(record, "lineKey", "line_key") ?? String(number(record, "lineValue", "line_value") ?? "")
  );
}

export function choosePreferredLine(rows: JsonRecord[]): string {
  const candidates = new Map<
    string,
    { bookmakers: Set<string>; lineValue: number | null; latest: number }
  >();
  for (const row of rows) {
    if (key(row, "status") === "closed") continue;
    const identity = lineIdentity(row);
    const current = candidates.get(identity) ?? {
      bookmakers: new Set<string>(),
      lineValue: number(row, "lineValue", "line_value"),
      latest: 0,
    };
    const bookmaker = key(row, "bookmakerId", "bookmaker_id") ?? key(row, "bookmaker");
    if (bookmaker) current.bookmakers.add(bookmaker);
    const lastSeen = key(row, "lastSeenAt", "last_seen_at");
    const timestamp = lastSeen ? new Date(lastSeen).getTime() : 0;
    if (Number.isFinite(timestamp)) current.latest = Math.max(current.latest, timestamp);
    candidates.set(identity, current);
  }

  return (
    [...candidates.entries()].sort(
      ([lineA, a], [lineB, b]) =>
        b.bookmakers.size - a.bookmakers.size ||
        b.latest - a.latest ||
        Math.abs(a.lineValue ?? 0) - Math.abs(b.lineValue ?? 0) ||
        lineA.localeCompare(lineB),
    )[0]?.[0] ?? ""
  );
}

export function hasPublishableConsensus(
  selections: string[],
  sourceCounts: Map<string, number>,
  medianSelections: Set<string>,
): boolean {
  return (
    selections.length > 0 &&
    selections.every(
      (selection) => (sourceCounts.get(selection) ?? 0) >= 2 && medianSelections.has(selection),
    )
  );
}
