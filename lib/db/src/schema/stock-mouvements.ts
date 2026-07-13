import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { stockArticlesTable } from "./stock";
import { usersTable } from "./users";
import { projetsTable } from "./projets";

export const stockMouvementsTable = pgTable("stock_mouvements", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  articleId: integer("article_id").references(() => stockArticlesTable.id, { onDelete: "cascade" }),
  articleName: text("article_name").notNull(),
  articleReference: text("article_reference"),
  type: text("type").notNull().default("ajustement"),
  delta: integer("delta").notNull(),
  quantityBefore: integer("quantity_before").notNull().default(0),
  quantityAfter: integer("quantity_after").notNull().default(0),
  reason: text("reason"),
  // Lien optionnel vers un chantier (= projet) pour le job-costing : permet de
  // savoir sur quel chantier un materiel a ete consomme (saisie vocale chantier).
  projetId: integer("projet_id").references(() => projetsTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_stock_mouvements_org").on(table.organisationId),
  index("idx_stock_mouvements_article").on(table.articleId),
  index("idx_stock_mouvements_created").on(table.createdAt),
  index("idx_stock_mouvements_projet").on(table.projetId),
]);

export type StockMouvement = typeof stockMouvementsTable.$inferSelect;
