import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/home";
import { CookieBanner } from "@/components/CookieBanner";
import { FloatingCallbackButton } from "@/components/FloatingCallbackButton";

const MentionsLegales = lazy(() => import("@/pages/mentions-legales"));
const Confidentialite = lazy(() => import("@/pages/confidentialite"));
const CGU = lazy(() => import("@/pages/cgu"));
const NotFound = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient();

function Router() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/mentions-legales" component={MentionsLegales} />
        <Route path="/confidentialite" component={Confidentialite} />
        <Route path="/cgu" component={CGU} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
          <CookieBanner />
          <FloatingCallbackButton />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
