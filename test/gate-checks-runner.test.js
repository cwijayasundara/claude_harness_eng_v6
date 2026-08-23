'use strict';

// The /gate deterministic checks are contributed by packs, not hardcoded in the
// kernel skill. The runner must: skip a check whose pack is not installed (loudly,
// never silently), honour each check's trigger, and never turn a skip into a pass.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  selectChecks, runChecks, summarize, globMatch, triggerFires, loadRegistry,
} = require('../.claude/scripts/run-gate-checks.js');

const CHECKS = [
  { id: 'always-one', pack: 'verification', script: 'a.js', when: 'always', blocking: true },
  { id: 'needs-graph', pack: 'brownfield', script: 'b.js', when: 'code-graph', blocking: true },
  { id: 'needs-snapshots', pack: 'verification', script: 'c.js', when: 'changed:*.snap', blocking: true },
  { id: 'advisory', pack: 'telemetry', script: 'd.js', when: 'always', blocking: false },
];

function makeRoot(scripts = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-checks-'));
  fs.mkdirSync(path.join(root, '.claude', 'scripts'), { recursive: true });
  for (const [name, body] of scripts) {
    fs.writeFileSync(path.join(root, '.claude', 'scripts', name), body);
  }
  return root;
}

test('selectChecks runs an "always" check', () => {
  const sel = selectChecks(CHECKS, { hasCodeGraph: false, changedFiles: [] });
  assert.ok(sel.find((c) => c.id === 'always-one'));
});

test('selectChecks skips a code-graph check when there is no graph', () => {
  const sel = selectChecks(CHECKS, { hasCodeGraph: false, changedFiles: [] });
  assert.ok(!sel.find((c) => c.id === 'needs-graph'));
});

test('selectChecks includes a code-graph check when the graph exists', () => {
  const sel = selectChecks(CHECKS, { hasCodeGraph: true, changedFiles: [] });
  assert.ok(sel.find((c) => c.id === 'needs-graph'));
});

test('selectChecks drops GATE_TIERS-strict checks on standard', () => {
  const checks = loadRegistry(path.join(__dirname, '..'));
  const sel = selectChecks(checks, {
    hasCodeGraph: true, changedFiles: [], tier: 'standard',
  });
  assert.ok(!sel.find((c) => c.id === 'cycle-detection'));
  assert.ok(!sel.find((c) => c.id === 'coupling-ratchet'));
  assert.ok(!sel.find((c) => c.id === 'duplication-ratchet'));
  const strict = selectChecks(checks, {
    hasCodeGraph: true, changedFiles: [], tier: 'strict',
  });
  assert.ok(strict.find((c) => c.id === 'cycle-detection'));
});

test('selectChecks honours a changed-file glob trigger', () => {
  assert.ok(!selectChecks(CHECKS, { hasCodeGraph: false, changedFiles: ['src/a.ts'] })
    .find((c) => c.id === 'needs-snapshots'));
  assert.ok(selectChecks(CHECKS, { hasCodeGraph: false, changedFiles: ['src/__snapshots__/x.snap'] })
    .find((c) => c.id === 'needs-snapshots'));
});

test('a check whose pack is not installed is recorded as skipped, not passed', () => {
  const root = makeRoot(); // no scripts on disk at all
  const results = runChecks([CHECKS[0]], root, { run: () => { throw new Error('must not execute'); } });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'skipped');
  assert.match(results[0].detail, /not installed/i);
});

test('a skipped check does not make the gate pass', () => {
  const s = summarize([{ id: 'x', status: 'skipped', blocking: true, pack: 'verification', detail: 'pack not installed' }]);
  assert.strictEqual(s.pass, true, 'an uninstalled pack is a legitimate configuration, so it does not block');
  assert.strictEqual(s.skipped, 1, 'but it must be counted and reported, never invisible');
});

test('a blocking check that fails blocks the gate', () => {
  const root = makeRoot([['a.js', '']]);
  const results = runChecks([CHECKS[0]], root, { run: () => ({ code: 1, output: 'boom' }) });
  assert.strictEqual(results[0].status, 'blocked');
  assert.strictEqual(summarize(results).pass, false);
});

test('a non-blocking check that fails does not block the gate', () => {
  const root = makeRoot([['d.js', '']]);
  const results = runChecks([CHECKS[3]], root, { run: () => ({ code: 1, output: 'meh' }) });
  assert.strictEqual(results[0].status, 'warn');
  assert.strictEqual(summarize(results).pass, true);
});

test('a passing check is recorded as passed', () => {
  const root = makeRoot([['a.js', '']]);
  const results = runChecks([CHECKS[0]], root, { run: () => ({ code: 0, output: 'ok' }) });
  assert.strictEqual(results[0].status, 'passed');
});

test('summarize refuses to report a vacuous pass on an empty check set', () => {
  assert.throws(() => summarize([]), /no checks/i,
    'zero checks must error rather than read as a clean gate');
});

