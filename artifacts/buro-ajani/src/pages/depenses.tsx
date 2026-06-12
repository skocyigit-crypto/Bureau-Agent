import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wallet,
  Loader2,
  RefreshCw,
  Check,
  X,
  Pencil,
  Trash2,
  AlertTriangle,
  Inbox,
  BookOpen,
  Plus,
  FileText,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

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
  const [tab, setTab] = useState<"queue" | "ledger">("queue");
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab === "queue") {
        params.set("status", "en_attente");
      } else {
        params.set("status", "approuve");
        if (filterCategory !== "all") params.set("category", filterCategory);
        if (filterVendor.trim()) params.set("vendor", filterVendor.trim());
        if (filterFrom) params.set("from", filterFrom);
        if (filterTo) params.set("to", filterTo);
        if (filterPayment !== "all") params.set("paymentStatus", filterPayment);
      }
      const res = await fetch(`${BASE}/api/depenses?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setDepenses(Array.isArray(data.depenses) ? data.depenses : []);
      setSummary({ ...EMPTY_SUMMARY, ...(data.summary || {}) });
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les dépenses.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [tab, filterCategory, filterVendor, filterFrom, filterTo, filterPayment, toast]);

  useEffect(() => {
    load();
  }, [load]);

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
          title: action === "approve" ? "Dépense approuvée" : "Dépense rejetée",
          description:
            action === "approve"
              ? "Enregistrée au registre et prise en compte en trésorerie."
              : "La dépense a été écartée.",
        });
        await load();
      } catch {
        toast({ title: "Erreur", description: "L'action a échoué.", variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [load, toast],
  );

  const remove = useCallback(
    async (id: number) => {
      if (!window.confirm("Supprimer définitivement cette dépense ?")) return;
      setBusyId(id);
      try {
        const res = await fetch(`${BASE}/api/depenses/${id}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) throw new Error("del");
        toast({ title: "Dépense supprimée" });
        await load();
      } catch {
        toast({ title: "Erreur", description: "La suppression a échoué.", variant: "destructive" });
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
      toast({ title: "Fournisseur requis", variant: "destructive" });
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
        title: creating ? "Dépense créée" : "Dépense mise à jour",
        description: data.duplicate ? "⚠️ Un doublon potentiel a été détecté." : undefined,
      });
      closeDialog();
      await load();
    } catch {
      toast({ title: "Erreur", description: "L'enregistrement a échoué.", variant: "destructive" });
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
            Dépenses
          </h1>
          <p className="text-sm text-muted-foreground">
            Registre des dépenses (gider defteri). Les justificatifs entrants (téléversements et pièces
            jointes e-mail) sont analysés automatiquement et placés en file d'inspection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> Nouvelle dépense
          </Button>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualiser
          </Button>
        </div>
      </div>

      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>En attente</CardDescription>
            <CardTitle className="text-2xl">{summary.pendingCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Approuvées</CardDescription>
            <CardTitle className="text-2xl">{summary.approvedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total registre (TTC)</CardDescription>
            <CardTitle className="text-2xl">{eur(summary.approvedTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Reste à payer</CardDescription>
            <CardTitle className="text-2xl">{eur(summary.payableTotal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "queue" | "ledger")}>
        <TabsList>
          <TabsTrigger value="queue">
            <Inbox className="mr-1.5 h-4 w-4" /> File d'inspection ({summary.pendingCount})
          </TabsTrigger>
          <TabsTrigger value="ledger">
            <BookOpen className="mr-1.5 h-4 w-4" /> Registre
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filtres (registre) */}
      {tab === "ledger" && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="grid gap-1">
              <Label className="text-xs">Catégorie</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Fournisseur</Label>
              <Input
                className="h-9 w-44"
                placeholder="Rechercher…"
                value={filterVendor}
                onChange={(e) => setFilterVendor(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Du</Label>
              <Input className="h-9 w-36" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Au</Label>
              <Input className="h-9 w-36" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Paiement</Label>
              <Select value={filterPayment} onValueChange={setFilterPayment}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="a_payer">À payer</SelectItem>
                  <SelectItem value="paye">Payé</SelectItem>
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
                Réinitialiser
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Liste */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {tab === "queue" ? "Justificatifs à valider" : `Dépenses enregistrées (${depenses.length})`}
          </CardTitle>
          {tab === "ledger" && (
            <CardDescription>Total affiché : {eur(ledgerTotal)}</CardDescription>
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
                  <p>Aucun justificatif en attente. Les nouvelles factures arriveront ici automatiquement.</p>
                </>
              ) : (
                <>
                  <BookOpen className="mx-auto mb-2 h-10 w-10 opacity-40" />
                  <p>Aucune dépense enregistrée pour ces filtres.</p>
                </>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {depenses.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{d.vendor || "Fournisseur inconnu"}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {CATEGORY_LABELS[d.category] || d.category}
                      </Badge>
                      {d.duplicateOfId && (
                        <Badge variant="outline" className="shrink-0 border-amber-300 text-amber-700">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Doublon ?
                        </Badge>
                      )}
                      {d.paymentStatus === "paye" && (
                        <Badge variant="outline" className="shrink-0 border-emerald-300 text-emerald-700">
                          Payé
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {fmtDate(d.expenseDate)}
                      {d.reference ? ` · réf. ${d.reference}` : ""}
                      {d.title ? ` · ${d.title}` : ""}
                      {" · "}
                      <span className="inline-flex items-center gap-1">
                        {d.documentId ? <FileText className="h-3 w-3" /> : null}
                        {SOURCE_LABELS[d.source] || d.source}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{eur(Number(d.amountTtc))}</div>
                    <div className="text-xs text-muted-foreground">
                      HT {eur(Number(d.amountHt))} · TVA {eur(Number(d.amountTva))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(d)} title="Modifier">
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
                          <span className="ml-1 hidden sm:inline">Approuver</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === d.id}
                          onClick={() => act(d.id, "reject")}
                        >
                          <X className="h-4 w-4" />
                          <span className="ml-1 hidden sm:inline">Rejeter</span>
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        disabled={busyId === d.id}
                        onClick={() => remove(d.id)}
                        title="Supprimer"
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
            <DialogTitle>{creating ? "Nouvelle dépense" : "Modifier la dépense"}</DialogTitle>
            <DialogDescription>
              {creating
                ? "Saisissez une dépense manuellement."
                : "Corrigez les champs extraits avant d'approuver."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Fournisseur *</Label>
              <Input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Référence</Label>
                <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <Label>Catégorie</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Libellé</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Date</Label>
                <Input type="date" value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <Label>Échéance</Label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1">
                <Label>HT (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountHt}
                  onChange={(e) => onHtTva(e.target.value, form.amountTva)}
                />
              </div>
              <div className="grid gap-1">
                <Label>TVA (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountTva}
                  onChange={(e) => onHtTva(form.amountHt, e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label>TTC (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amountTtc}
                  onChange={(e) => setForm((f) => ({ ...f, amountTtc: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Statut de paiement</Label>
              <Select value={form.paymentStatus} onValueChange={(v) => setForm((f) => ({ ...f, paymentStatus: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a_payer">À payer</SelectItem>
                  <SelectItem value="paye">Payé</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={saving}>Annuler</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              {creating ? "Créer" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
