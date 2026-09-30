/**
 * Un enregistrement ne pointe que vers des lignes de SA organisation.
 *
 * Mesure du 28/09 (audit « chaque enregistrement appartient a une
 * organisation ») : dix routes ecrivaient un identifiant recu dans le corps
 * (contactId, relatedContactId, relatedCallId, relatedTaskId, prospectId)
 * sans verifier a qui appartenait la ligne visee. Aucune lecture ne fuyait
 * encore la donnee d'une autre organisation — toutes filtrent par
 * organisation — mais :
 *   - une tache pointant l'appel d'une autre organisation (relatedCallId)
 *     bloquait definitivement l'analyse IA de cet appel chez elle
 *     (call-processor : « deja traite ») ;
 *   - la cle etrangere repondait 500 pour un identifiant inexistant et 2xx
 *     pour un identifiant existant ailleurs : on pouvait sonder quels
 *     identifiants existent sur la plateforme ;
 *   - la premiere jointure ajoutee sans filtre serait devenue une fuite.
 *
 * Reponse identique qu'il n'existe pas ou qu'il soit ailleurs : la reponse ne
 * dit rien des autres organisations.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Response } from "express";
import { callsTable, contactsTable, db, projetsTable, prospectsTable, tasksTable } from "@workspace/db";

export type GenreReference = "contact" | "appel" | "tache" | "prospect" | "projet";

async function existeDansOrganisation(genre: GenreReference, id: number, orgId: number): Promise<boolean> {
  switch (genre) {
    case "contact": {
      const [l] = await db.select({ id: contactsTable.id }).from(contactsTable)
        .where(and(eq(contactsTable.id, id), eq(contactsTable.organisationId, orgId))).limit(1);
      return !!l;
    }
    case "appel": {
      const [l] = await db.select({ id: callsTable.id }).from(callsTable)
        .where(and(eq(callsTable.id, id), eq(callsTable.organisationId, orgId))).limit(1);
      return !!l;
    }
    case "tache": {
      const [l] = await db.select({ id: tasksTable.id }).from(tasksTable)
        .where(and(eq(tasksTable.id, id), eq(tasksTable.organisationId, orgId))).limit(1);
      return !!l;
    }
    case "projet": {
      // Rattacher une depense, une facture ou un appel au chantier d une autre
      // organisation fausserait SES montants (le dossier additionne par
      // projet_id) sans que rien ne le montre chez elle.
      const [l] = await db.select({ id: projetsTable.id }).from(projetsTable)
        .where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId))).limit(1);
      return !!l;
    }
    case "prospect": {
      const [l] = await db.select({ id: prospectsTable.id }).from(prospectsTable)
        .where(and(eq(prospectsTable.id, id), eq(prospectsTable.organisationId, orgId))).limit(1);
      return !!l;
    }
  }
}

/**
 * Champs dont la valeur ne designe pas une ligne de l'organisation.
 * `null`, `undefined` ou "" = aucun lien demande : accepte.
 */
export async function referencesRefusees(
  orgId: number,
  refs: Array<{ champ: string; genre: GenreReference; valeur: unknown }>,
): Promise<string[]> {
  const refusees: string[] = [];
  for (const r of refs) {
    if (r.valeur === null || r.valeur === undefined || r.valeur === "") continue;
    const id = Number(r.valeur);
    if (!Number.isInteger(id) || id <= 0 || !(await existeDansOrganisation(r.genre, id, orgId))) refusees.push(r.champ);
  }
  return refusees;
}

/** Meme reponse qu'il s'agisse d'un identifiant inexistant ou d'une autre organisation. */
export function refuserReferences(res: Response, champs: string[]): void {
  res.status(400).json({ error: `Reference inconnue dans votre organisation : ${champs.join(", ")}` });
}

/** Garde un identifiant s'il est de l'organisation, sinon `null` (chemins IA : on n'echoue pas, on ne lie pas). */
export async function referenceOuNull(orgId: number, genre: GenreReference, valeur: unknown): Promise<number | null> {
  return (await referencesRefusees(orgId, [{ champ: "x", genre, valeur }])).length === 0 && valeur !== null && valeur !== undefined && valeur !== ""
    ? Number(valeur)
    : null;
}

/**
 * Le rattachement d'un DOCUMENT a une entite (`entityType`/`entityId`).
 *
 * Revue du 30/09 : le televersement acceptait « project » quand le dossier de
 * chantier lisait « projet » — une photo envoyee depuis l'ecran de chantier
 * n'y apparaissait donc jamais — et PUT /documents/:id ecrivait n'importe
 * quel couple sans verifier a qui appartenait la cible : on pouvait accrocher
 * une photo a la note de journal d'une autre organisation, et elle entrait
 * dans son compteur de photos.
 *
 * Une seule orthographe est gardee, et une cible de chantier ou de journal
 * doit etre de l'organisation. Les autres types restent libres (etiquettes
 * historiques), mais leur identifiant n'ouvre aucune lecture croisee.
 */
const ALIAS_ENTITE: Record<string, string> = { project: "projet", projects: "projet", chantier: "projet" };

export function typeEntiteDocument(brut: unknown): string | null {
  if (brut === null || brut === undefined || brut === "") return null;
  const t = String(brut).trim().toLowerCase();
  return ALIAS_ENTITE[t] ?? t;
}

/** Vrai si la cible designee n'est pas de l'organisation (a refuser). */
export async function cibleDocumentRefusee(orgId: number, type: string | null, id: unknown): Promise<boolean> {
  if (!type || id === null || id === undefined || id === "") return false;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return true;
  if (type === "projet") return (await referencesRefusees(orgId, [{ champ: "entityId", genre: "projet", valeur: n }])).length > 0;
  if (type === "journal_chantier") {
    const r = await db.execute(sql`select 1 from journal_chantier where id = ${n} and organisation_id = ${orgId} limit 1`);
    return (r.rows?.length ?? 0) === 0;
  }
  return false;
}
