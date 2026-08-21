'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const {
  runManifestSuite, componentSuites, componentPlan, commandFor, exitCodeOf,
} = require('./manifest-suite');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-manifest-suite-')); }

function write(root, rel, body) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

/** The shortlink shape: uv/pytest backend, npm/vitest frontend, postgres. */
function twoComponentProject() {
  const root = tmp();
  write(root, 'project-manifest.json', {
    stack: {
      backend: { language: 'python', package_manager: 'uv', test_runner: 'pytest' },
      frontend: { language: 'typescript', package_manager: 'npm', test_runner: 'vitest' },
      database: { primary: 'postgres:16' },
    },
  });
  write(root, path.join('backend', 'pyproject.toml'), '[project]\n');
  write(root, path.join('frontend', 'package.json'), { scripts: { test: 'vitest run' } });
  return root;
}

test('derives one suite per component that exists, skipping the database', () => {
  const suites = componentSuites(twoComponentProject());
  assert.deepStrictEqual(suites.map((s) => s.name), ['backend', 'frontend']);
  assert.deepStrictEqual(suites[0].command, ['uv', 'run', 'pytest', '-x', '-q']);
  assert.deepStrictEqual(suites[1].command, ['npm', 'test', '--silent']);
});

test('a declared component with no directory on disk is not a suite', () => {
  const root = twoComponentProject();
  fs.rmSync(path.join(root, 'frontend'), { recursive: true });
  assert.deepStrictEqual(componentSuites(root).map((s) => s.name), ['backend']);
});

test('a JS component with no test script yields no command', () => {
  const root = twoComponentProject();
  write(root, path.join('frontend', 'package.json'), { scripts: {} });
  assert.deepStrictEqual(componentSuites(root).map((s) => s.name), ['backend']);
});

test('a JS component with a test script runs even when the manifest declares no runner', () => {
  // The real scaffold of the shortlink PRD recorded pytest for the backend and
  // NO test_runner for the Next.js frontend. Requiring the key would drop half
  // the product from the verdict while the build still reported green.
  const root = tmp();
  write(root, 'project-manifest.json', {
    stack: {
      backend: { language: 'Python', package_manager: 'uv', test_runner: 'pytest' },
      frontend: { language: 'TypeScript', framework: 'Next.js', package_manager: 'npm' },
      database: { primary: 'PostgreSQL 16' },
    },
  });
  write(root, path.join('backend', 'pyproject.toml'), '[project]\n');
  write(root, path.join('frontend', 'package.json'), { scripts: { test: 'vitest run' } });

  const plan = componentPlan(root);
  assert.deepStrictEqual(plan.suites.map((s) => s.name), ['backend', 'frontend']);
  assert.deepStrictEqual(plan.skipped, []);
});

test('a runner is never inferred for Python — only the manifest can declare it', () => {
  const root = tmp();
  write(root, 'project-manifest.json', { stack: { backend: { language: 'Python', package_manager: 'uv' } } });
  write(root, path.join('backend', 'pyproject.toml'), '[project]\n');
  write(root, path.join('backend', 'test_thing.py'), 'def test(): pass\n');
  const plan = componentPlan(root);
  assert.deepStrictEqual(plan.suites, [], 'a .py file is not proof of a runnable pytest setup');
  assert.deepStrictEqual(plan.skipped, ['backend'], 'but it must be reported, not hidden');
});

test('a component with no suite is reported alongside the verdict', () => {
  const root = tmp();
  write(root, 'project-manifest.json', {
    stack: {
      api: { package_manager: 'npm', test_runner: 'vitest' },
      web: { language: 'TypeScript', package_manager: 'npm' },
    },
  });
  write(root, path.join('api', 'package.json'), { scripts: { test: 'node -e "process.exit(0)"' } });
  write(root, path.join('web', 'package.json'), { scripts: {} });

  const run = runManifestSuite(root, 120000);
  assert.strictEqual(run.status, 0);
  assert.deepStrictEqual(run.skipped, ['web']);
  // "web has no tests" and "web passed" must not look the same in the output.
  assert.match(run.out, /no runnable suite: web/);
  assert.match(run.out, /does not cover them/);
});

