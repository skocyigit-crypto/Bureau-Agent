import { pgTable, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Dernier etat connu de chaque fournisseur d'IA, PARTAGE entre les instances.
 *
 * Pourquoi une table et pas une variable.
 *
 * L'etat de sante des fournisseurs vivait dans une `Map` de module: une
 * memoire par instance Cloud Run. Le service tourne jusqu'a trois instances et
 * redescend a zero, donc cette memoire se scinde et s'efface en permanence.
 * Consequence mesuree le 15 septembre 2026: Gemini a refuse douze appels en
 * trois heures (`429 — prepayment credits are depleted`), l'agent de sante a
 * tourne quatre fois pendant ce temps, et il a rapporte les fournisseurs IA
 * comme disponibles. Il ne mentait pas: l'instance qui le faisait tourner
 * n'avait, elle, rien vu.
 *
 * C'est la deuxieme fois que cette cecite coute quelque chose — le 1er
 * septembre, une panne d'OpenAI etait passee inapercue une journee entiere.
 * La premiere correction avait rendu l'observation FIDELE; celle-ci la rend
 * PARTAGEE, ce qui est l'autre moitie du probleme.
 *
 * Une ligne par fournisseur, ecrasee a chaque transition. Ce n'est pas un
 * journal: on ne veut pas faire grossir une table a chaque appel d'IA, on veut
 * qu'une instance puisse repondre « quand ce fournisseur a-t-il echoue pour la
 * derniere fois, et pourquoi », meme si ce n'est pas elle qui l'a vu.
 */
export const aiProviderObservationsTable = pgTable(
  "ai_provider_observations",
  {
    /** `gemini`, `anthropic`, `openai`. Une seule ligne par fournisseur. */
    provider: text("provider").primaryKey(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    /** Cause du dernier echec, tronquee: elle sert a diagnostiquer, pas a archiver. */
    lastReason: text("last_reason"),
    /** Echecs consecutifs observes, toutes instances confondues. */
    failures: integer("failures").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("ai_provider_observations_provider_uniq").on(table.provider)],
);

export type AiProviderObservation = typeof aiProviderObservationsTable.$inferSelect;