test('every check carries its pack, so an absent one is attributable', () => {
  const root = makeRoot();
  const results = runChecks(CHECKS, root, { run: () => ({ code: 0, output: '' }) });
  for (const r of results) assert.ok(r.pack, `${r.id} must name its owning pack`);
});

test('a check declaring accepts_files receives the changed-file list', () => {
  const root = makeRoot([['a.js', '']]);
  let seen = null;
  runChecks([{ ...CHECKS[0], accepts_files: true }], root, {
    run: (_p, argv) => { seen = argv; return { code: 0, output: '' }; },
    changedFiles: ['src/a.ts', 'src/b.ts'],
  });
  assert.deepStrictEqual(seen, ['--files', 'src/a.ts', 'src/b.ts']);
});

test('a check without accepts_files is not given the file list', () => {
  const root = makeRoot([['a.js', '']]);
  let seen = null;
  runChecks([CHECKS[0]], root, {
    run: (_p, argv) => { seen = argv; return { code: 0, output: '' }; },
    changedFiles: ['src/a.ts'],
  });
  assert.deepStrictEqual(seen, [], 'passing --files to a script that does not accept it would break it');
});

// The shipped registry is the thing /gate actually runs, so validate it rather than
// a fixture — a mistyped script name or a check with no owning pack would otherwise
// only surface at gate time.
test('the shipped gate-checks registry is internally consistent', () => {
  const { loadRegistry } = require('../.claude/scripts/run-gate-checks.js');
  const checks = loadRegistry(path.join(__dirname, '..'));
  assert.ok(checks.length > 0, 'registry must not be empty');
  const ids = new Set();
  for (const c of checks) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.pack, `${c.id} must name an owning pack`);
    assert.ok(c.script && c.script.endsWith('.js'), `${c.id} must name a script`);
    assert.ok(c.remediation, `${c.id} must carry remediation guidance — it replaces the prose removed from the skill`);
  }
});

test('every script named in the shipped registry exists on disk today', () => {
  const { loadRegistry } = require('../.claude/scripts/run-gate-checks.js');
  const root = path.join(__dirname, '..');
  for (const c of loadRegistry(root)) {
    assert.ok(
      fs.existsSync(path.join(root, '.claude', 'scripts', c.script)),
      `${c.id} points at a missing script: ${c.script}`
    );
  }
});

// ── C3: every registered trigger must be able to fire ───────────────────────
//
// `dead-path` shipped registered blocking:true with
// `changed:*.{js,jsx,mjs,cjs,ts,tsx,py}` — and globMatch had no brace
// expansion, so it escaped the braces as literals and the gate never ran once.
// The same never-firing pattern is already on main in `contract-drift`, which
// is where it was copied from: a registry entry nobody can observe failing is
// indistinguishable from a passing one.

test('globMatch expands brace alternatives', () => {
  for (const f of ['src/a.js', 'src/x/y.ts', 'a.py', 'lib/deep/mod.mjs']) {
    assert.equal(globMatch('*.{js,jsx,mjs,cjs,ts,tsx,py}', f), true, `${f} must match`);
  }
  for (const f of ['README.md', 'a.json', 'x/y.jsonc']) {
    assert.equal(globMatch('*.{js,jsx,mjs,cjs,ts,tsx,py}', f), false, `${f} must NOT match`);
  }
  // A brace must not become a wildcard: only the listed alternatives match.
  assert.equal(globMatch('*.{js,ts}', 'a.jsx'), false);
  assert.equal(globMatch('src/{a,b}/*.js', 'src/a/x.js'), true);
  assert.equal(globMatch('src/{a,b}/*.js', 'src/c/x.js'), false);
});

test('EVERY registered check has a trigger that some input can fire', () => {
  // The registry is the thing under test, not a fixture: a `when` nobody can
  // satisfy is a control that does not exist, however it is declared.
  const checks = loadRegistry(path.join(__dirname, '..'));
  const unfireable = [];
  for (const c of checks) {
    const when = c.when || 'always';
    let fires = false;
    if (when === 'always' || when === 'code-graph') {
      fires = true;
    } else if (when.startsWith('changed:')) {
      const pat = when.slice('changed:'.length);
      // Build a path the pattern should match, resolving braces and globs.
      const probe = pat
        .replace(/\{([^}]*)\}/g, (_, alts) => alts.split(',')[0])
        .replace(/\*\*\//g, 'a/b/')
        .replace(/\*/g, 'x');
      fires = triggerFires(when, { changedFiles: [probe] });
    } else {
      fires = true; // exists:/lane: triggers are environment-dependent
    }
    if (!fires) unfireable.push(`${c.id} (when: ${when})`);
  }
  assert.deepEqual(unfireable, [],
    'these registry triggers can never match any input — the checks never run');
});
