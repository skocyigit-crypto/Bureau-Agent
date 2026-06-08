import { useState, useEffect } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { Package, AlertTriangle, CheckCircle2, Loader2, FileText, ArrowUpRight, Clock, CreditCard, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  en_attente: { label: "En attente", className: "bg-amber-100 text-amber-700 border-0" },
  payee: { label: "Payée", className: "bg-emerald-100 text-emerald-700 border-0" },
  partiel: { label: "Partiel", className: "bg-blue-100 text-blue-700 border-0" },
  annulee: { label: "Annulée", className: "bg-slate-100 text-slate-600 border-0" },
  retard: { label: "En retard", className: "bg-red-100 text-red-700 border-0" },
};

interface Invoice {
  id: number;
  periodLabel: string;
  plan: string;
  baseAmount: string;
  overageAmount: string;
  totalAmount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

export function TabAbonnement() {
  const { toast } = useToast();
  const [subscription, setSubscription] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<{ configured: boolean; prices: Record<string, boolean> } | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    const loadSubscription = async () => {
      try {
        const [subRes, usageRes, plansRes] = await Promise.all([
          fetch(`${BASE}/api/subscription`, { credentials: "include" }),
          fetch(`${BASE}/api/subscription/usage`, { credentials: "include" }),
          fetch(`${BASE}/api/subscription/plans`, { credentials: "include" }),
        ]);
        if (subRes.ok) {
          setSubscription(await subRes.json());
        } else if (subRes.status === 403) {
          setSubError("Votre compte n'est pas associe a une organisation. Contactez l'administrateur.");
        } else if (subRes.status === 404) {
          setSubError("Aucun abonnement configure pour votre organisation.");
        }
        if (usageRes.ok) setUsage(await usageRes.json());
        if (plansRes.ok) {
          const data = await plansRes.json();
          setPlans(data.plans || []);
        }
      } catch {
        setSubError("Impossible de charger les informations d'abonnement. Verifiez votre connexion.");
      } finally {
        setSubLoading(false);
      }
    };
    loadSubscription();
  }, []);

  useEffect(() => {
    const loadInvoices = async () => {
      setInvoicesLoading(true);
      try {
        const res = await fetch(`${BASE}/api/my-subscription/invoices`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setInvoices(data.invoices || []);
        }
      } catch {
      } finally {
        setInvoicesLoading(false);
      }
    };
    loadInvoices();
  }, []);

  useEffect(() => {
    fetch(`${BASE}/api/stripe/status`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStripeStatus(d); })
      .catch(() => {});
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(true);
    try {
      // If Stripe configured + price exists for this plan -> Stripe Checkout
      if (stripeStatus?.configured && stripeStatus.prices?.[planId]) {
        const res = await fetch(`${BASE}/api/stripe/create-checkout-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ plan: planId }),
        });
        const data = await res.json();
        // Open-redirect hardening: only follow URLs that come from Stripe's
        // checkout/billing domains. The server already only returns Stripe
        // URLs, but we double-check on the client so a compromised or
        // misconfigured backend cannot bounce the browser anywhere it likes.
        if (
          res.ok &&
          typeof data.url === "string" &&
          (data.url.startsWith("https://checkout.stripe.com/") ||
            data.url.startsWith("https://billing.stripe.com/"))
        ) {
          window.location.href = data.url;
          return;
        }
        toast({ title: "Erreur", description: data.error || "Paiement indisponible", variant: "destructive" });
        return;
      }
      // Fallback: legacy upgrade request (admin manual processing)
      const res = await fetch(`${BASE}/api/my-subscription/upgrade-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetPlan: planId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Demande envoyée", description: data.message });
      } else {
        const err = await res.json();
        toast({ title: "Erreur", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible d'envoyer la demande.", variant: "destructive" });
    } finally {
      setUpgrading(false);
    }
  };

  const handleOpenPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch(`${BASE}/api/stripe/create-portal-session`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "Erreur", description: data.error || "Portail indisponible", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible d'ouvrir le portail.", variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  const handleCancel = async (immediate: boolean) => {
    const msg = immediate
      ? "Annuler immédiatement ? Vous perdrez l'accès aux fonctionnalités payantes maintenant."
      : "Annuler à la fin de la période ? Votre abonnement reste actif jusqu'à la fin du cycle facturé.";
    if (!(await confirmAction({ title: immediate ? "Annuler immédiatement ?" : "Annuler à la fin de la période ?", description: msg, confirmLabel: "Annuler l'abonnement", destructive: true }))) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`${BASE}/api/stripe/cancel-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ immediate }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Abonnement annulé", description: data.message });
        window.location.reload();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Annulation échouée.", variant: "destructive" });
    } finally {
      setCancelLoading(false);
    }
  };

  if (subLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (subError) {
    return (
      <Card className="border-amber-200 dark:border-amber-800">
        <CardContent className="flex items-center gap-4 py-8">
          <AlertTriangle className="w-10 h-10 text-amber-500 shrink-0" />
          <div>
            <h3 className="font-semibold text-lg mb-1">Abonnement indisponible</h3>
            <p className="text-muted-foreground">{subError}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const visibleInvoices = showAllInvoices ? invoices : invoices.slice(0, 5);

  return (
    <div className="space-y-6">
      {subscription && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-emerald-600" />
                  Abonnement actuel
                </CardTitle>
                <CardDescription>
                  Plan {subscription.plan} — {subscription.status === "active" ? "Actif" : subscription.status}
                </CardDescription>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 border-0">{subscription.plan}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage && (
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold">{usage.users?.current || 0}<span className="text-sm text-muted-foreground">/{usage.users?.max || 0}</span></p>
                  <p className="text-xs text-muted-foreground">Utilisateurs</p>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold">{usage.contacts?.current || 0}<span className="text-sm text-muted-foreground">/{usage.contacts?.max || 0}</span></p>
                  <p className="text-xs text-muted-foreground">Contacts</p>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <p className="text-2xl font-bold">{usage.calls?.current || 0}<span className="text-sm text-muted-foreground">/{usage.calls?.max || 0}</span></p>
                  <p className="text-xs text-muted-foreground">Appels/mois</p>
                </div>
              </div>
            )}
            {subscription.trialEndsAt && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Periode d'essai jusqu'au <strong>{new Date(subscription.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</strong>
                </p>
              </div>
            )}
            {subscription.licenseKey && (
              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                <span className="text-xs text-muted-foreground">Clé de licence</span>
                <code className="text-xs font-mono font-bold text-amber-600 select-all">{subscription.licenseKey}</code>
              </div>
            )}
            {stripeStatus?.configured && subscription.stripeSubscriptionId && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenPortal}
                  disabled={portalLoading}
                  data-testid="button-stripe-portal"
                >
                  {portalLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
                  Gerer mon abonnement (portail Stripe)
                </Button>
                {subscription.cancelledAt ? (
                  <Badge className="bg-amber-100 text-amber-700 border-0 self-center">
                    Annulation prevue le {new Date(subscription.cancelledAt).toLocaleDateString("fr-FR")}
                  </Badge>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCancel(false)}
                      disabled={cancelLoading}
                      data-testid="button-cancel-period-end"
                    >
                      Annuler en fin de periode
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(true)}
                      disabled={cancelLoading}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      data-testid="button-cancel-immediate"
                    >
                      Annuler immédiatement
                    </Button>
                  </>
                )}
              </div>
            )}
            {stripeStatus && !stripeStatus.configured && (
              <p className="text-xs text-muted-foreground italic pt-2 border-t">
                Paiements en ligne non actives sur cette installation. Contactez l'administrateur pour changer de plan.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {plans.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Plans disponibles</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((plan: any) => (
              <Card key={plan.id} className={subscription?.plan === plan.id ? "border-emerald-500 border-2" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  <p className="text-2xl font-bold">{plan.price}€<span className="text-sm text-muted-foreground font-normal">/mois</span></p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">{plan.maxUsers} utilisateurs, {plan.maxContacts} contacts</p>
                  <p className="text-xs text-muted-foreground">{plan.maxCallsPerMonth} appels/mois</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.aiEnabled && <Badge className="text-[10px] bg-blue-100 text-blue-700 border-0">IA incluse</Badge>}
                    {plan.stockEnabled && <Badge className="text-[10px] bg-purple-100 text-purple-700 border-0">Stock</Badge>}
                    {plan.automationEnabled && <Badge className="text-[10px] bg-amber-100 text-amber-700 border-0">Automatisation</Badge>}
                  </div>
                  {subscription?.plan === plan.id ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 text-xs mt-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Plan actuel
                    </div>
                  ) : (
                    <Button
                      className="w-full mt-2"
                      size="sm"
                      variant="outline"
                      disabled={upgrading}
                      onClick={() => handleUpgrade(plan.id)}
                    >
                      {upgrading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowUpRight className="w-4 h-4 mr-1" />}
                      Demander ce plan
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Historique de facturation</h3>
        <Card>
          <CardContent className="p-0">
            {invoicesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <FileText className="w-10 h-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Aucune facture pour le moment.</p>
                <p className="text-xs text-muted-foreground">Les factures mensuelles apparaitront ici une fois generees.</p>
              </div>
            ) : (
              <>
                <div className="divide-y">
                  {visibleInvoices.map((inv) => {
                    const st = STATUS_LABELS[inv.status] || { label: inv.status, className: "bg-slate-100 text-slate-600 border-0" };
                    return (
                      <div key={inv.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                            <CreditCard className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{inv.periodLabel}</p>
                            <p className="text-xs text-muted-foreground">Plan {inv.plan} · {new Date(inv.createdAt).toLocaleDateString("fr-FR")}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold">{parseFloat(inv.totalAmount).toFixed(2)} {inv.currency}</span>
                          <Badge className={st.className}>{st.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {invoices.length > 5 && (
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-muted-foreground"
                      onClick={() => setShowAllInvoices(v => !v)}
                    >
                      {showAllInvoices ? (
                        <><ChevronUp className="w-3 h-3 mr-1" /> Masquer</>
                      ) : (
                        <><ChevronDown className="w-3 h-3 mr-1" /> Voir toutes les factures ({invoices.length})</>
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="pt-2 border-t flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Pour toute question sur votre facturation, contactez notre support.
        </p>
        <a href="mailto:support@agentdebureau.fr">
          <Button variant="outline" size="sm" className="text-xs">
            Contacter le support
          </Button>
        </a>
      </div>
    </div>
  );
}
