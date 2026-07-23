#!/usr/bin/env node
'use strict';

// Runs the /gate deterministic checks declared in .claude/config/gate-checks.json.
//
// Why a registry rather than a list of script names in the skill: each check belongs
// to a PACK (brownfield, verification, telemetry, ...). With the names inline, the
// kernel skill instructed the agent to run scripts that do not exist once a pack is
// uninstalled. Here an absent script is reported as `skipped: pack not installed` —
// visible and attributable, never silently dropped and never counted as a pass.
//
// Distinct from run-custom-sensors.js, which runs PROJECT-declared sensors from
// project-manifest.json#custom_sensors[]. That is the user's extension point; this is
// the harness's own shipped check set. Same mechanics, different ownership.
//
//   node .claude/scripts/run-gate-checks.js [--root <dir>] [--files a b ...] [--json]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_REL = path.join('.claude', 'config', 'gate-checks.json');
const GRAPH_REL = path.join('specs', 'brownfield', 'code-graph.json');
const OUT_REL = path.join('specs', 'reviews', 'gate-checks.json');

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

function selectChecks(checks, ctx) {
  return checks.filter((c) => triggerFires(c.when, ctx));
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
    const { code, output } = exec(scriptPath, argvFor(c, changedFiles));
    const status = statusFor(code, c.blocking);
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

function report(results, summary) {
  for (const r of results) {
    const mark = { passed: 'ok  ', blocked: 'BLOCK', warn: 'warn', skipped: 'skip' }[r.status];
    console.log(`  ${mark}  ${r.id.padEnd(28)} [${r.pack}]${r.detail ? ` — ${r.detail.split('\n')[0]}` : ''}`);
  }
  console.log(
    `gate-checks: ${summary.passed} passed, ${summary.blocked} blocked, ` +
    `${summary.warn} warn, ${summary.skipped} skipped (pack not installed)`
  );
}

function main(argv = process.argv.slice(2)) {
  const root = argValue(argv, '--root') || process.cwd();
  const changedFiles = argList(argv, '--files');
  const checks = selectChecks(loadRegistry(root), {
    hasCodeGraph: fs.existsSync(path.join(root, GRAPH_REL)),
    changedFiles,
    projectDir: root,
  });
  const results = runChecks(checks, root, { changedFiles });
  const summary = summarize(results);
  const out = { schema_version: 1, summary, results };
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, OUT_REL), JSON.stringify(out, null, 2) + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else report(results, summary);
  return summary.pass ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { selectChecks, runChecks, summarize, triggerFires, globMatch, loadRegistry };
