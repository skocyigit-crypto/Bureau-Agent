import { useState, useEffect, useCallback } from "react";
import { Plus, Search, MoreHorizontal, Edit, Trash2, Mail, Copy, Check, X, Package, Truck, Clock, AlertCircle, Download, Printer, FolderKanban } from "lucide-react";
import { useLocation } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  confirme: "Confirmé",
  recu: "Reçu",
  annule: "Annulé",
};

const STATUS_COLORS: Record<string, string> = {
  brouillon: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  envoye: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  confirme: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  recu: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  annule: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function fmt(n: number | string) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + " €";
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

interface BC {
  id: number; reference: string; fournisseurName: string; fournisseurEmail?: string;
  fournisseurPhone?: string; fournisseurAddress?: string; items: any[];
  subtotal: string; taxAmount: string; totalAmount: string; currency: string;
  status: string; expectedDelivery?: string; receivedAt?: string; notes?: string; conditions?: string;
  createdAt: string; updatedAt: string;
}

interface LineItem { description: string; reference: string; quantity: number; unitPrice: number; taxRate: number; total: number; }

const EMPTY_LINE: LineItem = { description: "", reference: "", quantity: 1, unitPrice: 0, taxRate: 20, total: 0 };

function ItemsEditor({ items, onChange }: { items: LineItem[]; onChange: (items: LineItem[]) => void }) {
  function update(idx: number, field: keyof LineItem, value: any) {
    const updated = items.map((item, i) => {
      if (i !== idx) return item;
      const ni = { ...item, [field]: value };
      ni.total = ni.quantity * ni.unitPrice * (1 + ni.taxRate / 100);
      return ni;
    });
    onChange(updated);
  }
  function remove(idx: number) { onChange(items.filter((_, i) => i !== idx)); }
  function add() { onChange([...items, { ...EMPTY_LINE }]); }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-1 text-xs font-medium text-muted-foreground px-1">
        <span className="col-span-4">Article / Description</span>
        <span className="col-span-2">Référence</span>
        <span className="col-span-1 text-right">Qté</span>
        <span className="col-span-2 text-right">PU HT</span>
        <span className="col-span-1 text-right">TVA%</span>
        <span className="col-span-1 text-right">Total</span>
        <span className="col-span-1" />
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-1 items-center">
          <Input className="col-span-4 h-8 text-xs" value={item.description} onChange={e => update(idx, "description", e.target.value)} placeholder="Description..." />
          <Input className="col-span-2 h-8 text-xs" value={item.reference} onChange={e => update(idx, "reference", e.target.value)} placeholder="Réf." />
          <Input type="number" className="col-span-1 h-8 text-xs text-right" value={item.quantity} onChange={e => update(idx, "quantity", parseFloat(e.target.value) || 0)} min={0} />
          <Input type="number" className="col-span-2 h-8 text-xs text-right" value={item.unitPrice} onChange={e => update(idx, "unitPrice", parseFloat(e.target.value) || 0)} min={0} step="0.01" />
          <Input type="number" className="col-span-1 h-8 text-xs text-right" value={item.taxRate} onChange={e => update(idx, "taxRate", parseFloat(e.target.value) || 0)} min={0} />
          <span className="col-span-1 text-xs text-right font-medium">{fmt(item.quantity * item.unitPrice)}</span>
          <Button variant="ghost" size="icon" className="col-span-1 h-8 w-8" onClick={() => remove(idx)}><X className="w-3 h-3" /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="text-xs" onClick={add}><Plus className="w-3 h-3 mr-1" />Ajouter une ligne</Button>
    </div>
  );
}

