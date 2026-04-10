import { useState, useEffect, useCallback } from "react";
import {
  Wallet, Search, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  TrendingDown, TrendingUp, Clock, Mail, Shield, Eye, ChevronLeft,
  Building2, CreditCard, BarChart3, Users, Loader2, ArrowUpDown,
  ShieldAlert, ShieldCheck, Activity, Settings2, Save
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon3D } from "@/components/icon-3d";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const riskColors: Record<string, string> = {
  faible: "bg-green-100 text-green-800",
  moyen: "bg-yellow-100 text-yellow-800",
  eleve: "bg-orange-100 text-orange-800",
  critique: "bg-red-100 text-red-800",
};
const riskIcons: Record<string, any> = {
  faible: ShieldCheck,
  moyen: Shield,
  eleve: ShieldAlert,
  critique: XCircle,
};
const statusColors: Record<string, string> = {
  actif: "bg-green-100 text-green-800",
  en_attente: "bg-yellow-100 text-yellow-800",
  suspendu: "bg-orange-100 text-orange-800",
  bloque: "bg-red-100 text-red-800",
};
const statusLabels: Record<string, string> = {
  actif: "Actif",
  en_attente: "En attente",
  suspendu: "Suspendu",
  bloque: "Bloque",
};

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : score >= 30 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium">{score}</span>
    </div>
  );
}

