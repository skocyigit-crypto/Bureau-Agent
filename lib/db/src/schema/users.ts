import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nom: varchar("nom", { length: 100 }).notNull(),
  prenom: varchar("prenom", { length: 100 }).notNull(),
  role: varchar("role", { length: 30 }).notNull().default("agent"),
  departement: varchar("departement", { length: 100 }),
  organisation: varchar("organisation", { length: 200 }).default("Agent de Bureau SAS"),
  telephone: varchar("telephone", { length: 30 }),
  avatar: varchar("avatar", { length: 10 }),
  actif: boolean("actif").notNull().default(true),
  mfaActif: boolean("mfa_actif").notNull().default(false),
  dernierAcces: timestamp("dernier_acces"),
  tentativesEchouees: integer("tentatives_echouees").notNull().default(0),
  verrouilleJusqua: timestamp("verrouille_jusqua"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
