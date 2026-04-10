import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Receipt, Search, Plus, MoreHorizontal, Edit, Trash2, Send, Check, DollarSign, AlertTriangle, Clock, FileText, CreditCard } from "lucide-react";
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

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  brouillon: { label: "Brouillon", variant: "secondary" },
  envoyee: { label: "Envoyee", variant: "default" },
  payee: { label: "Payee", variant: "default" },
  partielle: { label: "Partielle", variant: "outline" },
  annulee: { label: "Annulee", variant: "destructive" },
};

function euro(v: number | string | null | undefined) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(v) || 0);
}

type LineItem = { description: string; quantity: number; unitPrice: number; taxRate: number };
const emptyItem = (): LineItem => ({ description: "", quantity: 1, unitPrice: 0, taxRate: 20 });

export default function Factures() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);

  const { data, isLoading } = useQuery({ queryKey: ["factures", search, statusFilter], queryFn: () => apiFetch(`/factures-client?search=${search}&status=${statusFilter}`) });
  const { data: stats } = useQuery({ queryKey: ["factures-stats"], queryFn: () => apiFetch("/factures-client/stats") });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiFetch("/factures-client", { method: "POST", body: JSON.stringify(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["factures"] }); qc.invalidateQueries({ queryKey: ["factures-stats"] }); toast({ title: "Facture creee" }); setIsDialogOpen(false); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...d }: any) => apiFetch(`/factures-client/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["factures"] }); qc.invalidateQueries({ queryKey: ["factures-stats"] }); toast({ title: "Facture mise a jour" }); setIsDialogOpen(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/factures-client/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["factures"] }); qc.invalidateQueries({ queryKey: ["factures-stats"] }); toast({ title: "Facture supprimee" }); },
  });

  const openCreate = () => { setEditing(null); setForm({ title: "", clientName: "", clientEmail: "" }); setItems([emptyItem()]); setIsDialogOpen(true); };
  const openEdit = (f: any) => { setEditing(f); setForm({ ...f }); setItems(f.items?.length > 0 ? f.items : [emptyItem()]); setIsDialogOpen(true); };

  const handleSave = () => {
    const d = { ...form, items: items.filter(i => i.description) };
    if (editing) updateMutation.mutate({ id: editing.id, ...d });
    else createMutation.mutate(d);
  };

  const updateItem = (idx: number, field: keyof LineItem, value: any) => {
    const next = [...items]; next[idx] = { ...next[idx], [field]: value }; setItems(next);
  };
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const tax = items.reduce((s, i) => s + i.quantity * i.unitPrice * i.taxRate / 100, 0);

  const isOverdue = (f: any) => f.status === "envoyee" && f.dueDate && new Date(f.dueDate) < new Date();

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={Receipt} variant="emerald" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Factures Client</h1>
            <p className="text-muted-foreground text-sm">Gestion de la facturation</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nouvelle Facture</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><FileText className="h-5 w-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Total factures</p><p className="text-xl font-bold">{stats.total}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Facture</p><p className="text-xl font-bold">{euro(stats.totalAmount)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-green-500" /><div><p className="text-xs text-muted-foreground">Encaisse</p><p className="text-xl font-bold">{euro(stats.paidAmount)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" /><div><p className="text-xs text-muted-foreground">En retard</p><p className="text-xl font-bold">{euro(stats.overdueAmount)}</p></div></div></CardContent></Card>
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
                  <th className="text-left p-3 font-medium">Paye</th>
                  <th className="text-left p-3 font-medium">Statut</th>
                  <th className="text-left p-3 font-medium">Echeance</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {(data?.factures || []).map((f: any) => (
                    <tr key={f.id} className={`border-b hover:bg-muted/30 cursor-pointer ${isOverdue(f) ? "bg-red-50 dark:bg-red-950/20" : ""}`} onClick={() => openEdit(f)}>
                      <td className="p-3 font-mono text-xs">{f.reference}</td>
                      <td className="p-3 font-medium">{f.title}</td>
                      <td className="p-3 text-muted-foreground">{f.clientName}</td>
                      <td className="p-3 font-semibold">{euro(f.totalAmount)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Progress value={Number(f.totalAmount) > 0 ? (Number(f.paidAmount) / Number(f.totalAmount)) * 100 : 0} className="h-2 w-16" />
                          <span className="text-xs">{euro(f.paidAmount)}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        {isOverdue(f) ? <Badge variant="destructive">En retard</Badge> : <Badge variant={STATUS_MAP[f.status]?.variant as any}>{STATUS_MAP[f.status]?.label || f.status}</Badge>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{f.dueDate ? format(new Date(f.dueDate), "dd/MM/yyyy", { locale: fr }) : "-"}</td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(f); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                            {f.status === "brouillon" && <DropdownMenuItem onClick={e => { e.stopPropagation(); updateMutation.mutate({ id: f.id, status: "envoyee" }); }}><Send className="h-3 w-3 mr-2" /> Envoyer</DropdownMenuItem>}
                            {f.status !== "payee" && <DropdownMenuItem onClick={e => { e.stopPropagation(); updateMutation.mutate({ id: f.id, status: "payee" }); }}><Check className="h-3 w-3 mr-2" /> Marquer payee</DropdownMenuItem>}
                            <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(f.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!data?.factures || data.factures.length === 0) && <div className="text-center py-12 text-muted-foreground">Aucune facture pour le moment</div>}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Facture ${editing.reference}` : "Nouvelle facture"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Titre *</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nom client *</Label><Input value={form.clientName || ""} onChange={e => setForm({ ...form, clientName: e.target.value })} /></div>
              <div><Label>Societe</Label><Input value={form.clientCompany || ""} onChange={e => setForm({ ...form, clientCompany: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.clientEmail || ""} onChange={e => setForm({ ...form, clientEmail: e.target.value })} /></div>
              <div><Label>Echeance</Label><Input type="date" value={form.dueDate ? (typeof form.dueDate === "string" ? form.dueDate.slice(0, 10) : "") : ""} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></div>
            </div>
            {editing && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Statut</Label>
                  <Select value={form.status || "brouillon"} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Mode de paiement</Label><Input value={form.paymentMethod || ""} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} placeholder="Virement, CB..." /></div>
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
                <Button variant="outline" size="sm" onClick={() => setItems([...items, emptyItem()])}><Plus className="h-3 w-3 mr-1" /> Ajouter</Button>
              </div>
              <div className="text-right mt-2 space-y-1 text-sm">
                <div>Sous-total: <span className="font-semibold">{euro(subtotal)}</span></div>
                <div>TVA: <span className="font-semibold">{euro(tax)}</span></div>
                <div className="text-base">Total: <span className="font-bold">{euro(subtotal + tax)}</span></div>
              </div>
            </div>
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
