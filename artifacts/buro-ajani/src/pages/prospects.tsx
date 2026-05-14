import { useState, useEffect, useCallback } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useLocation } from "wouter";
import { AccessDenied } from "@/components/access-denied";
import { TrendingUp, Search, Plus, MoreHorizontal, Loader2, Trash2, Edit, ChevronLeft, ChevronRight, Filter, Target, Trophy, XCircle, DollarSign, RefreshCw, Kanban, LayoutList, ArrowUpDown, Download, UserPlus, Printer, Layers, Copy, FolderKanban, Briefcase } from "lucide-react";
import { EmptyOnboardingHint } from "@/components/empty-onboarding-hint";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GhostTextarea } from "@/components/ghost-textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STAGES = [
  { key: "nouveau", label: "Nouveau", color: "bg-slate-100 text-slate-600" },
  { key: "contact", label: "Contact", color: "bg-blue-100 text-blue-700" },
  { key: "qualification", label: "Qualification", color: "bg-purple-100 text-purple-700" },
  { key: "proposition", label: "Proposition", color: "bg-amber-100 text-amber-700" },
  { key: "negociation", label: "Négociation", color: "bg-orange-100 text-orange-700" },
  { key: "gagne", label: "Gagné", color: "bg-emerald-100 text-emerald-700" },
  { key: "perdu", label: "Perdu", color: "bg-red-100 text-red-700" },
] as const;

const PRIORITIES = [
  { key: "haute", label: "Haute", color: "bg-red-100 text-red-700" },
  { key: "moyenne", label: "Moyenne", color: "bg-amber-100 text-amber-700" },
  { key: "basse", label: "Basse", color: "bg-slate-100 text-slate-600" },
];

function StageBadge({ stage }: { stage: string }) {
  const s = STAGES.find(x => x.key === stage) || STAGES[0];
  return <Badge className={`${s.color} border-0 text-xs`}>{s.label}</Badge>;
}
function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITIES.find(x => x.key === priority) || PRIORITIES[1];
  return <Badge className={`${p.color} border-0 text-xs`}>{p.label}</Badge>;
}

function fmtEur(v: any) {
  if (!v) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(v));
}

interface Prospect {
  id: number; title: string; contactName?: string; company?: string; email?: string; phone?: string;
  stage: string; priority: string; value?: string; currency: string; probability: number;
  source?: string; assignedTo?: string; expectedCloseDate?: string; notes?: string; createdAt: string;
}

const EMPTY_FORM = { title: "", contactName: "", company: "", email: "", phone: "", stage: "nouveau", priority: "moyenne", value: "", currency: "EUR", probability: "50", source: "", assignedTo: "", expectedCloseDate: "", notes: "" };

