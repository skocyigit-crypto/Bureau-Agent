import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SESSION_STORAGE_KEY } from "@/lib/api-config";

/**
 * Stockage chiffre du Bearer token de session mobile.
 *
 * AVANT: le token API etait persiste en clair dans AsyncStorage
 * (`adb_api_token_v1`). AsyncStorage n'est PAS chiffre — sur un appareil
 * compromis / root / jailbreak, ou via un backup non chiffre, le token
 * (qui authentifie pleinement l'utilisateur cote serveur) etait lisible
 * tel quel.
 *
 * APRES: le token vit dans `expo-secure-store`, adosse au Keychain iOS /
 * Keystore Android (chiffrement materiel quand disponible). Une migration
 * unique deplace l'ancien token AsyncStorage en clair vers le coffre
 * chiffre puis efface le slot en clair. Les valeurs corrompues (JSON
 * invalide, blob vide) sont nettoyees immediatement pour eviter les
 * boucles de login.
 */

const SECURE_TOKEN_KEY = "adb_api_token_secure_v1";

/**
 * Accessibilite du trousseau — determinante pour les taches de fond.
 *
 * Par defaut, expo-secure-store ecrit en `WHEN_UNLOCKED` : l'entree est
 * illisible tant que l'appareil est verrouille, et apres un redemarrage tant
 * qu'il n'a pas ete deverrouille une fois. Or la tache de fond de localisation
 * (`contexts/LocationContext.tsx`) lit ce token precisement dans cet etat —
 * telephone en poche, ecran verrouille. Avec le defaut, elle n'obtenait jamais
 * de token et aucun ping de position n'etait envoye : la fonctionnalite etait
 * silencieusement inerte quand elle sert le plus.
 *
 * `AFTER_FIRST_UNLOCK` garde une protection reelle (rien n'est lisible avant
 * le premier deverrouillage suivant un redemarrage) tout en autorisant la
 * lecture ecran verrouille, ce qui est le reglage attendu pour un secret dont
 * une tache de fond a besoin.
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * Marqueur non sensible signalant que le token en coffre a deja ete reecrit
 * avec `SECURE_OPTIONS`. L'accessibilite est fixee a l'ECRITURE : les tokens
 * deja stockes conservent `WHEN_UNLOCKED` jusqu'a leur prochaine ecriture.
 * Sans cette reecriture unique, les installations existantes garderaient une
 * tache de fond inerte jusqu'a la prochaine reconnexion.
 */
const ACCESSIBILITY_UPGRADE_KEY = "adb_secure_accessibility_v2";

/**
 * Extrait un token exploitable d'une valeur stockee, qu'elle soit au
 * format JSON legacy `{ "token": "..." }` ou un token brut.
 * Retourne null si rien d'exploitable (=> a nettoyer).
 */
function parseStoredToken(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.token === "string" && parsed.token.length > 0) {
        return parsed.token;
      }
    } catch {
      // JSON corrompu — signaler en nettoyant (retour null).
    }
    return null;
  }
  return trimmed;
}

/**
 * Charge le token de session depuis le coffre chiffre, en migrant une
 * seule fois l'ancien token AsyncStorage en clair si besoin.
 * Nettoie toute valeur corrompue rencontree.
 */
export async function loadSessionToken(): Promise<string | null> {
  // 1. Coffre chiffre (source de verite actuelle).
  let secureRaw: string | null = null;
  try {
    secureRaw = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
  } catch (err) {
    console.warn("[secure-session] Lecture SecureStore echouee:", err);
  }
  const secureToken = parseStoredToken(secureRaw);
  if (secureToken) {
    await upgradeAccessibilityOnce(secureToken);
    return secureToken;
  }
  // Valeur presente mais corrompue/illisible -> nettoyage immediat.
  if (secureRaw) {
    try {
      await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
    } catch (err) {
      console.warn("[secure-session] Nettoyage SecureStore corrompu echoue:", err);
    }
  }

  // 2. Migration unique depuis l'ancien slot AsyncStorage en clair.
  let legacyRaw: string | null = null;
  try {
    legacyRaw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
  } catch (err) {
    console.warn("[secure-session] Lecture AsyncStorage legacy echouee:", err);
  }
  const legacyToken = parseStoredToken(legacyRaw);

  if (legacyToken) {
    // ECRIRE D'ABORD, purger ensuite — et seulement si l'ecriture a reussi.
    //
    // L'ordre inverse perdait la session: la purge du slot en clair reussit
    // meme appareil verrouille (AsyncStorage n'est pas chiffre), tandis que
    // l'ecriture SecureStore, elle, echoue dans cet etat. Le token
    // disparaissait alors des DEUX emplacements et l'utilisateur etait
    // deconnecte definitivement — declenchable par la simple tache de fond de
    // localisation tournant ecran verrouille.
    let migrated = false;
    try {
      await saveSessionToken(legacyToken);
      migrated = true;
    } catch {
      // Coffre indisponible (appareil verrouille, etc.). On CONSERVE le slot
      // en clair: il reste la seule copie, et la migration sera retentee au
      // prochain appel. On rend quand meme le token pour ne pas casser la
      // session en cours.
    }
    if (migrated) {
      try {
        await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
      } catch (err) {
        console.warn("[secure-session] Purge AsyncStorage legacy echouee:", err);
      }
    }
    return legacyToken;
  }

  // Valeur legacy presente mais inexploitable (JSON corrompu, blob vide):
  // rien a migrer, on nettoie pour eviter de la relire a chaque demarrage.
  if (legacyRaw) {
    try {
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (err) {
      console.warn("[secure-session] Purge AsyncStorage legacy echouee:", err);
    }
  }
  return null;
}

/**
 * Reecrit une seule fois le token deja stocke pour lui appliquer
 * `SECURE_OPTIONS`. Sans bruit et sans consequence en cas d'echec: le
 * marqueur n'est pose qu'apres une reecriture reussie, donc l'operation est
 * simplement retentee au prochain demarrage (par exemple si l'appareil etait
 * verrouille). Ne jamais laisser cette montee de version casser un chargement
 * de session qui, lui, a deja reussi.
 */
async function upgradeAccessibilityOnce(token: string): Promise<void> {
  try {
    if (await AsyncStorage.getItem(ACCESSIBILITY_UPGRADE_KEY)) return;
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token, SECURE_OPTIONS);
    await AsyncStorage.setItem(ACCESSIBILITY_UPGRADE_KEY, "1");
  } catch {
    // Reessaie au prochain chargement.
  }
}

/**
 * Persiste le token dans le coffre chiffre. Leve en cas d'echec pour que
 * l'appelant puisse en informer l'utilisateur (la session ne survivra pas
 * au redemarrage sinon).
 */
export async function saveSessionToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token, SECURE_OPTIONS);
    // Le token vient d'etre ecrit avec la bonne accessibilite: la montee de
    // version unique n'a plus lieu d'etre.
    await AsyncStorage.setItem(ACCESSIBILITY_UPGRADE_KEY, "1").catch(() => {});
  } catch (err) {
    console.warn("[secure-session] Ecriture SecureStore echouee:", err);
    throw err;
  }
}

/**
 * Efface le token du coffre chiffre ET tout reliquat en clair AsyncStorage.
 */
export async function clearSessionToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
  } catch (err) {
    console.warn("[secure-session] Suppression SecureStore echouee:", err);
  }
  try {
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Best-effort: l'absence du slot legacy n'est pas une erreur.
  }
}
