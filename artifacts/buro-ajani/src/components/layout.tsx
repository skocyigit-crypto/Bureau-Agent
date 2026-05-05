import { createContext, useContext, useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Users, CheckSquare, MessageSquare, BarChart, LayoutDashboard, Settings, FileText, Puzzle, UserCog, Clock, Brain, Calendar, Shield, Zap, BarChart3, KeyRound, Globe, ScanSearch, Sparkles, PhoneCall, Download, Plus, PhoneIncoming, Wifi, WifiOff, Smartphone, Monitor, Tablet, Rocket, Mail, TrendingUp, StickyNote, Activity, FolderKanban } from "lucide-react";
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
import { useDeviceEnvContext, triggerHaptic } from "@/hooks/use-device-environment";
import { TrialBanner } from "@/components/trial-banner";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { IntegrationDiscovery } from "@/components/integration-discovery";

type IncomingCallContextType = { simulateIncomingCall: (phone?: string) => void };
const IncomingCallContext = createContext<IncomingCallContextType>({ simulateIncomingCall: () => {} });
export const useSimulateCall = () => useContext(IncomingCallContext);

function ConnectionIndicator() {
  const env = useDeviceEnvContext();
  const tierConfig = {
    offline: { icon: WifiOff, color: "text-red-500", label: "Hors ligne" },
    slow: { icon: Wifi, color: "text-amber-500", label: "Connexion lente" },
    moderate: { icon: Wifi, color: "text-yellow-500", label: "Connexion moderee" },
    fast: { icon: Wifi, color: "text-emerald-500", label: "Connexion rapide" },
  };
  const cfg = tierConfig[env.connectionTier];
  const DeviceIcon = env.screenClass === "mobile" ? Smartphone : env.screenClass === "tablet" ? Tablet : Monitor;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs">
          <DeviceIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <cfg.icon className={`w-3.5 h-3.5 ${cfg.color}`} />
          {env.isStandalone && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs space-y-0.5">
          <p className="font-medium">{env.platform === "ios" ? "iOS" : env.platform === "macos" ? "macOS" : env.platform === "android" ? "Android" : env.platform === "windows" ? "Windows" : "Appareil"} — {env.screenClass}</p>
          <p className={cfg.color}>{cfg.label}</p>
          {env.isStandalone && <p className="text-emerald-600">Mode application</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const incomingCall = useIncomingCall();
  const { user } = useWorkspaceUser();
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [orgLogo, setOrgLogo] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  useRealtimeSync();

  useEffect(() => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    fetch(`${BASE}/api/org-profile`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setOrgLogo(data.logo || null);
          setOrgName(data.name || null);
        }
      })
      .catch(() => {});
  }, []);

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

  const navGroups = useMemo(() => {
    const isAdmin = user.role === "super_admin" || user.role === "administrateur";
    const isSuperAdmin = user.role === "super_admin";
    const canUseAi = user.role !== "lecture_seule";

    return [
      {
        label: "Vue d'ensemble",
        items: [
          { name: "Tableau de bord", href: "/", icon: LayoutDashboard },
          { name: "Analyse", href: "/analyse", icon: BarChart },
          { name: "Performance", href: "/performance", icon: BarChart3 },
          { name: "Activité récente", href: "/activite-recente", icon: Activity },
        ],
      },
      {
        label: "Communication",
        items: [
          { name: "Historique appels", href: "/appels", icon: Phone },
          { name: "Messages", href: "/messages", icon: MessageSquare },
          { name: "Calendrier", href: "/calendrier", icon: Calendar },
        ],
      },
      {
        label: "CRM",
        items: [
          { name: "Contacts", href: "/contacts", icon: Users },
          { name: "Tâches", href: "/taches", icon: CheckSquare },
        ],
      },
      ...(canUseAi
        ? [{
            label: "Intelligence Artificielle",
            items: [
              { name: "Agents IA", href: "/agents-ia", icon: Brain },
              { name: "Commandant IA", href: "/commandant-ia", icon: Sparkles },
              { name: "Document IA", href: "/document-ia", icon: ScanSearch },
              { name: "Agent Mail IA", href: "/gmail-agent", icon: Mail },
            ],
          }]
        : []),
      {
        label: "Documents & Rapports",
        items: [
          { name: "Documents", href: "/documents", icon: FileText },
          { name: "Rapports", href: "/rapports", icon: FileText },
          { name: "Rapport Exécutif", href: "/rapport-executif", icon: BarChart3 },
        ],
      },
      {
        label: "Équipe",
        items: [
          { name: "Pointage", href: "/pointage", icon: Clock },
          { name: "Notes internes", href: "/notes-internes", icon: StickyNote },
          ...(isAdmin ? [{ name: "Utilisateurs", href: "/utilisateurs", icon: UserCog }] : []),
        ],
      },
      {
        label: "Intégrations",
        items: [
          { name: "Google Workspace", href: "/google-workspace", icon: Globe },
          { name: "Connecteurs", href: "/logiciels", icon: Puzzle },
          ...(isAdmin ? [{ name: "Automatisations", href: "/automatisations", icon: Zap }] : []),
        ],
      },
      {
        label: "Licence & Conformité",
        items: [
          { name: "Licence & Facturation", href: "/gestion-licence", icon: Shield },
          { name: "Protection des données", href: "/protection-donnees", icon: Shield },
          ...(isSuperAdmin ? [{ name: "Organisations", href: "/organisations", icon: KeyRound }] : []),
        ],
      },
      {
        label: "Système",
        items: [
          { name: "Téléphonie", href: "/telephonie", icon: PhoneCall },
          { name: "Import intelligent", href: "/import", icon: Download },
          { name: "Configuration initiale", href: "/onboarding", icon: Rocket },
          { name: "Application mobile", href: "/telecharger", icon: Download },
          { name: "Paramètres", href: "/parametres", icon: Settings },
        ],
      },
    ].filter(g => g.items.length > 0);
  }, [user.role]);


  return (
    <IncomingCallContext.Provider value={{ simulateIncomingCall: incomingCall.simulateIncomingCall }}>
    <RecognitionProvider>
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarHeader className="p-4">
            <div className="flex items-center gap-3 px-2 py-1">
              {orgLogo ? (
                <img
                  src={orgLogo}
                  alt={orgName || "Logo"}
                  className="h-8 w-8 rounded-lg object-contain border border-sidebar-border bg-white shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <Icon3D icon={Phone} variant="navy" size="sm" />
              )}
              <div className="min-w-0">
                <h1 className="text-sidebar-foreground font-semibold text-base leading-none truncate">
                  {orgName || "Agent de Bureau"}
                </h1>
                <p className="text-sidebar-foreground/60 text-xs mt-1 truncate">{user.organisation || "Bureau"}</p>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {navGroups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={location === item.href || (item.href !== "/" && location.startsWith(item.href + "/"))}
                          tooltip={item.name}
                        >
                          <Link href={item.href} className="flex items-center gap-3" onClick={() => triggerHaptic("light")}>
                            <SidebarIcon3D icon={item.icon} href={item.href} />
                            <span>{item.name}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
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
              <ConnectionIndicator />
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
          
          <TrialBanner />
          <main className="flex-1 p-4 lg:p-8 overflow-auto">
            <div className="mx-auto max-w-6xl">
              {children}
            </div>
          </main>
        </div>
        <AiAssistantButton />
        <motion.button
          onClick={() => { triggerHaptic("medium"); setQuickActionOpen(true); }}
          className="fixed bottom-6 left-6 z-50 rounded-full w-12 h-12 p-0 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg safe-area-bottom"
          whileHover={{ scale: 1.1, boxShadow: "0 10px 30px -5px rgba(16, 185, 129, 0.4)" }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <Plus className="h-5 w-5" />
        </motion.button>
        <QuickActionHub open={quickActionOpen} onOpenChange={setQuickActionOpen} />
        <DataExportPanel open={exportOpen} onOpenChange={setExportOpen} />
        <PwaInstallPrompt />
        <IntegrationDiscovery />
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
