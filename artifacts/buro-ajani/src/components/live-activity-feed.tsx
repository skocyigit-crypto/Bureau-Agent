import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Phone, Users, CheckSquare, MessageSquare, Target, Calendar, FileText, TrendingUp, Clock, Activity, RefreshCw, Filter, Bell, Zap, ArrowRight, FolderKanban, Receipt } from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { useTranslation } from "@/i18n";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ActivityItem {
  id: string;
  type: "appel" | "contact" | "tache" | "message" | "prospect" | "evenement" | "facture" | "projet";
  action: string;
  title: string;
  description?: string;
  time: string;
  user?: string;
  metadata?: Record<string, any>;
}

// Les libelles lisibles vivent dans les catalogues i18n
// (liveActivityFeed.<labelKey>) et sont rendus via t() a l'affichage.
const typeConfig: Record<string, { icon: typeof Phone; color: string; bg: string; labelKey: string }> = {
  appel: { icon: Phone, color: "text-blue-600", bg: "bg-blue-100", labelKey: "typeAppel" },
  contact: { icon: Users, color: "text-emerald-600", bg: "bg-emerald-100", labelKey: "typeContact" },
  tache: { icon: CheckSquare, color: "text-green-600", bg: "bg-green-100", labelKey: "typeTache" },
  message: { icon: MessageSquare, color: "text-orange-600", bg: "bg-orange-100", labelKey: "typeMessage" },
  evenement: { icon: Calendar, color: "text-indigo-600", bg: "bg-indigo-100", labelKey: "typeEvenement" },
  prospect: { icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-100", labelKey: "typeProspect" },
  facture: { icon: Receipt, color: "text-emerald-600", bg: "bg-emerald-100", labelKey: "typeFacture" },
  projet: { icon: FolderKanban, color: "text-indigo-600", bg: "bg-indigo-100", labelKey: "typeProjet" },
};

export function LiveActivityFeed({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<any>(null);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/dashboard/recent-activity?limit=20`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      const data = Array.isArray(json) ? json : (json.activities || []);

      const items: ActivityItem[] = (data || []).map((item: any, idx: number) => ({
        id: `${item.type}_${item.id || idx}`,
        type: item.type === "call" ? "appel" : item.type === "task" ? "tache" : item.type,
        action: item.action || "creation",
        title: item.title || item.callerName || item.contactName || "Activite",
        description: item.description || item.content || item.notes || "",
        time: item.createdAt || item.time || new Date().toISOString(),
        user: item.userName || "",
      }));

      setActivities(items);
    } catch (err) {
      console.error("Erreur activite:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchActivities, 30000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchActivities]);

  const filteredActivities = filter === "all" ? activities : activities.filter(a => a.type === filter);
  const displayedActivities = compact ? filteredActivities.slice(0, 5) : filteredActivities;

  return (
    <Card className={compact ? "" : "col-span-full"}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className="relative">
              <Activity className="h-4 w-4 text-green-500" />
              {autoRefresh && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
            </div>
            {t("liveActivityFeed.title")}
            <Badge variant="secondary" className="text-[10px]">{activities.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => setAutoRefresh(!autoRefresh)}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "text-green-500 animate-spin" : "text-muted-foreground"}`} style={autoRefresh ? { animationDuration: "3s" } : {}} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{autoRefresh ? t("liveActivityFeed.autoRefreshOn") : t("liveActivityFeed.autoRefreshOff")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        {!compact && (
          <div className="flex gap-1 mt-2 flex-wrap">
            <Badge
              variant={filter === "all" ? "default" : "outline"}
              className="cursor-pointer text-[10px]"
              onClick={() => setFilter("all")}
            >
              {t("liveActivityFeed.all")}
            </Badge>
            {Object.entries(typeConfig).map(([key, config]) => (
              <Badge
                key={key}
                variant={filter === key ? "default" : "outline"}
                className="cursor-pointer text-[10px]"
                onClick={() => setFilter(key)}
              >
                <config.icon className="h-3 w-3 mr-0.5" />
                {t(`liveActivityFeed.${config.labelKey}`)}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : displayedActivities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
            {t("liveActivityFeed.empty")}
          </div>
        ) : (
          <ScrollArea className={compact ? "h-64" : "h-80"}>
            <div className="space-y-1">
              {displayedActivities.map((activity, index) => {
                const config = typeConfig[activity.type] || typeConfig.contact;
                const Icon = config.icon;
                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group"
                  >
                    <div className={`p-1.5 rounded-lg ${config.bg} shrink-0 mt-0.5`}>
                      <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{activity.title}</span>
                        <Badge variant="outline" className="text-[9px] px-1 shrink-0">{t(`liveActivityFeed.${config.labelKey}`)}</Badge>
                      </div>
                      {activity.description && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{activity.description}</p>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                      {formatDistanceToNow(new Date(activity.time), { addSuffix: true, locale: fr })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
