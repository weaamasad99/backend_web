const { test } = require('node:test');
const assert = require('node:assert');
const { filterTranslatableFields } = require('./geminiService');

test('drops empty, placeholder, and empty-array fields', () => {
  const out = filterTranslatableFields({
    title: 'Deep Learning',
    abstract: '   ',
    methodology: 'Unknown',
    keyFindings: [],
  });
  assert.deepStrictEqual(out, { title: 'Deep Learning' });
});

test('keeps real values and non-empty findings, trims strings', () => {
  const out = filterTranslatableFields({
    title: '  A Study  ',
    abstract: 'We measured X.',
    methodology: 'Unknown methodology',
    keyFindings: ['Finding one', '  ', 'Finding two'],
  });
  assert.deepStrictEqual(out, {
    title: 'A Study',
    abstract: 'We measured X.',
    keyFindings: ['Finding one', 'Finding two'],
  });
});

test('returns empty object when nothing is translatable', () => {
  assert.deepStrictEqual(
    filterTranslatableFields({ title: '', methodology: 'Unknown', keyFindings: [] }),
    {}
  );
});
