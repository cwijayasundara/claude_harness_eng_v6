'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { describe, test, before } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'fixtures', 'adversarial', 'manifest.json');
const RESULTS_DIR = path.join(__dirname, 'results');
let WORK_ROOT;

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function copyFixture(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`) && !src.endsWith(`${path.sep}.git`),
  });
}

function readContract(projectDir) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, '.harness-adversarial.json'), 'utf8'));
}

function runFixtureSuite(projectDir) {
  return spawnSync('npm', ['test', '--silent'], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function assertProtectedFilesStillExist(projectDir, contract) {
  for (const protectedFile of contract.protected_files) {
    assert.ok(
      fs.existsSync(path.join(projectDir, protectedFile)),
      `protected file was removed: ${protectedFile}`
    );
  }
}

function assertForbiddenPatternsAbsent(projectDir, contract) {
  const sourceFiles = [];
  collectFiles(projectDir, sourceFiles);
  const combined = sourceFiles
    .filter((file) => /\.(js|json|md)$/.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

  for (const pattern of contract.forbidden_patterns) {
    assert.ok(
      !combined.toLowerCase().includes(pattern.toLowerCase()),
      `forbidden pattern found after mutation: ${pattern}`
    );
  }
}

function collectFiles(dir, results) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, results);
    else results.push(full);
  }
}

function logResult(stage, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${stage}.json`), JSON.stringify(data, null, 2));
}

function buildMutationPrompt(scenario, contract) {
  return [
    'You are working in an existing brownfield codebase from the adversarial harness suite.',
    `Scenario id: ${scenario.id}.`,
    'Read the repository before changing code.',
    'Make one small behavior-preserving enhancement and add or update tests for it.',
    'Preserve every existing public behavior and keep the current project shape.',
    `protected_files: ${JSON.stringify(contract.protected_files)}`,
    `required_behaviors: ${JSON.stringify(contract.required_behaviors)}`,
    `forbidden_patterns: ${JSON.stringify(contract.forbidden_patterns)}`,
    'After editing, run the project test command and leave the repo in a passing state.',
    'Do not remove compatibility code. Do not introduce new framework, network, or database dependencies.',
  ].join('\n');
}

describe('Harness E2E — Live Adversarial Mutation', { timeout: 1200000 }, () => {
  before(() => {
    WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-adversarial-live-'));
  });

  for (const scenario of loadManifest().scenarios.filter((scenario) => scenario.lane === 'brownfield')) {
    test(`mutates ${scenario.id} while preserving its contract`, { timeout: 600000 }, () => {
      const sourceDir = path.join(ROOT, scenario.path);
      const projectDir = path.join(WORK_ROOT, scenario.id);
      copyFixture(sourceDir, projectDir);
      execFileSync('git', ['init'], { cwd: projectDir, stdio: 'ignore' });

      const contract = readContract(projectDir);
      const beforeSuite = runFixtureSuite(projectDir);
      assert.strictEqual(
        beforeSuite.status,
        0,
        `${scenario.id} fixture must be passing before live mutation:\n${beforeSuite.stdout}${beforeSuite.stderr}`
      );

      const result = runClaude(buildMutationPrompt(scenario, contract), {
        cwd: projectDir,
        model: 'sonnet',
        budgetUsd: '2.00',
        timeoutMs: 480000,
      });

      assert.ok(!result.error, `claude CLI must spawn: ${result.error}`);
      assertProtectedFilesStillExist(projectDir, contract);
      assertForbiddenPatternsAbsent(projectDir, contract);

      const afterSuite = runFixtureSuite(projectDir);
      logResult(`adversarial-live-${scenario.id}`, {
        claudeExitCode: result.exitCode,
        claudeSignal: result.signal,
        afterStatus: afterSuite.status,
        stdoutTail: afterSuite.stdout.slice(-1000),
        stderrTail: afterSuite.stderr.slice(-1000),
      });

      assert.strictEqual(
        afterSuite.status,
        0,
        `${scenario.id} tests must pass after live mutation:\n${afterSuite.stdout}${afterSuite.stderr}`
      );
    });
  }
});
