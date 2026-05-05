import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, CreditCard, Send, AlertTriangle, CheckCircle, Clock, FileText,
  Building2, Key, Zap, RefreshCw, Mail, BanknoteIcon, Receipt, AlertCircle as AlertCircleIcon,
  Eye, Calendar, TrendingUp, Lock, Loader2, Plus, Trash2, CheckCircle2,
  DollarSign, Users, Phone, Bell, History, Settings2, Download, BarChart3, Printer,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LicenseManagementPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/license-management/dashboard`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur");
      setData(await res.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les donnees", variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      <Skeleton className="h-96" />
    </div>
  );

  if (!data) return <div className="p-6 text-center text-muted-foreground">Erreur de chargement</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-amber-500" />
            Gestion de Licence & Facturation
          </h1>
          <p className="text-sm text-muted-foreground">{data.organisation?.name} — Securite, paiements et factures</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="h-4 w-4 mr-2" />Actualiser</Button>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
        </div>
      </div>

      {data.securityAlerts?.length > 0 && (
        <div className="space-y-2">
          {data.securityAlerts.map((alert: any, i: number) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${alert.severity === "critique" ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800" : alert.severity === "alerte" ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800" : "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800"}`}>
              {alert.severity === "critique" ? <AlertTriangle className="h-5 w-5 shrink-0" /> : alert.severity === "alerte" ? <AlertCircleIcon className="h-5 w-5 shrink-0" /> : <Eye className="h-5 w-5 shrink-0" />}
              <span className="text-sm font-medium flex-1">{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <Card className="border-2 border-primary/20">
          <CardContent className="p-4 text-center">
            <Key className="h-5 w-5 mx-auto mb-2 text-amber-500" />
            <div className="text-xs text-muted-foreground">Plan</div>
            <div className="text-lg font-bold capitalize">{data.subscription?.plan || "N/A"}</div>
            <Badge variant={data.subscription?.status === "active" ? "default" : "destructive"} className="text-[10px] mt-1">{data.subscription?.status || "inconnu"}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-5 w-5 mx-auto mb-2 text-green-500" />
            <div className="text-xs text-muted-foreground">Abonnement mensuel</div>
            <div className="text-lg font-bold">{data.subscription?.price?.toFixed(2) || "0.00"} EUR</div>
            <div className="text-[10px] text-muted-foreground">par mois</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Receipt className="h-5 w-5 mx-auto mb-2 text-orange-500" />
            <div className="text-xs text-muted-foreground">A payer (abonnement)</div>
            <div className="text-lg font-bold text-orange-600">{data.billing?.totalOwed?.toFixed(2) || "0.00"} EUR</div>
            <div className="text-[10px] text-muted-foreground">{data.billing?.pendingCount || 0} factures</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <BanknoteIcon className="h-5 w-5 mx-auto mb-2 text-red-500" />
            <div className="text-xs text-muted-foreground">Creances clients</div>
            <div className="text-lg font-bold text-red-600">{data.clientBilling?.totalClientOwed?.toFixed(2) || "0.00"} EUR</div>
            <div className="text-[10px] text-muted-foreground">{data.clientBilling?.overdueCount || 0} en retard</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="overview" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="client-invoices" className="text-xs gap-1"><FileText className="h-3 w-3" />Factures clients</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs gap-1"><CreditCard className="h-3 w-3" />Paiements</TabsTrigger>
          <TabsTrigger value="reminders" className="text-xs gap-1"><Bell className="h-3 w-3" />Rappels</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs gap-1"><Settings2 className="h-3 w-3" />Parametres</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1"><History className="h-3 w-3" />Journal</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} onRefresh={fetchData} />
        </TabsContent>
        <TabsContent value="client-invoices">
          <ClientInvoicesTab data={data} onRefresh={fetchData} />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTab data={data} onRefresh={fetchData} />
        </TabsContent>
        <TabsContent value="reminders">
          <RemindersTab data={data} onRefresh={fetchData} />
        </TabsContent>
        <TabsContent value="settings">
          <BillingSettingsTab data={data} onRefresh={fetchData} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const sub = data.subscription;
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  const generateInvoice = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`${API}/api/license-management/auto-generate-invoice`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.success) { toast({ title: "Facture generee", description: `${d.invoice?.totalAmount?.toFixed(2)} EUR` }); onRefresh(); }
      else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setGenerating(false);
  };

  const usageLimits = [
    { label: "Utilisateurs actifs", current: sub?.currentUsers, max: sub?.maxUsers, icon: Users },
    { label: "Contacts", current: sub?.currentContacts, max: sub?.maxContacts, icon: Users },
    { label: "Appels ce mois", current: sub?.currentCallsMonth, max: sub?.maxCallsPerMonth, icon: Phone },
  ];

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4 text-amber-500" />Licence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground">Cle</span>
                <code className="font-mono text-amber-600 truncate text-[10px]">{sub?.licenseKey || "N/A"}</code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-semibold capitalize">{sub?.plan || "N/A"}</span>
              </div>
            </div>
            {sub?.trialDaysLeft !== null && sub?.trialDaysLeft !== undefined && (
              <div className={`p-2 rounded text-xs font-medium ${sub.trialDaysLeft <= 3 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400" : sub.trialDaysLeft <= 7 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"}`}>
                {sub.trialDaysLeft > 0 ? `Essai: ${sub.trialDaysLeft} jours restants` : "Essai expire"}
              </div>
            )}
            <Separator />
            <div className="space-y-3">
              {usageLimits.map((limit) => {
                const pct = limit.max ? Math.round(((limit.current || 0) / limit.max) * 100) : 0;
                const overLimit = pct > 100;
                return (
                  <div key={limit.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1"><limit.icon className="h-3 w-3 text-muted-foreground" />{limit.label}</div>
                      <span className={overLimit ? "text-red-600 font-semibold" : ""}>{limit.current ?? "—"} / {limit.max ?? "∞"}</span>
                    </div>
                    {limit.max && (
                      <Progress value={Math.min(pct, 100)} className={`h-1.5 ${overLimit ? "[&>div]:bg-red-500" : pct > 80 ? "[&>div]:bg-amber-500" : ""}`} />
                    )}
                  </div>
                );
              })}
            </div>
            <Separator />
            <div className="flex flex-wrap gap-1">
              {sub?.aiEnabled && <Badge variant="secondary" className="text-[10px]"><Zap className="h-3 w-3 mr-0.5" />IA</Badge>}
              {sub?.stockEnabled && <Badge variant="secondary" className="text-[10px]">Stock</Badge>}
              {sub?.automationEnabled && <Badge variant="secondary" className="text-[10px]">Automatisations</Badge>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-500" />Organisation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">IBAN</span><span className="font-mono">{data.organisation?.bankIban || <span className="text-red-500">Non configure</span>}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">BIC</span><span>{data.organisation?.bankBic || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SIRET</span><span>{data.organisation?.siret || <span className="text-red-500">Non configure</span>}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">TVA</span><span>{data.organisation?.tvaNumber || "—"}</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Facturation auto</span><Badge variant={data.organisation?.autoInvoiceEnabled ? "default" : "outline"} className="text-[10px]">{data.organisation?.autoInvoiceEnabled ? "Active" : "Inactive"}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Email auto factures</span><Badge variant={data.organisation?.autoEmailInvoice ? "default" : "outline"} className="text-[10px]">{data.organisation?.autoEmailInvoice ? "Active" : "Inactive"}</Badge></div>
            <Separator />
            <Button size="sm" variant="outline" className="w-full text-xs gap-2" onClick={generateInvoice} disabled={generating}>
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              Generer la facture du mois
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4 text-purple-500" />Historique des factures (abonnement)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.billing?.invoices?.length > 0 ? (
            <div className="space-y-1">
              {data.billing.invoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-xs">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{inv.periodLabel}</span>
                    <span className="text-muted-foreground capitalize">{inv.plan}</span>
                    {inv.overageAmount > 0 && <Badge variant="outline" className="text-[10px] text-orange-600">+{inv.overageAmount.toFixed(2)} EUR depassement</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{inv.totalAmount?.toFixed(2)} EUR</span>
                    <Badge variant={inv.status === "payee" ? "default" : inv.status === "en_attente" ? "secondary" : "destructive"} className="text-[10px]">
                      {inv.status === "payee" ? "Payee" : inv.status === "en_attente" ? "En attente" : inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">Aucune facture d'abonnement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClientInvoicesTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const { toast } = useToast();
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [markingId, setMarkingId] = useState<number | null>(null);
  const [reminderDialog, setReminderDialog] = useState<any>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("virement");

  const [newInvoice, setNewInvoice] = useState({
    clientName: "", clientEmail: "", clientPhone: "", clientCompany: "",
    title: "", dueDate: "", notes: "",
    items: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 20 }],
  });
  const [creating, setCreating] = useState(false);

  const sendInvoice = async (id: number) => {
    setSendingId(id);
    try {
      const r = await fetch(`${API}/api/license-management/send-invoice-email`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ factureClientId: id }),
      });
      const d = await r.json();
      if (d.success) { toast({ title: "Succes", description: d.message }); onRefresh(); }
      else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setSendingId(null);
  };

  const markPaid = async (id: number) => {
    setMarkingId(id);
    try {
      const r = await fetch(`${API}/api/license-management/mark-invoice-paid`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ factureClientId: id, paymentMethod: "virement" }),
      });
      const d = await r.json();
      if (d.success) { toast({ title: "Payee", description: d.message }); onRefresh(); }
      else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setMarkingId(null);
  };

  const recordPayment = async () => {
    if (!paymentDialog || !paymentAmount) return;
    try {
      const r = await fetch(`${API}/api/license-management/record-payment`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ factureClientId: paymentDialog.id, amount: parseFloat(paymentAmount), paymentMethod }),
      });
      const d = await r.json();
      if (d.success) {
        toast({ title: "Paiement enregistre", description: d.message });
        onRefresh();
        setPaymentDialog(null); setPaymentAmount("");
      } else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const sendReminder = async () => {
    if (!reminderDialog) return;
    try {
      const r = await fetch(`${API}/api/license-management/send-payment-reminder`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ factureClientId: reminderDialog.id, customMessage }),
      });
      const d = await r.json();
      if (d.success) { toast({ title: "Succes", description: `Rappel niveau ${d.reminderLevel} envoye` }); onRefresh(); }
      else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setReminderDialog(null); setCustomMessage("");
  };

  const createInvoice = async () => {
    setCreating(true);
    try {
      const r = await fetch(`${API}/api/license-management/create-client-invoice`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(newInvoice),
      });
      const d = await r.json();
      if (d.success) {
        toast({ title: "Facture creee", description: `${d.facture.reference} — ${d.facture.totalAmount.toFixed(2)} EUR` });
        onRefresh(); setCreateOpen(false);
        setNewInvoice({ clientName: "", clientEmail: "", clientPhone: "", clientCompany: "", title: "", dueDate: "", notes: "", items: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 20 }] });
      } else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setCreating(false);
  };

  const addItem = () => setNewInvoice(p => ({ ...p, items: [...p.items, { description: "", quantity: 1, unitPrice: 0, taxRate: 20 }] }));
  const removeItem = (i: number) => setNewInvoice(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, field: string, value: any) => setNewInvoice(p => ({ ...p, items: p.items.map((item, idx) => idx === i ? { ...item, [field]: value } : item) }));

  const invoices = data.clientBilling?.recentInvoices || [];
  const totalHT = newInvoice.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalTVA = newInvoice.items.reduce((s, i) => s + i.quantity * i.unitPrice * i.taxRate / 100, 0);
  const totalTTC = totalHT + totalTVA;

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-green-600">{data.clientBilling?.totalClientPaid?.toFixed(2) || "0.00"}</div>
          <div className="text-xs text-muted-foreground">EUR encaisses</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-orange-600">{data.clientBilling?.pendingCount || 0}</div>
          <div className="text-xs text-muted-foreground">En attente de paiement</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-red-600">{data.clientBilling?.overdueCount || 0}</div>
          <div className="text-xs text-muted-foreground">En retard</div>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Factures clients</CardTitle>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1 h-8">
              <Plus className="h-3 w-3" />Nouvelle facture
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80">
            <div className="space-y-2">
              {invoices.map((inv: any) => {
                const isOverdue = inv.status !== "payee" && inv.dueDate && new Date(inv.dueDate) < new Date();
                const remaining = (inv.totalAmount || 0) - (inv.paidAmount || 0);
                const paidPct = inv.totalAmount ? Math.round((inv.paidAmount / inv.totalAmount) * 100) : 0;
                return (
                  <div key={inv.id} className={`p-3 rounded-lg border ${isOverdue ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20" : "hover:bg-muted/50"}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold">{inv.reference}</span>
                        <span className="text-xs text-muted-foreground">{inv.clientName}</span>
                        {inv.clientEmail && <span className="text-xs text-muted-foreground hidden xl:inline">{inv.clientEmail}</span>}
                      </div>
                      <Badge variant={inv.status === "payee" ? "default" : inv.status === "envoyee" ? "secondary" : isOverdue ? "destructive" : "outline"} className="text-[10px]">
                        {inv.status === "payee" ? "Payee" : inv.status === "envoyee" ? "Envoyee" : isOverdue ? "En retard" : inv.status === "brouillon" ? "Brouillon" : inv.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span className="font-mono font-medium text-foreground">{inv.totalAmount?.toFixed(2)} EUR</span>
                        {inv.paidAmount > 0 && inv.status !== "payee" && <span className="text-green-600">Paye: {inv.paidAmount.toFixed(2)} EUR</span>}
                        {inv.dueDate && <span>Echeance: {format(new Date(inv.dueDate), "dd/MM/yyyy")}</span>}
                      </div>
                      {inv.status !== "payee" && (
                        <div className="flex gap-1 flex-wrap justify-end">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => sendInvoice(inv.id)} disabled={sendingId === inv.id}>
                            {sendingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-0.5" />}
                            Envoyer
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-blue-600 hover:text-blue-700" onClick={() => { setPaymentDialog(inv); setPaymentAmount(remaining.toFixed(2)); }}>
                            <DollarSign className="h-3 w-3 mr-0.5" />Paiement partiel
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-green-600 hover:text-green-700" onClick={() => markPaid(inv.id)} disabled={markingId === inv.id}>
                            {markingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                            Soldee
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-orange-600 hover:text-orange-700" onClick={() => setReminderDialog(inv)}>
                            <Bell className="h-3 w-3 mr-0.5" />Rappel
                          </Button>
                        </div>
                      )}
                    </div>
                    {inv.paidAmount > 0 && inv.status !== "payee" && (
                      <Progress value={paidPct} className="h-1 [&>div]:bg-green-500" />
                    )}
                  </div>
                );
              })}
              {invoices.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Aucune facture client — creez votre premiere facture</p>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" />Nouvelle facture client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Informations client</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Nom client *</Label><Input value={newInvoice.clientName} onChange={e => setNewInvoice(p => ({ ...p, clientName: e.target.value }))} placeholder="ACME SARL" /></div>
                <div className="space-y-1"><Label className="text-xs">Entreprise</Label><Input value={newInvoice.clientCompany} onChange={e => setNewInvoice(p => ({ ...p, clientCompany: e.target.value }))} placeholder="Nom de la societe" /></div>
                <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={newInvoice.clientEmail} onChange={e => setNewInvoice(p => ({ ...p, clientEmail: e.target.value }))} placeholder="client@exemple.fr" /></div>
                <div className="space-y-1"><Label className="text-xs">Telephone</Label><Input value={newInvoice.clientPhone} onChange={e => setNewInvoice(p => ({ ...p, clientPhone: e.target.value }))} placeholder="06 12 34 56 78" /></div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Facture</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1"><Label className="text-xs">Titre *</Label><Input value={newInvoice.title} onChange={e => setNewInvoice(p => ({ ...p, title: e.target.value }))} placeholder="Prestation de service — Mai 2026" /></div>
                <div className="space-y-1"><Label className="text-xs">Date d'echeance</Label><Input type="date" value={newInvoice.dueDate} onChange={e => setNewInvoice(p => ({ ...p, dueDate: e.target.value }))} /></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lignes de facturation</h4>
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={addItem}><Plus className="h-3 w-3" />Ajouter</Button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-1 text-[10px] text-muted-foreground font-medium px-1">
                  <span className="col-span-5">Description</span>
                  <span className="col-span-2 text-center">Qte</span>
                  <span className="col-span-2 text-right">Prix HT</span>
                  <span className="col-span-2 text-right">TVA %</span>
                  <span className="col-span-1" />
                </div>
                {newInvoice.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center">
                    <Input className="col-span-5 h-7 text-xs" value={item.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder="Prestation..." />
                    <Input className="col-span-2 h-7 text-xs text-center" type="number" min="1" value={item.quantity} onChange={e => updateItem(i, "quantity", parseFloat(e.target.value) || 1)} />
                    <Input className="col-span-2 h-7 text-xs text-right" type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(i, "unitPrice", parseFloat(e.target.value) || 0)} />
                    <Input className="col-span-2 h-7 text-xs text-right" type="number" min="0" max="100" value={item.taxRate} onChange={e => updateItem(i, "taxRate", parseFloat(e.target.value) || 0)} />
                    <Button size="sm" variant="ghost" className="col-span-1 h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => removeItem(i)} disabled={newInvoice.items.length === 1}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-3 bg-muted/50 rounded-lg space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Sous-total HT</span><span className="font-mono">{totalHT.toFixed(2)} EUR</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">TVA</span><span className="font-mono">{totalTVA.toFixed(2)} EUR</span></div>
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold"><span>Total TTC</span><span className="font-mono text-base">{totalTTC.toFixed(2)} EUR</span></div>
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Notes internes (optionnel)</Label><Textarea value={newInvoice.notes} onChange={e => setNewInvoice(p => ({ ...p, notes: e.target.value }))} placeholder="Conditions de paiement, mentions..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={createInvoice} disabled={creating || !newInvoice.clientName || !newInvoice.title}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
              Creer la facture
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentDialog} onOpenChange={() => setPaymentDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-blue-500" />Enregistrer un paiement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">Facture:</span> <span className="font-semibold">{paymentDialog?.reference}</span> — {paymentDialog?.clientName}</div>
            <div className="text-sm"><span className="text-muted-foreground">Reste a payer:</span> <span className="font-bold text-orange-600">{((paymentDialog?.totalAmount || 0) - (paymentDialog?.paidAmount || 0)).toFixed(2)} EUR</span></div>
            <div className="space-y-1"><Label className="text-xs">Montant recu (EUR)</Label><Input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0.00" /></div>
            <div className="space-y-1"><Label className="text-xs">Mode de paiement</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="virement">Virement bancaire</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="especes">Especes</SelectItem>
                  <SelectItem value="carte">Carte bancaire</SelectItem>
                  <SelectItem value="prelevement">Prelevement automatique</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>Annuler</Button>
            <Button onClick={recordPayment} disabled={!paymentAmount || parseFloat(paymentAmount) <= 0} className="bg-blue-500 hover:bg-blue-600">
              <DollarSign className="h-4 w-4 mr-2" />Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reminderDialog} onOpenChange={() => setReminderDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-orange-500" />Envoyer un rappel de paiement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">Facture:</span> <span className="font-semibold">{reminderDialog?.reference}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Client:</span> <span>{reminderDialog?.clientName} ({reminderDialog?.clientEmail})</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Montant restant:</span> <span className="font-bold text-red-600">{((reminderDialog?.totalAmount || 0) - (reminderDialog?.paidAmount || 0)).toFixed(2)} EUR</span></div>
            <div className="space-y-1"><Label className="text-xs">Message personnalise (optionnel)</Label><Textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} placeholder="Ajoutez un message personnalise..." rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderDialog(null)}>Annuler</Button>
            <Button onClick={sendReminder} className="bg-orange-500 hover:bg-orange-600"><Send className="h-4 w-4 mr-2" />Envoyer le rappel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const payments = data.payments || [];
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4 text-green-500" />Paiements d'abonnement recus</CardTitle>
          </div>
          <CardDescription className="text-xs">Historique des virements bancaires pour votre abonnement Agent de Bureau</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            {payments.length > 0 ? (
              <div className="space-y-1">
                {payments.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-xs">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${p.status === "matched" ? "bg-green-500" : p.status === "pending" ? "bg-amber-500" : "bg-gray-400"}`} />
                      <span className="font-medium">{p.payerName || "Inconnu"}</span>
                      {p.bankRef && <code className="text-[10px] text-muted-foreground">{p.bankRef}</code>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{p.amount?.toFixed(2)} EUR</span>
                      <Badge variant={p.status === "matched" ? "default" : "secondary"} className="text-[10px]">{p.status === "matched" ? "Associe" : p.status === "pending" ? "En attente" : p.status}</Badge>
                      {p.bankDate && <span className="text-muted-foreground">{format(new Date(p.bankDate), "dd/MM/yyyy")}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-muted-foreground space-y-1">
                <CreditCard className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <p>Aucun paiement d'abonnement enregistre</p>
                <p className="text-[10px]">Les paiements des clients pour leurs factures se gerent dans l'onglet "Factures clients"</p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function RemindersTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const runAutoReminders = async () => {
    setRunning(true);
    try {
      const r = await fetch(`${API}/api/license-management/auto-reminders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      });
      const d = await r.json();
      if (d.success) {
        toast({ title: "Succes", description: `${d.sent} rappel${d.sent > 1 ? "s" : ""} envoye${d.sent > 1 ? "s" : ""} (${d.skipped} ignore${d.skipped > 1 ? "s" : ""} sur ${d.total} en retard)` });
        onRefresh();
      } else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setRunning(false);
  };

  const reminders = data.reminders || [];

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4 text-amber-500" />Rappels de paiement</h3>
        <Button onClick={runAutoReminders} disabled={running} className="bg-amber-500 hover:bg-amber-600">
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Envoyer les rappels automatiques
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-80">
            {reminders.length > 0 ? (
              <div className="divide-y">
                {reminders.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between p-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${r.status === "sent" ? "bg-green-500" : r.status === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.recipientName || r.recipientEmail}</div>
                        <div className="text-muted-foreground truncate">{r.subject}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px]">Niveau {r.reminderLevel}</Badge>
                      <Badge variant={r.status === "sent" ? "default" : "destructive"} className="text-[10px]">{r.status === "sent" ? "Envoye" : r.status === "failed" ? "Echec" : r.status}</Badge>
                      {r.sentAt && <span className="text-muted-foreground">{format(new Date(r.sentAt), "dd/MM HH:mm")}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-xs">Aucun rappel envoye</div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function BillingSettingsTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [bankIban, setBankIban] = useState("");
  const [bankBic, setBankBic] = useState(data.organisation?.bankBic || "");
  const [siret, setSiret] = useState(data.organisation?.siret || "");
  const [tvaNumber, setTvaNumber] = useState(data.organisation?.tvaNumber || "");
  const [invoiceFooter, setInvoiceFooter] = useState(data.organisation?.invoiceFooter || "");
  const [autoInvoice, setAutoInvoice] = useState(data.organisation?.autoInvoiceEnabled ?? true);
  const [autoEmail, setAutoEmail] = useState(data.organisation?.autoEmailInvoice ?? true);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = { bankBic, siret, tvaNumber, invoiceFooter, autoInvoiceEnabled: autoInvoice, autoEmailInvoice: autoEmail };
    if (bankIban.trim()) payload.bankIban = bankIban.trim();
    try {
      const r = await fetch(`${API}/api/license-management/update-billing-settings`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (d.success) { toast({ title: "Enregistre", description: "Parametres mis a jour" }); setBankIban(""); onRefresh(); }
      else throw new Error(d.error || "Erreur");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-500" />Coordonnees bancaires</CardTitle>
          <CardDescription className="text-xs">Ces informations apparaissent sur vos factures et rappels de paiement</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">IBAN</Label>
                {data.organisation?.bankIban && (
                  <span className="text-[10px] text-muted-foreground font-mono">{data.organisation.bankIban}</span>
                )}
              </div>
              <Input value={bankIban} onChange={e => setBankIban(e.target.value)} placeholder="FR76 1234 5678 9012 3456 7890 123" />
              {data.organisation?.bankIban && (
                <p className="text-[10px] text-muted-foreground mt-1">Laissez vide pour conserver l'IBAN actuel</p>
              )}
            </div>
            <div className="space-y-1"><Label className="text-xs">BIC/SWIFT</Label><Input value={bankBic} onChange={e => setBankBic(e.target.value)} placeholder="BNPAFRPP" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">SIRET</Label><Input value={siret} onChange={e => setSiret(e.target.value)} placeholder="123 456 789 00012" /></div>
            <div className="space-y-1"><Label className="text-xs">N° TVA intracommunautaire</Label><Input value={tvaNumber} onChange={e => setTvaNumber(e.target.value)} placeholder="FR 12 123456789" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Mentions legales / pied de facture</Label><Textarea value={invoiceFooter} onChange={e => setInvoiceFooter(e.target.value)} placeholder="Conditions de paiement, mentions legales..." rows={3} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />Automatisations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Facturation automatique mensuelle</div>
              <div className="text-xs text-muted-foreground">Genere automatiquement les factures d'abonnement chaque mois</div>
            </div>
            <Switch checked={autoInvoice} onCheckedChange={setAutoInvoice} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Envoi automatique par email</div>
              <div className="text-xs text-muted-foreground">Envoie les factures et rappels par email automatiquement</div>
            </div>
            <Switch checked={autoEmail} onCheckedChange={setAutoEmail} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          Enregistrer les parametres
        </Button>
      </div>
    </div>
  );
}

function AuditTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/api/license-management/audit-log`, { credentials: "include" });
        if (r.ok) {
          const d = await r.json();
          setLogs(d.logs || []);
        }
      } catch {
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="mt-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

  return (
    <div className="mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-indigo-500" />Journal d'audit — Licence & Facturation</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80">
            {logs.length > 0 ? (
              <div className="space-y-1">
                {logs.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 p-2 rounded hover:bg-muted/50 text-xs">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${log.action.includes("error") || log.action.includes("fail") ? "bg-red-500" : log.action.includes("sent") || log.action.includes("generated") || log.action.includes("created") || log.action.includes("paid") || log.action.includes("recorded") ? "bg-green-500" : "bg-blue-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{log.action.replace(/_/g, " ")}</div>
                      <div className="text-muted-foreground truncate">{log.details}</div>
                    </div>
                    <span className="text-muted-foreground shrink-0">{format(new Date(log.createdAt), "dd/MM HH:mm")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-8 text-muted-foreground text-xs">Aucune entree dans le journal</p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
