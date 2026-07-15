#!/usr/bin/env node

'use strict';

// Phase-2 A/B orchestrator: drive the balanced-vs-fusion cheap-worker experiment
// over two PRE-SCAFFOLDED arm dirs by shelling out to the existing verified
// primitives (model-tier -> build-chain -> cost-per-outcome + loop-health ->
// ab-report). It does NOT scaffold projects — that is the model-driven /scaffold
// flow. Each arm dir must ALREADY be a scaffolded harness project (proxy: it
// contains .claude/agents/); if not, we error clearly pointing at the runbook.
// See docs/fusion-ab-runbook.md.
//
// DEFAULT is DRY-RUN: validate prerequisites, print the exact ordered per-arm
// plan, spend nothing, change nothing. --execute actually runs the protocol and
// REQUIRES a positive --budget and ANTHROPIC_API_KEY (a runaway build is real
// money). Arms run SERIALLY: preset stamping mutates agent frontmatter in place
// and cannot overlap, and each arm points build-chain at its OWN control plane
// (HARNESS_PLUGIN_DIR=<arm>/.claude) so the two presets never collide.
//
// Pure core (parseArgs / validatePrereqs / buildPlan / formatPlan / runAb) is
// injected with a spawn+fs boundary (deps) so tests drive the orchestration
// without real builds — mirroring build-chain.js's runChain(deps) pattern.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const RUNBOOK = 'docs/fusion-ab-runbook.md';
const DEFAULT_PRESET_A = 'balanced';
const DEFAULT_PRESET_B = 'fusion';

function parseArgs(argv) {
  const cfg = {
    prd: null, armA: null, armB: null,
    presetA: DEFAULT_PRESET_A, presetB: DEFAULT_PRESET_B,
    budget: null, execute: false, json: false,
  };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--preset-a') cfg.presetA = argv[i += 1];
    else if (a === '--preset-b') cfg.presetB = argv[i += 1];
    else if (a === '--budget') cfg.budget = Number(argv[i += 1]);
    else if (a === '--execute') cfg.execute = true;
    else if (a === '--json') cfg.json = true;
    else if (!a.startsWith('-')) pos.push(a);
  }
  [cfg.prd, cfg.armA, cfg.armB] = [pos[0] || null, pos[1] || null, pos[2] || null];
  return cfg;
}

// Prereqs for BOTH modes: PRD exists; each arm dir exists and contains
// .claude/agents/ (the "already scaffolded" proxy); arms are distinct. Under
// --execute additionally: --budget > 0 and ANTHROPIC_API_KEY set. Returns every
// missing item so the caller can print them all and exit non-zero without running.
function validatePrereqs(cfg, deps) {
  const errors = [];
  const { exists } = deps;
  if (!cfg.prd) errors.push('PRD path is required (positional arg 1).');
  else if (!exists(cfg.prd)) errors.push(`PRD file not found: ${cfg.prd}`);

  for (const [label, dir] of [['arm A', cfg.armA], ['arm B', cfg.armB]]) {
    if (!dir) { errors.push(`${label} directory is required.`); continue; }
    if (!exists(dir)) { errors.push(`${label} directory not found: ${dir}`); continue; }
    if (!exists(path.join(dir, '.claude', 'agents'))) {
      errors.push(
        `${label} is not a scaffolded harness project (missing .claude/agents/): ${dir}. `
        + `Scaffold it first — see ${RUNBOOK}`,
      );
    }
  }
  if (cfg.armA && cfg.armB && path.resolve(cfg.armA) === path.resolve(cfg.armB)) {
    errors.push('arm A and arm B must be distinct directories.');
  }
  if (cfg.execute) {
    if (!(cfg.budget > 0)) {
      errors.push('--execute requires --budget <usd> greater than 0 (a runaway build is real money).');
    }
    if (!deps.env.ANTHROPIC_API_KEY) errors.push('--execute requires ANTHROPIC_API_KEY to be set.');
  }
  return { ok: errors.length === 0, errors };
}

