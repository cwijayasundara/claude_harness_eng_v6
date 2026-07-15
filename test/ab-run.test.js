'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');
const A = require('../.claude/scripts/ab-run.js');

const PRD = '/w/prd.md';
const ARM_A = '/w/a';
const ARM_B = '/w/b';

const agents = (dir) => path.join(dir, '.claude', 'agents');
const costArtifact = (dir) => path.join(path.resolve(dir), '.claude', 'state', 'cost-per-outcome.json');

// Existing paths that make a valid, scaffolded, distinct pair of arms.
const VALID = [PRD, ARM_A, ARM_B, agents(ARM_A), agents(ARM_B)];

// Injected spawn+fs boundary — drives runAb with no real builds.
function makeDeps(opts = {}) {
  const rec = { logs: [], spawnCalls: [], manifestCalls: [], summaries: [] };
  const existing = new Set(opts.existing || VALID);
  const deps = {
    scriptsDir: '/repo/.claude/scripts',
    outRoot: '/repo',
    env: 'env' in opts ? opts.env : { ANTHROPIC_API_KEY: 'sk-x' },
    exists: (p) => existing.has(p),
    spawn: opts.spawn || ((cmd, args, o) => { rec.spawnCalls.push({ cmd, args, opts: o }); return { status: 0, stdout: '' }; }),
    setManifestTier: (dir, preset) => rec.manifestCalls.push({ dir, preset }),
    writeSummary: (s) => rec.summaries.push(s),
    now: () => 'NOW',
    log: (m) => rec.logs.push(m),
  };
  return { deps, rec };
}

const baseCfg = (over = {}) => ({
  prd: PRD, armA: ARM_A, armB: ARM_B, presetA: 'balanced', presetB: 'fusion',
  budget: null, execute: false, json: false, ...over,
});

// ---- arg parsing + defaults ----

test('parseArgs applies defaults (balanced/fusion, dry-run, no json)', () => {
  const c = A.parseArgs([PRD, ARM_A, ARM_B]);
  assert.strictEqual(c.prd, PRD);
  assert.strictEqual(c.armA, ARM_A);
  assert.strictEqual(c.armB, ARM_B);
  assert.strictEqual(c.presetA, 'balanced');
  assert.strictEqual(c.presetB, 'fusion');
  assert.strictEqual(c.execute, false);
  assert.strictEqual(c.json, false);
  assert.strictEqual(c.budget, null);
});

test('parseArgs reads all flags', () => {
  const c = A.parseArgs([PRD, ARM_A, ARM_B, '--preset-a', 'max-quality', '--preset-b', 'cost', '--budget', '12', '--execute', '--json']);
  assert.strictEqual(c.presetA, 'max-quality');
  assert.strictEqual(c.presetB, 'cost');
  assert.strictEqual(c.budget, 12);
  assert.strictEqual(c.execute, true);
  assert.strictEqual(c.json, true);
});

// ---- prereq validation ----

test('validate flags a missing PRD', () => {
  const { deps } = makeDeps({ existing: [ARM_A, ARM_B, agents(ARM_A), agents(ARM_B)] });
  const v = A.validatePrereqs(baseCfg(), deps);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => /PRD file not found/.test(e)));
});

test('validate flags an arm missing .claude/agents and points at the runbook', () => {
  const { deps } = makeDeps({ existing: [PRD, ARM_A, ARM_B, agents(ARM_A)] });
  const v = A.validatePrereqs(baseCfg(), deps);
  assert.strictEqual(v.ok, false);
  const err = v.errors.find((e) => /not a scaffolded harness project/.test(e));
  assert.ok(err && /fusion-ab-runbook\.md/.test(err));
});

test('validate flags identical arm dirs', () => {
  const { deps } = makeDeps({ existing: [PRD, ARM_A, agents(ARM_A)] });
  const v = A.validatePrereqs(baseCfg({ armB: ARM_A }), deps);
  assert.ok(v.errors.some((e) => /distinct directories/.test(e)));
});

