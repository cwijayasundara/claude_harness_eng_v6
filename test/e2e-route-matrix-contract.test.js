const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('live e2e route matrix covers scaffold plus build and feature routes', () => {
  const runner = require('./e2e/run-pack.js');
  const ids = runner.LIVE_LAYERS.map((l) => l.id);

  for (const id of ['plan', 'semi', 'auto', 'full-auto', 'gated', 'feature', 'vibe', 'brownfield-run', 'smoke']) {
    assert.ok(ids.includes(id), `missing live route layer: ${id}`);
  }
});

test('brownfield live route runs the real /brownfield --seams and asserts its artifacts', () => {
  const file = read('test/e2e/harness-brownfield-run.test.js');
  assert.match(file, /runClaude\('\/scaffold --yes existing/);
  assert.match(file, /runClaude\('\/brownfield --seams/);
  assert.match(file, /'code-graph\.json'/);
  assert.match(file, /'wiki', 'WIKI\.md'/);
  assert.match(file, /'change-strategy\.md'/);
  assert.match(file, /\^seams-/);
});

test('vibe live route scaffolds an existing repo and runs /vibe with a vibe-log assertion', () => {
  const file = read('test/e2e/harness-vibe-run.test.js');
  assert.match(file, /runClaude\('\/scaffold --yes existing/);
  assert.match(file, /runClaude\('\/vibe /);
  assert.match(file, /state', 'vibe-log\.md/);
  assert.match(file, /runProjectSuite/);
});

test('full-auto live route uses /build --auto without --lite', () => {
  const file = read('test/e2e/harness-full-auto-run.test.js');
  assert.match(file, /\/scaffold --yes/);
  assert.match(file, /\/build --auto --mode lean prd\.md/);
  assert.doesNotMatch(file, /\/build --auto[^'`"\n]*--lite|\/build[^'`"\n]*--lite[^'`"\n]*--auto/);
  assert.match(file, /runProjectSuite/);
  // Resume path if progressive /build stops after plan only.
  assert.match(file, /\/auto --mode lean/);
});

test('gated live route uses plain /build and asserts it stops before autonomous tail', () => {
  const file = read('test/e2e/harness-gated-build.test.js');
  // Non-interactive scaffold (--yes) — interactive /scaffold only prints Q1 in claude -p.
  assert.match(file, /\/scaffold --yes/);
  assert.match(file, /runClaude\('\/build prd\.md'/);
  assert.match(file, /specs\/brd\/brd\.md/);
  assert.match(file, /must not enter autonomous build before approval/);
});

test('feature live route scaffolds an existing repo and runs /feature --auto', () => {
  const file = read('test/e2e/harness-feature-route.test.js');
  assert.match(file, /runClaude\('\/scaffold --yes existing small Node library/);
  // Headless: default /feature stops at human gates in claude -p.
  assert.match(file, /\/feature --auto /);
  assert.match(file, /specs', 'brownfield', 'code-graph\.json/);
  assert.match(file, /runProjectSuite/);
});