// One arm's ordered command chain. build-chain runs with cwd=<arm> and env
// pinning HARNESS_PLUGIN_DIR at THAT arm's stamped control plane (the isolation
// requirement) + the per-arm budget cap.
function armPlan(label, dirAbs, preset, ctx) {
  const s = ctx.scriptsDir;
  return {
    arm: label,
    dir: dirAbs,
    preset,
    steps: [
      {
        name: 'stamp',
        argv: ['node', path.join(s, 'model-tier.js'), preset, '--apply', path.join(dirAbs, '.claude', 'agents')],
        stamp: true,
      },
      {
        name: 'build',
        argv: ['node', path.join(s, 'build-chain.js'), ctx.prdAbs],
        cwd: dirAbs,
        env: { HARNESS_PLUGIN_DIR: path.join(dirAbs, '.claude'), BUILD_CHAIN_MAX_BUDGET_USD: ctx.budgetStr },
        build: true,
      },
      { name: 'cost', argv: ['node', path.join(s, 'cost-per-outcome.js'), '--json'], cwd: dirAbs },
      { name: 'loop', argv: ['node', path.join(s, 'loop-health.js')], cwd: dirAbs },
    ],
  };
}

function buildPlan(cfg, ctx) {
  const a = armPlan('armA', path.resolve(cfg.armA), cfg.presetA, ctx);
  const b = armPlan('armB', path.resolve(cfg.armB), cfg.presetB, ctx);
  const compare = {
    name: 'compare',
    argv: ['node', path.join(ctx.scriptsDir, 'ab-report.js'), a.dir, b.dir, '--json', '--out', ctx.outRoot],
    capture: true,
  };
  return { arms: [a, b], compare };
}

function stepLine(step) {
  const envPrefix = step.env
    ? `${Object.entries(step.env).map(([k, v]) => `${k}=${v}`).join(' ')} `
    : '';
  return `${envPrefix}${step.argv.join(' ')}`;
}

function formatPlan(plan, cfg) {
  const lines = [
    `A/B run plan — ${cfg.execute ? `EXECUTE (budget capped at $${cfg.budget}/arm)` : 'DRY-RUN (nothing runs, nothing spent)'}`,
    `PRD: ${path.resolve(cfg.prd)}`,
  ];
  for (const arm of plan.arms) {
    lines.push(`\n${arm.arm} [${arm.preset}] — ${arm.dir}`);
    arm.steps.forEach((st, i) => lines.push(`  ${i + 1}. ${stepLine(st)}`));
  }
  lines.push(`\nafter both arms: ${plan.compare.argv.join(' ')}`);
  return `${lines.join('\n')}\n`;
}

function planJson(plan, cfg) {
  return {
    mode: cfg.execute ? 'execute' : 'dry-run',
    prd: path.resolve(cfg.prd),
    arms: plan.arms.map((a) => ({
      arm: a.arm,
      dir: a.dir,
      preset: a.preset,
      steps: a.steps.map((st) => ({ name: st.name, cmd: stepLine(st), cwd: st.cwd || null })),
    })),
    compare: { cmd: plan.compare.argv.join(' ') },
  };
}

const spawnOk = (r) => Boolean(r) && r.status === 0 && !r.signal && !r.error;
const parseJsonMaybe = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };

// Execute one step (mutates `state`). A failed STAMP skips the build — don't
// spend the budget on an un-stamped, wrong-model arm (void verdict); a failed
// BUILD is only recorded, snapshots still run (partial beats none).
function runArmStep(arm, step, deps, state) {
  if (step.build && state.stampFailed) {
    deps.log(`[${arm.arm}] SKIP build — stamp failed; not spending budget on an un-stamped (wrong-model) arm`);
    return { name: step.name, ok: false, skipped: true };
  }
  deps.log(`[${arm.arm}] ${step.name}`);
  const r = deps.spawn(step.argv[0], step.argv.slice(1), { cwd: step.cwd, env: step.env, capture: step.capture });
  const ok = spawnOk(r);
  if (step.stamp) {
    state.stampOk = ok;
    if (ok) deps.setManifestTier(arm.dir, arm.preset); else state.stampFailed = true;
  }
  if (step.build) state.buildOk = ok;
  return { name: step.name, ok };
}

// Run one arm's chain serially (map is sequential, so stampFailed propagates to
// the build step). Never throws.
function runArm(arm, deps) {
  const state = { stampFailed: false, stampOk: true, buildOk: false };
  const steps = arm.steps.map((step) => runArmStep(arm, step, deps, state));
  return {
    arm: arm.arm, dir: arm.dir, preset: arm.preset, steps,
    stamp_ok: state.stampOk, build_ok: state.buildOk,
    cost_artifact: deps.exists(path.join(arm.dir, '.claude', 'state', 'cost-per-outcome.json')),
  };
}

