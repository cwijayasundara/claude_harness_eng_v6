'use strict';

// Story: canvas-sync generative proposal mode (specs/stories/canvas-sync-generative.md).
// Covers the detect-and-propose extension of the canvas-sync sensor and its --write apply.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, '.claude', 'hooks', 'lib', 'canvas-sync.js');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'canvas-sync-check.js');
const { checkCanvasSync, proposeCanvasSync, applyCanvasProposal } = require(LIB);
const { run } = require(SCRIPT);

const CANVAS = `# Billing Canvas

## Requirements
Bill token usage.

## Entities
Bill.

## Approach
Quota-first.

## Structure
Three-layer.

## Operations
1. calculateBill(...) in \`src/billing/service.py\`

## Norms
Constructor injection.

## Safeguards
BigDecimal money.

## Governs
- \`src/billing/service.py\`
`;

function tmpProject(canvasText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-sync-'));
  const canvasPath = path.join(dir, 'specs', 'design', 'reasons-canvas.md');
  fs.mkdirSync(path.dirname(canvasPath), { recursive: true });
  fs.writeFileSync(canvasPath, canvasText);
  return { dir, canvasPath, outPath: path.join(dir, 'specs', 'reviews', 'canvas-sync-check.md') };
}
const readReport = (p) => fs.readFileSync(p.outPath, 'utf8');
const readCanvas = (p) => fs.readFileSync(p.canvasPath, 'utf8');

// --- pure functions ---

test('proposeCanvasSync maps missing files to deterministic Governs bullets and Operations stubs', () => {
  const result = checkCanvasSync({
    canvasText: CANVAS,
    changedFiles: ['src/billing/service.py', 'src/billing/models.py'],
  });
  const { governsBullets, operationsStubs } = proposeCanvasSync(result);
  // service.py is already governed + in operations; only models.py is new.
  assert.deepStrictEqual(result.missingFromGoverns, ['src/billing/models.py']);
  assert.ok(governsBullets.some((b) => b.includes('src/billing/models.py')));
  assert.ok(!governsBullets.some((b) => b.includes('src/billing/service.py')));
  assert.ok(operationsStubs.some((s) => s.includes('src/billing/models.py')));
});

test('applyCanvasProposal inserts into the real sections and re-checks clean', () => {
  const result = checkCanvasSync({
    canvasText: CANVAS,
    changedFiles: ['src/billing/models.py'],
  });
  const updated = applyCanvasProposal(CANVAS, result);
  assert.match(updated, /## Governs[\s\S]*- `src\/billing\/models\.py`/);
  assert.match(updated, /## Operations[\s\S]*src\/billing\/models\.py[\s\S]*## Norms/);
  const after = checkCanvasSync({ canvasText: updated, changedFiles: ['src/billing/models.py'] });
  assert.strictEqual(after.missingFromGoverns.length, 0);
  assert.strictEqual(after.missingFromOperations.length, 0);
});

// --- CLI ACs ---

test('AC1: no --write leaves the Canvas untouched but reports the proposed additions', () => {
  const p = tmpProject(CANVAS);
  const before = readCanvas(p);
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/models.py'], p.dir);
  assert.strictEqual(code, 1, 'missing file must still exit 1');
  assert.strictEqual(readCanvas(p), before, 'Canvas file must be unchanged without --write');
  const report = readReport(p);
  assert.match(report, /Proposed Canvas patch/i);
  assert.match(report, /- `src\/billing\/models\.py`/, 'report shows the Governs bullet to add');
  assert.match(report, /Operations[\s\S]*src\/billing\/models\.py/, 'report shows the Operations stub');
});

test('AC2: --write applies exactly those additions and a fresh re-run exits 0', () => {
  const p = tmpProject(CANVAS);
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/models.py', '--write'], p.dir);
  assert.strictEqual(code, 0, '--write on a well-formed Canvas resolves the issue');
  const canvas = readCanvas(p);
  assert.match(canvas, /## Governs[\s\S]*- `src\/billing\/models\.py`/);
  assert.match(canvas, /## Operations[\s\S]*src\/billing\/models\.py/);
  // fresh invocation now sees no divergence
  const again = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/models.py'], p.dir);
  assert.strictEqual(again, 0, 're-running canvas-sync-check must exit 0 after --write');
  assert.match(readReport(p), /synchronized/i);
});

test('AC3: idempotent — an already-governed path is never duplicated, --write twice is a no-op', () => {
  const p = tmpProject(CANVAS);
  // service.py already governed; models.py is new.
  run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/service.py,src/billing/models.py', '--write'], p.dir);
  const first = readCanvas(p);
  const serviceBullets = (first.match(/- `src\/billing\/service\.py`/g) || []).length;
  assert.strictEqual(serviceBullets, 1, 'already-governed path must not be duplicated');
  // second --write finds nothing to add
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/service.py,src/billing/models.py', '--write'], p.dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(readCanvas(p), first, 'a second --write must not change the Canvas again');
});

test('AC4: no-issues path is unchanged — exit 0, synchronized, Canvas untouched', () => {
  const p = tmpProject(CANVAS);
  const before = readCanvas(p);
  // service.py is already governed AND in operations -> no divergence
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/service.py'], p.dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(readCanvas(p), before, 'Canvas must be untouched when synchronized');
  assert.match(readReport(p), /Canvas and changed files are synchronized\./);
});

test('AC4: --write with no issues does not touch the Canvas', () => {
  const p = tmpProject(CANVAS);
  const before = readCanvas(p);
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/service.py', '--write'], p.dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(readCanvas(p), before, '--write must be a no-op when already synchronized');
});

// --- report honesty (guards CR-001 / CR-002) ---

test('report prose names the actual --canvas path, not the hardcoded default', () => {
  const p = tmpProject(CANVAS);
  run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/models.py'], p.dir);
  const report = readReport(p);
  const rel = path.relative(p.dir, p.canvasPath); // specs/design/reasons-canvas.md here
  assert.match(report, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'report cites the real canvas path');
});

test('--write that cannot fully apply (section absent) must not claim "Applied"', () => {
  // A Canvas with no `## Operations` section: the stub insert is a no-op, so the
  // divergence persists and the report must not falsely report success.
  const noOps = CANVAS.replace(/## Operations\n[\s\S]*?\n## Norms/, '## Norms');
  const p = tmpProject(noOps);
  const code = run(['--canvas', p.canvasPath, '--out', p.outPath, '--files', 'src/billing/models.py', '--write'], p.dir);
  assert.strictEqual(code, 1, 'unresolved divergence keeps exit 1');
  assert.doesNotMatch(readReport(p), /Applied to/, 'report must not claim a patch that did not fully apply');
});
