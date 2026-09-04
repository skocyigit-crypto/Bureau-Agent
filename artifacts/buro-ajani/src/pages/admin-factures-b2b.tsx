import { AccessDenied } from "@/components/access-denied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceUser } from "@/components/workspace-user";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell,Edit,Loader2,Plus,Receipt,RefreshCw,Search,Shield,Trash2 } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STATUSES = [
  { key: "brouillon", label: "Brouillon", color: "bg-slate-100 text-slate-600" },
  { key: "envoyee", label: "Envoyée", color: "bg-blue-100 text-blue-700" },
  { key: "payee", label: "Payée", color: "bg-emerald-100 text-emerald-700" },
  { key: "partiellement_payee", label: "Partielle", color: "bg-amber-100 text-amber-700" },
  { key: "en_retard", label: "En retard", color: "bg-red-100 text-red-700" },
  { key: "annulee", label: "Annulée", color: "bg-slate-200 text-slate-700" },
] as const;

interface Facture {
  id: number; reference: string; title: string; clientName: string; clientEmail?: string;
  clientCompany?: string; status: string; totalAmount?: string; paidAmount?: string;
  currency: string; dueDate?: string; createdAt: string; organisationId?: number | null;
  reminderCount?: number; lastReminderAt?: string | null;
}

interface OrgOption { id: number; name: string }

