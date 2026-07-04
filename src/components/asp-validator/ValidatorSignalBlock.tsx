export function ValidatorSignalBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "bad" | "warn";
}) {
  const color =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-amber-300";
  return (
    <div className="rounded-md border border-border p-3">
      <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</p>
      {items.length ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum ponto relevante identificado nesta fase.
        </p>
      )}
    </div>
  );
}
