import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import {
Dialog,DialogContent,
DialogFooter,
DialogHeader,DialogTitle,
DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
Activity,
AlertTriangle,
BarChart3,
Bell,
Bot,CalendarClock,
CheckCircle,
CheckSquare,
ClipboardList,
Clock,
Copy,
Download,
FileText,
FolderKanban,
Loader2,
Mail,
MessageSquare,
PauseCircle,
Pencil,
Phone,
PlayCircle,
Plus,
Printer,
RefreshCw,Settings2,
ShieldCheck,
Square,
Trash2,
TrendingUp,
Users,
X,
Zap,
} from "lucide-react";
import { useEffect,useState } from "react";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const TYPE_ICONS: Record<string, any> = {
  "Taches en retard": FileText,
  "Rappels calendrier": CalendarClock,
  "Messages non lus": Mail,
  "Contacts inactifs": Users,
  "Appels manques": Phone,
};

const TYPE_COLORS: Record<string, string> = {
  "Taches en retard": "text-red-500 bg-red-500/10",
  "Rappels calendrier": "text-blue-500 bg-blue-500/10",
  "Messages non lus": "text-purple-500 bg-purple-500/10",
  "Contacts inactifs": "text-amber-500 bg-amber-500/10",
  "Appels manques": "text-green-500 bg-green-500/10",
};

const TRIGGER_LABELS: Record<string, string> = {
  schedule: "automationsPage.trigger.schedule",
  missed_call: "automationsPage.trigger.missed_call",
  contact_no_activity: "automationsPage.trigger.contact_no_activity",
  task_overdue: "automationsPage.trigger.task_overdue",
  projet_overdue: "automationsPage.trigger.projet_overdue",
  projet_created: "automationsPage.trigger.projet_created",
};

const TRIGGER_ICONS: Record<string, any> = {
  schedule: CalendarClock,
  missed_call: Phone,
  contact_no_activity: Users,
  task_overdue: CheckSquare,
  projet_overdue: FolderKanban,
  projet_created: FolderKanban,
};

const TRIGGER_COLORS: Record<string, string> = {
  schedule: "bg-blue-500/10 text-blue-500",
  missed_call: "bg-green-500/10 text-green-500",
  contact_no_activity: "bg-amber-500/10 text-amber-500",
  task_overdue: "bg-orange-500/10 text-orange-500",
  projet_overdue: "bg-indigo-500/10 text-indigo-500",
  projet_created: "bg-indigo-500/10 text-indigo-500",
};

const ACTION_LABELS: Record<string, string> = {
  send_notification: "automationsPage.action.send_notification",
  create_task: "automationsPage.action.create_task",
  send_sms: "automationsPage.action.send_sms",
};

const ACTION_ICONS: Record<string, any> = {
  send_notification: Bell,
  create_task: ClipboardList,
  send_sms: MessageSquare,
};

/**
 * Libelles de la politique d'approbation d'une regle. `null` est le defaut et
 * le cas courant: une regle se declenche seule toutes les 5 minutes, donc ce
 * qui sort vers un client (e-mail, SMS) est propose en file d'approbation
 * tandis que ce qui reste interne (notification, tache) s'execute directement.
 */
