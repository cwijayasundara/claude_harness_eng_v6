'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const qc = require('../.claude/scripts/quality-card.js');

function fixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-'));
  fs.mkdirSync(path.join(dir, 'specs/reviews'), { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(dir, 'specs/reviews', f), typeof o === 'string' ? o : JSON.stringify(o));
  w('evaluator-report.md', 'VERDICT: PASS');
  w('code-review-verdict.json', { pass: true, summary: { block: 0, warn: 2 } });
  w('regression-gate-verdict.json', { verdict: 'no-baseline' });
  w('security-verdict.json', { pass: false, summary: '1 high' });
  return dir;
}

test('quality-card output is byte-stable after refactor', () => {
  const { card, md } = qc.buildCard({ root: fixtureRoot() });
  delete card.generated_at;
  const goldJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/quality-card-golden.json'), 'utf8'));
  const goldMd = fs.readFileSync(path.join(__dirname, 'fixtures/quality-card-golden.md'), 'utf8');
  assert.deepStrictEqual(card, goldJson);
  assert.strictEqual(md.replace(/^Generated: .*$/m, 'Generated: FIXED'), goldMd);
});

test('empty evaluator-report.md is treated as missing, failing the card', () => {
  const dir = fixtureRoot();
  fs.writeFileSync(path.join(dir, 'specs/reviews/evaluator-report.md'), '');
  const { card } = qc.buildCard({ root: dir });
  const evaluatorCheck = card.checks.find((c) => c.key === 'evaluator');
  assert.strictEqual(evaluatorCheck.status, 'missing');
  assert.strictEqual(card.pass, false);
});
