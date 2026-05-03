import { useState, useEffect, useCallback } from "react";
import { FileText, Search, Plus, MoreHorizontal, Loader2, Trash2, Edit, ChevronLeft, ChevronRight, RefreshCw, Check, X, Send, ArrowRightLeft, Mail, Printer, Download } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  brouillon: { label: "Brouillon", color: "bg-slate-100 text-slate-600" },
  envoye: { label: "Envoyé", color: "bg-blue-100 text-blue-700" },
  accepte: { label: "Accepté", color: "bg-emerald-100 text-emerald-700" },
  refuse: { label: "Refusé", color: "bg-red-100 text-red-700" },
  expire: { label: "Expiré", color: "bg-amber-100 text-amber-700" },
};

function fmtEur(v: any) {
  if (!v) return "0,00 €";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v));
}
function fmtDate(d: any) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return "—"; }
}

interface LineItem { description: string; quantity: number; unitPrice: number; taxRate: number; total: number; }
interface Devis {
  id: number; reference: string; title: string; clientName: string; clientEmail?: string;
  clientCompany?: string; items: LineItem[]; subtotal: string; taxAmount: string; totalAmount: string;
  currency: string; status: string; validUntil?: string; notes?: string; conditions?: string;
  acceptedAt?: string; rejectedAt?: string; convertedToInvoice?: number; createdAt: string;
}

const EMPTY_ITEM: LineItem = { description: "", quantity: 1, unitPrice: 0, taxRate: 20, total: 0 };
const EMPTY_FORM = { title: "", clientName: "", clientEmail: "", clientPhone: "", clientAddress: "", clientCompany: "", status: "brouillon", validUntil: "", notes: "", conditions: "Paiement à 30 jours. TVA applicable selon la législation en vigueur." };

