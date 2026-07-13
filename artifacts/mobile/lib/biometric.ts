/**
 * biometric.ts — Déverrouillage biométrique de l'écran de connexion.
 *
 * Permet à l'utilisateur de se reconnecter par Face ID / Touch ID /
 * empreinte au lieu de retaper son mot de passe à chaque session.
 *
 * Sécurité:
 *  - Les identifiants (email + mot de passe) sont stockés UNIQUEMENT dans
 *    le trousseau matériel via expo-secure-store (Keychain iOS / Keystore
 *    Android chiffrés), jamais dans AsyncStorage en clair.
 *  - La lecture des identifiants exige une authentification biométrique
 *    réussie (LocalAuthentication.authenticateAsync) AVANT tout accès au
 *    trousseau — un attaquant qui obtient l'appareil déverrouillé ne peut
 *    pas extraire le mot de passe sans le facteur biométrique.
 *  - Sur le web, la biométrie n'est pas disponible: toutes les fonctions
 *    se comportent de façon sûre (capability=false, get renvoie null).
 */

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const CRED_EMAIL_KEY = "adb_bio_email_v1";
const CRED_PASSWORD_KEY = "adb_bio_password_v1";
const ENABLED_FLAG_KEY = "adb_bio_enabled_v1";

export interface BiometricCapability {
  /** Matériel présent ET au moins une empreinte/visage enrôlé. */
  available: boolean;
  /** Libellé lisible: "Face ID", "Empreinte digitale" ou "Biométrie". */
  label: string;
}

const isWeb = Platform.OS === "web";

/**
 * Détecte si l'appareil peut faire de la biométrie et renvoie un libellé.
 * Ne demande PAS d'authentification (juste une sonde matérielle).
 */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (isWeb) return { available: false, label: "" };
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !isEnrolled) return { available: false, label: "" };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    let label = "Biométrie";
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      label = "Face ID";
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      label = "Empreinte digitale";
    }
    return { available: true, label };
  } catch {
    return { available: false, label: "" };
  }
}

/** True si l'utilisateur a déjà activé le déverrouillage biométrique. */
export async function isBiometricEnabled(): Promise<boolean> {
  if (isWeb) return false;
  try {
    return (await SecureStore.getItemAsync(ENABLED_FLAG_KEY)) === "1";
  } catch {
    return false;
  }
}

/**
 * Active le déverrouillage biométrique: vérifie d'abord la biométrie, puis
 * stocke les identifiants chiffrés. Renvoie false si l'auth échoue ou si la
 * biométrie est indisponible (l'appelant ne doit alors rien promettre).
 */
export async function enableBiometric(email: string, password: string): Promise<boolean> {
  if (isWeb) return false;
  const cap = await getBiometricCapability();
  if (!cap.available) return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirmez pour activer le déverrouillage biométrique",
      cancelLabel: "Annuler",
      disableDeviceFallback: false,
    });
    if (!result.success) return false;
    await SecureStore.setItemAsync(CRED_EMAIL_KEY, email);
    await SecureStore.setItemAsync(CRED_PASSWORD_KEY, password);
    await SecureStore.setItemAsync(ENABLED_FLAG_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Désactive et efface tout identifiant stocké. Idempotent. */
export async function disableBiometric(): Promise<void> {
  if (isWeb) return;
  try {
    await SecureStore.deleteItemAsync(CRED_EMAIL_KEY);
    await SecureStore.deleteItemAsync(CRED_PASSWORD_KEY);
    await SecureStore.deleteItemAsync(ENABLED_FLAG_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Demande l'authentification biométrique puis renvoie les identifiants
 * stockés. Renvoie null si l'auth échoue, si rien n'est stocké, ou sur web.
 */
export async function getBiometricCredentials(): Promise<{ email: string; password: string } | null> {
  if (isWeb) return null;
  if (!(await isBiometricEnabled())) return null;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Déverrouillez Agent de Bureau",
      cancelLabel: "Annuler",
      disableDeviceFallback: false,
    });
    if (!result.success) return null;
    const email = await SecureStore.getItemAsync(CRED_EMAIL_KEY);
    const password = await SecureStore.getItemAsync(CRED_PASSWORD_KEY);
    if (!email || !password) return null;
    return { email, password };
  } catch {
    return null;
  }
}
