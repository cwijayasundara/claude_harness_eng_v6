'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const canvas = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'canvas.js'));

const FULL = `# Token Billing Canvas

## Requirements
Bill token usage.

## Entities
\`\`\`mermaid
classDiagram
  class Bill
\`\`\`

## Approach
Quota-first.

## Structure
Three-layer.

## Operations
1. calculateBill(...)

## Norms
Constructor injection.

## Safeguards
BigDecimal money.

## Governs
- src/billing/service.py
- src/billing/models.py
- src/billing/*.generated.py
`;

test('missingSections passes a complete Canvas and names gaps otherwise', () => {
  assert.deepStrictEqual(canvas.missingSections(FULL), []);
  const partial = '## Requirements\nx\n## Entities\ny\n';
  const missing = canvas.missingSections(partial);
  assert.ok(missing.includes('Operations'));
  assert.ok(missing.includes('Governs'));
});

test('a section heading with a parenthetical still counts', () => {
  const md = FULL.replace('## Entities', '## Entities (domain model)');
  assert.deepStrictEqual(canvas.missingSections(md), []);
});

test('extractGoverns reads the bullet list, backtick-optional', () => {
  const md = '## Governs\n- `src/a.ts`\n- src/b.ts\n* src/c.ts\n\n## Norms\nx\n';
  assert.deepStrictEqual(canvas.extractGoverns(md), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('canvasMissingPaths flags concrete missing paths, ignores globs', () => {
  const governs = ['src/billing/service.py', 'src/billing/models.py', 'src/billing/*.generated.py'];
  const exists = (p) => p === 'src/billing/service.py'; // models.py is gone
  const missing = canvas.canvasMissingPaths(governs, exists);
  assert.deepStrictEqual(missing, ['src/billing/models.py']);
});

test('validateCanvas accepts a complete Canvas and rejects a thin one', () => {
  assert.deepStrictEqual(canvas.validateCanvas(FULL).errors, []);
  assert.deepStrictEqual(canvas.validateCanvas(FULL).governs.length, 3);
  const thin = '## Requirements\nx\n## Governs\n(no paths)\n';
  const { errors } = canvas.validateCanvas(thin);
  assert.ok(errors.some((e) => /missing REASONS sections/.test(e)));
  assert.ok(errors.some((e) => /Governs lists no source paths/.test(e)));
});
