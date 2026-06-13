export function ChartEmptyState({
  height = 240,
  message = "Nenhum resultado encontrado para os filtros selecionados.",
}: {
  height?: number;
  message?: string;
}) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground"
      style={{ height }}
    >
      {message}
    </div>
  );
}
