import { useState, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, FileText, Receipt, Package, Target, Euro, AlertTriangle, CheckCircle, Clock, ArrowUpRight, Download, Printer, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  qualification: "Qualification",
  proposition: "Proposition",
  negociation: "Négociation",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "#6366f1",
  qualification: "#f59e0b",
  proposition: "#3b82f6",
  negociation: "#10b981",
};

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " €";
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTH_LABELS[m] || m} ${y}`;
}

interface RapportData {
  devis: { total: number; brouillon: number; envoye: number; accepte: number; refuse: number; expire: number; totalAmount: number; acceptedAmount: number; conversionRate: number };
  factures: { total: number; brouillon: number; emise: number; payee: number; annulee: number; totalAmount: number; paidAmount: number; remainingAmount: number; overdueCount: number };
  prospects: { total: number; prospect: number; qualification: number; proposition: number; negociation: number; gagne: number; perdu: number; totalValue: number; wonValue: number };
  stock: { total: number; alerte: number; rupture: number; totalValue: number };
  projets: { total: number; active: number; termine: number; overdue: number; avgProgress: number; totalBudget: number; totalSpent: number };
  monthlyRevenue: { month: string; revenue: number; invoiced: number; count: number }[];
  devisByMonth: { month: string; total: number; accepte: number; refuse: number }[];
  prospectsByStage: { stage: string; count: number; value: number }[];
  topProducts: { name: string; category: string; quantity: number; unitPrice: number; totalValue: number }[];
}

export default function RapportCommercialPage() {
  const [data, setData] = useState<RapportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState("6");
  const { toast } = useToast();

  useEffect(() => {
    load();
  }, [months]);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch(`${BASE}/api/commercial/rapport?months=${months}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger le rapport.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-72 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  const { devis, factures, prospects, stock, projets, monthlyRevenue, devisByMonth, prospectsByStage, topProducts } = data;

  const revenueChartData = monthlyRevenue.map(r => ({
    name: fmtMonth(r.month),
    "Encaissé": Number(r.revenue),
    "Facturé": Number(r.invoiced),
  }));

  const devisChartData = devisByMonth.map(d => ({
    name: fmtMonth(d.month),
    Total: d.total,
    Accepté: d.accepte,
    Refusé: d.refuse,
  }));

  const pipelineData = prospectsByStage.map(s => ({
    name: STAGE_LABELS[s.stage] || s.stage,
    stage: s.stage,
    Prospects: s.count,
    Valeur: Number(s.value),
  }));

  const facturesPieData = [
    { name: "Brouillon", value: factures.brouillon, color: "#6b7280" },
    { name: "Émise", value: factures.emise, color: "#3b82f6" },
    { name: "Payée", value: factures.payee, color: "#10b981" },
    { name: "Annulée", value: factures.annulee, color: "#ef4444" },
  ].filter(d => d.value > 0);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rapport Commercial</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Vue d'ensemble de votre activité commerciale</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 derniers mois</SelectItem>
              <SelectItem value="6">6 derniers mois</SelectItem>
              <SelectItem value="12">12 derniers mois</SelectItem>
              <SelectItem value="24">24 derniers mois</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-indigo-500/10"><TrendingUp className="w-4 h-4 text-indigo-500" /></div>
              <Badge variant="secondary" className="text-xs">{prospects.total} prospects</Badge>
            </div>
            <p className="text-2xl font-bold">{fmt(Number(prospects.totalValue))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Pipeline total</p>
            <div className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3" />{fmt(Number(prospects.wonValue))} gagnés
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><FileText className="w-4 h-4 text-amber-500" /></div>
              <Badge variant="secondary" className="text-xs">{devis.conversionRate}% conversion</Badge>
            </div>
            <p className="text-2xl font-bold">{devis.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Devis créés</p>
            <div className="mt-2 text-xs flex items-center gap-3">
              <span className="text-emerald-600">{devis.accepte} acceptés</span>
              <span className="text-red-500">{devis.refuse} refusés</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-emerald-500/10"><Receipt className="w-4 h-4 text-emerald-500" /></div>
              <div className="flex gap-1">
                {factures.overdueCount > 0 && <Badge variant="destructive" className="text-[10px] px-1.5">{factures.overdueCount} en retard</Badge>}
              </div>
            </div>
            <p className="text-2xl font-bold">{fmt(Number(factures.paidAmount))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Encaissé</p>
            <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />{fmt(Number(factures.remainingAmount))} à encaisser
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Package className="w-4 h-4 text-blue-500" /></div>
              {(stock.alerte + stock.rupture) > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5">{stock.alerte + stock.rupture} alertes</Badge>
              )}
            </div>
            <p className="text-2xl font-bold">{fmt(Number(stock.totalValue))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Valeur stock ({stock.total} articles)</p>
            <div className="mt-2 text-xs flex items-center gap-1 text-red-500">
              {stock.rupture > 0 && <><AlertTriangle className="w-3 h-3" />{stock.rupture} en rupture</>}
              {stock.rupture === 0 && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Aucune rupture</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Chiffre d'affaires mensuel</CardTitle>
            <CardDescription>Montants facturés et encaissés</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueChartData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Aucune donnée sur cette période</div>
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <BarChart data={revenueChartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Facturé" fill="#3b82f6" radius={[3, 3, 0, 0]} opacity={0.6} />
                  <Bar dataKey="Encaissé" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Suivi des devis</CardTitle>
            <CardDescription>Évolution mensuelle des devis</CardDescription>
          </CardHeader>
          <CardContent>
            {devisChartData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Aucune donnée sur cette période</div>
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <LineChart data={devisChartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Total" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Accepté" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Refusé" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pipeline par étape</CardTitle>
            <CardDescription>Prospects actifs hors gagnés/perdus</CardDescription>
          </CardHeader>
          <CardContent>
            {pipelineData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Aucun prospect actif</div>
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <BarChart data={pipelineData} layout="vertical" margin={{ top: 4, right: 40, left: 72, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={68} />
                  <Tooltip
                    formatter={(v: number, name: string) => name === "Valeur" ? fmt(v) : v}
                  />
                  <Bar dataKey="Prospects" fill="#6366f1" radius={[0, 3, 3, 0]}>
                    {pipelineData.map((entry, idx) => (
                      <Cell key={idx} fill={STAGE_COLORS[entry.stage] || "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Répartition des factures</CardTitle>
            <CardDescription>Par statut</CardDescription>
          </CardHeader>
          <CardContent>
            {facturesPieData.length === 0 ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">Aucune facture</div>
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie data={facturesPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${Math.round(percent * 100)}%`} labelLine={false}>
                    {facturesPieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {projets && projets.total > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><FolderKanban className="w-4 h-4 text-indigo-500" />Projets</CardTitle>
            <CardDescription>Vue d'ensemble des projets ({projets.total} au total)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-2xl font-bold text-amber-600">{projets.active}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Actifs</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-2xl font-bold text-emerald-600">{projets.termine}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Terminés</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className={`text-2xl font-bold ${projets.overdue > 0 ? "text-red-600" : "text-slate-600"}`}>{projets.overdue}</div>
                <div className="text-xs text-muted-foreground mt-0.5">En retard</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/30">
                <div className="text-2xl font-bold text-indigo-600">{projets.avgProgress}%</div>
                <div className="text-xs text-muted-foreground mt-0.5">Avancement moy.</div>
              </div>
            </div>
            {Number(projets.totalBudget) > 0 && (
              <div className="mt-4 flex gap-4 flex-wrap text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Budget total :</span>
                  <span className="font-medium">{fmt(Number(projets.totalBudget))}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Dépenses :</span>
                  <span className={`font-medium ${Number(projets.totalSpent) > Number(projets.totalBudget) ? "text-red-600" : "text-emerald-600"}`}>
                    {fmt(Number(projets.totalSpent))}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {topProducts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" />Top Articles en Stock</CardTitle>
            <CardDescription>Par valeur totale en stock</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topProducts.map((p, idx) => (
                <div key={idx} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                  <span className="text-xs font-bold text-muted-foreground w-5">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.category} · {p.quantity} unités @ {fmt(Number(p.unitPrice))}</p>
                  </div>
                  <div className="text-sm font-semibold text-emerald-600">{fmt(Number(p.totalValue))}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Taux de conversion devis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">{devis.conversionRate}%</span>
              <Target className="w-5 h-5 text-amber-500 mb-1" />
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">{devis.accepte} acceptés</Badge>
              <Badge variant="outline" className="text-xs">{devis.refuse} refusés</Badge>
              <Badge variant="outline" className="text-xs">{devis.expire} expirés</Badge>
              <Badge variant="outline" className="text-xs">{devis.envoye} en attente</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Taux de réussite prospects</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">
                {(prospects.gagne + prospects.perdu) > 0
                  ? Math.round((prospects.gagne / (prospects.gagne + prospects.perdu)) * 100)
                  : 0}%
              </span>
              <TrendingUp className="w-5 h-5 text-emerald-500 mb-1" />
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs text-emerald-600">{prospects.gagne} gagnés</Badge>
              <Badge variant="outline" className="text-xs text-red-500">{prospects.perdu} perdus</Badge>
              <Badge variant="outline" className="text-xs">{prospects.total - prospects.gagne - prospects.perdu} actifs</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Taux de recouvrement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">
                {Number(factures.totalAmount) > 0
                  ? Math.round((Number(factures.paidAmount) / Number(factures.totalAmount)) * 100)
                  : 0}%
              </span>
              <Euro className="w-5 h-5 text-blue-500 mb-1" />
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs text-emerald-600">{fmt(Number(factures.paidAmount))} payé</Badge>
              {factures.overdueCount > 0 && <Badge variant="destructive" className="text-xs">{factures.overdueCount} en retard</Badge>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
