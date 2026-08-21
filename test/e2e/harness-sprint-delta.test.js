'use strict';

// ── Sprint-N route: /sprint over a built sprint-1 system (the SPDD delta lane) ──
//
// `/sprint` is the only lane that evolves an existing harness-built system PRD
// by PRD, and it is the only lane with a property no other route can express:
// Phase 3 must AMEND the living `specs/design/` baseline, never regenerate it.
// `design/SKILL.md`'s Delta Mode says so in its own Gotchas — "a rewritten
// architecture.md with no trace to the prior version" is the failure — and the
// sprint-2 PRD this route runs describes itself as the `/spdd-prompt-update`
// analog: "change the create, redirect, and list contracts, then generate
// against the amended Canvas — do not regenerate the architecture."
//
// A regenerated design produces every artifact an existence check looks for, so
// only identity catches it: whatever the baseline named must still be named
// afterwards (helpers/design-baseline.js).
//
// The second oracle is the PRD itself. Its "What's new" table pre-commits the
// classification — FR-9/FR-10 new, FR-2/3/4 changed, the rest carried, and
// "Nothing from sprint 1 is dropped" — so `requirements-delta.json` can be
// checked against a statement made before the run rather than against itself.
//
// The third is the bill. Every other live route spends real money unmeasured;
// this one ratchets per-phase spend against a committed baseline
// (helpers/phase-budget.js), so a lane that doubles in cost fails.
//
// What it does NOT test: the human gates. `claude -p` has no human, so GATE 1
// and GATE 2 are waived through the documented headless lane
// (`plan-approval.js waive --lane --auto`). The `gated` route already proves a
// gate stops a run.
//
// Runs LIVE `claude -p`; costs real money; NOT part of `npm test` and NOT part
// of CI. Run with `npm run test:sprint`.
// Static contract: ../sprint-delta-contract.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { e2eWorkdir } = require('./helpers/e2e-workdir');
const { freshProject } = require('./helpers/fresh-project');
const { runManifestSuite } = require('./helpers/manifest-suite');
const { resolvePrd } = require('./helpers/prd-fixture');
const { snapshotDesign, missingFrom, anyMissing, isEmpty } = require('./helpers/design-baseline');
const { billRoute, checkBudget, writeBaseline, writeReceipt, formatBill } = require('./helpers/phase-budget');

const ROUTE = 'sprint-delta';
const PROJECT_DIR = e2eWorkdir('sprint');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const SCRIPTS = path.join(PLUGIN_DIR, 'scripts');
const BASELINE_TREE = path.join(__dirname, 'fixtures', 'baselines', 'shortlink-sprint1');
const SPRINT2_PRD = resolvePrd('sprint2');
const UPDATE_BASELINE = process.env.HARNESS_E2E_UPDATE_BASELINE === '1';

const BASE = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR };

const sessions = [];

/** One phase, one cold session — the /clear between commands, mechanically. */
function phase(label, prompt, budgetUsd, timeoutMs, opts = {}) {
  const sessionId = opts.sessionId || randomUUID();
  const started = Date.now();
  const res = runClaude(prompt, {
    ...BASE, sessionId, budgetUsd, timeoutMs, continueSession: Boolean(opts.continueSession),
  });
  if (!sessions.includes(sessionId)) sessions.push(sessionId);
  console.log(`[${ROUTE}] ${label}: exit=${res.exitCode} ${Math.round((Date.now() - started) / 1000)}s`);
  if (res.sessionLimited) assert.fail(`${label}: ${res.limitMessage}`);
  return { ...res, sessionId };
}

function projectPath(...rel) { return path.join(PROJECT_DIR, ...rel); }
function exists(...rel) { return fs.existsSync(projectPath(...rel)); }

function readJson(...rel) {
  try { return JSON.parse(fs.readFileSync(projectPath(...rel), 'utf8')); }
  catch (_) { return null; }
}

/** Run a harness script against the generated project; return its exit code. */
function script(name, args) {
  try {
    execFileSync('node', [path.join(SCRIPTS, name), ...args], { cwd: PROJECT_DIR, stdio: 'pipe' });
    return 0;
  } catch (err) {
    return typeof err.status === 'number' ? err.status : 2;
  }
}

/** The human approval a headless run cannot give, through the documented lane. */
function waive(gate) {
  const code = script('plan-approval.js', ['waive', '--phase', gate, '--lane', '--auto', '--root', PROJECT_DIR]);
  assert.strictEqual(code, 0, `could not waive the ${gate} gate`);
}

