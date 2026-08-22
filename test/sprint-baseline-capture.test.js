'use strict';

// The capture half of the sprint-1 baseline generator: what it keeps, what it
// refuses. The live build half is not exercised here — it costs real money.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  copyTree, snapshot, parseArgs, countSourceFiles, startingSessions,
  EXCLUDED, REQUIRED, MIN_SOURCE_FILES,
} = require('./e2e/make-sprint1-baseline.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-baseline-')); }

function write(root, rel, body = 'x') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

/** A tree that looks like a built sprint-1 product. */
function builtProject() {
  const root = tmp();
  for (const rel of REQUIRED) write(root, rel, '# baseline\n');
  write(root, path.join('backend', 'src', 'app.py'), 'print(1)\n');
  write(root, path.join('backend', 'src', 'links.py'), 'CODE = 1\n');
  write(root, path.join('backend', 'tests', 'test_app.py'), 'def test(): pass\n');
  write(root, 'docker-compose.yml', 'services: {}\n');
  return root;
}

test('captures the product tree', () => {
  const src = builtProject();
  const out = path.join(tmp(), 'captured');
  const files = snapshot(src, out);

  assert.ok(files > 0);
  for (const rel of REQUIRED) {
    assert.ok(fs.existsSync(path.join(out, rel)), `baseline must keep ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(out, 'backend', 'src', 'app.py')), 'source must be captured');
  assert.ok(fs.existsSync(path.join(out, 'backend', 'tests', 'test_app.py')), 'the product suite must be captured');
});

test('leaves the harness control plane and dependency trees behind', () => {
  const src = builtProject();
  write(src, path.join('.claude', 'settings.json'), '{}');
  write(src, path.join('.claude', 'state', 'x'), 'x');
  write(src, 'CLAUDE.md', '# project\n');
  write(src, 'project-manifest.json', '{}');
  write(src, path.join('node_modules', 'left-pad', 'index.js'), '//');
  write(src, path.join('backend', '.venv', 'lib', 'x.py'), '#');
  write(src, path.join('frontend', '.next', 'build.js'), '//');

  const out = path.join(tmp(), 'captured');
  snapshot(src, out);

  for (const rel of ['.claude', 'CLAUDE.md', 'project-manifest.json', 'node_modules',
    path.join('backend', '.venv'), path.join('frontend', '.next')]) {
    assert.ok(!fs.existsSync(path.join(out, rel)), `${rel} must not be captured into the baseline`);
  }
  // The point of excluding the control plane: the route reinstalls a CURRENT one.
  assert.ok(fs.existsSync(path.join(out, 'backend', 'src', 'app.py')), 'exclusions must not eat the product');
});

test('refuses a source with no living design to amend', () => {
  const src = tmp();
  write(src, path.join('backend', 'src', 'app.py'), 'print(1)\n');
  assert.throws(
    () => snapshot(src, path.join(tmp(), 'captured')),
    /not a usable sprint-1 baseline — missing/,
  );
});

test('names every missing required file, not just the first', () => {
  const src = builtProject();
  fs.rmSync(path.join(src, 'specs', 'design', 'component-map.md'));
  fs.rmSync(path.join(src, 'specs', 'design', 'design-traces.json'));
  assert.throws(() => snapshot(src, path.join(tmp(), 'captured')), (err) => {
    assert.match(err.message, /component-map\.md/);
    assert.match(err.message, /design-traces\.json/);
    return true;
  });
});

test('a refused capture leaves the previous baseline untouched', () => {
  const out = path.join(tmp(), 'captured');
  snapshot(builtProject(), out);
  const bad = tmp();
  write(bad, 'README.md', 'nothing here');
  assert.throws(() => snapshot(bad, out));
  assert.ok(
    fs.existsSync(path.join(out, 'specs', 'design', 'architecture.md')),
    'a rejected source must not have already wiped the good baseline',
  );
});

test('copyTree reports what it copied', () => {
  const src = tmp();
  write(src, 'a.txt');
  write(src, path.join('sub', 'b.txt'));
  write(src, path.join('node_modules', 'c.txt'));
  assert.strictEqual(copyTree(src, path.join(tmp(), 'out')), 2);
});

test('parseArgs covers the capture modes and rejects the rest', () => {
  assert.deepStrictEqual(parseArgs([]), { from: null, snapshotOnly: false, resume: false });
  assert.strictEqual(parseArgs(['--snapshot-only']).snapshotOnly, true);
  // Resume exists because the live phases cost real money: a run that dies in
  // /design must not re-pay for /scaffold and /brd.
  assert.strictEqual(parseArgs(['--resume']).resume, true);
  const dir = tmp();
  assert.strictEqual(parseArgs(['--from', dir]).from, dir);
  assert.strictEqual(parseArgs([`--from=${dir}`]).from, dir);
  assert.throws(() => parseArgs(['--from', '/no/such/dir']), /does not exist/);
  assert.throws(() => parseArgs(['--wat']), /unknown argument/);
});

test('the exclusion list keeps the control plane out by name', () => {
  for (const name of ['.claude', 'CLAUDE.md', 'project-manifest.json', 'node_modules', '.git']) {
    assert.ok(EXCLUDED.has(name), `${name} must be excluded from the captured baseline`);
  }
  assert.ok(!EXCLUDED.has('specs'), 'the living design is the baseline — it must be captured');
});

test('the exclusion list keeps sprint 1 gate verdicts out of the baseline', () => {
  // The vacuous-pass trap this closes: the delta route asserts sprint 2 leaves
  // specs/reviews/design-grounding.json. Ship sprint 1's copy in the baseline
  // and that assertion is satisfied by a file the run never wrote.
  assert.ok(EXCLUDED.has('reviews'), 'sprint 1 gate verdicts must be re-earned, not inherited');
  // Kept, because the design these name is exactly what the amend detector
  // compares sprint 2 against.
  for (const name of ['design', 'stories', 'decisions', 'test_artefacts']) {
    assert.ok(!EXCLUDED.has(name), `specs/${name} is baseline material — it must be captured`);
  }
});

test('the exclusion list keeps build caches out but keeps lockfiles in', () => {
  assert.ok(EXCLUDED.has('tsconfig.tsbuildinfo'), 'an incremental-build cache is not baseline material');
  // A baseline with no pinned dependency versions is not a reproducible build.
  // These survive capture; the scaffold's own .gitignore drops them at commit
  // time, so the fixture is force-added.
  for (const name of ['package-lock.json', 'uv.lock']) {
    assert.ok(!EXCLUDED.has(name), `${name} pins the baseline's dependencies — it must be captured`);
  }
});

test('refuses a planning-only tree that has every spec and no product', () => {
  // The real shape this guards: a /build --plan-only run leaves a complete
  // spec set and no code. Every artifact check passes; the route then fails
  // hours into a live build.
  const src = tmp();
  for (const rel of REQUIRED) write(src, rel, '# baseline\n');
  write(src, path.join('specs', 'stories', 'E1-S1.md'), '# story\n');
  write(src, 'pyproject.toml', '[project]\n');
  assert.throws(
    () => snapshot(src, path.join(tmp(), 'captured')),
    /planning-only tree, not a built sprint-1 system/,
  );
});

test('source counting ignores the spec and doc trees', () => {
  const src = tmp();
  // Enough .py files to clear the floor — but all of them under specs/.
  for (let i = 0; i < MIN_SOURCE_FILES + 2; i += 1) {
    write(src, path.join('specs', 'design', `snippet${i}.py`), 'x = 1\n');
  }
  write(src, path.join('docs', 'example.py'), 'x = 1\n');
  assert.strictEqual(countSourceFiles(src), 0, 'spec and doc trees are not product source');

  write(src, path.join('backend', 'src', 'app.py'), 'x = 1\n');
  assert.strictEqual(countSourceFiles(src), 1);
});

test('source counting ignores dependency trees', () => {
  const src = tmp();
  for (let i = 0; i < 10; i += 1) write(src, path.join('node_modules', 'p', `f${i}.js`), '//');
  assert.strictEqual(countSourceFiles(src), 0, 'vendored code is not this project being built');
});

// ── Which sessions a run bills ──────────────────────────────────────────────
//
// A fresh run that inherits the previous run's session ids records a roughly
// DOUBLED baseline — and the expectPhases guard cannot see it, because it only
// catches phases that are missing, never a phase billed twice. freshProject()
// wipes BUILD_DIR and the log inside it, but the transcripts those sessions
// wrote live in ~/.claude/projects/<slug>/ and survive.

test('a FRESH run inherits nothing from the previous run', () => {
  const dir = tmp();
  const log = path.join(dir, 'e2e-sessions.json');
  fs.writeFileSync(log, JSON.stringify(['old-session-a', 'old-session-b']));
  assert.deepStrictEqual(startingSessions(false, log), [],
    'a non-resume run must bill only the sessions it creates');
});

test('a RESUMED run inherits the sessions it skipped', () => {
  const dir = tmp();
  const log = path.join(dir, 'e2e-sessions.json');
  fs.writeFileSync(log, JSON.stringify(['scaffold-session', 'brd-session']));
  assert.deepStrictEqual(startingSessions(true, log), ['scaffold-session', 'brd-session'],
    'without this a resumed run drops the phases it skipped from the baseline');
});

test('an unreadable or malformed session log yields nothing, never a throw', () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, 'not json');
  assert.deepStrictEqual(startingSessions(true, bad), []);
  assert.deepStrictEqual(startingSessions(true, path.join(dir, 'missing.json')), []);
  const notArray = path.join(dir, 'obj.json');
  fs.writeFileSync(notArray, JSON.stringify({ sessions: ['x'] }));
  assert.deepStrictEqual(startingSessions(true, notArray), []);
});

