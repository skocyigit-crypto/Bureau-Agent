import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
AlertTriangle,
BookOpen,
Check,
Download,
FileText,
Inbox,
Loader2,
Pencil,
PieChart as PieChartIcon,
Plus,
RefreshCw,
Save,
Trash2,
Wallet,
X,
} from "lucide-react";
import { useCallback,useEffect,useMemo,useState } from "react";
import {
Bar,
BarChart,
CartesianGrid,
Cell,
Legend,
Pie,
PieChart,
Tooltip as RechartsTooltip,
ResponsiveContainer,
XAxis,
YAxis,
} from "recharts";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const CATEGORY_LABELS: Record<string, string> = {
  carburant: "Carburant",
  fournitures: "Fournitures",
  materiel: "Matériel / outillage",
  sous_traitance: "Sous-traitance",
  loyer: "Loyer",
  assurance: "Assurance",
  telephone_internet: "Téléphone / Internet",
  repas: "Repas",
  deplacement: "Déplacement",
  entretien_vehicule: "Entretien véhicule",
  honoraires: "Honoraires",
  taxes: "Taxes / cotisations",
  autre: "Autre",
};

const SOURCE_LABELS: Record<string, string> = {
  upload: "Téléversement",
  gmail: "E-mail",
  manuel: "Saisie manuelle",
};

interface Depense {
  id: number;
  documentId: number | null;
  vendor: string;
  title: string | null;
  reference: string | null;
  category: string;
  expenseDate: string | null;
  dueDate: string | null;
  amountHt: string;
  amountTva: string;
  amountTtc: string;
  currency: string;
  status: string;
  paymentStatus: string;
  source: string;
  aiConfidence: string | null;
  notes: string | null;
  duplicateOfId: number | null;
  createdAt: string;
}

interface Summary {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  approvedTotal: number;
  payableCount: number;
  payableTotal: number;
}

const EMPTY_SUMMARY: Summary = {
  pendingCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  approvedTotal: 0,
  payableCount: 0,
  payableTotal: 0,
};

const CHART_COLORS = [
  "hsl(142.1 76.2% 36.3%)",
  "hsl(221 83% 53%)",
  "hsl(43 96% 56%)",
  "hsl(0 84.2% 60.2%)",
  "hsl(262 83% 58%)",
  "hsl(199 89% 48%)",
  "hsl(24 95% 53%)",
  "hsl(330 81% 60%)",
  "hsl(173 58% 39%)",
  "hsl(215.4 16.3% 46.9%)",
];

interface CategoryStat {
  category: string;
  total: number;
  count: number;
}
interface MonthStat {
  month: string;
  total: number;
  count: number;
}
interface VendorStat {
  vendor: string;
  total: number;
  count: number;
}
interface Stats {
  byCategory: CategoryStat[];
  byMonth: MonthStat[];
  byVendor: VendorStat[];
}

const EMPTY_STATS: Stats = { byCategory: [], byMonth: [], byVendor: [] };