/**
 * Seed the built sprint-1 system.
 *
 * The tree is product only — the harness control plane is deliberately not
 * snapshotted, so the route runs the CURRENT harness against a sprint-1
 * product rather than a frozen copy of an old one. `/scaffold --yes existing`
 * reinstalls it in Phase A.
 */
function seedBaseline() {
  assert.ok(
    fs.existsSync(path.join(BASELINE_TREE, 'specs', 'design', 'architecture.md')),
    `no sprint-1 baseline at ${BASELINE_TREE}.\n`
    + 'Build one first: `npm run e2e:baseline:sprint1` (live build from the sprint-1 PRD),\n'
    + 'or snapshot an existing built project: '
    + '`node test/e2e/make-sprint1-baseline.js --from /path/to/project`.',
  );
  freshProject(PROJECT_DIR, null);
  fs.cpSync(BASELINE_TREE, PROJECT_DIR, { recursive: true });
  fs.copyFileSync(SPRINT2_PRD, projectPath('prd-sprint-2.md'));
  // /sprint's Phase 0 and spdd-sync both read `git diff HEAD`; an uncommitted
  // seed would read as if the whole sprint-1 system were this sprint's change.
  execFileSync('git', ['add', '-A'], { cwd: PROJECT_DIR, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=e2e@harness.local', '-c', 'user.name=harness-e2e',
    'commit', '-m', 'sprint 1 baseline'], { cwd: PROJECT_DIR, stdio: 'ignore' });
}

