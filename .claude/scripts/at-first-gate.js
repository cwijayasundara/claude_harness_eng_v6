#!/usr/bin/env node

'use strict';

// Pre-commit half of gap G23 (at-first-proof). Mirrors G17's
// legacy-discipline-gate.js exactly: record-at-red.js (the receipt-recording
// half) appends {storyId, atPath, observedRedAt, testCmd} to
// specs/reviews/at-red-receipts.jsonl whenever writing-acceptance-tests-
// first's Process step 5 ("confirm it fails for the right reason") actually
// runs a failing AT. This gate re-checks, at commit time, that every story
// with a NEW (added, not modified) staged production source file also has
// (a) specs/test_artefacts/acceptance/{story-id}.<ext> on disk, and (b) a
// matching receipt naming that {storyId, atPath} pair.
//
// "Which story owns this new file" reuses parseComponentMapStoryFiles from
// hooks/lib/impact-scope.js (gap G16) — the codebase's existing story ->
// files component-map.md parser — rather than ownership-check.js's own
// parseComponentMap, which deliberately flattens every row into one
// owned-path Set with no story association (it only answers "is this file
// owned by ANY story", not "by WHICH one"). A brand-new file with NO story
// owner at all is a different, already-covered problem: ownership-check.js's
// own gate already blocks that case; this gate only asks its follow-on
// question for files it CAN attribute to a story.
//
// Degrades loudly, never silently: no component-map.md yet (pure greenfield,
// nothing to check ownership against), or no staged NEW production file
// resolves to a story owner (only modifications — checking-coverage-before-
// change/G17's territory, not this gate's), SKIPs with a note.
//
// Known limitations (disclosed, not hidden — the same "disclosed, not
// silently accepted" precedent G17 uses for its own two limitations; see
// HARNESS.md G23 and docs/sensor-arbitration.md):
// 1. A receipt's timestamp mechanically proves the AT was confirmed red BY
//    THE TIME OF THIS COMMIT, not that it strictly preceded every line of
//    the later implementation diff — proving that would need fragile
//    git-history archaeology this gate does not attempt.
// 2. --diff-filter=A only (new files). This is intentionally narrower than
//    G17's legacy-discipline-gate.js, which added rename status R to its own
//    modified-file filter (gap G19's review) — a rename isn't net-new
//    behavior, so it stays out of scope here on purpose, not by oversight.
//    Git's default similarity threshold can still classify a genuinely-new
//    file as status R if it happens to be >50% similar to a staged-deleted
//    file; such a file would not be caught by this gate. Narrow, accepted
//    edge case, not a defect.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isSource } = require('./ownership-check');
const { isTestFile } = require(path.join(__dirname, '..', 'hooks', 'lib', 'tdd'));
const { parseComponentMapStoryFiles } = require(path.join(__dirname, '..', 'hooks', 'lib', 'impact-scope'));

const MAP_REL = path.join('specs', 'design', 'component-map.md');
const RECEIPTS_REL = path.join('specs', 'reviews', 'at-red-receipts.jsonl');
const ACCEPTANCE_DIR_REL = path.join('specs', 'test_artefacts', 'acceptance');
const VERDICT_REL = path.join('specs', 'reviews', 'at-first-gate.json');

