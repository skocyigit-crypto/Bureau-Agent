import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  FolderKanban, Plus, Search, RefreshCw, Trash2, Pencil, Filter,
  CheckCircle2, Clock, PauseCircle, XCircle, PlayCircle, ChevronLeft,
  ChevronRight, Calendar, Euro, Users, Target, AlertTriangle, TrendingUp,
  BarChart3, Loader2, Download, Printer, X, ChevronDown, ChevronUp,
  CheckSquare, Square, Copy,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

interface Projet {
  id: number; title: string; description?: string; status: string; priority: string;
  clientName?: string; clientCompany?: string; address?: string;
  budget?: string; spent?: string; currency: string; progress: number;
  startDate?: string; endDate?: string; actualEndDate?: string;
  assignedTo?: string; teamMembers?: string[]; milestones?: any[];
  tags?: string[]; notes?: string; contactId?: number;
  createdAt: string; updatedAt: string;
}

const EMPTY_FORM = {
  title: "", description: "", status: "planifie", priority: "moyenne",
  clientName: "", clientCompany: "", address: "", budget: "", currency: "EUR",
  progress: "0", startDate: "", endDate: "", assignedTo: "", notes: "",
};

function ProjetForm({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  return (
    <div className="space-y-4 py-1">
      <div>
        <Label>Titre du projet <span className="text-red-500">*</span></Label>
        <Input className="mt-1" value={form.title} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} placeholder="Ex: Refonte site vitrine" />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea className="mt-1 min-h-[70px]" value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} placeholder="Description du projet..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Statut</Label>
          <Select value={form.status} onValueChange={v => setForm((f: any) => ({ ...f, status: v }))}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_CONFIG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priorité</Label>
          <Select value={form.priority} onValueChange={v => setForm((f: any) => ({ ...f, priority: v }))}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="haute">Haute</SelectItem>
              <SelectItem value="moyenne">Moyenne</SelectItem>
              <SelectItem value="basse">Basse</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Client / Contact</Label>
          <Input className="mt-1" value={form.clientName} onChange={e => setForm((f: any) => ({ ...f, clientName: e.target.value }))} placeholder="Nom du client" />
        </div>
        <div>
          <Label>Entreprise</Label>
          <Input className="mt-1" value={form.clientCompany} onChange={e => setForm((f: any) => ({ ...f, clientCompany: e.target.value }))} placeholder="Entreprise" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Budget (€)</Label>
          <Input type="number" className="mt-1" value={form.budget} onChange={e => setForm((f: any) => ({ ...f, budget: e.target.value }))} placeholder="0" min="0" />
        </div>
        <div>
          <Label>Avancement (%)</Label>
          <Input type="number" className="mt-1" value={form.progress} onChange={e => setForm((f: any) => ({ ...f, progress: e.target.value }))} min="0" max="100" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Date début</Label>
          <Input type="date" className="mt-1" value={form.startDate} onChange={e => setForm((f: any) => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div>
          <Label>Date fin prévue</Label>
          <Input type="date" className="mt-1" value={form.endDate} onChange={e => setForm((f: any) => ({ ...f, endDate: e.target.value }))} />
        </div>
      </div>
      <div>
        <Label>Responsable</Label>
        <Input className="mt-1" value={form.assignedTo} onChange={e => setForm((f: any) => ({ ...f, assignedTo: e.target.value }))} placeholder="Nom du responsable" />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea className="mt-1 min-h-[60px]" value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Notes internes..." />
      </div>
    </div>
  );
}

function CreateProjetDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_FORM);

  async function submit() {
    if (!form.title.trim()) { toast({ title: "Titre obligatoire", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projets`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, progress: Number(form.progress) || 0, budget: form.budget || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erreur serveur");
      toast({ title: "Projet créé" });
      setOpen(false); setForm(EMPTY_FORM); onCreated();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" /> Nouveau projet</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FolderKanban className="w-5 h-5 text-primary" /> Créer un projet</DialogTitle>
        </DialogHeader>
        <ProjetForm form={form} setForm={setForm} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProjetDialog({ projet, onSaved, onClose }: { projet: Projet; onSaved: () => void; onClose: () => void }) {
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
    notes: projet.notes || "",
  });

  async function submit() {
    if (!form.title.trim()) { toast({ title: "Titre obligatoire", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/projets/${projet.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, progress: Number(form.progress) || 0, budget: form.budget || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erreur serveur");
      toast({ title: "Projet mis à jour" });
      onSaved(); onClose();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-5 h-5 text-primary" /> Modifier le projet</DialogTitle>
        </DialogHeader>
        <ProjetForm form={form} setForm={setForm} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjetCard({ projet, onEdit, onDelete, onDuplicate, selectMode, selected, onSelect }: {
  projet: Projet; onEdit: () => void; onDelete: () => void; onDuplicate: () => void;
  selectMode: boolean; selected: boolean; onSelect: () => void;
}) {
  const sc = STATUS_CONFIG[projet.status] || STATUS_CONFIG.planifie;
  const pc = PRIORITY_CONFIG[projet.priority] || PRIORITY_CONFIG.moyenne;
  const StatusIcon = sc.icon;
  const overdue = isOverdue(projet.endDate, projet.status);
  const budgetPct = projet.budget && Number(projet.budget) > 0
    ? Math.min(100, Math.round((Number(projet.spent || 0) / Number(projet.budget)) * 100))
    : null;

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
                <StatusIcon className="w-2.5 h-2.5 mr-0.5" />{sc.label}
              </Badge>
              <Badge className={`text-[10px] ${pc.color}`}>{pc.label}</Badge>
              {overdue && <Badge variant="outline" className="text-[10px] text-red-600 border-red-300 bg-red-50 dark:bg-red-900/20"><AlertTriangle className="w-2.5 h-2.5 mr-0.5" />En retard</Badge>}
            </div>
            <h3 className="font-semibold text-sm mt-1.5 leading-tight">{projet.title}</h3>
            {(projet.clientName || projet.clientCompany) && (
              <p className="text-xs text-muted-foreground mt-0.5">{[projet.clientName, projet.clientCompany].filter(Boolean).join(" · ")}</p>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Avancement</span><span className="font-semibold text-foreground">{projet.progress}%</span>
          </div>
          <Progress value={projet.progress} className="h-1.5" />
        </div>

        {projet.budget && Number(projet.budget) > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1"><Euro className="w-3 h-3" /> Budget</span>
            <span className={`font-medium ${budgetPct !== null && budgetPct > 100 ? "text-red-600" : ""}`}>
              {fmt(projet.spent || 0)} / {fmt(projet.budget)}
              {budgetPct !== null && <span className="ml-1 text-muted-foreground">({budgetPct}%)</span>}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {projet.endDate ? (
            <span className={`flex items-center gap-1 ${overdue ? "text-red-500" : ""}`}>
              <Calendar className="w-3 h-3" /> Fin: {fmtDate(projet.endDate)}
            </span>
          ) : <span />}
          {projet.assignedTo && (
            <span className="flex items-center gap-1 truncate max-w-[120px]">
              <Users className="w-3 h-3 shrink-0" />{projet.assignedTo}
            </span>
          )}
        </div>

        {!selectMode && (
          <div className="flex items-center gap-1.5 pt-2 border-t">
            <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={onEdit}>
              <Pencil className="w-3 h-3 mr-1" /> Modifier
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Dupliquer" onClick={onDuplicate}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProjetsPage() {
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
      toast({ title: "Erreur", description: "Impossible de charger les projets.", variant: "destructive" });
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
    if (!confirm(`Supprimer ${selectedIds.size} projet(s) définitivement ?`)) return;
    const res = await fetch(`${BASE}/api/bulk/projets/delete`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    if (res.ok) {
      const data = await res.json();
      toast({ title: `${data.deleted ?? selectedIds.size} projet(s) supprimé(s)` });
    } else {
      toast({ title: "Erreur", description: "Suppression échouée.", variant: "destructive" });
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
      toast({ title: `${data.updated ?? selectedIds.size} projet(s) mis à jour` });
    } else {
      toast({ title: "Erreur", description: "Mise à jour échouée.", variant: "destructive" });
    }
    setSelectedIds(new Set()); setSelectMode(false); load();
  };

  const deleteProjet = async (id: number, title: string) => {
    if (!confirm(`Supprimer le projet "${title}" ?`)) return;
    const res = await fetch(`${BASE}/api/projets/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Projet supprimé" }); load(); }
    else toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
  };

  const duplicateProjet = async (id: number) => {
    const res = await fetch(`${BASE}/api/projets/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Projet dupliqué" }); load(); }
    else toast({ title: "Erreur", description: "Impossible de dupliquer.", variant: "destructive" });
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
            <FolderKanban className="w-6 h-6 text-primary" /> Projets
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "Chargement..." : `${total} projet${total !== 1 ? "s" : ""} au total`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectMode && selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-amber-600 border-amber-300 h-8 text-xs" onClick={() => handleBulkStatus("en_cours")}>
                <PlayCircle className="w-3 h-3" /> Démarrer ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-emerald-600 border-emerald-300 h-8 text-xs" onClick={() => handleBulkStatus("termine")}>
                <CheckCircle2 className="w-3 h-3" /> Terminer ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-300 h-8 text-xs" onClick={handleBulkDelete}>
                <Trash2 className="w-3 h-3" /> Supprimer ({selectedIds.size})
              </Button>
            </>
          )}
          {projets.length > 0 && (
            <Button size="sm" variant={selectMode ? "default" : "outline"} className="gap-1.5 h-8 text-xs" onClick={toggleSelectMode}>
              {selectMode ? <><X className="w-3 h-3" /> Annuler</> : <><CheckSquare className="w-3 h-3" /> Sélectionner</>}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => { window.open(`${BASE}/api/export/projets`, "_blank"); }} title="Exporter CSV"><Download className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <CreateProjetDialog onCreated={load} />
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-500/10"><PlayCircle className="w-4 h-4 text-amber-500" /></div>
                <div>
                  <p className="text-xl font-bold">{stats.active ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Projets actifs</p>
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
                  <p className="text-xs text-muted-foreground">Avancement moyen</p>
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
                  <p className="text-xs text-muted-foreground">Budget total</p>
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
                  <p className="text-xs text-muted-foreground">En retard</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher un projet..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <Filter className="w-3 h-3 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([v, c]) => <SelectItem key={v} value={v}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes priorités</SelectItem>
            <SelectItem value="haute">Haute</SelectItem>
            <SelectItem value="moyenne">Moyenne</SelectItem>
            <SelectItem value="basse">Basse</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1 border rounded-lg p-1">
          <Button variant={view === "grid" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setView("grid")}>
            <BarChart3 className="w-3.5 h-3.5" />
          </Button>
          <Button variant={view === "kanban" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setView("kanban")}>
            <FolderKanban className="w-3.5 h-3.5" />
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
            <p className="font-medium text-muted-foreground">Aucun projet trouvé</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Créez votre premier projet pour commencer le suivi.</p>
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
                  <span className={`text-sm font-semibold ${group.color}`}>{group.label}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">{group.projets.length}</Badge>
                </div>
                <div className="border border-t-0 rounded-b-lg p-2 space-y-2 min-h-[100px] bg-muted/20">
                  {group.projets.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Aucun projet</p>
                  )}
                  {group.projets.map(p => (
                    <ProjetCard
                      key={p.id} projet={p}
                      onEdit={() => setEditingProjet(p)}
                      onDelete={() => deleteProjet(p.id, p.title)}
                      onDuplicate={() => duplicateProjet(p.id)}
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
                {selectedIds.size === projets.length && projets.length > 0 ? "Tout désélectionner" : "Tout sélectionner"}
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
                selectMode={selectMode} selected={selectedIds.has(p.id)} onSelect={() => toggleId(p.id)}
              />
            ))}
          </div>
        </>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} projet{total !== 1 ? "s" : ""} au total</p>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="flex items-center px-3 text-sm">{page + 1}/{totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
