import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Consentement KVKK au suivi de localisation — stocke PAR UTILISATEUR.
 *
 * Le suivi de presence est permanent et sans interrupteur: la seule barriere
 * est l'ecran d'information KVKK, que l'utilisateur doit accepter avant que
 * quoi que ce soit demarre. Ce consentement est donc personnel par nature.
 *
 * Il etait pourtant conserve sous une cle GLOBALE a l'appareil, jamais effacee
 * a la deconnexion. Sur un appareil partage — poste d'accueil, tablette
 * d'equipe, telephone repris par un collegue — le deuxieme utilisateur voyait
 * son suivi demarrer sans jamais avoir vu l'information, sur la foi du
 * consentement donne par quelqu'un d'autre.
 *
 * La cle porte desormais l'identifiant de l'utilisateur. Un compte qui revient
 * sur l'appareil retrouve son consentement (on ne le fait pas re-accepter sans
 * raison), un compte different repart de zero.
 */

const LEGACY_GLOBAL_KEY = "location:kvkk-acknowledged-v1";
const KEY_PREFIX = "location:kvkk-acknowledged-v2:";

/** Emplacement du consentement d'un utilisateur donne. */
export function kvkkAckKey(userId: number | string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * Vrai si CET utilisateur a accepte l'information KVKK sur cet appareil.
 * Toute erreur de stockage repond false: en cas de doute on remontre
 * l'information plutot que de demarrer un suivi non consenti.
 */
export async function hasAcknowledgedKvkk(
  userId: number | string | null | undefined,
): Promise<boolean> {
  if (userId === null || userId === undefined) return false;
  try {
    return (await AsyncStorage.getItem(kvkkAckKey(userId))) === "1";
  } catch {
    return false;
  }
}

/** Enregistre le consentement de cet utilisateur. */
export async function acknowledgeKvkkFor(
  userId: number | string | null | undefined,
): Promise<void> {
  if (userId === null || userId === undefined) return;
  await AsyncStorage.setItem(kvkkAckKey(userId), "1");
}

/**
 * Supprime l'ancienne cle globale.
 *
 * Elle vaut consentement pour n'importe qui sur l'appareil; la laisser en
 * place reviendrait a conserver la faille pour tous les telephones deja
 * installes. L'utilisateur present reverra l'information une fois, ce qui est
 * le comportement correct puisqu'on ne peut pas savoir qui l'avait acceptee.
 */
export async function purgeLegacyKvkkAck(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_GLOBAL_KEY);
  } catch {
    // Absence de la cle legacy = cas nominal.
  }
}
