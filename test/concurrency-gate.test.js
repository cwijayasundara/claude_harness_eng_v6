'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const GATE = path.join(__dirname, '..', '.claude', 'hooks', 'concurrency-gate.js');
const { decideSpawn, decideStop, resolveCap, normalizeState } = require(GATE);

const NOW = 1_000_000_000_000;
const TTL = 30 * 60 * 1000;

test('decideSpawn allows under cap and appends now', () => {
  const r = decideSpawn({ active: [NOW - 1000] }, { cap: 3, now: NOW, ttlMs: TTL });
  assert.strictEqual(r.allow, true);
  assert.deepStrictEqual(r.state.active, [NOW - 1000, NOW]);
});

test('decideSpawn denies at cap and does not grow state', () => {
  const r = decideSpawn({ active: [NOW - 1, NOW - 2, NOW - 3] }, { cap: 3, now: NOW, ttlMs: TTL });
  assert.strictEqual(r.allow, false);
  assert.match(r.reason, /cap reached/i);
  assert.strictEqual(r.state.active.length, 3);
});

test('decideSpawn prunes stale entries before counting (TTL self-heal)', () => {
  const stale = [NOW - TTL - 1, NOW - TTL - 2, NOW - TTL - 3];
  const r = decideSpawn({ active: stale }, { cap: 3, now: NOW, ttlMs: TTL });
  assert.strictEqual(r.allow, true, 'all entries stale → count resets → allowed');
  assert.deepStrictEqual(r.state.active, [NOW]);
});

test('decideStop drops the oldest and prunes stale', () => {
  const r = decideStop({ active: [NOW - TTL - 5, NOW - 100, NOW - 50] }, { now: NOW, ttlMs: TTL });
  assert.deepStrictEqual(r.state.active, [NOW - 50]); // stale pruned, oldest live dropped
});

test('normalizeState defaults malformed input to empty', () => {
  assert.deepStrictEqual(normalizeState(null), { active: [] });
  assert.deepStrictEqual(normalizeState({ active: 'nope' }), { active: [] });
  assert.deepStrictEqual(normalizeState({ active: [1, 'x', 2] }), { active: [1, 2] });
});

test('resolveCap precedence: manifest > env > default 15', () => {
  assert.strictEqual(resolveCap({ execution: { max_concurrent_agents: 8 } }, {}), 8);
  assert.strictEqual(resolveCap(null, { CLAUDE_MAX_CONCURRENT_AGENTS: '6' }), 6);
  assert.strictEqual(resolveCap(null, {}), 15);
  assert.strictEqual(resolveCap({ execution: {} }, { CLAUDE_MAX_CONCURRENT_AGENTS: '0' }), 15);
});

// ---- wrapper integration (spawn the hook with a stdin payload) ----

function runGate(payload, env) {
  return spawnSync('node', [GATE], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('hook denies (exit 2) a Task spawn when state is at cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gate-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, '.claude', 'state', 'inflight-agents.json'),
    JSON.stringify({ active: [now, now, now] }));
  const r = runGate({ hook_event_name: 'PreToolUse', tool_name: 'Task' },
    { CLAUDE_PROJECT_DIR: dir, CLAUDE_MAX_CONCURRENT_AGENTS: '3' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /cap reached/i);
});

test('hook allows (exit 0) a Task spawn under cap and records it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gate-'));
  const r = runGate({ hook_event_name: 'PreToolUse', tool_name: 'Task' },
    { CLAUDE_PROJECT_DIR: dir, CLAUDE_MAX_CONCURRENT_AGENTS: '3' });
  assert.strictEqual(r.status, 0);
  const state = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'state', 'inflight-agents.json'), 'utf8'));
  assert.strictEqual(state.active.length, 1);
});

test('hook ignores non-Task PreToolUse (exit 0, no state)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gate-'));
  const r = runGate({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, { CLAUDE_PROJECT_DIR: dir });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.existsSync(path.join(dir, '.claude', 'state', 'inflight-agents.json')), false);
});

test('hook fails open (exit 0) on malformed stdin', () => {
  const r = spawnSync('node', [GATE], { input: 'not json', encoding: 'utf8', env: { ...process.env } });
  assert.strictEqual(r.status, 0);
});
