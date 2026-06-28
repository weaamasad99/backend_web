const { GoogleGenAI } = require('@google/genai');
const PaperChunk = require('../models/PaperChunk');

const ingestKey = () => process.env.GEMINI_INGEST_KEY || process.env.GEMINI_API_KEY;

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

module.exports = {
  CHUNK_SIZE, CHUNK_OVERLAP, EMBED_MODEL, EMBED_DIMS, TOP_K,
  chunkText, cosineSimilarity,
  embedTexts, ingestPaper, retrieveChunks,
};
