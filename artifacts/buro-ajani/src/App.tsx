import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import { NetworkStatusBanner, SessionExpiredOverlay } from "@/components/safe-component";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { PwaInstallButton } from "@/components/pwa-install";
import { PwaStandaloneRedirect } from "@/components/pwa-standalone-redirect";
import { UpdateBanner } from "@/components/update-banner";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import { VoiceLive } from "@/components/VoiceLive";
import { motion, AnimatePresence } from "framer-motion";
import { MotionProvider } from "@/components/premium-animations";
import { useDeviceEnvironment, DeviceEnvironmentProvider } from "@/hooks/use-device-environment";

import { Layout } from "@/components/layout";
import { useLicenseCheck } from "@/hooks/use-license-check";
import { CommandPalette } from "@/components/command-palette";
import { SmartBrowserOverlays, SmartBrowserShortcuts } from "@/components/smart-browser-panel";
import { QuickActionHub } from "@/components/quick-action-hub";

// Route-level code splitting. Keep the application shell synchronous, but do
// not make login/public visitors download every authenticated feature page.
const NotFound = lazy(() => import("@/pages/not-found"));
const LoginPage = lazy(() => import("@/pages/login"));
const RegisterPage = lazy(() => import("@/pages/register"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Calls = lazy(() => import("@/pages/calls"));
const CallDetail = lazy(() => import("@/pages/call-detail"));
const Contacts = lazy(() => import("@/pages/contacts"));
const WhatsappInbox = lazy(() => import("@/pages/whatsapp"));
const ContactDetail = lazy(() => import("@/pages/contact-detail"));
const Tasks = lazy(() => import("@/pages/tasks"));
const Messages = lazy(() => import("@/pages/messages"));
const Analytics = lazy(() => import("@/pages/analytics"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const GuidePage = lazy(() => import("@/pages/guide"));
const SanteTechniquePage = lazy(() => import("@/pages/sante-technique"));
const Reports = lazy(() => import("@/pages/reports"));
const Software = lazy(() => import("@/pages/software"));
const UsersPage = lazy(() => import("@/pages/users"));
const CheckinsPage = lazy(() => import("@/pages/checkins"));
const AiAgentsPage = lazy(() => import("@/pages/ai-agents"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const AutomationsPage = lazy(() => import("@/pages/automations"));
const PerformancePage = lazy(() => import("@/pages/performance"));
const OrganisationsPage = lazy(() => import("@/pages/organisations"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const GoogleWorkspacePage = lazy(() => import("@/pages/google-workspace"));
const GmailAgentPage = lazy(() => import("@/pages/gmail-agent"));
const DocumentAiPage = lazy(() => import("@/pages/document-ai"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const DocumentImportPage = lazy(() => import("@/pages/document-import"));
const KnowledgeBasePage = lazy(() => import("@/pages/knowledge-base"));
const ExecutiveReportPage = lazy(() => import("@/pages/rapport-executif"));
const LicenseManagementPage = lazy(() => import("@/pages/license-management"));
const CommandantIAPage = lazy(() => import("@/pages/commandant-ia"));
const AsistanPage = lazy(() => import("@/pages/asistan"));
const TelephonyPage = lazy(() => import("@/pages/telephony"));
const TelechargerPage = lazy(() => import("@/pages/telecharger"));
const InvitationAcceptPage = lazy(() => import("@/pages/invitation-accept"));
const RendezVousPublicPage = lazy(() => import("@/pages/rendez-vous-public"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const ProspectsPage = lazy(() => import("@/pages/prospects"));
const ProspectDetail = lazy(() => import("@/pages/prospect-detail"));
const AdminBackofficePage = lazy(() => import("@/pages/admin"));
const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard"));
const AdminDevisPage = lazy(() => import("@/pages/admin-devis"));
const AdminAuditPage = lazy(() => import("@/pages/admin-audit"));
const AdminFacturesB2BPage = lazy(() => import("@/pages/admin-factures-b2b"));
const AdminFacturesClientPage = lazy(() => import("@/pages/admin-factures-client"));
const NotesInternesPage = lazy(() => import("@/pages/notes-internes"));
const DataProtectionPage = lazy(() => import("@/pages/data-protection"));
const ContactsImportPage = lazy(() => import("@/pages/contacts-import"));
const ActiviteRecentePage = lazy(() => import("@/pages/activite-recente"));
const ProjetsPage = lazy(() => import("@/pages/projets"));
const SecuritePage = lazy(() => import("@/pages/securite"));
const AssistantProactifPage = lazy(() => import("@/pages/assistant-proactif"));
const IaApprentissagePage = lazy(() => import("@/pages/ia-apprentissage"));
const RechercheWebPage = lazy(() => import("@/pages/recherche-web"));
const EquipeLocalisationPage = lazy(() => import("@/pages/equipe-localisation"));
const FileApprobationPage = lazy(() => import("@/pages/file-approbation"));
const EquipeIaPage = lazy(() => import("@/pages/equipe-ia"));
const AuditDenetimPage = lazy(() => import("@/pages/audit-denetim"));
const VoiceSiteOpsPage = lazy(() => import("@/pages/voice-site-ops"));
const TresoreriePage = lazy(() => import("@/pages/tresorerie"));
const DepensesPage = lazy(() => import("@/pages/depenses"));

function PageLoader() {
  return (
    <div className="flex min-h-64 items-center justify-center" role="status" aria-label="Chargement">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Ne PAS rejouer les erreurs 4xx: elles sont definitives (403 licence
      // bloquee, 401 session expiree, 404). Les rejouer triplait la charge
      // exactement quand le serveur etait deja en difficulte, et retardait
      // l'affichage du vrai message d'erreur de plusieurs secondes.
      retry: (failureCount, error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (typeof status === "number" && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

/**
 * Motifs de blocage que l'utilisateur ne peut PAS resoudre depuis l'ecran de
 * licence. Le rediriger la-bas ne ferait que l'y bloquer aussi (un `agent` n'y
 * a meme pas acces): on affiche l'explication a la place.
 */
const BLOCKING_REASONS: Record<string, { title: string; message: string }> = {
  no_org: {
    title: "Compte non rattache a une organisation",
    message: "Votre compte existe mais n'est lie a aucune organisation, ce qui empeche l'application de charger vos donnees. Demandez a votre administrateur de rattacher votre compte a l'organisation.",
  },
  org_inactive: {
    title: "Organisation desactivee",
    message: "L'organisation a laquelle votre compte est rattache a ete desactivee. Contactez votre administrateur pour la reactiver.",
  },
};

function LicenseGate({ children }: { children: React.ReactNode }) {
  const license = useLicenseCheck();
  const [, navigate] = useLocation();
  const blocking = !license.loading && !license.allowed ? BLOCKING_REASONS[license.reason] : undefined;

  useEffect(() => {
    // On ne redirige QUE pour les motifs que l'ecran de licence peut traiter
    // (abonnement expire, suspendu...). Pour un compte sans organisation ou une
    // organisation desactivee, cet ecran ne peut rien: l'utilisateur y voyait
    // une page vide ou une erreur de chargement, sans jamais savoir pourquoi
    // l'application ne s'ouvrait pas.
    if (!license.loading && !license.allowed && !blocking) {
      navigate("/gestion-licence");
    }
  }, [license.loading, license.allowed, blocking, navigate]);

  if (license.loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  if (blocking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold">{blocking.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{blocking.message}</p>
          <p className="text-xs text-muted-foreground/70">
            Support : <a className="underline" href="mailto:support@agentdebureau.fr">support@agentdebureau.fr</a>
          </p>
        </div>
      </div>
    );
  }

  if (!license.allowed) return null;

  return <>{children}</>;
}

/**
 * Enveloppe un composant de page dans le controle de licence.
 *
 * Le resultat est MEMOISE par composant. Sans cela, chaque appel renvoyait une
 * nouvelle fonction: comme ces appels ont lieu dans le rendu de `AppRoutes`
 * (qui se re-rend a chaque changement d'URL), React voyait un type d'element
 * different a chaque fois et demontait/remontait toute la page. Chaque remontage
 * remettait `useLicenseCheck` a `loading: true` — donc un spinner — et relancait
 * l'appel de verification plus toutes les requetes de la page. Sur un compte non
 * super-admin, ou chaque requete coute deux allers-retours supplementaires en
 * base, cela suffisait a saturer le pool a repetition.
 */
const licenseGateCache = new Map<React.ComponentType, React.ComponentType<any>>();

function withLicenseGate(Component: React.ComponentType) {
  const cached = licenseGateCache.get(Component);
  if (cached) return cached;
  const Gated = function GatedComponent(props: any) {
    return <LicenseGate><Component {...props} /></LicenseGate>;
  };
  licenseGateCache.set(Component, Gated);
  return Gated;
}

function AnimatedRouteContent({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <motion.div
      key={location}
      initial={{ opacity: 0, y: prefersReduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: prefersReduced ? 0 : -6 }}
      transition={{ duration: prefersReduced ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  return (
    <Layout>
      <AnimatePresence mode="wait">
        <AnimatedRouteContent key={location}>
      <Switch>
        <Route path="/" component={withLicenseGate(Dashboard)} />
        <Route path="/appels" component={withLicenseGate(Calls)} />
        <Route path="/appels/:id" component={withLicenseGate(CallDetail)} />
        <Route path="/contacts" component={withLicenseGate(Contacts)} />
        <Route path="/contacts/:id" component={withLicenseGate(ContactDetail)} />
        <Route path="/taches" component={withLicenseGate(Tasks)} />
        <Route path="/tresorerie" component={withLicenseGate(TresoreriePage)} />
        <Route path="/depenses" component={withLicenseGate(DepensesPage)} />
        <Route path="/messages" component={withLicenseGate(Messages)} />
        <Route path="/whatsapp" component={withLicenseGate(WhatsappInbox)} />
        <Route path="/rapports" component={withLicenseGate(Reports)} />
        <Route path="/logiciels" component={withLicenseGate(Software)} />
        <Route path="/analyse" component={withLicenseGate(Analytics)} />
        <Route path="/utilisateurs" component={withLicenseGate(UsersPage)} />
        <Route path="/pointage" component={withLicenseGate(CheckinsPage)} />
        <Route path="/agents-ia" component={withLicenseGate(AiAgentsPage)} />
        <Route path="/calendrier" component={withLicenseGate(CalendarPage)} />
        <Route path="/audit" component={() => { const [, nav] = useLocation(); useEffect(() => nav("/auto-audit"), []); return null; }} />
        <Route path="/automatisations" component={withLicenseGate(AutomationsPage)} />
        <Route path="/performance" component={withLicenseGate(PerformancePage)} />
        <Route path="/google-workspace" component={withLicenseGate(GoogleWorkspacePage)} />
        <Route path="/gmail-agent" component={withLicenseGate(GmailAgentPage)} />
        <Route path="/document-ia" component={withLicenseGate(DocumentAiPage)} />
        <Route path="/documents" component={withLicenseGate(DocumentsPage)} />
        <Route path="/base-connaissances" component={withLicenseGate(KnowledgeBasePage)} />
        <Route path="/import" component={withLicenseGate(DocumentImportPage)} />
        <Route path="/abonnement" component={() => { const [, nav] = useLocation(); useEffect(() => nav(`/gestion-licence${window.location.search}`), []); return null; }} />
        <Route path="/organisations" component={OrganisationsPage} />
        <Route path="/parametres" component={SettingsPage} />
        <Route path="/guide" component={GuidePage} />
        <Route path="/sante-technique" component={SanteTechniquePage} />
        <Route path="/rapport-executif" component={withLicenseGate(ExecutiveReportPage)} />
        <Route path="/gestion-licence" component={LicenseManagementPage} />
        <Route path="/commandant-ia" component={withLicenseGate(CommandantIAPage)} />
        <Route path="/asistan" component={withLicenseGate(AsistanPage)} />
        <Route path="/telephonie" component={withLicenseGate(TelephonyPage)} />
        <Route path="/telecharger" component={TelechargerPage} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route path="/onboarding" component={() => <OnboardingPage />} />
        <Route path="/prospects" component={withLicenseGate(ProspectsPage)} />
        <Route path="/prospects/:id" component={withLicenseGate(ProspectDetail)} />
        {/* Backoffice SaaS — gate cote composant (super-admin only). Tâche #52. */}
        <Route path="/admin" component={AdminBackofficePage} />
        <Route path="/admin/dashboard" component={AdminDashboardPage} />
        {/* Pas de licence-gate sur /admin/* : la garde est par role super-admin (cf. /admin/devis et /admin/factures-b2b). */}
        <Route path="/admin/prospects" component={ProspectsPage} />
        <Route path="/admin/devis" component={AdminDevisPage} />
        <Route path="/admin/factures-b2b" component={AdminFacturesB2BPage} />
        <Route path="/admin/factures-client" component={AdminFacturesClientPage} />
        <Route path="/admin/audit" component={AdminAuditPage} />
        <Route path="/notes-internes" component={withLicenseGate(NotesInternesPage)} />
        <Route path="/protection-donnees" component={withLicenseGate(DataProtectionPage)} />
        <Route path="/contacts/import" component={withLicenseGate(ContactsImportPage)} />
        <Route path="/activite-recente" component={withLicenseGate(ActiviteRecentePage)} />
        <Route path="/projets" component={withLicenseGate(ProjetsPage)} />
        <Route path="/saisie-chantier" component={withLicenseGate(VoiceSiteOpsPage)} />
        <Route path="/securite" component={withLicenseGate(SecuritePage)} />
        <Route path="/assistant-proactif" component={withLicenseGate(AssistantProactifPage)} />
        <Route path="/ia-apprentissage" component={withLicenseGate(IaApprentissagePage)} />
        <Route path="/recherche-web" component={withLicenseGate(RechercheWebPage)} />
        <Route path="/equipe/localisation" component={withLicenseGate(EquipeLocalisationPage)} />
        <Route path="/file-approbation" component={withLicenseGate(FileApprobationPage)} />
        <Route path="/equipe-ia" component={withLicenseGate(EquipeIaPage)} />
        <Route path="/auto-audit" component={withLicenseGate(AuditDenetimPage)} />
        <Route component={NotFound} />
      </Switch>
        </AnimatedRouteContent>
      </AnimatePresence>
    </Layout>
  );
}

function InvitationOrApp({
  authState,
  currentUser,
  handleLogin,
  handleLogout,
  setAuthState,
}: {
  authState: "loading" | "login" | "register" | "authenticated";
  currentUser: any;
  handleLogin: (user: any) => void;
  handleLogout: () => void;
  setAuthState: (s: "loading" | "login" | "register" | "authenticated") => void;
}) {
  const [isInvitation] = useRoute("/invitation/:token");
  const [location, navigate] = useLocation();
  const [liveOpen, setLiveOpen] = useState(false);

  useEffect(() => {
    if (authState === "authenticated" && (location === "/login" || location === "/register")) {
      navigate("/", { replace: true });
    }
  }, [authState, location, navigate]);

  if (isInvitation) {
    return <InvitationAcceptPage />;
  }

  if (authState === "login") {
    return <LoginPage onLogin={handleLogin} onRegister={() => setAuthState("register")} />;
  }
  if (authState === "register") {
    return <RegisterPage onLogin={handleLogin} onBack={() => setAuthState("login")} />;
  }

  return (
    <WorkspaceUserProvider apiUser={currentUser} onLogout={handleLogout}>
      <UpdateBanner />
      <CommandPalette />
      <SmartBrowserOverlays />
      <SmartBrowserShortcuts />
      <AppRoutes />
      <VoiceAssistant onOpenLive={() => setLiveOpen(true)} />
      <VoiceLive open={liveOpen} onClose={() => setLiveOpen(false)} />
    </WorkspaceUserProvider>
  );
}

function AppContent() {
  const [authState, setAuthState] = useState<"loading" | "login" | "register" | "authenticated">("loading");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        credentials: "include",
      });

      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
        setAuthState("authenticated");
        setSessionExpired(false);
      } else {
        setAuthState((prev) => {
          if (prev === "authenticated") {
            setSessionExpired(true);
            return prev;
          }
          return "login";
        });
      }
    } catch {
      setAuthState((prev) => prev === "authenticated" ? prev : "login");
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    const check = async () => {
      try {
        const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
        const res = await fetch(`${baseUrl}/api/auth/me`, { credentials: "include" });
        if (!res.ok) setSessionExpired(true);
      } catch { /* hors ligne: on ne declare pas la session expiree */ }
    };
    // Verification suspendue quand l'onglet est masque: sonder la session d'un
    // onglet que personne ne regarde ne sert a rien et maintient une instance
    // Cloud Run eveillee. Au retour au premier plan on verifie immediatement —
    // c'est justement le moment ou l'utilisateur va agir, donc le moment utile
    // pour detecter une session expiree.
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!interval) interval = setInterval(() => { void check(); }, 5 * 60 * 1000); };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { void check(); start(); } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [authState]);

  const handleLogin = (user: any) => {
    setCurrentUser(user);
    setAuthState("authenticated");
    setSessionExpired(false);
  };

  const handleRelogin = () => {
    setSessionExpired(false);
    setCurrentUser(null);
    setAuthState("login");
    queryClient.clear();
  };

  const handleLogout = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (err) { console.error("[App] logout request failed:", err); }
    setCurrentUser(null);
    setAuthState("login");
    setSessionExpired(false);
    queryClient.clear();
  }, []);

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const isInvitationPath = /\/invitation\/[^/]+/.test(window.location.pathname);
  const isRdvPath = /\/rdv\/[^/]+/.test(window.location.pathname);
  const deviceEnv = useDeviceEnvironment();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.platform = deviceEnv.platform;
    root.dataset.displayMode = deviceEnv.displayMode;
    root.dataset.screenClass = deviceEnv.screenClass;
    root.dataset.inputMode = deviceEnv.inputMode;
    if (deviceEnv.isStandalone) root.classList.add("standalone");
    else root.classList.remove("standalone");
    if (deviceEnv.hasNotch) root.classList.add("has-notch");
    else root.classList.remove("has-notch");
  }, [deviceEnv]);

  if (isInvitationPath) {
    return (
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <InvitationAcceptPage />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }

  if (isRdvPath) {
    return (
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <RendezVousPublicPage />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    );
  }

  if (authState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1729] via-[#1a2744] to-[#0f1729]">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto" />
          <p className="text-white/60 mt-4 text-sm">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DeviceEnvironmentProvider>
        <MotionProvider reducedMotion={deviceEnv.prefersReducedMotion}>
        <TooltipProvider>
          <NetworkStatusBanner />
          {sessionExpired && <SessionExpiredOverlay onRelogin={handleRelogin} />}
          <WouterRouter base={basePath}>
            <InvitationOrApp
              authState={authState}
              currentUser={currentUser}
              handleLogin={handleLogin}
              handleLogout={handleLogout}
              setAuthState={setAuthState}
            />
            <PwaStandaloneRedirect />
          </WouterRouter>
          <PwaInstallButton />
          <Toaster />
        </TooltipProvider>
        </MotionProvider>
        </DeviceEnvironmentProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AppContent />
    </Suspense>
  );
}

export default App;
