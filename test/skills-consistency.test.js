'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');

function listSkills() {
  return fs.readdirSync(SKILLS_DIR).filter((d) =>
    fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md'))
  );
}

function allDocFiles() {
  const out = [];
  for (const skill of listSkills()) out.push(path.join(SKILLS_DIR, skill, 'SKILL.md'));
  for (const f of fs.readdirSync(AGENTS_DIR)) {
    if (f.endsWith('.md')) out.push(path.join(AGENTS_DIR, f));
  }
  return out;
}

// A reference-only skill that exists solely to say "use the other name instead"
// is the clearest complexity smell — its content belongs in references/, not in
// the skill surface. (docs/internal/SIMPLIFICATION_PROPOSAL.md §3.3)
test('no SKILL.md is a reference-only tombstone', () => {
  const offenders = [];
  for (const skill of listSkills()) {
    const text = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    if (/\[Reference, not a command\]|Do not invoke|do not invoke this skill/i.test(text)) {
      offenders.push(skill);
    }
  }
  assert.deepStrictEqual(offenders, [], `reference-only tombstone skills: ${offenders.join(', ')}`);
});

// Every `.claude/skills/<name>/...` path mentioned in any SKILL.md or agent
// definition must resolve — catches broken reference moves and deleted skills.
test('every referenced skills/ path resolves on disk', () => {
  const broken = [];
  const re = /\.claude\/skills\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_./-]+)/g;
  for (const file of allDocFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      const target = path.join(SKILLS_DIR, m[1], m[2]);
      // ignore trailing punctuation captured by the greedy class
      const clean = target.replace(/[.,)`'"]+$/, '');
      if (!fs.existsSync(target) && !fs.existsSync(clean)) {
        broken.push(`${path.relative(ROOT, file)} -> ${m[0]}`);
      }
    }
  }
  assert.deepStrictEqual(broken, [], `broken skills/ path references:\n${broken.join('\n')}`);
});

// Deleted skills must not be referenced anywhere by directory name.
test('no doc references a removed skill directory', () => {
  const removed = ['evaluation', 'testing', 'tracker', 'lane-classify', 'improve', 'fix-issue', 'lite', 'architecture'];
  const present = new Set(listSkills());
  const offenders = [];
  for (const name of removed) {
    if (present.has(name)) continue; // not yet removed — skip (test stays green pre-merge)
    const re = new RegExp(`skills/${name}/|\\b${name}/SKILL\\.md`);
    for (const file of allDocFiles()) {
      if (re.test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(ROOT, file)} references removed skill '${name}'`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

// Pipeline-step skills are run by an entry point (/build, /auto, /brownfield,
// /scaffold), not typed by users. Their description must mark them internal so
// the model surfaces only the ~9 entry points — keeps the advertised surface
// from silently re-expanding. (docs/internal/SIMPLIFICATION_PROPOSAL.md §3.1)
test('internal pipeline-stage skills are marked internal in their description', () => {
  const internal = [
    'brd', 'spec', 'design', 'test', 'implement', 'evaluate',
    'deploy', 'code-map', 'seam-finder', 'clarify', 'install-framework-packs',
  ];
  const present = new Set(listSkills());
  const unmarked = [];
  for (const name of internal) {
    if (!present.has(name)) continue; // skill may be renamed/removed later
    const text = fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
    const desc = (text.match(/^description:\s*(.*)$/m) || [])[1] || '';
    if (!/Internal pipeline stage/i.test(desc)) unmarked.push(name);
  }
  assert.deepStrictEqual(unmarked, [], `internal skills missing the marker: ${unmarked.join(', ')}`);
});

function listAgents() {
  return fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
}

// Every agent has its model pinned in frontmatter — no silent inheritance drift.
test('every agent pins a model in frontmatter', () => {
  const missing = [];
  for (const agent of listAgents()) {
    const text = fs.readFileSync(path.join(AGENTS_DIR, `${agent}.md`), 'utf8');
    if (!/^---\n[\s\S]*?\nmodel:\s*\S+[\s\S]*?\n---/.test(text)) missing.push(agent);
  }
  assert.deepStrictEqual(missing, [], `agents missing a model: pin: ${missing.join(', ')}`);
});

// Merged-away agents must not be referenced as spawn targets anywhere.
test('no doc references a removed agent', () => {
  const removed = ['phase-evaluator', 'test-engineer', 'ui-designer'];
  const present = new Set(listAgents());
  const offenders = [];
  for (const name of removed) {
    if (present.has(name)) continue; // not yet removed — skip
    for (const file of allDocFiles()) {
      if (new RegExp(`\\b${name}\\b`).test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(ROOT, file)} references removed agent '${name}'`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

// The five discipline micro-skills are auto-invoked by agents mid-pipeline,
// not typed by humans; without a marker they read as user commands when a
// team browses .claude/skills/ (2026-07-02 audit fix #5). The marker is a
// SUFFIX: the leading "Use when…" trigger phrase drives auto-invocation and
// must stay first (unlike seam-finder-style stage skills, which prefix).
const INTERNAL_DISCIPLINE_SKILLS = [
  'checking-coverage-before-change',
  'checking-migration-safety',
  'keeping-refactors-pure',
  'pinning-down-behavior',
  'sprouting-instead-of-editing',
];

test('internal discipline skills carry the marker after their trigger phrase', () => {
  const offenders = [];
  for (const skill of INTERNAL_DISCIPLINE_SKILLS) {
    const text = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    const match = text.match(/^description:\s*(.+)$/m);
    const desc = match ? match[1] : '';
    const ok = /^Use when/.test(desc) && /\[Internal discipline — .+power-user path\.\]$/.test(desc);
    if (!ok) offenders.push(skill);
  }
  assert.deepStrictEqual(offenders, [], `missing/misplaced internal marker: ${offenders.join(', ')}`);
});
