import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { PwaInstallButton } from "@/components/pwa-install";
import { UpdateBanner } from "@/components/update-banner";
import { VoiceAssistant } from "@/components/VoiceAssistant";

import { Layout } from "@/components/layout";
import OnboardingPage from "@/pages/onboarding";
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
import StockPage from "@/pages/stock";
import CalendarPage from "@/pages/calendar";
import AuditLogPage from "@/pages/audit-log";
import AutomationsPage from "@/pages/automations";
import PerformancePage from "@/pages/performance";
import OrganisationsPage from "@/pages/organisations";
import ProspectsPage from "@/pages/prospects";
import ProjetsPage from "@/pages/projets";
import NotificationsPage from "@/pages/notifications";
import GoogleWorkspacePage from "@/pages/google-workspace";
import DocumentAiPage from "@/pages/document-ai";
import ComptesClientsPage from "@/pages/comptes-clients";
import AbonnementPage from "@/pages/abonnement";
import { useLicenseCheck } from "@/hooks/use-license-check";
import { CommandPalette } from "@/components/command-palette";
import { SmartBrowserOverlays, SmartBrowserShortcuts } from "@/components/smart-browser-panel";
import ExecutiveReportPage from "@/pages/rapport-executif";
import LicenseManagementPage from "@/pages/license-management";
import CommandantIAPage from "@/pages/commandant-ia";
import TelephonyPage from "@/pages/telephony";
import { QuickActionHub } from "@/components/quick-action-hub";

const queryClient = new QueryClient();

function LicenseGate({ children }: { children: React.ReactNode }) {
  const license = useLicenseCheck();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!license.loading && !license.allowed) {
      navigate("/abonnement");
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

function AppRoutes() {
  return (
    <Layout>
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
        <Route path="/stock" component={withLicenseGate(StockPage)} />
        <Route path="/agents-ia" component={withLicenseGate(AiAgentsPage)} />
        <Route path="/calendrier" component={withLicenseGate(CalendarPage)} />
        <Route path="/audit" component={withLicenseGate(AuditLogPage)} />
        <Route path="/automatisations" component={withLicenseGate(AutomationsPage)} />
        <Route path="/performance" component={withLicenseGate(PerformancePage)} />
        <Route path="/prospects" component={withLicenseGate(ProspectsPage)} />
        <Route path="/projets" component={withLicenseGate(ProjetsPage)} />
        <Route path="/google-workspace" component={withLicenseGate(GoogleWorkspacePage)} />
        <Route path="/document-ia" component={withLicenseGate(DocumentAiPage)} />
        <Route path="/comptes-clients" component={withLicenseGate(ComptesClientsPage)} />
        <Route path="/abonnement" component={AbonnementPage} />
        <Route path="/organisations" component={OrganisationsPage} />
        <Route path="/parametres" component={SettingsPage} />
        <Route path="/rapport-executif" component={withLicenseGate(ExecutiveReportPage)} />
        <Route path="/gestion-licence" component={withLicenseGate(LicenseManagementPage)} />
        <Route path="/commandant-ia" component={withLicenseGate(CommandantIAPage)} />
        <Route path="/telephonie" component={withLicenseGate(TelephonyPage)} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [authState, setAuthState] = useState<"loading" | "login" | "register" | "authenticated">("loading");
  const [currentUser, setCurrentUser] = useState<any>(null);

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
      } else {
        setAuthState("login");
      }
    } catch {
      setAuthState("login");
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const [showOnboarding, setShowOnboarding] = useState(false);

  const handleLogin = (user: any) => {
    setCurrentUser(user);
    const onboardingKey = `adb-onboarding-done-${user.id}`;
    if (!localStorage.getItem(onboardingKey)) {
      setShowOnboarding(true);
    }
    setAuthState("authenticated");
  };

  const handleLogout = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (err) { console.warn("[App] logout request failed:", err); }
    setCurrentUser(null);
    setAuthState("login");
    queryClient.clear();
  }, []);

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
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            {authState === "login" ? (
              <LoginPage onLogin={handleLogin} onRegister={() => setAuthState("register")} />
            ) : authState === "register" ? (
              <RegisterPage onLogin={handleLogin} onBack={() => setAuthState("login")} />
            ) : (
              <WorkspaceUserProvider apiUser={currentUser} onLogout={handleLogout}>
                {showOnboarding ? (
                  <OnboardingPage onComplete={() => {
                    if (currentUser?.id) localStorage.setItem(`adb-onboarding-done-${currentUser.id}`, "1");
                    setShowOnboarding(false);
                  }} />
                ) : (
                  <>
                    <UpdateBanner />
                    <CommandPalette />
                    <SmartBrowserOverlays />
                    <SmartBrowserShortcuts />
                    <AppRoutes />
                    <VoiceAssistant />
                  </>
                )}
              </WorkspaceUserProvider>
            )}
          </WouterRouter>
          <PwaInstallButton />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
