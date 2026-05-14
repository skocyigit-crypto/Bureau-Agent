import { useState, useEffect, useCallback } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { useWorkspaceUser } from "@/components/workspace-user";
import { AccessDenied } from "@/components/access-denied";
import { FileText, Search, Plus, Loader2, Trash2, Edit, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STATUSES = [
  { key: "brouillon", label: "Brouillon", color: "bg-slate-100 text-slate-600" },
  { key: "envoye", label: "Envoyé", color: "bg-blue-100 text-blue-700" },
  { key: "accepte", label: "Accepté", color: "bg-emerald-100 text-emerald-700" },
  { key: "refuse", label: "Refusé", color: "bg-red-100 text-red-700" },
  { key: "expire", label: "Expiré", color: "bg-amber-100 text-amber-700" },
] as const;

interface Devis {
  id: number; reference: string; title: string; clientName: string; clientEmail?: string;
  clientCompany?: string; status: string; totalAmount?: string; currency: string;
  validUntil?: string; createdAt: string; organisationId?: number | null;
}

interface OrgOption { id: number; name: string }

const EMPTY_FORM = {
  reference: "", title: "", clientName: "", clientEmail: "", clientCompany: "",
  totalAmount: "", currency: "EUR", status: "brouillon", validUntil: "", notes: "",
  organisationId: "",
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find(x => x.key === status) || STATUSES[0];
  return <Badge className={`${s.color} border-0 text-xs`}>{s.label}</Badge>;
}

function fmtMoney(v: string | number | null | undefined, currency = "EUR") {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return String(v);
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(v);
  }
}

export default function AdminDevisPage() {
  const { user } = useWorkspaceUser();
  if (user.role !== "super_admin") return <AccessDenied />;
  const { toast } = useToast();
  const [items, setItems] = useState<Devis[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orgFilter, setOrgFilter] = useState("all");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const orgNameById = new Map(orgs.map(o => [o.id, o.name] as const));
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
      if (orgFilter !== "all") params.set("organisationId", orgFilter);
      const res = await fetch(`${BASE}/api/devis?${params}`, { credentials: "include" });
      if (res.ok) { const d = await res.json(); setItems(d.devis || []); setTotal(d.total || 0); }
    } catch { toast({ title: "Erreur", description: "Chargement échoué.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, orgFilter, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, statusFilter, orgFilter]);

  useEffect(() => {
    fetch(`${BASE}/api/organisations`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { organisations: [] })
      .then((d: { organisations?: OrgOption[] }) => setOrgs((d.organisations || []).map(o => ({ id: o.id, name: o.name }))))
      .catch(() => { /* non-bloquant */ });
  }, []);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = (d: Devis) => {
    setEditingId(d.id);
    setForm({
      reference: d.reference || "", title: d.title, clientName: d.clientName || "",
      clientEmail: d.clientEmail || "", clientCompany: d.clientCompany || "",
      totalAmount: d.totalAmount || "", currency: d.currency || "EUR", status: d.status,
      validUntil: d.validUntil ? d.validUntil.substring(0, 10) : "", notes: "",
      organisationId: d.organisationId != null ? String(d.organisationId) : "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    if (!form.clientName.trim()) { toast({ title: "Client requis", variant: "destructive" }); return; }
    if (!editingId && !form.organisationId) { toast({ title: "Organisation cible requise", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/devis/${editingId}` : `${BASE}/api/devis`;
      const method = editingId ? "PATCH" : "POST";
      const { organisationId: orgIdStr, ...rest } = form;
      const payload: Record<string, unknown> = { ...rest, totalAmount: form.totalAmount || null };
      if (orgIdStr) payload.organisationId = Number(orgIdStr);
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      if (res.ok) {
        toast({ title: editingId ? "Devis mis à jour" : "Devis créé" });
        setDialogOpen(false); load();
      } else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", description: "Sauvegarde échouée.", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmAction({ title: "Supprimer ce devis ?", confirmLabel: "Supprimer", destructive: true }))) return;
    const res = await fetch(`${BASE}/api/devis/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Devis supprimé" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary" /> Devis kurumsal
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              <Shield className="w-3 h-3 mr-1" /> Super-admin
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">Vue globale SaaS — propositions commerciales B2B toutes organisations confondues.</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nouveau devis</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher (titre, référence, client)..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="w-56" data-testid="devis-org-filter"><SelectValue placeholder="Organisation" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les organisations</SelectItem>
            {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <Card>
          <div className="divide-y">
            {items.length === 0 ? (
              <p className="text-center text-muted-foreground py-12" data-testid="no-results-devis">Aucun devis ne correspond à vos filtres.</p>
            ) : items.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[d.reference, d.clientCompany || d.clientName].filter(Boolean).join(" · ")}
                    {" · "}
                    {format(new Date(d.createdAt), "dd MMM yyyy", { locale: fr })}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] hidden md:inline-flex" data-testid={`devis-org-${d.id}`}>
                  {d.organisationId != null ? (orgNameById.get(d.organisationId) || `Org #${d.organisationId}`) : "—"}
                </Badge>
                <StatusBadge status={d.status} />
                <span className="text-sm font-bold text-emerald-600 hidden md:block w-24 text-right">{fmtMoney(d.totalAmount, d.currency)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)}><Edit className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(d.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">{total} devis</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Précédent</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Suivant</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le devis" : "Nouveau devis"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Organisation cible {editingId ? "" : "*"}</Label>
              <Select
                value={form.organisationId}
                onValueChange={v => setForm(f => ({ ...f, organisationId: v }))}
                disabled={editingId !== null}
              >
                <SelectTrigger data-testid="devis-form-org"><SelectValue placeholder="Choisir une organisation" /></SelectTrigger>
                <SelectContent>
                  {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {editingId
                  ? "L'organisation propriétaire ne peut pas être réassignée depuis cette fiche."
                  : "Le devis sera rattaché à cette organisation."}
              </p>
            </div>
            <div><Label className="text-xs">Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Référence</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="DEV-..." /></div>
              <div><Label className="text-xs">Statut</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Client *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">Société</Label><Input value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
              <div><Label className="text-xs">Montant total</Label><Input type="number" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} placeholder="0" /></div>
            </div>
            <div><Label className="text-xs">Valable jusqu'au</Label><Input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} /></div>
            <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
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