function readReceipts(root) {
  const p = path.join(root, RECEIPTS_REL);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

// file -> owning story, exact match only (see file header for why this
// reuses impact-scope.js's parser rather than ownership-check.js's own).
// Kept as a plain Map, unchanged shape — dirOwnedStories() below is the
// separate, additive fallback for directory-owned rows (see resolveStory).
function fileToStory(mapText) {
  const byStory = parseComponentMapStoryFiles(mapText);
  const owner = new Map();
  for (const [story, files] of byStory) {
    for (const f of files) owner.set(normalize(f), story);
  }
  return owner;
}

// A component-map row can own a whole directory, not just individual files
// (e.g. `src/orders/`) — the same convention ownership-check.js's isOwned()
// already treats as "a non-source-extension token owns its subtree". An
// exact-match-only lookup can never match an individual new file under such
// a directory, which would silently exempt it from the AT-first requirement.
function dirOwnedStories(mapText) {
  const byStory = parseComponentMapStoryFiles(mapText);
  const dirs = [];
  for (const [story, files] of byStory) {
    for (const raw of files) {
      const dir = normalize(raw).replace(/\/+$/, '');
      if (dir && !isSource(dir)) dirs.push({ story, dir });
    }
  }
  return dirs;
}

// Exact match first, then the nearest directory-token ancestor a story's
// component-map row claims — mirrors ownership-check.js's isOwned exactly.
function resolveStory(exactOwner, dirs, file) {
  const f = normalize(file);
  if (exactOwner.has(f)) return exactOwner.get(f);
  for (const { story, dir } of dirs) {
    if (f.startsWith(`${dir}/`)) return story;
  }
  return null;
}

// The AT file convention is specs/test_artefacts/acceptance/{story-id}.<ext>
// (test/SKILL.md Step 4.6) — extension is project-stack-dependent, so this
// looks up by basename prefix rather than a fixed extension.
function findAtFile(root, story) {
  const dir = path.join(root, ACCEPTANCE_DIR_REL);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  const hit = entries.find((name) => name === story || name.startsWith(`${story}.`));
  return hit ? path.join(ACCEPTANCE_DIR_REL, hit) : null;
}

function hasReceipt(receipts, story, atPath) {
  const normAtPath = normalize(atPath);
  return receipts.some((r) => r && r.storyId === story && normalize(r.atPath) === normAtPath);
}

// Pure core. addedProdFiles: staged, status A, source, non-test files.
// mapText: component-map.md contents. root: to locate the acceptance dir.
function checkAtFirst(root, addedProdFiles, mapText, receipts) {
  const owner = fileToStory(mapText);
  const dirs = dirOwnedStories(mapText);
  const stories = new Set();
  for (const f of addedProdFiles) {
    const story = resolveStory(owner, dirs, f);
    if (story) stories.add(story);
  }
  const missingAt = [];
  const missingReceipt = [];
  for (const story of stories) {
    const atPath = findAtFile(root, story);
    if (!atPath) {
      missingAt.push(story);
      continue;
    }
    if (!hasReceipt(receipts, story, atPath)) missingReceipt.push({ story, atPath });
  }
  return {
    pass: missingAt.length === 0 && missingReceipt.length === 0,
    storiesChecked: [...stories],
    missingAt,
    missingReceipt,
  };
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function gitAddedFiles(exec) {
  return String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=A']))
    .split('\n')
    .filter(Boolean);
}

// Returns the added-file list from CLI args, or null on a usage error.
function resolveAddedFiles(argv, exec) {
  if (argv[0] === '--staged') return gitAddedFiles(exec).filter((f) => isSource(f) && !isTestFile(f));
  if (argv[0] === '--files') return argv.slice(1).filter((f) => isSource(f) && !isTestFile(f));
  return null;
}

function skipVerdict(root, note) {
  writeVerdict(root, { verdict: 'skip', pass: true, note });
  process.stdout.write(`at-first: SKIP (${note})\n`);
  return 0;
}

function reportVerdict(verdict) {
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`at-first: ${label} — ${verdict.storiesChecked.length} new-file story(ies) checked\n`);
  for (const s of verdict.missingAt) process.stdout.write(`  NO ACCEPTANCE TEST FILE     ${s}\n`);
  for (const m of verdict.missingReceipt) process.stdout.write(`  NO RED RECEIPT              ${m.story} (${m.atPath})\n`);
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  const mapPath = path.join(root, MAP_REL);
  if (!fs.existsSync(mapPath)) return skipVerdict(root, `${MAP_REL} not found — nothing to check ownership against`);

  const added = resolveAddedFiles(argv, exec);
  if (added === null) {
    process.stderr.write('usage: at-first-gate.js --staged | --files <path> [...]\n');
    return 2;
  }

  const mapText = fs.readFileSync(mapPath, 'utf8');
  const verdict = checkAtFirst(root, added, mapText, readReceipts(root));
  if (verdict.storiesChecked.length === 0) {
    return skipVerdict(root, 'no staged NEW production file resolves to a story owner in component-map.md');
  }
  writeVerdict(root, verdict);
  reportVerdict(verdict);
  return verdict.pass ? 0 : 1;
}

module.exports = {
  checkAtFirst,
  fileToStory,
  dirOwnedStories,
  resolveStory,
  findAtFile,
  hasReceipt,
  readReceipts,
  run,
  isSource,
  isTestFile,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
