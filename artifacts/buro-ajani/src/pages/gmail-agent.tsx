import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Dialog,DialogContent,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { trackScanResult } from "@/lib/scan-result";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { AvatarDock } from "@workspace/ai-avatar";
import { getListContactsQueryKey,getListTasksQueryKey } from "@workspace/api-client-react";
import { format,isToday,isYesterday } from "date-fns";
import { fr } from "date-fns/locale";
import {
AlertCircle,
AlertTriangle,
Archive,
Brain,
Check,
CheckCircle2,
ChevronRight,
Copy,
CornerDownLeft,
Download,
Eye,
FileText,
FolderKanban,
Inbox,
Info,
Link2,
Loader2,
Mail,
MessageSquare,
Paperclip,Plus,
Printer,
RefreshCw,
Reply,
RotateCcw,
Search,
Send,
ShieldAlert,
ShieldCheck,
ShoppingCart,
Sparkles,
Star,StarOff,
Trash2,
TrendingUp,
Wifi,WifiOff,
X,
Zap
} from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";
import { useLocation } from "wouter";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // On conserve le corps et le statut sur l'erreur: certains refus sont
    // porteurs d'information exploitable par l'appelant (ex. le blocage DLP
    // renvoie 409 avec la liste des donnees sensibles detectees).
    const error = new Error((err as any).error || `HTTP ${res.status}`) as Error & { status?: number; payload?: any };
    error.status = res.status;
    error.payload = err;
    throw error;
  }
  return res.json();
}

async function apiPost(path: string, body: any) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiPatch(path: string, body: any) {
  return apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiDelete(path: string) {
  return apiFetch(path, { method: "DELETE" });
}

function parseEmailName(emailStr: string) {
  const match = emailStr.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() || emailStr };
  }
  return { name: emailStr, email: emailStr };
}

function SmartDate({ dateStr }: { dateStr: string }) {
  const { t } = useTranslation();
  if (!dateStr) return <span className="text-muted-foreground text-xs">-</span>;
  try {
    const d = new Date(dateStr);
    if (isToday(d)) return <span className="text-xs text-blue-600 font-medium">{format(d, "HH:mm")}</span>;
    if (isYesterday(d)) return <span className="text-xs text-muted-foreground">{t("gmailAgent.yesterday")} {format(d, "HH:mm")}</span>;
    return <span className="text-xs text-muted-foreground">{format(d, "dd MMM", { locale: fr })}</span>;
  } catch { return <span className="text-xs text-muted-foreground">{dateStr.slice(0, 10)}</span>; }
}

