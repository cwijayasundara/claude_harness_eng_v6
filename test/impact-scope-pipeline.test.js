'use strict';

// Spec/contract resolution, full-pipeline composition, and CLI coverage for
// impact-scope.js (gap G16, pass 2a). See impact-scope.test.js for git
// plumbing, blast radius, and group resolution unit coverage.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'impact-scope.js');
const { resolveSpecsAndContracts, computeImpactScope, run } = require(SCRIPT);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'impact-scope-pipe-'));
}

function writeJson(dir, rel, data) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function writeText(dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

function sampleGraph() {
  return {
    nodes: [
      { id: 'py:backend/routes.py', path: 'backend/routes.py' },
      { id: 'py:backend/service.py', path: 'backend/service.py' },
      { id: 'py:backend/repo.py', path: 'backend/repo.py' },
    ],
    edges: [
      { source: 'py:backend/routes.py', target: 'py:backend/service.py', kind: 'imports' },
      { source: 'py:backend/service.py', target: 'py:backend/repo.py', kind: 'calls' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Spec + contract resolution for impacted groups
// ---------------------------------------------------------------------------

test('resolveSpecsAndContracts: a group may own multiple stories/specs; contract is one file per group', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [
      { id: 'VM-1', group: 'A', story_id: 'E1-S1', implementation_paths: [] },
      { id: 'VM-2', group: 'A', story_id: 'E1-S2', implementation_paths: [] },
    ],
  });
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec 1');
  writeText(dir, 'e2e/E1-S2.spec.ts', '// spec 2');
  writeJson(dir, 'sprint-contracts/A.json', { api_checks: [] });

  const { specs, contracts, perGroup, notes } = resolveSpecsAndContracts(dir, ['A'], {
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    e2eDir: 'e2e',
    contractsDir: 'sprint-contracts',
  });
  assert.deepStrictEqual(specs.sort(), ['e2e/E1-S1.spec.ts', 'e2e/E1-S2.spec.ts']);
  assert.deepStrictEqual(contracts, ['sprint-contracts/A.json']);
  assert.strictEqual(perGroup.length, 1);
  assert.strictEqual(perGroup[0].group, 'A');
  assert.deepStrictEqual(notes, []);
});

test('resolveSpecsAndContracts: missing spec/contract files are noted, not silently dropped', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{ id: 'VM-1', group: 'B', story_id: 'E2-S1', implementation_paths: [] }],
  });
  const { specs, contracts, notes } = resolveSpecsAndContracts(dir, ['B'], {
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    e2eDir: 'e2e',
    contractsDir: 'sprint-contracts',
  });
  assert.deepStrictEqual(specs, []);
  assert.deepStrictEqual(contracts, []);
  assert.ok(notes.some((n) => /no e2e spec found for story "E2-S1"/.test(n)));
  assert.ok(notes.some((n) => /no sprint-contract found for group "B"/.test(n)));
});

// ---------------------------------------------------------------------------
// computeImpactScope: end-to-end composition
// ---------------------------------------------------------------------------

test('computeImpactScope: explicit --changed-file input, full pipeline, degrade-loud notes preserved', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/brownfield/code-graph.json', sampleGraph());
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{ id: 'VM-1', group: 'A', story_id: 'E1-S1', implementation_paths: ['backend/repo.py'] }],
  });
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  writeJson(dir, 'sprint-contracts/A.json', { api_checks: [] });

  const result = computeImpactScope({
    root: dir,
    changedFiles: ['backend/repo.py'],
    graphPath: 'specs/brownfield/code-graph.json',
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
    e2eDir: 'e2e',
    contractsDir: 'sprint-contracts',
  });

  assert.deepStrictEqual(result.changedFiles, ['backend/repo.py']);
  assert.deepStrictEqual(result.blastRadiusFiles.sort(), ['backend/routes.py', 'backend/service.py']);
  assert.deepStrictEqual(result.impactedGroups, ['A']);
  assert.deepStrictEqual(result.specs, ['e2e/E1-S1.spec.ts']);
  assert.deepStrictEqual(result.contracts, ['sprint-contracts/A.json']);
  assert.deepStrictEqual(result.notes, []);
});

test('computeImpactScope: no code-graph.json at all degrades loudly but still resolves the changed file itself', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{ id: 'VM-1', group: 'A', story_id: 'E1-S1', implementation_paths: ['backend/repo.py'] }],
  });
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  writeJson(dir, 'sprint-contracts/A.json', { api_checks: [] });

  const result = computeImpactScope({
    root: dir,
    changedFiles: ['backend/repo.py'],
    graphPath: 'specs/brownfield/code-graph.json',
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
    e2eDir: 'e2e',
    contractsDir: 'sprint-contracts',
  });
  assert.deepStrictEqual(result.blastRadiusFiles, []);
  assert.deepStrictEqual(result.impactedGroups, ['A']);
  assert.ok(result.notes.some((n) => /no .*code-graph\.json/.test(n)));
});

test('computeImpactScope: excludeGroups keeps the current in-flight group out of scope', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{ id: 'VM-1', group: 'A', story_id: 'E1-S1', implementation_paths: ['backend/repo.py'] }],
  });
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  writeJson(dir, 'sprint-contracts/A.json', { api_checks: [] });

  const result = computeImpactScope({
    root: dir,
    changedFiles: ['backend/repo.py'],
    graphPath: 'specs/brownfield/code-graph.json',
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
    e2eDir: 'e2e',
    contractsDir: 'sprint-contracts',
    excludeGroups: ['A'],
  });
  assert.deepStrictEqual(result.impactedGroups, []);
  assert.deepStrictEqual(result.specs, []);
  assert.deepStrictEqual(result.contracts, []);
});

// ---------------------------------------------------------------------------
// CLI smoke test (run against a real tiny git repo)
// ---------------------------------------------------------------------------

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

test('CLI: --changed-file overrides git diff discovery and writes the JSON output', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{ id: 'VM-1', group: 'A', story_id: 'E1-S1', implementation_paths: ['backend/repo.py'] }],
  });
  const outPath = path.join(dir, 'out.json');
  const code = run(['--root', dir, '--changed-file', 'backend/repo.py', '--out', outPath]);
  assert.strictEqual(code, 0);
  const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(result.changedFiles, ['backend/repo.py']);
  assert.deepStrictEqual(result.impactedGroups, ['A']);
});

test('CLI: with no --changed-file, derives changed files from a real git diff against the merge-base', () => {
  const dir = tmpDir();
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'a@b.com']);
  git(dir, ['config', 'user.name', 'tester']);
  writeText(dir, 'README.md', 'base\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);
  git(dir, ['branch', '-m', 'main']);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  writeText(dir, 'backend/repo.py', 'print("changed")\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'feature change']);

  const outPath = path.join(dir, 'out.json');
  const code = run(['--root', dir, '--base-ref', 'main', '--out', outPath]);
  assert.strictEqual(code, 0);
  const result = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(result.changedFiles, ['backend/repo.py']);
});
