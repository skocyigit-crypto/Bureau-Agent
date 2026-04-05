import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const prospectsTable = pgTable("prospects", {
  id: serial("id").primaryKey(),
  prenom: text("prenom").notNull(),
  nom: text("nom").notNull(),
  societe: text("societe"),
  email: text("email"),
  telephone: text("telephone").notNull(),
  mobile: text("mobile"),
  adresse: text("adresse"),
  ville: text("ville"),
  codePostal: text("code_postal"),
  source: text("source").notNull().default("direct"),
  statut: text("statut").notNull().default("prospect"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProspectSchema = createInsertSchema(prospectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProspect = z.infer<typeof insertProspectSchema>;
export type Prospect = typeof prospectsTable.$inferSelect;
