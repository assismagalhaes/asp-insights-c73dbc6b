import type { MlbMarketOdd } from "@/types/mlbStandings";

function toValidOdd(value: unknown): number | null {
  const odd = Number(value);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

export function getOfferedOdd(market: MlbMarketOdd | null | undefined): number | null {
  if (!market) return null;
  return toValidOdd(market.odd) ?? toValidOdd(market.odd_melhor);
}

export function getMarketBaseOdd(market: MlbMarketOdd | null | undefined): number | null {
  if (!market) return null;
  return toValidOdd(market.odd_mediana) ?? toValidOdd(market.odd_media) ?? getOfferedOdd(market);
}

export function getBestBookmaker(market: MlbMarketOdd | null | undefined): string | null {
  if (!market) return null;
  return market.bookmaker_melhor ?? market.bookmaker ?? null;
}
