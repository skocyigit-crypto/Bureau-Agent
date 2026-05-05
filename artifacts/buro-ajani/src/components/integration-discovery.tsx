import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  X, Zap, CheckCircle2, AlertCircle, Clock, ChevronRight,
  Wifi, RefreshCw, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiFetch = (path: string) => fetch(`${BASE}/api${path}`, { credentials: "include" }).then(r => r.json());

const STORAGE_KEY = "adb-discovery-dismissed-v1";
const NUDGE_DELAY_MS = 5 * 1000;

interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  status: "connecte" | "disponible" | "non_configure";
  statusLabel: string;
  actionLabel: string;
  actionPath: string;
  envConfigured: boolean;
  details?: string;
  connectedCount?: number;
}

interface DiscoverySummary {
  total: number;
  connected: number;
  available: number;
  notConfigured: number;
  fullyConnected: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  telephonie: "Téléphonie",
  google: "Google Workspace",
  ia: "Intelligence Artificielle",
  email: "Email",
  productivite: "Productivité",
  autre: "Autre",
};

const STATUS_CONFIG = {
  connecte: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    icon: CheckCircle2,
    color: "text-emerald-500",
  },
  disponible: {
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Zap,
    color: "text-blue-500",
  },
  non_configure: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    icon: AlertCircle,
    color: "text-amber-500",
  },
};

function getDismissedAt(): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? parseInt(v) : null;
  } catch { return null; }
}

function setDismissed() {
  try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
}

function shouldShow(summary: DiscoverySummary | undefined): boolean {
  if (!summary) return false;
  if (summary.fullyConnected) return false;
  if (summary.available === 0 && summary.notConfigured === 0) return false;

  const dismissed = getDismissedAt();
  if (dismissed && Date.now() - dismissed < 24 * 60 * 60 * 1000) return false;

  return true;
}

