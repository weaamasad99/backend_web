const test = require('node:test');
const assert = require('node:assert');
const { scoreToLevel } = require('../src/services/comprehensionService');

test('scoreToLevel boundaries', () => {
  assert.strictEqual(scoreToLevel(0), 'low');
  assert.strictEqual(scoreToLevel(39), 'low');
  assert.strictEqual(scoreToLevel(40), 'medium');
  assert.strictEqual(scoreToLevel(64), 'medium');
  assert.strictEqual(scoreToLevel(65), 'high');
  assert.strictEqual(scoreToLevel(84), 'high');
  assert.strictEqual(scoreToLevel(85), 'excellent');
  assert.strictEqual(scoreToLevel(100), 'excellent');
});

test('scoreToLevel clamps out-of-range and bad input', () => {
  assert.strictEqual(scoreToLevel(-5), 'low');
  assert.strictEqual(scoreToLevel(200), 'excellent');
  assert.strictEqual(scoreToLevel(NaN), 'low');
  assert.strictEqual(scoreToLevel('70'), 'high');
});
