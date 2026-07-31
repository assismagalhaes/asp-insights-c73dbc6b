import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase-public", () => ({
  supabase: { rpc },
}));

import { fetchDailyMatches, matchStatusLabel } from "@/lib/highlightly-analysis";

describe("fetchDailyMatches", () => {
  beforeEach(() => rpc.mockReset());

  it("preserva esportes saudáveis quando Todos tem uma falha parcial", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_baseball_daily_matches") {
        return Promise.resolve({ data: null, error: { message: "baseball indisponível" } });
      }
      return Promise.resolve({
        data: [
          {
            match_id: `${fn}-id`,
            kickoff_at: "2026-07-31T20:00:00Z",
            competition_name: "Liga",
            competition_short_name: "L",
            home_team_name: "Casa",
            away_team_name: "Fora",
          },
        ],
        error: null,
      });
    });

    const result = await fetchDailyMatches("all", "2026-07-31");

    expect(result.matches).toHaveLength(2);
    expect(result.failures).toEqual([{ sport: "baseball", message: "baseball indisponível" }]);
  });

  it("falha quando nenhum esporte responde", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "indisponível" } });

    await expect(fetchDailyMatches("all", "2026-07-31")).rejects.toThrow(
      "Nenhum esporte respondeu",
    );
  });
});

describe("matchStatusLabel", () => {
  it.each([
    ["suspended", "Suspenso"],
    ["interrupted", "Suspenso"],
    ["abandoned", "Abandonado"],
    ["cancelled", "Cancelado"],
    ["postponed", "Adiado"],
  ])("traduz %s sem apresentar como agendado", (status, expected) => {
    expect(matchStatusLabel(status)).toBe(expected);
  });
});