const EMPTY_FORM = {
  reference: "", title: "", clientName: "", clientEmail: "", clientCompany: "",
  totalAmount: "", paidAmount: "", currency: "EUR", status: "brouillon", dueDate: "",
  notes: "", organisationId: "",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const s = STATUSES.find(x => x.key === status) || STATUSES[0];
  return <Badge className={`${s.color} border-0 text-xs`}>{t(`adminFacturesB2b.status.${s.key}`)}</Badge>;
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

export default function AdminFacturesB2BPage() {
  const { user } = useWorkspaceUser();
  if (user.role !== "super_admin") return <AccessDenied />;

  return <AdminFacturesB2BContent />;
}

function AdminFacturesB2BContent() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [items, setItems] = useState<Facture[]>([]);
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
      const res = await fetch(`${BASE}/api/factures-client?${params}`, { credentials: "include" });
      if (res.ok) { const d = await res.json(); setItems(d.factures || []); setTotal(d.total || 0); }
    } catch { toast({ title: t("adminFacturesB2b.toast.error"), description: t("adminFacturesB2b.toast.loadFailed"), variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, orgFilter, toast, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, statusFilter, orgFilter]);

  useEffect(() => {
    fetch(`${BASE}/api/organisations`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { organisations: [] })
      .then((d: { organisations?: OrgOption[] }) => setOrgs((d.organisations || []).map(o => ({ id: o.id, name: o.name }))))
      .catch(() => { /* non-bloquant */ });
  }, []);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setDialogOpen(true); };
  const openEdit = (f: Facture) => {
    setEditingId(f.id);
    setForm({
      reference: f.reference || "", title: f.title, clientName: f.clientName || "",
      clientEmail: f.clientEmail || "", clientCompany: f.clientCompany || "",
      totalAmount: f.totalAmount || "", paidAmount: f.paidAmount || "",
      currency: f.currency || "EUR", status: f.status,
      dueDate: f.dueDate ? f.dueDate.substring(0, 10) : "", notes: "",
      organisationId: f.organisationId != null ? String(f.organisationId) : "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: t("adminFacturesB2b.toast.titleRequired"), variant: "destructive" }); return; }
    if (!form.clientName.trim()) { toast({ title: t("adminFacturesB2b.toast.clientRequired"), variant: "destructive" }); return; }
    if (!editingId && !form.organisationId) { toast({ title: t("adminFacturesB2b.toast.orgRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/factures-client/${editingId}` : `${BASE}/api/factures-client`;
      const method = editingId ? "PATCH" : "POST";
      const { organisationId: orgIdStr, ...rest } = form;
      const payload: Record<string, unknown> = {
        ...rest,
        totalAmount: form.totalAmount || null,
        paidAmount: form.paidAmount || null,
      };
      if (orgIdStr) payload.organisationId = Number(orgIdStr);
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      if (res.ok) {
        toast({ title: editingId ? t("adminFacturesB2b.toast.updated") : t("adminFacturesB2b.toast.created") });
        setDialogOpen(false); load();
      } else { const d = await res.json(); toast({ title: t("adminFacturesB2b.toast.error"), description: d.error, variant: "destructive" }); }
    } catch { toast({ title: t("adminFacturesB2b.toast.error"), description: t("adminFacturesB2b.toast.saveFailed"), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const [reminding, setReminding] = useState<number | null>(null);
  const handleRelance = async (f: Facture) => {
    if (!f.clientEmail) {
      toast({ title: t("adminFacturesB2b.toast.emailMissingTitle"), description: t("adminFacturesB2b.toast.emailMissingDesc"), variant: "destructive" });
      return;
    }
    const confirmText = f.reminderCount && f.reminderCount > 0
      ? t("adminFacturesB2b.toast.relanceConfirmMulti", { count: f.reminderCount, email: f.clientEmail })
      : t("adminFacturesB2b.toast.relanceConfirmFirst", { email: f.clientEmail });
    if (!(await confirmAction({ title: t("adminFacturesB2b.toast.relanceConfirmTitle"), description: confirmText, confirmLabel: t("adminFacturesB2b.toast.relanceConfirmLabel") }))) return;
    setReminding(f.id);
    try {
      const res = await fetch(`${BASE}/api/factures-client/${f.id}/relance`, { method: "POST", credentials: "include" });
      if (res.ok) { toast({ title: t("adminFacturesB2b.toast.relanceSent"), description: t("adminFacturesB2b.toast.relanceSentDesc", { email: f.clientEmail }) }); load(); }
      else { const d = await res.json().catch(() => ({})); toast({ title: t("adminFacturesB2b.toast.error"), description: d.error || t("adminFacturesB2b.toast.relanceFailed"), variant: "destructive" }); }
    } catch { toast({ title: t("adminFacturesB2b.toast.error"), description: t("adminFacturesB2b.toast.relanceFailed"), variant: "destructive" }); }
    finally { setReminding(null); }
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmAction({ title: t("adminFacturesB2b.toast.deleteConfirmTitle"), confirmLabel: t("adminFacturesB2b.toast.deleteConfirmLabel"), destructive: true }))) return;
    const res = await fetch(`${BASE}/api/factures-client/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("adminFacturesB2b.toast.deleted") }); load(); }
    else toast({ title: t("adminFacturesB2b.toast.error"), variant: "destructive" });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Receipt className="w-6 h-6 text-primary" /> {t("adminFacturesB2b.title")}
            <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 dark:bg-red-950/30">
              <Shield className="w-3 h-3 mr-1" /> {t("adminFacturesB2b.superAdmin")}
            </Badge>
          </h1>
          <p className="text-muted-foreground text-sm">{t("adminFacturesB2b.subtitle")}</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> {t("adminFacturesB2b.new")}</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label={t("adminFacturesB2b.searchPlaceholder")} placeholder={t("adminFacturesB2b.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("adminFacturesB2b.statusPlaceholder")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminFacturesB2b.allStatuses")}</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{t(`adminFacturesB2b.status.${s.key}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="w-56" data-testid="factures-org-filter"><SelectValue placeholder={t("adminFacturesB2b.orgPlaceholder")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("adminFacturesB2b.allOrgs")}</SelectItem>
            {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
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
              <p className="text-center text-muted-foreground py-12" data-testid="no-results-factures">{t("adminFacturesB2b.empty")}</p>
            ) : items.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{f.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[f.reference, f.clientCompany || f.clientName].filter(Boolean).join(" · ")}
                    {" · "}
                    {format(new Date(f.createdAt), "dd MMM yyyy", { locale: fr })}
                    {f.reminderCount != null && f.reminderCount > 0 && (
                      <span className="text-amber-600"> · {t("adminFacturesB2b.reminders", { count: f.reminderCount })}{f.lastReminderAt ? ` (${format(new Date(f.lastReminderAt), "dd MMM", { locale: fr })})` : ""}</span>
                    )}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] hidden md:inline-flex" data-testid={`facture-org-${f.id}`}>
                  {f.organisationId != null ? (orgNameById.get(f.organisationId) || `Org #${f.organisationId}`) : "—"}
                </Badge>
                <StatusBadge status={f.status} />
                <span className="text-sm font-bold text-emerald-600 hidden md:block w-24 text-right">{fmtMoney(f.totalAmount, f.currency)}</span>
                {f.status !== "payee" && f.status !== "annulee" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${f.status === "en_retard" ? "text-amber-600" : "text-muted-foreground"}`}
                    title={f.clientEmail ? t("adminFacturesB2b.reminderTitleHas") : t("adminFacturesB2b.reminderTitleNoEmail")}
                    disabled={!f.clientEmail || reminding === f.id}
                    onClick={() => handleRelance(f)}
                    data-testid={`facture-relance-${f.id}`}
                  >
                    {reminding === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)} aria-label={t("common.edit")}><Edit className="w-3 h-3" aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDelete(f.id)} aria-label={t("common.delete")}><Trash2 className="w-3 h-3" aria-hidden="true" /></Button>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">{t("adminFacturesB2b.count", { count: total })}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t("adminFacturesB2b.prev")}</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{t("adminFacturesB2b.next")}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t("adminFacturesB2b.dialog.editTitle") : t("adminFacturesB2b.dialog.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t("adminFacturesB2b.form.targetOrg")} {editingId ? "" : "*"}</Label>
              <Select
                value={form.organisationId}
                onValueChange={v => setForm(f => ({ ...f, organisationId: v }))}
                disabled={editingId !== null}
              >
                <SelectTrigger data-testid="facture-form-org"><SelectValue placeholder={t("adminFacturesB2b.form.chooseOrg")} /></SelectTrigger>
                <SelectContent>
                  {orgs.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                {editingId
                  ? t("adminFacturesB2b.form.orgHelpEdit")
                  : t("adminFacturesB2b.form.orgHelpCreate")}
              </p>
            </div>
            <div><Label className="text-xs">{t("adminFacturesB2b.form.title")} *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesB2b.form.reference")}</Label><Input aria-label={t("adminFacturesB2b.form.reference")} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="FAC-..." /></div>
              <div><Label className="text-xs">{t("adminFacturesB2b.form.status")}</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger aria-label={t("adminFacturesB2b.form.status")}><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s.key} value={s.key}>{t(`adminFacturesB2b.status.${s.key}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesB2b.form.client")} *</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} /></div>
              <div><Label className="text-xs">{t("adminFacturesB2b.form.company")}</Label><Input aria-label={t("adminFacturesB2b.form.company")} value={form.clientCompany} onChange={e => setForm(f => ({ ...f, clientCompany: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesB2b.form.email")}</Label><Input aria-label={t("adminFacturesB2b.form.email")} type="email" value={form.clientEmail} onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))} /></div>
              <div><Label className="text-xs">{t("adminFacturesB2b.form.dueDate")}</Label><Input aria-label={t("adminFacturesB2b.form.dueDate")} type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t("adminFacturesB2b.form.totalAmount")}</Label><Input aria-label={t("adminFacturesB2b.form.totalAmount")} type="number" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} placeholder="0" /></div>
              <div><Label className="text-xs">{t("adminFacturesB2b.form.paidAmount")}</Label><Input aria-label={t("adminFacturesB2b.form.paidAmount")} type="number" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} placeholder="0" /></div>
            </div>
            <div><Label className="text-xs">{t("adminFacturesB2b.form.notes")}</Label><Textarea aria-label={t("adminFacturesB2b.form.notes")} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editingId ? t("adminFacturesB2b.form.update") : t("adminFacturesB2b.form.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
