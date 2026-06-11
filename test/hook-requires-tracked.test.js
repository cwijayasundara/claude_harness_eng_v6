'use strict';

// Guards against clean-clone breakage: every relative require() in a tracked
// hook/git-hook/script file must resolve to a git-tracked file. A hook that
// requires an untracked module crashes silently on a fresh clone (the crash
// is swallowed into hook-errors.log), so the gate it implements simply stops
// existing. Checks working-tree content against the git index, so a missing
// `git add` is caught before the commit lands.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCANNED_DIRS = ['.claude/hooks', '.claude/git-hooks', '.claude/scripts'];
const DIRECT_REQUIRE_RE = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
const JOIN_REQUIRE_RE = /require\(\s*path\.join\(\s*__dirname\s*((?:,\s*['"][^'"]+['"])+)\s*\)\s*\)/g;

function requireSpecs(content) {
  const specs = [];
  for (const m of content.matchAll(DIRECT_REQUIRE_RE)) specs.push(m[1]);
  for (const m of content.matchAll(JOIN_REQUIRE_RE)) {
    const segments = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((s) => s[1]);
    specs.push(`./${path.posix.join(...segments)}`);
  }
  return specs;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '--', ...SCANNED_DIRS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function isNodeFile(relPath, content) {
  return relPath.endsWith('.js') || content.startsWith('#!/usr/bin/env node');
}

function resolveCandidates(fromFile, spec) {
  const base = path.join(path.dirname(fromFile), spec);
  return [base, `${base}.js`, path.join(base, 'index.js')];
}

test('every relative require in tracked hook/script files resolves to a tracked file', () => {
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean));

  const problems = [];
  for (const relPath of trackedFiles()) {
    const absPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(absPath)) continue; // deleted in working tree; git will drop it
    const content = fs.readFileSync(absPath, 'utf8');
    if (!isNodeFile(relPath, content)) continue;

    for (const spec of requireSpecs(content)) {
      const candidates = resolveCandidates(relPath, spec);
      const satisfied = candidates.some((c) => tracked.has(c.split(path.sep).join('/')));
      if (!satisfied) {
        problems.push(`${relPath} requires '${spec}' but no candidate is git-tracked (${candidates.join(', ')})`);
      }
    }
  }

  assert.deepStrictEqual(problems, [],
    `Untracked require targets found — \`git add\` them before committing their consumers:\n${problems.join('\n')}`);
});