test('validate under --execute requires a positive budget', () => {
  const { deps } = makeDeps();
  const v = A.validatePrereqs(baseCfg({ execute: true, budget: 0 }), deps);
  assert.ok(v.errors.some((e) => /--budget/.test(e)));
});

test('validate under --execute requires ANTHROPIC_API_KEY', () => {
  const { deps } = makeDeps({ env: {} });
  const v = A.validatePrereqs(baseCfg({ execute: true, budget: 5 }), deps);
  assert.ok(v.errors.some((e) => /ANTHROPIC_API_KEY/.test(e)));
});

test('validate passes on a clean dry-run config', () => {
  const { deps } = makeDeps();
  assert.deepStrictEqual(A.validatePrereqs(baseCfg(), deps), { ok: true, errors: [] });
});

test('runAb returns exit 2 and does not spawn on prereq failure', () => {
  const { deps, rec } = makeDeps({ existing: [ARM_A, ARM_B, agents(ARM_A), agents(ARM_B)] });
  const res = A.runAb(baseCfg(), deps);
  assert.strictEqual(res.status, 'prereq-failed');
  assert.strictEqual(res.exitCode, 2);
  assert.strictEqual(rec.spawnCalls.length, 0);
});

// ---- dry-run plan output ----

test('dry-run prints the exact per-arm commands and spends/changes nothing', () => {
  const { deps, rec } = makeDeps();
  const res = A.runAb(baseCfg(), deps);
  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(rec.spawnCalls.length, 0);
  assert.strictEqual(rec.manifestCalls.length, 0);
  assert.strictEqual(rec.summaries.length, 0);
  const out = rec.logs.join('\n');
  assert.ok(out.includes(`model-tier.js balanced --apply ${agents(ARM_A)}`));
  assert.ok(out.includes(`model-tier.js fusion --apply ${agents(ARM_B)}`));
  assert.ok(out.includes('build-chain.js /w/prd.md'));
  assert.ok(out.includes(`HARNESS_PLUGIN_DIR=${path.join(ARM_A, '.claude')}`));
  assert.ok(out.includes('cost-per-outcome.js --json'));
  assert.ok(out.includes('loop-health.js'));
  assert.ok(out.includes(`ab-report.js ${ARM_A} ${ARM_B} --json`));
});

test('--json dry-run emits a machine-readable plan shape', () => {
  const { deps, rec } = makeDeps();
  A.runAb(baseCfg({ json: true }), deps);
  const doc = JSON.parse(rec.logs.join('\n'));
  assert.strictEqual(doc.status, 'dry-run');
  assert.strictEqual(doc.plan.mode, 'dry-run');
  assert.strictEqual(doc.plan.arms.length, 2);
  assert.strictEqual(doc.plan.arms[0].preset, 'balanced');
  assert.strictEqual(doc.plan.arms[1].preset, 'fusion');
  assert.strictEqual(doc.plan.arms[0].steps.length, 4);
  assert.ok(/ab-report\.js/.test(doc.plan.compare.cmd));
});

// ---- execute orchestration (injected spawn — no real builds) ----

function executeSpawn(rec, buildStatus = 0) {
  return (cmd, args, o) => {
    rec.spawnCalls.push({ cmd, args, opts: o });
    if (args.some((a) => String(a).includes('ab-report.js'))) {
      return { status: 0, stdout: JSON.stringify({ status: 'ok', verdict: { winner: 'armB', result: 'winner', reason: 'armB wins' } }) };
    }
    if (args.some((a) => String(a).includes('build-chain.js'))) return { status: buildStatus };
    return { status: 0, stdout: '' };
  };
}

