import { useEffect, useState } from "react";
import { AlertTriangle, Lock, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type SubInfo = { plan?: string; status?: string; trialEndsAt?: string | null; daysRemaining?: number | null };

export function LicenseStatusBanner() {
  const [sub, setSub] = useState<SubInfo | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/my-subscription`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.subscription && setSub(d.subscription))
      .catch(() => {});
  }, []);

  if (!sub) return null;

  if (sub.status === "suspended") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium bg-red-700 text-white">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Lock className="w-4 h-4 shrink-0" />
          <span className="truncate">Abonnement suspendu — paiement requis pour reprendre l'acces complet.</span>
        </div>
        <Link href="/settings?tab=abonnement">
          <Button size="sm" className="h-7 text-xs font-bold px-3 bg-white text-red-700 hover:bg-white/90">
            Mettre a jour le paiement
          </Button>
        </Link>
      </div>
    );
  }

  if (sub.status === "annulee" || sub.status === "cancelled") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium bg-slate-700 text-white">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="truncate">Abonnement annule — souscrivez a un plan pour continuer.</span>
        </div>
        <Link href="/settings?tab=abonnement">
          <Button size="sm" className="h-7 text-xs font-bold px-3 bg-white text-slate-700 hover:bg-white/90">Voir les plans</Button>
        </Link>
      </div>
    );
  }

  if (sub.status === "past_due") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium bg-orange-600 text-white">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Clock className="w-4 h-4 shrink-0" />
          <span className="truncate">Paiement en retard — l'application est en mode lecture seule. Reglez la derniere facture pour reactiver l'ecriture.</span>
        </div>
        <Link href="/settings?tab=abonnement">
          <Button size="sm" className="h-7 text-xs font-bold px-3 bg-white text-orange-700 hover:bg-white/90">Regler maintenant</Button>
        </Link>
      </div>
    );
  }

  return null;
}
