import { pgTable, serial, integer, text, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";
import { projetsTable } from "./projets";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("en_attente"),
  priority: text("priority").notNull().default("moyenne"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  assignedTo: text("assigned_to"),
  relatedContactId: integer("related_contact_id"),
  relatedCallId: integer("related_call_id"),
  // Lien optionnel vers un chantier (= projet). Utilise par les "ordres de
  // travaux" issus de la saisie vocale chantier (voice-site-ops). Nullable :
  // les taches existantes et le code actuel ne sont pas impactes.
  projetId: integer("projet_id").references(() => projetsTable.id, { onDelete: "set null" }),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceRule: text("recurrence_rule"),
  recurrenceEndDate: timestamp("recurrence_end_date", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  /**
   * L'agent qui a cree la tache, quand ce n'est pas un humain.
   *
   * Nul = quelqu'un l'a saisie. Non nul = une IA l'a proposee, et cette
   * colonne dit LAQUELLE ("secretaire-autonome", "analyse-appel",
   * "analyse-document"...).
   *
   * Pourquoi un identifiant d'agent plutot qu'un simple booleen `creeParIa`:
   * « l'IA » n'est pas une seule chose. Quand une tache est a cote de la
   * plaque, la question utile n'est pas « est-ce l'IA ? » mais « lequel de mes
   * agents fait ca ? » — c'est celle-la qui permet d'en couper un sans couper
   * les autres. Un booleen aurait aussi rendu impossible de distinguer, dans
   * la liste, ce qui vient du depouillement des courriels de ce qui vient de
   * l'analyse d'un appel.
   *
   * Auparavant, rien ne le disait. Certains agents prefixaient le titre
   * ("[Email] ..."), d'autres non: une tache proposee par une machine etait
   * indiscernable d'une tache ecrite par un collegue, et personne ne pouvait
   * savoir a quoi faire confiance.
   */
  createdByAgent: text("created_by_agent"),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("tasks_status_idx").on(table.status),
  index("tasks_related_contact_idx").on(table.relatedContactId),
  index("tasks_related_call_idx").on(table.relatedCallId),
  index("tasks_due_date_idx").on(table.dueDate),
  index("tasks_org_id_idx").on(table.organisationId),
  index("tasks_projet_id_idx").on(table.projetId),
  // Accent-insensitive trigram search index used by the Commandant chat
  // retriever and smart search. Requires `pg_trgm` + `unaccent` and the
  // IMMUTABLE `f_unaccent()` wrapper (see lib/db/scripts/ensure-search-extensions.sql).
  index("tasks_search_trgm_idx").using(
    "gin",
    sql`f_unaccent(${table.title}) gin_trgm_ops`,
    sql`f_unaccent(coalesce(${table.description}, '')) gin_trgm_ops`,
  ),
]);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
