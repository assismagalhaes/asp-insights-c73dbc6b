import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { SkipLink } from "@/components/skip-link";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase-public";
import { toast } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você está procurando não existe.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tente novamente ou volte ao dashboard.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ASP Insights — AI Sports Predictions" },
      {
        name: "description",
        content:
          "Plataforma administrativa profissional para gerenciamento, validação e acompanhamento de prognósticos esportivos gerados por IA.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:site_name", content: "ASP Insights" },
      { property: "og:title", content: "ASP Insights — AI Sports Predictions" },
      { name: "twitter:title", content: "ASP Insights — AI Sports Predictions" },
      {
        property: "og:description",
        content:
          "Plataforma administrativa profissional para gerenciamento, validação e acompanhamento de prognósticos esportivos gerados por IA.",
      },
      {
        name: "twitter:description",
        content:
          "Plataforma administrativa profissional para gerenciamento, validação e acompanhamento de prognósticos esportivos gerados por IA.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/51hpxLkxO7XfkSp96ZNusHM8mlH3/social-images/social-1780802982471-Logo_ASP_Insights.webp",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/51hpxLkxO7XfkSp96ZNusHM8mlH3/social-images/social-1780802982471-Logo_ASP_Insights.webp",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],

    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const routeLabels: Record<string, string> = {
  "/": "Dashboard Executivo",
  "/prognosticos": "Prognósticos",
  "/validacao": "Validação Crítica",
  "/publicacao": "Publicação",
  "/coleta-dados": "Coleta de Odds",
  "/base-dados": "Base de Dados",
  "/central-esportiva": "Central Esportiva",
  "/monitor-highlightly": "Monitor Highlightly",
  "/modelos-preditivos": "Modelos Preditivos",
  "/aprendizado-ia": "Aprendizado da IA",
  "/observabilidade-ia": "Observabilidade da IA",
  "/historico": "Histórico",
  "/bankroll": "Bankroll",
  "/configuracoes": "Configurações",
};

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState<string | null>(null);
  const isAuthRoute = pathname === "/auth";
  const isAnalysisRoute = pathname === "/central-esportiva";
  const currentRouteLabel = routeLabels[pathname] ?? "ASP Insights";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setEmail(session?.user.email ?? null);
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  async function handleLogout() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/auth", search: { next: "/" }, replace: true });
  }

  if (isAuthRoute) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground">
          <SkipLink />
          <AppSidebar commandMode={!isAnalysisRoute} />
          <div className="flex flex-1 flex-col min-w-0">
            <header
              className={`${isAnalysisRoute ? "" : "app-shell-header"} sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/80 bg-background/95 px-3 backdrop-blur-xl md:px-5`}
            >
              <SidebarTrigger
                className={
                  isAnalysisRoute
                    ? "size-10 border border-border/80 bg-background/35 hover:bg-primary/10"
                    : "size-10 border border-primary/20 bg-primary/5 text-primary shadow-[inset_0_0_18px_color-mix(in_oklab,var(--color-primary)_6%,transparent)] hover:bg-primary/10"
                }
              />
              <div className="flex min-w-0 items-center gap-2">
                <span className="whitespace-nowrap text-sm font-semibold tracking-tight text-foreground">
                  ASP Insights
                </span>
                <span
                  className={
                    isAnalysisRoute
                      ? "hidden text-xs text-muted-foreground sm:inline"
                      : "hidden size-1 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)] sm:inline"
                  }
                >
                  {isAnalysisRoute ? "/" : null}
                </span>
                <span
                  className={
                    isAnalysisRoute
                      ? "truncate text-sm font-medium text-muted-foreground sm:text-xs"
                      : "hidden truncate rounded border border-border/70 bg-card/60 px-2 py-1 text-sm font-medium text-muted-foreground sm:inline sm:text-xs"
                  }
                >
                  {currentRouteLabel}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span
                  role="status"
                  aria-label="Status do sistema: online"
                  className="inline-flex items-center gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-bold tracking-[0.08em] text-success"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-success motion-safe:animate-pulse"
                  />
                  ONLINE
                </span>
                {email ? (
                  <span
                    className={
                      isAnalysisRoute
                        ? "hidden max-w-[180px] truncate text-xs text-muted-foreground lg:inline"
                        : "hidden max-w-[180px] truncate rounded border border-border/60 bg-card/40 px-2 py-1 text-xs text-muted-foreground lg:inline"
                    }
                  >
                    {email}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  title="Sair"
                  aria-label="Sair"
                >
                  <LogOut data-icon="inline-start" />
                </Button>
              </div>
            </header>
            <main
              id="conteudo-principal"
              tabIndex={-1}
              aria-label={currentRouteLabel}
              className={
                isAnalysisRoute
                  ? "app-main min-h-0 flex-1"
                  : "app-main flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8"
              }
            >
              <Outlet />
            </main>
          </div>
        </div>
        <Toaster />
      </SidebarProvider>
    </QueryClientProvider>
  );
}
