import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell, Check, CheckCheck, Trash2, Filter, Phone, Users, CheckSquare, MessageSquare, AlertTriangle, Info, Calendar, ExternalLink, Printer, Receipt, Package, FolderKanban } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error("Erreur");
  if (res.status === 204) return null;
  return res.json();
}

const TYPE_ICONS: Record<string, any> = {
  call: Phone, contact: Users, task: CheckSquare, message: MessageSquare,
  alert: AlertTriangle, info: Info, calendar: Calendar,
  appel_manque: Phone, message_non_lu: MessageSquare, tache_urgente: CheckSquare,
  facture_en_retard: Receipt, stock_rupture: Package, stock_alerte: Package,
  projet_en_retard: FolderKanban,
};

const TYPE_COLORS: Record<string, string> = {
  call: "text-blue-500", contact: "text-emerald-500", task: "text-amber-500",
  message: "text-indigo-500", alert: "text-red-500", info: "text-gray-500", calendar: "text-purple-500",
  appel_manque: "text-blue-500", message_non_lu: "text-indigo-500", tache_urgente: "text-amber-500",
  facture_en_retard: "text-red-500", stock_rupture: "text-red-600", stock_alerte: "text-amber-600",
  projet_en_retard: "text-indigo-600",
};

export default function Notifications() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () => apiFetch(`/notifications${filter === "unread" ? "?unread=true" : ""}`),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // Tâche #97: parité avec mobile — vider le badge "Rappels" de la
      // sidebar si la notif acquittée est un rappel calendrier.
      const target = (data?.notifications || data || []).find((n: any) => n.id === id);
      if (target && (target.type === "rappel" || target.sourceType === "calendar_reminder")) {
        window.dispatchEvent(new CustomEvent("rappel-badge-clear"));
      }
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de marquer la notification comme lue", variant: "destructive" }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiFetch("/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      window.dispatchEvent(new CustomEvent("rappel-badge-clear"));
      toast({ title: "Toutes les notifications lues" });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible de marquer les notifications comme lues", variant: "destructive" }),
  });

  const deleteNotifMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: () => toast({ title: "Erreur", description: "Impossible de supprimer la notification", variant: "destructive" }),
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => apiFetch("/notifications/delete-all", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast({ title: "Notifications supprimees" }); },
    onError: () => toast({ title: "Erreur", description: "Impossible de supprimer les notifications", variant: "destructive" }),
  });

  const notifications = data?.notifications || data || [];
  const unreadCount = notifications.filter((n: any) => !n.read).length;

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={Bell} variant="amber" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-muted-foreground text-sm">
              {unreadCount > 0 ? `${unreadCount} notification${unreadCount > 1 ? "s" : ""} non lue${unreadCount > 1 ? "s" : ""}` : "Toutes les notifications sont lues"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="unread">Non lues</SelectItem>
            </SelectContent>
          </Select>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={() => markAllReadMutation.mutate()}>
              <CheckCheck className="h-4 w-4 mr-1" /> Tout lire
            </Button>
          )}
          {notifications.length > 0 && (
            <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => deleteAllMutation.mutate()}>
              <Trash2 className="h-4 w-4 mr-1" /> Tout supprimer
            </Button>
          )}
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Bell className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Aucune notification</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => {
            const Icon = TYPE_ICONS[n.type] || Info;
            const color = TYPE_COLORS[n.type] || "text-gray-500";
            return (
              <Card key={n.id} className={`transition-all ${!n.read ? "border-l-4 border-l-primary bg-accent/30" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${color}`}><Icon className="h-5 w-5" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`text-sm ${!n.read ? "font-semibold" : ""}`}>{n.title}</p>
                          {n.message && <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!n.read && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Marquer comme lu" onClick={() => markReadMutation.mutate(n.id)}>
                              <Check className="h-3 w-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20" title="Supprimer" onClick={() => deleteNotifMutation.mutate(n.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-muted-foreground">
                          {n.createdAt ? formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: fr }) : ""}
                        </p>
                        {n.actionUrl && (
                          <a
                            href={n.actionUrl}
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                            onClick={() => { if (!n.read) markReadMutation.mutate(n.id); }}
                          >
                            Voir <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
