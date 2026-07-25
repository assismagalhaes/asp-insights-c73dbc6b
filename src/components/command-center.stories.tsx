import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, TrendingUp } from "lucide-react";

import { PanelHeading, PageIntro } from "./command-center";
import { StatCard } from "./stat-card";

const meta = {
  title: "Sistema visual/Central de comando",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CabecalhoDePagina: Story = {
  render: () => (
    <div className="bg-background p-8 text-foreground">
      <PageIntro
        title="Dashboard Executivo"
        description="Visão estratégica do desempenho e da operação do sistema de previsões."
        status="Dados operacionais atualizados"
      />
    </div>
  ),
};
export const PainelAnalitico: Story = {
  render: () => (
    <div className="min-h-80 bg-background p-8 text-foreground">
      <div className="surface-panel max-w-3xl">
        <PanelHeading
          eyebrow="Performance financeira"
          title="Evolução da banca"
          icon={Activity}
          value={<span className="numeric-value text-sm text-success">R$ 12.480,00</span>}
        />
        <div className="h-48 rounded border border-dashed border-primary/20 bg-primary/[0.025]" />
      </div>
    </div>
  ),
};

export const IndicadoresColoridos: Story = {
  render: () => (
    <div className="grid gap-3 bg-background p-8 text-foreground sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="ROI" value="+12,47%" icon={TrendingUp} tone="up" accent="blue" />
      <StatCard label="Aprovados" value="1.942" icon={Activity} tone="up" accent="green" />
      <StatCard label="Pendentes" value="312" icon={Activity} tone="neutral" accent="amber" />
      <StatCard label="Win rate" value="56,3%" icon={Activity} tone="up" accent="violet" />
    </div>
  ),
};
