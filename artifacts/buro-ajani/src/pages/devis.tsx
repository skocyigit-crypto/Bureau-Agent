import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { FileSignature, Search, Plus, MoreHorizontal, Edit, Trash2, Copy, Send, Check, X, DollarSign, FileText, TrendingUp, Clock } from "lucide-react";
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

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }, ...opts });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Erreur"); }
  if (res.status === 204) return null;
  return res.json();
}

const STATUS_MAP: Record<string, { label: string; variant: string; icon: any }> = {
  brouillon: { label: "Brouillon", variant: "secondary", icon: FileText },
  envoye: { label: "Envoye", variant: "default", icon: Send },
  accepte: { label: "Accepte", variant: "default", icon: Check },
  refuse: { label: "Refuse", variant: "destructive", icon: X },
  expire: { label: "Expire", variant: "outline", icon: Clock },
};

function euro(v: number | string | null | undefined) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(v) || 0);
}

type LineItem = { description: string; quantity: number; unitPrice: number; taxRate: number };
const emptyItem = (): LineItem => ({ description: "", quantity: 1, unitPrice: 0, taxRate: 20 });

export default function Devis() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);

  const { data, isLoading } = useQuery({ queryKey: ["devis", search, statusFilter], queryFn: () => apiFetch(`/devis?search=${search}&status=${statusFilter}`) });
  const { data: stats } = useQuery({ queryKey: ["devis-stats"], queryFn: () => apiFetch("/devis/stats") });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiFetch("/devis", { method: "POST", body: JSON.stringify(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devis"] }); qc.invalidateQueries({ queryKey: ["devis-stats"] }); toast({ title: "Devis cree" }); setIsDialogOpen(false); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: any) => apiFetch(`/devis/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devis"] }); qc.invalidateQueries({ queryKey: ["devis-stats"] }); toast({ title: "Devis mis a jour" }); setIsDialogOpen(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/devis/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devis"] }); qc.invalidateQueries({ queryKey: ["devis-stats"] }); toast({ title: "Devis supprime" }); },
  });

  const openCreate = () => { setEditing(null); setForm({ title: "", clientName: "", clientEmail: "", clientPhone: "", clientCompany: "" }); setItems([emptyItem()]); setIsDialogOpen(true); };
  const openEdit = (d: any) => { setEditing(d); setForm({ ...d }); setItems(d.items?.length > 0 ? d.items : [emptyItem()]); setIsDialogOpen(true); };

  const handleSave = () => {
    const data = { ...form, items: items.filter(i => i.description) };
    if (editing) updateMutation.mutate({ id: editing.id, ...data });
    else createMutation.mutate(data);
  };

  const updateItem = (idx: number, field: keyof LineItem, value: any) => {
    const next = [...items]; next[idx] = { ...next[idx], [field]: value }; setItems(next);
  };
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = items.reduce((s, i) => s + i.quantity * i.unitPrice * i.taxRate / 100, 0);

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={FileSignature} variant="indigo" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Devis</h1>
            <p className="text-muted-foreground text-sm">Creez et gerez vos devis commerciaux</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nouveau Devis</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><FileText className="h-5 w-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.total}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Montant total</p><p className="text-xl font-bold">{euro(stats.totalAmount)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Check className="h-5 w-5 text-green-500" /><div><p className="text-xs text-muted-foreground">Acceptes</p><p className="text-xl font-bold">{stats.accepte}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-indigo-500" /><div><p className="text-xs text-muted-foreground">Taux conversion</p><p className="text-xl font-bold">{stats.conversionRate}%</p></div></div></CardContent></Card>
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
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Reference</th>
                  <th className="text-left p-3 font-medium">Titre</th>
                  <th className="text-left p-3 font-medium">Client</th>
                  <th className="text-left p-3 font-medium">Montant</th>
                  <th className="text-left p-3 font-medium">Statut</th>
                  <th className="text-left p-3 font-medium">Date</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {(data?.devis || []).map((d: any) => (
                    <tr key={d.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => openEdit(d)}>
                      <td className="p-3 font-mono text-xs">{d.reference}</td>
                      <td className="p-3 font-medium">{d.title}</td>
                      <td className="p-3 text-muted-foreground">{d.clientName}{d.clientCompany ? ` - ${d.clientCompany}` : ""}</td>
                      <td className="p-3 font-semibold">{euro(d.totalAmount)}</td>
                      <td className="p-3"><Badge variant={STATUS_MAP[d.status]?.variant as any}>{STATUS_MAP[d.status]?.label || d.status}</Badge></td>
                      <td className="p-3 text-muted-foreground text-xs">{format(new Date(d.createdAt), "dd/MM/yyyy", { locale: fr })}</td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(d); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                            {d.status === "brouillon" && <DropdownMenuItem onClick={e => { e.stopPropagation(); updateMutation.mutate({ id: d.id, status: "envoye" }); }}><Send className="h-3 w-3 mr-2" /> Envoyer</DropdownMenuItem>}
                            <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(d.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!data?.devis || data.devis.length === 0) && <div className="text-center py-12 text-muted-foreground">Aucun devis pour le moment</div>}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Devis ${editing.reference}` : "Nouveau devis"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Titre *</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nom client *</Label><Input value={form.clientName || ""} onChange={e => setForm({ ...form, clientName: e.target.value })} /></div>
              <div><Label>Societe</Label><Input value={form.clientCompany || ""} onChange={e => setForm({ ...form, clientCompany: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.clientEmail || ""} onChange={e => setForm({ ...form, clientEmail: e.target.value })} /></div>
              <div><Label>Telephone</Label><Input value={form.clientPhone || ""} onChange={e => setForm({ ...form, clientPhone: e.target.value })} /></div>
            </div>
            {editing && (
              <div><Label>Statut</Label>
                <Select value={form.status || "brouillon"} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Lignes</Label>
              <div className="space-y-2 mt-1">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5"><Input placeholder="Description" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} /></div>
                    <div className="col-span-2"><Input type="number" placeholder="Qte" value={item.quantity} onChange={e => updateItem(idx, "quantity", Number(e.target.value))} /></div>
                    <div className="col-span-2"><Input type="number" placeholder="PU" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", Number(e.target.value))} /></div>
                    <div className="col-span-2"><Input type="number" placeholder="TVA%" value={item.taxRate} onChange={e => updateItem(idx, "taxRate", Number(e.target.value))} /></div>
                    <div className="col-span-1"><Button variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button></div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setItems([...items, emptyItem()])}><Plus className="h-3 w-3 mr-1" /> Ajouter une ligne</Button>
              </div>
              <div className="text-right mt-2 space-y-1 text-sm">
                <div>Sous-total: <span className="font-semibold">{euro(subtotal)}</span></div>
                <div>TVA: <span className="font-semibold">{euro(tax)}</span></div>
                <div className="text-base">Total: <span className="font-bold">{euro(subtotal + tax)}</span></div>
              </div>
            </div>
            <div><Label>Conditions</Label><Textarea value={form.conditions || ""} onChange={e => setForm({ ...form, conditions: e.target.value })} rows={2} /></div>
            <div><Label>Notes</Label><Textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={!form.title || !form.clientName}>{editing ? "Enregistrer" : "Creer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