export default function DevisPage() {
  const { toast } = useToast();
  const [devis, setDevis] = useState<Devis[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);

  const calcItems = (its: LineItem[]) => its.map(it => ({
    ...it,
    total: parseFloat(((it.quantity || 0) * (it.unitPrice || 0)).toFixed(2)),
  }));

  const totals = calcItems(items).reduce((acc, it) => {
    const lineTotal = it.total;
    const tax = lineTotal * (it.taxRate / 100);
    return { subtotal: acc.subtotal + lineTotal, taxAmount: acc.taxAmount + tax, total: acc.total + lineTotal + tax };
  }, { subtotal: 0, taxAmount: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sortBy: "createdAt", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}/api/devis?${params}`, { credentials: "include" }),
        fetch(`${BASE}/api/devis/stats`, { credentials: "include" }),
      ]);
      if (r1.ok) { const d = await r1.json(); setDevis(d.devis || []); setTotal(d.total || 0); }
      if (r2.ok) setStats(await r2.json());
    } catch { toast({ title: "Erreur", description: "Chargement echoue.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setItems([{ ...EMPTY_ITEM }]); setDialogOpen(true); };
  const openEdit = (d: Devis) => {
    setEditingId(d.id);
    setForm({ title: d.title, clientName: d.clientName, clientEmail: d.clientEmail || "", clientPhone: "", clientAddress: "", clientCompany: d.clientCompany || "", status: d.status, validUntil: d.validUntil ? d.validUntil.substring(0, 10) : "", notes: d.notes || "", conditions: d.conditions || "" });
    setItems(d.items?.length ? d.items : [{ ...EMPTY_ITEM }]);
    setDialogOpen(true);
  };

  const updateItem = (i: number, field: keyof LineItem, val: any) => {
    setItems(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: val }; return n; });
  };
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    if (!form.clientName.trim()) { toast({ title: "Nom client requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/devis/${editingId}` : `${BASE}/api/devis`;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...form, items: calcItems(items) }) });
      if (res.ok) { toast({ title: editingId ? "Devis mis a jour" : "Devis cree" }); setDialogOpen(false); load(); }
      else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleStatus = async (id: number, status: string) => {
    const res = await fetch(`${BASE}/api/devis/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    if (res.ok) { toast({ title: "Statut mis a jour" }); load(); }
  };

  const handleSendEmail = async (id: number) => {
    const res = await fetch(`${BASE}/api/devis/${id}/send`, { method: "POST", credentials: "include" });
    const d = await res.json();
    if (res.ok) { toast({ title: "Devis envoyé", description: d.message }); load(); }
    else { toast({ title: "Erreur d'envoi", description: d.error, variant: "destructive" }); }
  };

  const handleDuplicate = async (id: number) => {
    const res = await fetch(`${BASE}/api/devis/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Devis dupliqué", description: "Une copie brouillon a été créée." }); load(); }
    else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
  };

  const handleConvert = async (id: number) => {
    const res = await fetch(`${BASE}/api/devis/${id}/convert`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Devis converti en facture" }); load(); }
    else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer ce devis ?")) return;
    const res = await fetch(`${BASE}/api/devis/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Devis supprime" }); load(); }
  };

  const toggleSelect = (id: number) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleAll = () => setSelectedIds(prev => prev.length === devis.length ? [] : devis.map(d => d.id));
  const handleBulkDelete = async () => {
    if (!selectedIds.length || !confirm(`Supprimer ${selectedIds.length} devis ?`)) return;
    const res = await fetch(`${BASE}/api/bulk/devis/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: `${selectedIds.length} devis supprimé(s)` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkStatus = async (status: string) => {
    if (!selectedIds.length) return;
    const res = await fetch(`${BASE}/api/bulk/devis/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, status }) });
    if (res.ok) { toast({ title: `${selectedIds.length} devis mis à jour` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={FileText} variant="slate" size="md" /> Devis & Propositions
          </h1>
          <p className="text-muted-foreground">Créez, envoyez et suivez vos propositions commerciales.</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nouveau devis</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Montant accepté</p><p className="text-2xl font-bold text-emerald-600">{fmtEur(stats.amountAccepte)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Envoyés</p><p className="text-2xl font-bold text-blue-600">{stats.envoye}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Acceptés</p><p className="text-2xl font-bold text-emerald-600">{stats.accepte}</p></CardContent></Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous</SelectItem>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
        <a href={`${BASE}/api/devis/export/csv`} download><Button variant="outline" size="icon" title="Exporter CSV"><Download className="w-4 h-4" /></Button></a>
        <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/60 border rounded-lg flex-wrap">
          <span className="text-sm font-medium">{selectedIds.length} sélectionné(s)</span>
          <Select onValueChange={handleBulkStatus}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Changer statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="brouillon">Brouillon</SelectItem>
              <SelectItem value="envoye">Envoyé</SelectItem>
              <SelectItem value="accepte">Accepté</SelectItem>
              <SelectItem value="refuse">Refusé</SelectItem>
              <SelectItem value="expire">Expiré</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="destructive" onClick={handleBulkDelete}><Trash2 className="w-3 h-3 mr-1" />Supprimer la sélection</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Annuler</Button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={devis.length > 0 && selectedIds.length === devis.length} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>Titre</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Montant TTC</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Validité</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devis.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Aucun devis trouvé.</TableCell></TableRow>}
              {devis.map(d => {
                const sc = STATUS_CFG[d.status] || STATUS_CFG.brouillon;
                return (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-muted/20" onClick={() => openEdit(d)}>
                    <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedIds.includes(d.id)} onCheckedChange={() => toggleSelect(d.id)} /></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{d.reference}</TableCell>
                    <TableCell className="font-medium text-sm">{d.title}</TableCell>
                    <TableCell className="text-sm"><div>{d.clientName}</div>{d.clientCompany && <div className="text-xs text-muted-foreground">{d.clientCompany}</div>}</TableCell>
                    <TableCell className="text-right font-bold">{fmtEur(d.totalAmount)}</TableCell>
                    <TableCell><Badge className={`${sc.color} border-0 text-xs`}>{sc.label}</Badge></TableCell>
                    <TableCell className="text-sm">{fmtDate(d.validUntil)}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openEdit(d)}><Edit className="w-3 h-3 mr-2" />Modifier</DropdownMenuItem>
                          <DropdownMenuItem asChild><a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/devis/${d.id}/apercu`} target="_blank" rel="noopener noreferrer" className="flex items-center"><Printer className="w-3 h-3 mr-2" />Aperçu / Imprimer</a></DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(d.id)}><Download className="w-3 h-3 mr-2" />Dupliquer</DropdownMenuItem>
                          {d.clientEmail && <DropdownMenuItem onClick={() => handleSendEmail(d.id)}><Mail className="w-3 h-3 mr-2" />Envoyer par email</DropdownMenuItem>}
                          {d.status === "brouillon" && <DropdownMenuItem onClick={() => handleStatus(d.id, "envoye")}><Send className="w-3 h-3 mr-2" />Marquer envoyé</DropdownMenuItem>}
                          {d.status === "envoye" && <DropdownMenuItem onClick={() => handleStatus(d.id, "accepte")}><Check className="w-3 h-3 mr-2" />Marquer accepté</DropdownMenuItem>}
                          {d.status === "envoye" && <DropdownMenuItem onClick={() => handleStatus(d.id, "refuse")}><X className="w-3 h-3 mr-2" />Marquer refusé</DropdownMenuItem>}
                          {d.status === "accepte" && !d.convertedToInvoice && <DropdownMenuItem onClick={() => handleConvert(d.id)}><ArrowRightLeft className="w-3 h-3 mr-2" />Convertir en facture</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(d.id)}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-muted-foreground">{total} devis</p>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Modifier le devis" : "Nouveau devis"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label className="text-xs">Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Proposition commerciale..." /></div>
              <div><Label className="text-xs">Client *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">Entreprise</Label><Input value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
              <div><Label className="text-xs">Validité jusqu'au</Label><Input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Lignes</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="w-3 h-3 mr-1" />Ajouter</Button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-1 text-xs text-muted-foreground px-1">
                  <div className="col-span-5">Description</div><div className="col-span-2 text-right">Qté</div><div className="col-span-2 text-right">P.U. HT</div><div className="col-span-2 text-right">TVA %</div><div className="col-span-1"></div>
                </div>
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center">
                    <div className="col-span-5"><Input value={it.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder="Description..." className="text-xs h-8" /></div>
                    <div className="col-span-2"><Input type="number" min="0" step="0.01" value={it.quantity} onChange={e => updateItem(i, "quantity", parseFloat(e.target.value) || 0)} className="text-xs h-8 text-right" /></div>
                    <div className="col-span-2"><Input type="number" min="0" step="0.01" value={it.unitPrice} onChange={e => updateItem(i, "unitPrice", parseFloat(e.target.value) || 0)} className="text-xs h-8 text-right" /></div>
                    <div className="col-span-2"><Input type="number" min="0" max="100" value={it.taxRate} onChange={e => updateItem(i, "taxRate", parseFloat(e.target.value) || 0)} className="text-xs h-8 text-right" /></div>
                    <div className="col-span-1 flex justify-end"><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => removeItem(i)} disabled={items.length === 1}><X className="w-3 h-3" /></Button></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 text-sm text-right border-t pt-2">
                <p>HT : <strong>{fmtEur(totals.subtotal)}</strong></p>
                <p>TVA : <strong>{fmtEur(totals.taxAmount)}</strong></p>
                <p className="font-bold text-base">TTC : {fmtEur(totals.total)}</p>
              </div>
            </div>

            <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div><Label className="text-xs">Conditions générales</Label><Textarea value={form.conditions} onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))} rows={2} /></div>
            <div><Label className="text-xs">Statut</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
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
