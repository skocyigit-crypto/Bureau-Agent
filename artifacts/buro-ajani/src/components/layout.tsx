import { createContext, useContext, useMemo, useRef, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Users, CheckSquare, MessageSquare, MessageCircle, BarChart, LayoutDashboard, Settings, FileText, Puzzle, UserCog, Clock, Brain, Calendar, Shield, ShieldCheck, Zap, BarChart3, KeyRound, Globe, Target, Sparkles, PhoneCall, Download, Plus, PhoneIncoming, Wifi, WifiOff, Smartphone, Monitor, Tablet, Rocket, Mail, StickyNote, Activity, ClipboardList, Plug, CreditCard, Trophy, ScanSearch, MapPin, Bell, Inbox, Search, HardHat, Wallet, BookOpen } from "lucide-react";
import { useWorkspaceUser } from "@/components/workspace-user";
import { SidebarIcon3D, Icon3D } from "@/components/icon-3d";
import { AiAssistantButton } from "@/components/ai-assistant";
import { AiHealthBadge, RecognitionProvider } from "@/components/ai-recognition-panel";
import { IncomingCallOverlay, useIncomingCall } from "@/components/incoming-call-overlay";
import { UserProfileButton, WorkspaceUserSidebarInfo } from "@/components/workspace-user";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge, SidebarProvider, SidebarTrigger, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarFooter } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { ExportMenu } from "@/components/export-menu";
import { NotificationBell } from "@/components/notification-bell";
import { AgentRunChip } from "@/components/agent-run-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SmartBrowserToolbar } from "@/components/smart-browser-panel";
import { QuickActionHub } from "@/components/quick-action-hub";
import { DataExportPanel } from "@/components/data-export-panel";
import { useDeviceEnvContext, triggerHaptic } from "@/hooks/use-device-environment";
import { TrialBanner } from "@/components/trial-banner";
import { LicenseStatusBanner } from "@/components/license-status-banner";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { useGetMyPreferences, getGetMyPreferencesQueryKey, type BadgeMuteFlags } from "@workspace/api-client-react";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { IntegrationDiscovery } from "@/components/integration-discovery";
import { HelpCenter } from "@/components/help-center";

type IncomingCallContextType = { simulateIncomingCall: (phone?: string) => void };
const IncomingCallContext = createContext<IncomingCallContextType>({ simulateIncomingCall: () => {} });
export const useSimulateCall = () => useContext(IncomingCallContext);

