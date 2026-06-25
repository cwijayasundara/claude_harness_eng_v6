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
