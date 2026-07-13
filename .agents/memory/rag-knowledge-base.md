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
- `searchKnowledge` runs **hybrid** ranking when embeddings exist: per-query
  max-normalized cosine blended with normalized BM25 via `KB_HYBRID_SEM_WEIGHT`
  (0.6 sem / 0.4 lex). A chunk passes the relevance gate if EITHER signal clears
  its floor (`KB_MIN_SCORE` for cosine OR `KB_MIN_SCORE_LEXICAL` for lexical), so
  the "no relevant source → NOT_FOUND" behavior is preserved. With no embeddings
  it falls back to **BM25-only** (FR+EN stopwords). `getKnowledgeStatus().searchMode`
  still reports `"semantic" | "lexical"` (semantic = embeddings present) — that
  enum is unchanged even though semantic mode is now hybrid under the hood.
- Final top-k uses **MMR diversity selection** (`selectDiverse`): ranks a pool
  (`KB_CANDIDATE_POOL`×topK, min `KB_CANDIDATE_POOL_MIN`), drops near-duplicates
  (token-set Jaccard ≥ `KB_DEDUP_THRESHOLD` 0.85 — chunkText overlap produces
  them) and balances relevance vs novelty (`KB_MMR_LAMBDA` 0.7). Applies to BOTH
  hybrid and lexical paths.
- If a valid embedding key ever appears, reindexing auto-upgrades rows to semantic.

**Why:** keeps the feature always-available without a hard dependency on an
embeddings provider, and avoids a `pgvector` extension that may not propagate
dev→prod via Replit Publish. Cosine similarity is computed in Node, org-scoped.
pgvector/HNSW is the documented future scale path.

**How to apply:** don't assume semantic search is active; test the lexical path.
Routes are plain Express (NOT in OpenAPI): `GET /api/knowledge-base/status`,
`POST /api/knowledge-base/ask`, `POST /api/knowledge-base/reindex` (admin +
cooldown) — clients use plain fetch / fetchAuth, no codegen.
