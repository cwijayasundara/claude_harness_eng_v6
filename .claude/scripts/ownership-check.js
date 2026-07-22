#!/usr/bin/env node

'use strict';

// Ownership sensor (2026-07-02 audit fix #4). "Every file produced must trace
// to a story" (implement/SKILL.md) was a stated rule with no sensor: nothing
// diffed changed files against specs/design/component-map.md. This closes it
// deterministically. The map is planner-authored freeform markdown (a story ->
// files table), so parsing is deliberately tolerant: ownership is any
// backtick-quoted path token; a directory entry owns its subtree.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAP_REL = path.join('specs', 'design', 'component-map.md');
const VERDICT_REL = path.join('specs', 'reviews', 'ownership-check.json');
const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// Never need a story owner: planning artifacts, docs, harness internals, CI
// config, and test suites (tests trace via test-traces, not the map).
const ALLOW_PREFIXES = ['specs/', 'docs/', '.claude/', '.github/', 'test/', 'tests/', 'e2e/'];

function isSource(file) {
  return SOURCE_EXTS.has(path.extname(file).toLowerCase());
}

function isAllowed(file) {
  if (path.basename(file).startsWith('.')) return true;
  return ALLOW_PREFIXES.some((p) => file.startsWith(p));
}

function parseComponentMap(text) {
  const owned = new Set();
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    const token = m[1].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!token || /\s/.test(token)) continue;
    if (token.includes('/') && token.startsWith('/')) continue; // URL-ish/route tokens like /users
    if (token.includes('*')) {
      // A glob owns its static prefix subtree (tolerant by design: this is an
      // ownership sensor, not a security boundary — src/**/*.ts owns src/).
      const prefix = token.slice(0, token.indexOf('*')).replace(/\/+$/, '');
      if (prefix) owned.add(prefix);
      continue;
    }
    if (token.includes('/') || isSource(token)) owned.add(token);
  }
  return owned;
}

function isOwned(file, owned) {
  if (owned.has(file)) return true;
  for (const entry of owned) {
    if (!isSource(entry) && file.startsWith(entry + '/')) return true;
  }
  return false;
}

// Pure core: files are repo-relative POSIX paths.
function checkOwnership(files, mapText) {
  const owned = parseComponentMap(mapText);
  let checked = 0;
  const unowned = [];
  for (const raw of files) {
    const file = String(raw).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (!isSource(file) || isAllowed(file)) continue;
    checked += 1;
    if (!isOwned(file, owned)) unowned.push(file);
  }
  const result = { pass: unowned.length === 0, map_entries: owned.size, checked, unowned };
  // A parse-empty map with real source changes is a broken control, not a pass.
  if (owned.size === 0 && checked > 0) {
    result.pass = false;
    result.reason = 'empty_map';
  }
  return result;
}

// --- cluster independence -----------------------------------------------------
//
// Edge-level independence (story-clusters.js) proves two clusters have no
// dependency between them. It cannot see that both intend to edit the same
// file, which is what actually collides when two engineers work in parallel.
// The component map is the first artifact that knows, so the check lands here
// and runs at /design, once the map exists.

const STORY_ID = /\bE\d+-S\d+\b/g;

// story id -> paths declared on the same map row. Deliberately tolerant, like
// parseComponentMap: the map is planner-authored freeform markdown.
function parseStoryOwnership(text) {
  const owned = new Map();
  for (const line of String(text).split('\n')) {
    const stories = line.match(STORY_ID);
    if (!stories) continue;
    const paths = [...parseComponentMap(line)];
    if (paths.length === 0) continue;
    for (const story of new Set(stories)) {
      owned.set(story, (owned.get(story) || []).concat(paths));
    }
  }
  return owned;
}

