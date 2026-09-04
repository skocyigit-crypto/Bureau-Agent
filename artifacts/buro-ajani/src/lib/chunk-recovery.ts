/**
 * Recuperation apres l'echec de chargement d'un morceau de code (chunk).
 *
 * Le probleme, vecu: les pages sont chargees paresseusement et leurs fichiers
 * portent un hash de contenu. A chaque deploiement, les anciens fichiers
 * disparaissent du serveur. Un onglet ouvert AVANT le deploiement — ou dont
 * le HTML vient du cache du service worker — continue de demander ces
 * fichiers-la: certaines pages s'ouvrent (leur morceau est deja en cache),
 * d'autres non et affichent l'ecran « rechargez ou reessayez ».
 *
 * Deux defauts corriges ici:
 *
 *  1. Le garde-fou etait un simple drapeau `chunk-reload-done` pose une fois
 *     pour toute la session. Apres un premier rechargement automatique, TOUT
 *     nouvel echec — y compris celui d'un deploiement suivant, une heure plus
 *     tard — tombait sur l'ecran d'erreur. Le garde est desormais temporel:
 *     il empeche la boucle (deux rechargements rapproches ne resolvent rien)
 *     sans condamner la session.
 *
 *  2. Le rechargement pouvait etre reservi par le service worker depuis son
 *     cache, donc avec le MEME vieux HTML qui reference les fichiers
 *     supprimes: on rechargeait pour retomber sur la meme erreur. On vide
 *     donc le cache avant de recharger.
 */

const LAST_RELOAD_KEY = "chunk-reload-at";
const COUNT_KEY = "chunk-reload-count";

/** Deux rechargements plus rapproches que cela signalent une boucle. */
export const RELOAD_COOLDOWN_MS = 30_000;
/** Au-dela, le probleme n'est pas un deploiement: on montre l'erreur. */
export const MAX_RELOADS_PER_SESSION = 3;

/** Reconnait un echec de chargement de module, quel que soit le navigateur. */
export function isChunkLoadError(message: string): boolean {
  return /chunk|dynamically imported|Failed to fetch|Importing a module script failed|error loading/i.test(message);
}

/**
 * Faut-il tenter un rechargement automatique ?
 *
 * Fonction pure pour etre verifiable: c'est la regle qui decide, pas l'effet
 * de bord. `lastAt` et `count` viennent du stockage de session.
 */
export function shouldAutoReload(now: number, lastAt: number | null, count: number): boolean {
  if (count >= MAX_RELOADS_PER_SESSION) return false;
  if (lastAt !== null && now - lastAt < RELOAD_COOLDOWN_MS) return false;
  return true;
}

function readNumber(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    // Navigation privee, stockage refuse: on ne bloque pas la recuperation
    // pour autant — au pire on recharge une fois de trop.
    return null;
  }
}

/**
 * Vide les caches du service worker puis recharge, une seule fois par
 * fenetre de temps. Renvoie `false` si le rechargement n'a PAS ete tente
 * (l'appelant doit alors afficher l'erreur).
 */
export function recoverFromChunkError(now = Date.now()): boolean {
  const lastAt = readNumber(LAST_RELOAD_KEY);
  const count = readNumber(COUNT_KEY) ?? 0;
  if (!shouldAutoReload(now, lastAt, count)) return false;

  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(now));
    sessionStorage.setItem(COUNT_KEY, String(count + 1));
  } catch {
    // Sans stockage, on tente quand meme: mieux vaut une recuperation
    // possible qu'un ecran d'erreur certain.
  }

  const purge = "caches" in window
    ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {})
    : Promise.resolve();

  // Le rechargement attend la purge, sinon le service worker resservirait le
  // HTML perime qu'on vient justement d'incriminer.
  void purge.then(() => window.location.reload());
  return true;
}
