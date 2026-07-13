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
  if (secureToken) return secureToken;
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
  // Toujours purger le slot en clair une fois lu (migre OU corrompu).
  if (legacyRaw) {
    try {
      await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (err) {
      console.warn("[secure-session] Purge AsyncStorage legacy echouee:", err);
    }
  }
  if (legacyToken) {
    await saveSessionToken(legacyToken);
    return legacyToken;
  }
  return null;
}

/**
 * Persiste le token dans le coffre chiffre. Leve en cas d'echec pour que
 * l'appelant puisse en informer l'utilisateur (la session ne survivra pas
 * au redemarrage sinon).
 */
export async function saveSessionToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
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
