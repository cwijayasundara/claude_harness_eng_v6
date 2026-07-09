'use strict';

// Deterministic Test Impact Analysis (gap G16, pass 2a). Closes the "no local
// signal" hole left after G15: regression-gate.js (G15) only proves itself at
// merge time (/gate, /auto pre-merge) by running the WHOLE accumulated e2e/
// suite + every prior sprint contract — too expensive to run on every /change
// or /vibe iteration. impact-scope.js computes, mechanically and without an
// LLM, which specs/contracts a diff could plausibly have broken: changed
// files -> reverse-dependency (blast-radius) closure over code-graph.json's
// imports/calls edges -> owning story-group(s) (verification-matrix.json
// primary, component-map.md + features.json fallback) -> e2e spec(s) +
// sprint-contract. local-regression-gate.js composes this with
// hooks/lib/regression-gate.js's primitives to run only that subset.
//
// This file covers: git plumbing, blast radius, and group resolution. Spec/
// contract resolution + full-pipeline/CLI coverage lives in
// impact-scope-pipeline.test.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'impact-scope.js');
const {
  resolveDefaultBranch,
  resolveBaseRef,
  gitChangedFiles,
  computeBlastRadius,
  parseComponentMapStoryFiles,
  resolveGroupsForFiles,
} = require(SCRIPT);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'impact-scope-'));
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

// ---------------------------------------------------------------------------
// git plumbing (dependency-injected exec, like ownership-check.js's stagedFiles)
// ---------------------------------------------------------------------------

function fakeExec(script) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    if (!(key in script)) throw new Error(`fakeExec: no stub for "${key}"`);
    const v = script[key];
    if (v instanceof Error) throw v;
    return v;
  };
}

test('resolveDefaultBranch: prefers origin/HEAD symbolic-ref', () => {
  const exec = fakeExec({ 'git symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n' });
  assert.strictEqual(resolveDefaultBranch(exec), 'origin/main');
});

test('resolveDefaultBranch: falls back to first verifiable candidate when symbolic-ref fails', () => {
  const exec = fakeExec({
    'git symbolic-ref refs/remotes/origin/HEAD': new Error('no such ref'),
    'git rev-parse --verify origin/main': new Error('not found'),
    'git rev-parse --verify origin/master': 'abc123\n',
  });
  assert.strictEqual(resolveDefaultBranch(exec), 'origin/master');
});

test('resolveBaseRef: explicit --base-ref wins over auto-resolution', () => {
  const exec = fakeExec({});
  assert.strictEqual(resolveBaseRef(exec, 'deadbeef'), 'deadbeef');
});

test('resolveBaseRef: auto-resolves merge-base with the default branch', () => {
  const exec = fakeExec({
    'git symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n',
    'git merge-base HEAD origin/main': 'cafef00d\n',
  });
  assert.strictEqual(resolveBaseRef(exec, undefined), 'cafef00d');
});

test('gitChangedFiles: parses newline-separated diff --name-only output', () => {
  const exec = fakeExec({ 'git diff --name-only base-ref': 'a/b.py\nc/d.ts\n\n' });
  assert.deepStrictEqual(gitChangedFiles(exec, 'base-ref'), ['a/b.py', 'c/d.ts']);
});

// ---------------------------------------------------------------------------
// Blast radius: reverse-dependency closure over imports/calls edges
// ---------------------------------------------------------------------------

function sampleGraph() {
  // routes.py imports service.py; service.py imports repo.py.
  // Changing repo.py should blast-radius to service.py and routes.py.
  return {
    nodes: [
      { id: 'py:backend/routes.py', path: 'backend/routes.py' },
      { id: 'py:backend/service.py', path: 'backend/service.py' },
      { id: 'py:backend/repo.py', path: 'backend/repo.py' },
      { id: 'py:backend/unrelated.py', path: 'backend/unrelated.py' },
    ],
    edges: [
      { source: 'py:backend/routes.py', target: 'py:backend/service.py', kind: 'imports' },
      { source: 'py:backend/service.py', target: 'py:backend/repo.py', kind: 'calls' },
      { source: 'py:backend/unrelated.py', target: 'py:backend/repo.py', kind: 'renders' }, // not a blast-radius kind
    ],
  };
}

