/**
 * Decouverte d'une demande : ce qu'on sait, ce qui manque avant de chiffrer.
 *
 * Un devis etabli sans surface, sans acces au chantier ou sans budget connu
 * est un devis qu'on refera — ou pire, qu'on tiendra a perte. La liste est
 * fixe (ici, pas en base) pour que l'ecran, le serveur et l'avertissement du
 * devis parlent des memes points.
 */

export const POINTS_DECOUVERTE = [
  "adresse_chantier",
  "type_travaux",
  "surface",
  "acces",
  "photos",
  "budget",
  "delai",
  "decideur",
] as const;
export type PointDecouverte = (typeof POINTS_DECOUVERTE)[number];
export type EtatPoint = { ok: boolean; valeur?: string | null };
export type ListeDecouverte = Partial<Record<PointDecouverte, EtatPoint>>;

/**
 * Valide une liste envoyee par le client. Une cle inconnue est REFUSEE plutot
 * qu'ignoree : un ecran qui croirait enregistrer « parking » et ne verrait
 * jamais la case cochee au retour ment a l'utilisateur.
 */
export function validerListeDecouverte(brut: unknown): { ok: true; valeur: ListeDecouverte } | { ok: false; erreur: string } {
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) return { ok: false, erreur: "Liste de decouverte invalide." };
  const out: ListeDecouverte = {};
  for (const [cle, v] of Object.entries(brut as Record<string, unknown>)) {
    if (!(POINTS_DECOUVERTE as readonly string[]).includes(cle)) return { ok: false, erreur: `Point de decouverte inconnu : ${cle.slice(0, 40)}.` };
    if (v === null || typeof v !== "object" || typeof (v as { ok?: unknown }).ok !== "boolean") {
      return { ok: false, erreur: `Point « ${cle} » : etat attendu { ok: boolean }.` };
    }
    const valeur = (v as { valeur?: unknown }).valeur;
    if (valeur !== undefined && valeur !== null && typeof valeur !== "string") return { ok: false, erreur: `Point « ${cle} » : valeur texte attendue.` };
    out[cle as PointDecouverte] = { ok: (v as { ok: boolean }).ok, valeur: typeof valeur === "string" ? valeur.slice(0, 500) : null };
  }
  return { ok: true, valeur: out };
}

/** Les points non confirmes, dans l'ordre de la liste. */
export function pointsManquants(liste: unknown): PointDecouverte[] {
  const l = (liste && typeof liste === "object" ? liste : {}) as ListeDecouverte;
  return POINTS_DECOUVERTE.filter((p) => !l[p]?.ok);
}

// ---------------------------------------------------------------------------
// Estimation contre prix verifie
// ---------------------------------------------------------------------------

/**
 * Prefixe de la ligne de depart d'un devis cree depuis une opportunite.
 *
 * La valeur d'une opportunite est une ESTIMATION commerciale. Elle entrait
 * dans le devis comme un vrai prix unitaire : le devis pouvait partir et etre
 * accepte a ce montant sans que personne ne l'ait chiffre. La ligne porte
 * maintenant `estimate: true` et ce libelle, et l'acceptation est refusee
 * tant qu'elle n'a pas ete reprise.
 */
export const PREFIXE_ESTIMATION = "Estimation à vérifier — ";

export function contientLigneEstimee(items: unknown): boolean {
  return Array.isArray(items) && items.some((l) => l && typeof l === "object" && (l as { estimate?: unknown }).estimate === true);
}
