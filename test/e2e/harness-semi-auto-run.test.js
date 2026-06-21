'use strict';

// Live e2e — MODE 2: local semi-auto. `/build --autonomous` plans, then PAUSES at
// the single consolidated plan-approval gate (Phase 3.5). Headless there is no
// human to approve, so the observable contract is: the plan is produced AND the
// run asks for approval — it does NOT silently build (that is what `--auto` does).
//
// LIVE: runs real `claude -p`, costs tokens, NOT in `npm test`. Run: `npm run test:semi`.

const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { summarizeSpecs, formatSummary } = require('./helpers/specs-summary');
const { freshProject } = require('./helpers/fresh-project');

const PROJECT_DIR = path.join(__dirname, 'semi-auto-output');
const PRD = path.join(__dirname, 'fixtures', 'counter-prd.md');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const SESSION = 'e2e-semi-0001';

test('semi-auto: PRD -> plan, then pause at the approval gate (no silent build)', { timeout: 1800000 }, (t) => {
  freshProject(PROJECT_DIR, PRD);
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold', { ...opts, budgetUsd: '2.00', timeoutMs: 300000 });
  console.log('[semi] scaffold exit:', scaffold.exitCode);

  const build = runClaude('/build --autonomous prd.md', { ...opts, continueSession: true, budgetUsd: '8.00', timeoutMs: 1200000 });
  const out = (build.stdout || '') + (build.stderr || '');
  console.log('[semi] build --autonomous exit:', build.exitCode);

  const summary = summarizeSpecs(PROJECT_DIR);
  t.after(() => console.log('[semi]\n' + formatSummary(PROJECT_DIR, summary) + '\n→ artifacts: ' + PROJECT_DIR));

  // The plan was produced...
  assert.strictEqual(summary.present.brd, true, 'planning produced a BRD');
  assert.ok(summary.clusters >= 1, `planning produced clusters (got ${summary.clusters})`);
  // ...and it paused for approval rather than building unattended (the semi/full distinction).
  assert.match(out, /approv/i, 'semi-auto must reach the plan-approval gate (no silent build)');
});