test('--execute runs both arms serially, stamps manifests, and reports the verdict', () => {
  const rec0 = makeDeps({ existing: [...VALID, costArtifact(ARM_A), costArtifact(ARM_B)] });
  const rec = rec0.rec;
  rec0.deps.spawn = executeSpawn(rec);
  const res = A.runAb(baseCfg({ execute: true, budget: 8 }), rec0.deps);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.summary.both_arms_have_cost, true);
  assert.strictEqual(res.summary.verdict.reason, 'armB wins');
  assert.strictEqual(rec.summaries.length, 1);
  // 4 steps/arm * 2 arms + 1 compare = 9 spawns, in arm-serial order.
  assert.strictEqual(rec.spawnCalls.length, 9);
  assert.ok(rec.spawnCalls[0].args.some((a) => /model-tier\.js/.test(a)) && rec.spawnCalls[0].args.includes('balanced'));
  assert.ok(rec.spawnCalls[4].args.includes('fusion'));
  assert.ok(/ab-report\.js/.test(rec.spawnCalls[8].args.join(' ')));
  // manifest stamped once per arm, with the arm's preset.
  assert.deepStrictEqual(rec.manifestCalls, [
    { dir: path.resolve(ARM_A), preset: 'balanced' },
    { dir: path.resolve(ARM_B), preset: 'fusion' },
  ]);
  // build step passes HARNESS_PLUGIN_DIR + budget cap for isolation.
  const buildCall = rec.spawnCalls.find((c) => c.args.some((a) => /build-chain\.js/.test(a)));
  assert.strictEqual(buildCall.opts.env.HARNESS_PLUGIN_DIR, path.join(path.resolve(ARM_A), '.claude'));
  assert.strictEqual(buildCall.opts.env.BUILD_CHAIN_MAX_BUDGET_USD, '8');
});

test('--execute is robust: a failed build still snapshots + compares, partial run exits non-zero', () => {
  // Only arm A produced a cost artifact; build link fails everywhere.
  const rec0 = makeDeps({ existing: [...VALID, costArtifact(ARM_A)] });
  const rec = rec0.rec;
  rec0.deps.spawn = executeSpawn(rec, 1);
  const res = A.runAb(baseCfg({ execute: true, budget: 8 }), rec0.deps);

  assert.strictEqual(res.exitCode, 1);
  assert.strictEqual(res.summary.both_arms_have_cost, false);
  assert.strictEqual(res.summary.arms[0].build_ok, false);
  // Snapshots ran for BOTH arms despite the build failure (partial beats none).
  const costRuns = rec.spawnCalls.filter((c) => c.args.some((a) => /cost-per-outcome\.js/.test(a)));
  assert.strictEqual(costRuns.length, 2);
  assert.ok(rec.spawnCalls.some((c) => c.args.some((a) => /ab-report\.js/.test(a))));
});

// Spawn where the STAMP (model-tier.js) fails — the money/validity guardrail.
function stampFailSpawn(rec) {
  return (cmd, args, o) => {
    rec.spawnCalls.push({ cmd, args, opts: o });
    if (args.some((a) => String(a).includes('model-tier.js'))) return { status: 1 };
    if (args.some((a) => String(a).includes('ab-report.js'))) return { status: 0, stdout: JSON.stringify({ status: 'arm-missing' }) };
    return { status: 0, stdout: '' };
  };
}

test('--execute skips the build when the stamp fails: no spend on a wrong-model arm, run is VOID', () => {
  const rec0 = makeDeps({ existing: [...VALID] });
  const rec = rec0.rec;
  rec0.deps.spawn = stampFailSpawn(rec);
  const res = A.runAb(baseCfg({ execute: true, budget: 8 }), rec0.deps);

  // No build-chain spawn at all — the budget is never spent on an un-stamped arm.
  assert.ok(!rec.spawnCalls.some((c) => c.args.some((a) => /build-chain\.js/.test(a))));
  assert.ok(res.summary.arms[0].steps.find((s) => s.name === 'build').skipped);
  assert.strictEqual(res.summary.both_arms_stamped, false);
  assert.strictEqual(res.exitCode, 1); // a mis-stamped arm is void, not a pass
  assert.ok(rec.logs.some((l) => /VOID/.test(l)));
});
