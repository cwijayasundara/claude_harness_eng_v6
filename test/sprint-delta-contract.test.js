'use strict';

// Cheap static contract for the live /sprint delta route. Pins the shape that
// makes the route mean what its header claims, without spending a live run.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const ROUTE = 'test/e2e/harness-sprint-delta.test.js';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('sprint route drives the delta lane, not a fresh build', () => {
  const file = read(ROUTE);
  assert.match(file, /['"`]\/sprint prd-sprint-2\.md --autonomous/, 'route must invoke the /sprint conductor');
  // /build is sprint 1's lane; reaching for it here would be the wrong door.
  assert.doesNotMatch(file, /phase\([^)]*'\/build/s, 'the sprint route must never call /build');
  assert.match(file, /\/scaffold --yes existing/, 'the baseline is an existing product, not a greenfield tree');
});

test('sprint route proves the design was amended, not regenerated', () => {
  const file = read(ROUTE);
  assert.match(file, /snapshotDesign\(PROJECT_DIR\)/, 'the baseline must be captured before /sprint runs');
  assert.match(file, /isEmpty\(before\)/, 'an empty baseline would make every preservation check vacuous');
  assert.match(file, /anyMissing\(missingFrom\(before,/, 'route must compare the amended design against the baseline');
  assert.match(file, /amendments', 'sprint-2\.md'/, 'delta mode writes an amendment file');
  assert.match(file, /Breaking Changes/, 'the amendment must be checked for its Breaking Changes section');
});

test('sprint route checks the classification the PRD pre-committed to', () => {
  const file = read(ROUTE);
  assert.match(file, /requirements-delta\.json/);
  assert.match(file, /required_total >= 1/, 'a delta over an empty prior spine proves nothing');
  assert.match(file, /delta\.dropped/, 'the PRD says nothing is dropped — the route must check it');
  assert.match(file, /net_new/);
  for (const label of ['FR-9', 'FR-10']) {
    assert.ok(file.includes(`'${label}'`), `route must assert the new requirement ${label} reached the spine`);
  }
});

test('sprint route runs the machine gates and the real project suite', () => {
  const file = read(ROUTE);
  assert.match(file, /design-grounding\.json/);
  assert.match(file, /contract-drift-verdict\.json/);
  assert.match(file, /spdd-sync\.js/, 'SPDD code<->record sync is the lane the sprint-2 PRD names');
  // The shortlink stack is Python + Next.js: a root `npm test` would report
  // "no package.json" on a perfectly good build, so the suite must come from
  // the manifest the scaffold wrote.
  assert.match(file, /runManifestSuite/, 'the built sprint-2 system must be green');
  assert.doesNotMatch(file, /runProjectSuite/, 'a root npm test cannot judge a multi-component build');
});

test('sprint route bills itself against a committed budget baseline', () => {
  const file = read(ROUTE);
  assert.match(file, /billRoute\(PROJECT_DIR, \{ sessionIds: sessions \}\)/);
  assert.match(file, /checkBudget\(ROUTE, bill/);
  assert.match(file, /HARNESS_E2E_UPDATE_BASELINE/, 'a deliberate cost change needs a documented way to re-record');
});

test('sprint route fails with a buildable instruction when no baseline is committed', () => {
  const file = read(ROUTE);
  assert.match(file, /no sprint-1 baseline at/);
  assert.match(file, /e2e:baseline:sprint1/, 'the error must name the command that produces the baseline');
});

test('sprint route waives the human gates through the documented headless lane', () => {
  const file = read(ROUTE);
  assert.match(file, /plan-approval\.js', \['waive', '--phase', gate, '--lane', '--auto'/);
});

test('sprint route builds outside the checkout', () => {
  const file = read(ROUTE);
  assert.match(file, /e2eWorkdir\('sprint'\)/);
  assert.match(file, /live e2e output must not land in the repo/);
});

test('the sprint layer is registered and reachable by name', () => {
  const runner = require('./e2e/run-pack.js');
  const layer = runner.LIVE_LAYERS.find((l) => l.id === 'sprint');
  assert.ok(layer, 'sprint must be a live layer');
  assert.ok(layer.command.includes(ROUTE), 'the sprint layer must run the sprint route file');

  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:sprint'], /--only sprint\b/);
  assert.match(pkg.scripts['e2e:baseline:sprint1'], /make-sprint1-baseline\.js/);
});

test('the sprint route stays out of CI, like every other live route', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(pkg.scripts.test, /harness-sprint-delta/);
  for (const wf of fs.existsSync(path.join(ROOT, '.github', 'workflows'))
    ? fs.readdirSync(path.join(ROOT, '.github', 'workflows')) : []) {
    const body = read(path.join('.github', 'workflows', wf));
    assert.doesNotMatch(body, /test:sprint\b|harness-sprint-delta/, `${wf} must not spend live tokens in CI`);
  }
});
