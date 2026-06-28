# RAG Paper Q&A + Gemini Key Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the Socratic chatbot in real retrieved paper content (RAG) and split the Gemini API key between ingestion and interactive chat.

**Architecture:** At upload, split a paper into overlapping chunks, embed each with `text-embedding-004`, and store vectors in a new `paper_chunks` collection. At question time, embed the question, cosine-rank that paper's chunks in Node, and feed the top-k chunk texts to Gemini. Retrieval sits behind a `retrieveChunks()` seam so it can later swap to Atlas. Two `GoogleGenAI` clients isolate ingest vs chat quota.

**Tech Stack:** Node.js, Express 5, Mongoose, `@google/genai` (already installed), `node --test` runner (built-in, no new deps).

## Global Constraints

- Gemini keys are **server-side only**, loaded via `dotenv`. Never exposed to the client or any `VITE_`/`REACT_APP_` var.
- **No new npm packages.** `@google/genai` provides `embedContent`; `pdf-parse` already present.
- All new endpoints are JWT-protected with the existing `protect` middleware.
- Comments in **English**.
- Tunable values (`CHUNK_SIZE`, `CHUNK_OVERLAP`, `EMBED_MODEL`, `EMBED_DIMS`, `TOP_K`) are named constants at the top of `ragService.js`.
- Retrieval is always scoped to a single `paperId`. No cross-library search.
- Every Gemini/Mongo call is wrapped in try/catch returning clean messages; ingestion failure must never fail an upload; empty/failed retrieval falls back to truncated `paper.content`.
- Embeddings at ingestion use `GEMINI_INGEST_KEY`; question-embedding + generation use `GEMINI_CHAT_KEY`; both fall back to `GEMINI_API_KEY` if the dedicated key is unset.

---

## File Structure

New:
- `src/models/PaperChunk.js` — Mongoose model for stored chunk vectors.
- `src/services/ragService.js` — chunking, embedding, ingestion, retrieval (the swappable seam).
- `src/scripts/ingestExisting.js` — one-off backfill for papers uploaded before RAG.
- `test/ragService.test.js` — unit tests for pure functions.

Modified:
- `src/services/geminiService.js` — two clients + RAG path in `generateSocraticResponse`.
- `src/controllers/paperController.js` — ingest hook in `uploadPaper`; pass `paperId` in `queryPaper`.
- `src/controllers/chatController.js` — pass `paperId` in `sendMessage`.
- `src/routes/paperRoutes.js` — `POST /:id/ingest`.
- `.env.example` — two new keys (create if absent).

---

## Task 1: PaperChunk model

**Files:**
- Create: `src/models/PaperChunk.js`

**Interfaces:**
- Produces: Mongoose model `PaperChunk` over collection `paper_chunks` with fields
  `paper` (ObjectId), `uploadedBy` (ObjectId), `chunkIndex` (Number), `chunkText` (String),
  `embedding` ([Number]).

- [ ] **Step 1: Create the model**

```javascript
const mongoose = require('mongoose');

const paperChunkSchema = mongoose.Schema(
  {
    paper: { type: mongoose.Schema.Types.ObjectId, ref: 'Paper', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    chunkIndex: { type: Number, required: true },
    chunkText: { type: String, required: true },
    embedding: { type: [Number], required: true }, // 768 dims (text-embedding-004)
  },
  { timestamps: true }
);

paperChunkSchema.index({ paper: 1, chunkIndex: 1 });

module.exports = mongoose.model('PaperChunk', paperChunkSchema, 'paper_chunks');
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "require('./src/models/PaperChunk'); console.log('ok')"`
Expected: prints `ok` with no schema error.

- [ ] **Step 3: Commit**

```bash
git add src/models/PaperChunk.js
git commit -m "feat: add PaperChunk model for RAG embeddings"
```

---

## Task 2: ragService pure functions (chunkText + cosineSimilarity)

**Files:**
- Create: `src/services/ragService.js` (partial — pure functions + constants)
- Test: `test/ragService.test.js`

