'use strict';

// Mechanical guard for the "scaffold-copy list drift" bug class (harness gap G22).
//
// scaffold-copy.js copies `.claude/scripts/*.js` and `.claude/skills/*/SKILL.md`
// to scaffolded projects via explicit named lists (CORE_SCRIPTS, CORE_SKILLS),
// not a directory glob. When a skill is edited to call `node .claude/scripts/X.js`
// or invoke a `REQUIRED SUB-SKILL: name` discipline without adding that name to
// the matching list, the reference silently breaks — but only in projects the
// scaffold produces, never in this repo's own `npm test`, because this repo
// already has every script and skill on disk regardless of the copy lists.
//
// This test scans the same skill files scaffold-copy.js is meant to keep in
// sync and fails loudly, in THIS repo's own suite, the moment a reference and
// a copy list disagree — the same class of guard test/hook-requires-tracked.test.js
// applies to require()-target tracking, applied here to the copy lists instead.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(REPO_ROOT, '.claude', 'skills');
const PRE_COMMIT = path.join(REPO_ROOT, '.claude', 'git-hooks', 'pre-commit');

const SCRIPT_REF_RE = /node \.claude\/scripts\/([A-Za-z0-9_-]+\.js)/g;
// Matches both backtick conventions already in use: `` REQUIRED SUB-SKILL: `name` ``
// (backticks around the name only) and `` `REQUIRED SUB-SKILL: name` `` (backticks
// around the whole phrase) — the backticks around the name are optional either way.
const SUB_SKILL_REF_RE = /REQUIRED SUB-SKILL:\s*`?([a-zA-Z0-9_-]+)`?/g;

function scannedFiles() {
  const skillFiles = fs.readdirSync(SKILLS_DIR)
    .map((name) => path.join(SKILLS_DIR, name, 'SKILL.md'))
    .filter((p) => fs.existsSync(p));
  return [...skillFiles, PRE_COMMIT];
}

function collectReferences() {
  const scripts = new Set();
  const skills = new Set();
  for (const file of scannedFiles()) {
    const content = fs.readFileSync(file, 'utf8');
    for (const m of content.matchAll(SCRIPT_REF_RE)) scripts.add(m[1]);
    for (const m of content.matchAll(SUB_SKILL_REF_RE)) skills.add(m[1]);
  }
  return { scripts, skills };
}

// The copy lists are no longer literals in scaffold-copy.js — they are derived from
// .claude/config/packs.json. Reading the exported arrays tests what the copy step
// ACTUALLY does, rather than what its source text looks like; the old source-parsing
// version silently matched nothing once the literals went away.
//
// A skill or hook may reference a script from any profile, so completeness is checked
// against the widest install (`full`), not `core` — a brownfield-only script referenced
// by a brownfield skill is correct, not missing.
function copyListNames(arrayName) {
  const copy = require(path.join(REPO_ROOT, '.claude', 'scripts', 'scaffold-copy.js'));
  const profileOf = { CORE_SCRIPTS: 'script', CORE_SKILLS: 'skill' };
  const kind = profileOf[arrayName];
  assert.ok(kind, `unsupported list: ${arrayName}`);
  const packs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude', 'config', 'packs.json'), 'utf8'));
  const names = new Set(packs.kernel[kind] || []);
  for (const spec of Object.values(packs.packs)) for (const n of spec[kind] || []) names.add(n);
  // keep the historical shape: script names carry their extension
  return kind === 'script' ? new Set([...names].map((n) => `${n}.js`)) : names;
}

test('every "node .claude/scripts/X.js" reference in a skill or pre-commit is in CORE_SCRIPTS', () => {
  const coreScripts = copyListNames('CORE_SCRIPTS');
  const { scripts } = collectReferences();

  const missing = [...scripts].filter((name) => !coreScripts.has(name)).sort();
  assert.deepStrictEqual(missing, [], 'scripts referenced by a skill or pre-commit hook but '
    + `missing from scaffold-copy.js's CORE_SCRIPTS: ${missing.join(', ')}`);
});

test('every "REQUIRED SUB-SKILL: name" reference in a skill or pre-commit is in CORE_SKILLS', () => {
  const coreSkills = copyListNames('CORE_SKILLS');
  const { skills } = collectReferences();

  const missing = [...skills].filter((name) => !coreSkills.has(name)).sort();
  assert.deepStrictEqual(missing, [], 'sub-skills referenced by a skill or pre-commit hook but '
    + `missing from scaffold-copy.js's CORE_SKILLS: ${missing.join(', ')}`);
});
