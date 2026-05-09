import { useState, useEffect, useCallback } from "react";
import { Receipt, Search, Plus, Loader2, Trash2, Edit, MoreHorizontal } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { GhostTextarea } from "@/components/ghost-textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STATUSES = [
  { key: "brouillon", label: "Brouillon", color: "bg-slate-100 text-slate-600" },
  { key: "envoyee", label: "Envoyée", color: "bg-blue-100 text-blue-700" },
  { key: "partiellement_payee", label: "Partiellement payée", color: "bg-amber-100 text-amber-700" },
  { key: "payee", label: "Payée", color: "bg-emerald-100 text-emerald-700" },
  { key: "en_retard", label: "En retard", color: "bg-red-100 text-red-700" },
  { key: "annulee", label: "Annulée", color: "bg-slate-100 text-slate-500" },
] as const;

interface Facture {
  id: number;
  reference: string;
  title: string;
  clientName: string;
  clientCompany?: string | null;
  totalAmount: string;
  paidAmount: string;
  currency: string;
  status: string;
  dueDate?: string | null;
  notes?: string | null;
  conditions?: string | null;
  createdAt: string;
}

const EMPTY_FORM = {
  reference: "",
  title: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  clientCompany: "",
  totalAmount: "0",
  paidAmount: "0",
  status: "brouillon",
  dueDate: "",
  paymentMethod: "",
  notes: "",
  conditions: "",
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find(x => x.key === status) || STATUSES[0];
  return <Badge className={`${s.color} border-0 text-xs`}>{s.label}</Badge>;
}

function fmtMoney(v: string | number, c = "EUR") {
  const n = typeof v === "number" ? v : parseFloat(v || "0");
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
}

export default function FacturesClientPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<Facture[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`${BASE}/api/factures-client?${params}`, { credentials: "include" });
      if (res.ok) { const d = await res.json(); setRows(d.factures || []); setTotal(d.total || 0); }
    } catch { toast({ title: "Erreur", description: "Chargement échoué.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = async (f: Facture) => {
    setEditingId(f.id);
    setForm({ ...EMPTY_FORM, reference: f.reference, title: f.title, clientName: f.clientName, status: f.status });
    setDialogOpen(true);
    try {
      const res = await fetch(`${BASE}/api/factures-client/${f.id}`, { credentials: "include" });
      if (!res.ok) return;
      const full = await res.json();
      setForm({
        reference: full.reference || "",
        title: full.title || "",
        clientName: full.clientName || "",
        clientEmail: full.clientEmail || "",
        clientPhone: full.clientPhone || "",
        clientCompany: full.clientCompany || "",
        totalAmount: String(full.totalAmount || "0"),
        paidAmount: String(full.paidAmount || "0"),
        status: full.status || "brouillon",
        dueDate: full.dueDate ? String(full.dueDate).slice(0, 10) : "",
        paymentMethod: full.paymentMethod || "",
        notes: full.notes || "",
        conditions: full.conditions || "",
      });
    } catch { /* keep partial form */ }
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.clientName.trim()) {
      toast({ title: "Champs requis", description: "Titre et client sont obligatoires.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/factures-client/${editingId}` : `${BASE}/api/factures-client`;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("save failed");
      toast({ title: editingId ? "Facture mise à jour" : "Facture créée" });
      setDialogOpen(false);
      load();
    } catch { toast({ title: "Erreur", description: "Échec de l'enregistrement.", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer cette facture ?")) return;
    try {
      const res = await fetch(`${BASE}/api/factures-client/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      toast({ title: "Facture supprimée" });
      load();
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="w-6 h-6 text-purple-500" />Factures clients</h1>
          <p className="text-sm text-muted-foreground">Suivi de la facturation et des règlements.</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Nouvelle facture</Button>
      </div>

      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher (référence, titre, client)..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>Aucune facture pour l'instant.</p>
        </Card>
      ) : (
        <Card className="divide-y">
          {rows.map(f => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">{f.reference}</span>
                  <p className="text-sm font-medium truncate">{f.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">{[f.clientName, f.clientCompany].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="text-sm font-semibold">{fmtMoney(f.totalAmount, f.currency)}</span>
              <StatusBadge status={f.status} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(f)}><Edit className="w-3 h-3 mr-2" />Modifier</DropdownMenuItem>
                  <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(f.id)}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted-foreground">{total} facture{total !== 1 ? "s" : ""}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Précédent</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Suivant</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="text-xs text-muted-foreground">
        <button onClick={() => setLocation("/devis")} className="underline">Voir les devis →</button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier la facture" : "Nouvelle facture"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Référence</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="FAC-2026-001" /></div>
              <div>
                <Label className="text-xs">Statut</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Prestation de service" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Client *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">Entreprise</Label><Input value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
              <div><Label className="text-xs">Téléphone</Label><Input value={form.clientPhone} onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Montant total (€)</Label><Input type="number" step="0.01" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} /></div>
              <div><Label className="text-xs">Payé (€)</Label><Input type="number" step="0.01" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} /></div>
              <div><Label className="text-xs">Échéance</Label><Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Mode de paiement</Label><Input value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} placeholder="Virement, carte, chèque..." /></div>
            <div>
              <Label className="text-xs">Commentaire / notes</Label>
              <GhostTextarea
                fieldType="invoice_comment"
                context={{ title: `${form.reference || "Facture"} — ${form.title}`, contactName: [form.clientName, form.clientCompany].filter(Boolean).join(" · ") }}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder="Référence de commande, remerciements, mention de paiement..."
              />
            </div>
            <div>
              <Label className="text-xs">Conditions de règlement</Label>
              <GhostTextarea
                fieldType="invoice_comment"
                context={{ title: `${form.reference || "Facture"} — ${form.title}`, contactName: [form.clientName, form.clientCompany].filter(Boolean).join(" · ") }}
                value={form.conditions}
                onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))}
                rows={3}
                placeholder="Modalités de paiement, pénalités de retard..."
              />
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
