import { renderToStaticMarkup } from "react-dom/server";
import { Banknote } from "lucide-react";
import { describe, expect, it } from "vitest";

import { SkipLink } from "./skip-link";
import { StatCard } from "./stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

describe("accessibility foundations", () => {
  it("renders a skip link targeting the authenticated main content", () => {
    const markup = renderToStaticMarkup(<SkipLink />);

    expect(markup).toContain('href="#conteudo-principal"');
    expect(markup).toContain("Pular para o conteúdo principal");
  });

  it("exposes metric cards as named sections and hides decorative icons", () => {
    const markup = renderToStaticMarkup(
      <StatCard label="Banca" value="R$ 12.480" trend="up" icon={Banknote} />,
    );

    expect(markup).toContain('<section aria-label="Banca"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("makes horizontally scrollable tables keyboard reachable and named", () => {
    const markup = renderToStaticMarkup(
      <Table scrollLabel="Prognósticos disponíveis">
        <TableHeader>
          <TableRow>
            <TableHead>Jogo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Phillies x Dodgers</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(markup).toContain('role="region"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Prognósticos disponíveis');
  });
});