export function IntegrationDiscovery() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const [nudgeTimer, setNudgeTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["discovery-scan"],
    queryFn: () => apiFetch("/discovery/scan"),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const summary: DiscoverySummary | undefined = data?.summary;
  const services: Service[] = data?.services || [];

  useEffect(() => {
    if (!summary) return;
    if (!shouldShow(summary)) return;

    const timer = setTimeout(() => setNudgeVisible(true), NUDGE_DELAY_MS);
    setNudgeTimer(timer);
    return () => clearTimeout(timer);
  }, [summary]);

  const handleOpen = () => {
    setNudgeVisible(false);
    if (nudgeTimer) clearTimeout(nudgeTimer);
    setOpen(true);
  };

  const handleDismiss = () => {
    setNudgeVisible(false);
    setOpen(false);
    setDismissed();
    if (nudgeTimer) clearTimeout(nudgeTimer);
  };

  const handleAction = (service: Service) => {
    setOpen(false);
    const path = service.actionPath;
    const baseStripped = BASE || "";
    const fullPath = path.startsWith("/") ? path : `/${path}`;
    navigate(fullPath);
  };

  const categories = [...new Set(services.map(s => s.category))];
  const availableServices = services.filter(s => s.status === "disponible");
  const connectedServices = services.filter(s => s.status === "connecte");
  const notConfiguredServices = services.filter(s => s.status === "non_configure");

  if (isLoading) return null;

  return (
    <>
      {nudgeVisible && !open && (
        <div className="fixed bottom-20 right-4 z-40 animate-in slide-in-from-bottom-4 duration-300 md:bottom-6 md:right-20">
          <div
            className="flex items-center gap-3 bg-card border border-border rounded-xl shadow-lg px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors max-w-xs"
            onClick={handleOpen}
          >
            <div className="relative shrink-0">
              <div className="p-2 rounded-lg bg-primary/10">
                <Wifi className="h-4 w-4 text-primary" />
              </div>
              {(summary?.available ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {summary!.available}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-none">
                {(summary?.available ?? 0) > 0
                  ? `${summary!.available} connexion(s) disponible(s)`
                  : "Vérifier les intégrations"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {connectedServices.length}/{services.length} services actifs
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <button
              className="ml-1 text-muted-foreground hover:text-foreground shrink-0"
              onClick={e => { e.stopPropagation(); handleDismiss(); }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
          <SheetHeader className="p-6 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10">
                  <Wifi className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <SheetTitle>Intégrations découvertes</SheetTitle>
                  <SheetDescription className="text-xs mt-0.5">
                    Scan automatique de l'environnement
                    {data?.scannedAt && ` · ${new Date(data.scannedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                  </SheetDescription>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                <p className="text-lg font-bold text-emerald-600">{connectedServices.length}</p>
                <p className="text-[10px] text-emerald-600/80">Connectés</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                <p className="text-lg font-bold text-blue-600">{availableServices.length}</p>
                <p className="text-[10px] text-blue-600/80">Disponibles</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                <p className="text-lg font-bold text-amber-600">{notConfiguredServices.length}</p>
                <p className="text-[10px] text-amber-600/80">À configurer</p>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {availableServices.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="h-4 w-4 text-blue-500" />
                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">Prêts à connecter</p>
                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px]">
                      {availableServices.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {availableServices.map(svc => (
                      <ServiceCard key={svc.id} service={svc} onAction={() => handleAction(svc)} />
                    ))}
                  </div>
                </div>
              )}

              {connectedServices.length > 0 && (
                <div>
                  <Separator className="mb-4" />
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Actifs</p>
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">
                      {connectedServices.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {connectedServices.map(svc => (
                      <ServiceCard key={svc.id} service={svc} onAction={() => handleAction(svc)} />
                    ))}
                  </div>
                </div>
              )}

              {notConfiguredServices.length > 0 && (
                <div>
                  <Separator className="mb-4" />
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">À configurer</p>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px]">
                      {notConfiguredServices.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {notConfiguredServices.map(svc => (
                      <ServiceCard key={svc.id} service={svc} onAction={() => handleAction(svc)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 border-t">
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground text-xs" onClick={handleDismiss}>
              Masquer pendant 24h
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ServiceCard({ service, onAction }: { service: Service; onAction: () => void }) {
  const cfg = STATUS_CONFIG[service.status];
  const StatusIcon = cfg.icon;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
      <span className="text-xl shrink-0 mt-0.5">{service.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{service.name}</p>
          <Badge className={`text-[10px] shrink-0 ${cfg.badge}`}>
            <StatusIcon className="h-2.5 w-2.5 mr-1" />
            {service.statusLabel}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{service.description}</p>
        {service.details && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{service.details}</p>
        )}
        <Button
          size="sm"
          variant={service.status === "disponible" ? "default" : "ghost"}
          className="h-6 text-[11px] px-2 mt-2 gap-1"
          onClick={onAction}
        >
          {service.actionLabel}
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function DiscoveryTriggerButton() {
  const { data } = useQuery({
    queryKey: ["discovery-scan"],
    queryFn: () => apiFetch("/discovery/scan"),
    staleTime: 2 * 60 * 1000,
  });

  const [open, setOpen] = useState(false);

  const available = data?.summary?.available ?? 0;
  const connected = data?.summary?.connected ?? 0;
  const total = data?.summary?.total ?? 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-muted/60 transition-colors text-xs text-muted-foreground relative"
        title="Intégrations découvertes"
      >
        <Wifi className={`h-3.5 w-3.5 ${available > 0 ? "text-blue-500" : connected > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
        <span className="hidden md:inline">{connected}/{total}</span>
        {available > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
            {available}
          </span>
        )}
      </button>
      {open && <IntegrationDiscoverySheet onClose={() => setOpen(false)} data={data} />}
    </>
  );
}

function IntegrationDiscoverySheet({ onClose, data }: { onClose: () => void; data: any }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return null;
}
