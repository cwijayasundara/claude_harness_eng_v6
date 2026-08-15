'use strict';

// Lit-factory P2: sealed /auto pack, test_discipline default, review never merges.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');
const { buildManifest, defaultTestDiscipline } = require('../.claude/scripts/scaffold-render');
const { loadTestDiscipline } = require('../.claude/hooks/lib/test-discipline');
const { decideLock } = require('../.claude/hooks/lib/test-write-lock');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('auto corpus names the sealed planning pack', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /Sealed planning pack/);
  for (const needle of [
    'specs/reviews/plan-seal.json',
    'features.json',
    'program-design.md',
    'component-map.md',
    'test-plan.md',
    'verification-matrix.json',
  ]) {
    assert.match(auto, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), needle);
  }
  assert.match(auto, /Do not reload `?\/brd`?/);
  assert.match(auto, /code-gen\/SKILL\.md/);
});

test('/auto --sealed stops at a draft PR and does not merge by default', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /Draft PR is the stop/);
  assert.match(auto, /quality-card\.js/);
  assert.match(auto, /pr-walkthrough\.js/);
  assert.match(auto, /Do not merge/);
  assert.match(auto, /AUTO_MERGE/);
});

test('scaffold-render defaults quality.test_discipline to outcomes', () => {
  assert.strictEqual(defaultTestDiscipline({}), 'outcomes');
  const manifest = buildManifest({
    name: 'web',
    projectType: 'A',
    stack: {
      backend: { language: 'python', framework: 'fastapi' },
      frontend: { language: 'typescript', framework: 'react' },
      database: null,
    },
  });
  assert.strictEqual(manifest.quality.test_discipline, 'outcomes');
  const tdd = buildManifest({
    name: 'cli',
    projectType: 'D',
    testDiscipline: 'tdd',
    stack: { backend: { language: 'javascript' }, frontend: null, database: null },
  });
  assert.strictEqual(tdd.quality.test_discipline, 'tdd');
});

test('root project-manifest.json records outcomes', () => {
  const m = JSON.parse(read('project-manifest.json'));
  assert.strictEqual(m.quality.test_discipline, 'outcomes');
});

test('/gate forbids approve and merge', () => {
  const gate = readSkillCorpus('gate');
  assert.match(gate, /never approve or merge/i);
  assert.match(gate, /not\*\* approve/i);
  assert.match(gate, /not\*\* merge/i);
  assert.match(gate, /component-map\.md/);
  assert.match(gate, /program-design\.md/);
});

test('/implement and code-gen read test_discipline', () => {
  assert.match(readSkillCorpus('implement'), /test_discipline/);
  assert.match(readSkillCorpus('implement'), /outcomes/);
  assert.match(readSkillCorpus('code-gen'), /quality\.test_discipline/);
  assert.match(readSkillCorpus('code-gen'), /`outcomes` \(default\)/);
});

test('Gate 8 / implement Step 7 name Standards vs Spec and do not merge scores', () => {
  const auto = readSkillCorpus('auto');
  const implement = readSkillCorpus('implement');
  assert.match(auto, /Standards/);
  assert.match(auto, /Spec/);
  assert.match(auto, /Do not merge their scores/);
  assert.match(implement, /Do not merge their scores/);
  assert.match(auto, /review-tier\.js/);
});

test('test-integrity CLI is a no-op under outcomes', () => {
  const { evaluate } = require('../.claude/scripts/test-integrity-gate');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'disc-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    quality: { test_discipline: 'outcomes' },
  }));
  const result = evaluate(dir);
  assert.strictEqual(result.reason, 'discipline-not-tdd');
  assert.strictEqual(result.pass, true);
});

test('outcomes discipline skips the tdd write-lock', () => {
  assert.strictEqual(loadTestDiscipline(null, { HARNESS_TEST_DISCIPLINE: 'outcomes' }), 'outcomes');
  const d = decideLock({
    ledger: { state: 'valid', events: [], errors: [] },
    filePath: 'tests/test_a.py',
    contentHash: 'abc',
    env: { HARNESS_TEST_DISCIPLINE: 'outcomes' },
  });
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.reason, 'discipline-not-tdd');
});

test('walkthrough 5-minute script tells the agent not to merge', () => {
  const src = read('.claude/scripts/pr-walkthrough.js');
  assert.match(src, /never approves or merges/);
});
