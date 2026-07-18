'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { parseInvariants } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'constitution-invariants.js')
);

const SAMPLE = [
  '# Constitution', '',
  '## Invariants', '',
  '<!-- a comment to skip -->',
  '- All schema changes use expand-contract; no destructive migration in the same sprint.',
  '- Services communicate only through published API contracts.',
  '', '## Amendment History', '',
  '- 2026-07-01 added invariant X',
].join('\n');

test('parseInvariants returns only the bullets under ## Invariants', () => {
  const inv = parseInvariants(SAMPLE);
  assert.strictEqual(inv.length, 2);
  assert.match(inv[0], /expand-contract/);
  assert.match(inv[1], /published API contracts/);
  assert.ok(!inv.some((i) => /Amendment History|added invariant X/.test(i)), 'stops at next heading');
});

test('parseInvariants skips HTML comments and blanks', () => {
  assert.ok(!parseInvariants(SAMPLE).some((i) => /comment to skip/.test(i)));
});

test('parseInvariants tolerates a missing section', () => {
  assert.deepStrictEqual(parseInvariants('# Constitution\n\nno invariants here'), []);
  assert.deepStrictEqual(parseInvariants(''), []);
});
