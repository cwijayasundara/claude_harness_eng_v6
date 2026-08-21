'use strict';

// ── Front-half route: /brd → /spec → /design → /test as SEPARATE invocations ──
//
// Every other live route drives the planning phases through the `/build`
// conductor, which runs all four from one session and therefore passes
// `--in-session` to suppress the /clear handoff. That leaves the harness's own
// recommended route with no coverage at all. `build/references/
// section-04-pipeline-phases.md:31` is explicit about which one is cheaper:
//
//   "running /brd → /spec → /design → /test as separate invocations, clearing
//    between each, is the cheaper interactive route."
//
// And `handoff-check.js`'s header records what it costs when the clear is
// skipped: "/spec continued in /brd's session and ran 47 turns at a 273K
// average context, against ~110K for a fresh one."
//
// This route models the clear the only way a headless run can: a NEW session id
// per phase, so each phase starts on a cold context exactly as `/clear` leaves
// it. That is the property under test, and no other route has it.
//
// What it does NOT test: the human gate itself. `claude -p` has no human, so the
// review loops are waived between phases through the documented headless lane
// (`plan-approval.js waive --lane --auto`). The `gated` route already proves the
// gate stops a run; this one proves the artifact chain and the phase-to-phase
// handoff survive being run cold, one command at a time.
//
// Runs LIVE `claude -p`; costs tokens; NOT part of `npm test` and NOT part of
// CI. Run with `npm run test:front-half`.
// Static contract: ../front-half-contract.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { freshProject } = require('./helpers/fresh-project');
const { e2eWorkdir } = require('./helpers/e2e-workdir');
const { summarizeSpecs, formatSummary } = require('./helpers/specs-summary');

const PROJECT_DIR = e2eWorkdir('front-half');
const SAMPLE_PRD = path.join(__dirname, 'fixtures', 'sample-prd.md');
const HARNESS_PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const SCRIPTS = path.join(HARNESS_PLUGIN_DIR, 'scripts');

const BASE = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: HARNESS_PLUGIN_DIR };

/** Every phase gets its own session id — this is the /clear, mechanically. */
function coldPhase(label, prompt, budgetUsd, timeoutMs) {
  return turn(label, prompt, budgetUsd, timeoutMs, { sessionId: randomUUID(), continueSession: false });
}

function turn(label, prompt, budgetUsd, timeoutMs, opts) {
  const started = Date.now();
  const res = runClaude(prompt, { ...BASE, budgetUsd, timeoutMs, ...opts });
  console.log(`[front-half] ${label}: exit=${res.exitCode} ${Math.round((Date.now() - started) / 1000)}s`);
  if (res.sessionLimited) assert.fail(`${label}: ${res.limitMessage}`);
  return { ...res, sessionId: opts.sessionId };
}

// The operator's answer to a shaping dialogue.
//
// `/spec` and `/design` present their load-bearing decisions and WAIT — the
// decisions gate refuses to unlock the renderer unless each one records who
// settled it, so a phase that is never answered exits 0 having written nothing.
// Measured: `/spec` ran 102s, wrote no decisions file, and every downstream
// assertion in this route failed on an artifact the phase was never going to
// produce.
//
// Answering in the SAME session is the only mechanism available here. The
// documented `--lane --auto` waiver is deliberately NOT used: it suppresses the
// /clear checkpoint, which is the exact handoff this route exists to exercise —
// waiving it would make the route pass by not testing its subject.
const APPROVAL = 'Approved — I have reviewed every decision above and I am choosing your '
  + 'proposed default for each one. Treat this turn as the operator\'s answer to the shaping '
  + 'dialogue: record each load-bearing decision as chosen by me, write the decisions file, '
  + 'and run its validation gate before finishing.';

/** Answer a shaping phase if it stopped for one; no-op when it already settled. */
function settle(label, sessionId, budgetUsd, timeoutMs, ...expected) {
  if (exists(...expected)) return;
  console.log(`[front-half] ${label}: stopped for shaping decisions — answering in-session`);
  turn(`${label} (approval)`, APPROVAL, budgetUsd, timeoutMs, { sessionId, continueSession: true });
}

function exists(...rel) {
  return fs.existsSync(path.join(PROJECT_DIR, ...rel));
}

function readJson(...rel) {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, ...rel), 'utf8')); }
  catch (_) { return null; }
}

/**
 * Run a harness script against the generated project; return its exit code.
 * `args` is passed verbatim — subcommand-style CLIs (plan-approval.js) need
 * their verb first, so this helper does not inject anything ahead of it.
 */
function script(name, args) {
  try {
    execFileSync('node', [path.join(SCRIPTS, name), ...args], { cwd: PROJECT_DIR, stdio: 'pipe' });
    return 0;
  } catch (err) {
    return typeof err.status === 'number' ? err.status : 2;
  }
}

/** The human approval a headless run cannot give, through the documented lane. */
function waive(phase) {
  const code = script('plan-approval.js', ['waive', '--phase', phase, '--lane', '--auto', '--root', PROJECT_DIR]);
  assert.strictEqual(code, 0, `could not waive the ${phase} gate`);
}

function storyFiles() {
  try {
    return fs.readdirSync(path.join(PROJECT_DIR, 'specs', 'stories'))
      .filter((f) => /^E\d+-S\d+\.md$/.test(f));
  } catch (_) { return []; }
}

