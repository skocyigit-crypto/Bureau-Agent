import { pgTable, serial, integer, varchar, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const legalAgreementsTable = pgTable("legal_agreements", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  documentVersion: varchar("document_version", { length: 20 }).notNull().default("1.0"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: varchar("accepted_by", { length: 255 }),
  acceptedIp: varchar("accepted_ip", { length: 45 }),
  revoked: boolean("revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("legal_agreements_org_id_idx").on(table.organisationId),
]);

export const LEGAL_DOCUMENTS = {
  cgu: {
    code: "cgu",
    title: "Conditions Generales d'Utilisation",
    description: "Regles d'utilisation de la plateforme Agent de Bureau. Couvre les droits et obligations de l'utilisateur, les limites d'utilisation, les comportements interdits et les conditions de resiliation.",
    version: "1.0",
    mandatory: true,
    category: "usage",
  },
  cgv: {
    code: "cgv",
    title: "Conditions Generales de Vente",
    description: "Modalites commerciales : tarification, facturation, paiement, remboursement, duree d'engagement et renouvellement automatique.",
    version: "1.0",
    mandatory: true,
    category: "commercial",
  },
  rgpd: {
    code: "rgpd",
    title: "Politique de Confidentialite (RGPD)",
    description: "Protection des donnees personnelles conformement au Reglement General sur la Protection des Donnees (UE 2016/679). Droits d'acces, de rectification, de suppression et de portabilite des donnees.",
    version: "1.0",
    mandatory: true,
    category: "privacy",
  },
  dpa: {
    code: "dpa",
    title: "Accord de Traitement des Donnees (DPA)",
    description: "Contrat entre le responsable du traitement (client) et le sous-traitant (Agent de Bureau) definissant les mesures de securite, la localisation des donnees et les procedures en cas de violation.",
    version: "1.0",
    mandatory: true,
    category: "privacy",
  },
  sla: {
    code: "sla",
    title: "Contrat de Niveau de Service (SLA)",
    description: "Engagement de disponibilite (99,5%), temps de reponse support, procedures d'escalade, maintenance planifiee et indemnisation en cas de non-respect.",
    version: "1.0",
    mandatory: false,
    category: "service",
  },
  propriete: {
    code: "propriete",
    title: "Licence de Propriete Intellectuelle",
    description: "Droits de propriete intellectuelle sur le logiciel. Le client beneficie d'une licence d'utilisation non-exclusive, non-transferable. Toute reproduction ou modification non autorisee est interdite.",
    version: "1.0",
    mandatory: true,
    category: "legal",
  },
  securite: {
    code: "securite",
    title: "Politique de Securite des Donnees",
    description: "Mesures techniques et organisationnelles de securite : chiffrement AES-256, authentification multi-facteurs, sauvegardes automatiques, isolation des donnees multi-tenant et audits de securite.",
    version: "1.0",
    mandatory: false,
    category: "security",
  },
} as const;

export type LegalDocumentCode = keyof typeof LEGAL_DOCUMENTS;
export type LegalAgreement = typeof legalAgreementsTable.$inferSelect;
export type InsertLegalAgreement = typeof legalAgreementsTable.$inferInsert;