const APPROVAL_META = (v: boolean | null) =>
  v === true
    ? { labelKey: "automationsPage.approval.allValidate", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", toastKey: "automationsPage.approval.allValidateToast" }
    : v === false
      ? { labelKey: "automationsPage.approval.allAuto", cls: "bg-red-500/10 text-red-600 border-red-500/30", toastKey: "automationsPage.approval.allAutoToast" }
      : { labelKey: "automationsPage.approval.sendValidate", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", toastKey: "automationsPage.approval.sendValidateToast" };

interface RuleAction {
  type: string;
  params: Record<string, string>;
}

interface RuleForm {
  name: string;
  description: string;
  trigger: string;
  schedule: string;
  inactivityDays: string;
  actions: RuleAction[];
}

const DEFAULT_FORM: RuleForm = {
  name: "",
  description: "",
  trigger: "schedule",
  schedule: "1h",
  inactivityDays: "30",
  actions: [{ type: "send_notification", params: { title: "", message: "", notifType: "info" } }],
};

function ActionEditor({ action, onChange, onRemove }: {
  action: RuleAction;
  index: number;
  onChange: (updated: RuleAction) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const Icon = ACTION_ICONS[action.type] || Bell;

  function setParam(key: string, value: string) {
    onChange({ ...action, params: { ...action.params, [key]: value } });
  }

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary shrink-0" />
        <Select value={action.type} onValueChange={t => onChange({ type: t, params: {} })}>
          <SelectTrigger className="flex-1 h-8 text-sm" aria-label={t("automationsPage.editor.actionType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{t(l)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8 text-muted-foreground" onClick={onRemove} aria-label={t("common.delete")}>
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </div>

      {action.type === "send_notification" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t("automationsPage.editor.title")}</Label>
              <Input aria-label={t("automationsPage.editor.title")} className="h-7 text-xs mt-1" value={action.params.title ?? ""} onChange={e => setParam("title", e.target.value)} placeholder={t("automationsPage.editor.notifTitlePlaceholder")} />
            </div>
            <div>
              <Label className="text-xs">{t("automationsPage.editor.type")}</Label>
              <Select value={action.params.notifType ?? "info"} onValueChange={v => setParam("notifType", v)}>
                <SelectTrigger aria-label={t("automationsPage.editor.type")} className="h-7 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">{t("automationsPage.editor.typeInfo")}</SelectItem>
                  <SelectItem value="alerte">{t("automationsPage.editor.typeAlerte")}</SelectItem>
                  <SelectItem value="rappel">{t("automationsPage.editor.typeRappel")}</SelectItem>
                  <SelectItem value="succes">{t("automationsPage.editor.typeSucces")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("automationsPage.editor.message")} <span className="text-muted-foreground">{t("automationsPage.editor.phoneAvailable")}</span></Label>
            <Textarea aria-label={t("automationsPage.editor.message")} className="text-xs mt-1 min-h-[60px]" value={action.params.message ?? ""} onChange={e => setParam("message", e.target.value)} placeholder={t("automationsPage.editor.notifMessagePlaceholder")} />
          </div>
        </>
      )}

      {action.type === "create_task" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">{t("automationsPage.editor.taskTitle")}</Label>
            <Input aria-label={t("automationsPage.editor.taskTitle")} className="h-7 text-xs mt-1" value={action.params.title ?? ""} onChange={e => setParam("title", e.target.value)} placeholder={t("automationsPage.editor.taskTitlePlaceholder")} />
          </div>
          <div>
            <Label className="text-xs">{t("automationsPage.editor.priority")}</Label>
            <Select value={action.params.priority ?? "moyenne"} onValueChange={v => setParam("priority", v)}>
              <SelectTrigger aria-label={t("automationsPage.editor.priority")} className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basse">{t("automationsPage.editor.prioBasse")}</SelectItem>
                <SelectItem value="moyenne">{t("automationsPage.editor.prioMoyenne")}</SelectItem>
                <SelectItem value="haute">{t("automationsPage.editor.prioHaute")}</SelectItem>
                <SelectItem value="urgente">{t("automationsPage.editor.prioUrgente")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("automationsPage.editor.dueDays")}</Label>
            <Input aria-label={t("automationsPage.editor.dueDays")} type="number" className="h-7 text-xs mt-1" value={action.params.dueDays ?? "1"} onChange={e => setParam("dueDays", e.target.value)} min="1" />
          </div>
        </div>
      )}

      {action.type === "send_sms" && (
        <>
          <div>
            <Label className="text-xs">{t("automationsPage.editor.smsTo")} <span className="text-muted-foreground">{t("automationsPage.editor.smsToHint")}</span></Label>
            <Input aria-label={t("automationsPage.editor.smsTo")} className="h-7 text-xs mt-1" value={action.params.to ?? ""} onChange={e => setParam("to", e.target.value)} placeholder={t("automationsPage.editor.smsToPlaceholder")} />
          </div>
          <div>
            <Label className="text-xs">{t("automationsPage.editor.smsMessage")} <span className="text-muted-foreground">{t("automationsPage.editor.phoneAvailable")}</span></Label>
            <Textarea aria-label={t("automationsPage.editor.smsMessage")} className="text-xs mt-1 min-h-[60px]" value={action.params.message ?? ""} onChange={e => setParam("message", e.target.value)} placeholder={t("automationsPage.editor.smsMessagePlaceholder")} />
          </div>
        </>
      )}
    </div>
  );
}

function EditRuleDialog({ rule, onSaved, onClose }: { rule: any; onSaved: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; description: string; schedule: string }>({
    name: rule.name || "",
    description: rule.description || "",
    schedule: rule.schedule || "1h",
  });

  async function submit() {
    if (!form.name.trim()) { toast({ title: t("automationsPage.toast.nameRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/automations/${rule.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim(), schedule: form.schedule }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      toast({ title: t("automationsPage.toast.ruleUpdated") });
      onSaved();
      onClose();
    } catch {
      toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.updateError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" /> {t("automationsPage.dialog.editTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("automationsPage.dialog.ruleName")} <span className="text-red-500">*</span></Label>
            <Input aria-label={t("automationsPage.dialog.ruleName")} className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>{t("automationsPage.dialog.description")}</Label>
            <Input aria-label={t("automationsPage.dialog.description")} className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <Label>{t("automationsPage.dialog.frequency")}</Label>
            <Select value={form.schedule} onValueChange={v => setForm(f => ({ ...f, schedule: v }))}>
              <SelectTrigger aria-label={t("automationsPage.dialog.frequency")} className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5min">{t("automationsPage.schedule.5min")}</SelectItem>
                <SelectItem value="15min">{t("automationsPage.schedule.15min")}</SelectItem>
                <SelectItem value="30min">{t("automationsPage.schedule.30min")}</SelectItem>
                <SelectItem value="1h">{t("automationsPage.schedule.1h")}</SelectItem>
                <SelectItem value="6h">{t("automationsPage.schedule.6h")}</SelectItem>
                <SelectItem value="12h">{t("automationsPage.schedule.12h")}</SelectItem>
                <SelectItem value="24h">{t("automationsPage.schedule.24h")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("automationsPage.cancel")}</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
            {t("automationsPage.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRuleDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RuleForm>(DEFAULT_FORM);

  function addAction() {
    setForm(f => ({ ...f, actions: [...f.actions, { type: "send_notification", params: { title: "", message: "", notifType: "info" } }] }));
  }

  function updateAction(i: number, updated: RuleAction) {
    setForm(f => { const a = [...f.actions]; a[i] = updated; return { ...f, actions: a }; });
  }

  function removeAction(i: number) {
    setForm(f => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }));
  }

  async function submit() {
    if (!form.name.trim()) { toast({ title: t("automationsPage.toast.nameRequired"), variant: "destructive" }); return; }
    if (form.actions.length === 0) { toast({ title: t("automationsPage.toast.actionRequired"), variant: "destructive" }); return; }

    setSaving(true);
    try {
      const conditions = form.trigger === "contact_no_activity"
        ? { inactivityDays: parseInt(form.inactivityDays) || 30 }
        : undefined;

      const res = await fetch(`${baseUrl}/api/automations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          type: "custom",
          trigger: form.trigger,
          schedule: form.schedule,
          conditions,
          actions: form.actions,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "HTTP error");
      }

      toast({ title: t("automationsPage.toast.ruleCreated"), description: t("automationsPage.toast.ruleCreatedDesc", { name: form.name }) });
      setOpen(false);
      setForm(DEFAULT_FORM);
      onCreated();
    } catch (err: any) {
      toast({ title: t("automationsPage.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" /> {t("automationsPage.dialog.newRule")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" /> {t("automationsPage.dialog.createTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>{t("automationsPage.dialog.ruleName")} <span className="text-red-500">*</span></Label>
              <Input aria-label={t("automationsPage.dialog.ruleName")} className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t("automationsPage.dialog.ruleNamePlaceholder")} />
            </div>
            <div className="col-span-2">
              <Label>{t("automationsPage.dialog.description")}</Label>
              <Input aria-label={t("automationsPage.dialog.description")} className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={t("automationsPage.dialog.descriptionPlaceholder")} />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("automationsPage.dialog.trigger")}</Label>
              <Select value={form.trigger} onValueChange={v => setForm(f => ({ ...f, trigger: v }))}>
                <SelectTrigger aria-label={t("automationsPage.dialog.trigger")} className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{t(l)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("automationsPage.dialog.frequency")}</Label>
              <Select value={form.schedule} onValueChange={v => setForm(f => ({ ...f, schedule: v }))}>
                <SelectTrigger aria-label={t("automationsPage.dialog.frequency")} className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5min">{t("automationsPage.schedule.5min")}</SelectItem>
                  <SelectItem value="15min">{t("automationsPage.schedule.15min")}</SelectItem>
                  <SelectItem value="30min">{t("automationsPage.schedule.30min")}</SelectItem>
                  <SelectItem value="1h">{t("automationsPage.schedule.1h")}</SelectItem>
                  <SelectItem value="6h">{t("automationsPage.schedule.6h")}</SelectItem>
                  <SelectItem value="12h">{t("automationsPage.schedule.12h")}</SelectItem>
                  <SelectItem value="24h">{t("automationsPage.schedule.24h")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.trigger === "contact_no_activity" && (
              <div>
                <Label>{t("automationsPage.dialog.inactivityDays")}</Label>
                <Input aria-label={t("automationsPage.dialog.inactivityDays")} type="number" className="mt-1" value={form.inactivityDays} onChange={e => setForm(f => ({ ...f, inactivityDays: e.target.value }))} min="1" max="365" />
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">{t("automationsPage.dialog.actionsLabel", { count: form.actions.length })}</Label>
              <Button size="sm" variant="outline" onClick={addAction} className="gap-1 h-7 text-xs">
                <Plus className="w-3 h-3" /> {t("automationsPage.dialog.add")}
              </Button>
            </div>
            {form.actions.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">{t("automationsPage.dialog.noAction")}</p>
            )}
            {form.actions.map((a, i) => (
              <ActionEditor key={i} action={a} index={i} onChange={u => updateAction(i, u)} onRemove={() => removeAction(i)} />
            ))}
          </div>

          {form.trigger === "missed_call" && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              <strong>{t("automationsPage.dialog.tipLabel")}</strong> {t("automationsPage.dialog.missedCallTip")}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("automationsPage.cancel")}</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {t("automationsPage.dialog.createRule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AutomationsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rules, setRules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  async function fetchData() {
    setLoading(true);
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetch(`${baseUrl}/api/automations`, { credentials: "include" }),
        fetch(`${baseUrl}/api/automations/logs?limit=100`, { credentials: "include" }),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules);
      } else {
        toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.loadRulesError"), variant: "destructive" });
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs);
        setStats(data.stats);
      } else {
        toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.loadLogsError"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[Automations] fetch failed:", err);
      toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function deleteRule(id: number, name: string) {
    if (!(await confirmAction({ title: t("automationsPage.confirmDelete", { name }), confirmLabel: t("automationsPage.confirmDeleteLabel"), destructive: true }))) return;
    try {
      const res = await fetch(`${baseUrl}/api/automations/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erreur serveur");
      toast({ title: t("automationsPage.toast.ruleDeleted") });
      fetchData();
    } catch {
      toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.deleteError"), variant: "destructive" });
    }
  }

  async function toggleRule(id: number, enabled: boolean) {
    try {
      const res = await fetch(`${baseUrl}/api/automations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      fetchData();
    } catch {
      toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.updateError"), variant: "destructive" });
    }
  }

  /**
   * Fait tourner la politique d'approbation de la regle:
   *   null (defaut: sortant valide, interne automatique) → true (tout valide)
   *   → false (tout automatique) → null
   */
  async function cycleApproval(id: number, current: boolean | null) {
    const next = current === null ? true : current === true ? false : null;
    try {
      const res = await fetch(`${baseUrl}/api/automations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiresApproval: next }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      toast({ title: t(APPROVAL_META(next).toastKey) });
      fetchData();
    } catch {
      toast({ title: t("automationsPage.toast.error"), description: t("automationsPage.toast.approvalError"), variant: "destructive" });
    }
  }

  useEffect(() => { fetchData(); }, []);

  const toggleSelectMode = () => { setSelectMode(v => !v); setSelectedIds(new Set()); };
  const toggleId = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (ids: number[]) => {
    if (selectedIds.size === ids.length && ids.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(ids));
  };
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("automationsPage.confirmBulkDelete", { count: selectedIds.size }), confirmLabel: t("automationsPage.confirmDeleteLabel"), destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const res = await fetch(`${baseUrl}/api/automations/bulk/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    if (res.ok) { toast({ title: t("automationsPage.toast.bulkDeleted", { count: selectedIds.size }) }); setSelectedIds(new Set()); setSelectMode(false); fetchData(); }
    else { const d = await res.json(); toast({ title: t("automationsPage.toast.error"), description: d.error, variant: "destructive" }); }
  };
  const handleBulkToggle = async (enabled: boolean) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const res = await fetch(`${baseUrl}/api/automations/bulk/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, enabled }) });
    if (res.ok) { toast({ title: enabled ? t("automationsPage.toast.rulesActivated") : t("automationsPage.toast.rulesSuspended") }); setSelectedIds(new Set()); setSelectMode(false); fetchData(); }
    else { const d = await res.json(); toast({ title: t("automationsPage.toast.error"), description: d.error, variant: "destructive" }); }
  };

  function timeAgo(date: string | null): string {
    if (!date) return t("automationsPage.timeAgo.never");
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("automationsPage.timeAgo.now");
    if (mins < 60) return t("automationsPage.timeAgo.minutes", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("automationsPage.timeAgo.hours", { n: hours });
    return t("automationsPage.timeAgo.days", { n: Math.floor(hours / 24) });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const builtInRules = rules.filter(r => r.builtIn);
  const customRules = rules.filter(r => !r.builtIn);
  const successRate = stats ? (stats.totalToday > 0 ? Math.round((stats.successToday / stats.totalToday) * 100) : 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
              <Zap className="w-6 h-6" />
            </div>
            {t("automationsPage.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("automationsPage.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" /> {t("automationsPage.refresh")}
          </Button>
          <a href={`${baseUrl}/api/automations/export/csv`} download="automations.csv">
            <Button variant="outline" size="sm" title={t("automationsPage.exportCsv")}><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="outline" size="icon" title={t("automationsPage.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <CreateRuleDialog onCreated={fetchData} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-green-500/10 text-green-500">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalToday || 0}</p>
                <p className="text-xs text-muted-foreground">{t("automationsPage.stats.executionsToday")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{successRate}%</p>
                <p className="text-xs text-muted-foreground">{t("automationsPage.stats.successRate")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.itemsToday || 0}</p>
                <p className="text-xs text-muted-foreground">{t("automationsPage.stats.itemsProcessed")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.errorToday || 0}</p>
                <p className="text-xs text-muted-foreground">{t("automationsPage.stats.errors")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="regles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="regles" className="gap-1.5">
            <Settings2 className="w-4 h-4" /> {t("automationsPage.tabs.rules")}
          </TabsTrigger>
          <TabsTrigger value="journal" className="gap-1.5">
            <BarChart3 className="w-4 h-4" /> {t("automationsPage.tabs.journal")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="regles" className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Bot className="w-4 h-4" /> {t("automationsPage.systemSection")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {builtInRules.map(rule => {
              const Icon = TYPE_ICONS[rule.name] || Zap;
              const colorClass = TYPE_COLORS[rule.name] || "text-gray-500 bg-gray-500/10";
              return (
                <Card key={rule.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${colorClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-sm">{rule.name}</h4>
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                            <PlayCircle className="w-2.5 h-2.5 mr-0.5" /> {t("automationsPage.active")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{rule.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {t("automationsPage.every5min")}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">{t("automationsPage.system")}</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> {t("automationsPage.customSection", { count: customRules.length })}
            </h3>
            {customRules.length > 0 && (
              <div className="flex items-center gap-2">
                {selectMode && selectedIds.size > 0 && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5 text-green-600 border-green-300 h-7 text-xs" onClick={() => handleBulkToggle(true)}>
                      <PlayCircle className="w-3 h-3" /> {t("automationsPage.bulkActivate", { count: selectedIds.size })}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-300 h-7 text-xs" onClick={() => handleBulkToggle(false)}>
                      <PauseCircle className="w-3 h-3" /> {t("automationsPage.bulkSuspend", { count: selectedIds.size })}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-300 h-7 text-xs" onClick={() => handleBulkDelete()}>
                      <Trash2 className="w-3 h-3" /> {t("automationsPage.bulkDelete", { count: selectedIds.size })}
                    </Button>
                  </>
                )}
                <Button size="sm" variant={selectMode ? "default" : "outline"} className="h-7 text-xs gap-1.5" onClick={toggleSelectMode}>
                  {selectMode ? <><X className="w-3 h-3" /> {t("automationsPage.cancel")}</> : <><CheckSquare className="w-3 h-3" /> {t("automationsPage.select")}</>}
                </Button>
              </div>
            )}
          </div>

          {customRules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Zap className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground font-medium">{t("automationsPage.emptyTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">{t("automationsPage.emptyDesc")}</p>
                <CreateRuleDialog onCreated={fetchData} />
              </CardContent>
            </Card>
          ) : (
            <>
              {selectMode && (
                <div className="flex items-center gap-2 pb-1">
                  <button onClick={() => toggleAll(customRules.map(r => r.id))} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                    {selectedIds.size === customRules.length && customRules.length > 0
                      ? <CheckSquare className="w-4 h-4 text-primary" />
                      : <Square className="w-4 h-4" />}
                    {selectedIds.size === customRules.length && customRules.length > 0 ? t("automationsPage.deselectAll") : t("automationsPage.selectAll")}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customRules.map(rule => (
                <Card key={rule.id} className={`hover:shadow-md transition-shadow ${selectMode && selectedIds.has(rule.id) ? "ring-2 ring-primary" : ""}`} onClick={selectMode ? () => toggleId(rule.id) : undefined} style={selectMode ? { cursor: "pointer" } : undefined}>
                  <CardContent className="pt-5 pb-4">
                    {selectMode && (
                      <div className="flex justify-end mb-2">
                        {selectedIds.has(rule.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    )}
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${rule.enabled ? (TRIGGER_COLORS[rule.trigger] || "bg-amber-500/10 text-amber-500") : "bg-gray-500/10 text-gray-500"}`}>
                        {(() => { const Icon = TRIGGER_ICONS[rule.trigger] || Zap; return <Icon className="w-5 h-5" />; })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-sm truncate">{rule.name}</h4>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${rule.enabled ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-gray-500/10 text-gray-500 border-gray-500/30"}`}>
                            {rule.enabled ? <><PlayCircle className="w-2.5 h-2.5 mr-0.5" /> {t("automationsPage.active")}</> : <><PauseCircle className="w-2.5 h-2.5 mr-0.5" /> {t("automationsPage.paused")}</>}
                          </Badge>
                        </div>
                        {rule.description && <p className="text-xs text-muted-foreground truncate">{rule.description}</p>}
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {rule.schedule || t("automationsPage.manual")}</span>
                          <span>{t("automationsPage.execCount", { count: rule.runCount })}</span>
                          {rule.lastRun && <span>{timeAgo(rule.lastRun)}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[10px]">
                            {TRIGGER_LABELS[rule.trigger] ? t(TRIGGER_LABELS[rule.trigger]) : rule.trigger}
                          </Badge>
                          {Array.isArray(rule.actions) && (
                            <span className="text-[10px] text-muted-foreground">{t("automationsPage.actionCount", { count: rule.actions.length })}</span>
                          )}
                          <button
                            onClick={() => cycleApproval(rule.id, rule.requiresApproval ?? null)}
                            title={t("automationsPage.approvalPolicyTitle")}
                          >
                            <Badge variant="outline" className={`text-[10px] cursor-pointer ${APPROVAL_META(rule.requiresApproval ?? null).cls}`}>
                              <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                              {t(APPROVAL_META(rule.requiresApproval ?? null).labelKey)}
                            </Badge>
                          </button>
                        </div>
                      </div>
                    </div>
                    {!selectMode && (
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t">
                        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => toggleRule(rule.id, rule.enabled)}>
                          {rule.enabled ? <PauseCircle className="w-3 h-3 mr-1" /> : <PlayCircle className="w-3 h-3 mr-1" />}
                          {rule.enabled ? t("automationsPage.suspend") : t("automationsPage.activate")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title={t("automationsPage.editTitle")} onClick={() => setEditingRule(rule)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title={t("automationsPage.duplicateTitle")} onClick={async () => {
                          const res = await fetch(`${baseUrl}/api/automations/${rule.id}/duplicate`, { method: "POST", credentials: "include" });
                          if (res.ok) { toast({ title: t("automationsPage.toast.duplicated") }); fetchData(); }
                        }}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => deleteRule(rule.id, rule.name)} aria-label={t("common.delete")}>
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="journal" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                {t("automationsPage.journalTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  {t("automationsPage.journalEmpty")}
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map(log => (
                    <div key={log.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors border-b last:border-b-0">
                      <div className={`p-1.5 rounded-lg ${log.status === "success" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                        {log.status === "success" ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{log.ruleName}</span>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${log.status === "success" ? "text-green-600" : "text-red-600"}`}>
                            {log.status === "success" ? t("automationsPage.logSuccess") : t("automationsPage.logError")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                          <span>{t("automationsPage.logItems", { count: log.itemsProcessed })}</span>
                          {log.duration !== null && <span>{log.duration}ms</span>}
                          <span>{timeAgo(log.createdAt)}</span>
                        </div>
                      </div>
                      {log.error && (
                        <span className="text-[10px] text-red-500 max-w-[200px] truncate">{log.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editingRule && (
        <EditRuleDialog rule={editingRule} onSaved={fetchData} onClose={() => setEditingRule(null)} />
      )}
    </div>
  );
}
