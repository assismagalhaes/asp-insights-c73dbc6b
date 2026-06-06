export type Sport = "Futebol" | "NBA" | "WNBA" | "MLB" | "NFL" | "NHL";
export type Status =
  | "PENDENTE"
  | "CONFIRMA"
  | "CONFIRMA COM CAUTELA"
  | "AGUARDAR NOTÍCIA"
  | "PASS";
export type Result = "PENDENTE" | "GREEN" | "RED" | "PUSH";

export interface Prognostico {
  id: string;
  data: string;
  esporte: Sport;
  liga: string;
  jogo: string;
  mandante: string;
  visitante: string;
  mercado: string;
  pick: string;
  linha: string;
  oddOfertada: number;
  oddValor: number;
  probabilidade: number;
  edge: number;
  stake: number;
  observacoes?: string;
  status: Status;
  resultado: Result;
  lucro?: number;
}

const today = new Date();
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return fmt(d);
};

export const prognosticos: Prognostico[] = [
  {
    id: "p1",
    data: fmt(today),
    esporte: "Futebol",
    liga: "Premier League",
    jogo: "Arsenal x Chelsea",
    mandante: "Arsenal",
    visitante: "Chelsea",
    mercado: "Resultado Final",
    pick: "Arsenal ML",
    linha: "-",
    oddOfertada: 1.95,
    oddValor: 1.78,
    probabilidade: 0.62,
    edge: 0.096,
    stake: 1.5,
    observacoes: "Arsenal vem de 4 vitórias seguidas em casa.",
    status: "CONFIRMA",
    resultado: "PENDENTE",
  },
  {
    id: "p2",
    data: fmt(today),
    esporte: "NBA",
    liga: "NBA",
    jogo: "Lakers x Celtics",
    mandante: "Lakers",
    visitante: "Celtics",
    mercado: "Total de Pontos",
    pick: "Over 224.5",
    linha: "224.5",
    oddOfertada: 1.9,
    oddValor: 1.85,
    probabilidade: 0.58,
    edge: 0.027,
    stake: 1.0,
    status: "CONFIRMA COM CAUTELA",
    resultado: "PENDENTE",
  },
  {
    id: "p3",
    data: fmt(today),
    esporte: "NFL",
    liga: "NFL",
    jogo: "Chiefs x Bills",
    mandante: "Chiefs",
    visitante: "Bills",
    mercado: "Spread",
    pick: "Bills +3.5",
    linha: "+3.5",
    oddOfertada: 1.85,
    oddValor: 1.92,
    probabilidade: 0.51,
    edge: -0.038,
    stake: 0,
    observacoes: "Odd ofertada abaixo do valor justo.",
    status: "PASS",
    resultado: "PENDENTE",
  },
  {
    id: "p4",
    data: daysAgo(1),
    esporte: "Futebol",
    liga: "La Liga",
    jogo: "Real Madrid x Atlético",
    mandante: "Real Madrid",
    visitante: "Atlético",
    mercado: "BTTS",
    pick: "Sim",
    linha: "-",
    oddOfertada: 1.78,
    oddValor: 1.65,
    probabilidade: 0.65,
    edge: 0.078,
    stake: 1.5,
    status: "CONFIRMA",
    resultado: "GREEN",
    lucro: 1.17,
  },
  {
    id: "p5",
    data: daysAgo(1),
    esporte: "MLB",
    liga: "MLB",
    jogo: "Yankees x Red Sox",
    mandante: "Yankees",
    visitante: "Red Sox",
    mercado: "Moneyline",
    pick: "Yankees",
    linha: "-",
    oddOfertada: 1.7,
    oddValor: 1.6,
    probabilidade: 0.63,
    edge: 0.062,
    stake: 1.0,
    status: "CONFIRMA",
    resultado: "RED",
    lucro: -1.0,
  },
  {
    id: "p6",
    data: daysAgo(2),
    esporte: "NHL",
    liga: "NHL",
    jogo: "Rangers x Bruins",
    mandante: "Rangers",
    visitante: "Bruins",
    mercado: "Total de Pontos",
    pick: "Under 5.5",
    linha: "5.5",
    oddOfertada: 1.95,
    oddValor: 1.82,
    probabilidade: 0.59,
    edge: 0.071,
    stake: 1.0,
    status: "CONFIRMA",
    resultado: "GREEN",
    lucro: 0.95,
  },
  {
    id: "p7",
    data: daysAgo(3),
    esporte: "WNBA",
    liga: "WNBA",
    jogo: "Liberty x Aces",
    mandante: "Liberty",
    visitante: "Aces",
    mercado: "Player Props",
    pick: "Wilson Over 22.5 pts",
    linha: "22.5",
    oddOfertada: 1.88,
    oddValor: 1.75,
    probabilidade: 0.6,
    edge: 0.074,
    stake: 0.5,
    status: "CONFIRMA COM CAUTELA",
    resultado: "GREEN",
    lucro: 0.44,
  },
  {
    id: "p8",
    data: daysAgo(4),
    esporte: "Futebol",
    liga: "Serie A",
    jogo: "Inter x Milan",
    mandante: "Inter",
    visitante: "Milan",
    mercado: "Handicap Asiático",
    pick: "Inter -0.5",
    linha: "-0.5",
    oddOfertada: 1.92,
    oddValor: 1.8,
    probabilidade: 0.57,
    edge: 0.067,
    stake: 1.0,
    status: "AGUARDAR NOTÍCIA",
    resultado: "PENDENTE",
    observacoes: "Aguardando confirmação do escalação titular.",
  },
];

export const bankrollHistory = Array.from({ length: 30 }).map((_, i) => {
  const base = 1000;
  const growth = base + i * 18 + Math.sin(i / 2) * 25;
  return {
    data: daysAgo(29 - i),
    banca: Math.round(growth * 100) / 100,
    roi: Math.round((((growth - base) / base) * 100) * 100) / 100,
  };
});

export const sportPerformance = [
  { esporte: "Futebol", lucro: 12.4, roi: 8.2 },
  { esporte: "NBA", lucro: 7.8, roi: 5.1 },
  { esporte: "NFL", lucro: -2.1, roi: -1.4 },
  { esporte: "MLB", lucro: 4.3, roi: 3.2 },
  { esporte: "NHL", lucro: 6.0, roi: 4.5 },
  { esporte: "WNBA", lucro: 2.2, roi: 1.8 },
];

export const marketPerformance = [
  { mercado: "Resultado Final", lucro: 6.5 },
  { mercado: "Over/Under", lucro: 8.1 },
  { mercado: "BTTS", lucro: 3.4 },
  { mercado: "Handicap Asiático", lucro: 5.2 },
  { mercado: "Player Props", lucro: 4.8 },
  { mercado: "Moneyline", lucro: 2.1 },
];

export const mercados = [
  "Resultado Final",
  "Handicap Asiático",
  "Handicap Europeu",
  "Over/Under",
  "BTTS",
  "Moneyline",
  "Spread",
  "Total de Pontos",
  "Total de Corridas",
  "Total de Escanteios",
  "Player Props",
];

export const esportes: Sport[] = [
  "Futebol",
  "NBA",
  "WNBA",
  "MLB",
  "NFL",
  "NHL",
];
