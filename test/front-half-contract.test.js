'use strict';

// Cheap static contract for the live front-half route. Pins the shape that
// makes the route mean what its header claims, without spending a live run.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const ROUTE = 'test/e2e/harness-front-half.test.js';

test('front-half route drives the four phases as separate invocations', () => {
  const file = read(ROUTE);
  assert.match(file, /\/scaffold --yes/);
  for (const cmd of ['/brd --prd prd\\.md', '/spec', '/spec --render-only', '/design', '/design --render-only', '/test --plan-only']) {
    assert.match(file, new RegExp(`coldPhase\\([^)]*'${cmd}'`, 's'), `route must invoke ${cmd} as its own phase`);
  }
  // The whole point of the route: never the conductor. Match a *quoted* /build,
  // i.e. an actual prompt — the header comment discusses /build on purpose.
  assert.doesNotMatch(file, /['"]\/build/, 'front-half must not delegate to the /build conductor');
});

test('front-half route gives every phase a cold session (the /clear)', () => {
  const file = read(ROUTE);
  assert.match(file, /randomUUID\(\)/, 'each phase needs a fresh session id');
  assert.match(file, /continueSession: false/, 'no phase may continue its predecessor');
  // --in-session is precisely the suppression this route exists to avoid.
  assert.doesNotMatch(file, /'--in-session'/, 'front-half must not suppress the handoff');
  assert.match(file, /new Set\(sessions\)\.size, sessions\.length/, 'route must assert the sessions were distinct');
});

test('front-half route validates artifacts through the real validators', () => {
  const file = read(ROUTE);
  assert.match(file, /validate-spec-decisions\.js/);
  assert.match(file, /validate-design-decisions\.js/);
  assert.match(file, /brd-grounding\.json/);
  assert.match(file, /verification-matrix\.json/);
  assert.match(file, /test-traces\.json/);
});

test('front-half route builds its project outside the harness checkout', () => {
  const file = read(ROUTE);
  assert.match(file, /e2eWorkdir\('front-half'\)/);
  assert.doesNotMatch(file, /path\.join\(__dirname, '[a-z-]*output'\)/, 'must not write output into the repo');
});

test('front-half is registered as a live layer with an npm script', () => {
  const runner = require('./e2e/run-pack.js');
  assert.ok(runner.LIVE_LAYERS.map((l) => l.id).includes('front-half'), 'missing live layer: front-half');
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['test:front-half'], 'missing npm script test:front-half');
});

// ── The constraint that keeps a live, token-spending route out of CI ─────────
// Live routes call `claude -p` against a real account. A GitHub check that
// invoked one would spend tokens per push and fail on any runner without
// credentials. `npm test` is the CI suite; the live packs must stay opt-in and
// local. This asserts it structurally instead of trusting that nobody wires it.
test('CI never invokes a live e2e pack', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  const forbidden = /(test:e2e(?!:fast)|test:routes|test:plan\b|test:auto\b|test:full-auto|test:gated|test:feature|test:semi\b|test:smoke|test:front-half|run-pack\.js\s+(live|cert|all|smoke))/;
  for (const name of fs.readdirSync(dir)) {
    const body = fs.readFileSync(path.join(dir, name), 'utf8');
    const hit = body.match(forbidden);
    assert.strictEqual(
      hit, null,
      `.github/workflows/${name} invokes a live e2e pack (${hit && hit[0]}) — live routes cost tokens and must stay out of CI`,
    );
  }
});

test('the live routes are excluded from the npm test glob', () => {
  const pkg = JSON.parse(read('package.json'));
  // `npm test` is what CI runs. test/e2e/*.test.js are the live routes; only
  // test/e2e/helpers/*.test.js (pure unit tests) may be in the glob.
  assert.doesNotMatch(pkg.scripts.test, /test\/e2e\/\*\.test\.js/, 'npm test must not glob the live routes');
  assert.match(pkg.scripts.test, /test\/e2e\/helpers\/\*\.test\.js/);
});

// ── The mis-budgeting class ─────────────────────────────────────────────────
// A live route is two nested clocks: each `claude -p` call has its own
// timeoutMs, and run-pack gives the whole layer a watchdog. When the watchdog is
// smaller than the sum of the inner caps, a route that is merely slow gets
// reaped and reported as a harness failure. The plan route shipped that way —
// a 1320s watchdog over a step that needed >1800s — and the reaping is what
// masked a genuine vacuous-green underneath it.
function innerTimeouts(file) {
  const named = [...file.matchAll(/timeoutMs:\s*(\d{5,})/g)].map((m) => Number(m[1]));
  // coldPhase(label, prompt, budgetUsd, timeoutMs) — the 4th arg is positional.
  const positional = [...file.matchAll(/coldPhase\([\s\S]*?'[\d.]+',\s*(\d{5,})\s*[,)]/g)].map((m) => Number(m[1]));
  return [...named, ...positional];
}

