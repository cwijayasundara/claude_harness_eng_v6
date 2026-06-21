'use strict';

// ── Automated E2E Self-Healing Smoke ────────────────────────────────────────
// The fast (<=20 min) full-lifecycle proof that the harness engine is wired end
// to end — and that it can EXTEND code it already generated. Unlike the 90-min
// certification suite, this is a single smoke with a browser oracle and a fix
// loop. It runs LIVE `claude -p` and costs tokens, so it is NOT part of
// `npm test`; run it deliberately with `npm run smoke`. The cheap static
// contract lives in ../test/automated-e2e-contract.test.js.
//
// Flow:
//   1. /scaffold            harness into a fresh temp dir
//   2. /build --lite        generate a tiny counter web app (server + page + tests)
//   3. verify v1 (browser)  click increment -> count = 1     [fix loop on failure]
//   4. /change              add a decrement button to the GENERATED code
//   5. verify v2 (browser)  decrement works AND increment still works (regression)
//
// The browser is the independent oracle (not the generator grading itself) — the
// property that distinguishes this from Devin-style self-judged verification.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { runClaude } = require('../test/e2e/helpers/claude-runner');
const { startApp, stopApp, assertInBrowser, DEFAULT_PORT } = require('./helpers/app-runtime');

const PROJECT_DIR = path.join(__dirname, 'smoke-output');
const SHOTS_DIR = path.join(__dirname, 'screenshots');
const HARNESS_PLUGIN_DIR = path.join(__dirname, '..', '.claude');
const SESSION_ID = 'auto-e2e-smoke-0001';
const MAX_FIX_ATTEMPTS = 3;

function logResult(label, data) {
  console.log(`[smoke] ${label}:`, JSON.stringify(data));
}

// Base run options shared by every claude invocation here (scaffold/build/change).
function claudeOpts() {
  return { cwd: PROJECT_DIR, model: 'sonnet', budgetUsd: '3.00', timeoutMs: 420000, continueSession: true, pluginDir: HARNESS_PLUGIN_DIR, sessionId: SESSION_ID };
}

// Repair grounded in the actual failure — never a bypass prompt. Routes through
// /change so the harness's reviewer + test gates run on the fix.
function requestRepair(fixGoal, diagnostics) {
  return runClaude(
    `/change a browser end-to-end check failed for the existing counter web app. Goal: ${fixGoal}. ` +
      `Fix the generated code so the check passes; keep all currently working behavior intact.\n${diagnostics}`,
    claudeOpts(),
  );
}

// One attempt: boot the app, run the browser assertion, tear down. Returns a
// uniform result whether the failure was a boot failure or an assertion failure.
async function attemptVerify(label, steps, attempt) {
  let app;
  try {
    app = await startApp(PROJECT_DIR, { port: DEFAULT_PORT });
  } catch (startErr) {
    return { ok: false, error: `app never booted: ${String(startErr.message).slice(0, 600)}`, consoleErrors: [] };
  }
  const shot = path.join(SHOTS_DIR, `${label}-attempt-${attempt}.png`);
  const result = await assertInBrowser(app.baseUrl, steps, { screenshotPath: shot });
  stopApp(app);
  return result;
}

// Self-healing verify: retry attemptVerify up to MAX_FIX_ATTEMPTS, feeding the
// concrete diagnostics back to /change between tries. GAN evaluator pattern at
// the whole-app level.
async function verifyWithFix({ label, steps, fixGoal }) {
  for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    const result = await attemptVerify(label, steps, attempt);
    logResult(`${label}-attempt-${attempt}`, { ok: result.ok, error: result.error, consoleErrors: result.consoleErrors });
    if (result.ok) return { ok: true, attempts: attempt };
    if (attempt === MAX_FIX_ATTEMPTS) return { ok: false, reason: result.error, consoleErrors: result.consoleErrors };
    const diagnostics = `Failing assertion: ${result.error || '(none)'}\nBrowser console errors: ${(result.consoleErrors || []).join(' | ') || '(none)'}`;
    const repair = requestRepair(fixGoal, diagnostics);
    logResult(`${label}-repair-${attempt}`, { exitCode: repair.exitCode, signal: repair.signal });
  }
  return { ok: false, reason: 'exhausted fix attempts' };
}

function scaffoldAndBuild() {
  // Confinement guard: never rm a path outside this package, even if a future
  // change makes PROJECT_DIR configurable.
  const resolved = path.resolve(PROJECT_DIR);
  if (!resolved.startsWith(__dirname + path.sep)) {
    throw new Error(`refusing to wipe ${resolved}: outside ${__dirname}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });

  const scaffold = runClaude('/scaffold', { ...claudeOpts(), continueSession: false, budgetUsd: '2.00', timeoutMs: 300000 });
  logResult('scaffold', { exitCode: scaffold.exitCode });

  const buildGoal =
    'a minimal counter web app in Node.js with NO external runtime deps: an HTTP server in server.js ' +
    'that listens on process.env.PORT and serves one HTML page; the page shows a count (element id="count" ' +
    'starting at 0) and an Increment button (id="increment") that increases the count by 1. ' +
    'package.json must have "start": "node server.js" and a passing "test" script.';
  const build = runClaude(`/build --lite implement ${buildGoal}`, { ...claudeOpts(), budgetUsd: '5.00', timeoutMs: 600000 });
  logResult('build-lite', { exitCode: build.exitCode });
}

test('full lifecycle: scaffold -> build -> verify -> modify -> regression (self-healing)', { timeout: 1200000 }, async (t) => {
  t.after(() => logResult('done', { artifacts: PROJECT_DIR, screenshots: SHOTS_DIR }));

  scaffoldAndBuild();

  // Verify v1: increment works.
  const v1 = await verifyWithFix({
    label: 'v1-increment',
    fixGoal: 'clicking #increment raises #count from 0 to 1',
    steps: async (page) => {
      await page.click('#increment');
      await page.waitForFunction(() => document.querySelector('#count')?.textContent.trim() === '1', { timeout: 5000 });
    },
  });
  assert.ok(v1.ok, `v1 increment must pass within ${MAX_FIX_ATTEMPTS} attempts: ${JSON.stringify(v1)}`);

  // Modify already-generated code: add a decrement button via /change.
  const change = runClaude(
    '/change add a Decrement button (id="decrement") to the existing counter web app that lowers #count by 1; ' +
      'keep the existing Increment behavior unchanged',
    { ...claudeOpts(), budgetUsd: '4.00', timeoutMs: 480000 },
  );
  logResult('change-decrement', { exitCode: change.exitCode });

  // Verify v2: decrement works AND increment still works (regression).
  const v2 = await verifyWithFix({
    label: 'v2-decrement-regression',
    fixGoal: 'clicking #decrement lowers #count, and #increment still raises it (no regression)',
    steps: async (page) => {
      await page.click('#increment'); // regression: original feature still works
      await page.waitForFunction(() => document.querySelector('#count')?.textContent.trim() === '1', { timeout: 5000 });
      await page.click('#decrement'); // new feature
      await page.waitForFunction(() => document.querySelector('#count')?.textContent.trim() === '0', { timeout: 5000 });
    },
  });
  assert.ok(v2.ok, `v2 decrement+regression must pass within ${MAX_FIX_ATTEMPTS} attempts: ${JSON.stringify(v2)}`);
});
