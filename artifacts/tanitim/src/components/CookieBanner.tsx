import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Cookie, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent");
    if (!consent) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem("cookie_consent", "accepted");
    setVisible(false);
  };

  const refuse = () => {
    localStorage.setItem("cookie_consent", "refused");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6">
      <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 border border-border shadow-2xl rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/30 shrink-0 mt-0.5">
            <Cookie className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold mb-1">Ce site utilise des cookies</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Nous utilisons uniquement des cookies strictement nécessaires au fonctionnement du service (session, authentification). Aucun cookie publicitaire ou de tracking.{" "}
              <Link href="/confidentialite" className="text-primary underline hover:text-primary/80">
                En savoir plus
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={refuse}
            className="text-xs h-9"
          >
            <X className="w-3 h-3 mr-1" />
            Refuser
          </Button>
          <Button
            size="sm"
            onClick={accept}
            className="text-xs h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Check className="w-3 h-3 mr-1" />
            Accepter
          </Button>
        </div>
      </div>
    </div>
  );
}