test('non-string entries are dropped rather than billed', () => {
  const dir = tmp();
  const log = path.join(dir, 'mixed.json');
  fs.writeFileSync(log, JSON.stringify(['good', 42, null, { id: 'x' }]));
  assert.deepStrictEqual(startingSessions(true, log), ['good']);
});

// ── The baseline must be compared, not silently replaced ────────────────────
//
// The builder used to call writeBaseline unconditionally and never compare —
// backwards for the question a re-run exists to answer. It overwrote the very
// number the run was meant to beat and reported nothing.

const { reportAgainstBaseline } = require('./e2e/make-sprint1-baseline.js');
const { writeBaseline, readBaseline, baselinePath } = require('./e2e/helpers/phase-budget.js');

function fakeBill(costUsd, turns) {
  return {
    phases: ['scaffold', 'brd', 'spec', 'design', 'test', 'auto']
      .map((command) => ({ command, runs: 1, output_tokens: 1000, subagent_output_tokens: 0, cost_usd: costUsd / 6 })),
    totals: { output_tokens: 6000, subagent_output_tokens: 0, cache_read_tokens: 0, cost_usd: costUsd },
    batching: {
      all_turns: turns, tool_calls: turns, calls_per_turn: 1.2,
      single_call_turns: turns, single_call_pct: 83, ctx_re_read_tokens: turns * 100000,
    },
    coverage: { sessions: 1, subagentFiles: 1, mainLoopOnly: false, requestedSessions: 1 },
  };
}

