# Design: RAG paper Q&A + Gemini key separation (ResearchAI / B11)

Date: 2026-06-28
Status: Draft — awaiting user review
Scope: `backend_web` (primary). Frontend `Cloud-project` unchanged.

## 1. Problem

The Socratic chatbot currently has **no retrieval mechanism**. On every question the
backend stuffs the whole paper (`paper.content`, truncated to 120,000 chars) into the
Gemini system prompt. Two generation paths share this:

- `chatController.sendMessage` → `POST /api/chats/:id/messages` (conversational Research Chat)
- `paperController.queryPaper` → `POST /api/papers/:id/query` (one-shot question / guiding questions)

Both call `generateSocraticResponse(paper.content, ...)` in
`src/services/geminiService.js`.

Two goals:
1. Replace "stuff whole paper" with real **RAG** (chunk + embed + retrieve top-k).
2. **Separate the Gemini API key** for ingestion vs interactive chat, so a heavy upload
   burst cannot throttle a student mid-conversation (free-tier 429 isolation).

## 2. Non-goals (YAGNI)

- No cross-library / cross-paper semantic search. Retrieval is always scoped to a single
  `paperId` (or a small selected group). Confirmed with user.
- No Atlas `$vectorSearch` index. Not needed because retrieval is per-paper, so corpus size
  is irrelevant to per-query cost.
- No external vector DB or LangChain.
- No new LLM features in the Analyzer dashboard (`analysisController` stays heuristic).
- No frontend changes — same endpoints, better-grounded answers.

## 3. Chosen approach

**In-memory cosine similarity over per-paper chunks, behind a swappable interface.**

Rationale: each chat targets one paper (~50–200 chunks). Filtering by `paperId` first means
the candidate set is tiny, so an in-Node cosine scan costs microseconds regardless of total
corpus size. A clean `retrieveChunks()` interface lets us swap to Atlas `$vectorSearch`
later (if a library-wide search feature is ever added) without touching callers.

## 4. Data model

New Mongoose model `PaperChunk` → collection `paper_chunks`:

```
{
  paper:      ObjectId (ref 'Paper', indexed),
  uploadedBy: ObjectId (ref 'User'),
  chunkIndex: Number,
  chunkText:  String,
  embedding:  [Number]   // 768 dims (text-embedding-004)
}
index: { paper: 1, chunkIndex: 1 }
```

`Paper.content` is kept as the source of truth and as a fallback context source.

## 5. Tunable constants (top of `ragService.js`)

```
CHUNK_SIZE     = 1000   // chars per chunk
CHUNK_OVERLAP  = 150    // chars of overlap between adjacent chunks
EMBED_MODEL    = 'text-embedding-004'
EMBED_DIMS     = 768
TOP_K          = 4      // chunks retrieved per question
```

## 6. Ingestion pipeline (once, at upload)

New `src/services/ragService.js`:

- `chunkText(text) -> string[]` — sliding window of CHUNK_SIZE with CHUNK_OVERLAP.
- `embedTexts(texts, key) -> number[][]` — Gemini `embedContent` per text, INGEST key.
- `ingestPaper(paperId, content, userId)` — chunk → embed → bulk insert PaperChunk docs.
  Idempotent: deletes existing chunks for the paper before re-inserting (safe re-index).

Hook in `paperController.uploadPaper`: after `paper.save()`, call
`ingestPaper(paper._id, content, user._id)`. Wrapped in try/catch — **ingestion failure
must not fail the upload** (paper still saved; logged for later backfill).

### Backfill for existing papers

New script `src/scripts/ingestExisting.js` (mirrors `backfillData.js`): iterate papers that
have no chunks yet and run `ingestPaper`. Run once after deploy.

## 7. Retrieval + generation (every question)

New in `ragService.js`:

- `retrieveChunks(paperId, queryEmbedding, k) -> {chunkText, score}[]`
  1. Load chunks `WHERE paper = paperId` from Mongo.
  2. `cosineSimilarity(queryEmbedding, chunk.embedding)` for each.
  3. Sort desc, return top-k. (This is the swappable seam.)
- `cosineSimilarity(a, b)` — `dot(a,b) / (norm(a) * norm(b))`.

`geminiService.generateSocraticResponse` updated:

1. `embedTexts([studentMessage], CHAT key)` → queryEmbedding.
2. `retrieveChunks(paperId, queryEmbedding, TOP_K)`.
3. Build context from retrieved `chunkText` joined with separators (instead of raw 120k).
4. System prompt instructs: answer **only from the provided context**, keep Socratic style,
   probe the paper's keywords.
5. Generate with CHAT key.

Signature change: `generateSocraticResponse` needs `paperId` (to retrieve). Both callers
(`sendMessage`, `queryPaper`) already have the paper in scope — pass `paper._id`.

**Fallback:** if a paper has zero chunks (not yet backfilled) or retrieval/embedding throws,
fall back to the current truncated `paper.content` path. Zero regression.

## 8. Gemini API key separation

| Env var             | Used by                                                        |
|---------------------|---------------------------------------------------------------|
| `GEMINI_INGEST_KEY` | upload-time: `extractPaperMetadata` + chunk embeddings (bursty)|
| `GEMINI_CHAT_KEY`   | runtime: question embedding + answer generation (interactive) |

`geminiService.js` instantiates **two** `GoogleGenAI` clients. If a dedicated key is missing,
fall back to the existing `GEMINI_API_KEY` (backward compatible — nothing breaks if only the
old key is set). `.env.example` documents all three with a comment.

## 9. API surface

- Existing endpoints unchanged externally: `/api/chats/*`, `/api/papers/:id/query`. Same
  request/response shape; answers are now retrieval-grounded.
- New: `POST /api/papers/:id/ingest` (auth + `protect`) — manual re-index / backfill trigger.
- No frontend changes.

## 10. Packages

**None new.** `@google/genai` already supports `embedContent`; `pdf-parse` already present.

## 11. Error handling

- try/catch around every Gemini and Mongo call; return clean client messages (no raw
  exception strings).
- Ingestion failure → log + continue (upload still succeeds).
- Empty retrieval / embedding error → fallback to truncated content.
- Input validation on new endpoint (`:id` is a valid ObjectId; paper exists).

## 12. End-to-end test plan (local)

1. Run `node src/scripts/ingestExisting.js` → verify `paper_chunks` populates.
2. Upload a new PDF → verify chunks auto-created (count > 0).
3. Ask a question in chat → log the retrieved chunk indices + scores; confirm the answer
   reflects those chunks.
4. Confirm in logs that INGEST key ≠ CHAT key are used on the respective paths.
5. Delete all chunks for a paper → ask again → confirm graceful fallback to content.

## 13. Files touched

New:
- `src/models/PaperChunk.js`
- `src/services/ragService.js`
- `src/scripts/ingestExisting.js`

Modified:
- `src/services/geminiService.js` (two clients; RAG path in `generateSocraticResponse`)
- `src/controllers/paperController.js` (`uploadPaper` ingest hook; pass paperId in `queryPaper`)
- `src/controllers/chatController.js` (pass paperId in `sendMessage`)
- `src/routes/paperRoutes.js` (`POST /:id/ingest`)
- `.env.example` (two new keys)

## 14. Open assumptions

- `@google/genai` v2.8.0 exposes `ai.models.embedContent({ model, contents })` returning a
  768-dim vector for `text-embedding-004`. Verify during implementation; adjust call shape if
  the SDK differs.
- Free-tier embedding quota is sufficient for backfill of the current paper count; if not,
  backfill batches with a small delay (the retry helper already handles 429).
