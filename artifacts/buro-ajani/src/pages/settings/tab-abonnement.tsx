import { useState, useEffect } from "react";
import { Package, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export function TabAbonnement() {
  const { toast } = useToast();
  const [subscription, setSubscription] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    const loadSubscription = async () => {
      try {
        const BASE = import.meta.env.BASE_URL || "/";
        const [subRes, usageRes, plansRes] = await Promise.all([
          fetch(`${BASE}api/subscription`, { credentials: "include" }),
          fetch(`${BASE}api/subscription/usage`, { credentials: "include" }),
          fetch(`${BASE}api/subscription/plans`, { credentials: "include" }),
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
      } catch (e) {
        console.error("Erreur chargement abonnement:", e);
        setSubError("Impossible de charger les informations d'abonnement. Verifiez votre connexion.");
      } finally {
        setSubLoading(false);
      }
    };
    loadSubscription();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(true);
    try {
      const BASE = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${BASE}api/subscription/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: planId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Abonnement mis a jour", description: data.message });
        const [subRes, usageRes] = await Promise.all([
          fetch(`${BASE}api/subscription`, { credentials: "include" }),
          fetch(`${BASE}api/subscription/usage`, { credentials: "include" }),
        ]);
        if (subRes.ok) setSubscription(await subRes.json());
        if (usageRes.ok) setUsage(await usageRes.json());
      } else {
        const err = await res.json();
        toast({ title: "Erreur", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de mettre a jour l'abonnement.", variant: "destructive" });
    } finally {
      setUpgrading(false);
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
                <CardDescription>Plan {subscription.plan} - {subscription.status === "active" ? "Actif" : subscription.status}</CardDescription>
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
              <p className="text-sm text-amber-600">
                Periode d'essai jusqu'au {new Date(subscription.trialEndsAt).toLocaleDateString("fr-FR")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {plans.length > 0 && (
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
                {plan.aiEnabled && <Badge className="text-[10px] bg-blue-100 text-blue-700 border-0">IA incluse</Badge>}
                {plan.stockEnabled && <Badge className="text-[10px] bg-purple-100 text-purple-700 border-0">Stock</Badge>}
                {plan.automationEnabled && <Badge className="text-[10px] bg-amber-100 text-amber-700 border-0">Automatisation</Badge>}
                {subscription?.plan !== plan.id && (
                  <Button
                    className="w-full mt-2"
                    size="sm"
                    disabled={upgrading}
                    onClick={() => handleUpgrade(plan.id)}
                  >
                    {upgrading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {subscription?.plan && plans.findIndex((p: any) => p.id === subscription.plan) < plans.findIndex((p: any) => p.id === plan.id) ? "Passer a ce plan" : "Choisir"}
                  </Button>
                )}
                {subscription?.plan === plan.id && (
                  <div className="flex items-center gap-1.5 text-emerald-600 text-xs mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Plan actuel
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
