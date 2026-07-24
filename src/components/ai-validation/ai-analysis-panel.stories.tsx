import type { Meta, StoryObj } from "@storybook/react-vite";

import { AiAnalysisPanel, type AiAnalysisPanelProps } from "./ai-analysis-panel";

const noop = () => undefined;

const baseArgs: AiAnalysisPanelProps = {
  onApply: noop,
  onCopy: noop,
  onDismiss: noop,
  onRun: noop,
};

const meta = {
  title: "Validação IA/Análise sugerida",
  component: AiAnalysisPanel,
  args: baseArgs,
  parameters: {
    docs: {
      description: {
        component:
          "Componente puramente visual extraído da validação crítica. A execução, persistência e arbitragem permanecem na rota operacional.",
      },
    },
  },
} satisfies Meta<typeof AiAnalysisPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EstadoInicial: Story = {};

export const PesquisandoOnline: Story = {
  args: {
    loadingMode: "online",
  },
};

export const ParecerOnlineConfirmado: Story = {
  args: {
    result: {
      modo: "online",
      decisao_sugerida: "CONFIRMA",
      stake_sugerida: 0.5,
      pick_escolhida: "Under 8.5",
      buscas_realizadas: ["starters confirmados Phillies Dodgers", "clima Citizens Bank Park"],
      fontes_consultadas: [
        {
          titulo: "MLB probable pitchers",
          url: "https://www.mlb.com/probable-pitchers",
          tipo: "SCRAPED",
          consultada: true,
        },
      ],
      parecer: `A) Entrada avaliada
Jogo: Philadelphia Phillies vs Los Angeles Dodgers
Pick escolhida: Under 8.5

B) Tese a favor
Starters confirmados e linha acima da média projetada.

C) Tese contra a entrada
O estádio favorece potência ofensiva.

G) Decisão final
Decisão: CONFIRMA
Stake sugerida: 0.5u`,
    },
  },
};

export const ParecerBloqueado: Story = {
  args: {
    result: {
      modo: "online",
      decisao_sugerida: "PULAR",
      stake_sugerida: 0,
      aviso_opcao:
        "A recomendação CONFIRMAR foi convertida para PULAR pelo árbitro determinístico.",
      parecer: `Status do árbitro: BLOCKED
Decisão: PULAR

Justificativa:
Informação crítica não confirmada e fonte insuficiente.

Principais riscos:
Possível dado desatualizado e risco alto.`,
    },
  },
};
