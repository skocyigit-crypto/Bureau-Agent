/**
 * Une meme lecture demandee par plusieurs composants ne doit partir qu une fois.
 *
 * CE QUI A ETE MESURE, ET CE QUE LA PREMIERE MESURE DISAIT DE TROP
 *
 * Le 18/09, un onglet immobile sur le SERVEUR DE DEVELOPPEMENT emettait 33
 * requetes par minute, dont quatre vers `/api/my-subscription`. J en ai conclu
 * que deux onglets suffisaient a epuiser le quota applicatif (1 000 requetes
 * par quart d heure) — et c etait faux.
 *
 * Reprise sur le BUILD DE PRODUCTION, celui que le client execute: UNE requete
 * par minute au repos. L essentiel des 33 venait du mode developpement (double
 * rendu de React en mode strict, rechargement a chaud). Le quota n a jamais ete
 * menace, et l affirmation inverse ne tenait qu a l endroit ou j avais regarde.
 *
 * CE QUI RESTE VRAI, ET POURQUOI CE FICHIER EXISTE QUAND MEME
 *
 * Trois composants montes en permanence — banniere de licence, banniere
 * d essai, verification d acces — demandent le meme abonnement chacun de son
 * cote, en production aussi. Le profil de l organisation et la liste (constante)
 * des phrases vocales sont redemandes a chaque montage. Ce sont des lectures
 * dupliquees: peu nombreuses, mais inutiles, et elles se multiplient a chaque
 * ecran ouvert.
 *
 * Deux garanties:
 *   - MEME VOL: deux appels simultanes partagent la meme promesse;
 *   - MEMOIRE COURTE: le resultat est reutilise pendant `dureeMs`, puis oublie.
 *     Un abonnement suspendu doit se voir vite.
 *
 * En memoire du module et non dans `sessionStorage`: ce qui est partage est la
 * REQUETE, pas la donnee. Un onglet qui se recharge relit, et rien ne survit a
 * une deconnexion.
 */

type Entree = { expireA: number; promesse: Promise<unknown> };

const enCours = new Map<string, Entree>();

/** Duree par defaut: assez pour couvrir un rendu complet, trop courte pour figer un etat. */
export const DUREE_PARTAGE_MS = 30_000;

/**
 * Execute `charger()` une seule fois par `cle` pendant `dureeMs`.
 *
 * Un echec n'est PAS memorise: reessayer doit rester possible tout de suite —
 * une panne reseau d'une seconde ne doit pas condamner l'ecran pour trente.
 */
export function lecturePartagee<T>(cle: string, charger: () => Promise<T>, dureeMs = DUREE_PARTAGE_MS): Promise<T> {
  const maintenant = Date.now();
  const existante = enCours.get(cle);
  if (existante && existante.expireA > maintenant) {
    return existante.promesse as Promise<T>;
  }
  const promesse = charger().catch((err) => {
    enCours.delete(cle);
    throw err;
  });
  enCours.set(cle, { expireA: maintenant + dureeMs, promesse });
  return promesse;
}

/** Oublie tout: a appeler a la deconnexion, pour ne rien garder d'un autre compte. */
export function oublierLecturesPartagees(): void {
  enCours.clear();
}
