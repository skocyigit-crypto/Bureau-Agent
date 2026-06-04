import { pgTable, serial, integer, text, real, varchar, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { documentsTable } from "./documents";

// Base de connaissances (RAG) — pilier "Documents intelligents".
//
// `document_chunks` stocke les morceaux indexés d'un document avec leur vecteur
// d'embedding. Choix de conception (sécurité prod): on N'utilise PAS l'extension
// pgvector. L'embedding est un `real[]` ordinaire et le classement par similarité
// cosinus est fait en mémoire dans Node, scope par organisation. Cela évite toute
// dépendance à `CREATE EXTENSION` (le diff Publish dev->prod ne propage pas
// forcément les extensions) et reste portable hors Replit (self-hosting).
//
// Voie d'optimisation future (à grande échelle): migrer `embedding` vers
// `vector(768)` + index HNSW `vector_cosine_ops` une fois l'extension pgvector
// garantie en dev ET prod.
export const documentChunksTable = pgTable("document_chunks", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documentsTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokens: integer("tokens").notNull().default(0),
  // Vecteur d'embedding (dimension variable selon le modèle, ex. 768 pour
  // text-embedding-004). Stocké brut; la similarité est calculée côté Node.
  // NULLABLE: si aucun fournisseur d'embedding n'est disponible (le proxy IA
  // Replit n'expose pas l'endpoint d'embeddings), les chunks sont quand même
  // indexés et la recherche bascule sur un classement lexical (BM25). Dès qu'un
  // embedding valide est calculable, la recherche sémantique reprend
  // automatiquement.
  embedding: real("embedding").array(),
  embedModel: varchar("embed_model", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("document_chunks_org_idx").on(table.organisationId),
  index("document_chunks_document_idx").on(table.documentId),
  uniqueIndex("document_chunks_doc_chunk_uniq").on(table.documentId, table.chunkIndex),
]);

export type DocumentChunk = typeof documentChunksTable.$inferSelect;
export type NewDocumentChunk = typeof documentChunksTable.$inferInsert;