test('front-half: /brd -> /spec -> /design -> /test, one cold session each', { timeout: 5900000 }, async (t) => {
  freshProject(PROJECT_DIR, SAMPLE_PRD);
  const sessions = [];

  t.after(() => {
    console.log(`\n${formatSummary(PROJECT_DIR, summarizeSpecs(PROJECT_DIR))}`);
    console.log(`→ inspect: ${PROJECT_DIR}/specs`);
  });

  // ── Phase 0: scaffold ────────────────────────────────────────────────────
  const scaffold = coldPhase(
    'scaffold',
    '/scaffold --yes a Node.js bookmarks CLI from prd.md; CLI surface; '
      + 'no team integrations, no tracker, no framework packs',
    '3.00', 420000,
  );
  sessions.push(scaffold.sessionId);
  assert.ok(exists('project-manifest.json'), 'scaffold must install the harness before /brd');

  // ── Phase 1: /brd ────────────────────────────────────────────────────────
  const brd = coldPhase('brd', '/brd --prd prd.md', '3.00', 600000);
  sessions.push(brd.sessionId);
  assert.ok(exists('specs', 'brd', 'brd.md'), '/brd must write specs/brd/brd.md');
  assert.ok(exists('specs', 'brd', 'brd-requirements.json'), '/brd must write the requirement spine');

  // The BRD's own grounding gate ran inside the phase — assert its verdict,
  // not a re-derived one. A receipt that says "fail" is a red route.
  const grounding = readJson('specs', 'reviews', 'brd-grounding.json');
  assert.ok(grounding, 'the /brd phase must leave specs/reviews/brd-grounding.json');
  assert.notStrictEqual(grounding.status, 'fail', `brd grounding failed: ${JSON.stringify(grounding).slice(0, 400)}`);

  const spine = readJson('specs', 'brd', 'brd-requirements.json');
  const spineCount = Array.isArray(spine) ? spine.length : Object.keys(spine || {}).length;
  assert.ok(spineCount >= 1, 'the requirement spine must carry at least one requirement');
  waive('brd');

  // ── Phase 2a: /spec shaping (decisions only) ─────────────────────────────
  const spec = coldPhase('spec', '/spec', '4.00', 900000);
  sessions.push(spec.sessionId);
  settle('spec', spec.sessionId, '4.00', 900000, 'specs', 'decisions', 'spec-decisions.json');
  assert.ok(
    exists('specs', 'decisions', 'spec-decisions.json'),
    '/spec must write specs/decisions/spec-decisions.json before rendering',
  );
  // Round-trip the REAL gate over the REAL decisions file, not a fixture.
  assert.strictEqual(
    script('validate-spec-decisions.js', ['--root', PROJECT_DIR, '--rendering']), 0,
    'the spec decisions file must pass its own validator',
  );

  // ── Phase 2b: /spec --render-only (the post-clear hop) ────────────────────
  const specRender = coldPhase('spec --render-only', '/spec --render-only', '4.00', 900000);
  sessions.push(specRender.sessionId);
  assert.ok(storyFiles().length >= 1, `expected >=1 story file, got ${storyFiles().length}`);
  assert.ok(exists('specs', 'stories', 'dependency-graph.md'), 'spec-render must write the dependency graph');
  assert.ok(exists('features.json'), 'spec-render must write root features.json');
  waive('spec');

  // ── Phase 3a: /design shaping ────────────────────────────────────────────
  const design = coldPhase('design', '/design', '4.00', 900000);
  sessions.push(design.sessionId);
  settle('design', design.sessionId, '4.00', 900000, 'specs', 'decisions', 'design-decisions.json');
  assert.ok(
    exists('specs', 'decisions', 'design-decisions.json'),
    '/design must write specs/decisions/design-decisions.json before rendering',
  );
  assert.strictEqual(
    script('validate-design-decisions.js', ['--root', PROJECT_DIR, '--rendering']), 0,
    'the design decisions file must pass its own validator',
  );

  // ── Phase 3b: /design --render-only ──────────────────────────────────────
  const designRender = coldPhase('design --render-only', '/design --render-only', '4.00', 900000);
  sessions.push(designRender.sessionId);
  assert.ok(exists('specs', 'design', 'component-map.md'), 'design-render must write the component map');
  waive('design');

  // ── Phase 4: /test --plan-only ───────────────────────────────────────────
  const testPhase = coldPhase('test', '/test --plan-only', '4.00', 900000);
  sessions.push(testPhase.sessionId);
  assert.ok(
    exists('specs', 'test_artefacts', 'verification-matrix.json'),
    '/test --plan-only must write the verification matrix',
  );
  assert.ok(
    exists('specs', 'test_artefacts', 'test-traces.json'),
    '/test --plan-only must write test-traces.json',
  );

  // ── The property this route exists for ───────────────────────────────────
  // Seven phases, seven distinct sessions. A repeated id would mean a phase
  // carried its predecessor's context — the 273K-vs-110K regression that
  // handoff-check.js was written to stop, and the whole reason this route runs
  // the commands separately instead of through /build.
  assert.strictEqual(
    new Set(sessions).size, sessions.length,
    `each phase must run in its own cold session, got ${JSON.stringify(sessions)}`,
  );

  // The generated project must live outside the harness checkout — a scaffolded
  // tree inside the repo is what spawns the iCloud " 2" duplicates.
  const repoRoot = fs.realpathSync.native(path.join(__dirname, '..', '..'));
  assert.ok(
    !fs.realpathSync.native(PROJECT_DIR).startsWith(repoRoot + path.sep),
    `live e2e output must not land in the repo: ${PROJECT_DIR}`,
  );
});
