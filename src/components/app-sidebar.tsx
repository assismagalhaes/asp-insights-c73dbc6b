import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
  History,
  Wallet,
  BrainCircuit,
  
  Settings,
  Upload,
  Megaphone,
  Database,
} from "lucide-react";
import logo from "@/assets/logo-asp.png.asset.json";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";


const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Prognósticos", url: "/prognosticos", icon: ListChecks },
  { title: "Importar", url: "/importar", icon: Upload },
  { title: "Coleta de Odds", url: "/coleta-dados", icon: Database },
  { title: "Validação Crítica", url: "/validacao", icon: ShieldCheck },
  { title: "Publicação", url: "/publicacao", icon: Megaphone },
  { title: "Histórico", url: "/historico", icon: History },
  { title: "Bankroll", url: "/bankroll", icon: Wallet },
  { title: "Aprendizado da IA", url: "/aprendizado-ia", icon: BrainCircuit },
  
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <img
            src={logo.url}
            alt="ASP Insights"
            className="h-9 w-9 shrink-0 rounded-md object-contain"
          />
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight">
                <span className="text-foreground">ASP </span>
                <span className="text-primary">Insights</span>
              </span>
              <span className="text-[10px] text-accent uppercase tracking-[0.15em]">
                AI Sports Predictions
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