// --execute: arms run serially (in-place stamping cannot overlap), then compare
// + summarize on whatever artifacts exist. Exit code tracks whether BOTH arms
// produced a cost-per-outcome.json (partial run => non-zero).
function runExecute(cfg, ctx, plan, deps) {
  const arms = plan.arms.map((arm) => runArm(arm, deps));
  const cmp = deps.spawn(plan.compare.argv[0], plan.compare.argv.slice(1), { capture: true });
  const report = parseJsonMaybe(cmp && cmp.stdout);
  const bothCost = arms.every((a) => a.cost_artifact);
  const bothStamped = arms.every((a) => a.stamp_ok);
  const summary = {
    generated_at: deps.now(),
    mode: 'execute',
    prd: ctx.prdAbs,
    budget: cfg.budget,
    presets: { armA: cfg.presetA, armB: cfg.presetB },
    arms,
    compare_ok: spawnOk(cmp),
    report_status: report ? report.status : null,
    verdict: report && report.verdict ? report.verdict : null,
    both_arms_have_cost: bothCost,
    both_arms_stamped: bothStamped,
  };
  deps.writeSummary(summary);
  if (report && report.verdict) deps.log(`A/B verdict: ${report.verdict.reason}`);
  else deps.log(`A/B compare produced no parseable verdict (status=${summary.report_status || 'unknown'}).`);
  if (!bothStamped) deps.log('Warning: a preset stamp failed — that arm ran the wrong models; the A/B result is VOID.');
  if (!bothCost) deps.log('Warning: not both arms produced cost-per-outcome.json — result is partial.');
  return { status: 'executed', exitCode: bothCost && bothStamped ? 0 : 1, summary };
}

function runAb(cfg, deps) {
  const v = validatePrereqs(cfg, deps);
  if (!v.ok) {
    deps.log('A/B run prerequisites not met:');
    for (const e of v.errors) deps.log(`  - ${e}`);
    return { status: 'prereq-failed', exitCode: 2, errors: v.errors };
  }
  const ctx = {
    scriptsDir: deps.scriptsDir,
    outRoot: deps.outRoot,
    prdAbs: path.resolve(cfg.prd),
    budgetStr: cfg.budget > 0 ? String(cfg.budget) : '<budget>',
  };
  const plan = buildPlan(cfg, ctx);
  if (!cfg.execute) {
    deps.log(cfg.json ? JSON.stringify({ status: 'dry-run', plan: planJson(plan, cfg) }, null, 2) : formatPlan(plan, cfg));
    return { status: 'dry-run', exitCode: 0, plan };
  }
  return runExecute(cfg, ctx, plan, deps);
}

// ---- real deps (used by the CLI entrypoint; not exercised by unit tests) ----

function realSpawn(command, args, opts = {}) {
  return spawnSync(command, args, {
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    killSignal: 'SIGKILL',
  });
}

function realSetManifestTier(dir, preset) {
  const file = path.join(dir, 'project-manifest.json');
  if (!fs.existsSync(file)) return;
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.execution = m.execution || {};
    m.execution.model_tier = preset;
    fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  } catch (_) { /* non-fatal: pricing falls back to inferred tier */ }
}

function realWriteSummary(outRoot, summary) {
  const dir = path.join(outRoot, '.claude', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ab-run.json'), `${JSON.stringify(summary, null, 2)}\n`);
}

function realDeps() {
  const outRoot = process.cwd();
  return {
    scriptsDir: __dirname,
    outRoot,
    env: process.env,
    exists: (p) => fs.existsSync(p),
    spawn: realSpawn,
    setManifestTier: realSetManifestTier,
    writeSummary: (s) => realWriteSummary(outRoot, s),
    now: () => new Date().toISOString(),
    log: (m) => process.stdout.write(`${m}\n`),
  };
}

module.exports = {
  parseArgs, validatePrereqs, buildPlan, formatPlan, planJson, stepLine, runArm, runAb,
};

if (require.main === module) {
  let res;
  try {
    res = runAb(parseArgs(process.argv.slice(2)), realDeps());
  } catch (err) {
    process.stderr.write(`ab-run: ${err && err.message}\n`);
    process.exit(1);
  }
  process.exit(res.exitCode);
}
