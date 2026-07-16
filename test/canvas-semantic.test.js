'use strict';

// Story: canvas-sync semantic half — build the agent-review packet that pairs
// changed governed files with the Canvas narrative claims a diff can falsify.
// The judgement is an agent's; these tests cover the deterministic selection.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { buildSemanticReview, renderSemanticReview } = require(path.join(ROOT, '.claude', 'hooks', 'lib', 'canvas-sync.js'));
const { run } = require(path.join(ROOT, '.claude', 'scripts', 'canvas-semantic-check.js'));

const CANVAS = `# Billing Canvas

## Requirements
Bill token usage.

## Entities
Bill.

## Approach
Quota-first: reject over-quota before persisting.

## Structure
Three-layer; billing service owns money math.

## Operations
1. calculateBill(...) in \`src/billing/service.py\`

## Norms
Constructor injection; structured logging.

## Safeguards
BigDecimal money; never float. p95 < 200ms.

## Governs
- \`src/billing/service.py\`
`;

function tmpProject(canvasText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-semantic-'));
  const canvasPath = path.join(dir, 'specs', 'design', 'reasons-canvas.md');
  fs.mkdirSync(path.dirname(canvasPath), { recursive: true });
  fs.writeFileSync(canvasPath, canvasText);
  return { dir, canvasPath, outPath: path.join(dir, 'specs', 'reviews', 'canvas-semantic-review.md') };
}

test('buildSemanticReview selects narrative claims + the Operations step naming a changed governed file', () => {
  const review = buildSemanticReview({ canvasText: CANVAS, changedFiles: ['src/billing/service.py'] });
  assert.deepStrictEqual(review.changedGoverned, ['src/billing/service.py']);
  const sections = review.claims.map((c) => c.section);
  assert.deepStrictEqual(sections, ['Approach', 'Structure', 'Norms', 'Safeguards', 'Operations']);
  const ops = review.claims.find((c) => c.section === 'Operations');
  assert.match(ops.body, /calculateBill.*src\/billing\/service\.py/);
  const safeguards = review.claims.find((c) => c.section === 'Safeguards');
  assert.match(safeguards.body, /BigDecimal/);
});

test('an ungoverned change yields an empty review — that is the sync check\'s concern, not this one', () => {
  const review = buildSemanticReview({ canvasText: CANVAS, changedFiles: ['src/unrelated/util.py'] });
  assert.deepStrictEqual(review, { changedGoverned: [], claims: [] });
  assert.match(renderSemanticReview(review), /nothing to semantically review/i);
});

test('CLI writes the packet for a governed change and stays advisory (exit 0)', () => {
  const p = tmpProject(CANVAS);
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/service.py'], p.dir);
  assert.strictEqual(code, 0, 'semantic check is advisory — never blocks');
  const packet = fs.readFileSync(p.outPath, 'utf8');
  assert.match(packet, /Canvas Semantic Review/);
  assert.match(packet, /- src\/billing\/service\.py/);
  assert.match(packet, /## Claim — Safeguards/);
  assert.match(packet, /fix-the-prompt-first/);
});

test('CLI on an ungoverned-only change writes the empty packet and exits 0', () => {
  const p = tmpProject(CANVAS);
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'docs/readme.md'], p.dir);
  assert.strictEqual(code, 0);
  assert.match(fs.readFileSync(p.outPath, 'utf8'), /nothing to semantically review/i);
});
