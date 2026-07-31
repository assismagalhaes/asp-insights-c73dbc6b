import { describe, expect, it } from "vitest";
import { choosePreferredLine, hasPublishableConsensus } from "@/lib/highlightly-odds-analysis";

describe("choosePreferredLine", () => {
  it("prefere a linha com maior cobertura de bookmakers", () => {
    const rows = [
      { lineKey: "170.5", lineValue: 170.5, bookmakerId: "a", lastSeenAt: "2026-07-31T10:00:00Z" },
      { lineKey: "172.5", lineValue: 172.5, bookmakerId: "a", lastSeenAt: "2026-07-31T09:00:00Z" },
      { lineKey: "172.5", lineValue: 172.5, bookmakerId: "b", lastSeenAt: "2026-07-31T09:00:00Z" },
    ];

    expect(choosePreferredLine(rows)).toBe("172.5");
  });

  it("não contém preferência fixa pela linha 172.5", () => {
    const rows = [
      { lineKey: "1.5", lineValue: 1.5, bookmakerId: "a", lastSeenAt: "2026-07-31T10:00:00Z" },
      { lineKey: "1.5", lineValue: 1.5, bookmakerId: "b", lastSeenAt: "2026-07-31T10:00:00Z" },
      { lineKey: "172.5", lineValue: 172.5, bookmakerId: "a", lastSeenAt: "2026-07-31T11:00:00Z" },
    ];

    expect(choosePreferredLine(rows)).toBe("1.5");
  });
});

describe("hasPublishableConsensus", () => {
  it("bloqueia quando qualquer seleção tem menos de duas fontes", () => {
    expect(
      hasPublishableConsensus(
        ["home", "away"],
        new Map([
          ["home", 2],
          ["away", 1],
        ]),
        new Set(["home", "away"]),
      ),
    ).toBe(false);
  });

  it("exige mediana para todas as seleções", () => {
    expect(
      hasPublishableConsensus(
        ["home", "away"],
        new Map([
          ["home", 2],
          ["away", 2],
        ]),
        new Set(["home"]),
      ),
    ).toBe(false);
  });

  it("libera somente com quórum e mediana por seleção", () => {
    expect(
      hasPublishableConsensus(
        ["home", "away"],
        new Map([
          ["home", 2],
          ["away", 3],
        ]),
        new Set(["home", "away"]),
      ),
    ).toBe(true);
  });
});