export default function ProspectsPage() {
  // Module deplacé dans le backoffice SaaS — accessible super-admin uniquement.
  // Refactor "Admin Backoffice + Müşteri Sadeleştirme" — Tâche #52.
  // Verrou serveur: requireSuperAdmin sur le router (artifacts/api-server/
  // src/routes/index.ts). Vue 403 affichee si l'utilisateur tape l'URL.
  const { user: workspaceUser } = useWorkspaceUser();
  if (workspaceUser.role !== "super_admin") return <AccessDenied />;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"table" | "kanban">("kanban");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sortBy: "createdAt", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (stageFilter !== "all") params.set("stage", stageFilter);
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}/api/prospects?${params}`, { credentials: "include" }),
        fetch(`${BASE}/api/prospects/stats`, { credentials: "include" }),
      ]);
      if (r1.ok) { const d = await r1.json(); setProspects(d.prospects || []); setTotal(d.total || 0); }
      if (r2.ok) { setStats(await r2.json()); }
    } catch { toast({ title: "Erreur", description: "Chargement echoue.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, stageFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, stageFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pId = params.get("id");
    if (!pId || isNaN(parseInt(pId))) return;
    const id = parseInt(pId);
    setLocation(`/prospects/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = (p: Prospect) => {
    setEditingId(p.id);
    setForm({
      title: p.title, contactName: p.contactName || "", company: p.company || "", email: p.email || "",
      phone: p.phone || "", stage: p.stage, priority: p.priority, value: p.value || "",
      currency: p.currency || "EUR", probability: String(p.probability || 50),
      source: p.source || "", assignedTo: p.assignedTo || "",
      expectedCloseDate: p.expectedCloseDate ? p.expectedCloseDate.substring(0, 10) : "",
      notes: p.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/prospects/${editingId}` : `${BASE}/api/prospects`;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...form, probability: Number(form.probability), value: form.value || null }) });
      if (res.ok) {
        toast({ title: editingId ? "Prospect mis à jour" : "Prospect cree" });
        setDialogOpen(false); load();
      } else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", description: "Sauvegarde echouee.", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDuplicate = async (id: number) => {
    const res = await fetch(`${BASE}/api/prospects/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Prospect dupliqué" }); load(); }
    else toast({ title: "Erreur", description: "Impossible de dupliquer", variant: "destructive" });
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmAction({ title: "Supprimer ce prospect ?", confirmLabel: "Supprimer", destructive: true }))) return;
    const res = await fetch(`${BASE}/api/prospects/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Prospect supprime" }); load(); }
    else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
  };

  const handleConvert = async (id: number) => {
    if (!(await confirmAction({ title: "Convertir en contact ?", description: "Le statut du prospect passera à « Gagné ».", confirmLabel: "Convertir" }))) return;
    const res = await fetch(`${BASE}/api/prospects/${id}/convert`, { method: "POST", credentials: "include" });
    const d = await res.json();
    if (res.ok) { toast({ title: "Converti !", description: d.message }); load(); }
    else toast({ title: "Erreur", description: d.error, variant: "destructive" });
  };

  const handleCreateProjet = async (p: Prospect) => {
    try {
      const res = await fetch(`${BASE}/api/projets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: p.title,
          clientName: p.contactName || "",
          clientCompany: p.company || "",
          status: "planifie",
          priority: p.priority,
          budget: p.value || undefined,
          currency: p.currency || "EUR",
          progress: 0,
          notes: p.notes || "",
        }),
      });
      if (res.ok) {
        toast({ title: "Projet créé", description: `Le projet "${p.title}" a été créé.` });
        setLocation("/projets");
      } else {
        const d = await res.json();
        toast({ title: "Erreur", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de créer le projet.", variant: "destructive" });
    }
  };

  const handleStageChange = async (id: number, stage: string) => {
    const res = await fetch(`${BASE}/api/prospects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ stage }) });
    if (res.ok) { load(); toast({ title: "Etape mise a jour" }); }
  };

  const toggleSelect = (id: number) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => setSelectedIds(selectedIds.length === prospects.length ? [] : prospects.map(p => p.id));
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!(await confirmAction({ title: `Supprimer ${selectedIds.length} prospect(s) ?`, confirmLabel: "Supprimer", destructive: true }))) return;
    const res = await fetch(`${BASE}/api/bulk/prospects/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: `${selectedIds.length} prospect(s) supprimé(s)` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkStage = async (stage: string) => {
    if (selectedIds.length === 0) return;
    const res = await fetch(`${BASE}/api/bulk/prospects/stage`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, stage }) });
    if (res.ok) { toast({ title: `${selectedIds.length} prospect(s) → ${stage}` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkPriority = async (priority: string) => {
    if (selectedIds.length === 0) return;
    const res = await fetch(`${BASE}/api/bulk/prospects/priority`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, priority }) });
    if (res.ok) { toast({ title: `${selectedIds.length} prospect(s) mis à jour` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const [showAssignInput, setShowAssignInput] = useState(false);
  const [bulkAssignName, setBulkAssignName] = useState("");

  const handleBulkAssign = async () => {
    if (!bulkAssignName.trim() || selectedIds.length === 0) return;
    const res = await fetch(`${BASE}/api/bulk/prospects/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, assignedTo: bulkAssignName.trim() }) });
    if (res.ok) { toast({ title: `${selectedIds.length} prospect(s) assigné(s) à ${bulkAssignName.trim()}` }); setSelectedIds([]); setBulkAssignName(""); setShowAssignInput(false); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={TrendingUp} variant="amber" size="md" /> Prospects & Pipeline CRM
          </h1>
          <p className="text-muted-foreground">Gestion du pipeline commercial et suivi des opportunités.</p>
        </div>
        <div className="flex gap-2">
          <a href={`${BASE}/api/prospects/export/csv`} download><Button variant="outline" size="sm" className="gap-2"><Download className="w-4 h-4" />CSV</Button></a>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nouveau prospect</Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{stats.total ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Valeur pipeline</p>
            <p className="text-2xl font-bold text-emerald-600">{fmtEur(stats.totalValue)}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Gagnés</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.wonCount ?? 0}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Perdus</p>
            <p className="text-2xl font-bold text-red-500">{stats.lostCount ?? 0}</p>
          </CardContent></Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Étape" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes étapes</SelectItem>
            {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-1 border rounded-md p-1">
          <Button variant={viewMode === "kanban" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setViewMode("kanban")}><Kanban className="w-3 h-3" /></Button>
          <Button variant={viewMode === "table" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setViewMode("table")}><LayoutList className="w-3 h-3" /></Button>
        </div>
        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : viewMode === "kanban" ? (
        prospects.length === 0 ? (
          (search !== "" || stageFilter !== "all") ? (
            <p className="text-center text-muted-foreground py-12" data-testid="no-results-prospects-kanban">Aucun prospect ne correspond à vos filtres.</p>
          ) : (
            <EmptyOnboardingHint
              icon={Briefcase}
              title="Aucun prospect pour l'instant"
              description="Ajoutez vos premiers prospects pour suivre votre pipeline commercial. Vous pourrez les déplacer entre les étapes du Kanban et mesurer votre taux de conversion."
              actionLabel="Créer mon premier prospect"
              onAction={openCreate}
              tip="Astuce : convertissez un contact existant en prospect depuis sa fiche détaillée."
              testIdPrefix="empty-prospects-kanban"
            />
          )
        ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 overflow-x-auto pb-2">
          {STAGES.map(col => {
            const items = prospects.filter(p => p.stage === col.key);
            return (
              <div key={col.key} className="min-w-[200px]">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{col.label}</span>
                  <Badge variant="secondary" className="text-xs">{items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {items.map(p => (
                    <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setLocation(`/prospects/${p.id}`)}>
                      <CardContent className="p-3 space-y-2">
                        <p className="text-xs font-semibold leading-tight line-clamp-2">{p.title}</p>
                        {p.company && <p className="text-xs text-muted-foreground">{p.company}</p>}
                        {p.value && <p className="text-xs font-bold text-emerald-600">{fmtEur(p.value)}</p>}
                        <div className="flex items-center justify-between">
                          <PriorityBadge priority={p.priority} />
                          <button className="text-red-400 hover:text-red-600 p-0.5" onClick={e => { e.stopPropagation(); handleDelete(p.id); }}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Vide</p>}
                </div>
              </div>
            );
          })}
        </div>
        )
      ) : (
        <>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selectedIds.length} prospect(s) sélectionné(s)</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"><Layers className="w-3 h-3" />Étape</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Changer l'étape</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {STAGES.map(s => (
                    <DropdownMenuItem key={s.key} onClick={() => handleBulkStage(s.key)} className="cursor-pointer">{s.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"><ArrowUpDown className="w-3 h-3" />Priorité</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Changer la priorité</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {PRIORITIES.map(p => (
                    <DropdownMenuItem key={p.key} onClick={() => handleBulkPriority(p.key)} className="cursor-pointer">{p.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {showAssignInput ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={bulkAssignName}
                    onChange={e => setBulkAssignName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleBulkAssign(); if (e.key === "Escape") { setShowAssignInput(false); setBulkAssignName(""); } }}
                    placeholder="Nom de l'assigné..."
                    className="h-7 text-xs w-36"
                    autoFocus
                  />
                  <Button size="sm" className="h-7 text-xs px-2" onClick={handleBulkAssign} disabled={!bulkAssignName.trim()}>OK</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => { setShowAssignInput(false); setBulkAssignName(""); }}>✕</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setShowAssignInput(true)}><UserPlus className="w-3 h-3" />Assigner</Button>
              )}
              <Button size="sm" variant="destructive" className="gap-1 h-7 text-xs" onClick={handleBulkDelete}><Trash2 className="w-3 h-3" />Supprimer</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSelectedIds([]); setShowAssignInput(false); setBulkAssignName(""); }}>Annuler</Button>
            </div>
          )}
        <Card>
          <div className="divide-y">
            {prospects.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
                <Checkbox checked={selectedIds.length === prospects.length && prospects.length > 0} onCheckedChange={toggleAll} />
                <span className="text-xs text-muted-foreground">Tout sélectionner</span>
              </div>
            )}
            {prospects.length === 0 && (
              <div className="py-4 px-4">
                {(search !== "" || stageFilter !== "all") ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="no-results-prospects">Aucun prospect ne correspond à vos filtres.</p>
                ) : (
                  <EmptyOnboardingHint
                    icon={Briefcase}
                    title="Aucun prospect pour l'instant"
                    description="Ajoutez vos premiers prospects pour suivre votre pipeline commercial. Vous pourrez les déplacer entre les étapes et mesurer votre taux de conversion."
                    actionLabel="Créer mon premier prospect"
                    onAction={openCreate}
                    tip="Astuce : convertissez un contact existant en prospect depuis sa fiche détaillée."
                    testIdPrefix="empty-prospects"
                  />
                )}
              </div>
            )}
            {prospects.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                <Checkbox checked={selectedIds.includes(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setLocation(`/prospects/${p.id}`)}>
                  <p className="text-sm font-medium truncate hover:text-primary">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{[p.company, p.contactName].filter(Boolean).join(" · ")}</p>
                </div>
                <StageBadge stage={p.stage} />
                <PriorityBadge priority={p.priority} />
                {p.value && <span className="text-sm font-bold text-emerald-600 hidden md:block">{fmtEur(p.value)}</span>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => setLocation(`/prospects/${p.id}`)}><Edit className="w-3 h-3 mr-2" />Ouvrir</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicate(p.id)}><Copy className="w-3 h-3 mr-2" />Dupliquer</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleConvert(p.id)}><UserPlus className="w-3 h-3 mr-2" />Convertir en contact</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCreateProjet(p)} className="text-indigo-600"><FolderKanban className="w-3 h-3 mr-2" />Créer un projet</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(p.id)}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">{total} prospect{total !== 1 ? "s" : ""}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}
        </Card>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le prospect" : "Nouveau prospect"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Opportunité commerciale" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Étape</Label>
                <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Priorité</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Valeur (€)</Label><Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0" /></div>
              <div><Label className="text-xs">Probabilité (%)</Label><Input type="number" min="0" max="100" value={form.probability} onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Contact</Label><Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Nom du contact" /></div>
              <div><Label className="text-xs">Entreprise</Label><Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><Label className="text-xs">Téléphone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Source</Label><Input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="Site web, recommandation..." /></div>
              <div><Label className="text-xs">Assigné à</Label><Input value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Date de clôture prévue</Label><Input type="date" value={form.expectedCloseDate} onChange={e => setForm(f => ({ ...f, expectedCloseDate: e.target.value }))} /></div>
            <div><Label className="text-xs">Notes</Label><GhostTextarea fieldType="prospect_note" context={{ title: form.title, contactName: form.contactName }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editingId ? "Mettre à jour" : "Créer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
