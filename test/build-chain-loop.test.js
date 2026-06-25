// test/build-chain-loop.test.js
'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { runChain, claudeArgsFor, promptFor } = require('../.claude/scripts/build-chain.js');
const { STATES } = require('../.claude/scripts/build-chain-state.js');
const { parseBuildInvocation } = require('../.claude/scripts/build-lane.js');

// A scripted fake: each loadState() call returns the next queued block.
function scripted(blocks) {
  let i = 0;
  return () => blocks[Math.min(i++, blocks.length - 1)];
}
const block = (groups, passing, done) => ({
  groupsRemaining: groups,
  featuresPassing: passing,
  nextAction: done ? 'DONE — all groups complete' : 'CONTINUE',
  found: true,
});

test('happy path: plan -> two build waves -> finalize -> DONE', async () => {
  const calls = [];
  const res = await runChain({
    spawnLink: (kind) => { calls.push(kind); return { ok: true }; },
    // loadState is read at top of loop, then after each build link:
    // [top: 2 groups] build -> [after: 1 group] [top: 1 group] build -> [after: done] [top: done]
    loadState: scripted([
      block(['A', 'B'], 0, false),  // top of loop #1
      block(['B'], 5, false),       // after build #1
      block(['B'], 5, false),       // top of loop #2
      block([], 11, true),          // after build #2
      block([], 11, true),          // top of loop #3 -> complete -> finalize
    ]),
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.DONE);
  assert.deepStrictEqual(calls, ['PLAN', 'BUILD', 'BUILD', 'FINALIZE']);
  assert.strictEqual(res.links, 2);
});

test('stall: build links that add no passing feature stop loudly as STUCK', async () => {
  const res = await runChain({
    spawnLink: () => ({ ok: true }),
    loadState: scripted([block(['A'], 7, false)]), // never advances, never completes
    maxNoProgress: 3,
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.STUCK);
  assert.match(res.reason, /progress/i);
});

test('budget: too many links stop as STUCK', async () => {
  let passing = 0;
  const res = await runChain({
    spawnLink: () => ({ ok: true }),
    // always one group left, but passing rises each link so the stall guard
    // never fires — the budget cap is what must stop it.
    loadState: () => block(['A'], passing++, false),
    maxLinks: 4,
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.STUCK);
  assert.match(res.reason, /budget|link/i);
});

test('budget: an exhausted compute budget stops the chain as STUCK between links', async () => {
  let passing = 0;
  let link = 0;
  const res = await runChain({
    spawnLink: () => ({ ok: true }),
    loadState: () => block(['A'], passing++, false), // progress rises; stall guard never fires
    // budget is fine for the first link, exhausted before the second
    checkBudget: () => (link++ >= 1 ? { exhausted: true, reason: 'budget exhausted (exhausted)' } : null),
    maxLinks: 50,
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.STUCK);
  assert.match(res.reason, /budget exhausted/i);
  assert.strictEqual(res.links, 1, 'halts at the clean boundary after the first link');
});

test('a failed PLAN link is terminal STUCK', async () => {
  const res = await runChain({
    spawnLink: (kind) => ({ ok: kind !== 'PLAN' }),
    loadState: scripted([block(['A'], 0, false)]),
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.STUCK);
  assert.match(res.reason, /plan/i);
});

test('a failed BUILD link retries once sequential before counting no-progress', async () => {
  const opts = [];
  let calls = 0;
  const res = await runChain({
    spawnLink: (kind, o = {}) => {
      if (kind === 'BUILD') { opts.push(o.sequential === true); }
      // first BUILD (wave) fails, the sequential retry succeeds and completes
      if (kind === 'BUILD') { calls++; return { ok: calls > 1 }; }
      return { ok: true };
    },
    loadState: scripted([
      block(['A'], 0, false),  // top: work remains
      block([], 4, true),      // after the successful sequential retry: done
      block([], 4, true),      // top: complete -> finalize
    ]),
    log: () => {},
  });
  assert.deepStrictEqual(opts, [false, true]); // wave attempt, then sequential retry
  assert.strictEqual(res.state, STATES.DONE);
});

test('a BUILD link whose wave and sequential retry both fail counts as no-progress -> STUCK', async () => {
  const res = await runChain({
    spawnLink: (kind) => ({ ok: kind !== 'BUILD' }), // PLAN ok, every BUILD attempt fails
    loadState: scripted([block(['A'], 0, false)]),    // never advances, never completes
    maxNoProgress: 2,
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.STUCK);
  assert.match(res.reason, /progress/i);
});

test('a failed FINALIZE link is terminal STUCK', async () => {
  const res = await runChain({
    spawnLink: (kind) => ({ ok: kind !== 'FINALIZE' }), // PLAN+BUILD ok, FINALIZE fails
    loadState: scripted([block([], 4, true)]),          // already complete -> straight to finalize
    log: () => {},
  });
  assert.strictEqual(res.state, STATES.STUCK);
  assert.match(res.reason, /finalize/i);
});

test('real claude args use the unattended settings profile when requested', () => {
  const args = claudeArgsFor({
    model: 'opus',
    pluginDir: '/tmp/harness/.claude',
    settings: '.claude/settings.auto.json',
    strictMcp: true,
    maxBudgetUsd: '25',
  });

  assert.deepStrictEqual(args, [
    '-p',
    '--model', 'opus',
    '--plugin-dir', '/tmp/harness/.claude',
    '--settings', '.claude/settings.auto.json',
    '--strict-mcp-config',
    '--max-budget-usd', '25',
  ]);
});

test('build-chain PLAN and FINALIZE prompts parse as valid build lanes', () => {
  const plan = parseBuildInvocation(promptFor(STATES.PLAN, 'docs/prd.md'));
  const finalize = parseBuildInvocation(promptFor(STATES.FINALIZE, 'docs/prd.md'));

  assert.strictEqual(plan.valid, true);
  assert.strictEqual(plan.lane, 'auto');
  assert.strictEqual(plan.planOnly, true);
  assert.strictEqual(plan.prdPath, 'docs/prd.md');

  assert.strictEqual(finalize.valid, true);
  assert.strictEqual(finalize.lane, 'finalize');
  assert.strictEqual(finalize.requiresPrd, false);
});
