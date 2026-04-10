import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Target, Search, Plus, MoreHorizontal, Edit, Trash2, ArrowRight, Columns3, LayoutList, DollarSign, TrendingUp, Users2, Percent, GripVertical } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }, ...opts });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Erreur"); }
  if (res.status === 204) return null;
  return res.json();
}

const STAGE_COLORS: Record<string, string> = {
  nouveau: "bg-indigo-500", contact: "bg-blue-500", qualification: "bg-cyan-500",
  proposition: "bg-amber-500", negociation: "bg-orange-500", gagne: "bg-emerald-500", perdu: "bg-red-500",
};

const STAGE_LABELS: Record<string, string> = {
  nouveau: "Nouveau", contact: "Contact", qualification: "Qualification",
  proposition: "Proposition", negociation: "Negociation", gagne: "Gagne", perdu: "Perdu",
};

const PRIORITY_COLORS: Record<string, string> = { haute: "destructive", moyenne: "secondary", basse: "outline" };

function euro(v: number | string | null | undefined) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(v) || 0);
}

export default function Prospects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const { data: pipelineData, isLoading } = useQuery({ queryKey: ["prospects-pipeline"], queryFn: () => apiFetch("/prospects/pipeline") });
  const { data: listData } = useQuery({ queryKey: ["prospects-list", search], queryFn: () => apiFetch(`/prospects?search=${search}`) });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiFetch("/prospects", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["prospects-pipeline"] }); qc.invalidateQueries({ queryKey: ["prospects-list"] }); toast({ title: "Prospect cree" }); setIsDialogOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiFetch(`/prospects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["prospects-pipeline"] }); qc.invalidateQueries({ queryKey: ["prospects-list"] }); toast({ title: "Prospect mis a jour" }); setIsDialogOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/prospects/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["prospects-pipeline"] }); qc.invalidateQueries({ queryKey: ["prospects-list"] }); toast({ title: "Prospect supprime" }); },
  });

  const moveStage = useCallback((id: number, stage: string) => {
    updateMutation.mutate({ id, stage });
  }, [updateMutation]);

  const openCreate = () => { setEditing(null); setForm({ title: "", stage: "nouveau", priority: "moyenne", probability: 50, value: "" }); setIsDialogOpen(true); };
  const openEdit = (p: any) => { setEditing(p); setForm({ ...p, value: p.value || "" }); setIsDialogOpen(true); };

  const handleSave = () => {
    const data = { ...form, value: form.value ? Number(form.value) : null, probability: Number(form.probability) || 50 };
    if (editing) updateMutation.mutate({ id: editing.id, ...data });
    else createMutation.mutate(data);
  };

  const stats = pipelineData?.stats;

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={Target} variant="blue" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Pipeline Commercial</h1>
            <p className="text-muted-foreground text-sm">Gerez vos prospects et opportunites</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg">
            <Button variant={viewMode === "kanban" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("kanban")}><Columns3 className="h-4 w-4 mr-1" /> Kanban</Button>
            <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("list")}><LayoutList className="h-4 w-4 mr-1" /> Liste</Button>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nouveau Prospect</Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Users2 className="h-5 w-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.totalCount}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Pipeline</p><p className="text-xl font-bold">{euro(stats.totalValue)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-indigo-500" /><div><p className="text-xs text-muted-foreground">Gagne</p><p className="text-xl font-bold">{euro(stats.wonValue)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Percent className="h-5 w-5 text-amber-500" /><div><p className="text-xs text-muted-foreground">Prob. moy.</p><p className="text-xl font-bold">{stats.avgProbability}%</p></div></div></CardContent></Card>
        </div>
      )}

      {viewMode === "list" && (
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-7 gap-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : viewMode === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {pipelineData?.stages?.map((stage: any) => (
            <div key={stage.id} className="min-w-[260px] w-[260px] flex-shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-3 h-3 rounded-full ${STAGE_COLORS[stage.id]}`} />
                <span className="font-semibold text-sm">{stage.label}</span>
                <Badge variant="secondary" className="ml-auto text-xs">{pipelineData.pipeline[stage.id]?.length || 0}</Badge>
              </div>
              <div className="space-y-2 min-h-[200px] bg-muted/30 rounded-lg p-2">
                {pipelineData.pipeline[stage.id]?.map((p: any) => (
                  <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(p)}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <h3 className="font-medium text-sm leading-tight">{p.title}</h3>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                            {stage.id !== "gagne" && <DropdownMenuItem onClick={e => { e.stopPropagation(); moveStage(p.id, "gagne"); }}><ArrowRight className="h-3 w-3 mr-2" /> Marquer gagne</DropdownMenuItem>}
                            <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(p.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {p.company && <p className="text-xs text-muted-foreground">{p.company}</p>}
                      {p.contactName && <p className="text-xs text-muted-foreground">{p.contactName}</p>}
                      <div className="flex items-center justify-between">
                        {p.value && <span className="text-xs font-semibold text-emerald-600">{euro(p.value)}</span>}
                        <Badge variant={PRIORITY_COLORS[p.priority] as any} className="text-[10px]">{p.priority}</Badge>
                      </div>
                      {p.probability != null && (
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${p.probability}%` }} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Titre</th>
                  <th className="text-left p-3 font-medium">Societe</th>
                  <th className="text-left p-3 font-medium">Etape</th>
                  <th className="text-left p-3 font-medium">Valeur</th>
                  <th className="text-left p-3 font-medium">Prob.</th>
                  <th className="text-left p-3 font-medium">Priorite</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {(listData?.prospects || []).map((p: any) => (
                    <tr key={p.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => openEdit(p)}>
                      <td className="p-3 font-medium">{p.title}</td>
                      <td className="p-3 text-muted-foreground">{p.company || "-"}</td>
                      <td className="p-3"><Badge className={`${STAGE_COLORS[p.stage]} text-white text-xs`}>{STAGE_LABELS[p.stage]}</Badge></td>
                      <td className="p-3">{p.value ? euro(p.value) : "-"}</td>
                      <td className="p-3">{p.probability}%</td>
                      <td className="p-3"><Badge variant={PRIORITY_COLORS[p.priority] as any}>{p.priority}</Badge></td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(p.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!listData?.prospects || listData.prospects.length === 0) && (
                <div className="text-center py-12 text-muted-foreground">Aucun prospect pour le moment</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le prospect" : "Nouveau prospect"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Titre *</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Societe</Label><Input value={form.company || ""} onChange={e => setForm({ ...form, company: e.target.value })} /></div>
              <div><Label>Contact</Label><Input value={form.contactName || ""} onChange={e => setForm({ ...form, contactName: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Telephone</Label><Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Etape</Label>
                <Select value={form.stage || "nouveau"} onValueChange={v => setForm({ ...form, stage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STAGE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priorite</Label>
                <Select value={form.priority || "moyenne"} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="haute">Haute</SelectItem><SelectItem value="moyenne">Moyenne</SelectItem><SelectItem value="basse">Basse</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Source</Label><Input value={form.source || ""} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="Web, Salon..." /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valeur (EUR)</Label><Input type="number" value={form.value || ""} onChange={e => setForm({ ...form, value: e.target.value })} /></div>
              <div><Label>Probabilite (%)</Label><Input type="number" min={0} max={100} value={form.probability || 50} onChange={e => setForm({ ...form, probability: e.target.value })} /></div>
            </div>
            <div><Label>Date de cloture prevue</Label><Input type="date" value={form.expectedCloseDate ? form.expectedCloseDate.slice(0, 10) : ""} onChange={e => setForm({ ...form, expectedCloseDate: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} /></div>
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
