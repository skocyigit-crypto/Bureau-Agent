import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
Activity,
AlertCircle as AlertCircleIcon,
AlertTriangle,
ArrowUpRight,
BanknoteIcon,
BarChart3,
Bell,
BookUser,Brain,
Building2,
Calendar,
Check,
CheckCircle,
CheckCircle2,
ChevronLeft,ChevronRight,
Clock,
CreditCard,
Crown,
DollarSign,
Download,
Eye,
FileText,
History,
Key,
KeyRound,
Loader2,
Package,
Phone,
Plus,
Printer,
Receipt,
RefreshCw,
Search,
Send,
Settings2,
Shield,
Trash2,
Users,
X,
Zap
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

function AccessDenied() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
        <Shield className="w-8 h-8 text-red-500" />
      </div>
      <h2 className="text-xl font-bold">{t("licenseManagement.accessDenied.title")}</h2>
      <p className="text-muted-foreground max-w-md">
        {t("licenseManagement.accessDenied.desc")}
      </p>
    </div>
  );
}

export default function LicenseManagementPage() {
  const { isAtLeast } = useWorkspaceUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [deepLinkInvoice, setDeepLinkInvoice] = useState<any>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  const reloadDeepLinkInvoice = useCallback(async (id: number) => {
    try {
      const r = await fetch(`${API}/api/license-management/client-invoices/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("introuvable");
      setDeepLinkInvoice(await r.json());
    } catch {
      toast({ title: t("licenseManagement.toast.error"), description: t("licenseManagement.cannotOpenInvoice"), variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fId = params.get("factureId");
    if (!fId || isNaN(parseInt(fId))) return;
    const id = parseInt(fId);
    window.history.replaceState({}, "", window.location.pathname);
    setTab("client-invoices");
    reloadDeepLinkInvoice(id);
  }, [reloadDeepLinkInvoice]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/license-management/dashboard`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur");
      setData(await res.json());
    } catch {
      toast({ title: t("licenseManagement.toast.error"), description: t("licenseManagement.cannotLoad"), variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!isAtLeast("administrateur")) return <AccessDenied />;

  if (loading) return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      <Skeleton className="h-96" />
    </div>
  );

  if (!data) return <div className="p-6 text-center text-muted-foreground">{t("licenseManagement.loadError")}</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-amber-500" />
            {t("licenseManagement.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("licenseManagement.header.subtitle", { org: data.organisation?.name || "" })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="h-4 w-4 mr-2" />{t("licenseManagement.header.refresh")}</Button>
          <Button variant="outline" size="icon" title={t("licenseManagement.header.print")} onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
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
            <div className="text-xs text-muted-foreground">{t("licenseManagement.stat.plan")}</div>
            <div className="text-lg font-bold capitalize">{data.subscription?.plan || "N/A"}</div>
            <Badge variant={data.subscription?.status === "active" ? "default" : "destructive"} className="text-[10px] mt-1">{data.subscription?.status || t("licenseManagement.stat.statusUnknown")}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-5 w-5 mx-auto mb-2 text-green-500" />
            <div className="text-xs text-muted-foreground">{t("licenseManagement.stat.monthlySub")}</div>
            <div className="text-lg font-bold">{data.subscription?.price?.toFixed(2) || "0.00"} EUR</div>
            <div className="text-[10px] text-muted-foreground">{t("licenseManagement.stat.perMonth")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Receipt className="h-5 w-5 mx-auto mb-2 text-orange-500" />
            <div className="text-xs text-muted-foreground">{t("licenseManagement.stat.toPay")}</div>
            <div className="text-lg font-bold text-orange-600">{data.billing?.totalOwed?.toFixed(2) || "0.00"} EUR</div>
            <div className="text-[10px] text-muted-foreground">{t("licenseManagement.stat.invoicesCount", { count: data.billing?.pendingCount || 0 })}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <BanknoteIcon className="h-5 w-5 mx-auto mb-2 text-red-500" />
            <div className="text-xs text-muted-foreground">{t("licenseManagement.stat.receivables")}</div>
            <div className="text-lg font-bold text-red-600">{data.clientBilling?.totalClientOwed?.toFixed(2) || "0.00"} EUR</div>
            <div className="text-[10px] text-muted-foreground">{t("licenseManagement.stat.overdueCount", { count: data.clientBilling?.overdueCount || 0 })}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-8 w-full">
          <TabsTrigger value="overview" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />{t("licenseManagement.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="abonnement" className="text-xs gap-1"><KeyRound className="h-3 w-3" />{t("licenseManagement.tabs.abonnement")}</TabsTrigger>
          <TabsTrigger value="client-invoices" className="text-xs gap-1"><FileText className="h-3 w-3" />{t("licenseManagement.tabs.clientInvoices")}</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs gap-1"><CreditCard className="h-3 w-3" />{t("licenseManagement.tabs.payments")}</TabsTrigger>
          <TabsTrigger value="reminders" className="text-xs gap-1"><Bell className="h-3 w-3" />{t("licenseManagement.tabs.reminders")}</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs gap-1"><Settings2 className="h-3 w-3" />{t("licenseManagement.tabs.settings")}</TabsTrigger>
          <TabsTrigger value="licence-audit" className="text-xs gap-1"><History className="h-3 w-3" />{t("licenseManagement.tabs.licenceAudit")}</TabsTrigger>
          <TabsTrigger value="audit-systeme" className="text-xs gap-1"><Shield className="h-3 w-3" />{t("licenseManagement.tabs.auditSysteme")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} onRefresh={fetchData} />
        </TabsContent>
        <TabsContent value="abonnement">
          <AbonnementTab />
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
        <TabsContent value="licence-audit">
          <LicenceAuditTab />
        </TabsContent>
        <TabsContent value="audit-systeme">
          <SystemAuditTab />
        </TabsContent>
      </Tabs>

      <InvoiceDetailDialog
        invoice={deepLinkInvoice}
        onClose={() => setDeepLinkInvoice(null)}
        onRefresh={fetchData}
        onReloadInvoice={reloadDeepLinkInvoice}
      />
    </div>
  );
}

function InvoiceDetailDialog({ invoice, onClose, onRefresh, onReloadInvoice }: { invoice: any; onClose: () => void; onRefresh: () => void; onReloadInvoice: (id: number) => Promise<void> }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<null | "send" | "paid" | "payment" | "reminder">(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("virement");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState("");

  if (!invoice) return null;
  const remaining = (invoice.totalAmount || 0) - (invoice.paidAmount || 0);
  const isOverdue = invoice.status !== "payee" && invoice.dueDate && new Date(invoice.dueDate) < new Date();
  const isPaid = invoice.status === "payee";

  const callAction = async (kind: "send" | "paid" | "payment" | "reminder", url: string, body: any, successMsg: (d: any) => string) => {
    setBusy(kind);
    try {
      const r = await fetch(`${API}${url}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || t("licenseManagement.toast.error"));
      toast({ title: t("licenseManagement.toast.success"), description: successMsg(d) });
      await Promise.all([onReloadInvoice(invoice.id), Promise.resolve(onRefresh())]);
      return true;
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidMethod, setMarkPaidMethod] = useState("virement");
  const sendInvoice = () => callAction("send", "/api/license-management/send-invoice-email", { factureClientId: invoice.id }, (d) => d.message || t("licenseManagement.toastMsg.invoiceSent"));
  const markPaid = async () => {
    const ok = await callAction("paid", "/api/license-management/mark-invoice-paid", { factureClientId: invoice.id, paymentMethod: markPaidMethod }, (d) => d.message || t("licenseManagement.toastMsg.invoicePaid"));
    if (ok) setMarkPaidOpen(false);
  };
  const recordPayment = async () => {
    if (!paymentAmount) return;
    const ok = await callAction("payment", "/api/license-management/record-payment", { factureClientId: invoice.id, amount: parseFloat(paymentAmount), paymentMethod }, (d) => d.message || t("licenseManagement.toastMsg.paymentRecorded"));
    if (ok) { setPaymentOpen(false); setPaymentAmount(""); }
  };
  const sendReminder = async () => {
    const ok = await callAction("reminder", "/api/license-management/send-payment-reminder", { factureClientId: invoice.id, customMessage }, (d) => t("licenseManagement.toastMsg.reminderSent", { level: d.reminderLevel }));
    if (ok) { setReminderOpen(false); setCustomMessage(""); }
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            {t("licenseManagement.dialog.invoiceTitle", { ref: invoice.reference })}
          </DialogTitle>
          <DialogDescription>{invoice.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <Badge variant={invoice.status === "payee" ? "default" : invoice.status === "envoyee" ? "secondary" : isOverdue ? "destructive" : "outline"}>
              {invoice.status === "payee" ? t("licenseManagement.status.payee") : invoice.status === "envoyee" ? t("licenseManagement.status.envoyee") : isOverdue ? t("licenseManagement.status.enRetard") : invoice.status === "brouillon" ? t("licenseManagement.status.brouillon") : invoice.status}
            </Badge>
            <span className="text-xs text-muted-foreground">{t("licenseManagement.dialog.createdOn", { date: format(new Date(invoice.createdAt), "dd/MM/yyyy", { locale: fr }) })}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/50">
            <div><div className="text-xs text-muted-foreground">{t("licenseManagement.dialog.client")}</div><div className="font-semibold">{invoice.clientName}</div></div>
            {invoice.clientCompany && <div><div className="text-xs text-muted-foreground">{t("licenseManagement.dialog.company")}</div><div>{invoice.clientCompany}</div></div>}
            {invoice.clientEmail && <div><div className="text-xs text-muted-foreground">{t("licenseManagement.dialog.email")}</div><div>{invoice.clientEmail}</div></div>}
            {invoice.clientPhone && <div><div className="text-xs text-muted-foreground">{t("licenseManagement.dialog.phone")}</div><div>{invoice.clientPhone}</div></div>}
            {invoice.dueDate && <div><div className="text-xs text-muted-foreground">{t("licenseManagement.dialog.dueDate")}</div><div>{format(new Date(invoice.dueDate), "dd/MM/yyyy", { locale: fr })}</div></div>}
          </div>
          {Array.isArray(invoice.items) && invoice.items.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase">{t("licenseManagement.dialog.lines")}</div>
              <div className="space-y-1">
                {invoice.items.map((it: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs border-b pb-1">
                    <span className="flex-1 truncate">{it.description}</span>
                    <span className="text-muted-foreground mx-2">x{it.quantity}</span>
                    <span className="font-mono">{((it.total ?? it.quantity * it.unitPrice) || 0).toFixed(2)} EUR</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Separator />
          <div className="space-y-1">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t("licenseManagement.dialog.subtotalHT")}</span><span className="font-mono">{(invoice.subtotal || 0).toFixed(2)} EUR</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t("licenseManagement.dialog.tva")}</span><span className="font-mono">{(invoice.taxAmount || 0).toFixed(2)} EUR</span></div>
            <div className="flex justify-between font-semibold"><span>{t("licenseManagement.dialog.totalTTC")}</span><span className="font-mono">{(invoice.totalAmount || 0).toFixed(2)} EUR</span></div>
            {invoice.paidAmount > 0 && <div className="flex justify-between text-xs text-green-600"><span>{t("licenseManagement.dialog.paid")}</span><span className="font-mono">{invoice.paidAmount.toFixed(2)} EUR</span></div>}
            {remaining > 0 && invoice.status !== "payee" && <div className="flex justify-between text-sm font-semibold text-orange-600"><span>{t("licenseManagement.dialog.remaining")}</span><span className="font-mono">{remaining.toFixed(2)} EUR</span></div>}
          </div>
        </div>
        {!isPaid && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={sendInvoice} disabled={busy !== null || !invoice.clientEmail} title={!invoice.clientEmail ? t("licenseManagement.dialog.noClientEmail") : t("licenseManagement.dialog.sendInvoiceEmail")}>
              {busy === "send" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              {t("licenseManagement.dialog.send")}
            </Button>
            <Button size="sm" variant="outline" className="text-blue-600 hover:text-blue-700" onClick={() => { setPaymentAmount(remaining.toFixed(2)); setPaymentOpen(true); }} disabled={busy !== null || remaining <= 0}>
              <DollarSign className="h-3.5 w-3.5 mr-1" />{t("licenseManagement.dialog.recordPayment")}
            </Button>
            <Button size="sm" variant="outline" className="text-green-600 hover:text-green-700" onClick={() => setMarkPaidOpen(true)} disabled={busy !== null}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {t("licenseManagement.dialog.markPaid")}
            </Button>
            <Button size="sm" variant="outline" className="text-orange-600 hover:text-orange-700" onClick={() => setReminderOpen(true)} disabled={busy !== null || !invoice.clientEmail} title={!invoice.clientEmail ? t("licenseManagement.dialog.noClientEmail") : t("licenseManagement.dialog.sendReminder")}>
              <Bell className="h-3.5 w-3.5 mr-1" />{t("licenseManagement.dialog.sendReminder")}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("licenseManagement.dialog.close")}</Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={paymentOpen} onOpenChange={(o) => { if (!o) { setPaymentOpen(false); setPaymentAmount(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-blue-500" />{t("licenseManagement.dialog.recordPayment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.invoiceLabel")}</span> <span className="font-semibold">{invoice.reference}</span> — {invoice.clientName}</div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.remainingLabel")}</span> <span className="font-bold text-orange-600">{remaining.toFixed(2)} EUR</span></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.amountReceived")}</Label><Input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0.00" /></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.paymentMethod")}</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="virement">{t("licenseManagement.method.virement")}</SelectItem>
                  <SelectItem value="cheque">{t("licenseManagement.method.cheque")}</SelectItem>
                  <SelectItem value="especes">{t("licenseManagement.method.especes")}</SelectItem>
                  <SelectItem value="carte">{t("licenseManagement.method.carte")}</SelectItem>
                  <SelectItem value="prelevement">{t("licenseManagement.method.prelevement")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPaymentOpen(false); setPaymentAmount(""); }}>{t("common.cancel")}</Button>
            <Button onClick={recordPayment} disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || busy === "payment"} className="bg-blue-500 hover:bg-blue-600">
              {busy === "payment" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DollarSign className="h-4 w-4 mr-2" />}
              {t("licenseManagement.dialog.record")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={markPaidOpen} onOpenChange={(o) => { if (!o) setMarkPaidOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" />{t("licenseManagement.dialog.markPaidTitle")}</DialogTitle>
            <DialogDescription>{t("licenseManagement.dialog.markPaidDesc", { amount: remaining.toFixed(2) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.invoiceLabel")}</span> <span className="font-semibold">{invoice.reference}</span> — {invoice.clientName}</div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.paymentMethod")}</Label>
              <Select value={markPaidMethod} onValueChange={setMarkPaidMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="virement">{t("licenseManagement.method.virement")}</SelectItem>
                  <SelectItem value="cheque">{t("licenseManagement.method.cheque")}</SelectItem>
                  <SelectItem value="especes">{t("licenseManagement.method.especes")}</SelectItem>
                  <SelectItem value="carte">{t("licenseManagement.method.carte")}</SelectItem>
                  <SelectItem value="prelevement">{t("licenseManagement.method.prelevement")}</SelectItem>
                  <SelectItem value="stripe">{t("licenseManagement.method.stripe")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={markPaid} disabled={busy === "paid"} className="bg-green-600 hover:bg-green-700">
              {busy === "paid" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {t("licenseManagement.dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reminderOpen} onOpenChange={(o) => { if (!o) { setReminderOpen(false); setCustomMessage(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-orange-500" />{t("licenseManagement.dialog.reminderTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.invoiceLabel")}</span> <span className="font-semibold">{invoice.reference}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.clientLabel")}</span> <span>{invoice.clientName}{invoice.clientEmail ? ` (${invoice.clientEmail})` : ""}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.remainingAmount")}</span> <span className="font-bold text-red-600">{remaining.toFixed(2)} EUR</span></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.customMessage")}</Label><Textarea value={customMessage} onChange={(e) => setCustomMessage(e.target.value)} placeholder={t("licenseManagement.dialog.customPlaceholder")} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReminderOpen(false); setCustomMessage(""); }}>{t("common.cancel")}</Button>
            <Button onClick={sendReminder} disabled={busy === "reminder"} className="bg-orange-500 hover:bg-orange-600">
              {busy === "reminder" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {t("licenseManagement.dialog.sendReminderBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function OverviewTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const sub = data.subscription;
  const { toast } = useToast();
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);

  const generateInvoice = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`${API}/api/license-management/auto-generate-invoice`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.success) { toast({ title: t("licenseManagement.toastMsg.invoiceGenerated"), description: `${d.invoice?.totalAmount?.toFixed(2)} EUR` }); onRefresh(); }
      else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
    }
    setGenerating(false);
  };

  const usageLimits = [
    { label: t("licenseManagement.usage.users"), current: sub?.currentUsers, max: sub?.maxUsers, icon: Users },
    { label: t("licenseManagement.usage.contacts"), current: sub?.currentContacts, max: sub?.maxContacts, icon: Users },
    { label: t("licenseManagement.usage.callsThisMonth"), current: sub?.currentCallsMonth, max: sub?.maxCallsPerMonth, icon: Phone },
  ];

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4 text-amber-500" />{t("licenseManagement.overview.licence")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground">{t("licenseManagement.overview.key")}</span>
                <code className="font-mono text-amber-600 truncate text-[10px]">{sub?.licenseKey || "N/A"}</code>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t("licenseManagement.overview.plan")}</span>
                <span className="font-semibold capitalize">{sub?.plan || "N/A"}</span>
              </div>
            </div>
            {sub?.trialDaysLeft !== null && sub?.trialDaysLeft !== undefined && (
              <div className={`p-2 rounded text-xs font-medium ${sub.trialDaysLeft <= 3 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400" : sub.trialDaysLeft <= 7 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400"}`}>
                {sub.trialDaysLeft > 0 ? t("licenseManagement.overview.trialLeft", { days: sub.trialDaysLeft }) : t("licenseManagement.overview.trialExpired")}
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
              {sub?.aiEnabled && <Badge variant="secondary" className="text-[10px]"><Zap className="h-3 w-3 mr-0.5" />{t("licenseManagement.overview.ai")}</Badge>}
              {sub?.stockEnabled && <Badge variant="secondary" className="text-[10px]">{t("licenseManagement.overview.stock")}</Badge>}
              {sub?.automationEnabled && <Badge variant="secondary" className="text-[10px]">{t("licenseManagement.overview.automations")}</Badge>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-500" />{t("licenseManagement.overview.organisation")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">IBAN</span><span className="font-mono">{data.organisation?.bankIban || <span className="text-red-500">{t("licenseManagement.overview.notConfigured")}</span>}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">BIC</span><span>{data.organisation?.bankBic || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SIRET</span><span>{data.organisation?.siret || <span className="text-red-500">{t("licenseManagement.overview.notConfigured")}</span>}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">TVA</span><span>{data.organisation?.tvaNumber || "—"}</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">{t("licenseManagement.overview.autoInvoicing")}</span><Badge variant={data.organisation?.autoInvoiceEnabled ? "default" : "outline"} className="text-[10px]">{data.organisation?.autoInvoiceEnabled ? t("licenseManagement.status.active") : t("licenseManagement.status.inactive")}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t("licenseManagement.overview.autoEmailInvoices")}</span><Badge variant={data.organisation?.autoEmailInvoice ? "default" : "outline"} className="text-[10px]">{data.organisation?.autoEmailInvoice ? t("licenseManagement.status.active") : t("licenseManagement.status.inactive")}</Badge></div>
            <Separator />
            <Button size="sm" variant="outline" className="w-full text-xs gap-2" onClick={generateInvoice} disabled={generating}>
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {t("licenseManagement.overview.generateMonthInvoice")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Receipt className="h-4 w-4 text-purple-500" />{t("licenseManagement.overview.subInvoiceHistory")}</CardTitle>
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
                    {inv.overageAmount > 0 && <Badge variant="outline" className="text-[10px] text-orange-600">{t("licenseManagement.overview.overage", { amount: inv.overageAmount.toFixed(2) })}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{inv.totalAmount?.toFixed(2)} EUR</span>
                    <Badge variant={inv.status === "payee" ? "default" : inv.status === "en_attente" ? "secondary" : "destructive"} className="text-[10px]">
                      {inv.status === "payee" ? t("licenseManagement.status.payee") : inv.status === "en_attente" ? t("licenseManagement.status.enAttente") : inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">{t("licenseManagement.overview.noSubInvoice")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ClientInvoicesTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const { toast } = useToast();
  const { t } = useTranslation();
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
      if (d.success) { toast({ title: t("licenseManagement.toast.success"), description: d.message }); onRefresh(); }
      else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
    }
    setSendingId(null);
  };

  const [markPaidDialog, setMarkPaidDialog] = useState<{ id: number; ref: string } | null>(null);
  const [markPaidMethod, setMarkPaidMethod] = useState("virement");
  const markPaid = async () => {
    if (!markPaidDialog) return;
    setMarkingId(markPaidDialog.id);
    try {
      const r = await fetch(`${API}/api/license-management/mark-invoice-paid`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ factureClientId: markPaidDialog.id, paymentMethod: markPaidMethod }),
      });
      const d = await r.json();
      if (d.success) { toast({ title: t("licenseManagement.toastMsg.markedPaid"), description: d.message }); onRefresh(); setMarkPaidDialog(null); }
      else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
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
        toast({ title: t("licenseManagement.toastMsg.paymentRecorded"), description: d.message });
        onRefresh();
        setPaymentDialog(null); setPaymentAmount("");
      } else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
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
      if (d.success) { toast({ title: t("licenseManagement.toast.success"), description: t("licenseManagement.toastMsg.reminderSent", { level: d.reminderLevel }) }); onRefresh(); }
      else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
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
        toast({ title: t("licenseManagement.toastMsg.invoiceCreated"), description: `${d.facture.reference} — ${d.facture.totalAmount.toFixed(2)} EUR` });
        onRefresh(); setCreateOpen(false);
        setNewInvoice({ clientName: "", clientEmail: "", clientPhone: "", clientCompany: "", title: "", dueDate: "", notes: "", items: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 20 }] });
      } else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
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
          <div className="text-xs text-muted-foreground">{t("licenseManagement.clientInv.collected")}</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-orange-600">{data.clientBilling?.pendingCount || 0}</div>
          <div className="text-xs text-muted-foreground">{t("licenseManagement.clientInv.pendingPayment")}</div>
        </Card>
        <Card className="text-center p-4">
          <div className="text-2xl font-bold text-red-600">{data.clientBilling?.overdueCount || 0}</div>
          <div className="text-xs text-muted-foreground">{t("licenseManagement.clientInv.overdue")}</div>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">{t("licenseManagement.clientInv.title")}</CardTitle>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1 h-8">
              <Plus className="h-3 w-3" />{t("licenseManagement.clientInv.newInvoice")}
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
                        {inv.status === "payee" ? t("licenseManagement.status.payee") : inv.status === "envoyee" ? t("licenseManagement.status.envoyee") : isOverdue ? t("licenseManagement.status.enRetard") : inv.status === "brouillon" ? t("licenseManagement.status.brouillon") : inv.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span className="font-mono font-medium text-foreground">{inv.totalAmount?.toFixed(2)} EUR</span>
                        {inv.paidAmount > 0 && inv.status !== "payee" && <span className="text-green-600">{t("licenseManagement.clientInv.paidLabel", { amount: inv.paidAmount.toFixed(2) })}</span>}
                        {inv.dueDate && <span>{t("licenseManagement.clientInv.dueLabel", { date: format(new Date(inv.dueDate), "dd/MM/yyyy") })}</span>}
                      </div>
                      {inv.status !== "payee" && (
                        <div className="flex gap-1 flex-wrap justify-end">
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => sendInvoice(inv.id)} disabled={sendingId === inv.id}>
                            {sendingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-0.5" />}
                            {t("licenseManagement.dialog.send")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-blue-600 hover:text-blue-700" onClick={() => { setPaymentDialog(inv); setPaymentAmount(remaining.toFixed(2)); }}>
                            <DollarSign className="h-3 w-3 mr-0.5" />{t("licenseManagement.clientInv.partialPayment")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-green-600 hover:text-green-700" onClick={() => { setMarkPaidMethod("virement"); setMarkPaidDialog({ id: inv.id, ref: inv.reference }); }} disabled={markingId === inv.id}>
                            {markingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                            {t("licenseManagement.clientInv.settled")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-orange-600 hover:text-orange-700" onClick={() => setReminderDialog(inv)}>
                            <Bell className="h-3 w-3 mr-0.5" />{t("licenseManagement.clientInv.reminder")}
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
              {invoices.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">{t("licenseManagement.clientInv.noInvoices")}</p>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" />{t("licenseManagement.clientInv.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("licenseManagement.clientInv.clientInfo")}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.clientInv.clientName")}</Label><Input value={newInvoice.clientName} onChange={e => setNewInvoice(p => ({ ...p, clientName: e.target.value }))} placeholder="ACME SARL" /></div>
                <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.clientInv.companyName")}</Label><Input value={newInvoice.clientCompany} onChange={e => setNewInvoice(p => ({ ...p, clientCompany: e.target.value }))} placeholder={t("licenseManagement.clientInv.companyPlaceholder")} /></div>
                <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.email")}</Label><Input type="email" value={newInvoice.clientEmail} onChange={e => setNewInvoice(p => ({ ...p, clientEmail: e.target.value }))} placeholder="client@exemple.fr" /></div>
                <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.clientInv.telephone")}</Label><Input value={newInvoice.clientPhone} onChange={e => setNewInvoice(p => ({ ...p, clientPhone: e.target.value }))} placeholder="06 12 34 56 78" /></div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("licenseManagement.clientInv.invoice")}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1"><Label className="text-xs">{t("licenseManagement.clientInv.titleReq")}</Label><Input value={newInvoice.title} onChange={e => setNewInvoice(p => ({ ...p, title: e.target.value }))} placeholder={t("licenseManagement.clientInv.titlePlaceholder")} /></div>
                <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.clientInv.dueDateLabel")}</Label><Input type="date" value={newInvoice.dueDate} onChange={e => setNewInvoice(p => ({ ...p, dueDate: e.target.value }))} /></div>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("licenseManagement.clientInv.billingLines")}</h4>
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={addItem}><Plus className="h-3 w-3" />{t("licenseManagement.clientInv.add")}</Button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-1 text-[10px] text-muted-foreground font-medium px-1">
                  <span className="col-span-5">{t("licenseManagement.clientInv.description")}</span>
                  <span className="col-span-2 text-center">{t("licenseManagement.clientInv.qty")}</span>
                  <span className="col-span-2 text-right">{t("licenseManagement.clientInv.priceHT")}</span>
                  <span className="col-span-2 text-right">{t("licenseManagement.clientInv.tvaPct")}</span>
                  <span className="col-span-1" />
                </div>
                {newInvoice.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center">
                    <Input className="col-span-5 h-7 text-xs" value={item.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder={t("licenseManagement.clientInv.itemPlaceholder")} />
                    <Input className="col-span-2 h-7 text-xs text-center" type="number" min="1" value={item.quantity} onChange={e => updateItem(i, "quantity", parseFloat(e.target.value) || 1)} />
                    <Input className="col-span-2 h-7 text-xs text-right" type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(i, "unitPrice", parseFloat(e.target.value) || 0)} />
                    <Input className="col-span-2 h-7 text-xs text-right" type="number" min="0" max="100" value={item.taxRate} onChange={e => updateItem(i, "taxRate", parseFloat(e.target.value) || 0)} />
                    <Button size="sm" variant="ghost" className="col-span-1 h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => removeItem(i)} disabled={newInvoice.items.length === 1} aria-label={t("common.delete")}><Trash2 className="h-3 w-3" aria-hidden="true" /></Button>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-3 bg-muted/50 rounded-lg space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">{t("licenseManagement.dialog.subtotalHT")}</span><span className="font-mono">{totalHT.toFixed(2)} EUR</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">TVA</span><span className="font-mono">{totalTVA.toFixed(2)} EUR</span></div>
                <Separator className="my-1" />
                <div className="flex justify-between font-semibold"><span>{t("licenseManagement.dialog.totalTTC")}</span><span className="font-mono text-base">{totalTTC.toFixed(2)} EUR</span></div>
              </div>
            </div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.clientInv.internalNotes")}</Label><Textarea value={newInvoice.notes} onChange={e => setNewInvoice(p => ({ ...p, notes: e.target.value }))} placeholder={t("licenseManagement.clientInv.notesPlaceholder")} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={createInvoice} disabled={creating || !newInvoice.clientName || !newInvoice.title}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
              {t("licenseManagement.clientInv.createInvoice")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentDialog} onOpenChange={() => setPaymentDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-blue-500" />{t("licenseManagement.dialog.recordPayment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.invoiceLabel")}</span> <span className="font-semibold">{paymentDialog?.reference}</span> — {paymentDialog?.clientName}</div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.remainingLabel")}</span> <span className="font-bold text-orange-600">{((paymentDialog?.totalAmount || 0) - (paymentDialog?.paidAmount || 0)).toFixed(2)} EUR</span></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.amountReceived")}</Label><Input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0.00" /></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.paymentMethod")}</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="virement">{t("licenseManagement.method.virement")}</SelectItem>
                  <SelectItem value="cheque">{t("licenseManagement.method.cheque")}</SelectItem>
                  <SelectItem value="especes">{t("licenseManagement.method.especes")}</SelectItem>
                  <SelectItem value="carte">{t("licenseManagement.method.carte")}</SelectItem>
                  <SelectItem value="prelevement">{t("licenseManagement.method.prelevement")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>{t("common.cancel")}</Button>
            <Button onClick={recordPayment} disabled={!paymentAmount || parseFloat(paymentAmount) <= 0} className="bg-blue-500 hover:bg-blue-600">
              <DollarSign className="h-4 w-4 mr-2" />{t("licenseManagement.dialog.record")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!markPaidDialog} onOpenChange={(o) => { if (!o) setMarkPaidDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" />{t("licenseManagement.dialog.markPaidTitle")}</DialogTitle>
            <DialogDescription>{t("licenseManagement.dialog.markPaidDescSimple")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.invoiceLabel")}</span> <span className="font-semibold">{markPaidDialog?.ref}</span></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.paymentMethod")}</Label>
              <Select value={markPaidMethod} onValueChange={setMarkPaidMethod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="virement">{t("licenseManagement.method.virement")}</SelectItem>
                  <SelectItem value="cheque">{t("licenseManagement.method.cheque")}</SelectItem>
                  <SelectItem value="especes">{t("licenseManagement.method.especes")}</SelectItem>
                  <SelectItem value="carte">{t("licenseManagement.method.carte")}</SelectItem>
                  <SelectItem value="prelevement">{t("licenseManagement.method.prelevement")}</SelectItem>
                  <SelectItem value="stripe">{t("licenseManagement.method.stripe")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidDialog(null)}>{t("common.cancel")}</Button>
            <Button onClick={markPaid} disabled={markingId !== null} className="bg-green-600 hover:bg-green-700">
              {markingId !== null ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {t("licenseManagement.dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reminderDialog} onOpenChange={() => setReminderDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-orange-500" />{t("licenseManagement.dialog.reminderTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.invoiceLabel")}</span> <span className="font-semibold">{reminderDialog?.reference}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.clientLabel")}</span> <span>{reminderDialog?.clientName} ({reminderDialog?.clientEmail})</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licenseManagement.dialog.remainingAmount")}</span> <span className="font-bold text-red-600">{((reminderDialog?.totalAmount || 0) - (reminderDialog?.paidAmount || 0)).toFixed(2)} EUR</span></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.dialog.customMessage")}</Label><Textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} placeholder={t("licenseManagement.dialog.customPlaceholder")} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderDialog(null)}>{t("common.cancel")}</Button>
            <Button onClick={sendReminder} className="bg-orange-500 hover:bg-orange-600"><Send className="h-4 w-4 mr-2" />{t("licenseManagement.dialog.sendReminderBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsTab({ data }: { data: any; onRefresh: () => void }) {
  const { t } = useTranslation();
  const payments = data.payments || [];
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4 text-green-500" />{t("licenseManagement.payments.title")}</CardTitle>
          </div>
          <CardDescription className="text-xs">{t("licenseManagement.payments.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            {payments.length > 0 ? (
              <div className="space-y-1">
                {payments.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-xs">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${p.status === "matched" ? "bg-green-500" : p.status === "pending" ? "bg-amber-500" : "bg-gray-400"}`} />
                      <span className="font-medium">{p.payerName || t("licenseManagement.payments.unknown")}</span>
                      {p.bankRef && <code className="text-[10px] text-muted-foreground">{p.bankRef}</code>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{p.amount?.toFixed(2)} EUR</span>
                      <Badge variant={p.status === "matched" ? "default" : "secondary"} className="text-[10px]">{p.status === "matched" ? t("licenseManagement.payments.associe") : p.status === "pending" ? t("licenseManagement.payments.pending") : p.status}</Badge>
                      {p.bankDate && <span className="text-muted-foreground">{format(new Date(p.bankDate), "dd/MM/yyyy")}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-muted-foreground space-y-1">
                <CreditCard className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <p>{t("licenseManagement.payments.none")}</p>
                <p className="text-[10px]">{t("licenseManagement.payments.noneHint")}</p>
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
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);

  const runAutoReminders = async () => {
    setRunning(true);
    try {
      const r = await fetch(`${API}/api/license-management/auto-reminders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      });
      const d = await r.json();
      if (d.success) {
        toast({ title: t("licenseManagement.toast.success"), description: t("licenseManagement.reminders.autoSent", { sent: d.sent, skipped: d.skipped, total: d.total }) });
        onRefresh();
      } else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
    }
    setRunning(false);
  };

  const reminders = data.reminders || [];

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4 text-amber-500" />{t("licenseManagement.reminders.title")}</h3>
        <Button onClick={runAutoReminders} disabled={running} className="bg-amber-500 hover:bg-amber-600">
          {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          {t("licenseManagement.reminders.sendAuto")}
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
                      <Badge variant="outline" className="text-[10px]">{t("licenseManagement.reminders.level", { level: r.reminderLevel })}</Badge>
                      <Badge variant={r.status === "sent" ? "default" : "destructive"} className="text-[10px]">{r.status === "sent" ? t("licenseManagement.reminders.sent") : r.status === "failed" ? t("licenseManagement.reminders.failed") : r.status}</Badge>
                      {r.sentAt && <span className="text-muted-foreground">{format(new Date(r.sentAt), "dd/MM HH:mm")}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-xs">{t("licenseManagement.reminders.none")}</div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function BillingSettingsTab({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const { toast } = useToast();
  const { t } = useTranslation();
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
      if (d.success) { toast({ title: t("licenseManagement.toastMsg.saved"), description: t("licenseManagement.toastMsg.settingsUpdated") }); setBankIban(""); onRefresh(); }
      else throw new Error(d.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-blue-500" />{t("licenseManagement.settings.bankTitle")}</CardTitle>
          <CardDescription className="text-xs">{t("licenseManagement.settings.bankDesc")}</CardDescription>
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
                <p className="text-[10px] text-muted-foreground mt-1">{t("licenseManagement.settings.ibanKeep")}</p>
              )}
            </div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.settings.bicSwift")}</Label><Input value={bankBic} onChange={e => setBankBic(e.target.value)} placeholder="BNPAFRPP" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.settings.siret")}</Label><Input value={siret} onChange={e => setSiret(e.target.value)} placeholder="123 456 789 00012" /></div>
            <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.settings.tvaNumber")}</Label><Input value={tvaNumber} onChange={e => setTvaNumber(e.target.value)} placeholder="FR 12 123456789" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">{t("licenseManagement.settings.invoiceFooter")}</Label><Textarea value={invoiceFooter} onChange={e => setInvoiceFooter(e.target.value)} placeholder={t("licenseManagement.settings.footerPlaceholder")} rows={3} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />{t("licenseManagement.settings.automations")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t("licenseManagement.settings.autoMonthlyTitle")}</div>
              <div className="text-xs text-muted-foreground">{t("licenseManagement.settings.autoMonthlyDesc")}</div>
            </div>
            <Switch checked={autoInvoice} onCheckedChange={setAutoInvoice} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t("licenseManagement.settings.autoEmailTitle")}</div>
              <div className="text-xs text-muted-foreground">{t("licenseManagement.settings.autoEmailDesc")}</div>
            </div>
            <Switch checked={autoEmail} onCheckedChange={setAutoEmail} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
          {t("licenseManagement.settings.saveSettings")}
        </Button>
      </div>
    </div>
  );
}

function LicenceAuditTab() {
  const { t } = useTranslation();
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
          <CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-indigo-500" />{t("licenseManagement.licenceAudit.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
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
              <p className="text-center py-8 text-muted-foreground text-xs">{t("licenseManagement.licenceAudit.none")}</p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

const AUDIT_ACTION_COLORS: Record<string, string> = {
  login: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  logout: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  create: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  update: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  delete: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  view: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  export: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
};

const AUDIT_ACTION_KEYS = ["login", "logout", "create", "update", "delete", "view", "export"];

const AUDIT_RESOURCE_KEYS = [
  "auth", "contact", "call", "task", "message", "stock", "user", "settings",
  "calendar", "prospect", "devis", "facture", "commande", "checkin", "document", "projet",
];

function SystemAuditTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");
  const [userEmailSearch, setUserEmailSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [appliedEmail, setAppliedEmail] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const applyFilters = () => { setAppliedEmail(userEmailSearch); setAppliedFrom(dateFrom); setAppliedTo(dateTo); setPage(1); };
  const clearFilters = () => {
    setUserEmailSearch(""); setDateFrom(""); setDateTo(""); setAppliedEmail(""); setAppliedFrom(""); setAppliedTo("");
    setActionFilter("all"); setResourceFilter("all"); setPage(1);
  };

  const hasActiveFilters = appliedEmail || appliedFrom || appliedTo || actionFilter !== "all" || resourceFilter !== "all";

  const { data: logsData, isLoading } = useQuery({
    queryKey: ["audit-logs", page, actionFilter, resourceFilter, appliedEmail, appliedFrom, appliedTo],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (actionFilter !== "all") params.set("action", actionFilter);
      if (resourceFilter !== "all") params.set("resource", resourceFilter);
      if (appliedEmail) params.set("userEmail", appliedEmail);
      if (appliedFrom) params.set("from", appliedFrom);
      if (appliedTo) { const to = new Date(appliedTo); to.setHours(23, 59, 59, 999); params.set("to", to.toISOString()); }
      const res = await fetch(`${API}/api/audit/logs?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Acces refuse");
      return res.json();
    },
  });

  const { data: statsData } = useQuery({
    queryKey: ["audit-stats"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/audit/stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur");
      return res.json();
    },
  });

  const exportUrl = () => {
    const params = new URLSearchParams();
    if (actionFilter !== "all") params.set("action", actionFilter);
    if (resourceFilter !== "all") params.set("resource", resourceFilter);
    if (appliedEmail) params.set("userEmail", appliedEmail);
    if (appliedFrom) params.set("from", appliedFrom);
    if (appliedTo) { const to = new Date(appliedTo); to.setHours(23, 59, 59, 999); params.set("to", to.toISOString()); }
    const qs = params.toString();
    return `${API}/api/audit/export/csv${qs ? "?" + qs : ""}`;
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40">
              <Activity className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.todayTotal || 0}</p>
              <p className="text-xs text-muted-foreground">{t("licenseManagement.systemAudit.actionsToday")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/40">
              <Users className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.activeUsers?.length || 0}</p>
              <p className="text-xs text-muted-foreground">{t("licenseManagement.systemAudit.activeUsers")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.actionBreakdown?.find((a: any) => a.action === "delete")?.count || 0}</p>
              <p className="text-xs text-muted-foreground">{t("licenseManagement.systemAudit.deletionsToday")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4 text-indigo-500" />{t("licenseManagement.systemAudit.title")}</CardTitle>
            <div className="flex items-center gap-2">
              <a href={exportUrl()} download="journal_audit.csv">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1"><Download className="w-3 h-3" />CSV</Button>
              </a>
              <Button variant="outline" size="sm" className="h-8" title={t("licenseManagement.print")} onClick={() => window.print()}><Printer className="w-3 h-3" /></Button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={userEmailSearch} onChange={e => setUserEmailSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") applyFilters(); }} placeholder={t("licenseManagement.systemAudit.searchEmail")} className="pl-8 h-8 text-xs" />
            </div>
            <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder={t("licenseManagement.systemAudit.actionPlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("licenseManagement.systemAudit.allActions")}</SelectItem>
                {AUDIT_ACTION_KEYS.map((k) => <SelectItem key={k} value={k}>{t("licenseManagement.auditAction." + k)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={resourceFilter} onValueChange={v => { setResourceFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder={t("licenseManagement.systemAudit.resourcePlaceholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("licenseManagement.systemAudit.allResources")}</SelectItem>
                {AUDIT_RESOURCE_KEYS.map((k) => <SelectItem key={k} value={k}>{t("licenseManagement.auditResource." + k)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t("licenseManagement.systemAudit.from")}</span>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-xs flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">{t("licenseManagement.systemAudit.to")}</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-xs flex-1" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-xs px-3" onClick={applyFilters}><Search className="w-3 h-3 mr-1" />{t("licenseManagement.systemAudit.filter")}</Button>
              {hasActiveFilters && <Button size="sm" variant="outline" className="h-8 text-xs px-3" onClick={clearFilters}><X className="w-3 h-3 mr-1" />{t("licenseManagement.systemAudit.clear")}</Button>}
            </div>
          </div>
          {hasActiveFilters && <p className="text-xs text-blue-600 dark:text-blue-400 pt-1">{t("licenseManagement.systemAudit.activeFilters", { count: logsData?.total ?? "..." })}</p>}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("licenseManagement.systemAudit.loading")}</div>
          ) : !logsData?.logs?.length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("licenseManagement.systemAudit.noActivity")}</div>
          ) : (
            <div className="space-y-1">
              {logsData.logs.map((log: any) => (
                <div key={log.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                    {(log.userEmail || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{log.userEmail || t("licenseManagement.systemAudit.system")}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${AUDIT_ACTION_COLORS[log.action] || "bg-gray-100 text-gray-700"}`}>
                        {AUDIT_ACTION_KEYS.includes(log.action) ? t("licenseManagement.auditAction." + log.action) : log.action}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{AUDIT_RESOURCE_KEYS.includes(log.resource) ? t("licenseManagement.auditResource." + log.resource) : log.resource}</span>
                      {log.resourceId && <span className="text-xs text-muted-foreground/60">#{log.resourceId}</span>}
                    </div>
                    {log.details && typeof log.details === "object" && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{JSON.stringify(log.details).substring(0, 120)}</p>
                    )}
                    {log.ipAddress && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{log.ipAddress}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
                    <p className="text-[10px] text-muted-foreground/60">{new Date(log.createdAt).toLocaleDateString("fr-FR")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {logsData && logsData.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <span className="text-xs text-muted-foreground">{t("licenseManagement.systemAudit.pageInfo", { page: logsData.page, pages: logsData.totalPages, total: logsData.total })}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= logsData.totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AbonnementTab() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [sending, setSending] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/my-subscription`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur");
      return res.json();
    },
  });

  const sendUpgradeRequest = async () => {
    if (!selectedPlan) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/my-subscription/upgrade-request`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ targetPlan: selectedPlan.key, message: upgradeMessage }),
      });
      const result = await res.json();
      if (res.ok) {
        toast({ title: t("licenseManagement.toastMsg.requestSent"), description: result.message });
        setShowUpgrade(false); setSelectedPlan(null); setUpgradeMessage("");
      } else throw new Error(result.error || t("licenseManagement.toast.error"));
    } catch (err: any) {
      toast({ title: t("licenseManagement.toast.error"), description: err.message, variant: "destructive" });
    }
    setSending(false);
  };

  if (isLoading) return <div className="mt-4 flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="mt-4 text-center text-muted-foreground py-10">{t("licenseManagement.abonnement.cannotLoad")}</div>;

  const { subscription: sub, limits, usage, isActive, plans } = data;
  const usagePct = (cur: number, max: number) => max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : 0;

  const statusBadge = () => {
    if (!sub) return <Badge variant="secondary">{t("licenseManagement.abonnement.none")}</Badge>;
    if (sub.trialExpired) return <Badge variant="destructive">{t("licenseManagement.abonnement.trialExpired")}</Badge>;
    if (sub.status === "cancelled") return <Badge variant="destructive">{t("licenseManagement.abonnement.cancelled")}</Badge>;
    if (sub.status === "active") return <Badge className="bg-emerald-500 text-white">{t("licenseManagement.abonnement.active")}</Badge>;
    return <Badge variant="secondary">{sub.status}</Badge>;
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{statusBadge()}</div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1"><RefreshCw className="h-3 w-3" />{t("licenseManagement.abonnement.refresh")}</Button>
      </div>

      {!isActive && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm font-medium text-destructive">
              {sub?.trialExpired ? t("licenseManagement.abonnement.trialOver")
                : sub?.status === "cancelled" ? t("licenseManagement.abonnement.subCancelled")
                : t("licenseManagement.abonnement.inactive")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Crown className="h-4 w-4 text-amber-500" /><span className="text-sm text-muted-foreground">{t("licenseManagement.abonnement.currentPlan")}</span></div>
            <p className="text-2xl font-bold">{sub?.planName || t("licenseManagement.abonnement.freeTrial")}</p>
            {sub && Number(sub.price) > 0 && <p className="text-sm text-muted-foreground mt-1">{sub.price} {sub.currency}/{sub.billingCycle === "monthly" ? t("licenseManagement.abonnement.perMonth") : t("licenseManagement.abonnement.perYear")}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Clock className="h-4 w-4 text-blue-500" /><span className="text-sm text-muted-foreground">{sub?.plan === "essai" ? t("licenseManagement.abonnement.trialDaysLeft") : t("licenseManagement.abonnement.nextDue")}</span></div>
            <p className="text-2xl font-bold">{sub?.plan === "essai" ? (sub.daysRemaining !== null ? t("licenseManagement.abonnement.days", { n: sub.daysRemaining }) : "—") : (sub?.periodDaysRemaining !== null ? t("licenseManagement.abonnement.days", { n: sub?.periodDaysRemaining }) : "—")}</p>
            {sub?.trialEndsAt && sub.plan === "essai" && <p className="text-xs text-muted-foreground mt-1">{t("licenseManagement.abonnement.expiresOn", { date: new Date(sub.trialEndsAt).toLocaleDateString("fr-FR") })}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Shield className="h-4 w-4 text-green-500" /><span className="text-sm text-muted-foreground">{t("licenseManagement.abonnement.licenseKey")}</span></div>
            <p className="text-sm font-mono font-medium break-all select-all">{sub?.licenseKey || "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("licenseManagement.abonnement.currentUsage")}</CardTitle>
          <CardDescription className="text-xs">{t("licenseManagement.abonnement.usageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: t("licenseManagement.abonnement.users"), current: usage.users, max: limits.maxUsers, icon: Users, color: "text-blue-500" },
            { label: t("licenseManagement.abonnement.contacts"), current: usage.contacts, max: limits.maxContacts, icon: BookUser, color: "text-green-500" },
            { label: t("licenseManagement.abonnement.callsMonth"), current: usage.calls, max: limits.maxCallsPerMonth, icon: Phone, color: "text-purple-500" },
          ].map(item => (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><item.icon className={`h-4 w-4 ${item.color}`} /><span className="text-sm font-medium">{item.label}</span></div>
                <span className="text-sm text-muted-foreground">{item.current} / {item.max}</span>
              </div>
              <Progress value={usagePct(item.current, item.max)} className={`h-2 ${usagePct(item.current, item.max) > 90 ? "[&>div]:bg-red-500" : usagePct(item.current, item.max) > 75 ? "[&>div]:bg-amber-500" : ""}`} />
            </div>
          ))}
          <Separator />
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="flex flex-col items-center gap-1">
              <Brain className={`h-5 w-5 ${limits.aiEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{limits.aiEnabled ? t("licenseManagement.abonnement.aiActive") : t("licenseManagement.abonnement.aiInactive")}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Package className={`h-5 w-5 ${limits.stockEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{limits.stockEnabled ? t("licenseManagement.abonnement.stockActive") : t("licenseManagement.abonnement.stockInactive")}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Zap className={`h-5 w-5 ${limits.automationEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{limits.automationEnabled ? t("licenseManagement.abonnement.autoActive") : t("licenseManagement.abonnement.autoInactive")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("licenseManagement.abonnement.availablePlans")}</CardTitle>
          <CardDescription className="text-xs">{t("licenseManagement.abonnement.plansDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {plans?.map((plan: any) => (
              <div key={plan.key} className={`border rounded-lg p-4 relative ${plan.isCurrent ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                {plan.isCurrent && <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px]">{t("licenseManagement.abonnement.planBadge")}</Badge>}
                <h3 className="font-bold text-base mt-2">{plan.name}</h3>
                <p className="text-xl font-bold mt-1">{plan.price === 0 ? t("licenseManagement.abonnement.free") : `${plan.price}€`}{plan.price > 0 && <span className="text-xs font-normal text-muted-foreground">/{t("licenseManagement.abonnement.perMonth")}</span>}</p>
                <ul className="mt-3 space-y-1.5 text-xs">
                  <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />{t("licenseManagement.abonnement.usersCount", { n: plan.maxUsers })}</li>
                  <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />{t("licenseManagement.abonnement.contactsCount", { n: plan.maxContacts.toLocaleString() })}</li>
                  <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" />{t("licenseManagement.abonnement.callsCount", { n: plan.maxCallsPerMonth.toLocaleString() })}</li>
                  <li className={`flex items-center gap-1.5 ${!plan.aiEnabled ? "text-muted-foreground" : ""}`}>{plan.aiEnabled ? <Check className="h-3 w-3 text-emerald-500" /> : <span className="w-3 text-center">—</span>}{t("licenseManagement.abonnement.ai")}</li>
                  <li className={`flex items-center gap-1.5 ${!plan.stockEnabled ? "text-muted-foreground" : ""}`}>{plan.stockEnabled ? <Check className="h-3 w-3 text-emerald-500" /> : <span className="w-3 text-center">—</span>}{t("licenseManagement.abonnement.stockMgmt")}</li>
                  <li className={`flex items-center gap-1.5 ${!plan.automationEnabled ? "text-muted-foreground" : ""}`}>{plan.automationEnabled ? <Check className="h-3 w-3 text-emerald-500" /> : <span className="w-3 text-center">—</span>}{t("licenseManagement.abonnement.automations")}</li>
                </ul>
                {!plan.isCurrent && (
                  <Button size="sm" className="w-full mt-3 text-xs" variant={plan.price > (Number(sub?.price) || 0) ? "default" : "outline"} onClick={() => { setSelectedPlan(plan); setShowUpgrade(true); }}>
                    <ArrowUpRight className="h-3 w-3 mr-1" />{plan.price > (Number(sub?.price) || 0) ? t("licenseManagement.abonnement.upgradeTo") : t("licenseManagement.abonnement.changePlan")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showUpgrade} onOpenChange={setShowUpgrade}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("licenseManagement.abonnement.changeRequestTitle")}</DialogTitle>
            <DialogDescription>
              {t("licenseManagement.abonnement.changeRequestDesc", { plan: selectedPlan?.name, price: selectedPlan?.price === 0 ? t("licenseManagement.abonnement.free") : `${selectedPlan?.price}€/mois` })}
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder={t("licenseManagement.abonnement.messagePlaceholder")} value={upgradeMessage} onChange={e => setUpgradeMessage(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpgrade(false)}>{t("common.cancel")}</Button>
            <Button onClick={sendUpgradeRequest} disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{t("licenseManagement.abonnement.sendRequest")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
