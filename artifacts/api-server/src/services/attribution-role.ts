/**
 * attribution-role.ts — a qui revient une tache proposee par une IA.
 *
 * Une tache creee par une machine et attribuee a personne n'est pas une tache:
 * c'est une ligne de plus dans une liste que tout le monde regarde et que
 * personne ne prend. C'est le defaut le plus courant des produits qui
 * "automatisent" — ils produisent du travail visible sans produire de
 * responsable.
 *
 * Ce module repond donc a une seule question: quel membre de l'organisation
 * doit voir cette tache, etant donne ce qu'elle demande et le role de chacun.
 *
 * Trois regles portent tout le reste:
 *
 *  1. le ROLE decide, pas le hasard ni l'ordre alphabetique. Une relance de
 *     facture va a la comptabilite si elle existe, une question technique au
 *     terrain, une decision commerciale au commercial;
 *
 *  2. quand le role vise n'existe pas dans l'organisation — beaucoup de TPE
 *     n'ont pas de comptable — on REMONTE vers la direction plutot que de
 *     descendre au premier venu. Une tache mal attribuee vers le haut est
 *     redistribuee; vers le bas, elle est ignoree;
 *
 *  3. on n'attribue JAMAIS a un compte en lecture seule ni a un compte
 *     desactive. Leur donner du travail, c'est le perdre.
 *
 * Fonction pure: aucune I/O. L'appelant fournit les membres, ce module choisit.
 */

/** Membre de l'organisation, reduit a ce qui sert a decider. */
export interface Membre {
  id: number;
  role: string;
  actif: boolean;
  /** Pour expliquer le choix a l'utilisateur, pas pour decider. */
  nom?: string | null;
  prenom?: string | null;
}

/**
 * Nature du travail demande. Volontairement courte: chaque entree doit
 * correspondre a une decision d'attribution DIFFERENTE, sinon elle n'apporte
 * rien qu'une illusion de finesse.
 */
export type NatureTache =
  | "comptabilite"   // relance, facture, paiement, TVA
  | "commercial"     // devis, prospect, relance client
  | "terrain"        // chantier, intervention, materiel
  | "administratif"  // courrier, document, classement
  | "direction";     // decision, validation, litige

/**
 * Roles vises par nature, du plus specifique au plus general.
 *
 * La derniere entree de chaque liste est toujours un role de direction: c'est
 * la regle 2 (remonter plutot que descendre) rendue explicite plutot que
 * codee dans une suite de `if`.
 */
const PREFERENCES: Record<NatureTache, string[]> = {
  comptabilite: ["comptable", "administrateur", "super_admin"],
  commercial: ["commercial", "agent", "administrateur", "super_admin"],
  terrain: ["technicien", "chef_chantier", "agent", "administrateur", "super_admin"],
  administratif: ["agent", "administrateur", "super_admin"],
  direction: ["administrateur", "super_admin"],
};

/** Roles qui ne recoivent jamais de tache, quelle qu'elle soit. */
const JAMAIS_ATTRIBUABLE = new Set(["lecture_seule"]);

export interface Attribution {
  /** L'utilisateur choisi, ou null si l'organisation n'a personne a qui donner ce travail. */
  membre: Membre | null;
  /** Le role sur lequel le choix s'est fait, pour pouvoir l'expliquer. */
  roleRetenu: string | null;
  /**
   * Vrai quand le role ideal etait absent et qu'on a remonte. L'appelant peut
   * le dire dans la tache: « adressee a la direction faute de comptable »
   * vaut mieux qu'une attribution qui semble deliberee.
   */
  parDefaut: boolean;
}

/**
 * Choisit le destinataire d'une tache.
 *
 * `eviter` permet de ne pas renvoyer une tache a celui qui vient d'en creer la
 * cause — utile quand l'IA traite le courriel d'un collaborateur et n'a rien
 * a lui apprendre.
 */
export function attribuer(
  nature: NatureTache,
  membres: Membre[],
  options: { eviter?: number | null } = {},
): Attribution {
  const disponibles = membres.filter(
    (m) => m.actif && !JAMAIS_ATTRIBUABLE.has(m.role) && m.id !== options.eviter,
  );

  const ordre = PREFERENCES[nature] ?? PREFERENCES.administratif;

  for (let i = 0; i < ordre.length; i += 1) {
    const role = ordre[i];
    // A role egal, le plus ancien compte de ce role: un choix stable vaut
    // mieux qu'un choix arbitraire qui change a chaque execution, parce qu'une
    // attribution qui bouge sans raison detruit la confiance dans l'outil.
    const candidats = disponibles.filter((m) => m.role === role).sort((a, b) => a.id - b.id);
    if (candidats.length > 0) {
      return { membre: candidats[0], roleRetenu: role, parDefaut: i > 0 };
    }
  }

  // Personne: ni le role vise, ni aucun repli. La tache existera quand meme,
  // sans assignataire — mais l'appelant le sait et peut le dire.
  return { membre: null, roleRetenu: null, parDefaut: false };
}

/** Le nom affichable d'un membre, ou son identifiant a defaut. */
export function nomAffichable(m: Membre): string {
  const complet = `${m.prenom ?? ""} ${m.nom ?? ""}`.trim();
  return complet.length > 0 ? complet : String(m.id);
}