test('computeBlastRadius: transitive reverse closure over imports+calls, excludes non-blast-radius edge kinds', () => {
  const { blastRadiusFiles, notes } = computeBlastRadius(sampleGraph(), ['backend/repo.py']);
  assert.deepStrictEqual(blastRadiusFiles, ['backend/routes.py', 'backend/service.py']);
  assert.deepStrictEqual(notes, []);
});

test('computeBlastRadius: no graph -> loud note, empty blast radius (changed files still stand alone)', () => {
  const { blastRadiusFiles, notes } = computeBlastRadius(null, ['backend/repo.py']);
  assert.deepStrictEqual(blastRadiusFiles, []);
  assert.ok(notes.some((n) => /no code-graph/.test(n)));
});

test('computeBlastRadius: a changed file absent from the graph is noted, not silently dropped', () => {
  const { notes } = computeBlastRadius(sampleGraph(), ['backend/not-in-graph.py']);
  assert.ok(notes.some((n) => /not found in code-graph/.test(n) && /not-in-graph\.py/.test(n)));
});

// ---------------------------------------------------------------------------
// Group resolution: verification-matrix.json primary, component-map.md +
// features.json fallback
// ---------------------------------------------------------------------------

test('resolveGroupsForFiles: primary source is verification-matrix.json implementation_paths + group', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{ id: 'VM-1', group: 'A', story_id: 'E1-S1', implementation_paths: ['backend/service.py'] }],
  });
  const { fileGroups, impactedGroups, notes } = resolveGroupsForFiles(dir, ['backend/service.py'], {
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
  });
  assert.deepStrictEqual(impactedGroups, ['A']);
  assert.deepStrictEqual([...fileGroups.get('backend/service.py')], ['A']);
  assert.deepStrictEqual(notes, []);
});

test('resolveGroupsForFiles: falls back to component-map.md + features.json when matrix lacks the file', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', { version: 1, requirements: [] });
  writeText(
    dir,
    'specs/design/component-map.md',
    '| Story | Files |\n|---|---|\n| E1-S1 | `backend/service.py` |\n'
  );
  writeJson(dir, 'features.json', [{ id: 'F001', story: 'E1-S1', group: 'A' }]);
  const { fileGroups, impactedGroups } = resolveGroupsForFiles(dir, ['backend/service.py'], {
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
  });
  assert.deepStrictEqual(impactedGroups, ['A']);
  assert.deepStrictEqual([...fileGroups.get('backend/service.py')], ['A']);
});

test('resolveGroupsForFiles: no matrix and no component-map -> loud note, zero groups', () => {
  const dir = tmpDir();
  const { impactedGroups, notes } = resolveGroupsForFiles(dir, ['backend/service.py'], {
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
  });
  assert.deepStrictEqual(impactedGroups, []);
  assert.ok(notes.some((n) => /no .*verification-matrix\.json and no .*component-map\.md/.test(n)));
});

test('resolveGroupsForFiles: a file resolving to zero owning groups is surfaced, not swallowed', () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', { version: 1, requirements: [] });
  const { impactedGroups, notes } = resolveGroupsForFiles(dir, ['backend/orphan.py'], {
    matrixPath: 'specs/test_artefacts/verification-matrix.json',
    componentMapPath: 'specs/design/component-map.md',
  });
  assert.deepStrictEqual(impactedGroups, []);
  assert.ok(notes.some((n) => /no owning story-group resolved.*backend\/orphan\.py/.test(n)));
});

test('parseComponentMapStoryFiles: reuses ownership-check.js tolerant backtick parsing per table row', () => {
  const text = [
    '| Story | Files |',
    '|---|---|',
    '| E1-S1 | `backend/a.py`, `backend/b.py` |',
    '| E1-S2 | `backend/c.py` |',
    '| not a story row | `backend/d.py` |', // no story-id token -> ignored
  ].join('\n');
  const map = parseComponentMapStoryFiles(text);
  assert.deepStrictEqual([...map.get('E1-S1')].sort(), ['backend/a.py', 'backend/b.py']);
  assert.deepStrictEqual([...map.get('E1-S2')], ['backend/c.py']);
  assert.strictEqual(map.has('not'), false);
});
