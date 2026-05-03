import { useState, useEffect, useCallback } from "react";
import { Activity, Phone, FileText, Receipt, Package, TrendingUp, ShoppingCart, User, MessageSquare, CheckSquare, RefreshCw, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function fmtDate(d: string) {
  const now = new Date();
  const dt = new Date(d);
  const diff = Math.floor((now.getTime() - dt.getTime()) / 1000);
  if (diff < 60) return "À l'instant";
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Il y a ${Math.floor(diff / 86400)} j`;
  return dt.toLocaleDateString("fr-FR");
}

function fmt(v: any) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));
}

const ENTITY_CONFIG: Record<string, { icon: any; color: string; label: string; href: string }> = {
  devis:    { icon: FileText,    color: "text-blue-500",   label: "Devis",           href: "/devis" },
  facture:  { icon: Receipt,     color: "text-emerald-500", label: "Facture",         href: "/factures-client" },
  prospect: { icon: TrendingUp,  color: "text-amber-500",  label: "Prospect",        href: "/prospects" },
  stock:    { icon: Package,     color: "text-slate-500",  label: "Stock",           href: "/stock" },
  commande: { icon: ShoppingCart, color: "text-violet-500", label: "Bon de Commande", href: "/commandes-fournisseur" },
  contact:  { icon: User,        color: "text-blue-400",   label: "Contact",         href: "/contacts" },
  appel:    { icon: Phone,       color: "text-green-500",  label: "Appel",           href: "/calls" },
  tache:    { icon: CheckSquare, color: "text-orange-500", label: "Tâche",           href: "/tasks" },
  message:  { icon: MessageSquare, color: "text-purple-500", label: "Message",       href: "/messages" },
};

interface ActivityItem {
  type: string; title: string; subtitle?: string; amount?: string; status?: string;
  createdAt: string; href?: string;
}

export default function ActiviteRecentePage() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [devisR, facturesR, prospectsR, commandesR, contactsR] = await Promise.all([
        fetch(`${BASE}/api/devis?limit=20&sortBy=createdAt&sortOrder=desc`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/api/factures-client?limit=20&sortBy=createdAt&sortOrder=desc`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/api/prospects?limit=20&sortBy=createdAt&sortOrder=desc`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/api/commandes-fournisseur?limit=20&sortBy=createdAt&sortOrder=desc`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${BASE}/api/contacts?limit=20&sortBy=createdAt&sortOrder=desc`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const items: ActivityItem[] = [];

      (devisR?.data || []).forEach((d: any) => items.push({
        type: "devis", title: d.reference || `Devis #${d.id}`, subtitle: d.clientName,
        amount: d.totalAmount, status: d.status, createdAt: d.createdAt,
      }));
      (facturesR?.data || []).forEach((f: any) => items.push({
        type: "facture", title: f.reference || `Facture #${f.id}`, subtitle: f.clientName,
        amount: f.totalAmount, status: f.status, createdAt: f.createdAt,
      }));
      (prospectsR?.prospects || []).forEach((p: any) => items.push({
        type: "prospect", title: p.title, subtitle: p.company || p.contactName,
        amount: p.value, status: p.stage, createdAt: p.createdAt,
      }));
      (commandesR?.data || []).forEach((c: any) => items.push({
        type: "commande", title: c.reference || `BC #${c.id}`, subtitle: c.fournisseurName,
        amount: c.totalAmount, status: c.status, createdAt: c.createdAt,
      }));
      (contactsR?.contacts || []).forEach((c: any) => items.push({
        type: "contact", title: `${c.firstName} ${c.lastName}`.trim(), subtitle: c.company || c.email,
        createdAt: c.createdAt,
      }));

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const cutoff = Date.now() - days * 86400000;
      setActivities(items.filter(i => new Date(i.createdAt).getTime() > cutoff).slice(0, 100));
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger l'activité.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const grouped = activities.reduce((acc, item) => {
    const date = new Date(item.createdAt).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (!acc[date]) acc[date] = [];
    acc[date].push(item);
    return acc;
  }, {} as Record<string, ActivityItem[]>);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6 text-blue-500" />Activité Récente</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{activities.length} événement{activities.length !== 1 ? "s" : ""} sur {days} dernier{days !== 1 ? "s" : ""} jour{days !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 border rounded-lg p-1">
            {[7, 14, 30].map(d => (
              <Button key={d} variant={days === d ? "secondary" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => setDays(d)}>{d}j</Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              {[...Array(3)].map((_, j) => <Skeleton key={j} className="h-14 w-full rounded-xl" />)}
            </div>
          ))}
        </div>
      ) : activities.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-muted-foreground">Aucune activité sur {days} jours</p>
            <p className="text-sm text-muted-foreground mt-1">L'activité apparaît dès que vous créez des devis, factures, prospects, etc.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                <Clock className="w-3 h-3" />{date}
              </p>
              <div className="space-y-2">
                {items.map((item, i) => {
                  const cfg = ENTITY_CONFIG[item.type] || ENTITY_CONFIG.devis;
                  const Icon = cfg.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/40 transition-colors border border-transparent hover:border-muted">
                      <div className={`p-2 rounded-lg bg-muted/50 ${cfg.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs px-1.5 py-0">{cfg.label}</Badge>
                          <p className="text-sm font-medium truncate">{item.title}</p>
                        </div>
                        {item.subtitle && <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount && parseFloat(item.amount) > 0 && (
                          <p className="text-sm font-semibold">{fmt(item.amount)} €</p>
                        )}
                        {item.status && <Badge variant="secondary" className="text-xs">{item.status}</Badge>}
                      </div>
                      <Link href={cfg.href}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                          <Activity className="w-3 h-3" />
                        </Button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
