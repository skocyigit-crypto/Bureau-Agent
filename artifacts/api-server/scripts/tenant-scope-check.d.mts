/**
 * Types de `tenant-scope-check.mjs`.
 *
 * Le script reste du JavaScript simple : la CI et Cloud Build le lancent par
 * `node ./scripts/tenant-scope-check.mjs --check`, sans compilation. Ces
 * declarations donnent les types au test qui importe sa decision.
 */

export interface BlocAnalyse {
  /** `GET /chemin` pour une route, le nom pour une fonction de premier niveau. */
  name: string;
  start: number;
  text: string;
}

/** Decoupe un fichier en gestionnaires de route et fonctions de premier niveau. */
export declare function blocks(src: string): BlocAnalyse[];

export interface VerdictFichier {
  /** Blocs qui lisent ou ecrivent une table de locataire. */
  examined: number;
  /** Parmi eux, ceux qui ne mentionnent jamais l'organisation. */
  unaware: { name: string; start: number; tables: string[] }[];
}

/**
 * @param scoped    identifiants Drizzle des tables de locataire (`tasksTable`)
 * @param scopedSql noms SQL des memes tables (`tasks`)
 */
export declare function blocsSansOrganisation(
  src: string,
  scoped: ReadonlySet<string>,
  scopedSql: ReadonlySet<string>,
): VerdictFichier;
