import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Listes personnalisees de securite par organisation: domaines et numeros de
// telephone explicitement bloques ("block") ou autorises ("allow"). Alimentent
// les scanners (url-safety, reputation telephone) pour donner a chaque KOBI le
// controle final sur ce qui est sur ou dangereux pour son activite.
export const securityListsTable = pgTable("security_lists", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull(),
  entryType: text("entry_type").notNull(), // "domain" | "phone"
  listKind: text("list_kind").notNull(), // "block" | "allow"
  value: text("value").notNull(), // domaine normalise ou numero E.164
  note: text("note"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("security_lists_org_idx").on(table.organisationId),
  uniqueIndex("security_lists_org_type_value_idx").on(
    table.organisationId,
    table.entryType,
    table.value,
  ),
]);

export type SecurityListEntry = typeof securityListsTable.$inferSelect;