test('sprint: /sprint amends the living design and builds sprint 2', { timeout: 7100000 }, (t) => {
  seedBaseline();

  // The baseline as it stood BEFORE the delta lane touched it. Captured from
  // disk, not re-derived later — this is the comparison's whole basis.
  const before = snapshotDesign(PROJECT_DIR);
  assert.ok(!isEmpty(before), 'the seeded baseline must carry a real design to amend');

  t.after(() => {
    console.log(`\n→ inspect: ${PROJECT_DIR}`);
    const bill = billRoute(PROJECT_DIR, { sessionIds: sessions });
    console.log(`${formatBill(ROUTE, bill)}\n→ receipt: ${writeReceipt(ROUTE, bill)}`);
  });

  // ── Phase A: install the current harness over the sprint-1 product ───────
  phase('scaffold', '/scaffold --yes existing Python FastAPI + Next.js shortlink service; '
    + 'API and web surface; no team integrations, no tracker, no framework packs', '3.00', 600000);
  assert.ok(exists('project-manifest.json'), 'scaffold must install the harness before /sprint');
  assert.ok(
    exists('specs', 'design', 'architecture.md'),
    'scaffold over an existing project must not wipe the living design baseline',
  );

  // ── Phase B: the delta lane ──────────────────────────────────────────────
  phase('sprint', `/sprint prd-sprint-2.md --autonomous\n\n`
    + 'Headless lane: there is no human here, so present GATE 2 and stop after Phase 3 '
    + '(the design amendment). Do not skip any machine gate — the requirements-delta '
    + 'classification, the grounding gate, the contract-drift check and the design-delta '
    + 'evaluator all still run.', '25.00', 2400000);

  // ── The delta the PRD pre-committed to ───────────────────────────────────
  const delta = readJson('specs', 'brd', 'sprint-2', 'requirements-delta.json');
  assert.ok(delta, '/sprint must write specs/brd/sprint-2/requirements-delta.json');
  assert.ok(
    delta.required_total >= 1,
    `requirements-delta over an empty prior spine proves nothing (required_total=${delta.required_total})`,
  );
  // "Nothing from sprint 1 is dropped" — the sprint-2 PRD, before the run.
  assert.deepStrictEqual(
    (delta.dropped || []).map((d) => d.id), [],
    `sprint 2 drops nothing per its PRD; delta reports dropped: ${JSON.stringify(delta.dropped)}`,
  );
  assert.ok(
    (delta.net_new || []).length >= 1,
    'sprint 2 introduces FR-9 and FR-10 — a delta with no net-new requirement did not classify',
  );

  const spine = readJson('specs', 'brd', 'sprint-2', 'brd-requirements.json') || [];
  const labels = new Set(spine.map((r) => r.label).filter(Boolean));
  for (const label of ['FR-9', 'FR-10']) {
    assert.ok(labels.has(label), `sprint-2 spine must carry ${label}; got ${[...labels].sort().join(', ')}`);
  }
  for (const label of ['FR-1', 'FR-5', 'FR-6', 'FR-7', 'FR-8']) {
    assert.ok(labels.has(label), `${label} is carried, not dropped — it must survive into the sprint-2 spine`);
  }

  // ── The property this route exists for: amend, never regenerate ──────────
  assert.ok(exists('specs', 'design', 'amendments', 'sprint-2.md'), 'delta mode must write the amendment');
  const amendment = fs.readFileSync(projectPath('specs', 'design', 'amendments', 'sprint-2.md'), 'utf8');
  assert.match(amendment, /Breaking Changes/i, 'the amendment must carry a Breaking Changes section');

  const diff = missingFrom(before, snapshotDesign(PROJECT_DIR));
  assert.ok(
    !anyMissing(diff),
    'the design was regenerated, not amended — the baseline stopped being named:\n'
    + JSON.stringify(diff, null, 2),
  );

  // ── The machine gates the lane runs, read as verdicts, not re-derived ────
  const grounding = readJson('specs', 'reviews', 'design-grounding.json');
  assert.ok(grounding, 'delta mode must leave specs/reviews/design-grounding.json');
  // Assert the key exists before asserting its value: a renamed verdict field
  // would otherwise make this check pass on a receipt it never actually read.
  assert.ok(
    Object.prototype.hasOwnProperty.call(grounding, 'pass'),
    `design-grounding.json carries no pass verdict: ${JSON.stringify(grounding).slice(0, 400)}`,
  );
  assert.notStrictEqual(grounding.pass, false, `design grounding failed: ${JSON.stringify(grounding).slice(0, 400)}`);
  assert.ok(exists('specs', 'reviews', 'contract-drift-verdict.json'), 'delta mode must run the contract-drift check');

  // SPDD's own code<->record sync, over the real project.
  assert.strictEqual(
    script('spdd-sync.js', ['--root', PROJECT_DIR]), 0,
    'spdd-sync must be clean after the amendment',
  );

  for (const gate of ['brd', 'spec', 'design']) waive(gate);

  // ── Phase C: the delta test plan, then the build ─────────────────────────
  phase('test', '/test\n\nScope: specs/stories/sprint-2/ only. Then run '
    + '`node .claude/scripts/bundle-write.js` so sprint-2 stories carry execution contracts.',
  '8.00', 1200000);
  assert.ok(
    exists('specs', 'test_artefacts', 'verification-matrix.json'),
    '/test must leave a verification matrix for the sprint-2 stories',
  );
  waive('test');

  phase('auto', '/auto --mode lean\n\nImplement the open sprint-2 groups only. Do not replan and do '
    + 'not regenerate specs/design/. Finish when the project suite passes.', '30.00', 2400000);

  let suite = runManifestSuite(PROJECT_DIR, 1200000);
  if (suite.status !== 0) {
    console.log(`[${ROUTE}] suite not green after /auto — one bounded resume`);
    phase('auto-resume', '/auto --mode lean\n\nContinue the open sprint-2 groups until the project '
      + 'suite passes. Do not replan and do not regenerate specs/design/.', '20.00', 1800000);
    suite = runManifestSuite(PROJECT_DIR, 1200000);
  }
  assert.strictEqual(suite.status, 0, `sprint-2 build must leave a green suite:\n${suite.out}`);

  // Sprint 1 must still be named after the build, not just after the design
  // phase — /auto edits specs/design/ too (component-map, canvas).
  assert.ok(
    !anyMissing(missingFrom(before, snapshotDesign(PROJECT_DIR))),
    'the build regenerated the design the amendment preserved',
  );

  // ── The bill ─────────────────────────────────────────────────────────────
  const bill = billRoute(PROJECT_DIR, { sessionIds: sessions });
  const verdict = checkBudget(ROUTE, bill, { update: UPDATE_BASELINE });
  if (verdict.status === 'recorded') {
    console.log(`[${ROUTE}] budget baseline recorded: ${writeBaseline(ROUTE, bill)}`);
  } else {
    assert.strictEqual(
      verdict.status, 'pass',
      `per-phase spend regressed past ${verdict.tolerance * 100}%:\n${JSON.stringify(verdict.regressions, null, 2)}`
      + '\nIf the new cost is intended, re-record with HARNESS_E2E_UPDATE_BASELINE=1.',
    );
  }

  // Generated trees never belong in the checkout — see e2e-workdir.js.
  const repoRoot = fs.realpathSync.native(path.join(__dirname, '..', '..'));
  assert.ok(
    !fs.realpathSync.native(PROJECT_DIR).startsWith(repoRoot + path.sep),
    `live e2e output must not land in the repo: ${PROJECT_DIR}`,
  );
});
