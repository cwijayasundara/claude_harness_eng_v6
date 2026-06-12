'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, before, after } = require('node:test');
const { execFileSync } = require('child_process');

const { runClaude, HARNESS_ROOT } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');

const RESULTS_DIR = path.join(__dirname, 'results');
const PROJECT_DIR = path.join(__dirname, 'real-workflow-output');

function logResult(stage, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `real-${stage}.json`), JSON.stringify(data, null, 2));
}

function exists(rel) {
  return fs.existsSync(path.join(PROJECT_DIR, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(PROJECT_DIR, rel), 'utf8');
}

function listFiles(rel, predicate = () => true) {
  const dir = path.join(PROJECT_DIR, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(predicate);
}

function assertArtifact(rel, label) {
  assert.ok(exists(rel), `${label} must exist at ${rel}`);
  assert.ok(read(rel).trim().length > 0, `${label} must not be empty`);
}

describe('Harness E2E — Real Workflow Certification', { timeout: 1800000 }, () => {
  before(() => {
    fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    execFileSync('git', ['init'], { cwd: PROJECT_DIR, stdio: 'ignore' });
  });

  after(() => {
    console.log('[real-e2e] Artifacts saved to:', PROJECT_DIR);
  });

  test('scaffold, planning, design, and lite build run through harness commands', { timeout: 1500000 }, () => {
    const pluginDir = path.join(HARNESS_ROOT, '..', '.claude');
    const sessionId = require('crypto').randomUUID();

    runClaude('/scaffold', {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '1.00',
      timeoutMs: 90000,
      pluginDir,
      sessionId,
    });

    const scaffold = runClaude(
      'A Node.js CLI todo application using only Node built-ins; project shape: script/CLI; ' +
        'user surface: CLI; no team integrations, no tracker, no framework packs. Accept the inferred profile option A.',
      {
        cwd: PROJECT_DIR,
        model: 'sonnet',
        budgetUsd: '3.00',
        timeoutMs: 480000,
        continueSession: true,
        pluginDir,
        sessionId,
      }
    );

    assert.ok(!scaffold.error, `scaffold must start Claude: ${scaffold.error || ''}`);
    assert.ok(exists('.claude'), 'scaffold must install .claude/');
    assertArtifact('CLAUDE.md', 'scaffolded CLAUDE.md');
    assertArtifact('project-manifest.json', 'project manifest');

    const brd = runClaude('/brd', {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '2.00',
      timeoutMs: 240000,
      continueSession: true,
      pluginDir,
      sessionId,
    });
    logResult('brd', { exitCode: brd.exitCode, signal: brd.signal });
    assertArtifact('specs/brd/brd.md', 'BRD');
    assertArtifact('specs/reviews/phase-brd-eval.json', 'BRD phase evaluation');

    const spec = runClaude('/spec', {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '2.00',
      timeoutMs: 300000,
      continueSession: true,
      pluginDir,
      sessionId,
    });
    logResult('spec', { exitCode: spec.exitCode, signal: spec.signal });
    assert.ok(listFiles('specs/stories', /^E\d+-S\d+.*\.md$/).length >= 1, 'spec must write at least one story');
    assertArtifact('features.json', 'features registry');
    assertArtifact('specs/reviews/phase-spec-eval.json', 'spec phase evaluation');

    const design = runClaude('/design', {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '2.00',
      timeoutMs: 300000,
      continueSession: true,
      pluginDir,
      sessionId,
    });
    logResult('design', { exitCode: design.exitCode, signal: design.signal });
    assertArtifact('specs/design/component-map.md', 'component map');
    assertArtifact('specs/design/api-contracts.md', 'API contracts');
    assertArtifact('specs/reviews/phase-design-eval.json', 'design phase evaluation');

    const build = runClaude('/build --lite implement the approved Node.js CLI todo app with add, list, complete, and delete commands', {
      cwd: PROJECT_DIR,
      model: 'sonnet',
      budgetUsd: '4.00',
      timeoutMs: 420000,
      continueSession: true,
      pluginDir,
      sessionId,
    });
    logResult('build-lite', { exitCode: build.exitCode, signal: build.signal });

    const suite = runProjectSuite(PROJECT_DIR);
    logResult('project-suite', { status: suite.status, out: suite.out });
    assert.strictEqual(suite.status, 0, `generated project test suite must pass:\n${suite.out}`);
  });
});
