import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Sparkles, RefreshCw, Loader2, CheckCircle2, X, ThumbsUp, ThumbsDown,
  Clock, PhoneMissed, CalendarClock, ArrowRight, AlertTriangle, Inbox, ShieldAlert,
  PhoneOff, MessageSquare, UserPlus, Mail, Send, Receipt, MessageCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";

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

const SEVERITY_STYLE: Record<Severity, { badge: string; border: string }> = {
  urgent: { badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", border: "border-l-red-500" },
  warning: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", border: "border-l-amber-500" },
  info: { badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300", border: "border-l-blue-500" },
};

const TYPE_ICON: Record<string, typeof Clock> = {
  overdue_task: Clock,
  missed_call_followup: PhoneMissed,
  calendar_conflict: CalendarClock,
  document_threat: ShieldAlert,
  model_fallback: AlertTriangle,
  negative_call_followup: PhoneOff,
  urgent_message: MessageSquare,
  meeting_prep: CalendarClock,
  inactive_contact: UserPlus,
  message_sla_breach: MessageSquare,
  quiet_customer: UserPlus,
  email_reply_needed: Mail,
  payment_reminder: Receipt,
};

const ACTION_PATH: Record<string, string> = {
  open_task: "/taches",
  callback: "/appels",
  open_calendar: "/calendrier",
  open_documents_threats: "/documents?scan=dangerous",
  open_messages: "/messages",
  open_contact: "/contacts",
};

const FILTER_KEYS: Status[] = ["pending", "accepted", "dismissed", "done"];

export default function AssistantProactifPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
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
      toast({ title: t("assistantProactif.toast.error"), description: t("assistantProactif.toast.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

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
        toast({ title: t("assistantProactif.toast.wait"), description: data.error ?? t("assistantProactif.toast.retrySoon") });
      } else if (!res.ok) {
        throw new Error("run");
      } else {
        toast({ title: t("assistantProactif.toast.analysisDone"), description: t("assistantProactif.toast.newSuggestions", { count: data.created ?? 0 }) });
        if (filter !== "pending") setFilter("pending"); else await load("pending");
      }
    } catch {
      toast({ title: t("assistantProactif.toast.error"), description: t("assistantProactif.toast.analysisFailed"), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (id: number, action: "accept" | "dismiss") => {
    try {
      const res = await fetch(`${PROACTIVE_API}/suggestions/${id}/${action}`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("resolve");
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      toast({ title: action === "accept" ? t("assistantProactif.toast.accepted") : t("assistantProactif.toast.ignored") });
    } catch {
      toast({ title: t("assistantProactif.toast.error"), description: t("assistantProactif.toast.actionImpossible"), variant: "destructive" });
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
      toast({ title: t("assistantProactif.toast.thanks"), description: t("assistantProactif.toast.feedbackThanks") });
    } catch {
      toast({ title: t("assistantProactif.toast.error"), description: t("assistantProactif.toast.feedbackError"), variant: "destructive" });
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

  // Envoi APPROUVÉ (corps éventuellement édité) : réponse e-mail OU relance de
  // paiement. Le type de suggestion choisit l'endpoint et le message de succès.
  const sendReply = async (s: Suggestion) => {
    const isReminder = s.type === "payment_reminder";
    const channel = isReminder ? String((s.actionPayload ?? {}).channel ?? "email") : "email";
    const draft = getDraft(s);
    if (!draft.body.trim()) {
      toast({ title: t("assistantProactif.toast.emptyMessage"), description: t("assistantProactif.toast.writeBeforeSend"), variant: "destructive" });
      return;
    }
    setSendingId(s.id);
    try {
      const endpoint = isReminder ? "send-reminder" : "send-reply";
      const res = await fetch(`${PROACTIVE_API}/suggestions/${s.id}/${endpoint}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: draft.subject, body: draft.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "send");
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      if (isReminder) {
        toast({
          title: t("assistantProactif.toast.reminderSent"),
          description: channel === "sms" ? t("assistantProactif.toast.reminderSmsSent") : t("assistantProactif.toast.reminderEmailSent"),
        });
      } else {
        toast({ title: t("assistantProactif.toast.replySent"), description: t("assistantProactif.toast.replySentDesc") });
      }
    } catch (e) {
      toast({ title: t("assistantProactif.toast.error"), description: e instanceof Error ? e.message : t("assistantProactif.toast.sendError"), variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  // Rejeter un e-mail proposé : ignore la suggestion ET enregistre un 👎 pour que
  // l'assistant apprenne à moins en proposer (boucle de suppression existante).
  // NB : pour les relances de paiement, on n'enregistre PAS de 👎 — le
  // recouvrement est critique et ce type n'est jamais mis en sourdine ;
  // l'espacement (hystérésis) suffit à éviter le harcèlement.
  const rejectEmail = async (id: number) => {
    void sendFeedback(id, "down");
    await resolve(id, "dismiss");
  };

  // Rejeter une relance de paiement : on ignore simplement cette facture pour
  // l'instant (sans signal d'apprentissage négatif global).
  const rejectReminder = async (id: number) => {
    await resolve(id, "dismiss");
  };

  const saveWindows = async () => {
    const sla = Math.round(Number(slaHours));
    const quiet = Math.round(Number(quietDays));
    if (!Number.isFinite(sla) || sla < bounds.slaMin || sla > bounds.slaMax) {
      toast({ title: t("assistantProactif.toast.invalidValue"), description: t("assistantProactif.toast.slaRange", { min: bounds.slaMin, max: bounds.slaMax }), variant: "destructive" });
      return;
    }
    if (!Number.isFinite(quiet) || quiet < bounds.quietMin || quiet > bounds.quietMax) {
      toast({ title: t("assistantProactif.toast.invalidValue"), description: t("assistantProactif.toast.quietRange", { min: bounds.quietMin, max: bounds.quietMax }), variant: "destructive" });
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
      toast({ title: t("assistantProactif.toast.thresholdsSaved"), description: t("assistantProactif.toast.thresholdsSavedDesc") });
    } catch (e) {
      toast({ title: t("assistantProactif.toast.error"), description: e instanceof Error ? e.message : t("assistantProactif.toast.thresholdsError"), variant: "destructive" });
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
      toast({ title: next ? t("assistantProactif.toast.enabledOn") : t("assistantProactif.toast.enabledOff") });
    } catch {
      setEnabled(!next);
      toast({ title: t("assistantProactif.toast.error"), description: t("assistantProactif.toast.settingError"), variant: "destructive" });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />
            {t("assistantProactif.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("assistantProactif.subtitle")}
          </p>
        </div>
        <Button onClick={runNow} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {t("assistantProactif.analyzeNow")}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <Switch id="proactive-enabled" checked={enabled} onCheckedChange={toggleEnabled} />
            <Label htmlFor="proactive-enabled" className="cursor-pointer">
              {t("assistantProactif.autoMonitoring", { state: enabled ? t("assistantProactif.stateOn") : t("assistantProactif.stateOff") })}
            </Label>
          </div>
          <div className="flex gap-2 text-xs">
            {counts.urgent > 0 && <Badge className={SEVERITY_STYLE.urgent.badge}>{t("assistantProactif.badgeUrgent", { count: counts.urgent })}</Badge>}
            {counts.warning > 0 && <Badge className={SEVERITY_STYLE.warning.badge}>{t("assistantProactif.badgeWarning", { count: counts.warning })}</Badge>}
            {counts.info > 0 && <Badge className={SEVERITY_STYLE.info.badge}>{t("assistantProactif.badgeInfo", { count: counts.info })}</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("assistantProactif.thresholdsTitle")}</CardTitle>
          <CardDescription>
            {t("assistantProactif.thresholdsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sla-hours">{t("assistantProactif.messageNoReplyAfter")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sla-hours" type="number" inputMode="numeric"
                  min={bounds.slaMin} max={bounds.slaMax}
                  value={slaHours}
                  onChange={(e) => setSlaHours(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">{t("assistantProactif.hours")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("assistantProactif.slaHint", { min: bounds.slaMin, max: bounds.slaMax })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet-days">{t("assistantProactif.quietCustomerAfter")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="quiet-days" type="number" inputMode="numeric"
                  min={bounds.quietMin} max={bounds.quietMax}
                  value={quietDays}
                  onChange={(e) => setQuietDays(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">{t("assistantProactif.days")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("assistantProactif.quietHint", { min: bounds.quietMin, max: bounds.quietMax })}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveWindows} disabled={savingWindows} size="sm">
              {savingWindows ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {t("assistantProactif.saveThresholds")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTER_KEYS.map((key) => (
          <Button key={key} variant={filter === key ? "default" : "outline"} size="sm" onClick={() => setFilter(key)}>
            {t(`assistantProactif.filters.${key}`)}
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
              {filter === "pending" ? t("assistantProactif.emptyPendingTitle") : t("assistantProactif.emptyOtherTitle")}
            </CardTitle>
            <CardDescription>
              {filter === "pending"
                ? t("assistantProactif.emptyPendingDesc")
                : t("assistantProactif.emptyOtherDesc")}
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => {
            const sev = SEVERITY_STYLE[s.severity] ?? SEVERITY_STYLE.info;
            const Icon = TYPE_ICON[s.type] ?? AlertTriangle;
            const typeLabel = TYPE_ICON[s.type] ? t(`assistantProactif.types.${s.type}`) : s.type;
            const navPath = s.actionType ? ACTION_PATH[s.actionType] : undefined;
            const navLabel = s.actionType && navPath ? t(`assistantProactif.actions.${s.actionType}`) : "";
            const isEmail = s.type === "email_reply_needed";
            const isReminder = s.type === "payment_reminder";
            const isDraftable = isEmail || isReminder;
            const reminderChannel = isReminder ? String((s.actionPayload ?? {}).channel ?? "email") : "email";
            const showSubject = isEmail || (isReminder && reminderChannel !== "sms");
            const draft = isDraftable ? getDraft(s) : null;
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
                    <Badge className={`${sev.badge} shrink-0`}>{t(`assistantProactif.severity.${s.severity}`)}</Badge>
                  </div>
                </CardHeader>
                {isDraftable && draft && s.status === "pending" && (
                  <CardContent className="space-y-2 pt-0 pb-3">
                    {isReminder && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {reminderChannel === "sms" ? <MessageCircle className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                        <span>
                          {t("assistantProactif.reminderVia", { channel: reminderChannel === "sms" ? t("assistantProactif.channelSms") : t("assistantProactif.channelEmail"), recipient: String((s.actionPayload ?? {}).recipient ?? "") })}
                        </span>
                      </div>
                    )}
                    {showSubject && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`subj-${s.id}`} className="text-xs text-muted-foreground">{t("assistantProactif.subject")}</Label>
                        <Input
                          id={`subj-${s.id}`}
                          value={draft.subject}
                          onChange={(e) => updateDraft(s.id, { subject: e.target.value })}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor={`body-${s.id}`} className="text-xs text-muted-foreground">
                        {isReminder ? t("assistantProactif.reminderDraftLabel") : t("assistantProactif.replyDraftLabel")}
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
                  <Badge variant="outline" className="text-xs">{typeLabel}</Badge>
                  <div className="flex-1" />
                  {navPath && (
                    <Button variant="outline" size="sm" onClick={() => setLocation(navPath)}>
                      {navLabel} <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  )}
                  {s.status === "pending" && isDraftable && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => (isReminder ? rejectReminder(s.id) : rejectEmail(s.id))} disabled={sendingId === s.id}>
                        <X className="h-4 w-4 mr-1" /> {isReminder ? t("assistantProactif.ignore") : t("assistantProactif.reject")}
                      </Button>
                      <Button size="sm" onClick={() => sendReply(s)} disabled={sendingId === s.id}>
                        {sendingId === s.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                        {t("assistantProactif.send")}
                      </Button>
                    </>
                  )}
                  {s.status === "pending" && !isDraftable && (
                    <>
                      <Button variant="ghost" size="icon" title={t("assistantProactif.useful")}
                        className={s.feedback === "up" ? "text-emerald-600" : ""}
                        onClick={() => sendFeedback(s.id, "up")}>
                        <ThumbsUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title={t("assistantProactif.notUseful")}
                        className={s.feedback === "down" ? "text-red-600" : ""}
                        onClick={() => sendFeedback(s.id, "down")}>
                        <ThumbsDown className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => resolve(s.id, "dismiss")}>
                        <X className="h-4 w-4 mr-1" /> {t("assistantProactif.ignore")}
                      </Button>
                      <Button size="sm" onClick={() => resolve(s.id, "accept")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> {t("assistantProactif.accept")}
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
