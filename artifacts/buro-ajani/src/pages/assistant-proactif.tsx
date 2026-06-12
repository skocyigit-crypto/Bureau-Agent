import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Sparkles, RefreshCw, Loader2, CheckCircle2, X, ThumbsUp, ThumbsDown,
  Clock, PhoneMissed, CalendarClock, ArrowRight, AlertTriangle, Inbox, ShieldAlert,
  PhoneOff, MessageSquare, UserPlus, Mail, Send,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  document_threat: { label: "Document à risque", icon: ShieldAlert },
  model_fallback: { label: "Modèle IA retiré", icon: AlertTriangle },
  negative_call_followup: { label: "Appel tendu à rappeler", icon: PhoneOff },
  urgent_message: { label: "Message prioritaire", icon: MessageSquare },
  meeting_prep: { label: "Préparer une réunion", icon: CalendarClock },
  inactive_contact: { label: "Contact à relancer", icon: UserPlus },
  message_sla_breach: { label: "Message sans réponse", icon: MessageSquare },
  quiet_customer: { label: "Client silencieux", icon: UserPlus },
  email_reply_needed: { label: "E-mail à répondre", icon: Mail },
};

const ACTION_NAV: Record<string, { label: string; path: string }> = {
  open_task: { label: "Ouvrir la tâche", path: "/taches" },
  callback: { label: "Voir l'appel", path: "/appels" },
  open_calendar: { label: "Ouvrir l'agenda", path: "/calendrier" },
  open_documents_threats: { label: "Voir les documents à risque", path: "/documents?scan=dangerous" },
  open_messages: { label: "Ouvrir les messages", path: "/messages" },
  open_contact: { label: "Ouvrir le contact", path: "/contacts" },
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
  // Fenêtres réglables par org (chaînes pour l'édition libre du champ).
  const [slaHours, setSlaHours] = useState("8");
  const [quietDays, setQuietDays] = useState("21");
  const [bounds, setBounds] = useState({
    slaMin: 1, slaMax: 168, quietMin: 1, quietMax: 59,
  });
  const [savingWindows, setSavingWindows] = useState(false);
  // Brouillons e-mail édités localement (par id de suggestion) + envoi en cours.
  const [drafts, setDrafts] = useState<Record<number, { subject: string; body: string }>>({});
  const [sendingId, setSendingId] = useState<number | null>(null);

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
        if (res.ok) {
          const d = await res.json();
          setEnabled(d.enabled !== false);
          if (typeof d.messageSlaHours === "number") setSlaHours(String(d.messageSlaHours));
          if (typeof d.quietCustomerAfterDays === "number") setQuietDays(String(d.quietCustomerAfterDays));
          if (d.bounds) {
            setBounds({
              slaMin: d.bounds.messageSlaHours?.min ?? 1,
              slaMax: d.bounds.messageSlaHours?.max ?? 168,
              quietMin: d.bounds.quietCustomerAfterDays?.min ?? 1,
              quietMax: d.bounds.quietCustomerAfterDays?.max ?? 59,
            });
          }
        }
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

  // Initialise (paresseusement) le brouillon éditable depuis le payload IA.
  const getDraft = (s: Suggestion): { subject: string; body: string } => {
    if (drafts[s.id]) return drafts[s.id]!;
    const p = (s.actionPayload ?? {}) as Record<string, unknown>;
    return {
      subject: String(p.draftSubject ?? `Re: ${p.subject ?? ""}`),
      body: String(p.draftBodyPlain ?? p.draftBodyHtml ?? ""),
    };
  };

  const updateDraft = (id: number, patch: Partial<{ subject: string; body: string }>) => {
    setDrafts((prev) => {
      const base = prev[id] ?? { subject: "", body: "" };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  };

  // Envoi de la réponse APPROUVÉE (corps éventuellement édité) à un e-mail.
  const sendReply = async (s: Suggestion) => {
    const draft = getDraft(s);
    if (!draft.body.trim()) {
      toast({ title: "Réponse vide", description: "Rédigez une réponse avant l'envoi.", variant: "destructive" });
      return;
    }
    setSendingId(s.id);
    try {
      const res = await fetch(`${PROACTIVE_API}/suggestions/${s.id}/send-reply`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: draft.subject, body: draft.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "send");
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      toast({ title: "Réponse envoyée", description: "L'e-mail a été envoyé dans le fil d'origine." });
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Envoi impossible.", variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  // Rejeter un e-mail proposé : ignore la suggestion ET enregistre un 👎 pour que
  // l'assistant apprenne à moins en proposer (boucle de suppression existante).
  const rejectEmail = async (id: number) => {
    void sendFeedback(id, "down");
    await resolve(id, "dismiss");
  };

  const saveWindows = async () => {
    const sla = Math.round(Number(slaHours));
    const quiet = Math.round(Number(quietDays));
    if (!Number.isFinite(sla) || sla < bounds.slaMin || sla > bounds.slaMax) {
      toast({ title: "Valeur invalide", description: `Le délai doit être entre ${bounds.slaMin} et ${bounds.slaMax} heures.`, variant: "destructive" });
      return;
    }
    if (!Number.isFinite(quiet) || quiet < bounds.quietMin || quiet > bounds.quietMax) {
      toast({ title: "Valeur invalide", description: `Le seuil doit être entre ${bounds.quietMin} et ${bounds.quietMax} jours.`, variant: "destructive" });
      return;
    }
    setSavingWindows(true);
    try {
      const res = await fetch(`${PROACTIVE_API}/settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageSlaHours: sla, quietCustomerAfterDays: quiet }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "settings");
      if (typeof d.messageSlaHours === "number") setSlaHours(String(d.messageSlaHours));
      if (typeof d.quietCustomerAfterDays === "number") setQuietDays(String(d.quietCustomerAfterDays));
      toast({ title: "Réglages enregistrés", description: "Les seuils d'alerte ont été mis à jour." });
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Réglages non enregistrés.", variant: "destructive" });
    } finally {
      setSavingWindows(false);
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Seuils d'alerte</CardTitle>
          <CardDescription>
            Réglez à partir de quand l'assistant signale un message resté sans réponse
            ou un client devenu silencieux. Adaptez ces délais au rythme de votre activité.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sla-hours">Message sans réponse après</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sla-hours" type="number" inputMode="numeric"
                  min={bounds.slaMin} max={bounds.slaMax}
                  value={slaHours}
                  onChange={(e) => setSlaHours(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">heures</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Entre {bounds.slaMin} et {bounds.slaMax} h. Un message entrant sans réponse passé ce délai est signalé.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-days">Client silencieux après</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="quiet-days" type="number" inputMode="numeric"
                  min={bounds.quietMin} max={bounds.quietMax}
                  value={quietDays}
                  onChange={(e) => setQuietDays(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">jours</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Entre {bounds.quietMin} et {bounds.quietMax} j. Un client actif sans nouvel échange passé ce délai est signalé.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveWindows} disabled={savingWindows} size="sm">
              {savingWindows ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Enregistrer les seuils
            </Button>
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
            const isEmail = s.type === "email_reply_needed";
            const draft = isEmail ? getDraft(s) : null;
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
                {isEmail && draft && s.status === "pending" && (
                  <CardContent className="space-y-2 pt-0 pb-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`subj-${s.id}`} className="text-xs text-muted-foreground">Objet</Label>
                      <Input
                        id={`subj-${s.id}`}
                        value={draft.subject}
                        onChange={(e) => updateDraft(s.id, { subject: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`body-${s.id}`} className="text-xs text-muted-foreground">
                        Brouillon de réponse (modifiable avant envoi)
                      </Label>
                      <Textarea
                        id={`body-${s.id}`}
                        value={draft.body}
                        onChange={(e) => updateDraft(s.id, { body: e.target.value })}
                        rows={6}
                        className="resize-y"
                      />
                    </div>
                  </CardContent>
                )}
                <CardContent className="flex flex-wrap items-center gap-2 pt-0">
                  <Badge variant="outline" className="text-xs">{meta.label}</Badge>
                  <div className="flex-1" />
                  {nav && (
                    <Button variant="outline" size="sm" onClick={() => setLocation(nav.path)}>
                      {nav.label} <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  )}
                  {s.status === "pending" && isEmail && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => rejectEmail(s.id)} disabled={sendingId === s.id}>
                        <X className="h-4 w-4 mr-1" /> Rejeter
                      </Button>
                      <Button size="sm" onClick={() => sendReply(s)} disabled={sendingId === s.id}>
                        {sendingId === s.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                        Envoyer
                      </Button>
                    </>
                  )}
                  {s.status === "pending" && !isEmail && (
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
