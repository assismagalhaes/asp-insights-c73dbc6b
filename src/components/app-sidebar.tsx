import { Link, useRouterState } from "@tanstack/react-router";
import {
  BrainCircuit,
  ChartNoAxesCombined,
  ChartSpline,
  Cpu,
  Database,
  DownloadCloud,
  History,
  LayoutDashboard,
  ListChecks,
  MonitorCog,
  Megaphone,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import logo from "@/assets/logo-asp.png.asset.json";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar-context";
import { featureFlags } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";

const navigationGroups = [
  {
    label: "Visão geral",
    tone: "primary",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Operação",
    tone: "success",
    items: [
      { title: "Prognósticos", url: "/prognosticos", icon: ListChecks },
      { title: "Validação Crítica", url: "/validacao", icon: ShieldCheck },
      { title: "Publicação", url: "/publicacao", icon: Megaphone },
    ],
  },
  {
    label: "Dados e modelos",
    tone: "ai",
    items: [
      { title: "Coleta de Odds", url: "/coleta-dados", icon: DownloadCloud },
      { title: "Base de Dados", url: "/base-dados", icon: Database },
      ...(featureFlags.highlightlyAnalysis
        ? [
            { title: "Central Esportiva", url: "/central-esportiva", icon: ChartNoAxesCombined },
            { title: "Monitor Highlightly", url: "/monitor-highlightly", icon: MonitorCog },
          ]
        : []),
      { title: "Modelos Preditivos", url: "/modelos-preditivos", icon: Cpu },
      { title: "Aprendizado da IA", url: "/aprendizado-ia", icon: BrainCircuit },
      { title: "Observabilidade da IA", url: "/observabilidade-ia", icon: ChartSpline },
    ],
  },
  {
    label: "Gestão",
    tone: "warning",
    items: [
      { title: "Histórico", url: "/historico", icon: History },
      { title: "Bankroll", url: "/bankroll", icon: Wallet },
    ],
  },
];

const settingsItem = { title: "Configurações", url: "/configuracoes", icon: Settings };

export function AppSidebar({ commandMode = true }: { commandMode?: boolean }) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });

  const closeMobileMenu = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar
      collapsible="icon"
      className={cn(commandMode && "app-sidebar", "border-r border-sidebar-border/90")}
    >
      <SidebarHeader
        className={cn(commandMode && "app-sidebar-header", "border-b border-sidebar-border/90")}
      >
        <div className="flex h-[63px] items-center gap-2 px-2">
          <img
            src={logo.url}
            alt="ASP Insights"
            className={cn(
              "size-9 shrink-0 rounded object-contain",
              commandMode &&
                "drop-shadow-[0_0_12px_color-mix(in_oklab,var(--color-primary)_40%,transparent)]",
            )}
          />
          {!collapsed ? (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight">
                <span className="text-sidebar-foreground">ASP </span>
                <span className="text-sidebar-primary">Insights</span>
              </span>
              <span
                className={cn(
                  "truncate text-[9px] uppercase tracking-[0.16em]",
                  commandMode ? "text-info" : "text-success",
                )}
              >
                AI Sports Predictions
              </span>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-3">
        {navigationGroups.map((group) => (
          <SidebarGroup
            key={group.label}
            className={cn(
              "py-1",
              group.tone === "primary" && "[--nav-tone:var(--color-primary)]",
              group.tone === "success" && "[--nav-tone:var(--color-success)]",
              group.tone === "ai" && "[--nav-tone:var(--color-ai)]",
              group.tone === "warning" && "[--nav-tone:var(--color-warning)]",
            )}
          >
            <SidebarGroupLabel
              className={cn(
                "px-3 font-mono text-[9px] uppercase tracking-[0.12em] text-sidebar-foreground/45",
                commandMode &&
                  "before:mr-2 before:size-1 before:rounded-full before:bg-[var(--nav-tone)] before:shadow-[0_0_8px_var(--nav-tone)]",
              )}
            >
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className={cn(
                          "relative h-9 rounded px-3 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full",
                          commandMode
                            ? "nav-command data-[active=true]:bg-[color-mix(in_oklab,var(--nav-tone)_12%,transparent)] data-[active=true]:text-[var(--nav-tone)] data-[active=true]:before:bg-[var(--nav-tone)] data-[active=true]:before:shadow-[0_0_10px_var(--nav-tone)]"
                            : "data-[active=true]:bg-sidebar-primary/12 data-[active=true]:text-sidebar-primary data-[active=true]:before:bg-sidebar-primary",
                        )}
                      >
                        <Link
                          to={item.url}
                          onClick={closeMobileMenu}
                          aria-current={active ? "page" : undefined}
                        >
                          <span className="nav-command-icon">
                            <item.icon />
                          </span>
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/90 p-2">
        {!collapsed ? (
          <div
            className={cn(
              commandMode && "system-status-card",
              "mb-1 flex items-center gap-2 rounded border border-success/20 bg-success/5 px-2.5 py-2",
            )}
          >
            <span className="size-1.5 rounded-full bg-success shadow-[0_0_10px_var(--color-success)] motion-safe:animate-pulse" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.08em] text-success">ONLINE</p>
              <p className="truncate text-[9px] text-sidebar-foreground/45">
                Sistemas operacionais
              </p>
            </div>
          </div>
        ) : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === settingsItem.url}
              tooltip={settingsItem.title}
              className="h-9 rounded px-3 text-[13px] text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary/12 data-[active=true]:text-sidebar-primary"
            >
              <Link
                to={settingsItem.url}
                onClick={closeMobileMenu}
                aria-current={pathname === settingsItem.url ? "page" : undefined}
              >
                <settingsItem.icon />
                <span>{settingsItem.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
