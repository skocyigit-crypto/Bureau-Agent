/**
 * pwa-standalone-redirect.tsx
 *
 * Demande utilisateur : "Masa ustune indirildigi an hemen tum calisabilecegi
 * uygulamalari ve logiciels'leri aninda bulacak" — quand l'app PWA est
 * installee sur le bureau (Windows / macOS / mobile home), on veut qu'au
 * tout premier lancement en mode standalone elle :
 *   1. redirige automatiquement vers /logiciels (Decouverte intelligente),
 *   2. previenne l'utilisateur via un toast "analyse de votre environnement
 *      en cours" pour qu'il sente l'auto-detection.
 *
 * Le composant est silencieux dans tous les autres cas :
 *  - lance dans un onglet de navigateur classique -> rien
 *  - lance en standalone une seconde fois -> rien (flag persiste localStorage)
 *  - non authentifie -> rien (l'auth gate s'en occupe)
 *
 * Le scan reel des integrations est deja fait par /api/integrations/smart-discovery
 * (cf. routes/discovery.ts) et la page /logiciels appelle ce endpoint
 * automatiquement au mount. Notre role ici se limite a amener l'utilisateur
 * sur cette page la premiere fois.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const FLAG_KEY = "pwa-standalone-first-launch-handled-v1";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // 1. Standard PWA (Chrome / Edge / Android)
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // 2. iOS Safari "Add to Home Screen"
  if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
  return false;
}

export function PwaStandaloneRedirect() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    // On ne tente la redirection qu'une seule fois par installation.
    if (typeof window === "undefined") return;
    if (!isStandalone()) return;
    if (localStorage.getItem(FLAG_KEY)) return;

    // Si l'utilisateur n'est pas encore loge (login / register), on attend :
    // l'effet sera re-evalue apres login car le composant est monte au
    // niveau de l'app et `location` change.
    // startsWith pour couvrir /login?next=... et /register?invite=...
    if (location.startsWith("/login") || location.startsWith("/register")) return;

    // Si on est deja sur /logiciels (rare), pas besoin de naviguer.
    if (!location.startsWith("/logiciels")) {
      navigate("/logiciels");
    }
    toast({
      title: "Application installee",
      description: "Analyse de votre environnement en cours — detection automatique des outils compatibles.",
      duration: 6000,
    });
    localStorage.setItem(FLAG_KEY, "1");
  }, [location, navigate, toast]);

  return null;
}
