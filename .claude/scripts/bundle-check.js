#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/bundle-check.js [--mode skeleton|implementable]
//   [--root DIR] [--story E1-S1]
// Exit 0 = pass (or dormant), 1 = fail, 2 = usage/IO.

const fs = require('fs');
const path = require('path');
const { checkProject, listStoryFiles } = require('../hooks/lib/story-bundle');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : String(argv[i + 1]);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function walkStoryFiles(root) {
  const storiesRoot = path.join(root, 'specs', 'stories');
  const found = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/^E\d+-S\d+\.md$/.test(name)) {
        found.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  }
  walk(storiesRoot);
  return found;
}

function loadStory(root, rel) {
  const markdown = fs.readFileSync(path.join(root, rel), 'utf8');
  const id = path.basename(rel, '.md');
  const readiness = /Readiness:\s*needs_breakdown/i.test(markdown) ? 'needs_breakdown' : 'ready';
  return {
    id,
    path: rel,
    markdown,
    readiness,
    bundle: readJson(path.join(root, 'specs', 'bundles', `${id}.json`), null),
  };
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const mode = arg(argv, '--mode', 'skeleton');
  if (mode !== 'skeleton' && mode !== 'implementable') {
    process.stderr.write('bundle-check: --mode must be skeleton or implementable\n');
    return 2;
  }
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const only = arg(argv, '--story', null);
  const files = listStoryFiles(walkStoryFiles(root));
  const selected = only ? files.filter((f) => f.id === only) : files;
  if (only && !selected.length) {
    process.stderr.write(`bundle-check: story ${only} not found\n`);
    return 1;
  }

  const stories = selected.map((f) => loadStory(root, f.path));
  const verdict = checkProject({
    stories,
    matrixPresent: fs.existsSync(path.join(root, 'specs', 'test_artefacts', 'verification-matrix.json')),
    mapPresent: fs.existsSync(path.join(root, 'specs', 'design', 'component-map.md')),
    brdAcceptance: readJson(path.join(root, 'specs', 'brd', 'brd-acceptance.json'), []),
    testTraces: readJson(path.join(root, 'specs', 'test_artefacts', 'test-traces.json'), []),
    safeguards: readJson(path.join(root, 'specs', 'brd', 'brd-safeguards.json'), []),
  }, { mode });

  if (verdict.dormant) {
    process.stdout.write('bundle-check: SKIP — no ready stories\n');
    return 0;
  }
  if (!verdict.pass) {
    process.stderr.write(`bundle-check: FAIL (${mode}) — ${verdict.errors.length} issue(s)\n`);
    for (const err of verdict.errors) process.stderr.write(`  - ${err}\n`);
    return 1;
  }
  process.stdout.write(`bundle-check: PASS — ${verdict.checked} ${mode}\n`);
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`bundle-check: ${err.message}\n`);
    process.exit(2);
  }
}
