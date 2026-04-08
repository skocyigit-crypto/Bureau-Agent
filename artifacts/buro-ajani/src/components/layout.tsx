import { createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { Phone, Users, CheckSquare, MessageSquare, BarChart, Search, LayoutDashboard, Settings, PhoneIncoming, FileText, Puzzle, UserCog, Clock, Brain, Package, Calendar, Shield, Zap, BarChart3, Building2 } from "lucide-react";
import { SidebarIcon3D, Icon3D } from "@/components/icon-3d";
import { AiAssistantButton } from "@/components/ai-assistant";
import { AiHealthBadge, RecognitionProvider } from "@/components/ai-recognition-panel";
import { IncomingCallOverlay, useIncomingCall } from "@/components/incoming-call-overlay";
import { UserProfileButton, WorkspaceUserSidebarInfo } from "@/components/workspace-user";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarTrigger, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { ExportMenu } from "@/components/export-menu";
import { NotificationBell } from "@/components/notification-bell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IncomingCallContextType = { simulateIncomingCall: (phone?: string) => void };
const IncomingCallContext = createContext<IncomingCallContextType>({ simulateIncomingCall: () => {} });
export const useSimulateCall = () => useContext(IncomingCallContext);

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const incomingCall = useIncomingCall();

  const navigation = [
    { name: "Tableau de bord", href: "/", icon: LayoutDashboard },
    { name: "Appels", href: "/appels", icon: Phone },
    { name: "Contacts", href: "/contacts", icon: Users },
    { name: "Tâches", href: "/taches", icon: CheckSquare },
    { name: "Messages", href: "/messages", icon: MessageSquare },
    { name: "Calendrier", href: "/calendrier", icon: Calendar },
    { name: "Rapports", href: "/rapports", icon: FileText },
    { name: "Logiciels", href: "/logiciels", icon: Puzzle },
    { name: "Analyse", href: "/analyse", icon: BarChart },
    { name: "Utilisateurs", href: "/utilisateurs", icon: UserCog },
    { name: "Stock", href: "/stock", icon: Package },
    { name: "Pointage", href: "/pointage", icon: Clock },
    { name: "Agents IA", href: "/agents-ia", icon: Brain },
    { name: "Performance", href: "/performance", icon: BarChart3 },
    { name: "Automatisations", href: "/automatisations", icon: Zap },
    { name: "Organisations", href: "/organisations", icon: Building2 },
    { name: "Audit", href: "/audit", icon: Shield },
    { name: "Parametres", href: "/parametres", icon: Settings },
  ];


  return (
    <IncomingCallContext.Provider value={{ simulateIncomingCall: incomingCall.simulateIncomingCall }}>
    <RecognitionProvider>
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-3 px-2 py-1">
              <Icon3D icon={Phone} variant="navy" size="sm" />
              <div>
                <h1 className="text-sidebar-foreground font-semibold text-base leading-none">Agent de Bureau</h1>
                <p className="text-sidebar-foreground/60 text-xs mt-1">Paris HQ</p>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Menu Principal</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigation.map((item) => (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton 
                        asChild 
                        isActive={location === item.href}
                        tooltip={item.name}
                      >
                        <Link href={item.href} className="flex items-center gap-3">
                          <SidebarIcon3D icon={item.icon} href={item.href} />
                          <span>{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-0">
            <WorkspaceUserSidebarInfo />
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 lg:px-6 sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <GlobalSearch />
            </div>
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                    onClick={() => incomingCall.simulateIncomingCall()}
                  >
                    <PhoneIncoming className="w-5 h-5" />
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Simuler un appel entrant</TooltipContent>
              </Tooltip>
              <ThemeToggle />
              <ExportMenu />
              <AiHealthBadge />
              <NotificationBell />
              
              <UserProfileButton />
            </div>
          </header>
          
          <main className="flex-1 p-4 lg:p-8 overflow-auto">
            <div className="mx-auto max-w-6xl">
              {children}
            </div>
          </main>
        </div>
        <AiAssistantButton />
      </div>
    </SidebarProvider>
    </RecognitionProvider>
    <IncomingCallOverlay
      isVisible={incomingCall.isVisible}
      callData={incomingCall.callData}
      onClose={incomingCall.closeCall}
    />
    </IncomingCallContext.Provider>
  );
}
