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

  for (const id of ['plan', 'semi', 'auto', 'full-auto', 'gated', 'feature', 'smoke']) {
    assert.ok(ids.includes(id), `missing live route layer: ${id}`);
  }
});

test('full-auto live route uses /build --auto without --lite', () => {
  const file = read('test/e2e/harness-full-auto-run.test.js');
  assert.match(file, /runClaude\('\/scaffold'/);
  assert.match(file, /runClaude\('\/build --auto --mode lean prd\.md'/);
  assert.doesNotMatch(file, /\/build --auto[^'`"]*--lite|\/build[^'`"]*--lite[^'`"]*--auto/);
  assert.match(file, /runProjectSuite/);
});

test('gated live route uses plain /build and asserts it stops before autonomous tail', () => {
  const file = read('test/e2e/harness-gated-build.test.js');
  assert.match(file, /runClaude\('\/scaffold'/);
  assert.match(file, /runClaude\('\/build prd\.md'/);
  assert.match(file, /specs\/brd\/brd\.md/);
  assert.match(file, /claude-progress\.txt/);
  assert.match(file, /features\.json/);
});

test('feature live route scaffolds an existing repo and runs /feature', () => {
  const file = read('test/e2e/harness-feature-route.test.js');
  assert.match(file, /runClaude\('\/scaffold --yes existing small Node library/);
  assert.match(file, /runClaude\('\/feature add a multiply/);
  assert.match(file, /specs', 'brownfield', 'code-graph\.json/);
  assert.match(file, /runProjectSuite/);
});
