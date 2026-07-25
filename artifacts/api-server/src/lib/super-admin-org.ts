/**
 * Identite de l'organisation "proprietaire de la plateforme" (le compte
 * super-admin du SaaS). Les propositions d'actions SaaS de l'agent autonome
 * vivent dans la file d'approbation de CETTE organisation.
 *
 * Repere par slug stable plutot que par id code en dur (l'id varie selon
 * l'environnement). Le resultat est memoise: le slug ne change pas a chaud.
 */
import { db } from "@workspace/db";
import { organisationsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export const SUPER_ADMIN_ORG_SLUG = "agent-de-bureau-sas";

let cachedId: number | null = null;

export async function getSuperAdminOrgId(): Promise<number | null> {
  if (cachedId != null) return cachedId;
  try {
    const [org] = await db
      .select({ id: organisationsTable.id })
      .from(organisationsTable)
      .where(eq(organisationsTable.slug, SUPER_ADMIN_ORG_SLUG))
      .limit(1);
    if (org) cachedId = org.id;
    return org?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "[super-admin-org] Recherche par slug echouee");
    return null;
  }
}
