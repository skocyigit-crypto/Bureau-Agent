import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { GhostTextarea } from "@/components/ghost-textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle,DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
AlertTriangle,
BarChart3,
Calendar,
CheckCircle2,
CheckSquare,
ChevronLeft,
ChevronRight,
Clock,
Copy,
Download,
Euro,
Filter,
FolderKanban,
ListChecks,
Loader2,
PauseCircle,
Pencil,
PlayCircle,
Plus,
Printer,
RefreshCw,
Search,
Square,
Tag,
Trash2,
Users,
X,
XCircle
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function fmt(v: any) {
  if (!v || isNaN(Number(v))) return "—";
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v)) + " €";
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}
function isOverdue(endDate: string | null | undefined, status: string) {
  if (!endDate || status === "termine" || status === "annule") return false;
  return new Date(endDate) < new Date();
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  planifie:  { label: "Planifié",   color: "text-blue-600",   icon: Clock,         bg: "bg-blue-500/10 border-blue-500/30" },
  en_cours:  { label: "En cours",   color: "text-amber-600",  icon: PlayCircle,    bg: "bg-amber-500/10 border-amber-500/30" },
  en_pause:  { label: "En pause",   color: "text-gray-500",   icon: PauseCircle,   bg: "bg-gray-500/10 border-gray-500/30" },
  termine:   { label: "Terminé",    color: "text-emerald-600",icon: CheckCircle2,  bg: "bg-emerald-500/10 border-emerald-500/30" },
  annule:    { label: "Annulé",     color: "text-red-600",    icon: XCircle,       bg: "bg-red-500/10 border-red-500/30" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  haute:   { label: "Haute",   color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  moyenne: { label: "Moyenne", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  basse:   { label: "Basse",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
};

interface Milestone {
  id: string;
  title: string;
  dueDate?: string;
  completed: boolean;
}

interface Projet {
  id: number; title: string; description?: string; status: string; priority: string;
  clientName?: string; clientCompany?: string; address?: string;
  budget?: string; spent?: string; currency: string; progress: number;
  startDate?: string; endDate?: string; actualEndDate?: string;
  assignedTo?: string; teamMembers?: string[]; milestones?: Milestone[];
  tags?: string[]; notes?: string; contactId?: number;
  createdAt: string; updatedAt: string;
}

const EMPTY_FORM = {
  title: "", description: "", status: "planifie", priority: "moyenne",
  clientName: "", clientCompany: "", address: "", budget: "", currency: "EUR",
  progress: "0", startDate: "", endDate: "", assignedTo: "", notes: "",
};

const TAG_COLORS = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
];
function tagColor(tag: string) {
  let h = 0; for (const c of tag) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

function MilestonesPanel({ projet, onUpdated }: { projet: Projet; onUpdated: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState("");
  const milestones: Milestone[] = projet.milestones || [];

  async function patch(updated: Milestone[]) {
    setSaving(true);
    try {
      const autoProgress = updated.length > 0
        ? Math.round((updated.filter(m => m.completed).length / updated.length) * 100)
        : projet.progress;
      const res = await fetch(`${BASE}/api/projets/${projet.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestones: updated, progress: autoProgress }),
      });
      if (res.ok) onUpdated();
      else throw new Error();
    } catch {
      toast({ title: t("projets.milestones.updateError"), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function toggle(id: string) {
    await patch(milestones.map(m => m.id === id ? { ...m, completed: !m.completed } : m));
  }

  async function add() {
    if (!newTitle.trim()) return;
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await patch([...milestones, { id, title: newTitle.trim(), dueDate: newDate || undefined, completed: false }]);
    setNewTitle(""); setNewDate("");
  }

  async function remove(id: string) {
    await patch(milestones.filter(m => m.id !== id));
  }

  const completed = milestones.filter(m => m.completed).length;

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <ListChecks className="w-3 h-3" /> {t("projets.milestones.title")}
        </span>
        {milestones.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{t("projets.milestones.complete", { done: completed, total: milestones.length })}</span>
        )}
      </div>
      {milestones.map(m => {
        const overdue = m.dueDate && !m.completed && new Date(m.dueDate) < new Date();
        return (
          <div key={m.id} className="flex items-center gap-2 group text-xs">
            <button
              onClick={() => toggle(m.id)} disabled={saving}
              aria-pressed={m.completed}
              aria-label={m.title}
              className="shrink-0 w-6 h-6 -m-1 flex items-center justify-center"
            >
              <span
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                  m.completed ? "bg-emerald-500 border-emerald-500" : "border-gray-300 dark:border-gray-600 hover:border-emerald-400"
                }`}
              >
                {m.completed && <CheckCircle2 className="w-2.5 h-2.5 text-white" aria-hidden="true" />}
              </span>
            </button>
            <span className={`flex-1 truncate ${m.completed ? "line-through text-muted-foreground" : ""} ${overdue ? "text-red-500" : ""}`}>
              {m.title}
            </span>
            {m.dueDate && (
              <span className={`shrink-0 text-[10px] ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
                {fmtDate(m.dueDate)}
              </span>
            )}
            <button
              onClick={() => remove(m.id)} disabled={saving}
              className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity"
              aria-label={t("common.delete")}
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-1">
        <Input aria-label={t("projets.milestones.placeholder")}
          placeholder={t("projets.milestones.placeholder")} value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && add()}
          className="h-6 text-xs px-2 flex-1"
        />
        <Input
          aria-label={t("common.endDate")}
          type="date" value={newDate}
          onChange={e => setNewDate(e.target.value)}
          className="h-6 text-xs px-1.5 w-28"
        />
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={add} disabled={saving || !newTitle.trim()} aria-label={t("common.add")}>
          {saving ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Plus className="w-3 h-3" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function ProjetForm({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 py-1">
      <div>
        <Label>{t("projets.form.title")} <span className="text-red-500">*</span></Label>
        <Input aria-label={t("projets.form.title")} className="mt-1" value={form.title} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} placeholder={t("projets.form.titlePlaceholder")} />
      </div>
      <div>
        <Label>{t("projets.form.description")}</Label>
        <GhostTextarea
          className="mt-1 min-h-[70px]"
          value={form.description}
          onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))}
          placeholder={t("projets.form.descriptionPlaceholder")}
          fieldType="project_description"
          context={{ title: form.title || null, contactName: form.clientName || form.clientCompany || null }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("projets.form.status")}</Label>
          <Select value={form.status} onValueChange={v => setForm((f: any) => ({ ...f, status: v }))}>
            <SelectTrigger aria-label={t("projets.form.status")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.keys(STATUS_CONFIG).map(v => <SelectItem key={v} value={v}>{t(`projets.status.${v}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("projets.form.priority")}</Label>
          <Select value={form.priority} onValueChange={v => setForm((f: any) => ({ ...f, priority: v }))}>
            <SelectTrigger aria-label={t("projets.form.priority")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="haute">{t("projets.priority.haute")}</SelectItem>
              <SelectItem value="moyenne">{t("projets.priority.moyenne")}</SelectItem>
              <SelectItem value="basse">{t("projets.priority.basse")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("projets.form.client")}</Label>
          <Input aria-label={t("projets.form.client")} className="mt-1" value={form.clientName} onChange={e => setForm((f: any) => ({ ...f, clientName: e.target.value }))} placeholder={t("projets.form.clientPlaceholder")} />
        </div>
        <div>
          <Label>{t("projets.form.company")}</Label>
          <Input aria-label={t("projets.form.company")} className="mt-1" value={form.clientCompany} onChange={e => setForm((f: any) => ({ ...f, clientCompany: e.target.value }))} placeholder={t("projets.form.companyPlaceholder")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("projets.form.budget")}</Label>
          <Input aria-label={t("projets.form.budget")} type="number" className="mt-1" value={form.budget} onChange={e => setForm((f: any) => ({ ...f, budget: e.target.value }))} placeholder={t("projets.form.budgetPlaceholder")} min="0" />
        </div>
        <div>
          <Label>{t("projets.form.progress")}</Label>
          <Input aria-label={t("projets.form.progress")} type="number" className="mt-1" value={form.progress} onChange={e => setForm((f: any) => ({ ...f, progress: e.target.value }))} min="0" max="100" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("projets.form.startDate")}</Label>
          <Input aria-label={t("projets.form.startDate")} type="date" className="mt-1" value={form.startDate} onChange={e => setForm((f: any) => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div>
          <Label>{t("projets.form.endDate")}</Label>
          <Input aria-label={t("projets.form.endDate")} type="date" className="mt-1" value={form.endDate} onChange={e => setForm((f: any) => ({ ...f, endDate: e.target.value }))} />
        </div>
      </div>
      <div>
        <Label>{t("projets.form.assignedTo")}</Label>
        <Input aria-label={t("projets.form.assignedTo")} className="mt-1" value={form.assignedTo} onChange={e => setForm((f: any) => ({ ...f, assignedTo: e.target.value }))} placeholder={t("projets.form.assignedToPlaceholder")} />
      </div>
      <div>
        <Label>{t("projets.form.tags")} <span className="text-muted-foreground font-normal text-xs">{t("projets.form.tagsHint")}</span></Label>
        <Input aria-label={t("projets.form.tags")}
          className="mt-1"
          value={Array.isArray(form.tags) ? form.tags.join(", ") : (form.tags || "")}
          onChange={e => setForm((f: any) => ({ ...f, tags: e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean) }))}
          placeholder={t("projets.form.tagsPlaceholder")}
        />
        {Array.isArray(form.tags) && form.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {form.tags.map((t: string) => (
              <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tagColor(t)}`}>{t}</span>
            ))}
          </div>
        )}
      </div>
      <div>
        <Label>{t("projets.form.notes")}</Label>
        <GhostTextarea
          className="mt-1 min-h-[60px]"
          value={form.notes}
          onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
          placeholder={t("projets.form.notesPlaceholder")}
          fieldType="project_note"
          context={{ title: form.title || null, contactName: form.clientName || form.clientCompany || null }}
        />
      </div>
    </div>
  );
}

function CreateProjetDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);

  async function submit() {
    if (!form.title.trim()) { toast({ title: t("projets.toast.titleRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projets`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, progress: Number(form.progress) || 0, budget: form.budget || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || t("projets.toast.serverError"));
      toast({ title: t("projets.toast.created") });
      setOpen(false); setForm(EMPTY_FORM); onCreated();
    } catch (err: any) {
      toast({ title: t("projets.toast.error"), description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> {t("projets.newProject")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FolderKanban className="w-5 h-5 text-primary" /> {t("projets.createDialog.title")}</DialogTitle>
        </DialogHeader>
        <ProjetForm form={form} setForm={setForm} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("projets.createDialog.cancel")}</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {t("projets.createDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProjetDialog({ projet, onSaved, onClose }: { projet: Projet; onSaved: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    title: projet.title || "",
    description: projet.description || "",
    status: projet.status || "planifie",
    priority: projet.priority || "moyenne",
    clientName: projet.clientName || "",
    clientCompany: projet.clientCompany || "",
    address: projet.address || "",
    budget: projet.budget || "",
    currency: projet.currency || "EUR",
    progress: String(projet.progress ?? 0),
    startDate: projet.startDate ? projet.startDate.slice(0, 10) : "",
    endDate: projet.endDate ? projet.endDate.slice(0, 10) : "",
    assignedTo: projet.assignedTo || "",
    tags: projet.tags || [],
    notes: projet.notes || "",
  });

  async function submit() {
    if (!form.title.trim()) { toast({ title: t("projets.toast.titleRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projets/${projet.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, progress: Number(form.progress) || 0, budget: form.budget || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || t("projets.toast.serverError"));
      toast({ title: t("projets.toast.updated") });
      onSaved(); onClose();
    } catch (err: any) {
      toast({ title: t("projets.toast.error"), description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-5 h-5 text-primary" /> {t("projets.editDialog.title")}</DialogTitle>
        </DialogHeader>
        <ProjetForm form={form} setForm={setForm} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("projets.editDialog.cancel")}</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} {t("projets.editDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjetCard({ projet, onEdit, onDelete, onDuplicate, onUpdated, selectMode, selected, onSelect }: {
  projet: Projet; onEdit: () => void; onDelete: () => void; onDuplicate: () => void; onUpdated: () => void;
  selectMode: boolean; selected: boolean; onSelect: () => void;
}) {
  const { t } = useTranslation();
  const [showMilestones, setShowMilestones] = useState(false);
  const statusKey = STATUS_CONFIG[projet.status] ? projet.status : "planifie";
  const priorityKey = PRIORITY_CONFIG[projet.priority] ? projet.priority : "moyenne";
  const sc = STATUS_CONFIG[statusKey];
  const pc = PRIORITY_CONFIG[priorityKey];
  const StatusIcon = sc.icon;
  const overdue = isOverdue(projet.endDate, projet.status);
  const budgetPct = projet.budget && Number(projet.budget) > 0
    ? Math.min(100, Math.round((Number(projet.spent || 0) / Number(projet.budget)) * 100))
    : null;
  const milestoneCount = projet.milestones?.length ?? 0;
  const completedMilestones = projet.milestones?.filter(m => m.completed).length ?? 0;

  return (
    <Card
      className={`hover:shadow-md transition-shadow cursor-pointer ${selectMode && selected ? "ring-2 ring-primary" : ""}`}
      onClick={selectMode ? onSelect : undefined}
    >
      <CardContent className="pt-4 pb-4 space-y-3">
        {selectMode && (
          <div className="flex justify-end">
            {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
          </div>
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-[10px] font-medium ${sc.color} border ${sc.bg}`}>
                <StatusIcon className="w-2.5 h-2.5 mr-0.5" />{t(`projets.status.${statusKey}`)}
              </Badge>
              <Badge className={`text-[10px] ${pc.color}`}>{t(`projets.priority.${priorityKey}`)}</Badge>
              {overdue && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300 bg-red-50 dark:bg-red-900/20"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />{t("projets.card.overdue")}</Badge>}
            </div>
            <h3 className="font-semibold text-sm mt-1.5 leading-tight">{projet.title}</h3>
            {(projet.clientName || projet.clientCompany) && (
              <p className="text-xs text-muted-foreground mt-0.5">{[projet.clientName, projet.clientCompany].filter(Boolean).join(" · ")}</p>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{t("projets.card.progress")}</span><span className="font-semibold text-foreground">{projet.progress}%</span>
          </div>
          <Progress value={projet.progress} className="h-1.5" />
        </div>

        {projet.budget && Number(projet.budget) > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Euro className="w-3 h-3" /> {t("projets.card.budget")}</span>
            <span className={`font-medium ${budgetPct !== null && budgetPct > 100 ? "text-red-600" : ""}`}>
              {fmt(projet.spent || 0)} / {fmt(projet.budget)}
              {budgetPct !== null && <span className="ml-1 text-muted-foreground">({budgetPct}%)</span>}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {projet.endDate ? (
            <span className={`flex items-center gap-1 ${overdue ? "text-red-500" : ""}`}>
              <Calendar className="w-3 h-3" /> {t("projets.card.endDate", { date: fmtDate(projet.endDate) })}
            </span>
          ) : <span />}
          {projet.assignedTo && (
            <span className="flex items-center gap-1 truncate max-w-[120px]">
              <Users className="w-3 h-3 shrink-0" />{projet.assignedTo}
            </span>
          )}
        </div>

        {projet.tags && projet.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {projet.tags.slice(0, 4).map(t => (
              <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tagColor(t)}`}>
                <Tag className="w-2 h-2 inline mr-0.5" />{t}
              </span>
            ))}
            {projet.tags.length > 4 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">+{projet.tags.length - 4}</span>
            )}
          </div>
        )}

        {!selectMode && (
          <div className="flex items-center gap-1.5 pt-2 border-t">
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onEdit}>
              <Pencil className="w-3 h-3 mr-1" /> {t("projets.card.edit")}
            </Button>
            <Button
              size="sm" variant="ghost"
              className={`h-7 px-2 text-xs gap-1 ${showMilestones ? "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30" : "text-muted-foreground hover:text-foreground"}`}
              title={t("projets.card.milestonesTitle")}
              onClick={() => setShowMilestones(v => !v)}
            >
              <ListChecks className="w-3.5 h-3.5" />
              {milestoneCount > 0 ? `${completedMilestones}/${milestoneCount}` : ""}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title={t("projets.card.duplicateTitle")} onClick={onDuplicate}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onDelete} aria-label={t("common.delete")}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}

        {showMilestones && !selectMode && (
          <MilestonesPanel projet={projet} onUpdated={onUpdated} />
        )}
      </CardContent>
    </Card>
  );
}

export default function ProjetsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [projets, setProjets] = useState<Projet[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 24;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [view, setView] = useState<"grid" | "kanban">("grid");

  const [editingProjet, setEditingProjet] = useState<Projet | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);

      const [listRes, statsRes] = await Promise.all([
        fetch(`${BASE}/api/projets?${params}`, { credentials: "include" }),
        fetch(`${BASE}/api/projets/stats`, { credentials: "include" }),
      ]);
      if (listRes.ok) {
        const d = await listRes.json();
        setProjets(d.projets || []);
        setTotal(d.total || 0);
      }
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      toast({ title: t("projets.toast.error"), description: t("projets.toast.loadError"), variant: "destructive" });
    } finally { setLoading(false); }
  }, [search, statusFilter, priorityFilter, page]);

  useEffect(() => { setPage(0); }, [search, statusFilter, priorityFilter]);
  useEffect(() => { load(); }, [load]);

  const toggleSelectMode = () => { setSelectMode(v => !v); setSelectedIds(new Set()); };
  const toggleId = (id: number) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selectedIds.size === projets.length && projets.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(projets.map(p => p.id)));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("projets.confirm.bulkDelete", { count: selectedIds.size }), confirmLabel: t("common.delete"), destructive: true }))) return;
    const res = await fetch(`${BASE}/api/bulk/projets/delete`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    if (res.ok) {
      const data = await res.json();
      toast({ title: t("projets.toast.bulkDeleted", { count: data.deleted ?? selectedIds.size }) });
    } else {
      toast({ title: t("projets.toast.error"), description: t("projets.toast.bulkDeleteError"), variant: "destructive" });
    }
    setSelectedIds(new Set()); setSelectMode(false); load();
  };

  const handleBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    const res = await fetch(`${BASE}/api/bulk/projets/status`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], status }),
    });
    if (res.ok) {
      const data = await res.json();
      toast({ title: t("projets.toast.bulkStatus", { count: data.updated ?? selectedIds.size }) });
    } else {
      toast({ title: t("projets.toast.error"), description: t("projets.toast.bulkStatusError"), variant: "destructive" });
    }
    setSelectedIds(new Set()); setSelectMode(false); load();
  };

  const deleteProjet = async (id: number, title: string) => {
    if (!(await confirmAction({ title: t("projets.confirm.deleteOne", { title }), confirmLabel: t("common.delete"), destructive: true }))) return;
    const res = await fetch(`${BASE}/api/projets/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("projets.toast.deleted") }); load(); }
    else toast({ title: t("projets.toast.error"), description: t("projets.toast.deleteError"), variant: "destructive" });
  };

  const duplicateProjet = async (id: number) => {
    const res = await fetch(`${BASE}/api/projets/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: t("projets.toast.duplicated") }); load(); }
    else toast({ title: t("projets.toast.error"), description: t("projets.toast.duplicateError"), variant: "destructive" });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const kanbanGroups = ["planifie", "en_cours", "en_pause", "termine", "annule"].map(s => ({
    status: s,
    projets: projets.filter(p => p.status === s),
    ...STATUS_CONFIG[s],
  }));

  return (
    <div className="p-4 md:p-6 space-y-5">
      {editingProjet && (
        <EditProjetDialog projet={editingProjet} onSaved={load} onClose={() => setEditingProjet(null)} />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-primary" /> {t("projets.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? t("projets.loading") : t("projets.totalCount", { total })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectMode && selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-300 h-8 text-xs" onClick={() => handleBulkStatus("en_cours")}>
                <PlayCircle className="w-3 h-3" /> {t("projets.bulk.start", { count: selectedIds.size })}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-emerald-600 border-emerald-300 h-8 text-xs" onClick={() => handleBulkStatus("termine")}>
                <CheckCircle2 className="w-3 h-3" /> {t("projets.bulk.complete", { count: selectedIds.size })}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-300 h-8 text-xs" onClick={handleBulkDelete}>
                <Trash2 className="w-3 h-3" /> {t("projets.bulk.delete", { count: selectedIds.size })}
              </Button>
            </>
          )}
          {projets.length > 0 && (
            <Button size="sm" variant={selectMode ? "default" : "outline"} className="gap-1.5 h-8 text-xs" onClick={toggleSelectMode}>
              {selectMode ? <><X className="w-3 h-3" /> {t("projets.cancel")}</> : <><CheckSquare className="w-3 h-3" /> {t("projets.selectMode")}</>}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8" aria-label={t("common.refresh")}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => { window.open(`${BASE}/api/export/projets`, "_blank", "noopener,noreferrer"); }} title={t("projets.exportCsv")}><Download className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => window.print()} aria-label={t("common.print")}><Printer className="w-4 h-4" aria-hidden="true" /></Button>
          <CreateProjetDialog onCreated={load} />
        </div>
      </div>

      <AiSuggestionsCard page="projets" compact />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-500/10"><PlayCircle className="w-4 h-4 text-amber-500" /></div>
                <div>
                  <p className="text-xl font-bold">{stats.active ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{t("projets.stats.active")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10"><BarChart3 className="w-4 h-4 text-blue-500" /></div>
                <div>
                  <p className="text-xl font-bold">{stats.avgProgress ?? 0}%</p>
                  <p className="text-xs text-muted-foreground">{t("projets.stats.avgProgress")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10"><Euro className="w-4 h-4 text-emerald-500" /></div>
                <div>
                  <p className="text-xl font-bold text-sm leading-tight">{fmt(stats.totalBudget)}</p>
                  <p className="text-xs text-muted-foreground">{t("projets.stats.totalBudget")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={stats.overdue > 0 ? "border-red-200 dark:border-red-900/30" : ""}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${stats.overdue > 0 ? "bg-red-500/10" : "bg-gray-500/10"}`}>
                  <AlertTriangle className={`w-4 h-4 ${stats.overdue > 0 ? "text-red-500" : "text-gray-400"}`} />
                </div>
                <div>
                  <p className={`text-xl font-bold ${stats.overdue > 0 ? "text-red-600" : ""}`}>{stats.overdue ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{t("projets.stats.overdue")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label={t("projets.searchPlaceholder")} placeholder={t("projets.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label={t("common.filterStatus")}>
            <Filter className="w-3 h-3 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("projets.filters.allStatuses")}</SelectItem>
            {Object.keys(STATUS_CONFIG).map(v => <SelectItem key={v} value={v}>{t(`projets.status.${v}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36" aria-label={t("common.filterPriority")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("projets.filters.allPriorities")}</SelectItem>
            <SelectItem value="haute">{t("projets.priority.haute")}</SelectItem>
            <SelectItem value="moyenne">{t("projets.priority.moyenne")}</SelectItem>
            <SelectItem value="basse">{t("projets.priority.basse")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1 border rounded-lg p-1">
          <Button variant={view === "grid" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setView("grid")} aria-label={t("common.viewGrid")}>
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
          <Button variant={view === "kanban" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setView("kanban")} aria-label={t("common.viewColumns")}>
            <FolderKanban className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : projets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FolderKanban className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-muted-foreground">{t("projets.empty.title")}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{t("projets.empty.description")}</p>
            <CreateProjetDialog onCreated={load} />
          </CardContent>
        </Card>
      ) : view === "kanban" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {kanbanGroups.filter(g => g.projets.length > 0 || g.status === "planifie" || g.status === "en_cours").map(group => {
            const Icon = group.icon;
            return (
              <div key={group.status} className="min-w-[280px] w-72 shrink-0">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg border border-b-0 ${group.bg}`}>
                  <Icon className={`w-4 h-4 ${group.color}`} />
                  <span className={`text-sm font-semibold ${group.color}`}>{t(`projets.status.${group.status}`)}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{group.projets.length}</Badge>
                </div>
                <div className="border border-t-0 rounded-b-lg p-2 space-y-2 min-h-[100px] bg-muted/20">
                  {group.projets.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">{t("projets.empty.kanbanColumn")}</p>
                  )}
                  {group.projets.map(p => (
                    <ProjetCard
                      key={p.id} projet={p}
                      onEdit={() => setEditingProjet(p)}
                      onDelete={() => deleteProjet(p.id, p.title)}
                      onDuplicate={() => duplicateProjet(p.id)}
                      onUpdated={load}
                      selectMode={selectMode} selected={selectedIds.has(p.id)} onSelect={() => toggleId(p.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {selectMode && (
            <div className="flex items-center gap-2">
              <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                {selectedIds.size === projets.length && projets.length > 0
                  ? <CheckSquare className="w-4 h-4 text-primary" />
                  : <Square className="w-4 h-4" />}
                {selectedIds.size === projets.length && projets.length > 0 ? t("projets.bulk.deselectAll") : t("projets.bulk.selectAll")}
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {projets.map(p => (
              <ProjetCard
                key={p.id} projet={p}
                onEdit={() => setEditingProjet(p)}
                onDelete={() => deleteProjet(p.id, p.title)}
                onDuplicate={() => duplicateProjet(p.id)}
                onUpdated={load}
                selectMode={selectMode} selected={selectedIds.has(p.id)} onSelect={() => toggleId(p.id)}
              />
            ))}
          </div>
        </>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{t("projets.totalCount", { total })}</p>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label={t("common.previousPage")}>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </Button>
            <span className="flex items-center px-3 text-sm">{page + 1}/{totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label={t("common.nextPage")}>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
