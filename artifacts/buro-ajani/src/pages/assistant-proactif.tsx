import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Sparkles, RefreshCw, Loader2, CheckCircle2, X, ThumbsUp, ThumbsDown,
  Clock, PhoneMissed, CalendarClock, ArrowRight, AlertTriangle, Inbox,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const PROACTIVE_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/proactive";

type Severity = "urgent" | "warning" | "info";
type Status = "pending" | "accepted" | "dismissed" | "done";

interface Suggestion {
  id: number;
  type: string;
  severity: Severity;
  title: string;
  detail: string | null;
  status: Status;
  relatedEntityType: string | null;
  relatedEntityId: number | null;
  actionType: string | null;
  actionPayload: Record<string, unknown> | null;
  feedback: "up" | "down" | null;
  createdAt: string;
}

const SEVERITY_STYLE: Record<Severity, { badge: string; border: string; label: string }> = {
  urgent: { badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", border: "border-l-red-500", label: "Urgent" },
  warning: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", border: "border-l-amber-500", label: "À traiter" },
  info: { badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", border: "border-l-blue-500", label: "Info" },
};

const TYPE_META: Record<string, { label: string; icon: typeof Clock }> = {
  overdue_task: { label: "Tâche en retard", icon: Clock },
  missed_call_followup: { label: "Appel à rappeler", icon: PhoneMissed },
  calendar_conflict: { label: "Conflit d'agenda", icon: CalendarClock },
};

const ACTION_NAV: Record<string, { label: string; path: string }> = {
  open_task: { label: "Ouvrir la tâche", path: "/taches" },
  callback: { label: "Voir l'appel", path: "/appels" },
  open_calendar: { label: "Ouvrir l'agenda", path: "/calendrier" },
};

const FILTERS: Array<{ key: Status; label: string }> = [
  { key: "pending", label: "En attente" },
  { key: "accepted", label: "Acceptées" },
  { key: "dismissed", label: "Ignorées" },
  { key: "done", label: "Résolues" },
];

export default function AssistantProactifPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [counts, setCounts] = useState({ urgent: 0, warning: 0, info: 0 });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<Status>("pending");
  const [enabled, setEnabled] = useState(true);

  const load = useCallback(async (status: Status) => {
    setLoading(true);
    try {
      const res = await fetch(`${PROACTIVE_API}/suggestions?status=${status}`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
      setCounts(data.counts ?? { urgent: 0, warning: 0, info: 0 });
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les suggestions.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(filter); }, [filter, load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${PROACTIVE_API}/settings`, { credentials: "include" });
        if (res.ok) { const d = await res.json(); setEnabled(d.enabled !== false); }
      } catch { /* fail-soft */ }
    })();
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch(`${PROACTIVE_API}/run`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        toast({ title: "Patientez", description: data.error ?? "Réessayez dans un instant." });
      } else if (!res.ok) {
        throw new Error("run");
      } else {
        toast({ title: "Analyse terminée", description: `${data.created ?? 0} nouvelle(s) suggestion(s).` });
        if (filter !== "pending") setFilter("pending"); else await load("pending");
      }
    } catch {
      toast({ title: "Erreur", description: "L'analyse a échoué.", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (id: number, action: "accept" | "dismiss") => {
    try {
      const res = await fetch(`${PROACTIVE_API}/suggestions/${id}/${action}`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("resolve");
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      toast({ title: action === "accept" ? "Accepté" : "Ignoré" });
    } catch {
      toast({ title: "Erreur", description: "Action impossible.", variant: "destructive" });
    }
  };

  const sendFeedback = async (id: number, value: "up" | "down") => {
    try {
      const res = await fetch(`${PROACTIVE_API}/suggestions/${id}/feedback`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("feedback");
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, feedback: value } : s)));
      toast({ title: "Merci", description: "L'assistant apprend de votre retour." });
    } catch {
      toast({ title: "Erreur", description: "Retour non enregistré.", variant: "destructive" });
    }
  };

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next);
    try {
      const res = await fetch(`${PROACTIVE_API}/settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("settings");
      toast({ title: next ? "Assistant proactif activé" : "Assistant proactif désactivé" });
    } catch {
      setEnabled(!next);
      toast({ title: "Erreur", description: "Réglage non enregistré.", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />
            Assistant proactif
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Votre agent surveille en continu tâches, appels et agenda, puis propose les actions à mener.
          </p>
        </div>
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Analyser maintenant
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <Switch id="proactive-enabled" checked={enabled} onCheckedChange={toggleEnabled} />
            <Label htmlFor="proactive-enabled" className="cursor-pointer">
              Surveillance automatique {enabled ? "activée" : "désactivée"}
            </Label>
          </div>
          <div className="flex gap-2 text-xs">
            {counts.urgent > 0 && <Badge className={SEVERITY_STYLE.urgent.badge}>{counts.urgent} urgent</Badge>}
            {counts.warning > 0 && <Badge className={SEVERITY_STYLE.warning.badge}>{counts.warning} à traiter</Badge>}
            {counts.info > 0 && <Badge className={SEVERITY_STYLE.info.badge}>{counts.info} info</Badge>}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} variant={filter === f.key ? "default" : "outline"} size="sm" onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : suggestions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Inbox className="h-12 w-12 text-muted-foreground/40" />
            <CardTitle className="text-lg">
              {filter === "pending" ? "Tout est sous contrôle" : "Aucune suggestion ici"}
            </CardTitle>
            <CardDescription>
              {filter === "pending"
                ? "Aucune action proactive requise pour l'instant. L'assistant vous préviendra dès qu'il détecte quelque chose."
                : "Aucune suggestion dans cette catégorie."}
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => {
            const sev = SEVERITY_STYLE[s.severity] ?? SEVERITY_STYLE.info;
            const meta = TYPE_META[s.type] ?? { label: s.type, icon: AlertTriangle };
            const Icon = meta.icon;
            const nav = s.actionType ? ACTION_NAV[s.actionType] : undefined;
            return (
              <Card key={s.id} className={`border-l-4 ${sev.border}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                      <div>
                        <CardTitle className="text-base leading-snug">{s.title}</CardTitle>
                        {s.detail && <CardDescription className="mt-1">{s.detail}</CardDescription>}
                      </div>
                    </div>
                    <Badge className={`${sev.badge} shrink-0`}>{sev.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 pt-0">
                  <Badge variant="outline" className="text-xs">{meta.label}</Badge>
                  <div className="flex-1" />
                  {nav && (
                    <Button variant="outline" size="sm" onClick={() => setLocation(nav.path)}>
                      {nav.label} <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  )}
                  {s.status === "pending" && (
                    <>
                      <Button variant="ghost" size="icon" title="Utile"
                        className={s.feedback === "up" ? "text-emerald-600" : ""}
                        onClick={() => sendFeedback(s.id, "up")}>
                        <ThumbsUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Pas utile"
                        className={s.feedback === "down" ? "text-red-600" : ""}
                        onClick={() => sendFeedback(s.id, "down")}>
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => resolve(s.id, "dismiss")}>
                        <X className="h-4 w-4 mr-1" /> Ignorer
                      </Button>
                      <Button size="sm" onClick={() => resolve(s.id, "accept")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Accepter
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
