'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readResult, buildProofComment } = require('../src/orchestrator/result-reader');

test('readResult reads tracker run result contract', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'symphony-result-'));
  const resultDir = path.join(dir, '.claude', 'state', 'tracker-runs', 'A');
  await fs.mkdir(resultDir, { recursive: true });
  await fs.writeFile(path.join(resultDir, 'result.json'), JSON.stringify({
    group: 'A',
    status: 'human_review',
    summary: 'done'
  }));

  const output = await readResult(dir, 'A');
  assert.equal(output.result.status, 'human_review');
  assert.equal(output.result.summary, 'done');
});

test('buildProofComment includes PR and reports', () => {
  const comment = buildProofComment(
    { key: 'ENG-101' },
    { id: 'A' },
    { result: { status: 'human_review', reports: ['specs/reviews/evaluator-report.md'], tests: ['npm test: passed'] } },
    'https://github.com/org/repo/pull/1'
  );

  assert.match(comment, /Claude Harness Proof/);
  assert.match(comment, /ENG-101/);
  assert.match(comment, /pull\/1/);
  assert.match(comment, /evaluator-report/);
});
