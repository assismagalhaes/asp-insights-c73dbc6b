import { Link, useRouterState } from "@tanstack/react-router";
import {
  BrainCircuit,
  Cpu,
  Database,
  DownloadCloud,
  History,
  LayoutDashboard,
  ListChecks,
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

const navigationGroups = [
  {
    label: "Visão geral",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Operação",
    items: [
      { title: "Prognósticos", url: "/prognosticos", icon: ListChecks },
      { title: "Validação Crítica", url: "/validacao", icon: ShieldCheck },
      { title: "Publicação", url: "/publicacao", icon: Megaphone },
    ],
  },
  {
    label: "Dados e modelos",
    items: [
      { title: "Coleta de Odds", url: "/coleta-dados", icon: Database },
      { title: "Base de Dados", url: "/base-dados", icon: Database },
      { title: "Modelos Preditivos", url: "/modelos-preditivos", icon: Cpu },
      { title: "Aprendizado da IA", url: "/aprendizado-ia", icon: BrainCircuit },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Histórico", url: "/historico", icon: History },
      { title: "Bankroll", url: "/bankroll", icon: Wallet },
    ],
  },
];

const settingsItem = { title: "Configurações", url: "/configuracoes", icon: Settings };

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });

  const closeMobileMenu = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <img
            src={logo.url}
            alt="ASP Insights"
            className="size-9 shrink-0 rounded-md object-contain"
          />
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight">
                <span className="text-foreground">ASP </span>
                <span className="text-primary">Insights</span>
              </span>
              <span className="truncate text-[10px] uppercase tracking-[0.15em] text-accent">
                AI Sports Predictions
              </span>
            </div>
          )}
          
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {navigationGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-1.5">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} onClick={closeMobileMenu}>
                          <item.icon />
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

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === settingsItem.url}
              tooltip={settingsItem.title}
            >
              <Link to={settingsItem.url} onClick={closeMobileMenu}>
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
