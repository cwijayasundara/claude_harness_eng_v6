'use strict';

// Run a generated project's OWN test suite, whatever stack it was built in.
//
// `project-suite.js` runs `npm test` at the root, which is right for the small
// single-module fixtures the older routes build and wrong for anything the
// harness scaffolds from a real PRD: a FastAPI backend plus a Next.js frontend
// has no root package.json at all. Left unfixed, a multi-hour build ends in
// "no package.json" and reads as a red suite.
//
// The commands are not guessed. `/scaffold` records the stack per component in
// project-manifest.json (`stack.backend.test_runner`, `package_manager`, …) and
// writes the same commands into each component's CLAUDE.md; this reads the
// manifest, which is the machine-readable half of that pair.
//
// A runner that finds nothing to run reports `status: null`, never 0. "No tests
// were run" and "the tests passed" must not be the same answer.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NON_COMPONENT_KEYS = new Set(['database', 'cache', 'queue', 'infrastructure']);

function readManifest(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); }
  catch (_) { return null; }
}

function hasTestScript(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts && pkg.scripts.test);
  } catch (_) { return false; }
}

/**
 * The command a component's stack implies, or null if there is nothing to run.
 *
 * The manifest's `test_runner` is the preferred signal, but it is not always
 * written: a real scaffold of this PRD recorded `test_runner: pytest` for the
 * backend and NO runner at all for the Next.js frontend. Requiring the declared
 * key would have silently dropped half the product from the verdict — a build
 * reporting green having never run the frontend suite. A package.json `test`
 * script is itself a declaration that a suite exists, so it counts too.
 *
 * The inference runs one way only. A JS test script is unambiguous; there is no
 * equivalent marker for pytest, so Python still needs the manifest to say so.
 */
function commandFor(stack, dir) {
  const runner = String((stack && stack.test_runner) || '').toLowerCase();
  const manager = String((stack && stack.package_manager) || '').toLowerCase();

  if (runner === 'pytest') {
    if (manager === 'uv') return ['uv', 'run', 'pytest', '-x', '-q'];
    if (manager === 'poetry') return ['poetry', 'run', 'pytest', '-x', '-q'];
    return ['python', '-m', 'pytest', '-x', '-q'];
  }
  if (runner && runner !== 'pytest' && !hasTestScript(dir)) return null;
  // vitest / jest / node:test are all wired through the package's test script;
  // running the binary directly would bypass the setup the scaffold put there.
  if (!hasTestScript(dir)) return null;
  return manager === 'pnpm' ? ['pnpm', 'test'] : (manager === 'yarn' ? ['yarn', 'test'] : ['npm', 'test', '--silent']);
}

/**
 * Every component of this project that has a runnable suite, plus the ones that
 * do not. A component present on disk with no suite is REPORTED, not hidden:
 * "the frontend has no tests" and "the frontend passed" must look different.
 */
function componentPlan(root) {
  const manifest = readManifest(root);
  const stack = (manifest && manifest.stack) || {};
  const suites = [];
  const skipped = [];

  for (const name of Object.keys(stack)) {
    if (NON_COMPONENT_KEYS.has(name)) continue;
    const dir = path.join(root, name);
    if (!fs.existsSync(dir)) continue;
    const command = commandFor(stack[name], dir);
    if (command) suites.push({ name, dir, command });
    else skipped.push(name);
  }
  if (suites.length) return { suites, skipped };
  return { suites: rootSuite(root, stack), skipped };
}

/** Backwards-compatible view: just the runnable suites. */
function componentSuites(root) {
  return componentPlan(root).suites;
}

function rootSuite(root, stack) {

  // Single-module project (or no manifest): the root is the component.
  const rootStack = Object.values(stack).find((s) => s && s.test_runner);
  const command = commandFor(rootStack, root) || (hasTestScript(root) ? ['npm', 'test', '--silent'] : null);
  return command ? [{ name: '.', dir: root, command }] : [];
}

/**
 * The exit code a spawn result means.
 *
 * A missing binary, a timeout kill, or a null status is a RED suite, not a
 * skipped one — silently passing over a test runner that never ran is how a
 * build reports green having tested nothing.
 */
function exitCodeOf(run) {
  if (run.error) return run.error.code === 'ENOENT' ? 127 : 1;
  if (run.signal) return 1;
  return run.status == null ? 1 : run.status;
}

function runManifestSuite(root, timeoutMs = 900000) {
  const { suites, skipped } = componentPlan(root);
  if (!suites.length) {
    return {
      status: null, ran: [], skipped,
      out: `no runnable suite found (no manifest stack, no root test script)`
        + (skipped.length ? `\ncomponents present with no suite: ${skipped.join(', ')}` : ''),
    };
  }

  const ran = [];
  const chunks = [];
  let status = 0;
  const perSuite = Math.max(60000, Math.floor(timeoutMs / suites.length));

  for (const suite of suites) {
    const [cmd, ...args] = suite.command;
    const run = spawnSync(cmd, args, { cwd: suite.dir, encoding: 'utf8', timeout: perSuite });
    const code = exitCodeOf(run);
    ran.push({ name: suite.name, command: suite.command.join(' '), status: code });
    chunks.push(`--- ${suite.name}: ${suite.command.join(' ')} (exit ${code}) ---\n`
      + `${(run.stdout || '') + (run.stderr || '') + (run.error ? run.error.message : '')}`.slice(-4000));
    if (code !== 0) status = code || 1;
  }

  if (skipped.length) {
    chunks.push(`NOTE: component(s) present with no runnable suite: ${skipped.join(', ')} — `
      + 'this verdict does not cover them.');
  }
  return { status, ran, skipped, out: chunks.join('\n') };
}

module.exports = { runManifestSuite, componentSuites, componentPlan, commandFor, exitCodeOf };
