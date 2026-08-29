/**
 * Interpretation de la sonde de session (`GET /api/auth/me`) au demarrage.
 *
 * Cette decision est extraite d'`AuthContext` parce qu'elle est la seule chose
 * qui separe "l'utilisateur reste connecte" de "l'utilisateur est renvoye a
 * l'ecran de connexion", et qu'elle etait auparavant noyee dans un `try/catch`
 * qui confondait trois situations tres differentes:
 *
 *   - le serveur REFUSE le jeton (401/403): la session est bien morte, il faut
 *     l'effacer, purger le cache metier et revenir a l'ecran de connexion;
 *   - le serveur est INJOIGNABLE (pas de reseau, DNS, timeout): on ne sait
 *     rien de la validite du jeton. Deconnecter ici rendait l'application
 *     inutilisable hors ligne des le premier redemarrage, alors qu'elle
 *     maintient justement un cache hors ligne pour ce cas;
 *   - le serveur repond une ERREUR TEMPORAIRE (5xx, 429): pareil, cela ne dit
 *     rien du jeton. L'ancien code effacait la session pour tout statut non-2xx,
 *     donc un simple 503 pendant un deploiement deconnectait tout le parc et
 *     effacait au passage le cache metier de chaque appareil.
 */

export type SessionProbeOutcome =
  /** Jeton accepte: la reponse porte le profil utilisateur. */
  | "valid"
  /** Jeton refuse par le serveur: session a effacer. */
  | "revoked"
  /** Verdict impossible: conserver la session et ouvrir en mode hors ligne. */
  | "unavailable";

/**
 * @param status statut HTTP de la sonde, ou `null` si la requete n'a meme pas
 *   abouti (erreur reseau, DNS, timeout — `fetch` a leve).
 */
export function classifySessionProbe(status: number | null): SessionProbeOutcome {
  if (status === null) return "unavailable";
  if (status >= 200 && status < 300) return "valid";
  // Seul un refus explicite d'authentification condamne la session. Tout le
  // reste — 5xx, 429, 404 d'une route momentanement absente — est une panne
  // cote serveur, pas un verdict sur le jeton.
  if (status === 401 || status === 403) return "revoked";
  return "unavailable";
}