function ConnectionIndicator() {
  const env = useDeviceEnvContext();
  const tierConfig = {
    offline: { icon: WifiOff, color: "text-red-500", label: "Hors ligne" },
    slow: { icon: Wifi, color: "text-amber-500", label: "Connexion lente" },
    moderate: { icon: Wifi, color: "text-yellow-500", label: "Connexion modérée" },
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
  const isSuperAdmin = user.role === "super_admin";
  useRealtimeSync();

  // Tâche #76: sourdine par section des badges "nouveautes". Mise en sourdine
  // cote serveur (user_preferences.mutedBadges) -> partagee entre appareils.
  // Un badge en sourdine est masque, mais les compteurs des autres sections
  // continuent de tourner normalement.
  const prefsQuery = useGetMyPreferences({
    query: {
      queryKey: getGetMyPreferencesQueryKey(),
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  });
  const mutedBadges = useMemo<BadgeMuteFlags>(
    () => ((prefsQuery.data as any)?.mutedBadges as BadgeMuteFlags | undefined) ?? {},
    [prefsQuery.data],
  );

  // Map des badges: type d'evenement realtime-sync -> { storageKey, route, gated? }
  // Permet de generaliser le compteur "non lus" pour Prospects, Messages, Taches, etc.
  // Les cles localStorage sont scopees par utilisateur (`badge:<userId>:<type>`)
  // pour eviter qu'un compteur fuite d'un compte a l'autre dans un meme navigateur.
  const userScope = user.id ?? "anon";
  const BADGE_CONFIG = useMemo(() => ({
    prospect: { storageKey: `badge:${userScope}:prospect`, route: "/prospects", clearEvent: "prospect-badge-clear", gated: true },
    message: { storageKey: `badge:${userScope}:message`, route: "/messages", clearEvent: "message-badge-clear", gated: false },
    task: { storageKey: `badge:${userScope}:task`, route: "/taches", clearEvent: "task-badge-clear", gated: false },
    call: { storageKey: `badge:${userScope}:call`, route: "/appels", clearEvent: "call-badge-clear", gated: false },
    note: { storageKey: `badge:${userScope}:note`, route: "/notes-internes", clearEvent: "note-badge-clear", gated: false },
    rappel: { storageKey: `badge:${userScope}:rappel`, route: "/notifications", clearEvent: "rappel-badge-clear", gated: false },
  } as const), [userScope]);

  type BadgeKey = keyof typeof BADGE_CONFIG;

  const readStoredCount = (key: string): number => {
    if (typeof window === "undefined") return 0;
    const v = parseInt(window.localStorage.getItem(key) || "0", 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };

  const [badges, setBadges] = useState<Record<BadgeKey, number>>(() => ({
    prospect: readStoredCount(BADGE_CONFIG.prospect.storageKey),
    message: readStoredCount(BADGE_CONFIG.message.storageKey),
    task: readStoredCount(BADGE_CONFIG.task.storageKey),
    call: readStoredCount(BADGE_CONFIG.call.storageKey),
    note: readStoredCount(BADGE_CONFIG.note.storageKey),
    rappel: readStoredCount(BADGE_CONFIG.rappel.storageKey),
  }));

  // File d'approbation (agent autonome) : compteur des propositions en attente.
  // Sondé périodiquement côté serveur (pas via localStorage/SSE comme les autres
  // badges) car il reflète l'état réel de la file, pas un cumul de notifications.
  const [agentQueueCount, setAgentQueueCount] = useState(0);

  const setBadge = (key: BadgeKey, value: number | ((c: number) => number)) => {
    setBadges((prev) => {
      const next = typeof value === "function" ? value(prev[key]) : value;
      try { window.localStorage.setItem(BADGE_CONFIG[key].storageKey, String(next)); } catch {}
      return { ...prev, [key]: next };
    });
  };

  // Tâche #82: dedupe les bumps "call" — un même appel manqué peut
  // arriver sous forme de plusieurs events `updated` successifs
  // (retries webhook Twilio, édition postérieure, etc.).
  const countedCallIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | {
            type?: string;
            action?: string;
            resourceId?: number;
            meta?: { direction?: string; status?: string };
          }
        | undefined;
      if (!detail) return;
      // Tâche #97: les events SSE de type "reminder" alimentent le badge
      // "Rappels" de la sidebar (équivalent web de la tuile mobile).
      // On ne bumper que pour les rappels calendrier (cf. mobile,
      // qui ignore les autres sourceType pour ce compteur).
      let key = detail.type as BadgeKey | undefined;
      if (detail.type === "reminder") {
        const meta = detail.meta as { sourceType?: string } | undefined;
        if (meta?.sourceType !== "calendar_reminder") return;
        key = "rappel";
      }
      if (!key || !(key in BADGE_CONFIG)) return;
      if (BADGE_CONFIG[key].gated && !isSuperAdmin) return;
      if (key === "call") {
        // Tâche #82: ne bumper le badge "Appels" que pour les appels
        // entrants non décrochés (manqués / messagerie). Les appels
        // sortants que la secrétaire vient de passer ou les appels
        // qu'elle a décrochés ne doivent pas alimenter le compteur.
        // On accepte aussi les "updated" parce qu'un appel peut basculer
        // en "manque" via une mise à jour (ex: webhook Twilio).
        if (detail.action !== "created" && detail.action !== "updated") return;
        const meta = detail.meta;
        if (!meta) return;
        if (meta.direction && meta.direction !== "entrant") return;
        if (meta.status !== "manque" && meta.status !== "messagerie") return;
        if (typeof detail.resourceId === "number") {
          if (countedCallIds.current.has(detail.resourceId)) return;
          countedCallIds.current.add(detail.resourceId);
          if (countedCallIds.current.size > 500) {
            const first = countedCallIds.current.values().next().value;
            if (typeof first === "number") countedCallIds.current.delete(first);
          }
        }
      } else if (detail.action !== "created") {
        return;
      }
      setBadge(key, (c) => c + 1);
    };
    const clearListeners = (Object.keys(BADGE_CONFIG) as BadgeKey[]).map((key) => {
      const handler = () => setBadge(key, 0);
      window.addEventListener(BADGE_CONFIG[key].clearEvent, handler);
      return [BADGE_CONFIG[key].clearEvent, handler] as const;
    });
    window.addEventListener("realtime-sync", onSync);
    return () => {
      window.removeEventListener("realtime-sync", onSync);
      clearListeners.forEach(([evt, handler]) => window.removeEventListener(evt, handler));
    };
  }, [isSuperAdmin, BADGE_CONFIG]);

  useEffect(() => {
    (Object.keys(BADGE_CONFIG) as BadgeKey[]).forEach((key) => {
      const route = BADGE_CONFIG[key].route;
      if (location === route || location.startsWith(route + "/")) {
        setBadge(key, 0);
      }
    });
  }, [location, BADGE_CONFIG]);

  useEffect(() => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    let cancelled = false;
    const fetchQueueCount = () => {
      fetch(`${BASE}/api/agent-queue/count`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data && typeof data.pending === "number") setAgentQueueCount(data.pending);
        })
        .catch(() => {});
    };
    fetchQueueCount();
    const interval = setInterval(fetchQueueCount, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [location]);

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

  // Sidebar organisée selon le flux de travail réel d'une secrétaire :
  //   1. ce qu'elle ouvre en arrivant (Aujourd'hui)
  //   2. son activité principale toute la journée (Communication)
  //   3. ses contacts (Carnet d'adresses)
  //   4. son organisation personnelle (Tâches, agenda, pointage)
  //   5. la paperasse (Documents & Rapports)
  //   6. ses assistants IA
  //   7. les indicateurs (Analyse, plutôt côté management)
  //   8. les plateformes connectées (Intégrations)
  //   9. l'administration (admin/super_admin)
  //  10. la configuration / l'installation (rare, donc en bas)
  const navGroups = useMemo(() => {
    const isAdmin = user.role === "super_admin" || user.role === "administrateur";
    const canUseAi = user.role !== "lecture_seule";

    return [
      {
        label: "Aujourd'hui",
        items: [
          { name: "Tableau de bord", href: "/", icon: LayoutDashboard },
          ...(canUseAi ? [{ name: "Assistant proactif", href: "/assistant-proactif", icon: Sparkles }] : []),
          ...(canUseAi ? [{ name: "Ce que l'IA a appris", href: "/ia-apprentissage", icon: Brain }] : []),
          { name: "Calendrier", href: "/calendrier", icon: Calendar },
          { name: "Rappels", href: "/notifications", icon: Bell, badge: mutedBadges.rappel ? 0 : badges.rappel },
          { name: "Activité récente", href: "/activite-recente", icon: Activity },
        ],
      },
      {
        label: "Communication",
        items: [
          { name: "Appels", href: "/appels", icon: Phone, badge: mutedBadges.call ? 0 : badges.call },
          { name: "Messages", href: "/messages", icon: MessageSquare, badge: mutedBadges.message ? 0 : badges.message },
          { name: "WhatsApp clients", href: "/whatsapp", icon: MessageCircle },
          ...(canUseAi ? [{ name: "Agent Mail IA", href: "/gmail-agent", icon: Mail }] : []),
          { name: "Centre de sécurité", href: "/securite", icon: ShieldCheck },
          ...(canUseAi ? [{ name: "Recherche web", href: "/recherche-web", icon: Search }] : []),
        ],
      },
      {
        label: "Carnet d'adresses",
        items: [
          { name: "Contacts", href: "/contacts", icon: Users },
          // Prospects est desormais un module backoffice (super-admin uniquement).
          // Voir le panneau /admin pour la gestion commerciale (leads, devis,
          // factures B2B, stock de licences). Refactor "Admin Backoffice +
          // Müşteri Sadeleştirme" — Tâche #52.
          ...(isSuperAdmin ? [{ name: "Prospects", href: "/prospects", icon: Target, badge: mutedBadges.prospect ? 0 : badges.prospect }] : []),
        ],
      },
      {
        label: "Organisation du travail",
        items: [
          { name: "Tâches", href: "/taches", icon: CheckSquare, badge: mutedBadges.task ? 0 : badges.task },
          { name: "Projets", href: "/projets", icon: Puzzle },
          { name: "Trésorerie & Risque", href: "/tresorerie", icon: Wallet },
          ...(canUseAi ? [{ name: "Saisie vocale chantier", href: "/saisie-chantier", icon: HardHat }] : []),
          { name: "Notes internes", href: "/notes-internes", icon: StickyNote, badge: mutedBadges.note ? 0 : badges.note },
          { name: "Pointage", href: "/pointage", icon: Clock },
          ...(isAdmin ? [{ name: "Localisation equipe", href: "/equipe/localisation", icon: MapPin }] : []),
        ],
      },
      {
        label: "Documents & Rapports",
        items: [
          { name: "Documents", href: "/documents", icon: FileText },
          ...(canUseAi ? [{ name: "Base de connaissances", href: "/base-connaissances", icon: BookOpen }] : []),
          ...(canUseAi ? [{ name: "Document IA", href: "/document-ia", icon: ScanSearch }] : []),
          { name: "Rapports", href: "/rapports", icon: ClipboardList },
          ...(isAdmin ? [{ name: "Rapport exécutif", href: "/rapport-executif", icon: BarChart3 }] : []),
        ],
      },
      ...(canUseAi
        ? [{
            label: "Assistants IA",
            items: [
              { name: "Équipe IA", href: "/equipe-ia", icon: Brain },
              { name: "Commandant IA", href: "/commandant-ia", icon: Sparkles },
              { name: "File d'approbation", href: "/file-approbation", icon: Inbox, badge: mutedBadges.agentQueue ? 0 : agentQueueCount },
              ...(isAdmin ? [{ name: "Auto-audit", href: "/auto-audit", icon: ScanSearch }] : []),
              { name: "Assistant Universel", href: "/asistan", icon: Sparkles },
              { name: "Agents IA", href: "/agents-ia", icon: Brain },
              ...(isAdmin ? [{ name: "Automatisations", href: "/automatisations", icon: Zap }] : []),
            ],
          }]
        : []),
      {
        label: "Analyse",
        items: [
          { name: "Statistiques", href: "/analyse", icon: BarChart },
          ...(isAdmin ? [{ name: "Performance équipe", href: "/performance", icon: Trophy }] : []),
        ],
      },
      {
        label: "Intégrations",
        items: [
          { name: "Google Workspace", href: "/google-workspace", icon: Globe },
          { name: "Téléphonie", href: "/telephonie", icon: PhoneCall },
          { name: "Connecteurs", href: "/logiciels", icon: Plug },
        ],
      },
      ...(isAdmin
        ? [{
            label: "Administration",
            items: [
              { name: "Utilisateurs", href: "/utilisateurs", icon: UserCog },
              { name: "Licence & Facturation", href: "/gestion-licence", icon: CreditCard },
              { name: "Protection des données", href: "/protection-donnees", icon: Shield },
              ...(isSuperAdmin ? [{ name: "Organisations", href: "/organisations", icon: KeyRound }] : []),
            ],
          }]
        : []),
      // Backoffice SaaS — visible uniquement pour le super-admin (proprietaire SaaS).
      // Centralise la gestion commerciale: prospects (leads), devis kurumsal,
      // factures B2B, stock de licences, dashboard MRR/churn.
      ...(isSuperAdmin
        ? [{
            label: "Backoffice SaaS",
            items: [
              { name: "Admin", href: "/admin", icon: Shield },
            ],
          }]
        : []),
      {
        label: "Système",
        items: [
          { name: "Paramètres", href: "/parametres", icon: Settings },
          { name: "Import intelligent", href: "/import", icon: Download },
          { name: "Configuration initiale", href: "/onboarding", icon: Rocket },
          { name: "Application mobile", href: "/telecharger", icon: Smartphone },
        ],
      },
    ].filter(g => g.items.length > 0);
  }, [user.role, isSuperAdmin, badges, agentQueueCount, mutedBadges]);


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
                  className="h-8 w-8 rounded-lg object-contain border border-sidebar-border bg-white dark:bg-sidebar-accent shrink-0"
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
                    {group.items.map((item) => {
                      const badgeCount = (item as { badge?: number }).badge ?? 0;
                      return (
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
                          {badgeCount > 0 && (
                            <SidebarMenuBadge
                              className="bg-emerald-500 text-white"
                              data-testid={`sidebar-badge-${item.name.toLowerCase().replace(/\s+/g, "-")}`}
                              aria-label={`${badgeCount} nouveau${badgeCount > 1 ? "x" : ""} ${item.name.toLowerCase()}`}
                            >
                              {badgeCount > 99 ? "99+" : badgeCount}
                            </SidebarMenuBadge>
                          )}
                        </SidebarMenuItem>
                      );
                    })}
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
              {isSuperAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      onClick={() => incomingCall.simulateIncomingCall()}
                      aria-label="Simuler un appel entrant (test)"
                      title="Simuler un appel entrant (test)"
                    >
                      <PhoneIncoming className="w-5 h-5" />
                      <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Simuler un appel entrant (test)</TooltipContent>
                </Tooltip>
              )}
              <ConnectionIndicator />
              <SmartBrowserToolbar />
              <AgentRunChip />
              <div className="w-px h-4 bg-border" />
              <ThemeToggle />
              <ExportMenu />
              <AiHealthBadge />
              <NotificationBell />
              
              
              <UserProfileButton />
            </div>
          </header>
          
          <LicenseStatusBanner />
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
        <HelpCenter />
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
