'use strict';

// Bootstrap is the most templatable work in a greenfield build, and in the
// 2026-08-21 sprint-1 baseline an agent did it by hand: the first story ran 208
// turns and cost $16.87 alone, much of it re-deriving tool config one turn at a
// time. These tests pin the two properties that make the deterministic version
// safe to run — it never overwrites, and it never guesses.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const {
  plan, filesFor, installCommand, keyOf, FRONTEND,
} = require('../.claude/hooks/lib/project-bootstrap.js');
const { bootstrap, writeFiles, render } = require('../.claude/scripts/scaffold-bootstrap.js');

const FULL_STACK = {
  name: 'shortlink',
  stack: {
    backend: { language: 'python', framework: 'fastapi' },
    frontend: { language: 'typescript', framework: 'next' },
  },
};

function project(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-bootstrap-'));
  if (manifest) fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(manifest));
  return dir;
}

test('a full-stack profile plans both halves', () => {
  assert.deepEqual(plan(FULL_STACK).map((s) => s.part), ['backend', 'frontend']);
});

test('an unrecognised stack plans nothing rather than guessing a framework', () => {
  assert.deepEqual(plan({ stack: { backend: { language: 'rust', framework: 'axum' } } }), []);
  assert.deepEqual(plan({ stack: { backend: { language: 'python' } } }), [],
    'a language with no framework is not enough to pick a dependency set');
  assert.deepEqual(plan({}), []);
  assert.deepEqual(plan(null), []);
});

test('keyOf is case-insensitive, as real manifests are inconsistent', () => {
  assert.equal(keyOf({ language: 'Python', framework: 'FastAPI' }), 'python/fastapi');
  assert.equal(keyOf(null), null);
});

test('the python manifest carries the framework floor and the tool config', () => {
  const [back] = plan(FULL_STACK);
  const files = filesFor(back, 'shortlink');
  const toml = files['backend/pyproject.toml'];
  for (const needle of ['fastapi>=', 'pytest>=', 'ruff>=', 'mypy>=', '[tool.ruff]', '[tool.mypy]', 'asyncio_mode']) {
    assert.ok(toml.includes(needle), `pyproject.toml must carry ${needle}`);
  }
  assert.ok(toml.includes('description = "shortlink backend"'));
  assert.ok('backend/src/__init__.py' in files && 'backend/tests/__init__.py' in files);
});

test('domain dependencies are deliberately absent — stories add those', () => {
  const toml = filesFor(plan(FULL_STACK)[0], 'shortlink')['backend/pyproject.toml'];
  for (const domain of ['argon2', 'asyncpg', 'sqlalchemy']) {
    assert.ok(!toml.includes(domain),
      `${domain} is a domain choice a story makes, not part of the bootstrap floor`);
  }
});

test('the frontend tree satisfies its own tsconfig include', () => {
  // Without an ambient-types file, tsc fails TS18003 ("no inputs were found")
  // because `include` names src and tests. That was a real defect here: the
  // first bootstrap left a project whose own `typecheck` script errored before
  // a single line of product code existed. Caught by running tsc, not by
  // checking that files exist.
  for (const key of ['typescript/react', 'typescript/next']) {
    const spec = { ...FRONTEND[key], part: 'frontend' };
    const files = filesFor(spec);
    const included = JSON.parse(files['frontend/tsconfig.json']).include;
    for (const dir of included) {
      const has = Object.keys(files).some((f) => f.startsWith(`frontend/${dir}/`));
      assert.ok(has || dir === 'tests',
        `tsconfig includes "${dir}" but ${key} emits no file under it — tsc would fail TS18003`);
    }
    assert.ok(files['frontend/src/env.d.ts'], `${key} must emit an ambient-types file`);
    assert.match(files['frontend/src/env.d.ts'], /reference types/);
  }
});

test('the frontend manifest is valid JSON carrying scripts and tool config', () => {
  const files = filesFor(plan(FULL_STACK)[1]);
  const pkg = JSON.parse(files['frontend/package.json']);
  assert.equal(pkg.name, 'frontend');
  for (const s of ['dev', 'build', 'lint', 'typecheck', 'test']) {
    assert.ok(pkg.scripts[s], `package.json must define the ${s} script`);
  }
  assert.ok(pkg.devDependencies.typescript && pkg.devDependencies.vitest && pkg.devDependencies.eslint);
  assert.doesNotThrow(() => JSON.parse(files['frontend/tsconfig.json']));
  assert.ok(files['frontend/vitest.config.ts'].includes('defineConfig'));
  assert.ok(files['frontend/eslint.config.mjs'].includes('tseslint'));
});

test('install commands match the stack', () => {
  const [back, front] = plan(FULL_STACK);
  assert.deepEqual(installCommand(back), { cwd: 'backend', command: 'uv', args: ['sync', '--all-groups'] });
  assert.equal(installCommand(front).command, 'npm');
});

// ── the two safety properties ───────────────────────────────────────────────

