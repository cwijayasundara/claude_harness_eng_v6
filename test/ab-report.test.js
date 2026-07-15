'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', '.claude', 'scripts', 'ab-report.js');
const {
  buildReport, writeArtifact, turnsPerDispatch, delta,
} = require(SCRIPT);

// --- fixtures ---------------------------------------------------------------

// Mirror the REAL artifact shapes: cost-per-outcome.js run_total + tier.label,
// loop-health.js signals.telemetry.{turns,subagents}. cost_per_passed_story is
// computed the way cost-per-outcome.js writes it ("n/a" at zero passed) so the
// report consumes the artifact rather than recomputing.
function costObj(label, est, passed, total) {
  return {
    tier: { label },
    run_total: {
      est_cost_usd: est,
      passed,
      total,
      cost_per_passed_story: passed > 0 ? Math.round((est / passed) * 100) / 100 : 'n/a',
    },
  };
}

// Build a throwaway arm root. Pass cost=null to omit cost-per-outcome.json and
// telemetry=undefined to omit loop-health.json (the arm-missing guards).
function mkArm(cost, telemetry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-arm-'));
  if (cost) {
    fs.mkdirSync(path.join(root, '.claude', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.claude', 'state', 'cost-per-outcome.json'),
      JSON.stringify(cost),
    );
  }
  if (telemetry !== undefined) {
    fs.mkdirSync(path.join(root, 'specs', 'retro'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'specs', 'retro', 'loop-health.json'),
      JSON.stringify({ signals: { telemetry } }),
    );
  }
  return root;
}

// --- helpers: turns-per-dispatch + delta (divide-by-zero honesty) -----------

test('turnsPerDispatch: divides, returns n/a (never Infinity/NaN) at zero dispatches', () => {
  assert.strictEqual(turnsPerDispatch(12, 4), 3);
  assert.strictEqual(turnsPerDispatch(7, 0), 'n/a');
  assert.strictEqual(turnsPerDispatch(0, 0), 'n/a');
});

test('delta: absolute + percent, null percent at zero base, null pair for non-numbers', () => {
  assert.deepStrictEqual(delta(10, 6), { abs: -4, pct: -40 });
  assert.deepStrictEqual(delta(0, 5), { abs: 5, pct: null });
  assert.deepStrictEqual(delta('n/a', 5), { abs: null, pct: null });
  assert.deepStrictEqual(delta(5, 'n/a'), { abs: null, pct: null });
});

// --- verdict: the article's bar (cheaper/passed at equal-or-better score) ----

test('buildReport: cheaper arm at equal-or-better pass rate wins', () => {
  const a = mkArm(costObj('balanced', 10, 5, 10), { turns: 12, subagents: 4 }); // cpps 2.0, pr 0.5
  const b = mkArm(costObj('fusion', 6, 5, 10), { turns: 8, subagents: 4 });     // cpps 1.2, pr 0.5
  const rep = buildReport(a, b);
  assert.strictEqual(rep.status, 'ok');
  // per-arm table carries the required fields
  assert.strictEqual(rep.arms.armA.label, 'balanced');
  assert.strictEqual(rep.arms.armB.label, 'fusion');
  assert.strictEqual(rep.arms.armA.est_cost_usd, 10);
  assert.strictEqual(rep.arms.armA.cost_per_passed_story, 2);
  assert.strictEqual(rep.arms.armB.cost_per_passed_story, 1.2);
  assert.strictEqual(rep.arms.armA.turns_per_dispatch, 3);
  assert.strictEqual(rep.arms.armB.turns_per_dispatch, 2);
  // deltas B-vs-A
  assert.strictEqual(rep.deltas.cost_per_passed_story.abs, -0.8);
  assert.strictEqual(rep.deltas.est_cost_usd.pct, -40);
  // verdict
  assert.strictEqual(rep.verdict.winner, 'armB');
  assert.strictEqual(rep.verdict.result, 'winner');
});

test('buildReport: cheaper arm that scored WORSE yields no clear winner', () => {
  const a = mkArm(costObj('balanced', 10, 8, 10), { turns: 10, subagents: 5 }); // cpps 1.25, pr 0.8
  const b = mkArm(costObj('fusion', 6, 5, 10), { turns: 10, subagents: 5 });    // cpps 1.2, pr 0.5
  const rep = buildReport(a, b);
  assert.strictEqual(rep.verdict.winner, null);
  assert.strictEqual(rep.verdict.result, 'no-clear-winner');
  assert.match(rep.verdict.reason, /cheaper arm/);
});

test('buildReport: equal cost-per-passed-story is a tie (no winner)', () => {
  const a = mkArm(costObj('balanced', 10, 5, 10), { turns: 10, subagents: 5 }); // cpps 2.0
  const b = mkArm(costObj('fusion', 8, 4, 10), { turns: 10, subagents: 5 });    // cpps 2.0
  const rep = buildReport(a, b);
  assert.strictEqual(rep.verdict.winner, null);
  assert.strictEqual(rep.verdict.result, 'tie');
});

// --- honest guards: never fire vacuously, never crash -----------------------

test('buildReport: one arm passed 0 is inconclusive and names that arm', () => {
  const a = mkArm(costObj('balanced', 10, 0, 4), { turns: 10, subagents: 5 });
  const b = mkArm(costObj('fusion', 6, 5, 10), { turns: 10, subagents: 5 });
  const rep = buildReport(a, b);
  assert.strictEqual(rep.status, 'inconclusive');
  assert.strictEqual(rep.verdict.winner, null);
  assert.strictEqual(rep.verdict.result, 'inconclusive');
  assert.match(rep.verdict.reason, /armA/);
  assert.match(rep.verdict.reason, /0 of 4/);
  assert.strictEqual(rep.arms.armA.cost_per_passed_story, 'n/a');
});

test('buildReport: both arms passed 0 is inconclusive with the both-arm message', () => {
  const a = mkArm(costObj('balanced', 10, 0, 4), { turns: 10, subagents: 5 });
  const b = mkArm(costObj('fusion', 6, 0, 3), { turns: 10, subagents: 5 });
  const rep = buildReport(a, b);
  assert.strictEqual(rep.verdict.result, 'inconclusive');
  assert.match(rep.verdict.reason, /no passing stories in either arm/);
});

test('buildReport: missing cost-per-outcome.json -> arm-missing naming the arm, no throw', () => {
  const a = mkArm(null, { turns: 10, subagents: 5 }); // no cost-per-outcome.json
  const b = mkArm(costObj('fusion', 6, 5, 10), { turns: 10, subagents: 5 });
  const rep = buildReport(a, b);
  assert.strictEqual(rep.status, 'arm-missing');
  assert.strictEqual(rep.missing.length, 1);
  assert.strictEqual(rep.missing[0].arm, 'armA');
  assert.match(rep.missing[0].artifact, /cost-per-outcome\.json/);
});

test('buildReport: missing loop-health.json -> arm-missing naming the arm', () => {
  const a = mkArm(costObj('balanced', 10, 5, 10), { turns: 10, subagents: 5 });
  const b = mkArm(costObj('fusion', 6, 5, 10), undefined); // no loop-health.json
  const rep = buildReport(a, b);
  assert.strictEqual(rep.status, 'arm-missing');
  assert.strictEqual(rep.missing[0].arm, 'armB');
  assert.match(rep.missing[0].artifact, /loop-health\.json/);
});

// --- artifact write + exit-0 CLI contract -----------------------------------

test('writeArtifact: writes .claude/state/ab-report.json under the out root', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-out-'));
  const a = mkArm(costObj('balanced', 10, 5, 10), { turns: 12, subagents: 4 });
  const b = mkArm(costObj('fusion', 6, 5, 10), { turns: 8, subagents: 4 });
  const rep = buildReport(a, b);
  writeArtifact(out, rep);
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(out, '.claude', 'state', 'ab-report.json'), 'utf8'),
  );
  assert.strictEqual(onDisk.verdict.winner, 'armB');
});

test('CLI: --json prints the report and exits 0 even when an arm is missing', () => {
  const a = mkArm(null, undefined); // both artifacts missing
  const b = mkArm(costObj('fusion', 6, 5, 10), { turns: 8, subagents: 4 });
  const out = execFileSync('node', [SCRIPT, a, b, '--json', '--no-write'], { encoding: 'utf8' });
  const rep = JSON.parse(out);
  assert.strictEqual(rep.status, 'arm-missing');
});
