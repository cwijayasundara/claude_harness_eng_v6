'use strict';

// The capture half of the sprint-1 baseline generator: what it keeps, what it
// refuses. The live build half is not exercised here — it costs real money.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  copyTree, snapshot, parseArgs, countSourceFiles, EXCLUDED, REQUIRED, MIN_SOURCE_FILES,
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