// Les libellés sont rendus via t("gmailAgent.priority.<clé>") au point d'usage.
const PRIORITY_CONFIG: Record<string, { color: string; icon: any }> = {
  critique: { color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  haute: { color: "bg-orange-100 text-orange-700 border-orange-200", icon: Zap },
  normale: { color: "bg-blue-100 text-blue-700 border-blue-200", icon: Info },
  basse: { color: "bg-gray-100 text-gray-600 border-gray-200", icon: Check },
};

const CATEGORY_CONFIG: Record<string, { color: string; icon: any }> = {
  commercial: { color: "bg-emerald-100 text-emerald-700", icon: TrendingUp },
  client: { color: "bg-blue-100 text-blue-700", icon: MessageSquare },
  finance: { color: "bg-amber-100 text-amber-700", icon: ShoppingCart },
  administratif: { color: "bg-purple-100 text-purple-700", icon: FileText },
  spam: { color: "bg-gray-100 text-gray-500", icon: X },
  information: { color: "bg-slate-100 text-slate-600", icon: Info },
  urgence: { color: "bg-red-100 text-red-700", icon: AlertCircle },
};

// Libellés rendus via t("gmailAgent.tone.<value>") au point d'usage.
const TONE_OPTIONS = [
  { value: "professionnel" },
  { value: "formel" },
  { value: "cordial" },
  { value: "direct" },
  { value: "empathique" },
];

function EmailListItem({
  email, selected, triageInfo, onClick
}: {
  email: any;
  selected: boolean;
  triageInfo?: any;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const sender = parseEmailName(email.from || "");
  const pri = triageInfo ? PRIORITY_CONFIG[triageInfo.priority] : null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b transition-colors hover:bg-muted/50 ${selected ? "bg-blue-50 border-l-2 border-l-blue-500" : ""} ${email.unread ? "bg-white" : "bg-muted/20"}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={`text-sm truncate ${email.unread ? "font-semibold" : "font-medium text-muted-foreground"}`}>
              {sender.name.slice(0, 28)}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {email.starred && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}
              {email.hasAttachment && <Paperclip className="h-3 w-3 text-muted-foreground" />}
              <SmartDate dateStr={email.date} />
            </div>
          </div>
          <p className={`text-xs truncate mb-0.5 ${email.unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {email.subject}
          </p>
          <p className="text-xs text-muted-foreground truncate">{email.snippet}</p>
          {pri && (
            <div className="flex items-center gap-1 mt-1">
              <Badge variant="outline" className={`text-[10px] py-0 px-1 ${pri.color}`}>
                {t(`gmailAgent.priority.${triageInfo.priority}`)}
              </Badge>
              {triageInfo?.category && CATEGORY_CONFIG[triageInfo.category] && (
                <Badge variant="outline" className={`text-[10px] py-0 px-1 ${CATEGORY_CONFIG[triageInfo.category].color}`}>
                  {t(`gmailAgent.category.${triageInfo.category}`)}
                </Badge>
              )}
              {triageInfo?.needsReply && (
                <Badge variant="outline" className="text-[10px] py-0 px-1 bg-violet-100 text-violet-700">{t("gmailAgent.replyRequired")}</Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function ComposeModal({ open, onClose, replyTo }: { open: boolean; onClose: () => void; replyTo?: any }) {
  const [to, setTo] = useState(replyTo?.from || "");
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject}` : "");
  const [body, setBody] = useState(replyTo?.aiBody || "");
  const [sending, setSending] = useState(false);
  const [dlpWarning, setDlpWarning] = useState<any | null>(null);
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (replyTo) {
      const sender = parseEmailName(replyTo.from || "");
      setTo(sender.email);
      setSubject(replyTo.subject?.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`);
      setBody(replyTo.aiBody || "");
    }
  }, [replyTo]);

  const handleSend = async (confirmSensitive = false) => {
    if (!to || !subject || !body) { toast({ title: t("gmailAgent.toast.requiredFields"), variant: "destructive" }); return; }
    setSending(true);
    try {
      if (replyTo?.threadId) {
        await apiPost("/gmail/reply", { messageId: replyTo.messageId, threadId: replyTo.threadId, to, subject, body, isHtml: false, confirmSensitive });
      } else {
        await apiPost("/gmail/send", { to, subject, body, isHtml: false, confirmSensitive });
      }
      setDlpWarning(null);
      toast({ title: t("gmailAgent.toast.sent"), description: t("gmailAgent.toast.sentDesc", { to }) });
      qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
      onClose();
    } catch (e: any) {
      // Blocage DLP: on n'interdit pas l'envoi, on demande une confirmation
      // explicite en montrant precisement ce qui a ete detecte.
      if (e?.status === 409 && e?.payload?.error === "donnees_sensibles") {
        setDlpWarning(e.payload);
        return;
      }
      toast({ title: t("gmailAgent.toast.sendError"), variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-blue-500" />
            {replyTo ? t("gmailAgent.compose.reply") : t("gmailAgent.compose.newMessage")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("gmailAgent.compose.to")}</Label>
            <Input value={to} onChange={e => setTo(e.target.value)} placeholder={t("gmailAgent.compose.toPlaceholder")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t("gmailAgent.compose.subject")}</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("gmailAgent.compose.subjectPlaceholder")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t("gmailAgent.compose.message")}</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder={t("gmailAgent.compose.messagePlaceholder")} className="mt-1 min-h-[200px]" />
          </div>
          {dlpWarning && (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 p-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t("gmailAgent.compose.sensitiveData")}
              </p>
              <p className="text-xs text-amber-900 leading-snug">{dlpWarning.message}</p>
              {dlpWarning.findings?.length > 0 && (
                <ul className="text-xs text-amber-800 list-disc pl-4 space-y-0.5">
                  {dlpWarning.findings.map((f: any, i: number) => (
                    <li key={i}>{f.label} — {t("gmailAgent.compose.occurrences", { count: f.count })}{f.samples?.length ? ` : ${f.samples.join(", ")}` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            {dlpWarning ? (
              <Button variant="destructive" onClick={() => handleSend(true)} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                {t("gmailAgent.compose.sendAnyway")}
              </Button>
            ) : (
              <Button onClick={() => handleSend()} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                {t("gmailAgent.compose.send")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function GmailAgentPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  async function navigateToProjets(emailSubject?: string) {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/projets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ title: emailSubject ? t("gmailAgent.data.projectTitlePrefix", { subject: emailSubject }).slice(0, 80) : t("gmailAgent.data.projectDefaultTitle"), status: "planifie", priority: "moyenne", progress: 0, notes: t("gmailAgent.data.projectNotes") }),
    });
    if (res.ok) { toast({ title: t("gmailAgent.toast.projectCreated") }); navigate("/projets"); }
    else toast({ title: t("gmailAgent.toast.projectCreateError"), variant: "destructive" });
  }

  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("is:inbox");
  // Filtre cote client base sur les resultats du triage IA. null = tout.
  // Les autres valeurs filtrent la liste rendue sans rappeler Gmail.
  const [triageFilter, setTriageFilter] = useState<null | "critique" | "haute" | "needsReply" | "commercial" | "spam">(null);
  const [triageData, setTriageData] = useState<any>(null);
  const [isTriaging, setIsTriaging] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiDraft, setAiDraft] = useState<any>(null);
  const [tone, setTone] = useState("professionnel");
  const [draftInstructions, setDraftInstructions] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<any>(undefined);
  const [aiPanelTab, setAiPanelTab] = useState("triage");
  const [savingAtt, setSavingAtt] = useState<string | null>(null);
  // Rapport de securite du mail ouvert (analyse anti-phishing complete :
  // pieces jointes, liens, authentification de l'expediteur, verdict IA).
  // L'endpoint existait deja cote serveur mais n'etait appele par aucune page.
  const [scanReport, setScanReport] = useState<any | null>(null);
  const [scanning, setScanning] = useState(false);

  const handleScanEmail = useCallback(async () => {
    if (!selectedEmail?.id) return;
    setScanning(true);
    try {
      const report = await apiPost(`/gmail/message/${selectedEmail.id}/scan`, {});
      setScanReport(report);
    } catch (e: any) {
      toast({ title: t("gmailAgent.toast.scanFailed"), description: e?.message || t("gmailAgent.toast.retry"), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }, [selectedEmail?.id, toast, t]);

  const handleSaveAttachment = useCallback(async (att: any) => {
    if (!selectedEmail?.id || !att?.attachmentId) return;
    setSavingAtt(att.attachmentId);
    try {
      const saved = await apiPost(`/gmail/message/${selectedEmail.id}/attachment/${att.attachmentId}/save`, {});
      toast({ title: t("gmailAgent.toast.savedToDocs"), description: t("gmailAgent.toast.savedToDocsDesc", { filename: att.filename }) });
      // Suivi du verdict antivirus en arriere-plan (Tache #175) : on affichera
      // un toast de suivi des que l'analyse est terminee (sain / dangereux).
      const docId = saved?.document?.id ?? saved?.id;
      if (docId) void trackScanResult(toast, docId, att.filename || t("gmailAgent.toast.fileFallback"), t);
    } catch (e: any) {
      toast({ title: t("gmailAgent.toast.saveFailed"), description: e?.message || t("gmailAgent.toast.retry"), variant: "destructive" });
    } finally {
      setSavingAtt(null);
    }
  }, [selectedEmail?.id, toast, t]);

  const { data: profile } = useQuery({
    queryKey: ["gmail-profile"],
    queryFn: () => apiFetch("/gmail/profile"),
    staleTime: 30000,
  });

  const { data: inboxData, isLoading: inboxLoading, refetch: refetchInbox } = useQuery({
    queryKey: ["gmail-inbox", activeFilter],
    queryFn: () => apiFetch(`/gmail/inbox?q=${encodeURIComponent(activeFilter)}&maxResults=30`),
    enabled: profile?.authenticated === true,
    staleTime: 30000,
  });

  const { data: emailDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["gmail-message", selectedEmail?.id],
    queryFn: () => apiFetch(`/gmail/message/${selectedEmail.id}`),
    enabled: !!selectedEmail?.id,
    staleTime: 60000,
  });

  const emails: any[] = inboxData?.emails || [];

  const triageMap: Record<string, any> = triageData?.triage?.triage
    ? Object.fromEntries((triageData.triage.triage as any[]).map((t: any) => [t.emailId, t]))
    : {};

  // Application du filtre triage cote client. Si aucun triage n'a encore
  // tourne (triageMap vide), on affiche tout — sinon le filtre serait
  // toujours vide pendant les ~2s d'attente IA.
  const displayedEmails = !triageFilter || Object.keys(triageMap).length === 0
    ? emails
    : emails.filter((e) => {
        const t = triageMap[e.id];
        if (!t) return false;
        if (triageFilter === "needsReply") return !!t.needsReply;
        if (triageFilter === "spam") return t.category === "spam";
        if (triageFilter === "commercial") return t.category === "commercial";
        return t.priority === triageFilter;
      });

  // Compteurs par filtre, affiches dans les chips. On les calcule meme si
  // aucun chip n'est actif pour donner un apercu instantane.
  const triageCounts = {
    critique: 0, haute: 0, needsReply: 0, commercial: 0, spam: 0,
  };
  for (const e of emails) {
    const t = triageMap[e.id];
    if (!t) continue;
    if (t.priority === "critique") triageCounts.critique++;
    if (t.priority === "haute") triageCounts.haute++;
    if (t.needsReply) triageCounts.needsReply++;
    if (t.category === "commercial") triageCounts.commercial++;
    if (t.category === "spam") triageCounts.spam++;
  }

  // Cle stable pour deduper l'appel triage. On s'appuie sur les ids des
  // emails affiches (et leur ordre) — si rien ne change, on ne re-trigger pas
  // l'IA inutilement (consomme du quota). Le set est garde dans un ref pour
  // survivre aux renders sans declencher d'effet.
  const inboxSignature = emails.map((e) => e.id).join("|");
  // On marque une signature comme "consommee" des qu'une tentative est lancee
  // (succes OU echec). Sinon, en cas d'erreur reseau / quota, l'effet re-tire
  // toutes les 800ms a l'infini et brule le quota IA. Pour reessayer apres
  // un echec, l'utilisateur clique le bouton "Relancer le triage" qui appelle
  // handleTriage et reset le ref.
  const lastTriagedSignature = useRef<string>("");

  const runTriage = useCallback(async (silent = false) => {
    if (!emails.length) return;
    const sig = inboxSignature;
    lastTriagedSignature.current = sig;
    setIsTriaging(true);
    if (!silent) setAiPanelTab("triage");
    try {
      const data = await apiPost("/commandant/gmail-triage", { emails: emails.slice(0, 25) });
      setTriageData(data);
      if (!silent) toast({ title: t("gmailAgent.toast.triageDone"), description: t("gmailAgent.toast.triageDoneDesc", { count: emails.length }) });
    } catch {
      if (!silent) toast({ title: t("gmailAgent.toast.triageError"), variant: "destructive" });
    } finally { setIsTriaging(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxSignature]);

  const handleTriage = () => {
    // Manuel = on force la reexecution meme si la signature est identique
    // (utile pour reessayer apres un echec).
    lastTriagedSignature.current = "";
    void runTriage(false);
  };

  // Auto-triage: des que l'inbox change (nouveau filtre, nouveaux mails), on
  // lance le triage en silence pour que les badges priorite/categorie
  // apparaissent automatiquement sans clic utilisateur. C'est ce qui rend
  // l'agent "autonome" plutot que "outil a la demande".
  useEffect(() => {
    if (!emails.length) return;
    if (inboxSignature === lastTriagedSignature.current) return;
    if (isTriaging) return;
    const handle = setTimeout(() => { void runTriage(true); }, 800);
    return () => clearTimeout(handle);
  }, [inboxSignature, emails.length, isTriaging, runTriage]);

  // Cree une tache CRM a partir de l'email selectionne, en s'appuyant sur
  // les donnees du triage IA (priorite, action suggeree, deadline) si elles
  // sont disponibles. C'est le pont entre "agent mail" et "agent taches" :
  // un email a haut signal devient instantanement un to-do trace dans le CRM,
  // sans saisie manuelle.
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  async function createTaskFromEmail() {
    const email = selectedEmail;
    if (!email) { toast({ title: t("gmailAgent.toast.selectEmail"), variant: "destructive" }); return; }
    if (isCreatingTask) return;
    const tri = triageMap[email.id];

    // Mapping triage IA -> schema tasks (cf. CreateTaskBody)
    const priorityMap: Record<string, "haute" | "moyenne" | "basse"> = {
      critique: "haute", haute: "haute", normale: "moyenne", basse: "basse",
    };
    const priority = (tri && priorityMap[tri.priority]) || "moyenne";

    let dueDate: string | null = null;
    if (tri?.replyDeadline === "maintenant" || tri?.replyDeadline === "aujourd_hui") {
      const d = new Date(); d.setHours(18, 0, 0, 0);
      dueDate = d.toISOString();
    } else if (tri?.replyDeadline === "cette_semaine") {
      const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(18, 0, 0, 0);
      dueDate = d.toISOString();
    }

    const subject = (emailDetail?.subject || email.subject || "Email").slice(0, 80);
    const from = emailDetail?.from || email.from || "";
    const descLines = [
      t("gmailAgent.data.taskEmailFrom", { from }),
      tri?.summary ? "\n" + t("gmailAgent.data.taskAiSummary", { summary: tri.summary }) : "",
      tri?.suggestedAction ? "\n" + t("gmailAgent.data.taskSuggestedAction", { action: tri.suggestedAction }) : "",
      "\n" + t("gmailAgent.data.taskGmailMessage", { id: email.id }),
    ].filter(Boolean);

    setIsCreatingTask(true);
    try {
      await apiPost("/tasks", {
        title: t("gmailAgent.data.taskTitlePrefix", { subject }),
        description: descLines.join("\n"),
        status: "en_attente",
        priority,
        dueDate,
      });
      toast({
        title: t("gmailAgent.toast.taskCreated"),
        description: tri ? t("gmailAgent.toast.taskCreatedDesc", { priority, deadline: dueDate ? t("gmailAgent.toast.taskDeadlineSuffix") : "" }) : t("gmailAgent.toast.taskManual"),
      });
      qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    } catch {
      toast({ title: t("gmailAgent.toast.taskError"), variant: "destructive" });
    } finally {
      setIsCreatingTask(false);
    }
  }

  // Id du mail pour lequel le brouillon courant a ete genere. Sert a
  // (a) effacer le brouillon quand on change de mail, et (b) deduper le
  // pre-fetch automatique pour ne pas regenerer en boucle.
  const [aiDraftForEmailId, setAiDraftForEmailId] = useState<string | null>(null);
  const lastAutoDraftedId = useRef<string | null>(null);
  // Ref vivante qui suit toujours l'id du mail courant. Necessaire car
  // dans une closure `selectedEmail` reste fige au moment de l'appel ;
  // pour decider apres `await` si le brouillon est encore pertinent il
  // faut lire la valeur la plus recente, pas la valeur capturee.
  const selectedEmailIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedEmailIdRef.current = selectedEmail?.id ?? null;
  }, [selectedEmail?.id]);

  const runDraftReply = useCallback(async (silent = false) => {
    if (!emailDetail && !selectedEmail) return;
    const targetId = selectedEmail?.id ?? null;
    setIsDrafting(true);
    if (!silent) setAiPanelTab("reply");
    try {
      const data = await apiPost("/commandant/gmail-draft-reply", {
        from: emailDetail?.from || selectedEmail?.from,
        subject: emailDetail?.subject || selectedEmail?.subject,
        bodyHtml: emailDetail?.bodyHtml,
        bodyPlain: emailDetail?.bodyPlain,
        snippet: selectedEmail?.snippet,
        tone,
        instructions: draftInstructions,
      });
      // Si l'utilisateur a change de mail pendant le round-trip, on jette
      // la reponse — sinon on afficherait un brouillon obsolete sur le
      // mauvais mail.
      if (selectedEmailIdRef.current === targetId && targetId) {
        setAiDraft(data.draft);
        setAiDraftForEmailId(targetId);
      }
      if (!silent) toast({ title: t("gmailAgent.toast.replyGenerated"), description: data.contactFound ? t("gmailAgent.toast.contactFound") : "" });
    } catch {
      if (!silent) toast({ title: t("gmailAgent.toast.generationError"), variant: "destructive" });
    } finally { setIsDrafting(false); }
  }, [emailDetail, selectedEmail, tone, draftInstructions]);

  const handleDraftReply = () => { void runDraftReply(false); };

  // Quand on change de mail, on efface le brouillon precedent (sinon on
  // afficherait un brouillon obsolete qui appartient a un autre mail).
  useEffect(() => {
    if (selectedEmail?.id !== aiDraftForEmailId) {
      setAiDraft(null);
    }
  }, [selectedEmail?.id, aiDraftForEmailId]);

  // Pre-generation automatique du brouillon de reponse pour les mails
  // critiques/hauts qui necessitent une reponse. Quand l'utilisateur ouvre
  // un mail "chaud", la reponse est deja prete dans l'onglet "Réponse IA".
  // Garde-fous : un seul auto-draft par mail (lastAutoDraftedId), seulement
  // si le mail est charge, pas de re-trigger sur erreur (id pose avant
  // l'appel reseau).
  useEffect(() => {
    if (!selectedEmail || !emailDetail) return;
    if (isDrafting) return;
    if (lastAutoDraftedId.current === selectedEmail.id) return;
    const t = triageMap[selectedEmail.id];
    if (!t?.needsReply) return;
    if (t.priority !== "critique" && t.priority !== "haute") return;
    lastAutoDraftedId.current = selectedEmail.id;
    const handle = setTimeout(() => { void runDraftReply(true); }, 500);
    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmail?.id, emailDetail, triageMap, isDrafting]);

  const handleArchive = async (id: string) => {
    try {
      await apiPost(`/gmail/message/${id}/archive`, {});
      toast({ title: t("gmailAgent.toast.archived") });
      qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
      if (selectedEmail?.id === id) setSelectedEmail(null);
    } catch { toast({ title: t("gmailAgent.toast.error"), variant: "destructive" }); }
  };

  // Lookup CRM du sender du mail courant. Cherche par email exact via
  // /contacts?search=. La query ne tourne que si selectedEmail a un from
  // valide (email parsable). Resultat utilise par le badge "+ Ajouter au CRM".
  const senderEmail = selectedEmail
    ? parseEmailName(selectedEmail.from || "").email.toLowerCase().trim()
    : "";
  const senderEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail);
  const { data: senderContactData } = useQuery({
    queryKey: ["contact-lookup", senderEmail],
    queryFn: () => apiFetch(`/contacts?search=${encodeURIComponent(senderEmail)}&limit=5`),
    enabled: senderEmailValid,
    staleTime: 30_000,
  });
  // Match cote client : on filtre la liste retournee par une egalite stricte
  // sur le champ email (le backend fait un ILIKE %x%, donc trop large).
  const existingContact = (senderContactData?.contacts || []).find(
    (c: any) => (c.email || "").toLowerCase().trim() === senderEmail
  );

  const [isAddingContact, setIsAddingContact] = useState(false);
  const handleAddSenderToContacts = async () => {
    if (!selectedEmail || !senderEmailValid || existingContact) return;
    const parsed = parseEmailName(selectedEmail.from || "");
    // Decoupe "Prenom Nom" ; si un seul mot, prenom = mot, nom = "-".
    // Le backend exige firstName ET lastName non vides.
    const nameParts = (parsed.name || senderEmail.split("@")[0]).trim().split(/\s+/);
    const firstName = nameParts[0] || "Inconnu";
    const lastName = nameParts.slice(1).join(" ") || "-";
    setIsAddingContact(true);
    try {
      await apiPost("/contacts", {
        firstName,
        lastName,
        email: senderEmail,
        phone: "-", // requis par le schema, pas connu depuis le mail
        category: "prospect",
        notes: t("gmailAgent.data.contactImportNote", { date: new Date().toLocaleDateString("fr-FR") }),
      });
      toast({ title: t("gmailAgent.toast.contactAdded") });
      qc.invalidateQueries({ queryKey: ["contact-lookup", senderEmail] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
    } catch (e: any) {
      toast({ title: t("gmailAgent.toast.error"), description: e?.message || t("gmailAgent.toast.contactAddError"), variant: "destructive" });
    } finally {
      setIsAddingContact(false);
    }
  };

  // Archive en masse les emails que le triage IA a classes "spam".
  // Pas d'appel IA — on relit juste triageMap. Garde-fou : guard
  // `isCleaningSpam` pour eviter les double-clics, et confirm() pour
  // que l'utilisateur valide la quantite avant l'action destructive.
  const [isCleaningSpam, setIsCleaningSpam] = useState(false);
  const handleArchiveSpam = async () => {
    const spamIds = emails
      .filter(e => triageMap[e.id]?.category === "spam")
      .map(e => e.id);
    if (spamIds.length === 0) return;
    if (!window.confirm(t("gmailAgent.toast.confirmArchiveSpam", { count: spamIds.length }))) return;
    setIsCleaningSpam(true);
    let ok = 0, fail = 0;
    // Sequentiel pour ne pas saturer Gmail (rate limit). Reste rapide en
    // pratique : ~50ms par appel sur le proxy.
    for (const id of spamIds) {
      try {
        await apiPost(`/gmail/message/${id}/archive`, {});
        ok++;
      } catch { fail++; }
    }
    setIsCleaningSpam(false);
    qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
    if (selectedEmail && spamIds.includes(selectedEmail.id)) setSelectedEmail(null);
    toast({
      title: fail === 0 ? t("gmailAgent.toast.spamArchived", { count: ok }) : t("gmailAgent.toast.spamPartial", { ok, fail }),
      variant: fail === 0 ? "default" : "destructive",
    });
  };

  const handleTrash = async (id: string) => {
    try {
      await apiDelete(`/gmail/message/${id}/trash`);
      toast({ title: t("gmailAgent.toast.deleted") });
      qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
      if (selectedEmail?.id === id) setSelectedEmail(null);
    } catch { toast({ title: t("gmailAgent.toast.error"), variant: "destructive" }); }
  };

  const handleStar = async (id: string, starred: boolean) => {
    try {
      await apiPatch(`/gmail/message/${id}/star`, { starred: !starred });
      qc.invalidateQueries({ queryKey: ["gmail-inbox"] });
    } catch { toast({ title: t("gmailAgent.toast.error"), variant: "destructive" }); }
  };

  const handleUseReply = () => {
    if (!aiDraft) return;
    setComposeReplyTo({
      from: emailDetail?.from || selectedEmail?.from,
      subject: emailDetail?.subject || selectedEmail?.subject,
      threadId: emailDetail?.threadId || selectedEmail?.threadId,
      messageId: emailDetail?.messageId,
      aiBody: aiDraft.replyBodyPlain || aiDraft.replyBodyHtml?.replace(/<[^>]+>/g, "") || "",
    });
    setComposeOpen(true);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setActiveFilter(searchQuery.trim());
    } else {
      setActiveFilter("is:inbox");
    }
  };

  if (!profile?.authenticated && profile !== undefined) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 text-center space-y-4">
            <WifiOff className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">
              {profile?.reconnectRequired ? t("gmailAgent.auth.expiredTitle") : t("gmailAgent.auth.notConnectedTitle")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {profile?.reconnectRequired
                ? t("gmailAgent.auth.expiredDesc")
                : t("gmailAgent.auth.notConnectedDesc")}
            </p>
            <Button onClick={() => window.location.href = `${baseUrl}/google-workspace`} className="w-full">
              {profile?.reconnectRequired ? t("gmailAgent.auth.reconnect") : t("gmailAgent.auth.connect")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Icon3D icon={Mail} variant="blue" size="sm" />
          <div>
            <h1 className="font-semibold text-base leading-tight">{t("gmailAgent.title")}</h1>
            {profile?.email && (
              <p className="text-xs text-muted-foreground">{profile.email}</p>
            )}
          </div>
          {profile?.authenticated && (
            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
              <Wifi className="h-3 w-3 mr-1" />{t("gmailAgent.connected")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AvatarDock
            text={aiDraft?.replyBodyPlain || aiDraft?.replyBodyHtml?.replace(/<[^>]+>/g, "") || undefined}
            autoSpeak={false}
            accent="#2563eb"
            storageKey="buro.gmail.voice"
          />
          <Button variant="outline" size="sm" onClick={() => { refetchInbox(); qc.invalidateQueries({ queryKey: ["gmail-message"] }); }}>
            <RefreshCw className="h-4 w-4 mr-1" />{t("gmailAgent.refresh")}
          </Button>
          <Button variant="outline" size="icon" title={t("gmailAgent.print")} onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            disabled={!selectedEmail || isCreatingTask}
            onClick={createTaskFromEmail}
            title={t("gmailAgent.createTaskTooltip")}
          >
            <CheckCircle2 className="h-4 w-4" />{t("gmailAgent.createTask")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-indigo-600 border-indigo-300 hover:bg-indigo-50" onClick={() => navigateToProjets(selectedEmail?.subject)}>
            <FolderKanban className="h-4 w-4" />{t("gmailAgent.createProject")}
          </Button>
          <Button size="sm" onClick={() => { setComposeReplyTo(undefined); setComposeOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />{t("gmailAgent.newEmail")}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Email List */}
        <div className="w-72 border-r flex flex-col bg-background shrink-0">
          <div className="p-2 border-b space-y-2">
            <form onSubmit={handleSearch} className="flex gap-1">
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t("gmailAgent.filters.searchPlaceholder")}
                className="h-8 text-xs"
              />
              <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={t("common.search")}>
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </form>
            <div className="flex gap-1 flex-wrap">
              {[
                { labelKey: "inbox", filter: "is:inbox" },
                { labelKey: "unread", filter: "is:unread is:inbox" },
                { labelKey: "important", filter: "is:important is:inbox" },
                { labelKey: "starred", filter: "is:starred" },
              ].map(f => (
                <button
                  key={f.filter}
                  onClick={() => setActiveFilter(f.filter)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${activeFilter === f.filter ? "bg-blue-500 text-white border-blue-500" : "text-muted-foreground border-border hover:bg-muted"}`}
                >
                  {t(`gmailAgent.filters.${f.labelKey}`)}
                </button>
              ))}
            </div>
            {/* Filtres derives du triage IA — affiches uniquement si on a
                au moins un email triage, sinon les chips seraient vides
                et trompeurs. */}
            {Object.keys(triageMap).length > 0 && (
              <div className="flex gap-1 flex-wrap pt-1 border-t border-border/50">
                <button
                  onClick={() => setTriageFilter(null)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${triageFilter === null ? "bg-violet-500 text-white border-violet-500" : "text-muted-foreground border-border hover:bg-muted"}`}
                  title={t("gmailAgent.filters.allTooltip")}
                >
                  {t("gmailAgent.filters.all")}
                </button>
                {[
                  { key: "critique" as const, labelKey: "critique", count: triageCounts.critique, cls: "bg-red-500 text-white border-red-500" },
                  { key: "haute" as const, labelKey: "haute", count: triageCounts.haute, cls: "bg-orange-500 text-white border-orange-500" },
                  { key: "needsReply" as const, labelKey: "needsReply", count: triageCounts.needsReply, cls: "bg-violet-500 text-white border-violet-500" },
                  { key: "commercial" as const, labelKey: "commercial", count: triageCounts.commercial, cls: "bg-emerald-500 text-white border-emerald-500" },
                  { key: "spam" as const, labelKey: "spam", count: triageCounts.spam, cls: "bg-gray-500 text-white border-gray-500" },
                ].filter(c => c.count > 0).map(c => {
                  const label = t(`gmailAgent.filters.${c.labelKey}`);
                  return (
                  <button
                    key={c.key}
                    onClick={() => setTriageFilter(triageFilter === c.key ? null : c.key)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${triageFilter === c.key ? c.cls : "text-muted-foreground border-border hover:bg-muted"}`}
                    title={t("gmailAgent.filters.filterTooltip", { label, count: c.count })}
                  >
                    {label} {c.count}
                  </button>
                  );
                })}
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            {inboxLoading ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-1 p-2">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : displayedEmails.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {triageFilter ? (
                  <>
                    {t("gmailAgent.list.noEmailInFilter")}
                    <button
                      onClick={() => setTriageFilter(null)}
                      className="block mx-auto mt-2 text-xs text-violet-600 hover:underline"
                    >
                      {t("gmailAgent.list.reset")}
                    </button>
                  </>
                ) : t("gmailAgent.list.noEmail")}
              </div>
            ) : (
              displayedEmails.map(email => (
                <EmailListItem
                  key={email.id}
                  email={email}
                  selected={selectedEmail?.id === email.id}
                  triageInfo={triageMap[email.id]}
                  onClick={() => setSelectedEmail(email)}
                />
              ))
            )}
          </ScrollArea>

          {emails.length > 0 && (
            <div className="p-2 border-t space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={handleTriage}
                disabled={isTriaging}
              >
                {isTriaging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Brain className="h-3.5 w-3.5 mr-1" />
                )}
                {t("gmailAgent.list.triage", { count: emails.length })}
              </Button>
              {triageCounts.spam > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-gray-700 border-gray-300 hover:bg-gray-50"
                  onClick={handleArchiveSpam}
                  disabled={isCleaningSpam}
                  title={t("gmailAgent.list.cleanSpamTooltip")}
                >
                  {isCleaningSpam ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <X className="h-3.5 w-3.5 mr-1" />
                  )}
                  {t("gmailAgent.list.cleanSpam", { count: triageCounts.spam })}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* CENTER: Email Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedEmail ? (
            <div className="flex-1 flex items-center justify-center bg-muted/20">
              <div className="text-center text-muted-foreground space-y-2">
                <Mail className="h-12 w-12 mx-auto opacity-30" />
                <p className="text-sm">{t("gmailAgent.detail.selectToRead")}</p>
                {emails.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleTriage} disabled={isTriaging}>
                    <Brain className="h-4 w-4 mr-2" />
                    {isTriaging ? t("gmailAgent.detail.analyzing") : t("gmailAgent.detail.analyzeInbox")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b bg-background">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-sm truncate">{selectedEmail.subject}</h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground truncate">
                        {t("gmailAgent.detail.fromPrefix")} {parseEmailName(selectedEmail.from || "").name}
                        {" "}
                        <span className="text-muted-foreground/60">&lt;{parseEmailName(selectedEmail.from || "").email}&gt;</span>
                      </span>
                      <SmartDate dateStr={selectedEmail.date} />
                      {/* Badge CRM : vert si le sender est deja contact,
                          sinon bouton "+ Ajouter au CRM" qui cree un
                          prospect en un clic. Ne s'affiche que si l'email
                          est syntaxiquement valide. */}
                      {senderEmailValid && existingContact && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 bg-green-50 text-green-700 border-green-200 cursor-pointer hover:bg-green-100"
                          onClick={() => navigate(`/contacts?focus=${existingContact.id}`)}
                          title={t("gmailAgent.detail.viewContact")}
                        >
                          <Check className="h-2.5 w-2.5 mr-0.5" />
                          {t("gmailAgent.detail.inCrm")}
                        </Badge>
                      )}
                      {senderEmailValid && !existingContact && senderContactData && (
                        <button
                          onClick={handleAddSenderToContacts}
                          disabled={isAddingContact}
                          className="text-[10px] py-0 px-1.5 rounded border bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 disabled:opacity-50 inline-flex items-center"
                          title={t("gmailAgent.detail.addToCrmTooltip")}
                        >
                          {isAddingContact ? (
                            <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
                          ) : (
                            <Plus className="h-2.5 w-2.5 mr-0.5" />
                          )}
                          {t("gmailAgent.detail.addToCrm")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStar(selectedEmail.id, selectedEmail.starred)}>
                      {selectedEmail.starred ? <Star className="h-4 w-4 text-amber-400 fill-amber-400" /> : <StarOff className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                      setComposeReplyTo({ from: selectedEmail.from, subject: selectedEmail.subject, threadId: selectedEmail.threadId, messageId: emailDetail?.messageId });
                      setComposeOpen(true);
                    }}>
                      <Reply className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleArchive(selectedEmail.id)}>
                      <Archive className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleTrash(selectedEmail.id)} aria-label={t("common.delete")}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs ml-1"
                      onClick={handleScanEmail}
                      disabled={scanning}
                      title={t("gmailAgent.detail.securityTooltip")}
                    >
                      {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
                      {t("gmailAgent.detail.security")}
                    </Button>
                    <Button variant="default" size="sm" className="h-7 text-xs ml-1" onClick={handleDraftReply} disabled={isDrafting}>
                      {isDrafting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                      {t("gmailAgent.detail.aiReply")}
                    </Button>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4">
                  {detailLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ) : emailDetail ? (
                    <div className="space-y-3">
                      {/* Banniere d'insight IA : reutilise les donnees du
                          triage deja en memoire (triageMap[id]). Aucun
                          appel reseau supplementaire, aucun cout quota.
                          Affiche resume + action suggeree pour donner au
                          patron le contexte sans avoir a lire le mail. */}
                      {(() => {
                        const tri = triageMap[selectedEmail.id];
                        if (!tri || (!tri.summary && !tri.suggestedAction)) return null;
                        const priCfg = tri.priority ? PRIORITY_CONFIG[tri.priority] : null;
                        return (
                          <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2.5 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-800">
                              <Sparkles className="h-3 w-3" />
                              {t("gmailAgent.detail.aiAnalysis")}
                              {priCfg && (
                                <Badge variant="outline" className={`text-[10px] py-0 px-1 ${priCfg.color}`}>
                                  {t(`gmailAgent.priority.${tri.priority}`)}
                                </Badge>
                              )}
                              {tri.needsReply && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1 bg-violet-100 text-violet-700 border-violet-200">
                                  {t("gmailAgent.filters.needsReply")}
                                </Badge>
                              )}
                            </div>
                            {tri.summary && (
                              <p className="text-xs text-foreground leading-snug">{tri.summary}</p>
                            )}
                            {tri.suggestedAction && (
                              <p className="text-xs text-violet-700 leading-snug">
                                <span className="font-medium">→ </span>{tri.suggestedAction}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      {/* Rapport de securite. Affiche uniquement pour le mail
                          reellement analyse, pour ne jamais montrer le verdict
                          d'un autre message apres un changement de selection. */}
                      {scanReport && scanReport.messageId === selectedEmail.id && (() => {
                        const risk: string = scanReport.overallRisk || "safe";
                        const cfg = risk === "dangerous"
                          ? { border: "border-red-200", bg: "bg-red-50/60", text: "text-red-800", label: t("gmailAgent.scan.dangerous"), Icon: ShieldAlert }
                          : risk === "suspicious"
                          ? { border: "border-amber-200", bg: "bg-amber-50/60", text: "text-amber-800", label: t("gmailAgent.scan.suspicious"), Icon: AlertTriangle }
                          : { border: "border-emerald-200", bg: "bg-emerald-50/60", text: "text-emerald-800", label: t("gmailAgent.scan.safe"), Icon: ShieldCheck };
                        const s = scanReport.stats || {};
                        const auth = scanReport.senderAuth;
                        const ai = scanReport.aiAnalysis;
                        return (
                          <div className={`rounded-md border ${cfg.border} ${cfg.bg} p-2.5 space-y-2`}>
                            <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${cfg.text}`}>
                              <cfg.Icon className="h-3.5 w-3.5" />
                              {t("gmailAgent.scan.title", { label: cfg.label })}
                              {typeof scanReport.riskScore === "number" && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1">
                                  {t("gmailAgent.scan.riskBadge", { score: scanReport.riskScore })}
                                </Badge>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-1.5 text-[10px]">
                              <Badge variant="outline" className="py-0 px-1">
                                <Paperclip className="h-2.5 w-2.5 mr-0.5" />
                                {t("gmailAgent.scan.attachments", { count: s.attachmentsScanned || 0 })}
                                {s.attachmentsThreatened ? t("gmailAgent.scan.threats", { count: s.attachmentsThreatened }) : ""}
                              </Badge>
                              <Badge variant="outline" className="py-0 px-1">
                                <Link2 className="h-2.5 w-2.5 mr-0.5" />
                                {t("gmailAgent.scan.links", { count: s.linksScanned || 0 })}
                                {s.linksDangerous ? t("gmailAgent.scan.linksDangerous", { count: s.linksDangerous }) : ""}
                                {s.linksSuspicious ? t("gmailAgent.scan.linksSuspicious", { count: s.linksSuspicious }) : ""}
                              </Badge>
                              {auth && (
                                <Badge variant="outline" className={`py-0 px-1 ${auth.suspicious ? "text-red-700 border-red-200" : "text-emerald-700 border-emerald-200"}`}>
                                  SPF {auth.spf} · DKIM {auth.dkim} · DMARC {auth.dmarc}
                                </Badge>
                              )}
                            </div>

                            {ai && (
                              <div className="space-y-1">
                                <p className={`text-xs leading-snug ${cfg.text}`}>
                                  <span className="font-medium">{t("gmailAgent.scan.verdict", { verdict: ai.verdict, score: ai.phishingScore })}</span>
                                  {ai.summary}
                                </p>
                                {ai.impersonation && (
                                  <p className="text-xs text-red-700 leading-snug">
                                    {t("gmailAgent.scan.impersonation", { value: ai.impersonation })}
                                  </p>
                                )}
                                {ai.socialEngineering?.length > 0 && (
                                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                                    {ai.socialEngineering.map((r: string, i: number) => <li key={i}>{r}</li>)}
                                  </ul>
                                )}
                                {ai.recommendation && (
                                  <p className="text-xs font-medium leading-snug">→ {ai.recommendation}</p>
                                )}
                              </div>
                            )}

                            {scanReport.links?.filter((l: any) => l.risk !== "safe").length > 0 && (
                              <div className="space-y-0.5">
                                {scanReport.links.filter((l: any) => l.risk !== "safe").map((l: any, i: number) => (
                                  <p key={i} className={`text-[11px] leading-snug ${l.risk === "dangerous" ? "text-red-700" : "text-amber-700"}`}>
                                    {l.displayUrl} — {l.reasons?.join(", ") || l.risk}
                                  </p>
                                ))}
                              </div>
                            )}

                            {scanReport.attachments?.filter((a: any) => !a.safe).map((a: any, i: number) => (
                              <p key={i} className="text-[11px] text-red-700 leading-snug">
                                {a.filename} — {a.threats?.join(", ") || t("gmailAgent.scan.threatDetected")}
                              </p>
                            ))}
                          </div>
                        );
                      })()}
                      {emailDetail.cc && (
                        <p className="text-xs text-muted-foreground">{t("gmailAgent.detail.ccPrefix")} {emailDetail.cc}</p>
                      )}
                      {emailDetail.attachments?.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap py-2 px-3 bg-muted/30 rounded-md">
                          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                          {emailDetail.attachments.map((att: any, i: number) => {
                            // Construit l'URL absolue du backend a partir
                            // du baseUrl deja calcule (gere le prefix
                            // /buro-ajani/api en preview comme en prod).
                            const href = `${baseUrl}/api/gmail/message/${selectedEmail.id}/attachment/${att.attachmentId}`;
                            return (
                              <span key={i} className="inline-flex items-center rounded border bg-background overflow-hidden">
                                <a
                                  href={href}
                                  download={att.filename}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 hover:bg-muted transition-colors"
                                  title={t("gmailAgent.detail.downloadTooltip", { filename: att.filename })}
                                >
                                  <Download className="h-3 w-3 text-muted-foreground" />
                                  {att.filename}
                                  {att.size ? <span className="text-muted-foreground/60">({Math.round(att.size / 1024)} KB)</span> : null}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleSaveAttachment(att)}
                                  disabled={savingAtt === att.attachmentId}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 border-l hover:bg-muted transition-colors disabled:opacity-50"
                                  title={t("gmailAgent.detail.saveToDocsTooltip")}
                                >
                                  {savingAtt === att.attachmentId
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <FolderKanban className="h-3 w-3 text-muted-foreground" />}
                                  <span className="hidden sm:inline">{t("gmailAgent.documents")}</span>
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <Separator />
                      {emailDetail.bodyHtml ? (
                        <div className="relative">
                          <iframe
                            ref={iframeRef}
                            srcDoc={emailDetail.bodyHtml}
                            className="w-full border-0 min-h-[400px]"
                            sandbox="allow-same-origin"
                            onLoad={e => {
                              const iframe = e.currentTarget;
                              try {
                                iframe.style.height = iframe.contentDocument?.body?.scrollHeight + "px";
                              } catch {}
                            }}
                            title={t("gmailAgent.emailContentTitle")}
                          />
                        </div>
                      ) : (
                        <pre className="text-sm whitespace-pre-wrap font-sans">{emailDetail.bodyPlain}</pre>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm">{selectedEmail.snippet}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="p-3 border-t bg-muted/20">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                  setComposeReplyTo({
                    from: selectedEmail.from,
                    subject: selectedEmail.subject,
                    threadId: selectedEmail.threadId,
                    messageId: emailDetail?.messageId,
                  });
                  setComposeOpen(true);
                }}>
                  <CornerDownLeft className="h-3.5 w-3.5 mr-1" />{t("gmailAgent.detail.reply")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: AI Agent Panel */}
        <div className="w-80 border-l flex flex-col bg-background shrink-0">
          <div className="px-3 py-2.5 border-b">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-semibold">{t("gmailAgent.agentIa")}</h3>
              <Badge variant="outline" className="text-[10px] ml-auto bg-violet-50 text-violet-700 border-violet-200">
                Gemini 2.5 Pro
              </Badge>
            </div>
          </div>

          <Tabs value={aiPanelTab} onValueChange={setAiPanelTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="mx-2 mt-2 h-7">
              <TabsTrigger value="triage" className="text-xs flex-1 h-6">{t("gmailAgent.panel.triage")}</TabsTrigger>
              <TabsTrigger value="reply" className="text-xs flex-1 h-6">{t("gmailAgent.panel.aiReply")}</TabsTrigger>
            </TabsList>

            <TabsContent value="triage" className="flex-1 overflow-hidden m-0 px-0">
              <ScrollArea className="h-full">
                <div className="p-3 space-y-3">
                  {!triageData && !isTriaging && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {t("gmailAgent.panel.intro")}
                      </p>
                      <Button className="w-full" size="sm" onClick={handleTriage} disabled={!emails.length || isTriaging}>
                        <Brain className="h-4 w-4 mr-2" />
                        {t("gmailAgent.panel.analyzeCount", { count: emails.length })}
                      </Button>
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">{t("gmailAgent.panel.canDo")}</p>
                        {["cap1", "cap2", "cap3", "cap4", "cap5"].map(f => (
                          <div key={f} className="flex items-center gap-1.5">
                            <Check className="h-3 w-3 text-green-500" />
                            <span>{t(`gmailAgent.panel.${f}`)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isTriaging && (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <div className="relative">
                        <Brain className="h-10 w-10 text-violet-400" />
                        <Loader2 className="h-5 w-5 text-violet-600 animate-spin absolute -bottom-1 -right-1" />
                      </div>
                      <p className="text-xs text-muted-foreground text-center">{t("gmailAgent.panel.analyzingWith")}</p>
                    </div>
                  )}

                  {triageData && !isTriaging && (
                    <div className="space-y-3">
                      <div className="bg-violet-50 rounded-lg p-3 border border-violet-100">
                        <p className="text-xs font-medium text-violet-800 mb-1">{t("gmailAgent.panel.executiveSummary")}</p>
                        <p className="text-xs text-violet-700">{triageData.triage?.executiveSummary}</p>
                      </div>

                      {triageData.triage?.overview && (
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: t("gmailAgent.panel.criticals"), val: triageData.triage.overview.criticalCount, color: "text-red-600" },
                            { label: t("gmailAgent.panel.needsReply"), val: triageData.triage.overview.needsReplyCount, color: "text-orange-600" },
                            { label: t("gmailAgent.panel.commercials"), val: triageData.triage.overview.commercialOpportunities, color: "text-emerald-600" },
                            { label: t("gmailAgent.panel.finances"), val: triageData.triage.overview.financialItems, color: "text-amber-600" },
                          ].map(item => (
                            <div key={item.label} className="bg-muted/30 rounded p-2 text-center">
                              <p className={`text-lg font-bold ${item.color}`}>{item.val || 0}</p>
                              <p className="text-[10px] text-muted-foreground">{item.label}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {triageData.triage?.priorityActions?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1.5">{t("gmailAgent.panel.priorityActions")}</p>
                          <div className="space-y-1.5">
                            {triageData.triage.priorityActions.map((action: string, i: number) => (
                              <div key={i} className="flex items-start gap-1.5 text-xs">
                                <div className="w-4 h-4 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 text-[10px] font-bold mt-0.5">{i + 1}</div>
                                <span>{action}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {triageData.triage?.triage?.filter((t: any) => t.priority === "critique" || t.priority === "haute").length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1.5">{t("gmailAgent.panel.priorityEmails")}</p>
                          <div className="space-y-1.5">
                            {triageData.triage.triage
                              .filter((tr: any) => tr.priority === "critique" || tr.priority === "haute")
                              .slice(0, 5)
                              .map((tr: any, i: number) => {
                                const email = emails.find((e: any) => e.id === tr.emailId);
                                const pri = PRIORITY_CONFIG[tr.priority];
                                return (
                                  <button key={i} onClick={() => { if (email) setSelectedEmail(email); }}
                                    className="w-full text-left rounded border p-2 hover:bg-muted/50 transition-colors">
                                    <div className="flex items-center gap-1 mb-0.5">
                                      <Badge variant="outline" className={`text-[9px] py-0 px-1 ${pri?.color}`}>{t(`gmailAgent.priority.${tr.priority}`)}</Badge>
                                      {tr.needsReply && <Badge variant="outline" className="text-[9px] py-0 px-1 bg-violet-100 text-violet-700">{t("gmailAgent.replyShort")}</Badge>}
                                    </div>
                                    <p className="text-[11px] font-medium truncate">{email?.subject || tr.emailId}</p>
                                    <p className="text-[10px] text-muted-foreground truncate">{tr.summary}</p>
                                    <p className="text-[10px] text-blue-600 mt-0.5">→ {tr.suggestedAction}</p>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleTriage} disabled={isTriaging}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />{t("gmailAgent.panel.relaunchTriage")}
                      </Button>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="reply" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full">
                <div className="p-3 space-y-3">
                  {!selectedEmail ? (
                    <p className="text-xs text-muted-foreground">{t("gmailAgent.panel.selectToReply")}</p>
                  ) : (
                    <>
                      <div className="bg-muted/30 rounded p-2">
                        <p className="text-[10px] text-muted-foreground">{t("gmailAgent.panel.selectedEmail")}</p>
                        <p className="text-xs font-medium truncate">{selectedEmail.subject}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{parseEmailName(selectedEmail.from || "").name}</p>
                      </div>

                      <div>
                        <Label className="text-xs">{t("gmailAgent.panel.replyTone")}</Label>
                        <Select value={tone} onValueChange={setTone}>
                          <SelectTrigger className="h-8 text-xs mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TONE_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">{t(`gmailAgent.tone.${opt.value}`)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs">{t("gmailAgent.panel.additionalInstructions")}</Label>
                        <Textarea
                          value={draftInstructions}
                          onChange={e => setDraftInstructions(e.target.value)}
                          placeholder={t("gmailAgent.panel.instructionsPlaceholder")}
                          className="mt-1 text-xs min-h-[60px]"
                        />
                      </div>

                      <Button className="w-full" size="sm" onClick={handleDraftReply} disabled={isDrafting}>
                        {isDrafting ? (
                          <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t("gmailAgent.panel.generating")}</>
                        ) : (
                          <><Sparkles className="h-4 w-4 mr-2" />{t("gmailAgent.panel.generateReply")}</>
                        )}
                      </Button>

                      {isDrafting && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center py-2">
                          <Brain className="h-4 w-4 text-violet-400 animate-pulse" />
                          {t("gmailAgent.panel.crmGenerating")}
                        </div>
                      )}

                      {aiDraft && !isDrafting && aiDraftForEmailId === selectedEmail?.id && (
                        <div className="space-y-3">
                          <Separator />
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold">{t("gmailAgent.panel.replyGenerated")}</p>
                            <div className="flex gap-1">
                              {aiDraft.urgency && (
                                <Badge variant="outline" className={`text-[9px] ${aiDraft.urgency === "haute" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600"}`}>
                                  {aiDraft.urgency}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="bg-blue-50 border border-blue-100 rounded p-2 space-y-1">
                            <p className="text-[10px] text-muted-foreground">{t("gmailAgent.panel.subject")}</p>
                            <p className="text-xs font-medium">{aiDraft.replySubject}</p>
                          </div>

                          <div className="bg-muted/30 rounded p-2 max-h-48 overflow-y-auto">
                            <p className="text-[10px] text-muted-foreground mb-1">{t("gmailAgent.panel.messageBody")}</p>
                            <p className="text-xs whitespace-pre-wrap">
                              {aiDraft.replyBodyPlain || aiDraft.replyBodyHtml?.replace(/<[^>]+>/g, "").trim()}
                            </p>
                          </div>

                          {aiDraft.detectedIntent && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              {t("gmailAgent.panel.intent", { value: aiDraft.detectedIntent })}
                            </div>
                          )}

                          {aiDraft.suggestedActions?.length > 0 && (
                            <div>
                              <p className="text-[10px] font-medium mb-1">{t("gmailAgent.panel.recommendedActions")}</p>
                              {aiDraft.suggestedActions.slice(0, 3).map((a: string, i: number) => (
                                <p key={i} className="text-[10px] text-muted-foreground flex items-start gap-1">
                                  <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" />{a}
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-1.5">
                            <Button size="sm" className="flex-1 text-xs h-7" onClick={handleUseReply}>
                              <Send className="h-3.5 w-3.5 mr-1" />{t("gmailAgent.panel.use")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => {
                              navigator.clipboard.writeText(aiDraft.replyBodyPlain || aiDraft.replyBodyHtml?.replace(/<[^>]+>/g, "") || "");
                              toast({ title: t("gmailAgent.toast.copied") });
                            }} aria-label={t("common.copy")}>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>

                          {aiDraft.alternativeReplies?.length > 0 && (
                            <div>
                              <p className="text-[10px] font-medium mb-1.5">{t("gmailAgent.panel.alternatives")}</p>
                              <div className="space-y-1.5">
                                {aiDraft.alternativeReplies.slice(0, 2).map((alt: any, i: number) => (
                                  <button key={i}
                                    onClick={() => setAiDraft({ ...aiDraft, replyBodyHtml: alt.bodyHtml, replyBodyPlain: alt.bodyHtml?.replace(/<[^>]+>/g, "") })}
                                    className="w-full text-left rounded border p-2 hover:bg-muted/50 transition-colors">
                                    <p className="text-[10px] font-medium text-blue-600">{alt.label}</p>
                                    <p className="text-[10px] text-muted-foreground truncate">
                                      {alt.bodyHtml?.replace(/<[^>]+>/g, "").slice(0, 80)}...
                                    </p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        replyTo={composeReplyTo}
      />
    </div>
  );
}
