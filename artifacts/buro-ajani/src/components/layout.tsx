import { AgentRunChip } from "@/components/agent-run-chip";
import { AiAssistantButton } from "@/components/ai-assistant";
import { AiHealthBadge,RecognitionProvider } from "@/components/ai-recognition-panel";
import { DataExportPanel } from "@/components/data-export-panel";
import { ExportMenu } from "@/components/export-menu";
import { GlobalSearch } from "@/components/global-search";
import { HelpCenter } from "@/components/help-center";
import { Icon3D } from "@/components/icon-3d";
import { IncomingCallOverlay,useIncomingCall } from "@/components/incoming-call-overlay";
import { IntegrationDiscovery } from "@/components/integration-discovery";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LicenseStatusBanner } from "@/components/license-status-banner";
import { NotificationBell } from "@/components/notification-bell";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { QuickActionHub } from "@/components/quick-action-hub";
import { SmartBrowserToolbar } from "@/components/smart-browser-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrialBanner } from "@/components/trial-banner";
import { Button } from "@/components/ui/button";
import { Sidebar,SidebarContent,SidebarFooter,SidebarGroup,SidebarGroupContent,SidebarGroupLabel,SidebarHeader,SidebarMenu,SidebarProvider,SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip";
import { UserProfileButton,useWorkspaceUser,WorkspaceUserSidebarInfo } from "@/components/workspace-user";
import { triggerHaptic,useDeviceEnvContext } from "@/hooks/use-device-environment";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { useTranslation } from "@/i18n";
import { getGetMyPreferencesQueryKey,useGetMyPreferences,type BadgeMuteFlags } from "@workspace/api-client-react";
import { BookOpen,Monitor,Phone,PhoneIncoming,Smartphone,Tablet,Wifi,WifiOff } from "lucide-react";
import { createContext,useContext,useEffect,useMemo,useRef,useState } from "react";
import { lecturePartagee } from "@/lib/lecture-partagee";
import { Link,useLocation } from "wouter";
import { titreDePage } from "@/lib/titre-page";
import { EntreeMenu,OngletsDeSection,ReglagesBureau,RetourAuBureau } from "@/components/menu-bureau";
import { BoutonActionRapide,BoutonCommandeVocale,CompteurApprobations,MenuOutils,PassageConsole } from "@/components/ust-cubuk";
import { CONSOLE_PLATEFORME,entreesVisibles,estDansLaConsole,pageDe,pagesDe,REGLAGES_BUREAU,sectionsVisibles,type Rozet,type Section } from "@/lib/gezinti";

type IncomingCallContextType = { simulateIncomingCall: (phone?: string) => void };
const IncomingCallContext = createContext<IncomingCallContextType>({ simulateIncomingCall: () => {} });
export const useSimulateCall = () => useContext(IncomingCallContext);

function ConnectionIndicator() {
  const env = useDeviceEnvContext();
  const { t } = useTranslation();
  const tierConfig = {
    offline: { icon: WifiOff, color: "text-red-500", labelKey: "header.net.offline" },
    slow: { icon: Wifi, color: "text-amber-500", labelKey: "header.net.slow" },
    moderate: { icon: Wifi, color: "text-yellow-500", labelKey: "header.net.moderate" },
    fast: { icon: Wifi, color: "text-emerald-500", labelKey: "header.net.fast" },
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
          <p className="font-medium">{env.platform === "ios" ? "iOS" : env.platform === "macos" ? "macOS" : env.platform === "android" ? "Android" : env.platform === "windows" ? "Windows" : t("header.device")} — {env.screenClass}</p>
          <p className={cfg.color}>{t(cfg.labelKey)}</p>
          {env.isStandalone && <p className="text-emerald-600">{t("header.appMode")}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const incomingCall = useIncomingCall();
  const { user } = useWorkspaceUser();
  const { t } = useTranslation();
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
    // `gated: false` depuis que /prospects est une page tenant: le pipeline
    // appartient a l'organisation connectee, plus au seul proprietaire SaaS.
    prospect: { storageKey: `badge:${userScope}:prospect`, route: "/prospects", clearEvent: "prospect-badge-clear", gated: false },
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
    // Suspendu quand l'onglet est masque: un badge invisible n'a pas besoin
    // d'etre rafraichi, et chaque requete garde une instance Cloud Run
    // eveillee (donc facturee). Le compteur est reactualise des le retour au
    // premier plan.
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!interval) interval = setInterval(fetchQueueCount, 60_000); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { fetchQueueCount(); start(); } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [location]);

  useEffect(() => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    // Le logo et le nom de l organisation changent une fois par an: une lecture
    // partagee evite de les redemander a chaque montage de la mise en page.
    lecturePartagee("org-profile", () =>
      fetch(`${BASE}/api/org-profile`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)), 5 * 60_000)
      .then((data: any) => {
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

  // Le plan du menu vient de `lib/gezinti.ts` : huit sections de travail,
  // reglages du bureau en bas, console plateforme a part. Ici on ne fait que
  // le filtrer par role et y brancher les compteurs.
  const role = user.role;
  const canUseAi = role !== "lecture_seule";
  // Le super-administrateur est dans la console quand il est sur l'une de ses
  // pages ; un autre role n'y entre jamais (les routes le refusent).
  const enConsole = isSuperAdmin && estDansLaConsole(location);
  const sections = useMemo<Section[]>(
    () => (enConsole ? [{ cle: "platformConsole", entrees: entreesVisibles(CONSOLE_PLATEFORME, role) }] : sectionsVisibles(role)),
    [enConsole, role],
  );
  const reglages = useMemo(() => (enConsole ? [] : entreesVisibles(REGLAGES_BUREAU, role)), [enConsole, role]);
  const toutesLesEntrees = useMemo(() => [...sections.flatMap((s) => s.entrees), ...reglages], [sections, reglages]);
  const ici = useMemo(() => pageDe(location, toutesLesEntrees), [location, toutesLesEntrees]);
  const compteurs = useMemo<Record<Rozet, number>>(() => ({
    call: mutedBadges.call ? 0 : badges.call,
    message: mutedBadges.message ? 0 : badges.message,
    prospect: mutedBadges.prospect ? 0 : badges.prospect,
    task: mutedBadges.task ? 0 : badges.task,
    note: mutedBadges.note ? 0 : badges.note,
    rappel: mutedBadges.rappel ? 0 : badges.rappel,
    approbation: mutedBadges.agentQueue ? 0 : agentQueueCount,
  }), [badges, agentQueueCount, mutedBadges]);

  // Chaque page a son titre (RGAA 8.6), tire de la page de menu courante —
  // onglets de section compris.
  const pagesNommees = useMemo(
    () => pagesDe(toutesLesEntrees).map((p) => ({ name: t(`sidebar.items.${p.cle}`), href: p.href })),
    [toutesLesEntrees, t],
  );
  const titrePage = useMemo(() => titreDePage(location, pagesNommees), [location, pagesNommees]);
  useEffect(() => {
    document.title = titrePage;
  }, [titrePage]);


  return (
    <IncomingCallContext.Provider value={{ simulateIncomingCall: incomingCall.simulateIncomingCall }}>
    <RecognitionProvider>
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        {/* Lien d'evitement (WCAG 2.2 — 2.4.1, niveau A). La barre laterale
            compte des dizaines de liens: sans ce raccourci, un utilisateur au
            clavier ou au lecteur d'ecran devait les parcourir tous, sur chaque
            page, avant d'atteindre le contenu. Invisible a la souris, il
            apparait des qu'il recoit le focus. Meme motif que la vitrine. */}
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:font-semibold"
        >
          {t("common.skipToContent")}
        </a>
        <Sidebar collapsible="icon" className="border-r border-sidebar-border">
          <SidebarHeader className="p-4 group-data-[collapsible=icon]:p-2">
            <div className="flex items-center gap-3 px-2 py-1 group-data-[collapsible=icon]:px-0">
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
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-sidebar-foreground font-semibold text-base leading-none truncate">
                  {orgName || "Ajant Bureau"}
                </p>
                <p className="text-sidebar-foreground/60 text-xs mt-1 truncate">
                  {enConsole ? t("sidebar.groups.platformConsole") : user.organisation || "Bureau"}
                </p>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <nav aria-label={t(enConsole ? "sidebar.groups.platformConsole" : "sidebar.mainNav")}>
              {sections.map((section) => (
                <SidebarGroup key={section.cle}>
                  <SidebarGroupLabel>{t(`sidebar.groups.${section.cle}`)}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.entrees.map((entree) => (
                        <EntreeMenu key={entree.cle} entree={entree} ici={ici} compteur={entree.rozet ? compteurs[entree.rozet] : 0} />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </nav>
          </SidebarContent>
          <SidebarFooter className="p-0 gap-0">
            {enConsole ? <RetourAuBureau /> : <ReglagesBureau entrees={reglages} ici={ici} compteurs={compteurs} />}
            <WorkspaceUserSidebarInfo />
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 lg:px-6 sticky top-0 z-10">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              <GlobalSearch />
            </div>
            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              {isSuperAdmin && <PassageConsole enConsole={enConsole} />}
              {/* Simulation d'appel entrant : outil de demonstration du
                  proprietaire, sobre et marque « test » — jamais presente comme
                  un appel reel. */}
              {isSuperAdmin && !enConsole && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden md:inline-flex"
                      onClick={() => incomingCall.simulateIncomingCall()}
                      aria-label={t("header.simulateCall")}
                    >
                      <PhoneIncoming className="w-5 h-5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("header.simulateCall")}</TooltipContent>
                </Tooltip>
              )}
              <AgentRunChip />
              {canUseAi && !enConsole && <CompteurApprobations sayi={compteurs.approbation} />}
              <BoutonCommandeVocale />
              <BoutonActionRapide onOuvrir={() => { triggerHaptic("medium"); setQuickActionOpen(true); }} />
              <div className="w-px h-4 bg-border hidden sm:block" />
              {/* Guide d'utilisation — present sur chaque page (et dans
                  Reglages du bureau > Aide sur telephone). */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label={t("header.guide")}>
                    <Link href="/guide">
                      <BookOpen className="w-5 h-5" aria-hidden="true" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("header.guide")}</TooltipContent>
              </Tooltip>
              <div className="hidden sm:block">
                <LanguageSwitcher variant="compact" />
              </div>
              <MenuOutils>
                <div className="sm:hidden">
                  <LanguageSwitcher variant="compact" />
                </div>
                <ConnectionIndicator />
                <SmartBrowserToolbar />
                <ThemeToggle />
                <ExportMenu />
                <AiHealthBadge />
              </MenuOutils>
              <NotificationBell />
              <UserProfileButton />
            </div>
          </header>
          
          <LicenseStatusBanner />
          <TrialBanner />
          {/* `tabIndex={-1}` est ici la bonne pratique, a l'inverse de son
              usage sur un bouton: il rend cette region focalisable par
              PROGRAMME (le lien d'evitement) sans l'ajouter au parcours de
              tabulation. Sans lui, le saut deplace la vue mais pas le focus,
              et la navigation clavier repart du haut. */}
          <main id="contenu" tabIndex={-1} className="flex-1 p-4 lg:p-8 overflow-auto">
            <div className="mx-auto max-w-6xl">
              <OngletsDeSection ici={ici} />
              {children}
            </div>
          </main>
        </div>
        <AiAssistantButton />
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
