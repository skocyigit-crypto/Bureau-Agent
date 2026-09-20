import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Petits secrets LOCAUX, ranges dans le coffre chiffre de l'appareil.
 *
 * LE DEFAUT
 *
 * Deux secrets vivaient en clair — ou presque — dans AsyncStorage, qui n'est
 * PAS chiffre :
 *
 *  - le « mot de passe vocal » qui restreint l'activation de l'assistant a son
 *    proprietaire (`app/voice-assistant.tsx`), ecrit tel quel ;
 *  - le code PIN de l'ecran de confidentialite
 *    (`contexts/PrivacyContext.tsx`), ecrit sous la forme d'un
 *    `String.hashCode` Java : 31 bits utiles, sans sel reel, sans iteration.
 *    Les dix mille PIN a quatre chiffres s'enumerent instantanement, et une
 *    simple COLLISION suffit a deverrouiller puisque la comparaison porte sur
 *    l'empreinte.
 *
 * Le second est le plus trompeur : son commentaire d'origine assumait
 * « AsyncStorage n'est pas chiffre mais le PIN n'est pas en clair ». C'est
 * vrai au pied de la lettre et sans effet en pratique — le verrou tient contre
 * un curieux, pas contre quiconque lit le stockage de l'appareil, ce qui est
 * precisement sa raison d'etre.
 *
 * LA CORRECTION
 *
 * Une meilleure empreinte n'aurait rien change au fond : `expo-crypto` n'est
 * pas une dependance du projet, et un secret a quatre chiffres reste
 * enumerable quelle que soit la fonction employee. Ce qui compte, c'est que
 * la valeur ne soit pas LISIBLE. `expo-secure-store` — deja utilise pour le
 * jeton de session (`lib/secure-session.ts`) — s'adosse au Keychain iOS et au
 * Keystore Android.
 *
 * Une migration unique deplace l'ancienne valeur et efface le slot en clair,
 * exactement comme l'a fait `secure-session.ts`.
 */

/**
 * Meme accessibilite que le jeton de session : lisible ecran verrouille apres
 * le premier deverrouillage suivant un redemarrage. Le PIN comme la phrase
 * vocale sont lus au reveil de l'application, parfois avant que l'utilisateur
 * n'ait deverrouille l'appareil.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** Le nom du slot chiffre correspondant a une ancienne cle AsyncStorage. */
function cleCoffre(cleLegacy: string): string {
  // SecureStore n'accepte que [A-Za-z0-9._-] : les cles legacy contiennent des
  // points, ce qui passe, mais on normalise pour ne pas en dependre.
  return `secure_${cleLegacy.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/**
 * Lit le secret, en migrant une seule fois l'ancienne valeur en clair.
 *
 * Rend `null` si rien n'est stocke. Une erreur de coffre n'est pas fatale :
 * l'appelant traite `null` comme « pas de secret », ce qui est le
 * comportement sur un appareil neuf.
 */
export async function lireSecretLocal(cleLegacy: string): Promise<string | null> {
  const cle = cleCoffre(cleLegacy);
  try {
    const enCoffre = await SecureStore.getItemAsync(cle, OPTIONS);
    if (enCoffre) return enCoffre;
  } catch {
    // Coffre indisponible (simulateur mal configure, appareil verrouille avant
    // le premier deverrouillage) : on tente la migration ci-dessous.
  }

  let ancien: string | null = null;
  try {
    ancien = await AsyncStorage.getItem(cleLegacy);
  } catch {
    return null;
  }
  if (!ancien) return null;

  try {
    await SecureStore.setItemAsync(cle, ancien, OPTIONS);
    // Le slot en clair n'est efface QU'APRES une ecriture reussie dans le
    // coffre : l'inverse perdrait le secret si le coffre refuse.
    await AsyncStorage.removeItem(cleLegacy);
  } catch {
    // Migration impossible : on rend quand meme la valeur, sinon l'utilisateur
    // se retrouverait verrouille dehors par une mesure de securite.
  }
  return ancien;
}

/** Ecrit le secret dans le coffre, et s'assure qu'aucune copie en clair ne reste. */
export async function ecrireSecretLocal(cleLegacy: string, valeur: string): Promise<void> {
  await SecureStore.setItemAsync(cleCoffre(cleLegacy), valeur, OPTIONS);
  try {
    await AsyncStorage.removeItem(cleLegacy);
  } catch {
    // Sans consequence : la valeur qui fait foi est celle du coffre.
  }
}

/** Efface le secret des DEUX emplacements. */
export async function effacerSecretLocal(cleLegacy: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(cleCoffre(cleLegacy), OPTIONS);
  } catch {
    // Rien a effacer, ou coffre indisponible.
  }
  try {
    await AsyncStorage.removeItem(cleLegacy);
  } catch {
    // Idem.
  }
}
