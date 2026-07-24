import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, Banknote, CircleCheck, Target } from "lucide-react";

import { StatCard } from "./stat-card";

const meta = {
  title: "Sistema visual/Indicadores",
  component: StatCard,
  parameters: {
    docs: {
      description: {
        component:
          "Indicador operacional reutilizado no dashboard. Valores usam numerais tabulares e os tons semânticos preservam leitura rápida em superfícies densas.",
      },
    },
  },
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Positivo: Story = {
  args: {
    label: "ROI confirmado",
    value: "+8,4%",
    delta: "+1,2 p.p. no período",
    trend: "up",
    icon: Target,
  },
};

export const Risco: Story = {
  args: {
    label: "Drawdown",
    value: "-3,1u",
    delta: "Limite operacional: -5u",
    trend: "down",
    icon: Activity,
  },
};

export const GradeResponsiva: Story = {
  args: {
    label: "Banca",
    value: "R$ 12.480",
    delta: "+R$ 680 no período",
    trend: "up",
    icon: Banknote,
  },
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Banca"
        value="R$ 12.480"
        delta="+R$ 680 no período"
        trend="up"
        icon={Banknote}
      />
      <StatCard
        label="ROI confirmado"
        value="+8,4%"
        delta="+1,2 p.p. no período"
        trend="up"
        icon={Target}
      />
      <StatCard
        label="Win rate"
        value="63,6%"
        delta="14 de 22 entradas"
        trend="neutral"
        icon={CircleCheck}
      />
      <StatCard
        label="Drawdown"
        value="-3,1u"
        delta="Limite operacional: -5u"
        trend="down"
        icon={Activity}
      />
    </div>
  ),
};
