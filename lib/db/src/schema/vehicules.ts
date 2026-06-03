import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { projetsTable } from "./projets";

// Parc materiel / flotte (Atego, Sprinter, etc.). Org-scoped (multi-tenant) ;
// convention serial PK comme le reste du schema. Additif : aucune table
// existante n'est dupliquee. La telemetrie/codes-defaut servent a generer des
// SUGGESTIONS de rendez-vous d'entretien (jamais d'action autonome).
export const vehiculesTable = pgTable("vehicules", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  plateNumber: text("plate_number").notNull(),
  brandModel: text("brand_model").notNull(),
  currentMileage: integer("current_mileage").notNull().default(0),
  nextServiceMileage: integer("next_service_mileage"),
  lastKnownFaultCode: text("last_known_fault_code").notNull().default("NONE"),
  // Lien optionnel vers un chantier (= projet). set null : la suppression d'un
  // chantier ne supprime pas le vehicule.
  // ISOLATION MULTI-TENANT : la FK pointe vers projets.id (PK globale), comme
  // tasks.projet_id. L'isolation N'EST PAS garantie au niveau DB ici — toute
  // route qui ecrit assignedProjetId DOIT verifier que le projet appartient a la
  // meme organisation (getOrgId) avant persistance, sinon fuite cross-tenant.
  assignedProjetId: integer("assigned_projet_id").references(() => projetsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("disponible"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Immatriculation unique PAR organisation (pas globalement).
  uniqueIndex("vehicules_org_plate_unique").on(table.organisationId, table.plateNumber),
  index("vehicules_org_id_idx").on(table.organisationId),
  index("vehicules_status_idx").on(table.status),
  index("vehicules_assigned_projet_idx").on(table.assignedProjetId),
]);

export type Vehicule = typeof vehiculesTable.$inferSelect;
export type InsertVehicule = typeof vehiculesTable.$inferInsert;
