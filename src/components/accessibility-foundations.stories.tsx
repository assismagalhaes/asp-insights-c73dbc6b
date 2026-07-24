import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const meta = {
  title: "Sistema visual/Acessibilidade",
  parameters: {
    docs: {
      description: {
        component:
          "Contratos visuais e semânticos da Fase 5C para foco, tabelas roláveis e diálogos responsivos.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TabelaRolavel: Story = {
  render: () => (
    <div className="data-surface" style={{ width: "min(64rem, calc(100vw - 2rem))" }}>
      <Table scrollLabel="Prognósticos disponíveis">
        <TableCaption className="sr-only">
          Prognósticos disponíveis para validação crítica.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Jogo</TableHead>
            <TableHead>Mercado</TableHead>
            <TableHead>Pick</TableHead>
            <TableHead>Odd</TableHead>
            <TableHead>Probabilidade</TableHead>
            <TableHead>Edge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="min-w-64">Phillies x Dodgers</TableCell>
            <TableCell className="min-w-40">Total de corridas</TableCell>
            <TableCell className="min-w-32">Under 8.5</TableCell>
            <TableCell>1.91</TableCell>
            <TableCell>58,4%</TableCell>
            <TableCell className="text-success">+11,5%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};

export const DialogoResponsivo: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir revisão</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar prognóstico</DialogTitle>
          <DialogDescription>
            Confira os dados antes de confirmar qualquer alteração operacional.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/25 p-4 text-sm">
          Conteúdo de exemplo para validar foco, leitura e fechamento pelo teclado.
        </div>
      </DialogContent>
    </Dialog>
  ),
};
