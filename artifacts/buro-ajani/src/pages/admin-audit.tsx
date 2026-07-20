import { useState, useEffect, useCallback } from "react";
import { useWorkspaceUser } from "@/components/workspace-user";
import { AccessDenied } from "@/components/access-denied";
import { ClipboardList, Search, RefreshCw, Shield, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 50;

interface AuditLog {
  id: number;
  organisationId: number | null;
  userId: number | null;
  userEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface OrgOption { id: number; name: string }

interface AuditStats {
  todayTotal: number;
  actionBreakdown: { action: string; count: number }[];
  activeUsers: { userEmail: string | null; count: number }[];
}

export default function AdminAuditPage() {
  const { user } = useWorkspaceUser();
  if (user.role !== "super_admin") return <AccessDenied title="Acces reserve" message="Le journal d'audit global (toutes organisations) est reserve au super-administrateur." />;

  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [userEmail, setUserEmail] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const orgNameById = new Map(orgs.map(o => [o.id, o.name] as const));
  const [stats, setStats] = useState<AuditStats | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (userEmail.trim()) params.set("userEmail", userEmail.trim());
      if (orgFilter !== "all") params.set("organisationId", orgFilter);
      const res = await fetch(`${BASE}/api/audit/logs?${params}`, { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
        setTotal(d.total || 0);
      } else {
        toast({ title: "Erreur", description: "Impossible de charger le journal d'audit.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Chargement echoue.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, userEmail, orgFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [userEmail, orgFilter]);

  useEffect(() => {
    fetch(`${BASE}/api/organisations`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { organisations: [] })
      .then((d: { organisations?: OrgOption[] }) => setOrgs((d.organisations || []).map(o => ({ id: o.id, name: o.name }))))
      .catch(() => { /* non-bloquant */ });
    fetch(`${BASE}/api/audit/stats`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: AuditStats | null) => setStats(d))
      .catch(() => { /* non-bloquant */ });
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (userEmail.trim()) params.set("userEmail", userEmail.trim());
    if (orgFilter !== "all") params.set("organisationId", orgFilter);
    window.open(`${BASE}/api/audit/export/csv?${params}`, "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <ClipboardList className="w-6 h-6 text-primary" /> Journal d'audit global
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              <Shield className="w-3 h-3 mr-1" /> Super-admin
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">Vue globale — activite de toutes les organisations, filtrable par organisation.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="w-4 h-4" /> Exporter CSV</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground">Evenements aujourd'hui (toutes organisations)</p>
            <p className="text-2xl font-bold mt-1">{stats.todayTotal}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Actions les plus frequentes</p>
            <div className="flex flex-wrap gap-1">
              {stats.actionBreakdown.slice(0, 4).map(a => (
                <Badge key={a.action} variant="outline" className="text-[10px]">{a.action} · {a.count}</Badge>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Utilisateurs les plus actifs</p>
            <div className="flex flex-wrap gap-1">
              {stats.activeUsers.slice(0, 3).map(u => (
                <Badge key={u.userEmail ?? "?"} variant="outline" className="text-[10px]">{u.userEmail || "?"} · {u.count}</Badge>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Filtrer par email utilisateur..." value={userEmail} onChange={e => setUserEmail(e.target.value)} className="pl-9" />
        </div>
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Organisation" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les organisations</SelectItem>
            {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : (
        <Card>
          <div className="divide-y">
            {logs.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">Aucun evenement ne correspond a vos filtres.</p>
            ) : logs.map(l => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 text-sm">
                <span className="text-xs text-muted-foreground w-36 shrink-0">
                  {format(new Date(l.createdAt), "dd MMM yyyy HH:mm", { locale: fr })}
                </span>
                <Badge variant="outline" className="text-[10px] hidden md:inline-flex shrink-0">
                  {l.organisationId != null ? (orgNameById.get(l.organisationId) || `Org #${l.organisationId}`) : "—"}
                </Badge>
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-medium">{l.userEmail || "systeme"}</span>
                  {" — "}
                  <span className="text-muted-foreground">{l.action} · {l.resource}{l.resourceId ? ` #${l.resourceId}` : ""}</span>
                </span>
                <span className="text-xs text-muted-foreground hidden lg:block w-28 shrink-0 text-right">{l.ipAddress || ""}</span>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">{total} evenements</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Precedent</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Suivant</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
