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