**Interfaces:**
- Produces:
  - `chunkText(text: string) -> string[]` — sliding window, `CHUNK_SIZE` chars, `CHUNK_OVERLAP` overlap. Empty/blank input returns `[]`.
  - `cosineSimilarity(a: number[], b: number[]) -> number` — returns 0 if either vector is zero-length or zero-norm.
  - Exported constants `CHUNK_SIZE=1000`, `CHUNK_OVERLAP=150`, `EMBED_MODEL='text-embedding-004'`, `EMBED_DIMS=768`, `TOP_K=4`.

- [ ] **Step 1: Write the failing tests**

Create `test/ragService.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const { chunkText, cosineSimilarity, CHUNK_SIZE, CHUNK_OVERLAP } = require('../src/services/ragService');

test('chunkText returns [] for empty input', () => {
  assert.deepStrictEqual(chunkText(''), []);
  assert.deepStrictEqual(chunkText('   '), []);
});

test('chunkText keeps short text as a single chunk', () => {
  const out = chunkText('hello world');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0], 'hello world');
});

test('chunkText splits long text with overlap', () => {
  const text = 'a'.repeat(CHUNK_SIZE * 2 + 500);
  const out = chunkText(text);
  assert.ok(out.length >= 3, `expected >=3 chunks, got ${out.length}`);
  // each chunk no longer than CHUNK_SIZE
  out.forEach((c) => assert.ok(c.length <= CHUNK_SIZE));
  // adjacent chunks share CHUNK_OVERLAP chars (window step = SIZE - OVERLAP)
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  assert.strictEqual(out[1], text.slice(step, step + CHUNK_SIZE));
});

test('cosineSimilarity: identical vectors = 1', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});

test('cosineSimilarity: orthogonal vectors = 0', () => {
  assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('cosineSimilarity: zero vector = 0 (no NaN)', () => {
  assert.strictEqual(cosineSimilarity([0, 0], [1, 1]), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `Cannot find module '../src/services/ragService'`.

- [ ] **Step 3: Write the pure functions**

Create `src/services/ragService.js`:

```javascript
// Tunable RAG constants — adjust here, used everywhere.
const CHUNK_SIZE = 1000;   // chars per chunk
const CHUNK_OVERLAP = 150; // chars shared between adjacent chunks
const EMBED_MODEL = 'text-embedding-004';
const EMBED_DIMS = 768;
const TOP_K = 4;

/** Split text into overlapping fixed-size character windows. */
function chunkText(text) {
  if (!text || !text.trim()) return [];
  const clean = text.trim();
  if (clean.length <= CHUNK_SIZE) return [clean];

  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  const chunks = [];
  for (let start = 0; start < clean.length; start += step) {
    chunks.push(clean.slice(start, start + CHUNK_SIZE));
    if (start + CHUNK_SIZE >= clean.length) break;
  }
  return chunks;
}

