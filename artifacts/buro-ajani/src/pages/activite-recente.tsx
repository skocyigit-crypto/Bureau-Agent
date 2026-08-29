import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { Activity,CheckSquare,Clock,FolderKanban,MessageSquare,Phone,Printer,RefreshCw,TrendingUp,User } from "lucide-react";
import { useCallback,useEffect,useState } from "react";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");


function fmt(v: any) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));
}

const ENTITY_CONFIG: Record<string, { icon: any; color: string; label: string; href: string }> = {
  prospect: { icon: TrendingUp,    color: "text-amber-500",   label: "Prospect",        href: "/prospects" },
  contact:  { icon: User,          color: "text-blue-400",    label: "Contact",         href: "/contacts" },
  appel:    { icon: Phone,         color: "text-green-500",   label: "Appel",           href: "/appels" },
  tache:    { icon: CheckSquare,   color: "text-orange-500",  label: "Tâche",           href: "/taches" },
  message:  { icon: MessageSquare, color: "text-purple-500",  label: "Message",         href: "/messages" },
  projet:   { icon: FolderKanban,  color: "text-indigo-500",  label: "Projet",          href: "/projets" },
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
  const { t } = useTranslation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const safe = (url: string) =>
        fetch(url, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .catch(err => { console.error("[ActiviteRecente] fetch failed:", url, err); return null; });

      const [prospectsR, contactsR, callsR, tasksR, messagesR, projetsR] = await Promise.all([
        safe(`${BASE}/api/prospects?limit=30&sortBy=createdAt&sortOrder=desc`),
        safe(`${BASE}/api/contacts?limit=30&sortBy=createdAt&sortOrder=desc`),
        safe(`${BASE}/api/calls?limit=30&sortBy=createdAt&sortOrder=desc`),
        safe(`${BASE}/api/tasks?limit=30&sortBy=createdAt&sortOrder=desc`),
        safe(`${BASE}/api/messages?limit=30&sortBy=createdAt&sortOrder=desc`),
        safe(`${BASE}/api/projets?limit=20&sortBy=createdAt&sortOrder=desc`),
      ]);

      const items: ActivityItem[] = [];

      (prospectsR?.prospects || []).forEach((p: any) => items.push({
        type: "prospect", title: p.title, subtitle: p.company || p.contactName,
        amount: p.value, status: p.stage, createdAt: p.createdAt,
      }));
      (contactsR?.contacts || []).forEach((c: any) => items.push({
        type: "contact", title: `${c.firstName} ${c.lastName}`.trim(), subtitle: c.company || c.email,
        createdAt: c.createdAt,
      }));
      (callsR?.calls || callsR?.data || []).forEach((c: any) => items.push({
        type: "appel", title: c.phoneNumber || c.contactName || t("activiteRecente.callFallback"),
        subtitle: c.contactName || (c.direction === "inbound" ? t("activiteRecente.incoming") : t("activiteRecente.outgoing")),
        status: c.status, createdAt: c.createdAt,
      }));
      (tasksR?.tasks || tasksR?.data || []).forEach((tk: any) => items.push({
        type: "tache", title: tk.title, subtitle: tk.assignedTo || tk.priority,
        status: tk.status, createdAt: tk.createdAt,
      }));
      (messagesR?.messages || messagesR?.data || []).forEach((m: any) => items.push({
        type: "message", title: m.subject || m.content?.slice(0, 50) || t("activiteRecente.messageFallback"),
        subtitle: m.fromName || m.from, status: m.isRead ? "lu" : "non_lu", createdAt: m.createdAt,
      }));
      (projetsR?.projets || []).forEach((p: any) => items.push({
        type: "projet", title: p.title, subtitle: p.clientName || p.clientCompany,
        status: p.status, createdAt: p.createdAt,
      }));

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const cutoff = Date.now() - days * 86400000;
      setActivities(items.filter(i => new Date(i.createdAt).getTime() > cutoff).slice(0, 150));
    } catch {
      toast({ title: t("activiteRecente.error"), description: t("activiteRecente.loadError"), variant: "destructive" });
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
          <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6 text-blue-500" />{t("activiteRecente.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("activiteRecente.eventsSummary", { count: activities.length, days })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 border rounded-lg p-1">
            {[7, 14, 30].map(d => (
              <Button key={d} variant={days === d ? "secondary" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => setDays(d)}>{d}{t("activiteRecente.dayUnit")}</Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label={t("common.refresh")}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
          <Button variant="outline" size="icon" title={t("activiteRecente.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
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
            <p className="font-medium text-muted-foreground">{t("activiteRecente.emptyTitle", { days })}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("activiteRecente.emptyDesc")}</p>
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
                  const cfg = ENTITY_CONFIG[item.type] || ENTITY_CONFIG.contact;
                  const Icon = cfg.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/40 transition-colors border border-transparent hover:border-muted">
                      <div className={`p-2 rounded-lg bg-muted/50 ${cfg.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs px-1.5 py-0">{t(`activiteRecente.entity.${ENTITY_CONFIG[item.type] ? item.type : "contact"}`)}</Badge>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t("common.viewDetail")}>
                          <Activity className="w-3 h-3" aria-hidden="true" />
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
