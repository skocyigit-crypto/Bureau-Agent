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
import { Edit,FileCode,FileDown,Loader2,Plus,Receipt,RefreshCw,Search,Send,Shield,Trash2 } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STATUSES = [
  { key: "brouillon", label: "Brouillon", color: "bg-slate-100 text-slate-600" },
  { key: "envoyee", label: "Envoyée", color: "bg-blue-100 text-blue-700" },
  { key: "payee", label: "Payée", color: "bg-emerald-100 text-emerald-700" },
  { key: "partiellement_payee", label: "Partiellement payée", color: "bg-teal-100 text-teal-700" },
  { key: "en_retard", label: "En retard", color: "bg-red-100 text-red-700" },
  { key: "annulee", label: "Annulée", color: "bg-amber-100 text-amber-700" },
] as const;

interface FactureClient {
  id: number; reference: string; title: string; clientName: string; clientEmail?: string;
  clientCompany?: string; status: string; totalAmount?: string; paidAmount?: string; currency: string;
  items?: LineItem[]; isAutoliquidation?: boolean;
  dueDate?: string; paymentMethod?: string; notes?: string | null; createdAt: string;
  reminderCount?: number; lastReminderAt?: string | null;
}

const EMPTY_FORM = {
  reference: "", title: "", clientName: "", clientEmail: "", clientCompany: "",
  items: [] as LineItem[], paidAmount: "", isAutoliquidation: false, currency: "EUR", status: "brouillon", dueDate: "",
  paymentMethod: "", notes: "",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const s = STATUSES.find(x => x.key === status) || STATUSES[0];
  return <Badge className={`${s.color} border-0 text-xs`}>{t(`adminFacturesClient.status.${s.key}`)}</Badge>;
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

// Une relance n'a de sens que pour une facture non réglée et avec un email client.
function canRemind(f: FactureClient): boolean {
  return !!(f.clientEmail && f.clientEmail.trim()) && f.status !== "payee" && f.status !== "annulee";
}

// Documents commerciaux de l'organisation connectee: le serveur borne chaque
// requete a `getOrgId(req)`, donc pas de garde super-admin ni de selecteur
// d'organisation ici.
export default function AdminFacturesClientPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [items, setItems] = useState<FactureClient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [remindingId, setRemindingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`${BASE}/api/factures-client?${params}`, { credentials: "include" });
      if (res.ok) { const d = await res.json(); setItems(d.factures || []); setTotal(d.total || 0); }
    } catch { toast({ title: t("adminFacturesClient.toast.error"), description: t("adminFacturesClient.toast.loadFailed"), variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, toast, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, statusFilter]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = (f: FactureClient) => {
    setEditingId(f.id);
    setForm({
      reference: f.reference || "", title: f.title, clientName: f.clientName || "",
      clientEmail: f.clientEmail || "", clientCompany: f.clientCompany || "",
      items: Array.isArray(f.items) ? f.items : [], paidAmount: f.paidAmount || "", isAutoliquidation: !!f.isAutoliquidation, currency: f.currency || "EUR",
      status: f.status, dueDate: f.dueDate ? f.dueDate.substring(0, 10) : "",
      paymentMethod: f.paymentMethod || "", notes: f.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: t("adminFacturesClient.toast.titleRequired"), variant: "destructive" }); return; }
    if (!form.clientName.trim()) { toast({ title: t("adminFacturesClient.toast.clientRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/factures-client/${editingId}` : `${BASE}/api/factures-client`;
      const method = editingId ? "PATCH" : "POST";
      const payload: Record<string, unknown> = { ...form, paidAmount: form.paidAmount || null };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      if (res.ok) {
        toast({ title: editingId ? t("adminFacturesClient.toast.updated") : t("adminFacturesClient.toast.created") });
        setDialogOpen(false); load();
      } else { const d = await res.json(); toast({ title: t("adminFacturesClient.toast.error"), description: d.error, variant: "destructive" }); }
    } catch { toast({ title: t("adminFacturesClient.toast.error"), description: t("adminFacturesClient.toast.saveFailed"), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmAction({ title: t("adminFacturesClient.toast.deleteConfirmTitle"), confirmLabel: t("adminFacturesClient.toast.deleteConfirmLabel"), destructive: true }))) return;
    const res = await fetch(`${BASE}/api/factures-client/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("adminFacturesClient.toast.deleted") }); load(); }
    else toast({ title: t("adminFacturesClient.toast.error"), variant: "destructive" });
  };

  const handleRemind = async (f: FactureClient) => {
    if (!(await confirmAction({
      title: t("adminFacturesClient.toast.remindConfirmTitle"),
      description: t("adminFacturesClient.toast.remindConfirmDesc", { email: f.clientEmail ?? "", reference: f.reference }),
      confirmLabel: t("adminFacturesClient.toast.remindConfirmLabel"),
    }))) return;
    setRemindingId(f.id);
    try {
      const res = await fetch(`${BASE}/api/factures-client/${f.id}/relance`, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { toast({ title: t("adminFacturesClient.toast.relanceSent"), description: t("adminFacturesClient.toast.relanceSentDesc", { count: String(d.reminderCount ?? "?") }) }); load(); }
      else { toast({ title: t("adminFacturesClient.toast.relanceImpossible"), description: d.error, variant: "destructive" }); }
    } catch { toast({ title: t("adminFacturesClient.toast.error"), description: t("adminFacturesClient.toast.relanceFailed"), variant: "destructive" }); }
    finally { setRemindingId(null); }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Receipt className="w-6 h-6 text-primary" /> {t("adminFacturesClient.title")}
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              <Shield className="w-3 h-3 mr-1" /> {t("adminFacturesClient.superAdmin")}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">{t("adminFacturesClient.subtitle")}</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> {t("adminFacturesClient.new")}</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t("adminFacturesClient.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("adminFacturesClient.statusPlaceholder")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminFacturesClient.allStatuses")}</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{t(`adminFacturesClient.status.${s.key}`)}</SelectItem>)}
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
              <p className="text-center text-muted-foreground py-12" data-testid="no-results-factures">{t("adminFacturesClient.empty")}</p>
            ) : items.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[f.reference, f.clientCompany || f.clientName].filter(Boolean).join(" · ")}
                    {" · "}
                    {format(new Date(f.createdAt), "dd MMM yyyy", { locale: fr })}
                    {f.dueDate ? ` · ${t("adminFacturesClient.dueLabel", { date: format(new Date(f.dueDate), "dd MMM yyyy", { locale: fr }) })}` : ""}
                    {f.reminderCount ? ` · ${t("adminFacturesClient.reminders", { count: f.reminderCount })}` : ""}
                  </p>
                </div>
                <StatusBadge status={f.status} />
                <span className="text-sm font-bold text-emerald-600 hidden md:block w-24 text-right">{fmtMoney(f.totalAmount, f.currency)}</span>
                {canRemind(f) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-blue-500"
                    title={t("adminFacturesClient.reminderTitle")}
                    disabled={remindingId === f.id}
                    onClick={() => handleRemind(f)}
                  >
                    {remindingId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t("adminFacturesClient.pdfTitle")}
                  aria-label={t("adminFacturesClient.pdfTitle")}
                  onClick={() => window.open(`${BASE}/api/factures-client/${f.id}/pdf`, "_blank", "noopener,noreferrer")}
                >
                  <FileDown className="w-3 h-3" aria-hidden="true" />
                </Button>
                {/* Le XML CII, separement du PDF.
                    Depuis le 1er septembre 2026, c'est cette forme-la que
                    reclament les plateformes de dematerialisation et Chorus
                    Pro. Le PDF l'emporte deja en piece jointe, mais l'extraire
                    a la main d'un fichier attache n'est pas une manipulation
                    qu'on peut demander a un utilisateur. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={t("adminFacturesClient.xmlTitle")}
                  aria-label={t("adminFacturesClient.xmlTitle")}
                  onClick={() => window.open(`${BASE}/api/factures-client/${f.id}/facturx.xml`, "_blank", "noopener,noreferrer")}
                >
                  <FileCode className="w-3 h-3" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)} aria-label={t("common.edit")}><Edit className="w-3 h-3" aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(f.id)} aria-label={t("common.delete")}><Trash2 className="w-3 h-3" aria-hidden="true" /></Button>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">{t("adminFacturesClient.count", { count: total })}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("adminFacturesClient.prev")}</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{t("adminFacturesClient.next")}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("adminFacturesClient.dialog.editTitle") : t("adminFacturesClient.dialog.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
            </div>
            <div><Label className="text-xs">{t("adminFacturesClient.form.title")} *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesClient.form.reference")}</Label><Input aria-label={t("adminFacturesClient.form.reference")} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="FAC-..." /></div>
              <div><Label className="text-xs">{t("adminFacturesClient.form.status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{t(`adminFacturesClient.status.${s.key}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesClient.form.client")} *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">{t("adminFacturesClient.form.company")}</Label><Input aria-label={t("adminFacturesClient.form.company")} value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesClient.form.email")}</Label><Input aria-label={t("adminFacturesClient.form.email")} type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
              <div><Label className="text-xs">{t("adminFacturesClient.form.paymentMethod")}</Label><Input aria-label={t("adminFacturesClient.form.paymentMethod")} value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} placeholder={t("adminFacturesClient.form.paymentPlaceholder")} /></div>
            </div>
            <LineItemsEditor items={form.items} onChange={(items) => setForm(f => ({ ...f, items }))} autoliquidation={form.isAutoliquidation} currency={form.currency} />
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesClient.form.paidAmount")}</Label><Input aria-label={t("adminFacturesClient.form.paidAmount")} type="number" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} placeholder="0" /></div>
              <div className="flex items-center gap-2 pt-5"><input id="autoliq" type="checkbox" checked={form.isAutoliquidation} onChange={e => setForm(f => ({ ...f, isAutoliquidation: e.target.checked }))} /><Label htmlFor="autoliq" className="text-xs">{t("adminFacturesClient.form.autoliq")}</Label></div>
            </div>
            <div><Label className="text-xs">{t("adminFacturesClient.form.dueDate")}</Label><Input aria-label={t("adminFacturesClient.form.dueDate")} type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
            <div><Label className="text-xs">{t("adminFacturesClient.form.notes")}</Label><Textarea aria-label={t("adminFacturesClient.form.notes")} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editingId ? t("adminFacturesClient.form.update") : t("adminFacturesClient.form.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