/** Cosine similarity; returns 0 for empty or zero-norm vectors (no NaN). */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = {
  CHUNK_SIZE, CHUNK_OVERLAP, EMBED_MODEL, EMBED_DIMS, TOP_K,
  chunkText, cosineSimilarity,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/ragService.js test/ragService.test.js
git commit -m "feat: add RAG chunking and cosine similarity with tests"
```

---

## Task 3: ragService embeddings, ingestion, and retrieval

**Files:**
- Modify: `src/services/ragService.js`

**Interfaces:**
- Consumes: `chunkText`, `cosineSimilarity`, `EMBED_MODEL`, `TOP_K` from Task 2; `PaperChunk` model from Task 1.
- Produces:
  - `embedTexts(texts: string[], apiKey: string) -> Promise<number[][]>` — one embedding per text via `text-embedding-004`.
  - `ingestPaper(paperId, content: string, userId) -> Promise<number>` — deletes old chunks for the paper, chunks+embeds+inserts, returns chunk count. Uses `GEMINI_INGEST_KEY` (falls back to `GEMINI_API_KEY`).
  - `retrieveChunks(paperId, queryEmbedding: number[], k=TOP_K) -> Promise<{chunkText, score}[]>` — loads the paper's chunks, cosine-ranks in memory, returns top-k. The swappable seam.

- [ ] **Step 1: Add embeddings + ingestion + retrieval to ragService.js**

Add these imports at the top of `src/services/ragService.js` (above the constants):

```javascript
const { GoogleGenAI } = require('@google/genai');
const PaperChunk = require('../models/PaperChunk');

const ingestKey = () => process.env.GEMINI_INGEST_KEY || process.env.GEMINI_API_KEY;
```

Add these functions before `module.exports`:

```javascript
/**
 * Embed an array of texts. Returns one 768-dim vector per input text.
 * SDK shape (v2.8.0): ai.models.embedContent({ model, contents }) resolves to
 * { embeddings: [{ values: number[] }, ...] }. Defensive against single-object shape.
 */
async function embedTexts(texts, apiKey) {
  if (!apiKey) throw new Error('Embedding API key is not configured.');
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const ai = new GoogleGenAI({ apiKey });

  const out = [];
  for (const text of texts) {
    const res = await ai.models.embedContent({ model: EMBED_MODEL, contents: text });
    const vec = res?.embeddings?.[0]?.values || res?.embedding?.values;
    if (!vec) throw new Error('Embedding response missing values.');
    out.push(vec);
  }
  return out;
}

/** Chunk, embed (INGEST key), and (re)store a paper's chunks. Returns chunk count. */
async function ingestPaper(paperId, content, userId) {
  const chunks = chunkText(content);
  if (chunks.length === 0) return 0;

  const embeddings = await embedTexts(chunks, ingestKey());

  // Idempotent re-index: drop existing chunks for this paper first.
  await PaperChunk.deleteMany({ paper: paperId });

  const docs = chunks.map((chunkText, i) => ({
    paper: paperId,
    uploadedBy: userId,
    chunkIndex: i,
    chunkText,
    embedding: embeddings[i],
  }));
  await PaperChunk.insertMany(docs);
  return docs.length;
}

/** Top-k most similar chunks for a paper. In-memory cosine over the paper's chunks. */
async function retrieveChunks(paperId, queryEmbedding, k = TOP_K) {
  const chunks = await PaperChunk.find({ paper: paperId }).select('chunkText embedding');
  if (chunks.length === 0) return [];
  return chunks
    .map((c) => ({ chunkText: c.chunkText, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

Update `module.exports` to add the new functions:

```javascript
module.exports = {
  CHUNK_SIZE, CHUNK_OVERLAP, EMBED_MODEL, EMBED_DIMS, TOP_K,
  chunkText, cosineSimilarity,
  embedTexts, ingestPaper, retrieveChunks,
};
```

- [ ] **Step 2: Verify the module loads and pure-function tests still pass**

Run: `node -e "require('./src/services/ragService'); console.log('ok')" && node --test`
Expected: prints `ok`; all Task 2 tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/ragService.js
git commit -m "feat: add Gemini embeddings, paper ingestion, and chunk retrieval"
```

---

## Task 4: Two Gemini clients (ingest vs chat key)

**Files:**
- Modify: `src/services/geminiService.js:1-10`

**Interfaces:**
- Produces: module-internal `chatAI` and `ingestAI` `GoogleGenAI` clients keyed by
  `GEMINI_CHAT_KEY` / `GEMINI_INGEST_KEY`, each falling back to `GEMINI_API_KEY`.
  `extractPaperMetadata` uses the ingest client; `generateSocraticResponse` uses the chat client.

- [ ] **Step 1: Replace the single client with two keyed clients**

In `src/services/geminiService.js`, replace lines 1-7 (the `const ai = new GoogleGenAI(...)` block) with:

```javascript
const { GoogleGenAI } = require('@google/genai');

// Separate keys isolate bursty ingestion from interactive chat quota.
// Both fall back to the legacy GEMINI_API_KEY for backward compatibility.
const CHAT_KEY = process.env.GEMINI_CHAT_KEY || process.env.GEMINI_API_KEY;
const INGEST_KEY = process.env.GEMINI_INGEST_KEY || process.env.GEMINI_API_KEY;

const chatAI = new GoogleGenAI({ apiKey: CHAT_KEY });
const ingestAI = new GoogleGenAI({ apiKey: INGEST_KEY });
```

- [ ] **Step 2: Point each call at the right client**

In `generateWithRetry`, it currently calls `ai.models.generateContent(params)`. Change it to accept a client:

```javascript
const generateWithRetry = async (client, params, retries = 2) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.models.generateContent(params);
    } catch (err) {
      let status = '';
      try { status = JSON.parse(err.message).error?.status; } catch { /* not JSON */ }
      const transient = status === 'UNAVAILABLE' || status === 'RESOURCE_EXHAUSTED';
      if (transient && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
};
```

Then update the two call sites:
- In `extractPaperMetadata`: `const response = await generateWithRetry(ingestAI, { ... });`
- In `generateSocraticResponse`: `const response = await generateWithRetry(chatAI, { ... });`

Update the two `if (!process.env.GEMINI_API_KEY)` guards to check the relevant key:
- `extractPaperMetadata`: `if (!INGEST_KEY) { throw new Error('Gemini API key is not configured.'); }`
- `generateSocraticResponse`: `if (!CHAT_KEY) { return "Hello! I am the Socratic Bot. Please configure the Gemini API key to enable my brain."; }`

- [ ] **Step 3: Verify the module loads**

Run: `node -e "require('./src/services/geminiService'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/services/geminiService.js
git commit -m "feat: split Gemini into ingest and chat clients with key fallback"
```

---

## Task 5: RAG path in generateSocraticResponse (with fallback)

**Files:**
- Modify: `src/services/geminiService.js` (`generateSocraticResponse` signature + body)

**Interfaces:**
- Consumes: `embedTexts`, `retrieveChunks`, `TOP_K` from ragService; `chatAI`, `CHAT_KEY` from Task 4.
- Produces: `generateSocraticResponse(paperId, paperContent, studentMessage, chatHistory=[], keywords=[]) -> Promise<string>`.
  **Signature change:** `paperId` is now the first argument. Both callers updated in Task 6.

- [ ] **Step 1: Add ragService import**

At the top of `src/services/geminiService.js` (after the `GoogleGenAI` import):

```javascript
const { embedTexts, retrieveChunks, TOP_K } = require('./ragService');
```

- [ ] **Step 2: Rewrite generateSocraticResponse to retrieve context**

Replace the existing `generateSocraticResponse` with:

```javascript
/**
 * Generate a Socratic question grounded in retrieved paper chunks (RAG).
 * Falls back to truncated paperContent if retrieval yields nothing.
 */
const generateSocraticResponse = async (paperId, paperContent, studentMessage, chatHistory = [], keywords = []) => {
  try {
    if (!CHAT_KEY) {
      return "Hello! I am the Socratic Bot. Please configure the Gemini API key to enable my brain.";
    }

    // 1. Retrieve the most relevant chunks for this question (RAG).
    let context = '';
    try {
      const [queryEmbedding] = await embedTexts([studentMessage], CHAT_KEY);
      const hits = await retrieveChunks(paperId, queryEmbedding, TOP_K);
      if (hits.length > 0) {
        context = hits.map((h, i) => `[Excerpt ${i + 1}]\n${h.chunkText}`).join('\n\n');
      }
    } catch (ragErr) {
      console.error('RAG retrieval failed, falling back to full content:', ragErr.message);
    }

    // 2. Fallback: no chunks yet (un-backfilled paper) or retrieval failed.
    if (!context) {
      context = (paperContent || '').substring(0, 120000);
    }

    const focusLine = keywords && keywords.length > 0
      ? `\nKey concepts to probe and assess the student's understanding of: ${keywords.slice(0, 20).join(', ')}.`
      : '';

    const systemPrompt = `You are a Socratic tutor guiding a student through reading an academic paper.
Your goal is to encourage critical thinking and deep understanding.
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.
Answer ONLY using the provided context excerpts; if the answer is not in them, say so and guide the student back to the text.${focusLine}
Context excerpts from the paper:
${context}`;

    const history = chatHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const contents = [
      ...history,
      { role: 'user', parts: [{ text: studentMessage }] },
    ];

    const response = await generateWithRetry(chatAI, {
      model: MODEL,
      contents,
      config: { systemInstruction: systemPrompt },
    });

    return response.text;
  } catch (error) {
    console.error('Gemini Error:', error);
    throw new Error('Failed to generate response from Gemini');
  }
};
```

- [ ] **Step 3: Verify the module loads**

Run: `node -e "require('./src/services/geminiService'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/services/geminiService.js
git commit -m "feat: ground Socratic responses in retrieved chunks with fallback"
```

---

## Task 6: Wire controllers to pass paperId and ingest on upload

**Files:**
- Modify: `src/controllers/chatController.js` (`sendMessage`, ~line 60)
- Modify: `src/controllers/paperController.js` (`uploadPaper` ingest hook; `queryPaper` call)

**Interfaces:**
- Consumes: new `generateSocraticResponse(paperId, ...)` signature from Task 5; `ingestPaper` from ragService.

- [ ] **Step 1: Update chatController.sendMessage**

In `src/controllers/chatController.js`, the call currently is:

```javascript
    const botResponseText = await generateSocraticResponse(
      chat.paper.content,
      text,
      chatHistory.slice(0, -1),
      chat.paper.keywords || []
    );
```

Change it to pass `paperId` first:

```javascript
    const botResponseText = await generateSocraticResponse(
      chat.paper._id,
      chat.paper.content,
      text,
      chatHistory.slice(0, -1),
      chat.paper.keywords || []
    );
```

- [ ] **Step 2: Update paperController.queryPaper**

In `src/controllers/paperController.js`, the call currently is:

```javascript
    const botResponseText = await generateSocraticResponse(
      paper.content,
      studentMessage,
      [],
      paper.keywords || []
    );
```

Change it to:

```javascript
    const botResponseText = await generateSocraticResponse(
      paper._id,
      paper.content,
      studentMessage,
      [],
      paper.keywords || []
    );
```

- [ ] **Step 3: Add ingest hook in uploadPaper**

In `src/controllers/paperController.js`, add the import near the top (after the geminiService require):

```javascript
const { ingestPaper } = require('../services/ragService');
```

After `const createdPaper = await paper.save();` and before `res.status(201).json(createdPaper);`, insert:

```javascript
    // Ingest into the RAG store. Failure must not fail the upload.
    try {
      const count = await ingestPaper(createdPaper._id, content, user._id);
      console.log(`Ingested ${count} chunks for paper ${createdPaper._id}`);
    } catch (ingestErr) {
      console.error('RAG ingestion failed (paper still saved):', ingestErr.message);
    }
```

- [ ] **Step 4: Verify both controllers load**

Run: `node -e "require('./src/controllers/chatController'); require('./src/controllers/paperController'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/chatController.js src/controllers/paperController.js
git commit -m "feat: pass paperId to RAG and ingest chunks on upload"
```

---

## Task 7: Manual re-index endpoint

**Files:**
- Modify: `src/controllers/paperController.js` (new `ingestPaperById` handler + export)
- Modify: `src/routes/paperRoutes.js`

**Interfaces:**
- Consumes: `ingestPaper` from ragService; `protect` middleware.
- Produces: `POST /api/papers/:id/ingest` → `{ paperId, chunks }`.

- [ ] **Step 1: Add the controller handler**

In `src/controllers/paperController.js`, add before `module.exports`:

```javascript
// @desc    Re-index a paper into the RAG store (manual backfill/refresh)
// @route   POST /api/papers/:id/ingest
// @access  Private
const ingestPaperById = async (req, res, next) => {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) {
      res.status(404);
      throw new Error('Paper not found');
    }
    const count = await ingestPaper(paper._id, paper.content, paper.uploadedBy);
    res.json({ paperId: paper._id, chunks: count });
  } catch (error) {
    next(error);
  }
};
```

Add `ingestPaperById` to the `module.exports` object.

- [ ] **Step 2: Add the route**

In `src/routes/paperRoutes.js`, add `ingestPaperById` to the destructured import from the controller, then add the route (after the `/:id/query` route):

```javascript
router.post('/:id/ingest', protect, ingestPaperById);
```

- [ ] **Step 3: Verify routes load**

Run: `node -e "require('./src/routes/paperRoutes'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/controllers/paperController.js src/routes/paperRoutes.js
git commit -m "feat: add POST /api/papers/:id/ingest re-index endpoint"
```

---

## Task 8: Backfill script for existing papers

**Files:**
- Create: `src/scripts/ingestExisting.js`

**Interfaces:**
- Consumes: `connectDB` from `config/db`, `Paper` model, `PaperChunk` model, `ingestPaper` from ragService.

- [ ] **Step 1: Write the backfill script**

Create `src/scripts/ingestExisting.js`:

```javascript
require('dotenv').config();
const connectDB = require('../config/db');
const Paper = require('../models/Paper');
const PaperChunk = require('../models/PaperChunk');
const { ingestPaper } = require('../services/ragService');

(async () => {
  try {
    await connectDB();
    const papers = await Paper.find().select('_id content uploadedBy title');
    let done = 0;
    for (const p of papers) {
      const existing = await PaperChunk.countDocuments({ paper: p._id });
      if (existing > 0) {
        console.log(`skip "${p.title}" (already has ${existing} chunks)`);
        continue;
      }
      try {
        const count = await ingestPaper(p._id, p.content, p.uploadedBy);
        console.log(`ingested "${p.title}": ${count} chunks`);
        done++;
      } catch (err) {
        console.error(`failed "${p.title}": ${err.message}`);
      }
    }
    console.log(`Backfill complete. Ingested ${done} papers.`);
    process.exit(0);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Add an npm script**

In `package.json` `scripts`, add:

```json
    "ingest:existing": "node src/scripts/ingestExisting.js",
```

- [ ] **Step 3: Verify the script parses**

Run: `node --check src/scripts/ingestExisting.js && echo ok`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/ingestExisting.js package.json
git commit -m "feat: add backfill script to ingest existing papers"
```

---

## Task 9: Env documentation + end-to-end verification

**Files:**
- Create/Modify: `.env.example`

**Interfaces:** none (documentation + manual verification).

- [ ] **Step 1: Document the keys in .env.example**

Create or update `.env.example` with (do not include real values):

```bash
PORT=5000
MONGO_URI=
# Legacy single key — used as fallback if the split keys below are unset.
GEMINI_API_KEY=
# Split keys: ingestion (upload-time embeddings + metadata) vs interactive chat.
GEMINI_INGEST_KEY=
GEMINI_CHAT_KEY=
GEMINI_MODEL=gemini-flash-latest
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

- [ ] **Step 2: Backfill and verify chunks exist**

Run: `npm run ingest:existing`
Expected: logs `ingested "..."` lines; `Backfill complete.` Confirm in MongoDB that `paper_chunks` has documents.

- [ ] **Step 3: End-to-end chat check**

Start the server (`npm run dev`), log in via the frontend, open a paper chat, ask a content question. Confirm in the server logs that retrieval ran (add a temporary log of `hits.length` if needed) and the answer reflects the paper. Then ask about something not in the paper and confirm the bot guides back to the text rather than inventing an answer.

- [ ] **Step 4: Verify key separation**

With `GEMINI_INGEST_KEY` and `GEMINI_CHAT_KEY` set to two different keys, upload a paper (ingest path) and chat (chat path). Confirm both work; if one key is invalid, only its path should fail — proving isolation.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "docs: document split Gemini keys in .env.example"
```

---

## Self-Review Notes

- **Spec coverage:** model (T1), constants/chunking/cosine (T2), embeddings/ingest/retrieve (T3), key split (T4), RAG generation + fallback (T5), controller wiring + upload hook (T6), ingest endpoint (T7), backfill (T8), env docs + E2E (T9). All spec sections mapped.
- **Type consistency:** `generateSocraticResponse(paperId, paperContent, studentMessage, chatHistory, keywords)` defined in T5 and called with that exact arg order in T6 (both callers). `ingestPaper(paperId, content, userId)` defined T3, called T6/T7/T8. `retrieveChunks(paperId, queryEmbedding, k)` defined T3, used T5.
- **Fallback path** preserves current behavior for un-backfilled papers (T5 Step 2) — zero regression.
