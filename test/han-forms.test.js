// The Simplified and Traditional character tables behind the detection of Traditional Chinese are data. Keep them sound:
// a character is in only one table, and the tables are as long as the pairs they come from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIMPLIFIED_ONLY, TRADITIONAL_ONLY } from '../src/han-forms.js';

test('han forms: no character is in both tables, and each pair holds two different characters', () => {
  const simplified = [...SIMPLIFIED_ONLY];
  const traditional = [...TRADITIONAL_ONLY];
  assert.equal(simplified.length, traditional.length);
  assert.ok(simplified.length >= 100, 'the tables are not trivial');
  assert.equal(new Set(simplified).size, simplified.length, 'no repeated simplified character');
  assert.equal(new Set(traditional).size, traditional.length, 'no repeated traditional character');
  for (const [i, s] of simplified.entries()) assert.notEqual(s, traditional[i], `pair ${i} is the same character`);
  assert.deepEqual(simplified.filter((c) => traditional.includes(c)), []);
});