test('every live route watchdog clears the sum of its own step timeouts', () => {
  const runner = require('./e2e/run-pack.js');
  const checked = [];
  for (const layer of runner.LIVE_LAYERS) {
    const target = layer.command.find((c) => typeof c === 'string' && c.startsWith('test/e2e/harness-'));
    if (!target) continue;
    const inner = innerTimeouts(read(target));
    if (!inner.length) continue;
    const sumSec = Math.round(inner.reduce((a, b) => a + b, 0) / 1000);
    assert.ok(
      layer.timeoutSec >= sumSec,
      `layer "${layer.id}" watchdog is ${layer.timeoutSec}s but its steps can take ${sumSec}s `
        + '— a slow-but-working run would be reaped and reported as a failure',
    );
    // node:test's own --test-timeout must clear the steps too.
    const nodeTimeout = layer.command.find((c) => typeof c === 'string' && c.startsWith('--test-timeout='));
    if (nodeTimeout) {
      const ms = Number(nodeTimeout.split('=')[1]);
      assert.ok(ms / 1000 >= sumSec, `layer "${layer.id}" --test-timeout ${ms / 1000}s < steps ${sumSec}s`);
    }
    checked.push(layer.id);
  }
  assert.ok(checked.includes('front-half'), 'front-half must be covered by this guard');
  assert.ok(checked.includes('plan'), 'plan must be covered by this guard');
});

test('plan-only asserts the WHOLE architect half, not a subset', () => {
  const file = read('test/e2e/harness-plan-only.test.js');
  // It once passed on a SIGKILLed run that produced no design and no test plan.
  assert.match(file, /summary\.missing,\s*\[\]/, 'plan-only must assert nothing is missing');
  assert.match(file, /notStrictEqual\(\s*\n?\s*plan\.exitCode,\s*null/, 'plan-only must reject a killed run');
});

// ── The shaping stops must be answered, not waived ────────────────────────
// Measured: bare `/spec` exits 0 after ~102s having written no decisions file,
// because the phase presents its load-bearing calls and waits. Every assertion
// after that then fails on an artifact the phase was never going to produce.

test('front-half answers the shaping dialogues in-session', () => {
  const file = read(ROUTE);
  assert.match(file, /function settle\(/, 'the route needs a way to answer a shaping stop');
  for (const phase of ['spec', 'design']) {
    assert.match(
      file,
      new RegExp(`settle\\('${phase}', ${phase}\\.sessionId`),
      `/${phase} stops for its decisions — the route must answer it`,
    );
  }
  // Answering happens in the phase's OWN session; that is what makes it an
  // answer to that dialogue rather than a new, contextless turn.
  assert.match(file, /continueSession: true/);
  assert.match(file, /sessionId, continueSession: true/);
});

test('front-half never waives its way past the checkpoint it exists to test', () => {
  const file = read(ROUTE);
  // Two different things both spell `--lane --auto`, and only one is a problem:
  //   plan-approval.js waive --lane --auto  → the PHASE gate receipt. Legitimate;
  //     a headless run records a waiver rather than leaving the receipt absent.
  //   validate-*-decisions.js --lane --auto → the DECISIONS gate. This one
  //     suppresses the /clear checkpoint, which is the handoff this route
  //     exists to exercise, so using it would make the route pass by deleting
  //     its own subject.
  for (const validator of ['validate-spec-decisions', 'validate-design-decisions']) {
    const call = new RegExp(`${validator}\\.js'[^)]*`, 'g');
    for (const match of file.match(call) || []) {
      assert.ok(!/--lane/.test(match), `${validator} must stay gated here: ${match}`);
    }
  }
  assert.doesNotMatch(file, /current-lane/, 'declaring a lane suppresses the handoff under test');
  // The phase-gate waiver is expected — the route has no human to approve.
  assert.match(file, /plan-approval\.js', \['waive'/);
});

test('the approval answers the phase it is in, never the predecessor', () => {
  const file = read(ROUTE);
  // Each cold phase still gets a fresh id; only the approval reuses one, and it
  // reuses THAT phase's id.
  assert.match(file, /sessionId: randomUUID\(\), continueSession: false/);
  assert.doesNotMatch(file, /continueSession: true[^)]*randomUUID/);
});