export default function CommandesFournisseurPage() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<BC[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BC | null>(null);
  const { toast } = useToast();
  const limit = 20;

  const [form, setForm] = useState({
    fournisseurName: "", fournisseurEmail: "", fournisseurPhone: "",
    fournisseurAddress: "", notes: "", conditions: "", currency: "EUR", expectedDelivery: "",
    items: [{ ...EMPTY_LINE }] as LineItem[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit), sortBy: "createdAt", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`${BASE}/api/commandes-fournisseur?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData(d.data); setTotal(d.total);
    } catch { toast({ title: "Erreur", description: "Impossible de charger les commandes.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ fournisseurName: "", fournisseurEmail: "", fournisseurPhone: "", fournisseurAddress: "", notes: "", conditions: "", currency: "EUR", expectedDelivery: "", items: [{ ...EMPTY_LINE }] });
    setDialogOpen(true);
  }

  function openEdit(bc: BC) {
    setEditing(bc);
    setForm({
      fournisseurName: bc.fournisseurName || "", fournisseurEmail: bc.fournisseurEmail || "",
      fournisseurPhone: bc.fournisseurPhone || "", fournisseurAddress: bc.fournisseurAddress || "",
      notes: bc.notes || "", conditions: bc.conditions || "", currency: bc.currency || "EUR",
      expectedDelivery: bc.expectedDelivery ? bc.expectedDelivery.split("T")[0] : "",
      items: (bc.items as LineItem[]).length ? bc.items as LineItem[] : [{ ...EMPTY_LINE }],
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.fournisseurName.trim()) { toast({ title: "Champ requis", description: "Nom du fournisseur obligatoire.", variant: "destructive" }); return; }
    const body = { ...form, items: form.items.filter(i => i.description.trim()) };
    const url = editing ? `${BASE}/api/commandes-fournisseur/${editing.id}` : `${BASE}/api/commandes-fournisseur`;
    const method = editing ? "PATCH" : "POST";
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      toast({ title: editing ? "Commande mise à jour" : "Commande créée" });
      setDialogOpen(false); load();
    } catch { toast({ title: "Erreur", description: "Impossible de sauvegarder.", variant: "destructive" }); }
  }

  async function handleStatus(id: number, status: string) {
    const res = await fetch(`${BASE}/api/commandes-fournisseur/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    if (res.ok) { toast({ title: "Statut mis à jour" }); load(); }
  }

  async function handleSend(id: number) {
    const res = await fetch(`${BASE}/api/commandes-fournisseur/${id}/send`, { method: "POST", credentials: "include" });
    const d = await res.json();
    if (res.ok) { toast({ title: "BC envoyé", description: d.message }); load(); }
    else toast({ title: "Erreur d'envoi", description: d.error, variant: "destructive" });
  }

  async function handleDuplicate(id: number) {
    const res = await fetch(`${BASE}/api/commandes-fournisseur/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Commande dupliquée" }); load(); }
    else toast({ title: "Erreur", description: "Impossible de dupliquer.", variant: "destructive" });
  }

  async function handleDelete(id: number) {
    if (!confirm("Supprimer cette commande ?")) return;
    const res = await fetch(`${BASE}/api/commandes-fournisseur/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Commande supprimée" }); load(); }
    else toast({ title: "Erreur", description: "Impossible de supprimer.", variant: "destructive" });
  }

  const toggleSelect = (id: number) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleAll = () => setSelectedIds(prev => prev.length === data.length ? [] : data.map(bc => bc.id));
  const handleBulkDelete = async () => {
    if (!selectedIds.length || !confirm(`Supprimer ${selectedIds.length} commande(s) ?`)) return;
    const res = await fetch(`${BASE}/api/bulk/commandes/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: `${selectedIds.length} commande(s) supprimée(s)` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkStatus = async (status: string) => {
    if (!selectedIds.length) return;
    const res = await fetch(`${BASE}/api/bulk/commandes/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, status }) });
    if (res.ok) { toast({ title: `${selectedIds.length} commande(s) mise(s) à jour` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  async function handleExport() {
    window.open(`${BASE}/api/commandes-fournisseur/export/csv`, "_blank");
  }

  const totalPages = Math.ceil(total / limit);
  const totals = form.items.reduce((acc, i) => {
    const ht = i.quantity * i.unitPrice;
    const tax = ht * (i.taxRate / 100);
    return { subtotal: acc.subtotal + ht, taxAmount: acc.taxAmount + tax };
  }, { subtotal: 0, taxAmount: 0 });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bons de Commande</h1>
          <p className="text-sm text-muted-foreground">Commandes passées aux fournisseurs · {total} au total</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-2" />Exporter</Button>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-2" />Nouveau BC</Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Rechercher..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/60 border rounded-lg flex-wrap">
          <span className="text-sm font-medium">{selectedIds.length} sélectionné(s)</span>
          <Select onValueChange={handleBulkStatus}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Changer statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="brouillon">Brouillon</SelectItem>
              <SelectItem value="envoye">Envoyé</SelectItem>
              <SelectItem value="confirme">Confirmé</SelectItem>
              <SelectItem value="recu">Reçu</SelectItem>
              <SelectItem value="annule">Annulé</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete}><Trash2 className="w-3 h-3 mr-1" />Supprimer la sélection</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Annuler</Button>
        </div>
      )}

      <div className="border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={data.length > 0 && selectedIds.length === data.length} onCheckedChange={toggleAll} /></TableHead>
              <TableHead className="w-32">Référence</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead className="hidden md:table-cell w-28">Statut</TableHead>
              <TableHead className="hidden lg:table-cell w-28">Livraison</TableHead>
              <TableHead className="text-right w-28">Montant TTC</TableHead>
              <TableHead className="hidden sm:table-cell text-right w-24">Date</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(7)].map((_, j) => <TableCell key={j}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell>)}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>Aucun bon de commande</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={openNew}><Plus className="w-3 h-3 mr-1" />Créer un BC</Button>
                </TableCell>
              </TableRow>
            ) : data.map(bc => (
              <TableRow key={bc.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openEdit(bc)}>
                <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedIds.includes(bc.id)} onCheckedChange={() => toggleSelect(bc.id)} /></TableCell>
                <TableCell className="font-mono text-xs font-medium">{bc.reference}</TableCell>
                <TableCell>
                  <div className="font-medium text-sm">{bc.fournisseurName}</div>
                  {bc.fournisseurEmail && <div className="text-xs text-muted-foreground">{bc.fournisseurEmail}</div>}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge className={`text-xs font-normal ${STATUS_COLORS[bc.status] || ""}`}>{STATUS_LABELS[bc.status] || bc.status}</Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs">{fmtDate(bc.expectedDelivery)}</TableCell>
                <TableCell className="text-right font-semibold text-sm">{fmt(bc.totalAmount)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right text-xs text-muted-foreground">{fmtDate(bc.createdAt)}</TableCell>
                <TableCell onClick={e => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem asChild><a href={`${BASE}/commandes-fournisseur/${bc.id}/apercu`} target="_blank" rel="noreferrer"><Printer className="w-3 h-3 mr-2" />Aperçu / Imprimer</a></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => openEdit(bc)}><Edit className="w-3 h-3 mr-2" />Modifier</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(bc.id)}><Copy className="w-3 h-3 mr-2" />Dupliquer</DropdownMenuItem>
                      {bc.fournisseurEmail && <DropdownMenuItem onClick={() => handleSend(bc.id)}><Mail className="w-3 h-3 mr-2" />Envoyer par email</DropdownMenuItem>}
                      {bc.status === "brouillon" && <DropdownMenuItem onClick={() => handleStatus(bc.id, "envoye")}><Mail className="w-3 h-3 mr-2" />Marquer envoyé</DropdownMenuItem>}
                      {bc.status === "envoye" && <DropdownMenuItem onClick={() => handleStatus(bc.id, "confirme")}><Check className="w-3 h-3 mr-2" />Marquer confirmé</DropdownMenuItem>}
                      {bc.status === "confirme" && <DropdownMenuItem onClick={() => handleStatus(bc.id, "recu")}><Truck className="w-3 h-3 mr-2" />Marquer reçu</DropdownMenuItem>}
                      {!["recu", "annule"].includes(bc.status) && <DropdownMenuItem onClick={() => handleStatus(bc.id, "annule")}><X className="w-3 h-3 mr-2" />Annuler</DropdownMenuItem>}
                      <DropdownMenuItem className="text-indigo-600" onClick={async () => {
                        const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: `Projet - ${bc.fournisseurName || bc.reference || "Fournisseur"}`, clientName: bc.fournisseurName || "", status: "planifie", priority: "moyenne", progress: 0, notes: `Créé depuis la commande fournisseur ${bc.reference}` }) });
                        if (res.ok) { toast({ title: "Projet créé" }); setLocation("/projets"); }
                        else toast({ title: "Erreur", variant: "destructive" });
                      }}><FolderKanban className="w-3 h-3 mr-2" />Créer un projet</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(bc.id)}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} résultats</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Précédent</Button>
            <span className="py-1.5 px-3 border rounded-md text-xs">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Suivant</Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Modifier BC ${editing.reference}` : "Nouveau Bon de Commande"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Fournisseur *</Label>
                <Input value={form.fournisseurName} onChange={e => setForm(f => ({ ...f, fournisseurName: e.target.value }))} placeholder="Nom du fournisseur" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email fournisseur</Label>
                <Input type="email" value={form.fournisseurEmail} onChange={e => setForm(f => ({ ...f, fournisseurEmail: e.target.value }))} placeholder="email@fournisseur.com" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Téléphone</Label>
                <Input value={form.fournisseurPhone} onChange={e => setForm(f => ({ ...f, fournisseurPhone: e.target.value }))} placeholder="+33..." />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Adresse fournisseur</Label>
                <Input value={form.fournisseurAddress} onChange={e => setForm(f => ({ ...f, fournisseurAddress: e.target.value }))} placeholder="Adresse complète" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date de livraison souhaitée</Label>
                <Input type="date" value={form.expectedDelivery} onChange={e => setForm(f => ({ ...f, expectedDelivery: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Devise</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["EUR", "USD", "GBP", "CHF", "CAD", "MAD", "DZD", "TND"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Lignes de commande</Label>
              <div className="border rounded-lg p-3 bg-muted/20">
                <ItemsEditor items={form.items} onChange={items => setForm(f => ({ ...f, items }))} />
              </div>
              <div className="flex justify-end">
                <div className="text-sm space-y-1 min-w-48">
                  <div className="flex justify-between gap-4 text-muted-foreground"><span>Sous-total HT</span><span>{fmt(totals.subtotal)}</span></div>
                  <div className="flex justify-between gap-4 text-muted-foreground"><span>TVA</span><span>{fmt(totals.taxAmount)}</span></div>
                  <div className="flex justify-between gap-4 font-bold border-t pt-1"><span>Total TTC</span><span>{fmt(totals.subtotal + totals.taxAmount)}</span></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Notes internes</Label>
                <Textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Conditions</Label>
                <Textarea rows={3} value={form.conditions} onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))} placeholder="Conditions de commande..." />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave}>{editing ? "Enregistrer" : "Créer le BC"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
