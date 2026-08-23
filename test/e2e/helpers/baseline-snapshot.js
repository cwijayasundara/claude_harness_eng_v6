'use strict';

// Capturing a built project as a reusable baseline fixture: what to exclude,
// what must be present, and the copy itself.
//
// Split out of make-sprint1-baseline.js, which had grown to 568 lines against
// the 500-line test cap. The seam is the one the file already had: this half
// knows how to snapshot a tree, the other half knows how to drive a live build.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'baselines', 'shortlink-sprint1');

// Dependency trees, build output, VCS, and the harness control plane.
const EXCLUDED = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.ruff_cache', 'dist', 'build', '.next', '.turbo', 'coverage', 'htmlcov', '.DS_Store',
  '.claude', 'CLAUDE.md', 'SCAFFOLD_README.md', 'CODEBASE_MAP.md', 'design.md',
  'init.sh', 'project-manifest.json', 'claude-progress.txt',
  // A TypeScript incremental-build cache. Nothing reads it from a fixture and
  // it is invalidated by the first compile anyway.
  'tsconfig.tsbuildinfo',
  // Sprint 1's own gate verdicts. Carrying them forward is the vacuous-pass
  // trap: the delta route asserts that sprint 2 LEAVES design-grounding.json,
  // and a baseline that ships sprint 1's copy satisfies that assertion without
  // sprint 2 ever writing one. The verdicts must be re-earned, not inherited.
  'reviews',
]);

// The delta route builds sprint 2 ON TOP of sprint 1's code, so a planning-only
// tree — every spec present, no product — is not a baseline. It passes every
// artifact check and then fails hours into a live run, which is the expensive
// place to find out. Source files are counted at capture time instead.
const SOURCE_EXTENSIONS = new Set(['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.rs', '.rb', '.java', '.kt', '.cs', '.php']);
const NON_SOURCE_DIRS = new Set(['specs', 'docs', 'sprint-contracts']);
const MIN_SOURCE_FILES = 3;

// A baseline the delta route cannot use is worse than none — it would fail deep
// inside a live run instead of at capture time.
const REQUIRED = [
  path.join('specs', 'design', 'architecture.md'),
  path.join('specs', 'design', 'component-map.md'),
  path.join('specs', 'design', 'design-traces.json'),
  path.join('specs', 'brd', 'brd-requirements.json'),
];

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) files += copyTree(from, to);
    else if (entry.isFile()) { fs.copyFileSync(from, to); files += 1; }
  }
  return files;
}

// `out` exists so the capture can be exercised against a scratch directory;
// every caller here uses the committed default.
/** Product source files, ignoring the spec/doc trees and everything excluded. */
function countSourceFiles(dir, top = true) {
  let count = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    if (top && entry.isDirectory() && NON_SOURCE_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) count += countSourceFiles(path.join(dir, entry.name), false);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) count += 1;
  }
  return count;
}

function snapshot(source, out = OUT_DIR) {
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(source, rel)));
  if (missing.length) {
    throw new Error(
      `${source} is not a usable sprint-1 baseline — missing:\n  ${missing.join('\n  ')}\n`
      + 'The delta route amends a living design; without one it has nothing to amend.',
    );
  }
  const sources = countSourceFiles(source);
  if (sources < MIN_SOURCE_FILES) {
    throw new Error(
      `${source} carries a full spec set but only ${sources} source file(s) — this is a `
      + 'planning-only tree, not a built sprint-1 system.\nThe delta route builds sprint 2 on '
      + "top of sprint 1's code; seeding from specs alone fails hours into a live run.",
    );
  }
  fs.rmSync(out, { recursive: true, force: true });
  const files = copyTree(source, out);
  process.stdout.write(`baseline: ${files} file(s) captured from ${source}\n  -> ${out}\n`);
  return files;
}

module.exports = {
  OUT_DIR, EXCLUDED, REQUIRED, SOURCE_EXTENSIONS, NON_SOURCE_DIRS, MIN_SOURCE_FILES,
  copyTree, countSourceFiles, snapshot,
};
