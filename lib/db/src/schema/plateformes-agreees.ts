import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

/**
 * Raccordement d'une organisation a sa plateforme agreee (PA) de facturation
 * electronique.
 *
 * Depuis le 1er septembre 2026, toute entreprise assujettie recoit ses
 * factures par une PA, et les emettra par elle au plus tard le 1er septembre
 * 2027 (PME et micro-entreprises). Ajant Bureau n'est pas une PA : il produit
 * la facture (Factur-X) et la TRANSMET a la plateforme choisie par le client.
 *
 * Le raccordement suit l'API normalisee AFNOR XP Z12-013 (« Flow » et
 * « Directory »), que les plateformes agreees exposent. Un seul client
 * logiciel sert donc n'importe quelle PA conforme : l'organisation renseigne
 * les adresses de SA plateforme et les identifiants OAuth2 (client
 * credentials) que celle-ci lui delivre.
 *
 * Le secret est chiffre au repos (lib/crypto) et n'est jamais renvoye au
 * navigateur. Une organisation n'a qu'un raccordement.
 */
export const plateformesAgreeesTable = pgTable("plateformes_agreees", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Nom affiche (« Super PDP », « Iopole »...). */
  nom: text("nom").notNull(),
  /** Base de l'API AFNOR Flow, sans « /v1 » (ex. https://api.superpdp.tech/afnor-flow). */
  urlFlow: text("url_flow").notNull(),
  /** Point de jeton OAuth2 (ex. https://api.superpdp.tech/oauth2/token). */
  urlJeton: text("url_jeton").notNull(),
  clientId: text("client_id").notNull(),
  /** Chiffre (encryptSensitiveData). */
  clientSecretChiffre: text("client_secret_chiffre").notNull(),
  actif: boolean("actif").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("plateformes_agreees_org_unique").on(table.organisationId),
]);

export type PlateformeAgreee = typeof plateformesAgreeesTable.$inferSelect;
