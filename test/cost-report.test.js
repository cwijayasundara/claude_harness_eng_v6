'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { buildReport, fmtReport } = require('../.claude/scripts/cost-report');

function makeProject(receipts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-report-'));
  fs.mkdirSync(path.join(dir, '.claude', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({
    execution: { model_tier: 'cost' },
  }));
  fs.writeFileSync(
    path.join(dir, '.claude', 'runs', '2026-07-11.jsonl'),
    receipts.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  return dir;
}

test('buildReport tallies model mix and roles from fixture receipts', () => {
  const dir = makeProject([
    { kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5', ts: 1 },
    { kind: 'subagent', agent: 'evaluator', model: 'claude-opus-4-8', ts: 2 },
    { kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 500, ts: 3 },
    { kind: 'prompt', ts: 4 },
  ]);
  try {
    const report = buildReport(dir);
    assert.strictEqual(report.agents, 3);
    assert.strictEqual(report.source, 'mixed');
    assert.strictEqual(report.model_mix['claude-sonnet-5'].agents, 2);
    assert.strictEqual(report.model_mix['claude-opus-4-8'].agents, 1);
    assert.strictEqual(report.agents_by_role.generator, 2);
    assert.strictEqual(report.agents_by_role.evaluator, 1);
    assert.ok(report.est_cost_usd > 0);
    const text = fmtReport(report);
    assert.match(text, /Cost report/);
    assert.match(text, /claude-sonnet-5/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildReport is empty-safe when no runs dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-report-empty-'));
  try {
    const report = buildReport(dir);
    assert.strictEqual(report.agents, 0);
    assert.strictEqual(report.est_cost_usd, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
