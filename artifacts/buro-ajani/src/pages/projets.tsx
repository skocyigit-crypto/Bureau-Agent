import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { FolderKanban, Search, Plus, MoreHorizontal, Edit, Trash2, Calendar, Users2, DollarSign, TrendingUp, AlertTriangle, Clock } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }, ...opts });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Erreur"); }
  if (res.status === 204) return null;
  return res.json();
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  planifie: { label: "Planifie", color: "bg-blue-500" },
  en_cours: { label: "En cours", color: "bg-amber-500" },
  en_pause: { label: "En pause", color: "bg-gray-400" },
  termine: { label: "Termine", color: "bg-emerald-500" },
  annule: { label: "Annule", color: "bg-red-500" },
};
const PRIORITY_COLORS: Record<string, string> = { haute: "destructive", moyenne: "secondary", basse: "outline" };

function euro(v: number | string | null | undefined) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(v) || 0);
}

export default function Projets() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const { data, isLoading } = useQuery({ queryKey: ["projets", search, statusFilter], queryFn: () => apiFetch(`/projets?search=${search}&status=${statusFilter}`) });
  const { data: stats } = useQuery({ queryKey: ["projets-stats"], queryFn: () => apiFetch("/projets/stats") });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiFetch("/projets", { method: "POST", body: JSON.stringify(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projets"] }); qc.invalidateQueries({ queryKey: ["projets-stats"] }); toast({ title: "Projet cree" }); setIsDialogOpen(false); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: any) => apiFetch(`/projets/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projets"] }); qc.invalidateQueries({ queryKey: ["projets-stats"] }); toast({ title: "Projet mis a jour" }); setIsDialogOpen(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/projets/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projets"] }); qc.invalidateQueries({ queryKey: ["projets-stats"] }); toast({ title: "Projet supprime" }); },
  });

  const openCreate = () => { setEditing(null); setForm({ title: "", status: "planifie", priority: "moyenne", progress: 0 }); setIsDialogOpen(true); };
  const openEdit = (p: any) => { setEditing(p); setForm({ ...p }); setIsDialogOpen(true); };

  const handleSave = () => {
    const d = { ...form, budget: form.budget ? Number(form.budget) : null, progress: Number(form.progress) || 0 };
    if (editing) updateMutation.mutate({ id: editing.id, ...d });
    else createMutation.mutate(d);
  };

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={FolderKanban} variant="purple" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Projets</h1>
            <p className="text-muted-foreground text-sm">Suivi et gestion des projets</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nouveau Projet</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><FolderKanban className="h-5 w-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.total}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Clock className="h-5 w-5 text-amber-500" /><div><p className="text-xs text-muted-foreground">En cours</p><p className="text-xl font-bold">{stats.en_cours}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-indigo-500" /><div><p className="text-xs text-muted-foreground">Progression moy.</p><p className="text-xl font-bold">{stats.avgProgress}%</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Budget total</p><p className="text-xl font-bold">{euro(stats.totalBudget)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" /><div><p className="text-xs text-muted-foreground">En retard</p><p className="text-xl font-bold">{stats.overdue}</p></div></div></CardContent></Card>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data?.projets || []).map((p: any) => (
            <Card key={p.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => openEdit(p)}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="font-semibold">{p.title}</h3>
                    {p.clientCompany && <p className="text-sm text-muted-foreground">{p.clientCompany}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(p.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${STATUS_MAP[p.status]?.color} text-white text-xs`}>{STATUS_MAP[p.status]?.label || p.status}</Badge>
                  <Badge variant={PRIORITY_COLORS[p.priority] as any} className="text-xs">{p.priority}</Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Progression</span>
                    <span className="font-semibold">{p.progress}%</span>
                  </div>
                  <Progress value={p.progress} className="h-2" />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  {p.budget && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> {euro(p.budget)}</span>}
                  {p.endDate && (
                    <span className={`flex items-center gap-1 ${new Date(p.endDate) < new Date() && p.status === "en_cours" ? "text-red-500 font-semibold" : ""}`}>
                      <Calendar className="h-3 w-3" /> {format(new Date(p.endDate), "dd/MM/yyyy", { locale: fr })}
                    </span>
                  )}
                </div>
                {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
              </CardContent>
            </Card>
          ))}
          {(!data?.projets || data.projets.length === 0) && (
            <div className="col-span-full text-center py-12 text-muted-foreground">Aucun projet pour le moment</div>
          )}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Modifier le projet" : "Nouveau projet"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Titre *</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client</Label><Input value={form.clientName || ""} onChange={e => setForm({ ...form, clientName: e.target.value })} /></div>
              <div><Label>Societe</Label><Input value={form.clientCompany || ""} onChange={e => setForm({ ...form, clientCompany: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Statut</Label>
                <Select value={form.status || "planifie"} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priorite</Label>
                <Select value={form.priority || "moyenne"} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="haute">Haute</SelectItem><SelectItem value="moyenne">Moyenne</SelectItem><SelectItem value="basse">Basse</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Progression (%)</Label><Input type="number" min={0} max={100} value={form.progress || 0} onChange={e => setForm({ ...form, progress: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Budget (EUR)</Label><Input type="number" value={form.budget || ""} onChange={e => setForm({ ...form, budget: e.target.value })} /></div>
              <div><Label>Adresse</Label><Input value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date debut</Label><Input type="date" value={form.startDate ? (typeof form.startDate === "string" ? form.startDate.slice(0, 10) : "") : ""} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><Label>Date fin</Label><Input type="date" value={form.endDate ? (typeof form.endDate === "string" ? form.endDate.slice(0, 10) : "") : ""} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
            </div>
            <div><Label>Responsable</Label><Input value={form.assignedTo || ""} onChange={e => setForm({ ...form, assignedTo: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={!form.title}>{editing ? "Enregistrer" : "Creer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
