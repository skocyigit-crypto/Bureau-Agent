import { Component, type ReactNode, useState, useEffect, useCallback } from "react";
import { AlertTriangle, RefreshCw, WifiOff, ServerCrash, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";

interface SafeProps {
  children: ReactNode;
  fallbackTitle?: string;
  compact?: boolean;
  onError?: (error: Error) => void;
}

interface SafeState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

export class SafeComponent extends Component<SafeProps, SafeState> {
  constructor(props: SafeProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<SafeState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn("[SafeComponent]", this.props.fallbackTitle || "Unknown", error.message);
    this.props.onError?.(error);
  }

  handleRetry = () => {
    this.setState((s) => ({ hasError: false, error: null, retryCount: s.retryCount + 1 }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.compact) {
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-muted-foreground text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <span className="flex-1 truncate">{this.props.fallbackTitle || "Composant"} temporairement indisponible</span>
            <button onClick={this.handleRetry} className="text-primary hover:underline flex-shrink-0">Reessayer</button>
          </div>
        );
      }

      return (
        <Card className="border-dashed border-amber-500/30">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{this.props.fallbackTitle || "Composant"} temporairement indisponible</p>
              <p className="text-xs text-muted-foreground mt-0.5">Ce module sera retabli automatiquement.</p>
            </div>
            <Button variant="outline" size="sm" onClick={this.handleRetry}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Reessayer
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

export function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setWasOffline(true);
      setTimeout(() => setWasOffline(false), 4000);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white text-center py-2 text-sm font-medium shadow-lg animate-in slide-in-from-top duration-300">
        Connexion internet perdue — Les donnees seront synchronisees a la reconnexion.
      </div>
    );
  }

  if (wasOffline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-emerald-600 text-white text-center py-2 text-sm font-medium shadow-lg animate-in slide-in-from-top duration-300">
        Connexion retablie — Synchronisation en cours...
      </div>
    );
  }

  return null;
}

export function QueryErrorAlert({ error, title, queryKeys }: { error: Error | null; title?: string; queryKeys?: string[][] }) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      if (queryKeys?.length) {
        await Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      } else {
        await queryClient.invalidateQueries();
      }
    } finally {
      setTimeout(() => setRetrying(false), 1000);
    }
  }, [queryClient, queryKeys]);

  if (!error) return null;

  const isNetworkError = error.message?.includes("fetch") || error.message?.includes("network") || error.message?.includes("ERR_");
  const isAuthError = error.message?.includes("401") || error.message?.includes("403");
  const isServerError = error.message?.includes("500") || error.message?.includes("502") || error.message?.includes("503");

  const Icon = isNetworkError ? WifiOff : isAuthError ? ShieldAlert : isServerError ? ServerCrash : AlertTriangle;
  const message = isNetworkError
    ? "Impossible de contacter le serveur. Verifiez votre connexion internet."
    : isAuthError
    ? "Acces refuse. Votre session a peut-etre expire."
    : isServerError
    ? "Le serveur rencontre un probleme temporaire."
    : "Une erreur est survenue lors du chargement des données.";

  return (
    <Card className="border-dashed border-red-500/30 bg-red-500/5">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="p-2.5 rounded-lg bg-red-500/10">
          <Icon className="w-5 h-5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{title || "Erreur de chargement"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "..." : "Reessayer"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function SessionExpiredOverlay({ onRelogin }: { onRelogin: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-7 h-7 text-amber-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Session expiree</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Votre session a expire pour des raisons de securite. Veuillez vous reconnecter.
          </p>
        </div>
        <Button onClick={onRelogin} className="w-full bg-[#1a2744] hover:bg-[#2d3f5e]">
          Se reconnecter
        </Button>
      </div>
    </div>
  );
}
