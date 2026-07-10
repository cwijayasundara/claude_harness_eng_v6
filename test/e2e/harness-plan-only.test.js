'use strict';

// ── Plan-only Smoke (local /specs inspection) ───────────────────────────────
// Runs the ARCHITECT half of the pipeline from a PRD and stops: scaffold →
// /build --autonomous --plan-only. Produces specs/ (BRD, stories + dependency
// graph, design, test plan) for a human to eyeball — no code, no PR, no tracker.
// This is the cheap "is the plan good?" check before any semi-/full-auto run.
//
// Runs LIVE `claude -p`; costs tokens; NOT part of `npm test`. Run with
// `npm run plan`. Static contract: ../test/plan-only-contract.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { summarizeSpecs, formatSummary } = require('./helpers/specs-summary');

const PROJECT_DIR = path.join(__dirname, 'plan-output');
const SAMPLE_PRD = path.join(__dirname, 'fixtures', 'sample-prd.md');
const HARNESS_PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const { randomUUID } = require('crypto');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION_ID = randomUUID();

function resetProject() {
  const resolved = path.resolve(PROJECT_DIR);
  if (!resolved.startsWith(__dirname + path.sep)) {
    throw new Error(`refusing to wipe ${resolved}: outside ${__dirname}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  execFileSync('git', ['init'], { cwd: resolved, stdio: 'ignore' });
  fs.copyFileSync(SAMPLE_PRD, path.join(resolved, 'prd.md'));
}

test('plan-only: PRD -> specs/ for inspection (no code, no PR)', { timeout: 1200000 }, async (t) => {
  resetProject();
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: HARNESS_PLUGIN_DIR, sessionId: SESSION_ID };

  const scaffold = runClaude(
    '/scaffold --yes a Node.js bookmarks CLI from prd.md; CLI surface; no team integrations, no tracker, no framework packs',
    { ...opts, budgetUsd: '3.00', timeoutMs: 300000 },
  );
  console.log('[plan] scaffold exit:', scaffold.exitCode);
  assert.ok(
    fs.existsSync(path.join(PROJECT_DIR, 'project-manifest.json'))
      || fs.existsSync(path.join(PROJECT_DIR, 'CLAUDE.md')),
    'scaffold must install harness before /build',
  );

  const plan = runClaude('/build --autonomous --plan-only prd.md', {
    ...opts, continueSession: true, budgetUsd: '6.00', timeoutMs: 900000,
  });
  console.log('[plan] build --plan-only exit:', plan.exitCode);

  const summary = summarizeSpecs(PROJECT_DIR);
  t.after(() => console.log(`\n${formatSummary(PROJECT_DIR, summary)}\n→ inspect: ${PROJECT_DIR}/specs`));

  // The plan must exist and decompose into clusters — that is what the per-cluster
  // fan-out (semi-/full-auto) keys off. No code or PR should appear.
  assert.strictEqual(summary.present.brd, true, 'BRD must be generated');
  assert.strictEqual(summary.present.dependencyGraph, true, 'dependency graph must be generated');
  assert.ok(summary.clusters >= 1, `expected >=1 cluster, got ${summary.clusters}`);
  assert.ok(summary.stories >= 1, `expected >=1 story, got ${summary.stories}`);
});