function AgingChart({ data }: { data: { a0to30: number; a31to60: number; a61to90: number; a90plus: number } }) {
  const total = data.a0to30 + data.a31to60 + data.a61to90 + data.a90plus;
  if (total === 0) return <p className="text-xs text-muted-foreground">Aucune creance</p>;
  const segments = [
    { label: "0-30j", value: data.a0to30, color: "bg-green-400" },
    { label: "31-60j", value: data.a31to60, color: "bg-yellow-400" },
    { label: "61-90j", value: data.a61to90, color: "bg-orange-400" },
    { label: "90j+", value: data.a90plus, color: "bg-red-400" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-4 rounded-full overflow-hidden">
        {segments.map((seg) => seg.value > 0 && (
          <div key={seg.label} className={`${seg.color}`} style={{ width: `${(seg.value / total) * 100}%` }} title={`${seg.label}: ${seg.value.toFixed(2)} €`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${seg.color}`} />
            <span>{seg.label}: <strong>{seg.value.toFixed(0)} €</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountDetail({ accountId, onBack }: { accountId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [account, setAccount] = useState<any>(null);
  const [factures, setFactures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ creditLimit: "", paymentTermDays: 30, autoReminderEnabled: true, notes: "", status: "actif" });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${BASE}/api/comptes-clients/${accountId}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setAccount(data.account);
          setFactures(data.factures || []);
          setEditForm({
            creditLimit: data.account.creditLimit || "10000",
            paymentTermDays: data.account.paymentTermDays || 30,
            autoReminderEnabled: data.account.autoReminderEnabled ?? true,
            notes: data.account.notes || "",
            status: data.account.status || "actif",
          });
        }
      } catch { /* ignore */ } finally { setLoading(false); }
    };
    load();
  }, [accountId]);

  const sendReminder = async () => {
    setSending(true);
    try {
      const res = await fetch(`${BASE}/api/comptes-clients/${accountId}/send-reminder`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok) toast({ title: "Rappel envoye", description: data.message });
      else toast({ title: "Erreur", description: data.error, variant: "destructive" });
    } catch { toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" }); }
    finally { setSending(false); }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/comptes-clients/${accountId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        const updated = await res.json();
        setAccount(updated);
        toast({ title: "Enregistre", description: "Parametres du compte mis a jour." });
      }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!account) return <div className="text-center py-12 text-muted-foreground">Compte non trouve</div>;

  const RiskIcon = riskIcons[account.riskLevel] || Shield;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}><ChevronLeft className="h-5 w-5" /></Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-indigo-500" /> {account.clientName}
          </h2>
          {account.clientCompany && <p className="text-sm text-muted-foreground">{account.clientCompany}</p>}
        </div>
        <Badge className={riskColors[account.riskLevel]}><RiskIcon className="h-3 w-3 mr-1" />Risque {account.riskLevel}</Badge>
        <Badge className={statusColors[account.status]}>{statusLabels[account.status]}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Score de sante</p>
          <div className="text-2xl font-bold mt-1">{account.healthScore}/100</div>
          <HealthBar score={account.healthScore} />
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Solde impaye</p>
          <div className={`text-2xl font-bold mt-1 ${Number(account.solde) > 0 ? "text-red-600" : "text-green-600"}`}>{Number(account.solde).toFixed(2)} €</div>
          <p className="text-xs text-muted-foreground">Limite: {Number(account.creditLimit).toFixed(0)} €</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Factures en retard</p>
          <div className="text-2xl font-bold mt-1 text-orange-600">{account.nbFacturesEnRetard}</div>
          <p className="text-xs text-muted-foreground">{Number(account.montantEnRetard).toFixed(2)} € en retard</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Delai moyen</p>
          <div className="text-2xl font-bold mt-1">{account.delaiMoyenPaiement}j</div>
          <p className="text-xs text-muted-foreground">Terme: {account.paymentTermDays} jours</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-500" />Analyse de vieillissement</CardTitle></CardHeader>
          <CardContent>
            <AgingChart data={{ a0to30: Number(account.aging0to30), a31to60: Number(account.aging31to60), a61to90: Number(account.aging61to90), a90plus: Number(account.aging90plus) }} />
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Total facture:</span> <strong>{Number(account.totalFacture).toFixed(2)} €</strong></div>
              <div><span className="text-muted-foreground">Total paye:</span> <strong className="text-green-600">{Number(account.totalPaye).toFixed(2)} €</strong></div>
              <div><span className="text-muted-foreground">Factures:</span> <strong>{account.nbFactures}</strong></div>
              <div><span className="text-muted-foreground">Payees:</span> <strong className="text-green-600">{account.nbFacturesPayees}</strong></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Settings2 className="h-4 w-4 text-amber-500" />Parametres du compte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Limite de credit (€)</Label>
                <Input type="number" value={editForm.creditLimit} onChange={e => setEditForm({ ...editForm, creditLimit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delai de paiement (jours)</Label>
                <Input type="number" value={editForm.paymentTermDays} onChange={e => setEditForm({ ...editForm, paymentTermDays: parseInt(e.target.value) || 30 })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Statut</Label>
              <Select value={editForm.status} onValueChange={v => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="actif">Actif</SelectItem>
                  <SelectItem value="en_attente">En attente</SelectItem>
                  <SelectItem value="suspendu">Suspendu</SelectItem>
                  <SelectItem value="bloque">Bloque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-2 rounded border bg-muted/30">
              <Label className="text-xs">Rappels automatiques</Label>
              <Switch checked={editForm.autoReminderEnabled} onCheckedChange={v => setEditForm({ ...editForm, autoReminderEnabled: v })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes internes</Label>
              <Textarea rows={2} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Notes sur ce client..." />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveSettings} disabled={saving} size="sm" className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Enregistrer
              </Button>
              {Number(account.montantEnRetard) > 0 && account.clientEmail && (
                <Button onClick={sendReminder} disabled={sending} variant="destructive" size="sm" className="gap-1">
                  {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}Envoyer un rappel
                </Button>
              )}
            </div>
            {account.lastReminderAt && (
              <p className="text-xs text-muted-foreground">Dernier rappel: {new Date(account.lastReminderAt).toLocaleDateString("fr-FR")} ({account.reminderCount} envoyes)</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4 text-green-500" />Historique des factures ({factures.length})</CardTitle></CardHeader>
        <CardContent>
          {factures.length === 0 ? <p className="text-sm text-muted-foreground">Aucune facture</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left p-2">Reference</th><th className="text-left p-2">Titre</th>
                  <th className="text-right p-2">Montant</th><th className="text-right p-2">Paye</th>
                  <th className="text-center p-2">Statut</th><th className="text-center p-2">Echeance</th>
                </tr></thead>
                <tbody>{factures.map((f: any) => (
                  <tr key={f.id} className="border-b hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{f.reference}</td>
                    <td className="p-2">{f.title}</td>
                    <td className="p-2 text-right font-medium">{Number(f.totalAmount).toFixed(2)} €</td>
                    <td className="p-2 text-right text-green-600">{Number(f.paidAmount).toFixed(2)} €</td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className={f.status === "payee" ? "text-green-600" : f.status === "envoyee" ? "text-blue-600" : f.status === "partielle" ? "text-yellow-600" : "text-gray-500"}>
                        {f.status}
                      </Badge>
                    </td>
                    <td className="p-2 text-center text-xs">{f.dueDate ? new Date(f.dueDate).toLocaleDateString("fr-FR") : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ComptesClientsPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("health_asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (riskFilter !== "all") params.set("risk", riskFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("sort", sort);
      const [accRes, dashRes] = await Promise.all([
        fetch(`${BASE}/api/comptes-clients?${params}`, { credentials: "include" }),
        fetch(`${BASE}/api/comptes-clients/dashboard`, { credentials: "include" }),
      ]);
      if (accRes.ok) { const d = await accRes.json(); setAccounts(d.accounts || []); }
      if (dashRes.ok) setDashboard(await dashRes.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [search, riskFilter, statusFilter, sort]);

  useEffect(() => { loadData(); }, [loadData]);

  const syncAccounts = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE}/api/comptes-clients/sync`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Synchronisation terminee", description: data.message });
        loadData();
      }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setSyncing(false); }
  };

  if (selectedId) return <AccountDetail accountId={selectedId} onBack={() => { setSelectedId(null); loadData(); }} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={Wallet} variant="emerald" size="md" /> Comptes Clients
          </h1>
          <p className="text-muted-foreground">Surveillance automatique de la sante financiere de vos clients.</p>
        </div>
        <Button onClick={syncAccounts} disabled={syncing} variant="outline" className="gap-2">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Synchroniser
        </Button>
      </div>

      {dashboard && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Card><CardContent className="pt-4 text-center">
              <Users className="h-5 w-5 mx-auto text-indigo-500 mb-1" />
              <div className="text-2xl font-bold">{dashboard.totalAccounts}</div>
              <p className="text-xs text-muted-foreground">Comptes total</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 text-center">
              <Activity className="h-5 w-5 mx-auto text-blue-500 mb-1" />
              <div className="text-2xl font-bold">{dashboard.avgHealthScore}</div>
              <p className="text-xs text-muted-foreground">Score moyen</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 text-center">
              <TrendingUp className="h-5 w-5 mx-auto text-green-500 mb-1" />
              <div className="text-xl font-bold text-green-600">{dashboard.totalPaye?.toFixed(0)} €</div>
              <p className="text-xs text-muted-foreground">Total encaisse</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 text-center">
              <TrendingDown className="h-5 w-5 mx-auto text-red-500 mb-1" />
              <div className="text-xl font-bold text-red-600">{dashboard.totalSolde?.toFixed(0)} €</div>
              <p className="text-xs text-muted-foreground">Total impaye</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 text-center">
              <Clock className="h-5 w-5 mx-auto text-orange-500 mb-1" />
              <div className="text-xl font-bold text-orange-600">{dashboard.totalEnRetard?.toFixed(0)} €</div>
              <p className="text-xs text-muted-foreground">En retard</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4 text-center">
              <AlertTriangle className="h-5 w-5 mx-auto text-amber-500 mb-1" />
              <div className="text-2xl font-bold">{dashboard.avgPaymentDays}j</div>
              <p className="text-xs text-muted-foreground">Delai moyen</p>
            </CardContent></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" />Vieillissement global</CardTitle></CardHeader>
              <CardContent>
                <AgingChart data={dashboard.agingTotal} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" />Distribution des risques</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Faible", key: "faible", color: "bg-green-500", icon: ShieldCheck },
                    { label: "Moyen", key: "moyen", color: "bg-yellow-500", icon: Shield },
                    { label: "Eleve", key: "eleve", color: "bg-orange-500", icon: ShieldAlert },
                    { label: "Critique", key: "critique", color: "bg-red-500", icon: XCircle },
                  ].map(r => (
                    <div key={r.key} className="text-center p-2 rounded-lg border bg-muted/20">
                      <r.icon className={`h-5 w-5 mx-auto mb-1 ${r.key === "faible" ? "text-green-500" : r.key === "moyen" ? "text-yellow-500" : r.key === "eleve" ? "text-orange-500" : "text-red-500"}`} />
                      <div className="text-xl font-bold">{dashboard.riskDistribution?.[r.key] ?? 0}</div>
                      <p className="text-xs text-muted-foreground">{r.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {dashboard.topRiskAccounts?.length > 0 && (
            <Card className="border-red-200 bg-red-50/30 dark:bg-red-950/10">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Comptes a risque ({dashboard.topRiskAccounts.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {dashboard.topRiskAccounts.map((a: any) => (
                    <button key={a.id} onClick={() => setSelectedId(a.id)} className="flex items-center gap-3 p-3 rounded-lg border bg-white dark:bg-card hover:bg-muted/50 text-left transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{a.clientName}</p>
                        <p className="text-xs text-muted-foreground">{Number(a.solde).toFixed(0)} € impaye</p>
                      </div>
                      <HealthBar score={a.healthScore} />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Rechercher un compte..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Risque" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous risques</SelectItem>
                <SelectItem value="faible">Faible</SelectItem>
                <SelectItem value="moyen">Moyen</SelectItem>
                <SelectItem value="eleve">Eleve</SelectItem>
                <SelectItem value="critique">Critique</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="actif">Actif</SelectItem>
                <SelectItem value="suspendu">Suspendu</SelectItem>
                <SelectItem value="bloque">Bloque</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="health_asc">Sante (croissant)</SelectItem>
                <SelectItem value="health_desc">Sante (decroissant)</SelectItem>
                <SelectItem value="solde_desc">Solde (decroissant)</SelectItem>
                <SelectItem value="retard_desc">Retards (decroissant)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-12">
              <Wallet className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">Aucun compte client.</p>
              <p className="text-xs text-muted-foreground mt-1">Cliquez sur "Synchroniser" pour generer les comptes a partir de vos factures.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left p-2">Client</th>
                  <th className="text-center p-2">Sante</th>
                  <th className="text-center p-2">Risque</th>
                  <th className="text-center p-2">Statut</th>
                  <th className="text-right p-2">Solde</th>
                  <th className="text-right p-2">En retard</th>
                  <th className="text-center p-2">Factures</th>
                  <th className="text-center p-2">Delai moy.</th>
                  <th className="text-center p-2">Rappels</th>
                  <th className="p-2"></th>
                </tr></thead>
                <tbody>{accounts.map((a: any) => {
                  const RIcon = riskIcons[a.riskLevel] || Shield;
                  return (
                    <tr key={a.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedId(a.id)}>
                      <td className="p-2">
                        <div className="font-medium">{a.clientName}</div>
                        {a.clientCompany && <div className="text-xs text-muted-foreground">{a.clientCompany}</div>}
                      </td>
                      <td className="p-2 text-center"><HealthBar score={a.healthScore} /></td>
                      <td className="p-2 text-center"><Badge className={`${riskColors[a.riskLevel]} text-xs`}><RIcon className="h-3 w-3 mr-1" />{a.riskLevel}</Badge></td>
                      <td className="p-2 text-center"><Badge className={`${statusColors[a.status]} text-xs`}>{statusLabels[a.status]}</Badge></td>
                      <td className={`p-2 text-right font-medium ${Number(a.solde) > 0 ? "text-red-600" : "text-green-600"}`}>{Number(a.solde).toFixed(0)} €</td>
                      <td className="p-2 text-right text-orange-600">{Number(a.montantEnRetard).toFixed(0)} €</td>
                      <td className="p-2 text-center">{a.nbFacturesPayees}/{a.nbFactures}</td>
                      <td className="p-2 text-center">{a.delaiMoyenPaiement}j</td>
                      <td className="p-2 text-center">{a.reminderCount > 0 ? <Badge variant="outline" className="text-xs">{a.reminderCount}</Badge> : "—"}</td>
                      <td className="p-2"><Eye className="h-4 w-4 text-muted-foreground" /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
