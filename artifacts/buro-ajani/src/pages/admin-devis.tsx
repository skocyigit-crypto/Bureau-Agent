import { LineItemsEditor,type LineItem } from "@/components/line-items-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight,Edit,FileText,Loader2,Plus,RefreshCw,Search,Shield,Trash2 } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

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
  validUntil?: string; createdAt: string;
}

const EMPTY_FORM = {
  reference: "", title: "", clientName: "", clientEmail: "", clientCompany: "",
  items: [] as LineItem[], currency: "EUR", status: "brouillon", validUntil: "", notes: "",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const s = STATUSES.find(x => x.key === status) || STATUSES[0];
  return <Badge className={`${s.color} border-0 text-xs`}>{t(`adminDevis.status.${s.key}`)}</Badge>;
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

// Documents commerciaux de l'organisation connectee: le serveur borne chaque
// requete a `getOrgId(req)`, donc pas de garde super-admin ni de selecteur
// d'organisation ici.
export default function AdminDevisPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [items, setItems] = useState<Devis[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`${BASE}/api/devis?${params}`, { credentials: "include" });
      if (res.ok) { const d = await res.json(); setItems(d.devis || []); setTotal(d.total || 0); }
    } catch { toast({ title: t("adminDevis.toast.error"), description: t("adminDevis.toast.loadFailed"), variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, toast, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = (d: Devis) => {
    setEditingId(d.id);
    setForm({
      reference: d.reference || "", title: d.title, clientName: d.clientName || "",
      clientEmail: d.clientEmail || "", clientCompany: d.clientCompany || "",
      items: Array.isArray((d as any).items) ? (d as any).items : [], currency: d.currency || "EUR", status: d.status,
      validUntil: d.validUntil ? d.validUntil.substring(0, 10) : "", notes: "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: t("adminDevis.toast.titleRequired"), variant: "destructive" }); return; }
    if (!form.clientName.trim()) { toast({ title: t("adminDevis.toast.clientRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/devis/${editingId}` : `${BASE}/api/devis`;
      const method = editingId ? "PATCH" : "POST";
      // On envoie les LIGNES; le serveur calcule subtotal/TVA/total. Plus de
      // champ "montant total" saisi a la main.
      const payload: Record<string, unknown> = { ...form };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      if (res.ok) {
        toast({ title: editingId ? t("adminDevis.toast.updated") : t("adminDevis.toast.created") });
        setDialogOpen(false); load();
      } else { const d = await res.json(); toast({ title: t("adminDevis.toast.error"), description: d.error, variant: "destructive" }); }
    } catch { toast({ title: t("adminDevis.toast.error"), description: t("adminDevis.toast.saveFailed"), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleConvert = async (d: Devis) => {
    if (!(await confirmAction({ title: t("adminDevis.toast.convertConfirmTitle", { title: d.title }), description: t("adminDevis.toast.convertConfirmDesc"), confirmLabel: t("adminDevis.toast.convertConfirmLabel") }))) return;
    setConvertingId(d.id);
    try {
      const res = await fetch(`${BASE}/api/devis/${d.id}/convert-to-facture`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: data.alreadyConverted ? t("adminDevis.toast.alreadyConverted") : t("adminDevis.toast.factureCreated"), description: t("adminDevis.toast.factureRef", { reference: data.facture?.reference ?? "" }) });
        load();
      } else { toast({ title: t("adminDevis.toast.error"), description: data.error, variant: "destructive" }); }
    } catch { toast({ title: t("adminDevis.toast.error"), description: t("adminDevis.toast.conversionFailed"), variant: "destructive" }); }
    finally { setConvertingId(null); }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmAction({ title: t("adminDevis.toast.deleteConfirmTitle"), confirmLabel: t("adminDevis.toast.deleteConfirmLabel"), destructive: true }))) return;
    const res = await fetch(`${BASE}/api/devis/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("adminDevis.toast.deleted") }); load(); }
    else toast({ title: t("adminDevis.toast.error"), variant: "destructive" });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary" /> {t("adminDevis.title")}
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              <Shield className="w-3 h-3 mr-1" /> {t("adminDevis.superAdmin")}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">{t("adminDevis.subtitle")}</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> {t("adminDevis.new")}</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label={t("adminDevis.searchPlaceholder")} placeholder={t("adminDevis.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("adminDevis.statusPlaceholder")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminDevis.allStatuses")}</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{t(`adminDevis.status.${s.key}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={load} aria-label={t("common.refresh")}><RefreshCw className="w-4 h-4" aria-hidden="true" /></Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <Card>
          <div className="divide-y">
            {items.length === 0 ? (
              <p className="text-center text-muted-foreground py-12" data-testid="no-results-devis">{t("adminDevis.empty")}</p>
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
                <StatusBadge status={d.status} />
                <span className="text-sm font-bold text-emerald-600 hidden md:block w-24 text-right">{fmtMoney(d.totalAmount, d.currency)}</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-blue-600" onClick={() => handleConvert(d)} disabled={convertingId === d.id} title={t("adminDevis.convertTitle")}>
                  {convertingId === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><ArrowRight className="w-3 h-3 mr-1" />{t("adminDevis.invoice")}</>}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)} aria-label={t("common.edit")}><Edit className="w-3 h-3" aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(d.id)} aria-label={t("common.delete")}><Trash2 className="w-3 h-3" aria-hidden="true" /></Button>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">{t("adminDevis.count", { count: total })}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("adminDevis.prev")}</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{t("adminDevis.next")}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("adminDevis.dialog.editTitle") : t("adminDevis.dialog.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
            </div>
            <div><Label className="text-xs">{t("adminDevis.form.title")} *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminDevis.form.reference")}</Label><Input aria-label={t("adminDevis.form.reference")} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="DEV-..." /></div>
              <div><Label className="text-xs">{t("adminDevis.form.status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{t(`adminDevis.status.${s.key}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminDevis.form.client")} *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">{t("adminDevis.form.company")}</Label><Input aria-label={t("adminDevis.form.company")} value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminDevis.form.email")}</Label><Input aria-label={t("adminDevis.form.email")} type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
            </div>
            <LineItemsEditor items={form.items} onChange={(items) => setForm(f => ({ ...f, items }))} currency={form.currency} />
            <div><Label className="text-xs">{t("adminDevis.form.validUntil")}</Label><Input aria-label={t("adminDevis.form.validUntil")} type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} /></div>
            <div><Label className="text-xs">{t("adminDevis.form.notes")}</Label><Textarea aria-label={t("adminDevis.form.notes")} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editingId ? t("adminDevis.form.update") : t("adminDevis.form.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
