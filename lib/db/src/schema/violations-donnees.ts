import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

/**
 * Registre des violations de donnees (RGPD art. 33 et 34).
 *
 * CE QUI MANQUAIT
 *
 * Le contrat de sous-traitance signe avec chaque client promet, noir sur
 * blanc : « Violation de donnees : l'editeur notifie le client dans les
 * meilleurs delais et au plus tard soixante-douze (72) heures [...] les
 * elements necessaires a sa propre notification a la CNIL. »
 *
 * Cote code, rien. Aucune table, aucun delai, aucune liste des elements a
 * fournir. Un engagement contractuel sans mecanisme est une promesse qu'on
 * decouvre intenable le jour ou elle se declenche — et ce jour-la, personne
 * n'a le temps d'improviser.
 *
 * C'est la meme forme que la politique de conservation qui annoncait douze
 * mois sans qu'aucun traitement ne l'applique : une phrase engage, et rien ne
 * la tient.
 *
 * LE PARTAGE DES ROLES
 *
 * L'editeur est SOUS-TRAITANT : il notifie le client « dans les meilleurs
 * delais » (art. 33.2). Le client est RESPONSABLE DE TRAITEMENT : il notifie
 * la CNIL dans les 72 heures suivant sa propre prise de connaissance
 * (art. 33.1), et informe les personnes concernees si le risque est eleve
 * (art. 34).
 *
 * La CNIL et le CEPD attendent du sous-traitant une notification sous 24 a
 * 48 heures, precisement pour laisser au responsable le temps de tenir ses
 * 72 heures. Notifier au bout de 72 heures — ce que le contrat autorise —
 * laisserait au client exactement zero minute.
 */
export const violationsDonneesTable = pgTable("violations_donnees", {
  id: serial("id").primaryKey(),

  // Organisation concernee. NULL = violation touchant plusieurs locataires ou
  // la plateforme elle-meme; une ligne par organisation affectee est creee
  // ensuite, parce que chaque client notifie la CNIL pour SON compte.
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),

  // PRISE DE CONNAISSANCE, et non date de survenance. C'est elle qui fait
  // courir les delais (art. 33.1) — une violation ancienne decouverte hier
  // ouvre 72 heures a partir d'hier.
  decouverteLe: timestamp("decouverte_le", { withTimezone: true }).notNull(),

  // Les quatre elements du 33.3. Stockes separement et non dans un champ
  // libre: une notification incomplete est un manquement distinct, et on doit
  // pouvoir dire lequel manque.
  nature: text("nature").notNull(),
  personnesConcernees: text("personnes_concernees"),
  consequences: text("consequences"),
  mesures: text("mesures"),

  // "brouillon" | "client_notifie" | "clos"
  statut: text("statut").notNull().default("brouillon"),

  // Quand le client a ete effectivement prevenu. C'est cette date que le
  // contrat engage, et la seule qui prouve qu'il a ete tenu.
  clientNotifieLe: timestamp("client_notifie_le", { withTimezone: true }),
  notifiePar: integer("notifie_par"),

  // Si la notification a depasse la cible, l'article 33.1 exige d'en donner
  // les motifs. Le champ existe pour que le motif soit ecrit AU MOMENT du
  // retard, pas reconstitue plus tard.
  motifRetard: text("motif_retard"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("violations_donnees_org_idx").on(table.organisationId),
  index("violations_donnees_decouverte_idx").on(table.decouverteLe),
]);
