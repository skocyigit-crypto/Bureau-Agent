import { useState, useEffect, useCallback } from "react";
import { Receipt, Search, Plus, MoreHorizontal, Loader2, Trash2, Edit, ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, CheckCircle2, X, Mail, Printer, Download } from "lucide-react";
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
  emise: { label: "Émise", color: "bg-blue-100 text-blue-700" },
  partiellement_payee: { label: "Part. payée", color: "bg-amber-100 text-amber-700" },
  payee: { label: "Payée", color: "bg-emerald-100 text-emerald-700" },
  en_retard: { label: "En retard", color: "bg-red-100 text-red-700" },
  annulee: { label: "Annulée", color: "bg-slate-100 text-slate-500" },
};

const PAYMENT_METHODS = ["virement", "cheque", "carte", "especes", "prelevement", "autre"];

function fmtEur(v: any) {
  if (!v) return "0,00 €";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v));
}
function fmtDate(d: any) {
  if (!d) return "—";
  try { return format(new Date(d), "dd/MM/yyyy", { locale: fr }); } catch { return "—"; }
}

interface LineItem { description: string; quantity: number; unitPrice: number; taxRate: number; total: number; }
interface Facture {
  id: number; reference: string; title: string; clientName: string; clientEmail?: string;
  clientCompany?: string; items: LineItem[]; subtotal: string; taxAmount: string; totalAmount: string;
  paidAmount: string; currency: string; status: string; dueDate?: string; paidAt?: string;
  paymentMethod?: string; notes?: string; isOverdue?: boolean; remainingAmount?: number; createdAt: string;
}

const EMPTY_ITEM: LineItem = { description: "", quantity: 1, unitPrice: 0, taxRate: 20, total: 0 };
const EMPTY_FORM = { title: "", clientName: "", clientEmail: "", clientPhone: "", clientAddress: "", clientCompany: "", status: "emise", dueDate: "", paymentMethod: "", notes: "" };

