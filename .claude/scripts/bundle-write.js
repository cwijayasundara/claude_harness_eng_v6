#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/bundle-write.js [--root DIR] [--story E1-S1]
// Joins existing planning artifacts into specs/bundles/{id}.json.
// Exit 0 = wrote, 1 = no ready stories / write failed, 2 = IO.

const fs = require('fs');
const path = require('path');
const { buildBundle, listStoryFiles, parseStoryOwnership, sprintFromPath } = require('../hooks/lib/story-bundle');

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

function listAmendments(root) {
  const dir = path.join(root, 'specs', 'design', 'amendments');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .map((n) => path.join('specs', 'design', 'amendments', n).replace(/\\/g, '/'));
}

function currentSprint(root, storyPath) {
  const stamped = path.join(root, '.claude', 'state', 'current-sprint');
  if (fs.existsSync(stamped)) {
    const n = Number(String(fs.readFileSync(stamped, 'utf8')).trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return sprintFromPath(storyPath);
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const only = arg(argv, '--story', null);
  const files = listStoryFiles(walkStoryFiles(root));
  const selected = only ? files.filter((f) => f.id === only) : files;
  if (only && !selected.length) {
    process.stderr.write(`bundle-write: story ${only} not found\n`);
    return 1;
  }
  if (!selected.length) {
    process.stdout.write('bundle-write: SKIP — no story files\n');
    return 0;
  }

  const storyTraces = readJson(path.join(root, 'specs', 'stories', 'story-traces.json'), []);
  const matrix = readJson(path.join(root, 'specs', 'test_artefacts', 'verification-matrix.json'), null);
  const testTraces = readJson(path.join(root, 'specs', 'test_artefacts', 'test-traces.json'), []);
  const brdAcceptance = readJson(path.join(root, 'specs', 'brd', 'brd-acceptance.json'), []);
  const trackerMap = readJson(path.join(root, '.claude', 'state', 'tracker-map.json'), null);
  const mapText = (() => {
    try {
      return fs.readFileSync(path.join(root, 'specs', 'design', 'component-map.md'), 'utf8');
    } catch (_) {
      return '';
    }
  })();
  const ownership = parseStoryOwnership(mapText);
  const amendments = listAmendments(root);
  const outDir = path.join(root, 'specs', 'bundles');
  fs.mkdirSync(outDir, { recursive: true });

  let wrote = 0;
  for (const file of selected) {
    const abs = path.join(root, file.path);
    const markdown = fs.readFileSync(abs, 'utf8');
    if (/Readiness:\s*needs_breakdown/i.test(markdown)) continue;
    const bundle = buildBundle({
      storyId: file.id,
      storyPath: file.path,
      markdown,
      storyTraces,
      matrix,
      testTraces,
      ownedFiles: ownership.get(file.id) || [],
      brdAcceptance,
      amendments,
      trackerMap,
      sprint: currentSprint(root, file.path),
    });
    const dest = path.join(outDir, `${file.id}.json`);
    fs.writeFileSync(dest, `${JSON.stringify(bundle, null, 2)}\n`);
    wrote += 1;
    process.stdout.write(`  wrote specs/bundles/${file.id}.json\n`);
  }

  process.stdout.write(`bundle-write: wrote ${wrote} bundle(s)\n`);
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`bundle-write: ${err.message}\n`);
    process.exit(2);
  }
}
