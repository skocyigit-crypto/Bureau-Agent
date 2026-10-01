import { pgTable, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { tasksTable } from "./tasks";

/**
 * « Cette tache ne commence pas avant que celle-la soit finie. »
 *
 * Plan du 29/09, section 7 : quand l'electricien ne peut pas venir jeudi, ce
 * qui compte n'est pas la tache de l'electricien, c'est tout ce qui ne peut
 * commencer qu'apres lui (doublage, peinture, reception). Sans lien entre les
 * taches, un retard restait local : le planning affichait des dates que plus
 * rien ne pouvait tenir.
 *
 * Une ligne = « `tacheId` attend la fin de `dependDe` ». Les deux taches sont de
 * la meme organisation ; la route refuse un lien qui fermerait une boucle
 * (A attend B qui attend A), sans quoi aucune date ne serait calculable.
 *
 * Le glissement n'est PAS ecrit ici ni dans les taches : il est CALCULE
 * (services/planning.ts) et propose. Deplacer automatiquement les dates d'une
 * equipe parce qu'une autre a pris du retard serait decider a sa place.
 */
export const taskDependancesTable = pgTable("task_dependances", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  tacheId: integer("tache_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  dependDe: integer("depend_de").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("task_dependances_paire_uq").on(table.tacheId, table.dependDe),
  index("task_dependances_org_idx").on(table.organisationId),
  index("task_dependances_depend_idx").on(table.dependDe),
]);

export type TaskDependance = typeof taskDependancesTable.$inferSelect;
