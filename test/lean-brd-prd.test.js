'use strict';

// Lean /brd --prd: scripts only, no analysis pack, short brd.md, gates pass
// on the mid-size shortlink fixture.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRD = path.join(ROOT, 'docs/shortlink-prd.md');

function extract(dir) {
  fs.mkdirSync(path.join(dir, 'specs', 'reviews'), { recursive: true });
  execFileSync(process.execPath, [
    path.join(ROOT, '.claude/scripts/prd-extract.js'),
    PRD,
    '--root', dir,
    '--tag',
    '--write-brd',
  ], { encoding: 'utf8' });
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function readJson(dir, rel) {
  return JSON.parse(read(dir, rel));
}

test('prd-extract adopts the shortlink fixture and writes a short pointer BRD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-brd-'));
  extract(dir);
  const reqs = readJson(dir, 'specs/brd/brd-requirements.json');
  assert.strictEqual(reqs.length, 24);
  assert.ok(reqs.every((r) => Array.isArray(r.taxonomy) && r.taxonomy.length > 0));
  const md = read(dir, 'specs/brd/brd.md');
  const lines = md.split('\n').length;
  assert.ok(lines <= 80, `lean brd.md is ${lines} lines`);
  assert.ok(!fs.existsSync(path.join(dir, 'specs/brd/brd-analysis.json')));
  assert.match(md, /adopt-only/);
  const seed = readJson(dir, 'specs/brd/analysis-seed.json');
  assert.strictEqual(seed.kind, 'lean-analysis-seed');
  assert.ok(Array.isArray(seed.domain_concepts));
  assert.ok(seed.domain_concepts.length >= 1);
});

test('lean adopt passes grounding and taxonomy on shortlink', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-brd-gates-'));
  extract(dir);
  execFileSync(process.execPath, [
    path.join(ROOT, '.claude/skills/brd/scripts/grounding-check.js'),
    '--frd', path.join(dir, 'specs/brd/frd-requirements.json'),
    '--clarifications', path.join(dir, 'specs/brd/clarification-log.json'),
    '--brd', path.join(dir, 'specs/brd/brd-adoption.json'),
    '--out', path.join(dir, 'specs/reviews/brd-grounding.json'),
  ]);
  const grounding = readJson(dir, 'specs/reviews/brd-grounding.json');
  assert.strictEqual(grounding.pass, true, JSON.stringify(grounding));
  execFileSync(process.execPath, [
    path.join(ROOT, '.claude/scripts/brd-taxonomy-check.js'),
    '--requirements', path.join(dir, 'specs/brd/brd-requirements.json'),
    '--coverage', path.join(dir, 'specs/brd/taxonomy-coverage.json'),
    '--out', path.join(dir, 'specs/reviews/brd-taxonomy.json'),
  ]);
  const tax = readJson(dir, 'specs/reviews/brd-taxonomy.json');
  assert.strictEqual(tax.pass, true, JSON.stringify(tax));
});

test('/brd --prd defaults to lean and does not auto-eval on auth', () => {
  const brd = fs.readFileSync(path.join(ROOT, '.claude/skills/brd/SKILL.md'), 'utf8');
  assert.match(brd, /prd-lean\.md/);
  assert.match(brd, /without `--full`/);
  assert.match(brd, /Auth, tenant/);
  assert.doesNotMatch(brd, /or the BRD introduces\n?an auth/);
});

test('lean brd.md lists clarification-recorded risks, not only PRD risks', () => {
  const { render } = require(path.join(ROOT, '.claude/scripts/brd-lean-write.js'));
  const md = render({
    title: 'Shortlink',
    sourceRel: 'docs/shortlink-prd.md',
    reqs: [{ id: 'FRD-1' }],
    safeguards: [],
    questions: [],
    clarifications: [{
      id: 'C2',
      question: 'Should this tension be recorded as a risk?',
      answer: 'Yes - recorded as a risk.',
    }],
    risks: [],
  });
  assert.match(md, /\*\*C2\*\* \(clarification\)/);
  assert.doesNotMatch(md, /none listed in the PRD/);
});

test('/build --auto and --lite escalate onto lean /brd --prd', () => {
  const auto = fs.readFileSync(path.join(ROOT, '.claude/skills/build/references/section-03-approval-model.md'), 'utf8');
  const phase = fs.readFileSync(path.join(ROOT, '.claude/skills/build/references/section-04-pipeline-phases.md'), 'utf8');
  const lite = fs.readFileSync(path.join(ROOT, '.claude/skills/build/references/lite-lane.md'), 'utf8');
  assert.match(auto, /lean adopt-only/);
  assert.match(phase, /lean adopt-only/);
  assert.match(lite, /lean `\/brd --prd`/);
  assert.match(lite, /\/brd --prd path\/to\/prd\.md/);
});
