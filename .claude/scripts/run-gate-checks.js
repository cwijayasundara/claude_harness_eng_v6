#!/usr/bin/env node
'use strict';

// One CLI, two lanes:
//
//   (default) sensors — GATE_CATALOG in hooks/lib/gate-registry.js, filtered by
//   sensor_tier. This is /auto Gate 5 and /implement Step 6. Same list the
//   git pre-commit hook runs. Writes specs/reviews/sensor-checks.json.
//
//   --lane gate       — pack checks in .claude/config/gate-checks.json. This is
//   /gate Step 2. --only <id> also selects this lane so /vibe and evidence-integrity
//   keep working. Writes specs/reviews/gate-checks.json.
//
//   node .claude/scripts/run-gate-checks.js [--root <dir>] [--files a b ...] [--json]
//   node .claude/scripts/run-gate-checks.js --lane gate --files a b ...

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { recordOutcome } = require('../hooks/lib/sensor-outcomes');
const { isGateEnabled, loadSensorTier, GATE_TIERS, isBrownfieldGraphReal } = require('../hooks/lib/sensor-tier');
const { runSensorCatalog } = require('../hooks/lib/gate-registry');

const REGISTRY_REL = path.join('.claude', 'config', 'gate-checks.json');
const OUT_REL = path.join('specs', 'reviews', 'gate-checks.json');
const SENSOR_OUT_REL = path.join('specs', 'reviews', 'sensor-checks.json');

function loadRegistry(projectDir) {
  const file = path.join(projectDir, REGISTRY_REL);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.checks)) throw new Error(`${REGISTRY_REL}: "checks" must be an array`);
  return raw.checks;
}

