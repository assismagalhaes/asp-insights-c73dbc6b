import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function AmbientBackdrop({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      <div className="ambient-orbit -right-24 -top-12" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="absolute -left-28 top-[42rem] size-80 rounded-full bg-primary/[0.035] blur-3xl"
      />
    </div>
  );
}

interface PageIntroProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  status?: string;
}

export function PageIntro({ title, description, actions, status }: PageIntroProps) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <span
            role="status"
            className="hidden items-center gap-2 rounded border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground md:inline-flex"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-success shadow-[0_0_12px_var(--color-success)]"
            />
            {status}
          </span>
        ) : null}
        {actions}
      </div>
    </header>
  );
}

interface PanelHeadingProps {
  title: string;
  eyebrow?: string;
  icon?: LucideIcon;
  value?: ReactNode;
  className?: string;
}

export function PanelHeading({ title, eyebrow, icon: Icon, value, className }: PanelHeadingProps) {
  return (
    <div className={cn("mb-3 flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded border border-primary/20 bg-primary/8 text-primary">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <p className="panel-kicker">{eyebrow}</p> : null}
          <h2 className={cn("section-title", eyebrow && "mt-1")}>{title}</h2>
        </div>
      </div>
      {value}
    </div>
  );
}