test('an existing manifest is never overwritten', () => {
  const dir = project(FULL_STACK);
  const kept = path.join(dir, 'backend', 'pyproject.toml');
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.writeFileSync(kept, '# a story added argon2-cffi here\n');

  const result = bootstrap(dir, { install: false });
  assert.equal(fs.readFileSync(kept, 'utf8'), '# a story added argon2-cffi here\n',
    'a re-scaffold must not discard a dependency a story added');
  assert.ok(!result.written.includes('backend/pyproject.toml'));
  assert.ok(result.written.includes('frontend/package.json'), 'absent files are still written');
});

test('an unrecognised stack writes nothing and says why', () => {
  const dir = project({ stack: { backend: { language: 'rust' } } });
  const result = bootstrap(dir, { install: false });
  assert.deepEqual(result.written, []);
  assert.match(result.skipped, /no recognised stack/);
  assert.match(render(result), /skipped/);
});

test('a project with no manifest at all degrades instead of throwing', () => {
  const result = bootstrap(project(null), { install: false });
  assert.deepEqual(result.written, []);
  assert.ok(result.skipped);
});

test('bootstrap writes the full tree for a recognised stack', () => {
  const dir = project(FULL_STACK);
  const result = bootstrap(dir, { install: false });
  for (const rel of ['backend/pyproject.toml', 'frontend/package.json',
    'frontend/tsconfig.json', 'frontend/vitest.config.ts', 'frontend/eslint.config.mjs']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `${rel} must exist after bootstrap`);
  }
  assert.equal(result.installs.length, 0, '--no-install must not shell out');
});

test('a failed install is reported as skipped, never as success', () => {
  const dir = project({ name: 'x', stack: { backend: { language: 'python', framework: 'fastapi' } } });
  // Seed a manifest uv cannot resolve BEFORE bootstrap runs. bootstrap never
  // overwrites, so this is the file the install sees, and the failure is
  // deterministic — no network, and no branch that can skip the assertions.
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backend', 'pyproject.toml'), 'this is not valid toml [[[\n');

  const result = bootstrap(dir, { install: true, timeoutMs: 120000 });
  const [install] = result.installs;
  assert.ok(install, 'an install attempt must be recorded');
  assert.equal(install.installed, false, 'an unresolvable manifest must not report a warm toolchain');
  assert.ok(install.reason, 'a skipped install must carry a reason');
  assert.match(render(result), /install SKIPPED/);
  assert.match(render(result), /pay for it instead/,
    'the operator must be told the cost moves into an agent, not that it vanished');
});

test('render names an all-present tree as such rather than implying work was done', () => {
  const dir = project(FULL_STACK);
  bootstrap(dir, { install: false });
  assert.match(render(bootstrap(dir, { install: false })), /wrote nothing/);
});

test('writeFiles reports exactly the paths it created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-files-'));
  assert.deepEqual(writeFiles(dir, { 'a/b.txt': 'x' }), ['a/b.txt']);
  assert.deepEqual(writeFiles(dir, { 'a/b.txt': 'y' }), [], 'a second pass creates nothing');
  assert.equal(fs.readFileSync(path.join(dir, 'a', 'b.txt'), 'utf8'), 'x');
});

// ── wiring: bootstrap must actually run as part of /scaffold ────────────────

test('scaffold-apply runs the bootstrap and reports it', () => {
  const { applyScaffold } = require('../.claude/scripts/scaffold-apply.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-wire-'));
  const profilePath = path.join(dir, 'profile.json');
  fs.writeFileSync(profilePath, JSON.stringify({
    name: 'shortlink', projectType: 'D',
    stack: {
      backend: { language: 'python', framework: 'fastapi' },
      frontend: { language: 'typescript', framework: 'react' },
      database: null,
    },
  }));
  const target = path.join(dir, 'project');
  const result = applyScaffold({
    installDeps: false, profile: profilePath,
    pluginSource: path.join(__dirname, '..', '.claude'), target, scaffoldProfile: 'core',
  });
  assert.ok(result.bootstrap, 'applyScaffold must report what the bootstrap did');
  assert.ok(fs.existsSync(path.join(target, 'backend', 'pyproject.toml')),
    'a scaffolded project must arrive with its dependency manifest — the first story should not own bootstrap');
  assert.ok(fs.existsSync(path.join(target, 'frontend', 'package.json')));
  assert.ok(result.written.includes('backend/pyproject.toml'));
});

test('the production default installs; only an explicit flag skips it', () => {
  // The install is the half that keeps `uv sync` out of an implementer's turn,
  // where a multi-minute wait expires its 5-minute cache. A default of "skip"
  // would leave the manifests written and the cost exactly where it was.
  const { parseArgs } = require('../.claude/scripts/scaffold-apply.js');
  assert.equal(parseArgs([]).installDeps, undefined, 'absent means install (=== false is the only skip)');
  assert.equal(parseArgs(['--no-install-deps']).installDeps, false);
});
