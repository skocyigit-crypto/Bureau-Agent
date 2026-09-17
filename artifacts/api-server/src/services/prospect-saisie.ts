/**
 * Validation de la saisie d'un prospect.
 *
 * Mesure le 17/09 : POST/PATCH /prospects acceptaient n'importe quelle etape ou
 * priorite (la colonne est un texte libre : le prospect disparaissait des
 * colonnes du pipeline), une probabilite « abc » faisait un 500 et 250 %
 * s'enregistrait. `wonAt` restait pose quand on repassait un prospect gagne en
 * negociation, ce qui faussait les statistiques de conversion.
 */

export const ETAPES_PROSPECT = ["nouveau", "contact", "qualification", "proposition", "negociation", "gagne", "perdu"] as const;
export const PRIORITES_PROSPECT = ["haute", "moyenne", "basse"] as const;

export type ResultatSaisie =
  | { ok: true; valeurs: Record<string, unknown> }
  | { ok: false; erreur: string };

/** Probabilite entiere 0-100 ; `null` si la saisie n'est pas un nombre. */
export function probabiliteValide(saisie: unknown): number | null {
  if (saisie === "" || saisie === null || typeof saisie === "boolean") return null;
  const n = Number(saisie);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

/** Montant >= 0 en texte pour la colonne numeric ; `undefined` si invalide. */
export function montantValide(saisie: unknown): string | null | undefined {
  if (saisie === "" || saisie === null || saisie === undefined) return null;
  const n = Number(String(saisie).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n >= 1e10) return undefined;
  return String(n);
}

/** Dates de gain/perte coherentes avec l'etape finale. */
export function datesEtape(etape: string, maintenant = new Date()): { wonAt: Date | null; lostAt: Date | null } {
  return {
    wonAt: etape === "gagne" ? maintenant : null,
    lostAt: etape === "perdu" ? maintenant : null,
  };
}

/**
 * Controle les champs bornes d'une saisie. `partiel` : PATCH (seuls les champs
 * presents sont verifies).
 */
export function validerSaisieProspect(corps: Record<string, unknown>, partiel: boolean): ResultatSaisie {
  const valeurs: Record<string, unknown> = {};
  if (!partiel || corps.stage !== undefined) {
    const etape = corps.stage ?? "nouveau";
    if (!(ETAPES_PROSPECT as readonly unknown[]).includes(etape)) return { ok: false, erreur: "Etape invalide." };
    valeurs.stage = etape;
  }
  if (!partiel || corps.priority !== undefined) {
    const priorite = corps.priority ?? "moyenne";
    if (!(PRIORITES_PROSPECT as readonly unknown[]).includes(priorite)) return { ok: false, erreur: "Priorite invalide." };
    valeurs.priority = priorite;
  }
  if (!partiel || corps.probability !== undefined) {
    const p = probabiliteValide(corps.probability ?? 50);
    if (p === null) return { ok: false, erreur: "La probabilite doit etre un nombre entre 0 et 100." };
    valeurs.probability = p;
  }
  if (corps.value !== undefined) {
    const m = montantValide(corps.value);
    if (m === undefined) return { ok: false, erreur: "Montant invalide." };
    valeurs.value = m;
  }
  if (corps.title !== undefined && (typeof corps.title !== "string" || !corps.title.trim())) {
    return { ok: false, erreur: "Le titre est obligatoire." };
  }
  if (corps.expectedCloseDate) {
    const d = new Date(String(corps.expectedCloseDate));
    if (Number.isNaN(d.getTime())) return { ok: false, erreur: "Date de cloture invalide." };
  }
  return { ok: true, valeurs };
}

/** Borne la pagination : `limit=abc` faisait echouer la requete SQL. */
export function pagination(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const l = Math.trunc(Number(limit));
  const o = Math.trunc(Number(offset));
  return {
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, 500) : 50,
    offset: Number.isFinite(o) && o > 0 ? o : 0,
  };
}
