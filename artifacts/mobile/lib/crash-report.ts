import Constants from "expo-constants";
import { Platform } from "react-native";

import { apiUrl, MOBILE_APP_ORIGIN } from "@/lib/api-config";

/**
 * Remontee des plantages de rendu au serveur.
 *
 * AVANT: `ErrorBoundary` acceptait un callback `onError` mais personne ne le
 * fournissait. Un ecran blanc chez un utilisateur ne laissait donc aucune
 * trace — ni cote client, ni cote serveur; on ne pouvait apprendre l'existence
 * d'un crash que si quelqu'un prenait la peine de le signaler.
 *
 * APRES: l'ecran de repli envoie message + pile a `POST /api/client-errors`
 * (non authentifie a dessein: les crashs de demarrage arrivent avant toute
 * session). Best-effort et volontairement silencieux — un echec de report ne
 * doit jamais s'ajouter au probleme que l'utilisateur subit deja.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Evite qu'une boucle de rendu en echec ne martele l'endpoint. */
let reportedThisSession = 0;
const MAX_REPORTS_PER_SESSION = 3;

export function reportCrash(error: Error, componentStack?: string): void {
  if (Platform.OS === "web") return;
  if (reportedThisSession >= MAX_REPORTS_PER_SESSION) return;
  reportedThisSession += 1;

  const stack = [error.stack, componentStack].filter(Boolean).join("\n---\n");
  const body = {
    message: String(error.message || "Erreur inconnue").slice(0, MAX_MESSAGE),
    stack: stack ? stack.slice(0, MAX_STACK) : undefined,
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version,
  };

  // Pas d'await: l'appelant est un chemin de rendu en erreur, il ne doit pas
  // attendre le reseau.
  void fetch(apiUrl("/api/client-errors"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: MOBILE_APP_ORIGIN },
    body: JSON.stringify(body),
  }).catch(() => {
    // Silence volontaire: signaler l'echec du signalement n'aide personne.
  });
}
