'use strict';

// cacheProfile answers "why did this phase cost that" in cache terms.
//
// Shapes taken from the 2026-08-21 sprint-1 baseline run, where output was
// $2.70 of $47.97 and the other 94% was cache read + cache write.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { cacheProfile } = require('../.claude/hooks/lib/phase-cost-core.js');

const T0 = Date.parse('2026-08-21T16:20:00.000Z');

function line(over) {
  const { ts, id, model = 'claude-sonnet-5', cr = 0, cw = 0, ttl = '5m', text = 'x', sidechain = false } = over;
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: new Date(ts).toISOString(),
    isSidechain: sidechain,
    message: {
      id, model, role: 'assistant', content: [{ type: 'text', text }],
      usage: {
        input_tokens: 2, output_tokens: 10,
        cache_read_input_tokens: cr, cache_creation_input_tokens: cw,
        cache_creation: {
          ephemeral_5m_input_tokens: ttl === '5m' ? cw : 0,
          ephemeral_1h_input_tokens: ttl === '1h' ? cw : 0,
        },
      },
    },
  })}`;
}

function userLine(ts, text) {
  return JSON.stringify({ type: 'user', timestamp: new Date(ts).toISOString(), message: { role: 'user', content: text } });
}

function write(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-profile-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

test('a mid-session cache expiry is counted; the cold start is not', () => {
  const file = write([
    userLine(T0, '/auto'),
    line({ ts: T0 + 1000, id: 'm1', cw: 30000, cr: 0 }),          // cold start — NOT a miss
    line({ ts: T0 + 2000, id: 'm2', cw: 2000, cr: 30000 }),        // healthy incremental append
    line({ ts: T0 + 900_000, id: 'm3', cw: 120000, cr: 0 }),       // 15 min idle -> TTL expiry
  ]);
  const [phase] = cacheProfile(file);
  assert.equal(phase.command, 'auto');
  assert.equal(phase.full_misses, 1, 'only the mid-session rewrite is waste');
  assert.equal(phase.full_miss_tokens, 120000);
  assert.deepEqual(phase.idle_gaps_sec, [898]);
});

test('wasted_usd is the rewrite premium, not the gross write', () => {
  const file = write([
    userLine(T0, '/auto'),
    line({ ts: T0 + 1000, id: 'm1', cw: 10000, cr: 0 }),
    line({ ts: T0 + 900_000, id: 'm2', cw: 100000, cr: 0 }),
  ]);
  const [phase] = cacheProfile(file);
  // Sonnet base $3/MTok: a write is 1.25x ($3.75/M), a read 0.1x ($0.30/M).
  // The context had to be paid for once either way, so only the gap is waste.
  const expected = 100000 * 3e-6 * (1.25 - 0.1);
  assert.ok(Math.abs(phase.wasted_usd - expected) < 1e-6,
    `expected ~$${expected.toFixed(4)}, got $${phase.wasted_usd}`);
});

test('an incremental append below the floor is never a miss', () => {
  const file = write([
    userLine(T0, '/auto'),
    line({ ts: T0 + 1000, id: 'm1', cw: 30000, cr: 0 }),
    line({ ts: T0 + 900_000, id: 'm2', cw: 500, cr: 0 }),
  ]);
  assert.equal(cacheProfile(file)[0].full_misses, 0);
});

test('the TTL split is reported, since subagents get no 1h caching', () => {
  const file = write([
    userLine(T0, '/auto'),
    line({ ts: T0 + 1000, id: 'm1', cw: 70000, cr: 0, ttl: '1h' }),
    line({ ts: T0 + 2000, id: 'm2', cw: 5000, cr: 70000, ttl: '5m' }),
  ]);
  const [phase] = cacheProfile(file);
  assert.equal(phase.ttl_1h_tokens, 70000);
  assert.equal(phase.ttl_5m_tokens, 5000);
});

test('misses are attributed to the phase whose window they fall in', () => {
  const file = write([
    userLine(T0, '/spec'),
    line({ ts: T0 + 1000, id: 'm1', cw: 30000, cr: 0 }),
    line({ ts: T0 + 900_000, id: 'm2', cw: 90000, cr: 0 }),
    userLine(T0 + 1_800_000, '/auto'),
    line({ ts: T0 + 1_801_000, id: 'm3', cw: 4000, cr: 120000 }),  // healthy append: isolates attribution
    line({ ts: T0 + 2_700_000, id: 'm4', cw: 150000, cr: 0 }),
  ]);
  const byCmd = Object.fromEntries(cacheProfile(file).map((p) => [p.command, p]));
  assert.equal(byCmd.spec.full_misses, 1);
  assert.equal(byCmd.spec.full_miss_tokens, 90000);
  assert.equal(byCmd.auto.full_misses, 1);
  assert.equal(byCmd.auto.full_miss_tokens, 150000);
});

test('a subagent transcript is pooled into the dispatching phase and keeps its own cold start', () => {
  const main = write([userLine(T0, '/auto'), line({ ts: T0 + 1000, id: 'm1', cw: 30000, cr: 0 })]);
  const sub = path.join(path.dirname(main), 'agent-a1.jsonl');
  fs.writeFileSync(sub, `${[
    line({ ts: T0 + 2000, id: 's1', cw: 18000, cr: 0 }),          // the agent's own cold start
    line({ ts: T0 + 1_000_000, id: 's2', cw: 300000, cr: 0 }),     // its mid-run expiry
  ].join('\n')}\n`);
  const [phase] = cacheProfile(main, { extraTranscripts: [sub] });
  assert.equal(phase.full_misses, 1, "a subagent's first turn is a cold start, not waste");
  assert.equal(phase.full_miss_tokens, 300000);
});

test('a phase with no cache activity reports zeros rather than throwing', () => {
  const file = write([userLine(T0, '/brd')]);
  const [phase] = cacheProfile(file);
  assert.equal(phase.full_misses, 0);
  assert.equal(phase.cache_read_tokens, 0);
  assert.deepEqual(phase.idle_gaps_sec, []);
});
