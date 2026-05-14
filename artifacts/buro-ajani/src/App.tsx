import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import { NetworkStatusBanner, SessionExpiredOverlay } from "@/components/safe-component";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { PwaInstallButton } from "@/components/pwa-install";
import { UpdateBanner } from "@/components/update-banner";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import { motion, AnimatePresence } from "framer-motion";
import { MotionProvider } from "@/components/premium-animations";
import { useDeviceEnvironment, DeviceEnvironmentProvider } from "@/hooks/use-device-environment";

import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import Contacts from "@/pages/contacts";
import ContactDetail from "@/pages/contact-detail";
import Tasks from "@/pages/tasks";
import Messages from "@/pages/messages";
import Analytics from "@/pages/analytics";
import SettingsPage from "@/pages/settings";
import Reports from "@/pages/reports";
import Software from "@/pages/software";
import UsersPage from "@/pages/users";
import CheckinsPage from "@/pages/checkins";
import AiAgentsPage from "@/pages/ai-agents";
import CalendarPage from "@/pages/calendar";
import AutomationsPage from "@/pages/automations";
import PerformancePage from "@/pages/performance";
import OrganisationsPage from "@/pages/organisations";
import NotificationsPage from "@/pages/notifications";
import GoogleWorkspacePage from "@/pages/google-workspace";
import GmailAgentPage from "@/pages/gmail-agent";
import DocumentAiPage from "@/pages/document-ai";
import DocumentsPage from "@/pages/documents";
import DocumentImportPage from "@/pages/document-import";
import { useLicenseCheck } from "@/hooks/use-license-check";
import { CommandPalette } from "@/components/command-palette";
import { SmartBrowserOverlays, SmartBrowserShortcuts } from "@/components/smart-browser-panel";
import ExecutiveReportPage from "@/pages/rapport-executif";
import LicenseManagementPage from "@/pages/license-management";
import CommandantIAPage from "@/pages/commandant-ia";
import AsistanPage from "@/pages/asistan";
import TelephonyPage from "@/pages/telephony";
import TelechargerPage from "@/pages/telecharger";
import { QuickActionHub } from "@/components/quick-action-hub";
import InvitationAcceptPage from "@/pages/invitation-accept";
import OnboardingPage from "@/pages/onboarding";
import ProspectsPage from "@/pages/prospects";
import ProspectDetail from "@/pages/prospect-detail";
import AdminBackofficePage from "@/pages/admin";
import AdminDashboardPage from "@/pages/admin-dashboard";
import NotesInternesPage from "@/pages/notes-internes";
import DataProtectionPage from "@/pages/data-protection";
import ContactsImportPage from "@/pages/contacts-import";
import ActiviteRecentePage from "@/pages/activite-recente";
import ProjetsPage from "@/pages/projets";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
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

function LicenseGate({ children }: { children: React.ReactNode }) {
  const license = useLicenseCheck();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!license.loading && !license.allowed) {
      navigate("/gestion-licence");
    }
  }, [license.loading, license.allowed, navigate]);

  if (license.loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!license.allowed) return null;

  return <>{children}</>;
}

function withLicenseGate(Component: React.ComponentType) {
  return function GatedComponent(props: any) {
    return <LicenseGate><Component {...props} /></LicenseGate>;
  };
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
        <Route path="/messages" component={withLicenseGate(Messages)} />
        <Route path="/rapports" component={withLicenseGate(Reports)} />
        <Route path="/logiciels" component={withLicenseGate(Software)} />
        <Route path="/analyse" component={withLicenseGate(Analytics)} />
        <Route path="/utilisateurs" component={withLicenseGate(UsersPage)} />
        <Route path="/pointage" component={withLicenseGate(CheckinsPage)} />
        <Route path="/agents-ia" component={withLicenseGate(AiAgentsPage)} />
        <Route path="/calendrier" component={withLicenseGate(CalendarPage)} />
        <Route path="/audit" component={() => { const [, nav] = useLocation(); useEffect(() => nav("/gestion-licence"), []); return null; }} />
        <Route path="/automatisations" component={withLicenseGate(AutomationsPage)} />
        <Route path="/performance" component={withLicenseGate(PerformancePage)} />
        <Route path="/google-workspace" component={withLicenseGate(GoogleWorkspacePage)} />
        <Route path="/gmail-agent" component={withLicenseGate(GmailAgentPage)} />
        <Route path="/document-ia" component={withLicenseGate(DocumentAiPage)} />
        <Route path="/documents" component={withLicenseGate(DocumentsPage)} />
        <Route path="/import" component={withLicenseGate(DocumentImportPage)} />
        <Route path="/abonnement" component={() => { const [, nav] = useLocation(); useEffect(() => nav(`/gestion-licence${window.location.search}`), []); return null; }} />
        <Route path="/organisations" component={OrganisationsPage} />
        <Route path="/parametres" component={SettingsPage} />
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
        <Route path="/notes-internes" component={withLicenseGate(NotesInternesPage)} />
        <Route path="/protection-donnees" component={withLicenseGate(DataProtectionPage)} />
        <Route path="/contacts/import" component={withLicenseGate(ContactsImportPage)} />
        <Route path="/activite-recente" component={withLicenseGate(ActiviteRecentePage)} />
        <Route path="/projets" component={withLicenseGate(ProjetsPage)} />
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
      <VoiceAssistant />
    </WorkspaceUserProvider>
  );
}

function App() {
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
    const interval = setInterval(async () => {
      try {
        const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
        const res = await fetch(`${baseUrl}/api/auth/me`, { credentials: "include" });
        if (!res.ok) setSessionExpired(true);
      } catch {}
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
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

export default App;