export default function FacturesClientPage() {
  const { toast } = useToast();
  const [factures, setFactures] = useState<Facture[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Facture | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("virement");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);

  const calcItems = (its: LineItem[]) => its.map(it => ({ ...it, total: parseFloat(((it.quantity || 0) * (it.unitPrice || 0)).toFixed(2)) }));
  const totals = calcItems(items).reduce((acc, it) => {
    const tax = it.total * (it.taxRate / 100);
    return { subtotal: acc.subtotal + it.total, taxAmount: acc.taxAmount + tax, total: acc.total + it.total + tax };
  }, { subtotal: 0, taxAmount: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sortBy: "createdAt", sortOrder: "desc" });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (overdueOnly) params.set("overdue", "true");
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}/api/factures-client?${params}`, { credentials: "include" }),
        fetch(`${BASE}/api/factures-client/stats`, { credentials: "include" }),
      ]);
      if (r1.ok) { const d = await r1.json(); setFactures(d.factures || []); setTotal(d.total || 0); }
      if (r2.ok) setStats(await r2.json());
    } catch { toast({ title: "Erreur", description: "Chargement echoue.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, overdueOnly, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, statusFilter, overdueOnly]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setItems([{ ...EMPTY_ITEM }]); setDialogOpen(true); };
  const openEdit = (f: Facture) => {
    setEditingId(f.id);
    setForm({ title: f.title, clientName: f.clientName, clientEmail: f.clientEmail || "", clientPhone: "", clientAddress: "", clientCompany: f.clientCompany || "", status: f.status, dueDate: f.dueDate ? f.dueDate.substring(0, 10) : "", paymentMethod: f.paymentMethod || "", notes: f.notes || "" });
    setItems(f.items?.length ? f.items : [{ ...EMPTY_ITEM }]);
    setDialogOpen(true);
  };
  const openPay = (f: Facture) => { setPayTarget(f); setPayAmount(String(f.remainingAmount || "")); setPayMethod("virement"); setPayDialogOpen(true); };

  const updateItem = (i: number, field: keyof LineItem, val: any) => setItems(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: val }; return n; });
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    if (!form.clientName.trim()) { toast({ title: "Nom client requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/factures-client/${editingId}` : `${BASE}/api/factures-client`;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...form, items: calcItems(items) }) });
      if (res.ok) { toast({ title: editingId ? "Facture mise a jour" : "Facture creee" }); setDialogOpen(false); load(); }
      else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handlePay = async () => {
    if (!payTarget || !payAmount) return;
    setPaying(true);
    try {
      const newPaid = Math.min(parseFloat(payTarget.totalAmount), (parseFloat(payTarget.paidAmount || "0") + parseFloat(payAmount)));
      const res = await fetch(`${BASE}/api/factures-client/${payTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ paidAmount: newPaid, paymentMethod: payMethod }) });
      if (res.ok) { toast({ title: "Paiement enregistre" }); setPayDialogOpen(false); load(); }
      else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setPaying(false); }
  };

  const handleStatus = async (id: number, status: string) => {
    const res = await fetch(`${BASE}/api/factures-client/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    if (res.ok) { toast({ title: "Statut mis a jour" }); load(); }
  };

  const handleSendEmail = async (id: number) => {
    const res = await fetch(`${BASE}/api/factures-client/${id}/send`, { method: "POST", credentials: "include" });
    const d = await res.json();
    if (res.ok) { toast({ title: "Facture envoyée", description: d.message }); load(); }
    else { toast({ title: "Erreur d'envoi", description: d.error, variant: "destructive" }); }
  };

  const handleDuplicate = async (id: number) => {
    const res = await fetch(`${BASE}/api/factures-client/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Facture dupliquée", description: "Une copie brouillon a été créée." }); load(); }
    else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer cette facture ?")) return;
    const res = await fetch(`${BASE}/api/factures-client/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Facture supprimee" }); load(); }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={Receipt} variant="emerald" size="md" /> Factures Clients
          </h1>
          <p className="text-muted-foreground">Suivi de la facturation, paiements et créances.</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nouvelle facture</Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Total facturé</p><p className="text-2xl font-bold">{fmtEur(stats.totalAmount)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Encaissé</p><p className="text-2xl font-bold text-emerald-600">{fmtEur(stats.totalPaid)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" />En retard</p><p className="text-2xl font-bold text-red-600">{fmtEur(stats.amountEnRetard)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Factures payées</p><p className="text-2xl font-bold text-emerald-600">{stats.payee}</p></CardContent></Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous</SelectItem>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant={overdueOnly ? "default" : "outline"} size="sm" className="gap-1" onClick={() => setOverdueOnly(v => !v)}><AlertTriangle className="w-3 h-3" />En retard</Button>
        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
        <a href={`${BASE}/api/factures-client/export/csv`} download><Button variant="outline" size="icon" title="Exporter CSV"><Download className="w-4 h-4" /></Button></a>
        <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
      </div>

      <Card>
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Total TTC</TableHead>
                <TableHead className="text-right">Payé</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factures.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Aucune facture trouvée.</TableCell></TableRow>}
              {factures.map(f => {
                const sc = f.isOverdue && !["payee", "annulee"].includes(f.status) ? STATUS_CFG.en_retard : STATUS_CFG[f.status] || STATUS_CFG.emise;
                return (
                  <TableRow key={f.id} className={`cursor-pointer hover:bg-muted/20 ${f.isOverdue && !["payee", "annulee"].includes(f.status) ? "bg-red-50/30 dark:bg-red-950/10" : ""}`} onClick={() => openEdit(f)}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{f.reference}</TableCell>
                    <TableCell className="text-sm"><div className="font-medium">{f.clientName}</div>{f.clientCompany && <div className="text-xs text-muted-foreground">{f.clientCompany}</div>}</TableCell>
                    <TableCell className="text-right font-bold">{fmtEur(f.totalAmount)}</TableCell>
                    <TableCell className="text-right text-emerald-600">{fmtEur(f.paidAmount)}</TableCell>
                    <TableCell><Badge className={`${sc.color} border-0 text-xs`}>{sc.label}</Badge></TableCell>
                    <TableCell className={`text-sm ${f.isOverdue && !["payee", "annulee"].includes(f.status) ? "text-red-600 font-medium" : ""}`}>{fmtDate(f.dueDate)}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openEdit(f)}><Edit className="w-3 h-3 mr-2" />Modifier</DropdownMenuItem>
                          <DropdownMenuItem asChild><a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/factures-client/${f.id}/apercu`} target="_blank" rel="noopener noreferrer" className="flex items-center"><Printer className="w-3 h-3 mr-2" />Aperçu / Imprimer</a></DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(f.id)}><Download className="w-3 h-3 mr-2" />Dupliquer</DropdownMenuItem>
                          {f.clientEmail && <DropdownMenuItem onClick={() => handleSendEmail(f.id)}><Mail className="w-3 h-3 mr-2" />Envoyer par email</DropdownMenuItem>}
                          {!["payee", "annulee"].includes(f.status) && <DropdownMenuItem onClick={() => openPay(f)}><CheckCircle2 className="w-3 h-3 mr-2" />Enregistrer paiement</DropdownMenuItem>}
                          {f.status === "emise" && <DropdownMenuItem onClick={() => handleStatus(f.id, "annulee")}><X className="w-3 h-3 mr-2" />Annuler</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(f.id)}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
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
            <p className="text-sm text-muted-foreground">{total} facture{total !== 1 ? "s" : ""}</p>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Modifier la facture" : "Nouvelle facture"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label className="text-xs">Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Facture de prestation..." /></div>
              <div><Label className="text-xs">Client *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">Entreprise</Label><Input value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
              <div><Label className="text-xs">Date d'échéance</Label><Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2"><Label className="text-xs">Lignes de facturation</Label><Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="w-3 h-3 mr-1" />Ajouter</Button></div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-1 text-xs text-muted-foreground px-1"><div className="col-span-5">Description</div><div className="col-span-2 text-right">Qté</div><div className="col-span-2 text-right">P.U. HT</div><div className="col-span-2 text-right">TVA %</div><div className="col-span-1"></div></div>
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center">
                    <div className="col-span-5"><Input value={it.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder="Service..." className="text-xs h-8" /></div>
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

            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Mode de paiement</Label>
                <Select value={form.paymentMethod} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                  <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Statut</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editingId ? "Mettre à jour" : "Créer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Enregistrer un paiement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Facture : <strong>{payTarget?.reference}</strong> — {payTarget?.clientName}</p>
            <p className="text-sm">Restant dû : <strong className="text-red-600">{fmtEur(payTarget?.remainingAmount)}</strong></p>
            <div><Label className="text-xs">Montant reçu (€) *</Label><Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
            <div><Label className="text-xs">Mode de paiement</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>Annuler</Button>
            <Button onClick={handlePay} disabled={paying}>{paying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
