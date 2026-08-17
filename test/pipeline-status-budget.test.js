'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'pipeline-status.js');
const { buildSnapshot, renderStatus } = require(script);

const NOW = '2026-06-21T12:00:00.000Z';

function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-budget-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'runs'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

test('budget is null and the Budget line is omitted when no run is metered', () => {
  const snap = buildSnapshot(makeProject(), { now: NOW });
  assert.strictEqual(snap.budget, null);
  assert.doesNotMatch(renderStatus(snap), /Budget:/);
});

test('buildSnapshot meters the budget from the start marker + receipts and renders it', () => {
  const startMs = Date.parse(NOW) - 31 * 60000; // 31 minutes into the run
  const dir = makeProject({
    'project-manifest.json': JSON.stringify({ execution: { model_tier: 'cost' } }),
    '.claude/state/budget-start': String(startMs),
    '.claude/runs/2026-06-21.jsonl':
      Array.from({ length: 80 }, (_, i) => JSON.stringify({ kind: 'subagent', agent: 'generator', ts: startMs + i })).join('\n') + '\n',
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.budget.exhausted, true); // 31m > 30m cap and 80/80 agents
  assert.strictEqual(snap.budget.band, 'exhausted');

  const out = renderStatus(snap);
  assert.match(out, /Budget:\s+31m\/30m wall/);
  assert.match(out, /80\/80 agents/);
  assert.match(out, /\[exhausted\]/);
});

test('a budget of "off" in the manifest disables metering even with a start marker', () => {
  const dir = makeProject({
    'project-manifest.json': JSON.stringify({ execution: { model_tier: 'cost', budget: 'off' } }),
    '.claude/state/budget-start': String(Date.parse(NOW) - 60000),
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.budget, null);
});

test('a healthy mid-run budget renders an ok band', () => {
  const startMs = Date.parse(NOW) - 10 * 60000; // 10m into a 90m balanced cap
  const dir = makeProject({
    'project-manifest.json': JSON.stringify({ execution: { model_tier: 'balanced' } }),
    '.claude/state/budget-start': String(startMs),
    '.claude/runs/2026-06-21.jsonl':
      Array.from({ length: 12 }, (_, i) => JSON.stringify({ kind: 'subagent', agent: 'generator', ts: startMs + i })).join('\n') + '\n',
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.budget.band, 'ok');
  assert.match(renderStatus(snap), /Budget:\s+10m\/90m wall \(11%\) · 12\/200 agents/);
});

test('cost line shows model mix when budget-start is set', () => {
  const startMs = Date.parse(NOW) - 5 * 60000;
  const dir = makeProject({
    'project-manifest.json': JSON.stringify({ execution: { model_tier: 'cost' } }),
    '.claude/state/budget-start': String(startMs),
    '.claude/runs/2026-06-21.jsonl': [
      { kind: 'subagent', agent: 'generator', model: 'claude-sonnet-5', ts: startMs + 1 },
      { kind: 'subagent', agent: 'evaluator', model: 'claude-opus-4-8', ts: startMs + 2 },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n',
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.ok(snap.cost);
  assert.strictEqual(snap.cost.source, 'estimate');
  assert.strictEqual(snap.cost.agents, 2);
  assert.match(renderStatus(snap), /Cost:\s+~\$/);
  assert.match(renderStatus(snap), /source=estimate/);
  assert.match(renderStatus(snap), /sonnet-5=1/);
});

test('cost line uses the persisted transcript rollup when no budget-start exists', () => {
  const dir = makeProject({
    '.claude/state/phase-cost.json': JSON.stringify({
      generated_at: NOW,
      grand_usd: 1.25,
      totals: [
        { command: 'brd', runs: 1, cost_usd: 1.0, output_tokens: 100 },
        { command: 'spec', runs: 1, cost_usd: 0.25, output_tokens: 20 },
      ],
      rows: [
        { command: 'brd', model: 'claude-opus-5', cost_usd: 1.0, input_tokens: 10, output_tokens: 100, cache_read_tokens: 0 },
      ],
    }),
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.ok(snap.cost);
  assert.strictEqual(snap.cost.source, 'transcript');
  assert.strictEqual(snap.cost.est_cost_usd, 1.25);
  assert.ok(snap.phase_cost);
  const out = renderStatus(snap);
  assert.match(out, /Cost:\s+~\$1\.25/);
  assert.match(out, /source=transcript/);
  assert.match(out, /Phases:\s+\/brd=\$1\.00 · \/spec=\$0\.25/);
});
