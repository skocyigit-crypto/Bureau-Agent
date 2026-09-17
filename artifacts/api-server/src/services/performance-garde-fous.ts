/**
 * Evaluation de salaries : exactitude, minimisation, coherence.
 *
 * CE QUI ETAIT MESURE LE 17/09 (services/performance-analyzer.ts)
 *
 *  1. ATTRIBUTION PAR SOUS-CHAINE. Les taches et les POINTAGES (heures,
 *     pauses) etaient rattaches a un salarie par `ILIKE '%Prenom Nom%'`.
 *     « Jean Martin » recevait donc les heures et les pauses de « Jean
 *     Martinez ». Une evaluation nominative batie sur les donnees d'un autre :
 *     c'est l'exactitude (RGPD art. 5.1.d) qui est en cause, sur un sujet qui
 *     peut peser sur un emploi. Un `%` ou `_` dans un nom agissait en joker.
 *
 *  2. IDENTITE ENVOYEE A TROIS FOURNISSEURS. Nom, prenom, e-mail, departement,
 *     heures et pauses de chaque salarie partaient en clair chez Gemini,
 *     OpenAI et Anthropic. Le modele n'a pas besoin de savoir QUI : il compare
 *     des chiffres. On envoie « Salarie-1..n », on re-identifie cote serveur.
 *
 *  3. PROFILAGE ET PLAISANTERIE. Le prompt demandait des « profils
 *     comportementaux » par salarie (motivation, profil), et une blague / une
 *     citation dans un rapport d'evaluation. Retires : le premier est un
 *     profilage que rien ne justifie (CNIL, evaluation systematique), le
 *     second n'a pas sa place dans un document qui juge des personnes.
 *
 *  4. EXPORT CSV VIDE. L'export lisait `userName`, `callCount`, `avgDuration`,
 *     `answerRate`, `performanceScore`... — aucun de ces champs n'existe dans
 *     les metriques. Chaque ligne sortait vide, nom compris.
 *
 *  5. DEUX DEFINITIONS DE « JOUR ». L'ecran : depuis minuit. L'export : les
 *     dernieres 24 h. Deux chiffres differents pour la meme periode affichee.
 *
 *  6. `employeId` arrivait tel que le JSON le donne ; `"12" === 12` est faux, et
 *     le rapport d'un salarie precis revenait vide.
 */

export type Periode = "jour" | "semaine" | "mois";

export function periodeValide(p: unknown): Periode {
  return p === "jour" || p === "mois" ? p : "semaine";
}

/** Debut de periode, UNE seule definition pour l'ecran, le rapport et l'export. */
export function debutPeriode(periode: Periode, maintenant = new Date()): Date {
  const d = new Date(maintenant);
  if (periode === "jour") d.setHours(0, 0, 0, 0);
  else if (periode === "mois") d.setMonth(d.getMonth() - 1);
  else d.setDate(d.getDate() - 7);
  return d;
}

/** Forme de comparaison d'un nom : casse, espaces multiples et bords ignores. */
export function normaliserNom(nom: string): string {
  return nom.trim().replace(/\s+/g, " ").toLowerCase();
}

export const PREFIXE_PSEUDONYME = "Salarie-";

export interface IdentiteSalarie { userId: number; email: string; nom: string; prenom: string; departement: string | null; role: string }

/**
 * Retire l'identite des metriques envoyees aux modeles.
 * `userId` du modele = rang (1..n) ; la table permet la re-identification.
 */
export function pseudonymiser<T extends IdentiteSalarie>(metriques: T[]): {
  donnees: Array<Omit<T, "userId" | "email" | "nom" | "prenom" | "departement"> & { userId: number; salarie: string }>;
  table: Map<number, T>;
} {
  const table = new Map<number, T>();
  const donnees = metriques.map((m, i) => {
    const rang = i + 1;
    table.set(rang, m);
    const reste = { ...m } as unknown as Record<string, unknown>;
    for (const cle of ["userId", "email", "nom", "prenom", "departement"]) delete reste[cle];
    return { ...(reste as Omit<T, "userId" | "email" | "nom" | "prenom" | "departement">), userId: rang, salarie: `${PREFIXE_PSEUDONYME}${rang}` };
  });
  return { donnees, table };
}

/** Remplace « Salarie-3 » par le nom reel, partout dans la reponse du modele. */
export function reidentifier<V>(valeur: V, table: Map<number, IdentiteSalarie>): V {
  const remplacer = (s: string) =>
    s.replace(new RegExp(`${PREFIXE_PSEUDONYME}(\\d+)`, "g"), (brut, n) => {
      const m = table.get(Number(n));
      return m ? `${m.prenom} ${m.nom}` : brut;
    });
  const parcourir = (v: unknown): unknown => {
    if (typeof v === "string") return remplacer(v);
    if (Array.isArray(v)) return v.map(parcourir);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, parcourir(x)]));
    return v;
  };
  return parcourir(valeur) as V;
}

/** Identifiant d'employe recu en JSON : nombre entier positif ou rien. */
export function idEmploye(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Score IA ramene a 0..100 ; absent ou absurde : 0 n'est pas une note, on l'ecarte. */
export function scoreSalarie(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
}