function collisionsFor(fileOwners) {
  const collisions = [];
  for (const [file, owners] of fileOwners) {
    const clusterIds = [...new Set(owners.map((o) => o.cluster))].sort();
    if (clusterIds.length < 2) continue;
    collisions.push({
      file,
      clusters: clusterIds,
      stories: [...new Set(owners.map((o) => o.story))].sort(),
    });
  }
  return collisions.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function checkClusterCollisions(mapText, plan) {
  const owned = parseStoryOwnership(mapText);
  const clusters = (plan && Array.isArray(plan.clusters)) ? plan.clusters : [];
  const clusterOf = new Map();
  for (const c of clusters) for (const s of c.stories || []) clusterOf.set(s, c.id);

  const fileOwners = new Map();
  for (const [story, paths] of owned) {
    const cluster = clusterOf.get(story);
    if (!cluster) continue;
    for (const file of paths) {
      if (!fileOwners.has(file)) fileOwners.set(file, []);
      fileOwners.get(file).push({ story, cluster });
    }
  }

  const collisions = collisionsFor(fileOwners);
  const verdict = {
    pass: collisions.length === 0,
    files_checked: fileOwners.size,
    collisions,
    unclustered_stories: [...owned.keys()].filter((s) => !clusterOf.has(s)).sort(),
    unmapped_stories: [...clusterOf.keys()].filter((s) => !owned.has(s)).sort(),
  };
  // A map that parsed to nothing, or a plan with no clusters, checked nothing —
  // that is a broken control, not a clean bill of health.
  if (clusters.length === 0) return { ...verdict, pass: false, reason: 'no_clusters' };
  if (owned.size === 0) return { ...verdict, pass: false, reason: 'empty_map' };
  return verdict;
}

function stagedFiles(exec) {
  const out = exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return String(out).split('\n').filter(Boolean);
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function reportCollisions(verdict, strict) {
  const label = verdict.pass ? 'PASS' : (strict ? 'FAIL' : 'WARN');
  process.stdout.write(
    `ownership-clusters: ${label} — ${verdict.files_checked} file(s) checked, `
    + `${verdict.collisions.length} cross-cluster collision(s)${verdict.reason ? ` (${verdict.reason})` : ''}\n`,
  );
  for (const c of verdict.collisions) {
    process.stdout.write(
      `  COLLISION  ${c.file} — owned by ${c.stories.join(', ')} across clusters ${c.clusters.join(', ')}\n`,
    );
  }
  for (const s of verdict.unmapped_stories) process.stdout.write(`  UNMAPPED   ${s} — clustered but has no files\n`);
  for (const s of verdict.unclustered_stories) process.stdout.write(`  UNCLUSTERED ${s} — mapped but in no cluster\n`);
}

function runClusterMode(root, mapPath, strict) {
  const planPath = path.join(root, 'specs', 'stories', 'story-clusters.json');
  if (!fs.existsSync(planPath)) {
    process.stdout.write('ownership-clusters: SKIP (no story-clusters.json — run /spec Step 4.5)\n');
    return 0;
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const verdict = checkClusterCollisions(fs.readFileSync(mapPath, 'utf8'), plan);
  const out = path.join(root, 'specs', 'reviews', 'ownership-clusters.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`);
  reportCollisions(verdict, strict);
  return verdict.pass || !strict ? 0 : 1;
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  const mapPath = path.join(root, MAP_REL);

  if (!fs.existsSync(mapPath)) {
    writeVerdict(root, { verdict: 'no-map', pass: true, note: `${MAP_REL} not found — ownership not checked` });
    process.stdout.write('ownership: SKIP (no component-map.md)\n');
    return 0;
  }

  if (argv[0] === '--clusters') return runClusterMode(root, mapPath, argv.includes('--strict'));

  let files;
  if (argv[0] === '--staged') {
    files = stagedFiles(exec);
  } else if (argv[0] === '--files') {
    files = argv.slice(1);
  } else {
    process.stderr.write('usage: ownership-check.js --staged | --files <path> [...] | --clusters [--strict]\n');
    return 2;
  }

  const verdict = checkOwnership(files, fs.readFileSync(mapPath, 'utf8'));
  writeVerdict(root, verdict);
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`ownership: ${label} — ${verdict.checked} checked, ${verdict.unowned.length} unowned${verdict.reason ? ` (${verdict.reason})` : ''}\n`);
  for (const f of verdict.unowned) process.stdout.write(`  UNOWNED  ${f}\n`);
  return verdict.pass ? 0 : 1;
}

module.exports = {
  parseComponentMap, parseStoryOwnership, checkOwnership, checkClusterCollisions, run, SOURCE_EXTS, isSource,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
