---
name: Document Knowledge Base (RAG) dual-mode
description: Why the in-app RAG search runs in lexical mode by default and how it upgrades to semantic; no pgvector dependency.
---

# Document Knowledge Base (RAG) — dual retrieval mode

The Knowledge Base feature answers questions grounded in an org's uploaded
documents (`documents.extractedText` → `document_chunks`).

**Embeddings are unavailable in this Replit environment.** Both Replit AI proxies
(Gemini + OpenAI) explicitly reject embedding calls, and the direct `GEMINI_API_KEY`
is not valid for Google's embedding endpoint. So the service is **dual-mode**:

- `embedding`/`embedModel` columns are NULLABLE; `indexDocument` is fail-soft and
  stores null vectors when embedding fails.
- `searchKnowledge` runs **semantic cosine** ranking only if embeddings exist,
  otherwise falls back to **BM25-style lexical** ranking (FR+EN stopwords,
  `KB_MIN_SCORE_LEXICAL` ≈ 0.05). `getKnowledgeStatus().searchMode` reports
  `"semantic" | "lexical"` and the UIs badge it.
- If a valid embedding key ever appears, reindexing auto-upgrades rows to semantic.

**Why:** keeps the feature always-available without a hard dependency on an
embeddings provider, and avoids a `pgvector` extension that may not propagate
dev→prod via Replit Publish. Cosine similarity is computed in Node, org-scoped.
pgvector/HNSW is the documented future scale path.

**How to apply:** don't assume semantic search is active; test the lexical path.
Routes are plain Express (NOT in OpenAPI): `GET /api/knowledge-base/status`,
`POST /api/knowledge-base/ask`, `POST /api/knowledge-base/reindex` (admin +
cooldown) — clients use plain fetch / fetchAuth, no codegen.
