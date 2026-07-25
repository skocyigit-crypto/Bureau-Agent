import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cloisonnement du cache hors-ligne par utilisateur.
 *
 * AVANT: `useOfflineCache("contacts_list", [])` ecrivait dans une cle
 * AsyncStorage GLOBALE (`contacts_list`, `calls_list`, `tasks_list`,
 * `dashboard_*`), jamais purgee a la deconnexion. Sur un appareil partage
 * (poste d'accueil, tablette d'equipe), l'utilisateur B qui se connectait
 * apres A voyait les contacts / appels / taches / tableau de bord de A
 * s'afficher depuis le cache tant que la premiere reponse reseau n'etait
 * pas revenue. Fuite de donnees inter-comptes — et inter-organisations,
 * l'app etant multi-locataire.
 *
 * APRES: chaque entree vit sous `adb_cache_v1:<userId>:<cle>`, et toutes
 * les entrees prefixees sont effacees a la deconnexion comme a l'expiration
 * de session (401). Les anciennes cles globales sont purgees au passage.
 */

const CACHE_PREFIX = "adb_cache_v1:";

/** Cle reellement stockee pour un utilisateur donne. */
export function scopedCacheKey(userId: number | string, cacheKey: string): string {
  return `${CACHE_PREFIX}${userId}:${cacheKey}`;
}

/**
 * Efface tout le cache hors-ligne (tous utilisateurs confondus) ainsi que
 * les reliquats de l'ancien schema non cloisonne. Appelee a la
 * deconnexion et sur expiration de session.
 *
 * Best-effort: un echec de stockage ne doit jamais bloquer la
 * deconnexion elle-meme.
 */
export async function clearAllOfflineCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch (err) {
    console.warn("[offline-cache] purge echouee:", err);
  }
}

/**
 * Supprime une eventuelle entree ecrite par l'ancien schema global
 * (cle non prefixee). Appelee une fois par cle au montage du hook, ce qui
 * garantit que les donnees deja presentes sur les appareils installes
 * avant ce correctif disparaissent aussi.
 */
export async function purgeLegacyCacheKey(cacheKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey);
  } catch {
    // Absence de la cle legacy = cas nominal.
  }
}
