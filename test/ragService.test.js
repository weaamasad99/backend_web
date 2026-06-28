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
  out.forEach((c) => assert.ok(c.length <= CHUNK_SIZE));
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
