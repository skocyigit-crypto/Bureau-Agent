import { and, eq } from "drizzle-orm";
import { contactsTable, db } from "@workspace/db";

/**
 * Un enregistrement (prospect, projet) ne peut etre lie qu'a un contact de SA
 * organisation : sinon le devis ou le projet reprenait le contact d'un autre
 * client. `null` = aucun lien demande ; `false` = contact refuse.
 */
export async function contactDeLOrganisation(contactId: unknown, orgId: number): Promise<number | null | false> {
  if (contactId === null || contactId === undefined || contactId === "") return null;
  const id = Number(contactId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const [c] = await db.select({ id: contactsTable.id }).from(contactsTable)
    .where(and(eq(contactsTable.id, id), eq(contactsTable.organisationId, orgId)));
  return c ? c.id : false;
}