function fmtMonth(m: string): string {
  const [y, mo] = m.split("-");
  const dt = new Date(Number(y), Number(mo) - 1, 1);
  return Number.isNaN(dt.getTime()) ? m : dt.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function eur(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("fr-FR");
}

function toDateInput(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

interface EditForm {
  vendor: string;
  title: string;
  reference: string;
  category: string;
  expenseDate: string;
  dueDate: string;
  amountHt: string;
  amountTva: string;
  amountTtc: string;
  paymentStatus: string;
  notes: string;
}

function depenseToForm(d: Depense): EditForm {
  return {
    vendor: d.vendor || "",
    title: d.title || "",
    reference: d.reference || "",
    category: d.category || "autre",
    expenseDate: toDateInput(d.expenseDate),
    dueDate: toDateInput(d.dueDate),
    amountHt: d.amountHt || "0",
    amountTva: d.amountTva || "0",
    amountTtc: d.amountTtc || "0",
    paymentStatus: d.paymentStatus || "a_payer",
    notes: d.notes || "",
  };
}

const EMPTY_FORM: EditForm = {
  vendor: "",
  title: "",
  reference: "",
  category: "autre",
  expenseDate: "",
  dueDate: "",
  amountHt: "0",
  amountTva: "0",
  amountTtc: "0",
  paymentStatus: "a_payer",
  notes: "",
};

export default function DepensesPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [tab, setTab] = useState<"queue" | "ledger">("queue");
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Filtres (registre uniquement)
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterVendor, setFilterVendor] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterPayment, setFilterPayment] = useState<string>("all");

  // Édition / création
  const [editing, setEditing] = useState<Depense | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Paramètres de filtrage du registre (partagés entre liste, stats et export).
  const ledgerParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("status", "approuve");
    if (filterCategory !== "all") params.set("category", filterCategory);
    if (filterVendor.trim()) params.set("vendor", filterVendor.trim());
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    if (filterPayment !== "all") params.set("paymentStatus", filterPayment);
    return params;
  }, [filterCategory, filterVendor, filterFrom, filterTo, filterPayment]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = tab === "queue" ? new URLSearchParams({ status: "en_attente" }) : ledgerParams();
      const res = await fetch(`${BASE}/api/depenses?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setDepenses(Array.isArray(data.depenses) ? data.depenses : []);
      setSummary({ ...EMPTY_SUMMARY, ...(data.summary || {}) });
    } catch {
      toast({ title: t("depenses.toast.error"), description: t("depenses.toast.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [tab, ledgerParams, toast]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/depenses/stats?${ledgerParams().toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("stats");
      const data = await res.json();
      setStats({
        byCategory: Array.isArray(data.byCategory) ? data.byCategory : [],
        byMonth: Array.isArray(data.byMonth) ? data.byMonth : [],
        byVendor: Array.isArray(data.byVendor) ? data.byVendor : [],
      });
    } catch {
      setStats(EMPTY_STATS);
    } finally {
      setStatsLoading(false);
    }
  }, [ledgerParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === "ledger") loadStats();
  }, [tab, loadStats]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(`${BASE}/api/depenses/export?${ledgerParams().toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `depenses_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: t("depenses.toast.exportReady"), description: t("depenses.toast.exportReadyDesc") });
    } catch {
      toast({ title: t("depenses.toast.error"), description: t("depenses.toast.exportError"), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }, [ledgerParams, toast]);

  const act = useCallback(
    async (id: number, action: "approve" | "reject") => {
      setBusyId(id);
      try {
        const res = await fetch(`${BASE}/api/depenses/${id}/${action}`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) throw new Error("act");
        toast({
          title: action === "approve" ? t("depenses.toast.approved") : t("depenses.toast.rejected"),
          description:
            action === "approve"
              ? t("depenses.toast.approvedDesc")
              : t("depenses.toast.rejectedDesc"),
        });
        await load();
      } catch {
        toast({ title: t("depenses.toast.error"), description: t("depenses.toast.actionError"), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [load, toast],
  );

  const remove = useCallback(
    async (id: number) => {
      if (!window.confirm(t("depenses.confirm.delete"))) return;
      setBusyId(id);
      try {
        const res = await fetch(`${BASE}/api/depenses/${id}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) throw new Error("del");
        toast({ title: t("depenses.toast.deleted") });
        await load();
      } catch {
        toast({ title: t("depenses.toast.error"), description: t("depenses.toast.deleteError"), variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [load, toast],
  );

  const openEdit = useCallback((d: Depense) => {
    setEditing(d);
    setCreating(false);
    setForm(depenseToForm(d));
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setCreating(true);
    setForm(EMPTY_FORM);
  }, []);

  const closeDialog = useCallback(() => {
    setEditing(null);
    setCreating(false);
  }, []);

  const save = useCallback(async () => {
    if (!form.vendor.trim()) {
      toast({ title: t("depenses.toast.vendorRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        vendor: form.vendor.trim(),
        title: form.title.trim(),
        reference: form.reference.trim(),
        category: form.category,
        expenseDate: form.expenseDate || null,
        dueDate: form.dueDate || null,
        amountHt: Number(form.amountHt) || 0,
        amountTva: Number(form.amountTva) || 0,
        amountTtc: Number(form.amountTtc) || 0,
        paymentStatus: form.paymentStatus,
        notes: form.notes.trim(),
      };
      const url = creating ? `${BASE}/api/depenses` : `${BASE}/api/depenses/${editing?.id}`;
      const res = await fetch(url, {
        method: creating ? "POST" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("save");
      const data = await res.json();
      toast({
        title: creating ? t("depenses.toast.created") : t("depenses.toast.updated"),
        description: data.duplicate ? t("depenses.toast.duplicateDetected") : undefined,
      });
      closeDialog();
      await load();
    } catch {
      toast({ title: t("depenses.toast.error"), description: t("depenses.toast.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [form, creating, editing, closeDialog, load, toast]);

  // Recalcule le TTC quand HT/TVA changent (aide à la saisie).
  const onHtTva = useCallback((ht: string, tva: string) => {
    const ttc = (Number(ht) || 0) + (Number(tva) || 0);
    setForm((f) => ({ ...f, amountHt: ht, amountTva: tva, amountTtc: ttc ? String(ttc) : f.amountTtc }));
  }, []);

  const ledgerTotal = useMemo(
    () => depenses.reduce((s, d) => s + (Number(d.amountTtc) || 0), 0),
    [depenses],
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Wallet className="h-6 w-6 text-emerald-600" />
            {t("depenses.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("depenses.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> {t("depenses.newExpense")}
          </Button>
          {tab === "ledger" && (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
              {exporting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              {t("depenses.export")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {t("depenses.refresh")}
          </Button>
        </div>
      </div>

      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("depenses.summary.pending")}</CardDescription>
            <CardTitle className="text-2xl">{summary.pendingCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("depenses.summary.approved")}</CardDescription>
            <CardTitle className="text-2xl">{summary.approvedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("depenses.summary.ledgerTotal")}</CardDescription>
            <CardTitle className="text-2xl">{eur(summary.approvedTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("depenses.summary.payable")}</CardDescription>
            <CardTitle className="text-2xl">{eur(summary.payableTotal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "queue" | "ledger")}>
        <TabsList>
          <TabsTrigger value="queue">
            <Inbox className="mr-1.5 h-4 w-4" /> {t("depenses.tabs.queue", { count: summary.pendingCount })}
          </TabsTrigger>
          <TabsTrigger value="ledger">
            <BookOpen className="mr-1.5 h-4 w-4" /> {t("depenses.tabs.ledger")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filtres (registre) */}
      {tab === "ledger" && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="grid gap-1">
              <Label className="text-xs">{t("depenses.filters.category")}</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("depenses.filters.all")}</SelectItem>
                  {Object.keys(CATEGORY_LABELS).map((k) => (
                    <SelectItem key={k} value={k}>{t(`depenses.categories.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t("depenses.filters.vendor")}</Label>
              <Input
                className="h-9 w-44"
                placeholder={t("depenses.filters.searchPlaceholder")}
                value={filterVendor}
                onChange={(e) => setFilterVendor(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t("depenses.filters.from")}</Label>
              <Input className="h-9 w-36" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t("depenses.filters.to")}</Label>
              <Input className="h-9 w-36" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t("depenses.filters.payment")}</Label>
              <Select value={filterPayment} onValueChange={setFilterPayment}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("depenses.filters.allPayments")}</SelectItem>
                  <SelectItem value="a_payer">{t("depenses.payment.a_payer")}</SelectItem>
                  <SelectItem value="paye">{t("depenses.payment.paye")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(filterCategory !== "all" || filterVendor || filterFrom || filterTo || filterPayment !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterCategory("all");
                  setFilterVendor("");
                  setFilterFrom("");
                  setFilterTo("");
                  setFilterPayment("all");
                }}
              >
                {t("depenses.filters.reset")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Synthèse graphique (registre) */}
      {tab === "ledger" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChartIcon className="h-4 w-4 text-muted-foreground" />
                {t("depenses.charts.byCategory")}
              </CardTitle>
              <CardDescription>{t("depenses.charts.byCategoryDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : stats.byCategory.length === 0 ? (
                <p className="py-20 text-center text-sm text-muted-foreground">{t("depenses.charts.noData")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={288}>
                  <PieChart>
                    <Pie
                      data={stats.byCategory.map((c) => ({
                        name: CATEGORY_LABELS[c.category] ? t(`depenses.categories.${c.category}`) : c.category,
                        value: c.total,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                    >
                      {stats.byCategory.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(v: number) => eur(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                {t("depenses.charts.byMonth")}
              </CardTitle>
              <CardDescription>{t("depenses.charts.byMonthDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : stats.byMonth.length === 0 ? (
                <p className="py-20 text-center text-sm text-muted-foreground">{t("depenses.charts.noData")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={288}>
                  <BarChart
                    data={stats.byMonth.map((m) => ({ name: fmtMonth(m.month), total: m.total }))}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => eur(v)} width={80} />
                    <RechartsTooltip formatter={(v: number) => eur(v)} />
                    <Bar dataKey="total" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} name={t("depenses.charts.total")} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {stats.byVendor.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  {t("depenses.charts.topVendors")}
                </CardTitle>
                <CardDescription>{t("depenses.charts.topVendorsDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(160, stats.byVendor.length * 36)}>
                    <BarChart
                      layout="vertical"
                      data={stats.byVendor.map((v) => ({ name: v.vendor || t("depenses.charts.unknownVendor"), total: v.total }))}
                      margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v: number) => eur(v)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={140} />
                      <RechartsTooltip formatter={(v: number) => eur(v)} />
                      <Bar dataKey="total" fill={CHART_COLORS[1]} radius={[0, 4, 4, 0]} name={t("depenses.charts.total")} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Liste */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {tab === "queue" ? t("depenses.list.queueTitle") : t("depenses.list.ledgerTitle", { count: depenses.length })}
          </CardTitle>
          {tab === "ledger" && (
            <CardDescription>{t("depenses.list.displayedTotal", { total: eur(ledgerTotal) })}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : depenses.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {tab === "queue" ? (
                <>
                  <Inbox className="mx-auto mb-2 h-10 w-10 opacity-40" />
                  <p>{t("depenses.empty.queue")}</p>
                </>
              ) : (
                <>
                  <BookOpen className="mx-auto mb-2 h-10 w-10 opacity-40" />
                  <p>{t("depenses.empty.ledger")}</p>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {depenses.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{d.vendor || t("depenses.list.unknownVendor")}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {CATEGORY_LABELS[d.category] ? t(`depenses.categories.${d.category}`) : d.category}
                      </Badge>
                      {d.duplicateOfId && (
                        <Badge variant="outline" className="shrink-0 border-amber-300 text-amber-700">
                          <AlertTriangle className="mr-1 h-3 w-3" /> {t("depenses.list.duplicate")}
                        </Badge>
                      )}
                      {d.paymentStatus === "paye" && (
                        <Badge variant="outline" className="shrink-0 border-emerald-300 text-emerald-700">
                          {t("depenses.payment.paye")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {fmtDate(d.expenseDate)}
                      {d.reference ? t("depenses.list.refInline", { ref: d.reference }) : ""}
                      {d.title ? ` · ${d.title}` : ""}
                      {" · "}
                      <span className="inline-flex items-center gap-1">
                        {d.documentId ? <FileText className="h-3 w-3" /> : null}
                        {SOURCE_LABELS[d.source] ? t(`depenses.sources.${d.source}`) : d.source}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{eur(Number(d.amountTtc))}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("depenses.list.htTva", { ht: eur(Number(d.amountHt)), tva: eur(Number(d.amountTva)) })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(d)} title={t("common.edit")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {tab === "queue" ? (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={busyId === d.id}
                          onClick={() => act(d.id, "approve")}
                        >
                          {busyId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          <span className="ml-1 hidden sm:inline">{t("common.approve")}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === d.id}
                          onClick={() => act(d.id, "reject")}
                        >
                          <X className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">{t("common.reject")}</span>
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        disabled={busyId === d.id}
                        onClick={() => remove(d.id)}
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Dialog édition / création */}
      <Dialog open={!!editing || creating} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{creating ? t("depenses.dialog.createTitle") : t("depenses.dialog.editTitle")}</DialogTitle>
            <DialogDescription>
              {creating
                ? t("depenses.dialog.createDesc")
                : t("depenses.dialog.editDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>{t("depenses.form.vendor")}</Label>
              <Input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>{t("depenses.form.reference")}</Label>
                <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <Label>{t("depenses.form.category")}</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(CATEGORY_LABELS).map((k) => (
                      <SelectItem key={k} value={k}>{t(`depenses.categories.${k}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>{t("depenses.form.title")}</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>{t("depenses.form.date")}</Label>
                <Input type="date" value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <Label>{t("depenses.form.dueDate")}</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1">
                <Label>{t("depenses.form.ht")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountHt}
                  onChange={(e) => onHtTva(e.target.value, form.amountTva)}
                />
              </div>
              <div className="grid gap-1">
                <Label>{t("depenses.form.tva")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountTva}
                  onChange={(e) => onHtTva(form.amountHt, e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label>{t("depenses.form.ttc")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountTtc}
                  onChange={(e) => setForm((f) => ({ ...f, amountTtc: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label>{t("depenses.form.paymentStatus")}</Label>
              <Select value={form.paymentStatus} onValueChange={(v) => setForm((f) => ({ ...f, paymentStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a_payer">{t("depenses.payment.a_payer")}</SelectItem>
                  <SelectItem value="paye">{t("depenses.payment.paye")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("depenses.form.notes")}</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              {creating ? t("depenses.dialog.create") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
