'use strict';

// D9: the BRD's safeguards must reach the design contract.
//
// /brd records invariants, prohibitions, limits and norms as SG-n entries. The
// REASONS Canvas has Safeguards and Norms sections, but until now they were
// authored from the architecture with nothing tying them back — so a business
// invariant could quietly fail to reach the design and nothing would notice.

const assert = require('assert');
const { test } = require('node:test');

const { checkSafeguardCoverage } = require('../.claude/hooks/lib/canvas.js');

const SAFEGUARDS = [
  { id: 'SG-1', kind: 'invariant', text: 'An order total equals the sum of its line items' },
  { id: 'SG-2', kind: 'prohibition', text: 'Must not store raw passwords' },
  { id: 'SG-3', kind: 'limit', text: 'p95 checkout latency under 400ms' },
  { id: 'SG-4', kind: 'norm', text: 'All money is Decimal, never float' },
];

const canvas = (safeguardsBody, normsBody) => `# Canvas

## Requirements
r

## Norms
${normsBody || 'n'}

## Safeguards
${safeguardsBody || 's'}

## Governs
- \`src/a.ts\`
`;

test('every safeguard cited in its expected section passes', () => {
  const v = checkSafeguardCoverage(
    canvas('- SG-1 enforced in OrderTotal\n- SG-2 via bcrypt\n- SG-3 budget', '- SG-4 Decimal only'),
    SAFEGUARDS,
  );
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.required_total, 4);
  assert.strictEqual(v.covered, 4);
  assert.deepStrictEqual(v.uncovered, []);
});

test('a safeguard the Canvas never cites is reported uncovered', () => {
  const v = checkSafeguardCoverage(canvas('- SG-1\n- SG-2', '- SG-4'), SAFEGUARDS);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.uncovered.map((u) => u.id), ['SG-3']);
  assert.match(v.uncovered[0].text, /p95 checkout latency/);
});

test('citations elsewhere in the Canvas do not count — only Safeguards and Norms', () => {
  const md = `# Canvas

## Requirements
SG-1 SG-2 SG-3 SG-4 all mentioned here

## Norms
n

## Safeguards
s

## Governs
- \`src/a.ts\`
`;
  const v = checkSafeguardCoverage(md, SAFEGUARDS);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.covered, 0);
});

test('a norm cited in Safeguards still counts, but is flagged as misplaced', () => {
  const v = checkSafeguardCoverage(canvas('- SG-1\n- SG-2\n- SG-3\n- SG-4', ''), SAFEGUARDS);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.misplaced.map((m) => m.id), ['SG-4']);
  assert.match(v.misplaced[0].note, /Norms/);
});

test('an invariant cited only in Norms counts but is flagged misplaced', () => {
  const v = checkSafeguardCoverage(canvas('- SG-2\n- SG-3', '- SG-4\n- SG-1'), SAFEGUARDS);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.misplaced.map((m) => m.id), ['SG-1']);
  assert.match(v.misplaced[0].note, /Safeguards/);
});

test('an SG id the Canvas invents is a failure, not a silent extra', () => {
  const v = checkSafeguardCoverage(canvas('- SG-1\n- SG-2\n- SG-3\n- SG-9', '- SG-4'), SAFEGUARDS);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.cited_unknown, ['SG-9']);
});

test('an empty safeguards spine fails loudly rather than passing vacuously', () => {
  const v = checkSafeguardCoverage(canvas('s', 'n'), []);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.reason, 'empty_spine');
});

test('SG ids are matched on word boundaries, so SG-1 does not satisfy SG-10', () => {
  const spine = [
    { id: 'SG-1', kind: 'invariant', text: 'one' },
    { id: 'SG-10', kind: 'invariant', text: 'ten' },
  ];
  const v = checkSafeguardCoverage(canvas('- SG-1 only', ''), spine);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.uncovered.map((u) => u.id), ['SG-10']);
});

test('a Canvas missing the Safeguards section covers nothing', () => {
  const md = '# Canvas\n\n## Requirements\nr\n\n## Governs\n- `src/a.ts`\n';
  const v = checkSafeguardCoverage(md, SAFEGUARDS);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.covered, 0);
});

test('the verdict is deterministic and sorted', () => {
  const a = checkSafeguardCoverage(canvas('- SG-1', '- SG-4'), SAFEGUARDS);
  const b = checkSafeguardCoverage(canvas('- SG-1', '- SG-4'), SAFEGUARDS.slice().reverse());
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a.uncovered.map((u) => u.id), ['SG-2', 'SG-3']);
});
