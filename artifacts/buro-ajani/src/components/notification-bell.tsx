import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Bell, Check, CheckCheck, ExternalLink, AlertTriangle, Info, Lightbulb, Clock, ArrowRight, Phone, MessageSquare, CheckSquare, Receipt, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRIORITY_COLORS: Record<string, string> = {
  urgente: "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400",
  haute: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
  normale: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
};

const TYPE_ICONS: Record<string, any> = {
  alerte: AlertTriangle,
  rappel: Clock,
  info: Info,
  suggestion: Lightbulb,
  appel_manque: Phone,
  message_non_lu: MessageSquare,
  tache_urgente: CheckSquare,
  facture_en_retard: Receipt,
  stock_rupture: Package,
  stock_alerte: Package,
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    async function fetchNotifications() {
      try {
        const res = await fetch(`${baseUrl}/api/notifications?limit=20`, { credentials: "include", signal: controller.signal });
        if (!mounted) return;
        if (!res.ok) return;
        const data = await res.json();
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("[NotificationBell] fetch failed:", err);
      }
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000);
    return () => { mounted = false; controller.abort(); clearInterval(interval); };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function markRead(id: number) {
    try {
      const res = await fetch(`${baseUrl}/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" });
      if (!res.ok) { console.error("[NotificationBell] markRead failed:", res.status); return; }
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) { console.error("[NotificationBell] markRead failed:", err); }
  }

  async function markAllRead() {
    try {
      const res = await fetch(`${baseUrl}/api/notifications/read-all`, { method: "POST", credentials: "include" });
      if (!res.ok) { console.error("[NotificationBell] markAllRead failed:", res.status); return; }
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) { console.error("[NotificationBell] markAllRead failed:", err); }
  }

  function timeAgo(date: string): string {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "A l'instant";
    if (mins < 60) return `Il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Il y a ${hours}h`;
    return `Il y a ${Math.floor(hours / 24)}j`;
  }

  return (
    <div ref={containerRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground relative"
            onClick={() => setOpen(!open)}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 animate-pulse">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-96 bg-card border rounded-xl shadow-xl z-50 max-h-[500px] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  {unreadCount}
                </Badge>
              )}
            </div>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                <CheckCheck className="w-3.5 h-3.5 mr-1" /> Tout lire
              </Button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Aucune notification
              </div>
            ) : (
              notifications.map(n => {
                const Icon = TYPE_ICONS[n.type] || Info;
                const priorityClass = PRIORITY_COLORS[n.priority] || PRIORITY_COLORS.normale;
                return (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b last:border-b-0 transition-colors hover:bg-muted/40 cursor-pointer ${!n.read ? "bg-primary/5" : ""}`}
                    onClick={() => { if (!n.read) markRead(n.id); }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-1.5 rounded-lg border ${priorityClass}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${!n.read ? "" : "text-muted-foreground"}`}>
                            {n.title}
                          </span>
                          {!n.read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                          {n.actionUrl && (
                            <a
                              href={n.actionUrl}
                              className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                              onClick={e => e.stopPropagation()}
                            >
                              Voir <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      {!n.read && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={e => { e.stopPropagation(); markRead(n.id); }}
                        >
                          <Check className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="px-4 py-2 border-t bg-muted/30">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-primary hover:underline font-medium py-1"
            >
              Voir toutes les notifications <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
