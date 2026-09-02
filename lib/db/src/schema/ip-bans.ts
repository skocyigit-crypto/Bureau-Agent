import { pgTable, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";

/**
 * Bannissements d'IP partages entre les instances.
 *
 * Le service API tourne avec `maxScale=3`: jusqu'a trois processus servent le
 * meme domaine, et rien ne garantit qu'un visiteur retombe sur le meme. Le
 * Guardian tenait pourtant sa liste de bannissements dans une `Map` de module,
 * c'est-a-dire une liste par processus. Consequences, toutes deux vraies en
 * production:
 *
 *  - un attaquant banni sur une instance restait servi par les deux autres,
 *    soit trois fois plus de tentatives que la limite affichee;
 *  - l'escalade (5 min -> 15 -> 1 h -> 6 h -> 1 jour, puis definitif au 6e
 *    manquement) comptait separement sur chaque instance. Reparti sur trois,
 *    un attaquant pouvait accumuler quinze manquements sans jamais atteindre
 *    le seuil du bannissement definitif.
 *
 * Cette table est la source partagee. Le Guardian garde sa `Map` en memoire
 * comme cache de lecture — il s'execute sur CHAQUE requete et ne peut pas
 * attendre la base — mais il ecrit ici a chaque bannissement et se resynchronise
 * regulierement. Une IP bannie sur une instance est donc refusee par les trois
 * en moins d'une minute, et le compteur d'escalade est commun.
 *
 * `organisationId` est volontairement absent: un bannissement protege la
 * plateforme entiere, pas un locataire.
 */
export const ipBansTable = pgTable("ip_bans", {
  /** L'adresse elle-meme est la cle: une IP, un bannissement. */
  ip: text("ip").primaryKey(),
  /** Nombre de manquements cumules — c'est lui qui pilote l'escalade. */
  count: integer("count").notNull().default(1),
  /**
   * Fin du bannissement. `null` avec `permanent = true` signifie « sans fin »:
   * on evite `Infinity`, qui n'a pas de representation en timestamp.
   */
  until: timestamp("until", { withTimezone: true }),
  permanent: boolean("permanent").notNull().default(false),
  /** Les cinq derniers motifs, pour qu'un bannissement reste explicable. */
  reasons: text("reasons").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // La resynchronisation ne lit que les bannissements encore actifs.
  index("ip_bans_until_idx").on(table.until),
]);

export type IpBan = typeof ipBansTable.$inferSelect;
