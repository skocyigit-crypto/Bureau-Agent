/**
 * Types de `juger-ecran.mjs`.
 *
 * Le module reste du JavaScript simple parce que `verif-ecrans.mjs` est lance
 * par `node scripts/verif-ecrans.mjs`, sans etape de compilation — en CI comme
 * a la main. Le declarer ici donne les types au controle qui l'importe, sans
 * ajouter un outillage au chemin d'execution.
 */

/** Les messages qu'affiche la frontiere d'erreur, dans les langues servies. */
export declare const TEXTES_FRONTIERE_ERREUR: readonly string[];

/** Vrai quand la page montre la frontiere d'erreur au lieu de l'ecran. */
export declare function montreLaFrontiereDErreur(texte: unknown): boolean;

export interface ConstatEcran {
  texte?: string;
  erreurs?: string[];
  reseau?: string[];
  limite?: string[];
  clesNues?: string[];
}

export interface VerdictEcran {
  /** « non_juge » quand la limite de requetes a empeche toute mesure. */
  etat: "probleme" | "non_juge" | "bon";
  vide: boolean;
  frontiere: boolean;
  raisons: string[];
}

export declare function jugerEcran(constat: ConstatEcran): VerdictEcran;