// Minimal glob: `*` matches within a path segment, `**` across segments.
function globMatch(pattern, filePath) {
  const rx = pattern
    .split('**').map((s) => s.split('*').map((t) => t.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  return new RegExp(`(^|/)${rx}$`).test(filePath);
}

function triggerFires(when, { hasCodeGraph, changedFiles, projectDir }) {
  if (!when || when === 'always') return true;
  if (when === 'code-graph') return !!hasCodeGraph;
  if (when.startsWith('changed:')) {
    const pattern = when.slice('changed:'.length);
    return (changedFiles || []).some((f) => globMatch(pattern, f));
  }
  if (when.startsWith('exists:')) {
    return fs.existsSync(path.join(projectDir || process.cwd(), when.slice('exists:'.length)));
  }
  // An unrecognised trigger must not silently disable a check.
  return true;
}

// `only` lets a lane run a named subset (e.g. /vibe and /change run just the fast
// impact-scoped regression check every iteration) while still going through the
// registry — so the check's pack ownership and skip-when-absent behaviour apply
// there too, instead of the lane naming the script directly.
// lane_only checks are NOT part of the default set: they are the fast per-iteration
// complement to a heavier check that /gate already runs, so including them by default
// would run both and blur that split. They are reachable only by naming them in --only.
function selectChecks(checks, ctx) {
  const only = (ctx && ctx.only) || [];
  const scoped = only.length
    ? checks.filter((c) => only.includes(c.id))
    : checks.filter((c) => !c.lane_only);
  const tier = (ctx && ctx.tier) || 'standard';
  return scoped
    .filter((c) => triggerFires(c.when, ctx))
    .filter((c) => {
      // Checks that declare a GATE_TIERS row honor the dial. Other /gate
      // registry ids stay on their `when` trigger — they are not silent
      // pre-commit growth.
      if (!GATE_TIERS[c.id]) return true;
      return isGateEnabled(tier, c.id);
    });
}

function defaultRun(scriptPath, args, projectDir) {
  const res = spawnSync('node', [scriptPath, ...(args || [])], {
    cwd: projectDir, encoding: 'utf8', timeout: 180000,
  });
  return { code: res.status === null ? 1 : res.status, output: (res.stdout || '') + (res.stderr || '') };
}

function statusFor(code, blocking) {
  if (code === 0) return 'passed';
  return blocking ? 'blocked' : 'warn';
}

// A check declaring accepts_files receives the changed-file list; without it these
// scripts default to scanning nothing and report a false BLOCK.
function argvFor(check, changedFiles) {
  const base = check.args || [];
  if (!check.accepts_files || !changedFiles || changedFiles.length === 0) return base;
  return [...base, '--files', ...changedFiles];
}

function runChecks(checks, projectDir, { run = null, changedFiles = [] } = {}) {
  const exec = run || ((p, a) => defaultRun(p, a, projectDir));
  return checks.map((c) => {
    const scriptPath = path.join(projectDir, '.claude', 'scripts', c.script);
    const base = { id: c.id, pack: c.pack, blocking: !!c.blocking };
    if (!fs.existsSync(scriptPath)) {
      return { ...base, status: 'skipped', detail: `"${c.pack}" pack not installed (${c.script} absent)` };
    }
    const started = Date.now();
    const { code, output } = exec(scriptPath, argvFor(c, changedFiles));
    const status = statusFor(code, c.blocking);
    // Bite ledger: every check records ran/blocked/elapsed so a check that never
    // fires — or fires constantly without catching anything — becomes visible.
    recordOutcome(projectDir, {
      sensor: c.id, ran: true, blocked: status === 'blocked',
      surface: 'integration', elapsedMs: Date.now() - started,
    });
    const detail = status === 'passed' ? '' : (c.remediation || output.slice(0, 400));
    return { ...base, status, detail };
  });
}

function summarize(results) {
  if (!Array.isArray(results) || results.length === 0) {
    // A runner that reports "green" on zero checks is worse than no runner: a
    // mis-wired registry path would read as a clean gate.
    throw new Error('run-gate-checks: no checks were run — refusing to report a vacuous pass');
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    pass: !results.some((r) => r.status === 'blocked'),
    passed: count('passed'),
    blocked: count('blocked'),
    warn: count('warn'),
    skipped: count('skipped'),
  };
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

function argList(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
  return out;
}

function report(results, summary, label = 'gate-checks') {
  for (const r of results) {
    const mark = { passed: 'ok  ', blocked: 'BLOCK', warn: 'warn', skipped: 'skip' }[r.status];
    console.log(`  ${mark}  ${r.id.padEnd(28)} [${r.pack}]${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`);
  }
  console.log(
    `${label}: ${summary.passed} passed, ${summary.blocked} blocked, ` +
    `${summary.warn} warn, ${summary.skipped} skipped`
  );
}

function resolveLane(argv) {
  const explicit = argValue(argv, '--lane');
  if (explicit === 'gate' || explicit === 'sensors') return explicit;
  if (explicit) throw new Error(`run-gate-checks: unknown --lane ${explicit} (use sensors|gate)`);
  if (argList(argv, '--only').length) return 'gate';
  return 'sensors';
}

function main(argv = process.argv.slice(2)) {
  const root = argValue(argv, '--root') || process.cwd();
  const changedFiles = argList(argv, '--files');
  const only = argList(argv, '--only');
  const lane = resolveLane(argv);

  if (lane === 'sensors') {
    const { results, summary } = runSensorCatalog(root, {
      files: changedFiles.length ? changedFiles : undefined,
    });
    if (!results.length) {
      throw new Error('run-gate-checks: no sensors were run — refusing to report a vacuous pass');
    }
    const out = { schema_version: 1, lane: 'sensors', summary, results };
    fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(root, SENSOR_OUT_REL), JSON.stringify(out, null, 2) + '\n');
    if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
    else report(results, summary, 'sensor-checks');
    return summary.pass ? 0 : 1;
  }

  const checks = selectChecks(loadRegistry(root), {
    hasCodeGraph: isBrownfieldGraphReal(root),
    changedFiles,
    projectDir: root,
    only,
    tier: loadSensorTier(root),
  });
  const results = runChecks(checks, root, { changedFiles });
  const summary = summarize(results);
  const out = { schema_version: 1, lane: 'gate', summary, results };
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, OUT_REL), JSON.stringify(out, null, 2) + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else report(results, summary, 'gate-checks');
  return summary.pass ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { selectChecks, runChecks, summarize, triggerFires, globMatch, loadRegistry, resolveLane };
