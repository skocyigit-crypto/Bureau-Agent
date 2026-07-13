/**
 * Configuration centralisee de l'acces API pour l'application mobile.
 *
 * Source de verite unique pour:
 *   - URL de base de l'API serveur (dev + prod)
 *   - Cle AsyncStorage de la session
 *
 * AVANT: chaque ecran reconstruisait `https://${process.env.EXPO_PUBLIC_DOMAIN}`
 * a la main. Si la variable etait absente (build de prod sans config),
 * l'URL devenait silencieusement `https://undefined` et toutes les
 * requetes echouaient avec un message de DNS opaque.
 *
 * APRES: une seule fonction qui:
 *   1. Prefere EXPO_PUBLIC_API_URL (explicite, attendu en prod).
 *   2. Sinon EXPO_PUBLIC_DOMAIN (compat dev — REPLIT_DEV_DOMAIN injecte
 *      par le script `dev` du package.json).
 *   3. Sinon throw une erreur immediate avec un message actionable
 *      plutot que de laisser fuiter des `https://undefined`.
 */

const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL;
const RAW_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

function deriveApiBase(): string {
  if (RAW_API_URL && RAW_API_URL.trim() !== "") {
    return RAW_API_URL.replace(/\/+$/, "");
  }
  if (RAW_DOMAIN && RAW_DOMAIN.trim() !== "" && RAW_DOMAIN !== "undefined") {
    return `https://${RAW_DOMAIN.replace(/\/+$/, "")}`;
  }
  throw new Error(
    "[api-config] Aucune URL d'API configuree. " +
      "Definir EXPO_PUBLIC_API_URL (recommande en production) " +
      "ou EXPO_PUBLIC_DOMAIN (compat dev Replit). " +
      "Voir artifacts/mobile/lib/api-config.ts.",
  );
}

/**
 * URL de base de l'API serveur, sans slash final.
 * Toujours utiliser cette constante au lieu de reconstruire l'URL.
 *
 * Exemple: `${API_BASE}/api/contacts`
 */
export const API_BASE = deriveApiBase();

/**
 * Origine synthetique envoyee sur les requetes non-GET pour satisfaire la
 * verification CSRF du backend (Origin/Referer obligatoire, cf.
 * artifacts/api-server/src/middleware/security.ts). Un build natif compile
 * (APK/IPA) n'envoie PAS d'Origin/Referer automatiquement (contrairement a un
 * navigateur) — sans cet en-tete fixe, toute requete POST/PUT/PATCH/DELETE
 * (login inclus) serait rejetee en 403 "origine manquante" une fois installee
 * sur un vrai appareil. Doit rester alignee avec l'entree ALLOWED_ORIGINS
 * ajoutee cote serveur pour ce meme host.
 */
export const MOBILE_APP_ORIGIN = "https://agentdebureau.fr";

/**
 * Cle AsyncStorage utilisee pour persister la session entre les
 * redemarrages de l'app. Constante partagee pour eviter les fautes
 * de frappe (`adb_session` vs `adb-session` etc.) qui invalident
 * silencieusement la session a chaque deploiement.
 *
 * NB: depuis la migration vers les Bearer tokens, ce slot ne contient
 * plus de cookie de session manuel mais un token API HMAC opaque.
 * La cle a ete renommee pour signaler ce changement et invalider
 * proprement les sessions cookies legacy au prochain demarrage —
 * AsyncStorage.getItem("adb_session") renverra null, ce qui declenche
 * un retour propre a l'ecran de login plutot que d'envoyer un cookie
 * que le backend ne reconnait plus.
 */
export const SESSION_STORAGE_KEY = "adb_api_token_v1";

/**
 * Construit une URL absolue d'API a partir d'un chemin relatif.
 * Garanti que le slash separateur est present, peu importe que
 * l'appelant fournisse `/api/...` ou `api/...`.
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}
