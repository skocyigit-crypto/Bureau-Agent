import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import { WorkspaceUserProvider } from "@/components/workspace-user";

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
import StockPage from "@/pages/stock";
import CalendarPage from "@/pages/calendar";
import AuditLogPage from "@/pages/audit-log";
import AutomationsPage from "@/pages/automations";
import PerformancePage from "@/pages/performance";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/appels" component={Calls} />
        <Route path="/appels/:id" component={CallDetail} />
        <Route path="/contacts" component={Contacts} />
        <Route path="/contacts/:id" component={ContactDetail} />
        <Route path="/taches" component={Tasks} />
        <Route path="/messages" component={Messages} />
        <Route path="/rapports" component={Reports} />
        <Route path="/logiciels" component={Software} />
        <Route path="/analyse" component={Analytics} />
        <Route path="/utilisateurs" component={UsersPage} />
        <Route path="/pointage" component={CheckinsPage} />
        <Route path="/stock" component={StockPage} />
        <Route path="/agents-ia" component={AiAgentsPage} />
        <Route path="/calendrier" component={CalendarPage} />
        <Route path="/audit" component={AuditLogPage} />
        <Route path="/automatisations" component={AutomationsPage} />
        <Route path="/performance" component={PerformancePage} />
        <Route path="/parametres" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [authState, setAuthState] = useState<"loading" | "login" | "authenticated">("loading");
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

  const handleLogin = (user: any) => {
    setCurrentUser(user);
    setAuthState("authenticated");
  };

  const handleLogout = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}
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
              <LoginPage onLogin={handleLogin} />
            ) : (
              <WorkspaceUserProvider apiUser={currentUser} onLogout={handleLogout}>
                <AppRoutes />
              </WorkspaceUserProvider>
            )}
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
