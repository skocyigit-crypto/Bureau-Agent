import { useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
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
import ProspectsPage from "@/pages/prospects";
import DevisPage from "@/pages/devis";
import FacturesPage from "@/pages/factures";
import ChantiersPage from "@/pages/chantiers";
import AjandaPage from "@/pages/ajanda";

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
        <Route path="/prospects" component={ProspectsPage} />
        <Route path="/devis" component={DevisPage} />
        <Route path="/factures" component={FacturesPage} />
        <Route path="/chantiers" component={ChantiersPage} />
        <Route path="/ajanda" component={AjandaPage} />
        <Route path="/parametres" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

const AUTO_LOGIN_USER = {
  id: 1,
  email: "admin@agentdebureau.fr",
  nom: "Benoit",
  prenom: "Aurelie",
  role: "super_admin",
  departement: "Direction",
  organisation: "Agent de Bureau SAS",
  avatar: "AB",
  mfaActif: true,
};

function App() {
  const handleLogout = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <WorkspaceUserProvider apiUser={AUTO_LOGIN_USER} onLogout={handleLogout}>
            <AppRoutes />
          </WorkspaceUserProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
