import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, Users, Phone, BookUser, Brain, Package, Zap, Crown, Check, ArrowUpRight, AlertTriangle, Clock, Shield } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/";

interface Plan {
  key: string;
  name: string;
  price: number;
  maxUsers: number;
  maxContacts: number;
  maxCallsPerMonth: number;
  aiEnabled: boolean;
  stockEnabled: boolean;
  automationEnabled: boolean;
  isCurrent: boolean;
}

interface SubscriptionData {
  organisation: { id: number; name: string; actif: boolean };
  subscription: {
    plan: string;
    planName: string;
    status: string;
    licenseKey: string | null;
    price: string;
    currency: string;
    billingCycle: string;
    trialEndsAt: string | null;
    trialExpired: boolean;
    daysRemaining: number | null;
    currentPeriodEnd: string | null;
    periodDaysRemaining: number | null;
    cancelledAt: string | null;
    createdAt: string;
  } | null;
  limits: {
    maxUsers: number;
    maxContacts: number;
    maxCallsPerMonth: number;
    aiEnabled: boolean;
    stockEnabled: boolean;
    automationEnabled: boolean;
  };
  usage: { users: number; contacts: number; calls: number };
  isActive: boolean;
  plans: Plan[];
}

export default function AbonnementPage() {
  const { toast } = useToast();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/my-subscription`, { credentials: "include" });
      if (res.ok) setData(await res.json());
      else toast({ title: "Erreur", description: "Impossible de charger votre abonnement.", variant: "destructive" });
    } catch {
      toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const sendUpgradeRequest = async () => {
    if (!selectedPlan) return;
    setSending(true);
    try {
      const res = await fetch(`${BASE}api/my-subscription/upgrade-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetPlan: selectedPlan.key, message: upgradeMessage }),
      });
      const result = await res.json();
      if (res.ok) {
        toast({ title: "Demande envoyee", description: result.message });
        setShowUpgrade(false);
        setSelectedPlan(null);
        setUpgradeMessage("");
      } else {
        toast({ title: "Erreur", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Impossible de charger les informations d'abonnement.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { subscription: sub, limits, usage, isActive, plans } = data;
  const usagePercent = (current: number, max: number) => max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;

  const statusBadge = () => {
    if (!sub) return <Badge variant="secondary">Aucun</Badge>;
    if (sub.trialExpired) return <Badge variant="destructive">Essai expire</Badge>;
    if (sub.status === "cancelled") return <Badge variant="destructive">Annule</Badge>;
    if (sub.status === "active") return <Badge className="bg-emerald-500 text-white">Actif</Badge>;
    return <Badge variant="secondary">{sub.status}</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="h-6 w-6" />
            Mon Abonnement
          </h1>
          <p className="text-muted-foreground mt-1">{data.organisation.name}</p>
        </div>
        {statusBadge()}
      </div>

      {!isActive && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">
                {sub?.trialExpired
                  ? "Votre periode d'essai est terminee. Veuillez passer a un plan payant pour continuer a utiliser le service."
                  : sub?.status === "cancelled"
                  ? "Votre abonnement a ete annule. Contactez l'administrateur pour le reactiver."
                  : "Votre compte est actuellement inactif."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Crown className="h-4 w-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">Plan actuel</span>
            </div>
            <p className="text-2xl font-bold">{sub?.planName || "Essai Gratuit"}</p>
            {sub && Number(sub.price) > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                {sub.price} {sub.currency}/{sub.billingCycle === "monthly" ? "mois" : "an"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">
                {sub?.plan === "essai" ? "Jours d'essai restants" : "Prochaine echeance"}
              </span>
            </div>
            <p className="text-2xl font-bold">
              {sub?.plan === "essai"
                ? (sub.daysRemaining !== null ? `${sub.daysRemaining} jours` : "—")
                : (sub?.periodDaysRemaining !== null ? `${sub.periodDaysRemaining} jours` : "—")}
            </p>
            {sub?.trialEndsAt && sub.plan === "essai" && (
              <p className="text-xs text-muted-foreground mt-1">
                Expire le {new Date(sub.trialEndsAt).toLocaleDateString("fr-FR")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Cle de licence</span>
            </div>
            <p className="text-sm font-mono font-medium break-all">
              {sub?.licenseKey || "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Utilisation</CardTitle>
          <CardDescription>Consommation actuelle par rapport aux limites de votre plan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Utilisateurs</span>
              </div>
              <span className="text-sm text-muted-foreground">{usage.users} / {limits.maxUsers}</span>
            </div>
            <Progress value={usagePercent(usage.users, limits.maxUsers)} className="h-2" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <BookUser className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Contacts</span>
              </div>
              <span className="text-sm text-muted-foreground">{usage.contacts} / {limits.maxContacts}</span>
            </div>
            <Progress value={usagePercent(usage.contacts, limits.maxContacts)} className="h-2" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Appels ce mois</span>
              </div>
              <span className="text-sm text-muted-foreground">{usage.calls} / {limits.maxCallsPerMonth}</span>
            </div>
            <Progress value={usagePercent(usage.calls, limits.maxCallsPerMonth)} className="h-2" />
          </div>

          <Separator />

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="flex flex-col items-center gap-1">
              <Brain className={`h-5 w-5 ${limits.aiEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{limits.aiEnabled ? "IA Active" : "IA Inactive"}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Package className={`h-5 w-5 ${limits.stockEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{limits.stockEnabled ? "Stock Actif" : "Stock Inactif"}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Zap className={`h-5 w-5 ${limits.automationEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{limits.automationEnabled ? "Auto. Active" : "Auto. Inactive"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Plans Disponibles</CardTitle>
          <CardDescription>Comparez les plans et demandez un changement</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.key}
                className={`border rounded-lg p-4 relative ${plan.isCurrent ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
              >
                {plan.isCurrent && (
                  <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs">
                    Plan actuel
                  </Badge>
                )}
                <h3 className="font-bold text-lg mt-2">{plan.name}</h3>
                <p className="text-2xl font-bold mt-1">
                  {plan.price === 0 ? "Gratuit" : `${plan.price}€`}
                  {plan.price > 0 && <span className="text-sm font-normal text-muted-foreground">/mois</span>}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    {plan.maxUsers} utilisateurs
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    {plan.maxContacts.toLocaleString()} contacts
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    {plan.maxCallsPerMonth.toLocaleString()} appels/mois
                  </li>
                  <li className={`flex items-center gap-2 ${!plan.aiEnabled ? "text-muted-foreground" : ""}`}>
                    {plan.aiEnabled ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="h-3.5 w-3.5 text-center">—</span>}
                    Intelligence Artificielle
                  </li>
                  <li className={`flex items-center gap-2 ${!plan.stockEnabled ? "text-muted-foreground" : ""}`}>
                    {plan.stockEnabled ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="h-3.5 w-3.5 text-center">—</span>}
                    Gestion de stock
                  </li>
                  <li className={`flex items-center gap-2 ${!plan.automationEnabled ? "text-muted-foreground" : ""}`}>
                    {plan.automationEnabled ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <span className="h-3.5 w-3.5 text-center">—</span>}
                    Automatisations
                  </li>
                </ul>
                {!plan.isCurrent && (
                  <Button
                    size="sm"
                    className="w-full mt-4"
                    variant={plan.price > (Number(sub?.price) || 0) ? "default" : "outline"}
                    onClick={() => { setSelectedPlan(plan); setShowUpgrade(true); }}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                    {plan.price > (Number(sub?.price) || 0) ? "Passer a ce plan" : "Changer de plan"}
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
            <DialogTitle>Demande de changement de plan</DialogTitle>
            <DialogDescription>
              Vous souhaitez passer au plan <strong>{selectedPlan?.name}</strong> ({selectedPlan?.price === 0 ? "Gratuit" : `${selectedPlan?.price}€/mois`}).
              Un administrateur examinera votre demande.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Message optionnel pour l'administrateur..."
            value={upgradeMessage}
            onChange={(e) => setUpgradeMessage(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpgrade(false)}>Annuler</Button>
            <Button onClick={sendUpgradeRequest} disabled={sending}>
              {sending ? "Envoi..." : "Envoyer la demande"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