/** Run reportAgainstBaseline against a scratch baseline dir, capturing stdout. */
function report(bill, { update } = {}) {
  const before = process.env.HARNESS_E2E_UPDATE_BASELINE;
  const chunks = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  if (update) process.env.HARNESS_E2E_UPDATE_BASELINE = '1';
  else delete process.env.HARNESS_E2E_UPDATE_BASELINE;
  try { reportAgainstBaseline(bill); } finally {
    process.stdout.write = write;
    if (before === undefined) delete process.env.HARNESS_E2E_UPDATE_BASELINE;
    else process.env.HARNESS_E2E_UPDATE_BASELINE = before;
  }
  return chunks.join('');
}

test('a re-run REPORTS the comparison instead of silently overwriting', (t) => {
  const committed = baselinePath('sprint1-baseline');
  const original = fs.readFileSync(committed, 'utf8');
  t.after(() => fs.writeFileSync(committed, original));

  writeBaseline('sprint1-baseline', fakeBill(47.97, 833), undefined,
    { expectPhases: ['scaffold', 'brd', 'spec', 'design', 'test', 'auto'] });

  const out = report(fakeBill(19.50, 372));
  assert.match(out, /vs committed baseline/);
  assert.match(out, /cost\s+\$47\.97 -> \$19\.50/, 'the cost delta is the headline');
  assert.match(out, /turns\s+833 -> 372/, 'turn count is what actually moves the cache bill');
  assert.match(out, /baseline left unchanged/);
  assert.strictEqual(readBaseline('sprint1-baseline').total.cost_usd, 47.97,
    'a re-run must not destroy the number it is being compared against');
});

test('HARNESS_E2E_UPDATE_BASELINE=1 re-records deliberately', (t) => {
  const committed = baselinePath('sprint1-baseline');
  const original = fs.readFileSync(committed, 'utf8');
  t.after(() => fs.writeFileSync(committed, original));

  writeBaseline('sprint1-baseline', fakeBill(47.97, 833), undefined,
    { expectPhases: ['scaffold', 'brd', 'spec', 'design', 'test', 'auto'] });
  const out = report(fakeBill(19.50, 372), { update: true });
  assert.match(out, /baseline recorded/);
  assert.strictEqual(readBaseline('sprint1-baseline').total.cost_usd, 19.5);
});

test('a regression is named, not swallowed', (t) => {
  const committed = baselinePath('sprint1-baseline');
  const original = fs.readFileSync(committed, 'utf8');
  t.after(() => fs.writeFileSync(committed, original));

  writeBaseline('sprint1-baseline', fakeBill(20.00, 400), undefined,
    { expectPhases: ['scaffold', 'brd', 'spec', 'design', 'test', 'auto'] });
  const out = report(fakeBill(60.00, 1200));
  assert.match(out, /REGRESSED/, 'a run that got worse must say so');
  assert.match(out, /regressed/, 'and the verdict line must carry the status');
});
