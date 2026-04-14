import { createContext, useContext, useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Phone, Users, CheckSquare, MessageSquare, BarChart, Search, LayoutDashboard, Settings, PhoneIncoming, FileText, Puzzle, UserCog, Clock, Brain, Package, Calendar, Shield, Zap, BarChart3, KeyRound, Target, FolderKanban, Globe, ScanSearch, Wallet, Sparkles, PhoneCall, Download } from "lucide-react";
import { useWorkspaceUser } from "@/components/workspace-user";
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
import { SmartBrowserToolbar } from "@/components/smart-browser-panel";
import { QuickActionHub } from "@/components/quick-action-hub";
import { DataExportPanel } from "@/components/data-export-panel";
import { Plus } from "lucide-react";

type IncomingCallContextType = { simulateIncomingCall: (phone?: string) => void };
const IncomingCallContext = createContext<IncomingCallContextType>({ simulateIncomingCall: () => {} });
export const useSimulateCall = () => useContext(IncomingCallContext);

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const incomingCall = useIncomingCall();
  const { user } = useWorkspaceUser();
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "A") {
        e.preventDefault();
        setQuickActionOpen(true);
      }
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const navigation = useMemo(() => {
    const isAdmin = user.role === "super_admin" || user.role === "administrateur";
    const items = [
      { name: "Tableau de bord", href: "/", icon: LayoutDashboard },
      { name: "Appels", href: "/appels", icon: Phone },
      { name: "Contacts", href: "/contacts", icon: Users },
      { name: "Tâches", href: "/taches", icon: CheckSquare },
      { name: "Messages", href: "/messages", icon: MessageSquare },
      { name: "Calendrier", href: "/calendrier", icon: Calendar },
      { name: "Rapports", href: "/rapports", icon: FileText },
      { name: "Rapport Executif", href: "/rapport-executif", icon: BarChart3 },
      ...(isAdmin ? [{ name: "Licence & Facturation", href: "/gestion-licence", icon: Shield }] : []),
      { name: "Google Workspace", href: "/google-workspace", icon: Globe },
      { name: "Logiciels", href: "/logiciels", icon: Puzzle },
      { name: "Analyse", href: "/analyse", icon: BarChart },
      ...(isAdmin ? [{ name: "Utilisateurs", href: "/utilisateurs", icon: UserCog }] : []),
      { name: "Pointage", href: "/pointage", icon: Clock },
      ...(user.role !== "lecture_seule" ? [{ name: "Agents IA", href: "/agents-ia", icon: Brain }] : []),
      ...(user.role !== "lecture_seule" ? [{ name: "AI Commandant", href: "/commandant-ia", icon: Sparkles }] : []),
      { name: "Telephonie", href: "/telephonie", icon: PhoneCall },
      { name: "Document IA", href: "/document-ia", icon: ScanSearch },
      { name: "Performance", href: "/performance", icon: BarChart3 },
      ...(isAdmin ? [{ name: "Automatisations", href: "/automatisations", icon: Zap }] : []),
      ...(user.role === "super_admin" ? [{ name: "Lisans", href: "/organisations", icon: KeyRound }] : []),
      ...(user.role !== "super_admin" ? [{ name: "Mon Abonnement", href: "/abonnement", icon: KeyRound }] : []),
      ...(isAdmin ? [{ name: "Audit", href: "/audit", icon: Shield }] : []),
      { name: "Telecharger", href: "/telecharger", icon: Download },
      { name: "Parametres", href: "/parametres", icon: Settings },
    ];
    return items;
  }, [user.role]);


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
                <p className="text-sidebar-foreground/60 text-xs mt-1">{user.organisation || "Bureau"}</p>
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
              <SmartBrowserToolbar />
              <div className="w-px h-4 bg-border" />
              <ThemeToggle />
              <ExportMenu />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExportOpen(true)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter les donnees (Ctrl+Shift+E)</TooltipContent>
              </Tooltip>
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
        <Button
          onClick={() => setQuickActionOpen(true)}
          className="fixed bottom-6 left-6 z-50 rounded-full w-12 h-12 p-0 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg hover:shadow-xl transition-all"
        >
          <Plus className="h-5 w-5" />
        </Button>
        <QuickActionHub open={quickActionOpen} onOpenChange={setQuickActionOpen} />
        <DataExportPanel open={exportOpen} onOpenChange={setExportOpen} />
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
