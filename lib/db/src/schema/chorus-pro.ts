import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

/**
 * Raccordement d'une organisation a Chorus Pro, le portail de facturation de
 * la sphere PUBLIQUE.
 *
 * POURQUOI UN SECOND RACCORDEMENT, a cote de la plateforme agreee.
 *
 * Une facture adressee a l'Etat, a une commune, a un hopital ou a un office
 * HLM ne passe pas par le meme chemin qu'une facture entre entreprises. Depuis
 * 2020 elle doit etre deposee sur Chorus Pro, et la loi de finances pour 2026
 * confirme ce portail comme plateforme du secteur public en reception (B2G) et
 * en emission (G2B). Une PME du batiment qui travaille pour une collectivite
 * n'est donc pas servie par le seul raccordement a une plateforme agreee : sans
 * Chorus Pro, sa facture n'est pas payee.
 *
 * COMMENT. L'acces se fait par l'API Chorus Pro, intermediee par PISTE : un
 * jeton OAuth2 « client credentials » delivre par PISTE, et le compte
 * technique Chorus Pro porte a part, dans l'en-tete `cpro-account`. Les deux
 * secrets sont chiffres au repos (lib/crypto) et ne sont jamais renvoyes au
 * navigateur.
 *
 * Les adresses restent des DONNEES et non des constantes du code : l'AIFE fait
 * evoluer ses chemins et ses environnements (qualification, production), et une
 * adresse ecrite en dur devient une panne le jour ou elle change. Les valeurs
 * par defaut sont proposees par l'ecran de reglages.
 */
export const raccordementsChorusProTable = pgTable("raccordements_chorus_pro", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Base de l'API, sans chemin (ex. https://api.piste.gouv.fr/cpro). */
  urlBase: text("url_base").notNull(),
  /** Point de jeton OAuth2 de PISTE (ex. https://oauth.piste.gouv.fr/api/oauth/token). */
  urlJeton: text("url_jeton").notNull(),
  /** Identifiants de l'application PISTE. */
  clientId: text("client_id").notNull(),
  /** Chiffre (encryptSensitiveData). */
  clientSecretChiffre: text("client_secret_chiffre").notNull(),
  /** Compte technique Chorus Pro (ex. TECH_...@cpro.fr). */
  compteTechnique: text("compte_technique").notNull(),
  /** Chiffre : mot de passe du compte technique, envoye dans `cpro-account`. */
  motDePasseTechniqueChiffre: text("mot_de_passe_technique_chiffre").notNull(),
  /** Identifiant de l'utilisateur Chorus Pro au nom duquel le depot est fait. */
  idUtilisateurCourant: integer("id_utilisateur_courant"),
  /**
   * Syntaxe declaree au depot. Chorus Pro nomme ainsi le format du fichier ;
   * la valeur exacte depend du flux et de l'environnement, d'ou un reglage.
   */
  syntaxeFlux: text("syntaxe_flux").notNull(),
  actif: boolean("actif").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("raccordements_chorus_pro_org_unique").on(table.organisationId),
]);

export type RaccordementChorusPro = typeof raccordementsChorusProTable.$inferSelect;
