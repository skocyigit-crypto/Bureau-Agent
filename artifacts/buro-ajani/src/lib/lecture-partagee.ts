/**
 * Une meme lecture demandee par plusieurs composants ne doit partir qu'une fois.
 *
 * Mesure le 18/09 (onglet ouvert, immobile, 60 secondes): 33 requetes vers
 * l'API, dont QUATRE vers `/api/my-subscription`. Trois composants montes en
 * permanence l'appellent chacun de leur cote — la banniere de licence, la
 * banniere d'essai, et la verification d'acces — sans savoir que les autres
 * viennent de le faire.
 *
 * Ce n'est pas qu'un gaspillage: le limiteur applicatif borne un utilisateur a
 * 1 000 requetes par quart d'heure. A 33 requetes/minute au repos, deux
 * onglets ouverts suffisent a l'epuiser, et l'application repond alors
 * « Trop de requetes » a son propre utilisateur — y compris sur `/auth/me`,
 * ce qui la fait passer pour deconnectee.
 *
 * Deux garanties, et la seconde compte autant que la premiere:
 *   - MEME VOL: deux appels simultanes partagent la meme promesse;
 *   - MEMOIRE COURTE: le resultat est reutilise pendant `dureeMs`, puis
 *     oublie. Un abonnement suspendu doit se voir vite; on ne met donc pas en
 *     cache pour la session, seulement le temps d'un rendu.
 *
 * Volontairement en memoire du module et non dans `sessionStorage`: ce qui est
 * partage ici est la REQUETE, pas la donnee. Un onglet qui se recharge doit
 * relire, et rien ne doit survivre a une deconnexion.
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
