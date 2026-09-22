/**
 * Raccordement d'une organisation et suivi des accuses de la plateforme
 * agreee — partage par les routes et par la tache periodique.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, facturesClientTable, plateformesAgreeesTable } from "@workspace/db";
import { decryptSensitiveData } from "../lib/crypto";
import { accuseDeFacture, trackingIdFacture, type RaccordementPA } from "./plateforme-agreee";

/** Le raccordement actif d'une organisation, secret dechiffre ; null s'il n'y en a pas. */
export async function raccordementDe(orgId: number): Promise<RaccordementPA | null> {
  const [ligne] = await db.select().from(plateformesAgreeesTable)
    .where(and(eq(plateformesAgreeesTable.organisationId, orgId), eq(plateformesAgreeesTable.actif, true)));
  if (!ligne) return null;
  return {
    organisationId: orgId,
    urlFlow: ligne.urlFlow,
    urlJeton: ligne.urlJeton,
    clientId: ligne.clientId,
    clientSecret: decryptSensitiveData(ligne.clientSecretChiffre),
  };
}

/** Met a jour l'accuse des factures deposees et encore en attente. Rend le nombre mis a jour. */
export async function rafraichirAccuses(orgId: number, r: RaccordementPA): Promise<number> {
  const enAttente = await db.select({ id: facturesClientTable.id, reference: facturesClientTable.reference })
    .from(facturesClientTable)
    .where(and(eq(facturesClientTable.organisationId, orgId), inArray(facturesClientTable.paStatut, ["Pending"])))
    .limit(50);
  let n = 0;
  for (const f of enAttente) {
    const flux = await accuseDeFacture(r, trackingIdFacture(orgId, f.reference));
    const statut = flux?.acknowledgement?.status;
    if (!flux || !statut || statut === "Pending") continue;
    await db.update(facturesClientTable).set({ paStatut: statut, paDetail: flux.acknowledgement?.details ?? null })
      .where(and(eq(facturesClientTable.id, f.id), eq(facturesClientTable.organisationId, orgId)));
    n++;
  }
  return n;
}
