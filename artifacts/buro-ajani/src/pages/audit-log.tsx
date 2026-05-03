import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon3D } from "@/components/icon-3d";
import { Shield, ChevronLeft, ChevronRight, Activity, Users, AlertTriangle, Eye, Download, Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const ACTION_COLORS: Record<string, string> = {
  login: "bg-green-100 text-green-700",
  logout: "bg-slate-100 text-slate-700",
  create: "bg-blue-100 text-blue-700",
  update: "bg-amber-100 text-amber-700",
  delete: "bg-red-100 text-red-700",
  view: "bg-purple-100 text-purple-700",
  export: "bg-cyan-100 text-cyan-700",
};

const ACTION_LABELS: Record<string, string> = {
  login: "Connexion",
  logout: "Deconnexion",
  create: "Creation",
  update: "Modification",
  delete: "Suppression",
  view: "Consultation",
  export: "Export",
};

const RESOURCE_LABELS: Record<string, string> = {
  auth: "Authentification",
  contact: "Contact",
  call: "Appel",
  task: "Tache",
  message: "Message",
  stock: "Stock",
  user: "Utilisateur",
  settings: "Parametres",
  calendar: "Calendrier",
};

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");

  const { data: logsData, isLoading } = useQuery({
    queryKey: ["audit-logs", page, actionFilter, resourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (resourceFilter !== "all") params.set("resource", resourceFilter);
      const res = await fetch(`${baseUrl}/api/audit/logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Acces refuse");
      return res.json();
    },
  });

  const { data: statsData } = useQuery({
    queryKey: ["audit-stats"],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/api/audit/stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur chargement statistiques");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Icon3D icon={Shield} variant="navy" size="lg" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Journal d'audit</h1>
          <p className="text-sm text-muted-foreground">Historique complet des actions utilisateurs</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Activity className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.todayTotal || 0}</p>
              <p className="text-xs text-muted-foreground">Actions aujourd'hui</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <Users className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.activeUsers?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Utilisateurs actifs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {statsData?.actionBreakdown?.find((a: any) => a.action === "delete")?.count || 0}
              </p>
              <p className="text-xs text-muted-foreground">Suppressions aujourd'hui</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Activite recente</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Action" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les actions</SelectItem>
                  {Object.entries(ACTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={resourceFilter} onValueChange={v => { setResourceFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Ressource" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les ressources</SelectItem>
                  {Object.entries(RESOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <a href={`${baseUrl}/api/audit/export/csv`} download="journal_audit.csv">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Download className="w-3 h-3" />CSV</Button>
              </a>
              <Button variant="outline" size="sm" className="h-8" title="Imprimer" onClick={() => window.print()}><Printer className="w-3 h-3" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : !logsData?.logs?.length ? (
            <div className="text-center py-8 text-muted-foreground">Aucune activite enregistree</div>
          ) : (
            <div className="space-y-1">
              {logsData.logs.map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {(log.userEmail || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{log.userEmail || "Systeme"}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ACTION_COLORS[log.action] || "bg-gray-100 text-gray-700"}`}>
                        {ACTION_LABELS[log.action] || log.action}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{RESOURCE_LABELS[log.resource] || log.resource}</span>
                      {log.resourceId && <span className="text-xs text-muted-foreground/60">#{log.resourceId}</span>}
                    </div>
                    {log.details && typeof log.details === "object" && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {JSON.stringify(log.details).substring(0, 100)}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {new Date(log.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {logsData && logsData.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <span className="text-xs text-muted-foreground">
                Page {logsData.page} sur {logsData.totalPages} ({logsData.total} entrees)
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= logsData.totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
