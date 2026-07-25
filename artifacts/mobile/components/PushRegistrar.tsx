import { useEffect, useRef } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { registerForPushNotifications } from "@/lib/push-registration";

/**
 * Enregistre l'appareil aupres du serveur de notifications distantes des qu'une
 * session est ouverte, et le detache a la deconnexion.
 *
 * Composant plutot que simple effet dans un contexte existant: l'enregistrement
 * doit se rejouer a chaque changement de compte (le jeton est rattache a
 * l'utilisateur cote serveur), et rester un no-op silencieux quand le push est
 * indisponible (web, simulateur, permission refusee).
 *
 * La desinscription, elle, vit dans `AuthContext.logout()`: elle doit partir
 * AVANT que le jeton de session ne soit efface, sinon le POST part sans
 * Authorization et se fait rejeter en 401 — l'appareil resterait alors abonne
 * aux notifications du compte quitte.
 */
export function PushRegistrar() {
  const { isAuthenticated, user, authHeaders } = useAuth();
  const registeredFor = useRef<number | null>(null);
  // `authHeaders` change a chaque rotation de jeton: on le lit via une ref pour
  // ne pas relancer l'enregistrement a chaque rendu.
  const headersRef = useRef(authHeaders);
  headersRef.current = authHeaders;

  useEffect(() => {
    const userId = user?.id ?? null;
    if (!isAuthenticated || userId === null) {
      registeredFor.current = null;
      return;
    }
    if (registeredFor.current === userId) return;
    registeredFor.current = userId;
    void registerForPushNotifications(headersRef.current());
  }, [isAuthenticated, user?.id]);

  return null;
}
