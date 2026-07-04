import type { LucideIcon } from "lucide-react";

export function ValidatorPlaceholder({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/10 p-3">
      <Icon className="mb-2 h-4 w-4 text-muted-foreground" />
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