test('package managers select their own runner', () => {
  const dir = tmp();
  write(dir, 'package.json', { scripts: { test: 'x' } });
  assert.deepStrictEqual(commandFor({ package_manager: 'poetry', test_runner: 'pytest' }, dir),
    ['poetry', 'run', 'pytest', '-x', '-q']);
  assert.deepStrictEqual(commandFor({ package_manager: 'pip', test_runner: 'pytest' }, dir),
    ['python', '-m', 'pytest', '-x', '-q']);
  assert.deepStrictEqual(commandFor({ package_manager: 'pnpm', test_runner: 'vitest' }, dir), ['pnpm', 'test']);

  // No declared runner: the package's own test script decides.
  assert.deepStrictEqual(commandFor({ package_manager: 'npm' }, dir), ['npm', 'test', '--silent']);
  assert.strictEqual(
    commandFor({ package_manager: 'npm' }, tmp()), null,
    'no declared runner and no test script is not a suite',
  );
});

test('falls back to the root package script when there is no manifest', () => {
  const root = tmp();
  write(root, 'package.json', { scripts: { test: 'node --test' } });
  assert.deepStrictEqual(componentSuites(root), [{ name: '.', dir: root, command: ['npm', 'test', '--silent'] }]);
});

test('a project with nothing runnable reports null, never green', () => {
  const root = tmp();
  write(root, 'README.md', '# nothing here');
  const result = runManifestSuite(root);
  assert.strictEqual(result.status, null, '"no tests were run" must not be reported as "tests passed"');
  assert.notStrictEqual(result.status, 0);
  assert.deepStrictEqual(result.ran, []);
});

test('runs every component suite and passes only when all pass', () => {
  const root = tmp();
  write(root, 'project-manifest.json', {
    stack: {
      alpha: { package_manager: 'npm', test_runner: 'vitest' },
      beta: { package_manager: 'npm', test_runner: 'vitest' },
    },
  });
  write(root, path.join('alpha', 'package.json'), { scripts: { test: 'node -e "process.exit(0)"' } });
  write(root, path.join('beta', 'package.json'), { scripts: { test: 'node -e "process.exit(0)"' } });

  const green = runManifestSuite(root, 120000);
  assert.strictEqual(green.status, 0);
  assert.deepStrictEqual(green.ran.map((r) => r.name), ['alpha', 'beta']);

  write(root, path.join('beta', 'package.json'), { scripts: { test: 'node -e "process.exit(3)"' } });
  const red = runManifestSuite(root, 120000);
  assert.notStrictEqual(red.status, 0, 'one red component must fail the whole suite');
  assert.match(red.out, /beta/);
});

test('a runner that never ran is red, not skipped', () => {
  // The three ways a suite can fail to produce a verdict. Each must be red:
  // a build whose tests never executed has not passed them.
  assert.strictEqual(exitCodeOf({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) }), 127);
  assert.strictEqual(exitCodeOf({ error: new Error('spawn failed') }), 1);
  assert.strictEqual(exitCodeOf({ signal: 'SIGTERM', status: null }), 1, 'a timeout kill is not a pass');
  assert.strictEqual(exitCodeOf({ status: null }), 1, 'no status is not a pass');
  assert.strictEqual(exitCodeOf({ status: 0 }), 0);
  assert.strictEqual(exitCodeOf({ status: 2 }), 2);
});

test('a component whose binary does not exist fails the run', () => {
  const root = tmp();
  write(root, 'project-manifest.json', {
    stack: { web: { package_manager: 'pnpm', test_runner: 'vitest' } },
  });
  write(root, path.join('web', 'package.json'), { scripts: { test: 'true' } });

  const suites = componentSuites(root);
  assert.deepStrictEqual(suites[0].command, ['pnpm', 'test']);
  // Whether pnpm exists here or not, the run must not report "nothing to do".
  const run = runManifestSuite(root, 60000);
  assert.strictEqual(run.ran.length, 1, 'the component must have been attempted');
  assert.notStrictEqual(run.status, null, 'an attempted component is never "nothing runnable"');
});
