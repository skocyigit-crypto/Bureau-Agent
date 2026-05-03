import { useState, useEffect } from "react";
import { X, AlertTriangle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function TrialBanner() {
  const [banner, setBanner] = useState<{ daysRemaining: number; plan: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = "trial_banner_dismissed_date";
    const lastDismissed = localStorage.getItem(key);
    if (lastDismissed && lastDismissed === new Date().toDateString()) {
      setDismissed(true);
      return;
    }

    fetch(`${BASE}/api/my-subscription`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const sub = data?.subscription;
        if (!sub) return;
        if (sub.plan === "essai" && sub.daysRemaining !== null && sub.daysRemaining <= 7) {
          setBanner({ daysRemaining: sub.daysRemaining, plan: sub.plan });
        }
      })
      .catch(() => {});
  }, []);

  const handleDismiss = () => {
    localStorage.setItem("trial_banner_dismissed_date", new Date().toDateString());
    setDismissed(true);
  };

  if (!banner || dismissed) return null;

  const isUrgent = banner.daysRemaining <= 2;
  const isExpired = banner.daysRemaining === 0;

  return (
    <div className={`relative flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium ${isUrgent ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {isExpired
            ? "Votre essai gratuit est terminé. Passez à un plan payant pour continuer."
            : `Il vous reste ${banner.daysRemaining} jour${banner.daysRemaining > 1 ? "s" : ""} d'essai gratuit.`}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/settings?tab=abonnement">
          <Button
            size="sm"
            className={`h-7 text-xs font-bold px-3 ${isUrgent ? "bg-white text-red-700 hover:bg-white/90" : "bg-white text-amber-700 hover:bg-white/90"}`}
          >
            <Zap className="w-3 h-3 mr-1" />
            Passer à un plan payant
          </Button>
        </Link>
        {!isExpired && (
          <button
            onClick={handleDismiss}
            className="text-white/80 hover:text-white transition-colors p-1 rounded"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
