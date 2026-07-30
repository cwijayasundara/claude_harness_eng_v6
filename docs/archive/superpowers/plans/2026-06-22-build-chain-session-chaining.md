# Build-Chain: Cross-Process Session Chaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a headless `/build --auto` run on a multi-story PRD reach an open PR by spawning a fresh `claude -p` per build wave, surviving past the single-process ~40-minute wall.

**Architecture:** A new node driver (`.claude/scripts/build-chain.js`) owns process lifecycle. It runs links in sequence — one PLAN link, N BUILD links (each a fresh `claude -p` doing exactly one wave via a new `/auto --once` mode), then one FINALIZE link (`/build --auto --finalize`, Phases 9→9.5→10→11). Between links it reads only state the harness already writes (`claude-progress.txt` last block + `features.json`). Pure decision logic lives in a sibling module (`.claude/scripts/build-chain-state.js`) so it is unit-testable without spawning `claude`.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test`, `child_process.spawnSync`. No new dependencies. Skill changes are Markdown prose in `.claude/skills/`.

## Global Constraints

- Functions ≤ 30 lines; files ≤ 300 lines (harness gates enforce these on top-level `function`s and file length).
- No `any`-style untyped sloppiness; small pure functions with documented inputs/outputs.
- TDD: failing test first, then minimal implementation.
- The harness **never merges** — FINALIZE opens a PR, never merges.
- **No PR over a red build** — FINALIZE gates Phase 11 on all-features-pass + green `/gate`.
- Voluntary yield: each link exits cleanly *after* commit + checkpoint, so SIGKILL never lands mid-write.
- `--pod` per-cluster chaining is **out of scope for v1** (design-compatible, not built).
- Trust order for "what passed": git + `features.json` over `claude-progress.txt`.
- Commit messages end with the harness Co-Authored-By trailer; work on a feature branch, never `main`.

### Exact handoff strings (copied from the codebase — the contract the driver keys off)

From `.claude/skills/auto/SKILL.md` SECTION 10 the session block in `claude-progress.txt` contains:
```
groups_remaining: [D, E, F]      # or [] when none remain
features_passing: 47 / 203
next_action: <text>              # "DONE …" marks completion
```
The auto-continue watchdog (`.claude/hooks/auto-continue-on-stop.js:98,104,138`) treats:
- completion as `/^DONE\b/i.test(next_action)`,
- a non-empty remaining list as the regex `/\[\s*[^\]\s]/` matching `groups_remaining`,
- progress as the integer numerator of `features_passing: X / Y`.

The driver reuses **exactly these conventions** so the cross-process decision matches the in-session one.

---

## File Structure

| File | Responsibility |
|---|---|
| `.claude/scripts/build-chain-state.js` (create) | Pure decision helpers: parse the last progress block, decide the next phase, stall + budget checks. No I/O beyond receiving text. |
| `.claude/scripts/build-chain.js` (create) | The driver: `runChain(deps)` orchestration loop + a real-deps CLI entrypoint that spawns `claude -p` per link. |
| `test/build-chain-state.test.js` (create) | Unit tests for every pure helper. |
| `test/build-chain-loop.test.js` (create) | Tests `runChain` with injected fake `spawnLink`/`loadState` (no real `claude`). |
| `test/build-chain-contract.test.js` (create) | Static assertions that `/auto --once` and `/build --auto --finalize` are wired in the skills. |
| `.claude/skills/auto/SKILL.md` (modify) | Add `--once` single-wave mode (usage + a new subsection). |
| `.claude/skills/build/SKILL.md` (modify) | Add `--finalize` alias (Phases 9→9.5→10→11 only). |
| `.claude/skills/build/references/autonomous-lane.md` (modify) | Document the chain driver + links. |
| `package.json` (modify) | Add `build:chain` and `test:chain` scripts. |
| `test/e2e/fixtures/multi-story-prd.md` (create) | A small 2-cluster PRD that needs ≥2 build links — the live proof input. |
| `test/e2e/harness-chain-run.test.js` (create) | Opt-in live e2e: driver on the multi-story PRD reaches an open PR. |
| `README.md` (modify) | One row/line in Operating modes pointing at the chain driver. |

---

## Task 1: Pure state helpers + unit tests

**Files:**
- Create: `.claude/scripts/build-chain-state.js`
- Test: `test/build-chain-state.test.js`

**Interfaces:**
- Produces:
  - `STATES = { PLAN, BUILD, FINALIZE, DONE, STUCK }` (string constants).
  - `parseLastBlock(progressText: string) -> { groupsRemaining: string[], nextAction: string, featuresPassing: number, found: boolean }`
  - `isBuildComplete(block) -> boolean` — true when `nextAction` starts with `DONE` (case-insensitive) OR `groupsRemaining.length === 0`.
  - `nextPhase(currentPhase: string, block) -> string` — `PLAN→BUILD`; `BUILD→(FINALIZE if isBuildComplete else BUILD)`; `FINALIZE→DONE`.
  - `stallExceeded(noProgressStreak: number, max: number) -> boolean` — `noProgressStreak >= max`.
  - `budgetExceeded(linkCount: number, max: number) -> boolean` — `linkCount >= max`.

- [ ] **Step 1: Write the failing test**

```js
// test/build-chain-state.test.js
'use strict';

const assert = require('assert');
const { test } = require('node:test');
const S = require('../.claude/scripts/build-chain-state.js');

const BLOCK_MID = [
  '=== Session 3 ===',
  'groups_remaining: [D, E, F]',
  'features_passing: 47 / 203',
  'next_action: Run evaluator against group D',
].join('\n');

const BLOCK_DONE = [
  '=== Session 9 ===',
  'groups_remaining: []',
  'features_passing: 203 / 203',
  'next_action: DONE — all groups complete',
].join('\n');

// When two session blocks exist, only the LAST is parsed.
const TWO_BLOCKS = `${BLOCK_MID}\n\n${BLOCK_DONE}`;

test('parseLastBlock reads the final block only', () => {
  const b = S.parseLastBlock(TWO_BLOCKS);
  assert.deepStrictEqual(b.groupsRemaining, []);
  assert.strictEqual(b.featuresPassing, 203);
  assert.match(b.nextAction, /^DONE/);
  assert.strictEqual(b.found, true);
});

test('parseLastBlock parses a non-empty remaining list', () => {
  const b = S.parseLastBlock(BLOCK_MID);
  assert.deepStrictEqual(b.groupsRemaining, ['D', 'E', 'F']);
  assert.strictEqual(b.featuresPassing, 47);
});

test('parseLastBlock on empty/garbage text reports not found', () => {
  const b = S.parseLastBlock('');
  assert.strictEqual(b.found, false);
  assert.deepStrictEqual(b.groupsRemaining, []);
  assert.strictEqual(b.featuresPassing, 0);
});

test('isBuildComplete is true on DONE next_action', () => {
  assert.strictEqual(S.isBuildComplete(S.parseLastBlock(BLOCK_DONE)), true);
});

test('isBuildComplete is true on empty groups_remaining even without DONE', () => {
  const b = S.parseLastBlock('groups_remaining: []\nnext_action: tidy up');
  assert.strictEqual(S.isBuildComplete(b), true);
});

test('isBuildComplete is false while groups remain', () => {
  assert.strictEqual(S.isBuildComplete(S.parseLastBlock(BLOCK_MID)), false);
});

test('nextPhase transitions', () => {
  assert.strictEqual(S.nextPhase(S.STATES.PLAN, S.parseLastBlock(BLOCK_MID)), S.STATES.BUILD);
  assert.strictEqual(S.nextPhase(S.STATES.BUILD, S.parseLastBlock(BLOCK_MID)), S.STATES.BUILD);
  assert.strictEqual(S.nextPhase(S.STATES.BUILD, S.parseLastBlock(BLOCK_DONE)), S.STATES.FINALIZE);
  assert.strictEqual(S.nextPhase(S.STATES.FINALIZE, S.parseLastBlock(BLOCK_DONE)), S.STATES.DONE);
});

test('stallExceeded and budgetExceeded are inclusive thresholds', () => {
  assert.strictEqual(S.stallExceeded(2, 3), false);
  assert.strictEqual(S.stallExceeded(3, 3), true);
  assert.strictEqual(S.budgetExceeded(49, 50), false);
  assert.strictEqual(S.budgetExceeded(50, 50), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-chain-state.test.js`
Expected: FAIL — `Cannot find module '../.claude/scripts/build-chain-state.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/scripts/build-chain-state.js
'use strict';

// Pure decision logic for the build-chain driver. No process spawning and no
// file I/O — every function takes already-read text or plain numbers so the
// cross-process orchestration can be unit-tested without invoking `claude`.
//
// The parsing conventions mirror .claude/hooks/auto-continue-on-stop.js so the
// cross-process chain makes the same "is there work left / did it progress"
// decision the in-session watchdog already makes.

const STATES = Object.freeze({
  PLAN: 'PLAN',
  BUILD: 'BUILD',
  FINALIZE: 'FINALIZE',
  DONE: 'DONE',
  STUCK: 'STUCK',
});

function lastBlockText(progressText) {
  const idx = progressText.lastIndexOf('=== Session');
  return idx === -1 ? progressText : progressText.slice(idx);
}

function field(text, name) {
  const m = text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

function parseGroups(listText) {
  const inner = (listText.match(/\[(.*)\]/) || [, ''])[1].trim();
  if (!inner) return [];
  return inner.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseLastBlock(progressText) {
  const text = lastBlockText(progressText || '');
  const found = /=== Session/.test(text) || /groups_remaining:/.test(text);
  const passingStr = field(text, 'features_passing'); // "47 / 203"
  return {
    groupsRemaining: parseGroups(field(text, 'groups_remaining')),
    nextAction: field(text, 'next_action'),
    featuresPassing: parseInt((passingStr.match(/(\d+)/) || [])[1] || '0', 10),
    found,
  };
}

function isBuildComplete(block) {
  if (/^DONE\b/i.test(block.nextAction)) return true;
  return block.groupsRemaining.length === 0;
}

function nextPhase(currentPhase, block) {
  if (currentPhase === STATES.PLAN) return STATES.BUILD;
  if (currentPhase === STATES.BUILD) return isBuildComplete(block) ? STATES.FINALIZE : STATES.BUILD;
  if (currentPhase === STATES.FINALIZE) return STATES.DONE;
  return STATES.DONE;
}

const stallExceeded = (streak, max) => streak >= max;
const budgetExceeded = (linkCount, max) => linkCount >= max;

module.exports = {
  STATES,
  parseLastBlock,
  isBuildComplete,
  nextPhase,
  stallExceeded,
  budgetExceeded,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-chain-state.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/build-chain-state.js test/build-chain-state.test.js
git commit -m "feat(build-chain): pure state-decision helpers for cross-process chaining"
```

---

## Task 2: Driver orchestration loop (`runChain`) with injected deps

**Files:**
- Create: `.claude/scripts/build-chain.js`
- Test: `test/build-chain-loop.test.js`

**Interfaces:**
- Consumes (from Task 1): `STATES`, `parseLastBlock`, `isBuildComplete`, `stallExceeded`, `budgetExceeded`.
- Produces:
  - `runChain(deps) -> Promise<{ state: string, reason: string, links: number }>` where `deps = { spawnLink, loadState, log?, maxLinks?, maxNoProgress? }`.
    - `spawnLink(kind: string, opts?: { sequential?: boolean }) -> { ok: boolean }` — `kind` is one of `'PLAN' | 'BUILD' | 'FINALIZE'`.
    - `loadState() -> block` — returns the object shape from `parseLastBlock`.
    - `maxLinks` default `50` (matches the SECTION 11 50-iteration hard stop).
    - `maxNoProgress` default `3` (a full wave yielding zero new passing features, three links running, is stuck — coarser than the in-session 5-turn budget because a link is a whole wave, not a turn).
  - Terminal result: `state` is `STATES.DONE` (PR raised) or `STATES.STUCK` (loud stop for a human).

This task implements **only `runChain`** + the module exports. The real `claude`-spawning deps come in Task 3-wiring (Task 5); the loop is proven here with fakes.

- [ ] **Step 1: Write the failing test**

```js
// test/build-chain-loop.test.js
'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { runChain } = require('../.claude/scripts/build-chain.js');
const { STATES } = require('../.claude/scripts/build-chain-state.js');

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-chain-loop.test.js`
Expected: FAIL — `runChain is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation (the loop + a real-deps CLI stub)**

```js
// .claude/scripts/build-chain.js
'use strict';

// Cross-process session-chaining driver. Spawns a FRESH `claude -p` per link so
// a long /build --auto run survives past a single process's lifetime:
//
//   PLAN  ->  /build --auto --plan-only <prd>     (writes specs/, features.json)
//   BUILD ->  /auto --once                        (one wave, commit, checkpoint, exit)  [loop]
//   FINAL ->  /build --auto --finalize            (Phases 9 -> 9.5 -> 10 -> 11, open PR)
//
// Between links it reads only state the harness already writes (claude-progress.txt
// + features.json). Decision logic lives in build-chain-state.js (pure, unit-tested).

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const S = require('./build-chain-state.js');

function done(state, reason, links) {
  return { state, reason, links };
}

// One BUILD wave, with a single sequential fallback if the wave link fails
// uncleanly (e.g. a wave too big to finish under the per-link timeout).
function runBuildLink(spawnLink) {
  if (spawnLink(S.STATES.BUILD, { sequential: false }).ok) return true;
  return spawnLink(S.STATES.BUILD, { sequential: true }).ok;
}

async function runChain(deps) {
  const { spawnLink, loadState, log = () => {}, maxLinks = 50, maxNoProgress = 3 } = deps;

  log('chain: PLAN');
  if (!spawnLink(S.STATES.PLAN).ok) return done(S.STATES.STUCK, 'plan link failed', 0);

  let links = 0;
  let lastPassing = -1;
  let noProgress = 0;
  for (;;) {
    const block = loadState();
    if (S.isBuildComplete(block)) break;
    if (S.budgetExceeded(links, maxLinks)) return done(S.STATES.STUCK, `link budget exceeded (${links})`, links);
    if (S.stallExceeded(noProgress, maxNoProgress)) return done(S.STATES.STUCK, `no feature progress for ${noProgress} links`, links);

    log(`chain: BUILD #${links + 1}`);
    runBuildLink(spawnLink);
    links += 1;

    const after = loadState();
    if (after.featuresPassing > lastPassing) { lastPassing = after.featuresPassing; noProgress = 0; }
    else { noProgress += 1; }
  }

  log('chain: FINALIZE');
  if (!spawnLink(S.STATES.FINALIZE).ok) return done(S.STATES.STUCK, 'finalize link failed', links);
  return done(S.STATES.DONE, 'PR raised', links);
}

// ---- real deps (used by the CLI entrypoint; not exercised by unit tests) ----

function promptFor(kind, prd, opts = {}) {
  if (kind === S.STATES.PLAN) return `/build --auto --plan-only ${prd}`;
  if (kind === S.STATES.FINALIZE) return '/build --auto --finalize';
  return `/auto --once${opts.sequential ? ' --sequential' : ''}`; // BUILD
}

function realSpawnLink(cwd) {
  const model = process.env.BUILD_CHAIN_MODEL || 'sonnet';
  const timeout = parseInt(process.env.BUILD_CHAIN_LINK_TIMEOUT_MS || '1800000', 10); // 30 min < wall
  const pluginDir = process.env.HARNESS_PLUGIN_DIR || null;
  return (kind, opts = {}) => {
    const args = ['-p', '--model', model];
    if (pluginDir) args.push('--plugin-dir', pluginDir);
    const r = spawnSync('claude', args, {
      input: promptFor(kind, process.env.BUILD_CHAIN_PRD, opts),
      cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL',
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    return { ok: r.status === 0 && !r.signal };
  };
}

function realLoadState(cwd) {
  return () => {
    let text = '';
    try { text = fs.readFileSync(path.join(cwd, 'claude-progress.txt'), 'utf8'); } catch (_) { /* none yet */ }
    return S.parseLastBlock(text);
  };
}

if (require.main === module) {
  const prd = process.argv[2];
  if (!prd || !fs.existsSync(prd)) {
    process.stderr.write('usage: node .claude/scripts/build-chain.js <path-to-prd.md>\n');
    process.exit(2);
  }
  const cwd = process.cwd();
  process.env.BUILD_CHAIN_PRD = prd;
  runChain({ spawnLink: realSpawnLink(cwd), loadState: realLoadState(cwd), log: (m) => process.stdout.write(`${m}\n`) })
    .then((res) => {
      process.stdout.write(`chain finished: ${res.state} — ${res.reason} (${res.links} build links)\n`);
      process.exit(res.state === S.STATES.DONE ? 0 : 1);
    });
}

module.exports = { runChain };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-chain-loop.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Verify file-size/function-length gates pass**

Run: `node -e "const s=require('fs').readFileSync('.claude/scripts/build-chain.js','utf8');const n=s.split('\n').length;if(n>300)throw new Error('file too long: '+n);console.log('lines',n)"`
Expected: prints a line count well under 300. If any top-level `function` exceeds 30 lines, extract a helper (the loop body already delegates to `runBuildLink`).

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/build-chain.js test/build-chain-loop.test.js
git commit -m "feat(build-chain): cross-process driver loop (plan -> build waves -> finalize)"
```

---

## Task 3: `/auto --once` single-wave mode (skill prose + contract test)

**Files:**
- Modify: `.claude/skills/auto/SKILL.md` (usage block near line 20-34; add a new subsection after SECTION 10)
- Test: `test/build-chain-contract.test.js` (create — shared by Tasks 3 and 4)

**Interfaces:**
- Produces: a documented `/auto --once` flag that runs exactly one wave then exits cleanly, writing a session block whose `next_action` is `DONE …` when no groups remain or `CONTINUE — <specifics>` otherwise, with an accurate `groups_remaining`. This is the contract `runChain`'s `loadState` reads.

- [ ] **Step 1: Write the failing contract test**

```js
// test/build-chain-contract.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AUTO = '.claude/skills/auto/SKILL.md';
const BUILD = '.claude/skills/build/SKILL.md';
const LANE = '.claude/skills/build/references/autonomous-lane.md';

test('/auto documents --once single-wave mode', () => {
  const a = read(AUTO);
  assert.match(a, /--once\b/);
  assert.match(a, /single-wave|exactly one wave|one wave/i);
});

test('/auto --once exits cleanly and writes the handoff next_action', () => {
  const a = read(AUTO);
  // it must tell the next process what to do: DONE when finished, CONTINUE otherwise
  assert.match(a, /next_action:\s*DONE/);
  assert.match(a, /next_action:\s*CONTINUE|CONTINUE —/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-chain-contract.test.js`
Expected: FAIL — `--once` not found in `auto/SKILL.md`.

- [ ] **Step 3: Add `--once` to the `/auto` usage list**

In `.claude/skills/auto/SKILL.md`, in the usage code block (currently lines 20-28), add after the `/auto --sequential` line:

```
/auto --once
```

And add a bullet to the flag descriptions (after the `--sequential` bullet, ~line 33):

```markdown
- `--once` — **single-wave mode** for cross-process chaining: run exactly **one** wave (the next ready group, or up to `--parallel-groups N` ready groups), take it through all ratchet gates, commit, append the session block to `claude-progress.txt`, then **exit cleanly without looping to the next wave**. The driver (`.claude/scripts/build-chain.js`) re-spawns a fresh `claude -p` for the next wave. Use `--once --sequential` to shrink a link to a single group when a full wave is too large to finish under the per-link timeout.
```

- [ ] **Step 4: Add a `--once` behavior subsection after SECTION 10**

In `.claude/skills/auto/SKILL.md`, immediately after the SECTION 10 "Rules" list and before SECTION 11, add:

```markdown
### SECTION 10.1: Single-wave mode (`--once`) — cross-process handoff

When invoked with `--once`, `/auto` performs **one** pass of the loop and then stops, instead of iterating until all features pass:

1. Run Context Recovery (SECTION 2) and select the current wave exactly as normal.
2. Execute that one wave through Sprint Contract negotiation, agent-team build, all 8 ratchet gates, and pass/fail handling (SECTIONS 3–6) — unchanged.
3. On a clean wave, **commit** and **append the session block** (SECTION 10 format) — this is the durable checkpoint.
4. Set `next_action` precisely so a fresh process can continue with zero ambiguity:
   - If `features.json` now has every feature passing (or no groups remain): `next_action: DONE — all groups complete` and `groups_remaining: []`.
   - Otherwise: `next_action: CONTINUE — next wave: [<group ids>]` with an accurate `groups_remaining: [...]`.
5. **Exit the turn** — do not loop back to SECTION 2.

This is the voluntary-yield boundary the chain driver relies on: because the process exits cleanly *after* the commit and checkpoint, a per-link timeout/SIGKILL can never land mid-write. Do **not** rely on the `auto-continue-on-stop` hook here — `--once` is driven across processes, not nudged within one; the driver owns re-spawning.
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `node --test test/build-chain-contract.test.js`
Expected: the two `/auto --once` tests PASS (the `/build --finalize` tests added in Task 4 will still fail until then — acceptable; or run only the two with `--test-name-pattern`).

Run scoped: `node --test --test-name-pattern="--once" test/build-chain-contract.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/auto/SKILL.md test/build-chain-contract.test.js
git commit -m "feat(auto): --once single-wave mode for cross-process chaining"
```

---

## Task 4: `/build --auto --finalize` alias (skill prose + contract test)

**Files:**
- Modify: `.claude/skills/build/SKILL.md` (flag docs near line 20-42; Phase 9 region near line 144-270)
- Modify: `.claude/skills/build/references/autonomous-lane.md`
- Test: `test/build-chain-contract.test.js` (extend with the finalize cases already written in Task 3 Step 1)

**Interfaces:**
- Consumes: the chained build state left by the last `/auto --once` link (all features passing, commits on the build branch).
- Produces: a documented `/build --auto --finalize` that runs **only** Phases 9 → 9.5 → 10 → 11, asserts all-features-pass + green `/gate` before Phase 11, and **never merges**.

- [ ] **Step 1: Confirm the finalize contract tests fail**

Add these to `test/build-chain-contract.test.js` (append; they were referenced in Task 3 but implement them now):

```js
test('/build documents --finalize as the chain tail (Phases 9 -> 11 only)', () => {
  const b = read(BUILD);
  assert.match(b, /--finalize\b/);
  assert.match(b, /Phase 9\b[\s\S]*Phase 11\b/);
  assert.match(b, /only.*Phases?\s*9|9 →|9->|9-?>?\s*9\.5/i);
});

test('--finalize never merges and never PRs over a red build', () => {
  const b = read(BUILD);
  assert.match(b, /never merges?/i);
  assert.match(b, /all features? pass/i);
  assert.match(b, /gate/i);
});

test('autonomous-lane documents the build-chain driver and its links', () => {
  const lane = read(LANE);
  assert.match(lane, /build-chain(\.js)?/);
  assert.match(lane, /--once/);
  assert.match(lane, /--finalize/);
});
```

Run: `node --test test/build-chain-contract.test.js`
Expected: the three new tests FAIL.

- [ ] **Step 2: Add `--finalize` to the `/build` flag docs**

In `.claude/skills/build/SKILL.md`, after the `**\`--plan-only\`.**` paragraph (~line 42), add:

```markdown
**`--finalize`.** Run the **chain tail only** — Phases 9 → 9.5 → 10 → 11 (E2E test generation, pre-PR verification + bounded defect repair, README, raise PR) — against a project whose build is already complete (all `features.json` features passing, commits on the build branch). This is the terminal link spawned by the cross-process driver `.claude/scripts/build-chain.js` after the last `/auto --once` wave. It runs **no** planning and **no** new feature implementation. Phase 11 stays gated: it asserts every feature passes and `/gate` (evaluator + security) is green before opening the PR, and — like every lane — it **never merges**. If features are still failing when `--finalize` is invoked, stop and report rather than opening a PR.
```

- [ ] **Step 3: Reference `--finalize` at the Phase 9 heading**

In `.claude/skills/build/SKILL.md` at the `### Phase 9 — E2E Test Generation` heading (~line 144), add a one-line note directly under it:

```markdown
> Phases 9–11 are exactly the steps `/build --auto --finalize` runs in isolation as the cross-process chain's terminal link.
```

- [ ] **Step 4: Document the driver in autonomous-lane.md**

Append a section to `.claude/skills/build/references/autonomous-lane.md`:

```markdown
## Cross-process session chaining (`build-chain.js`)

A single `claude -p` cannot carry a multi-story `--auto` build from plan to PR — it is SIGKILLed at the process wall (~40 min) before code-gen finishes. For headless multi-story runs, the driver `.claude/scripts/build-chain.js` (run via `npm run build:chain -- <prd>`) chains fresh processes:

| Link | Command | Yields |
|---|---|---|
| PLAN | `/build --auto --plan-only <prd>` | `specs/`, `dependency-graph.md`, `features.json` |
| BUILD ×N | `/auto --once` (one wave each) | commit + `claude-progress.txt` checkpoint per wave |
| FINALIZE | `/build --auto --finalize` | Phases 9→9.5→10→11, an open PR |

Between links the driver reads only `claude-progress.txt` (last block) and `features.json`. Each BUILD link **voluntarily yields** after its commit + checkpoint, so a per-link timeout never corrupts state. The driver stops loudly as `STUCK` (never spins) if BUILD links stop adding passing features (`maxNoProgress`, default 3) or the link budget is exceeded (`maxLinks`, default 50). It **never merges** and never PRs over a red build — the machine gates are unchanged. `--pod` per-cluster chaining is out of scope for v1 (symphony already covers tracker-driven per-cluster delivery).
```

- [ ] **Step 5: Run the full contract test**

Run: `node --test test/build-chain-contract.test.js`
Expected: PASS (all 5 tests across Tasks 3 + 4).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/build/SKILL.md .claude/skills/build/references/autonomous-lane.md test/build-chain-contract.test.js
git commit -m "feat(build): --finalize chain tail + document build-chain driver"
```

---

## Task 5: Wiring — npm scripts, multi-story fixture, live e2e proof, README

**Files:**
- Modify: `package.json` (scripts)
- Create: `test/e2e/fixtures/multi-story-prd.md`
- Create: `test/e2e/harness-chain-run.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: the driver from Task 2, `/auto --once` from Task 3, `/build --auto --finalize` from Task 4.
- Produces: `npm run build:chain` (production entrypoint) and `npm run test:chain` (opt-in live proof).

- [ ] **Step 1: Add npm scripts**

In `package.json` `scripts`, add (after `"test:auto"`):

```json
    "build:chain": "node .claude/scripts/build-chain.js",
    "test:chain": "node --test --test-force-exit --test-timeout=5400000 test/e2e/harness-chain-run.test.js",
```

- [ ] **Step 2: Create the 2-cluster PRD fixture**

Create `test/e2e/fixtures/multi-story-prd.md` — a deliberately small PRD that still produces **≥2 dependency groups** so the chain runs ≥2 BUILD links (a single-group PRD would finish in one link and not exercise chaining). Follow `docs/prd-format.md`:

```markdown
# PRD: Notes API

## Functional Requirements
- FR-1: A `Note` has an `id`, `title`, and `body`. (foundation)
- FR-2: `POST /notes` creates a note; `GET /notes/:id` returns it. (depends on FR-1)
- FR-3: `GET /notes` lists all notes; `DELETE /notes/:id` removes one. (depends on FR-2)

## Non-Functional Requirements
- NFR-1: In-memory storage is acceptable; no external database.
- NFR-2: JSON request/response bodies.

## Out-of-Scope
- Authentication, pagination, persistence across restarts.
```

- [ ] **Step 3: Write the opt-in live e2e proof**

Create `test/e2e/harness-chain-run.test.js`. It scaffolds a fresh temp project, runs the driver on the fixture, and asserts the chain reached `DONE`. Reuse `freshProject()` and `HARNESS_ROOT` from `test/e2e/helpers/`. Mirror the existing live-runner guard so it never runs in CI accidentally.

```js
// test/e2e/harness-chain-run.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const { HARNESS_ROOT } = require('./helpers/claude-runner.js');
const { freshProject } = require('./helpers/fresh-project.js');

// Live, opt-in, expensive (~tens of minutes). Skipped unless RUN_LIVE_E2E=1.
const LIVE = process.env.RUN_LIVE_E2E === '1';

test('build-chain drives a multi-story PRD to an open PR via chained processes', { skip: !LIVE }, () => {
  const { cwd, cleanup } = freshProject();
  try {
    const prd = path.join(HARNESS_ROOT, 'test/e2e/fixtures/multi-story-prd.md');
    const r = spawnSync('node', [path.join(HARNESS_ROOT, '.claude/scripts/build-chain.js'), prd], {
      cwd, encoding: 'utf8', timeout: 5_400_000, killSignal: 'SIGKILL',
      env: { ...process.env, HARNESS_PLUGIN_DIR: path.join(HARNESS_ROOT, '.claude'), BUILD_CHAIN_MODEL: 'sonnet' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    assert.strictEqual(r.status, 0, 'driver should exit 0 (state DONE)');
    // Proof the chain actually checkpointed across links:
    const progress = fs.readFileSync(path.join(cwd, 'claude-progress.txt'), 'utf8');
    assert.match(progress, /=== Session/);
    assert.match(progress, /next_action:\s*DONE/);
  } finally {
    cleanup();
  }
});
```

> If `freshProject()`'s exported name or signature differs, open `test/e2e/helpers/fresh-project.js` and match it exactly — the memory notes a shared `freshProject()` helper with an rm-confinement guard. Do not invent a new helper.

- [ ] **Step 4: Verify the static suite still passes (no live calls)**

Run: `npm test`
Expected: PASS, now including `build-chain-state.test.js`, `build-chain-loop.test.js`, `build-chain-contract.test.js`. The live `harness-chain-run.test.js` is under `test/e2e/` and is **not** in the `npm test` glob, and is `skip:`-guarded anyway.

- [ ] **Step 5: Add a README line under Operating modes**

In `README.md`, in the "Operating modes" section after the approval-lanes table (~line 93), add:

```markdown
**Long multi-story headless runs.** A single `claude -p` is SIGKILLed at the process wall (~40 min) before a big `--auto` build finishes. For headless multi-story PRDs, run the chaining driver instead — it spawns a fresh process per build wave and survives to an open PR:

```bash
npm run build:chain -- path/to/prd.md
```

It runs `/build --auto --plan-only` once, `/auto --once` per wave, then `/build --auto --finalize`. Same machine gates, same no-merge invariant. (`--pod` per-cluster chaining is not yet supported here — use `symphony_clone` for tracker-driven per-cluster delivery.)
```

- [ ] **Step 6: Run the whole fast suite once more and commit**

Run: `npm test`
Expected: PASS (full suite green).

```bash
git add package.json README.md test/e2e/fixtures/multi-story-prd.md test/e2e/harness-chain-run.test.js
git commit -m "feat(build-chain): wire build:chain + test:chain, live proof, README"
```

---

## Final verification (before opening the PR)

Per the harness's own review-timing rule (run reviewers BEFORE raising the PR), after Task 5:

- [ ] Run the full fast suite: `npm test` — expect green, with all three new `build-chain-*` suites included.
- [ ] Run clean-code + security reviewers on the diff (the harness's pre-PR discipline), fix any blocking findings, then open the PR.
- [ ] (Optional, costs API budget) Live proof: `RUN_LIVE_E2E=1 npm run test:chain` — confirms a multi-story PRD reaches an open PR across chained processes.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Driver (`build-chain.js`, state machine, runLink, stall watchdog, link budget, trust-order) → Tasks 1 + 2. ✓
- `/auto --once` single-wave mode → Task 3. ✓
- `/build --auto --finalize` (Phases 9→9.5→10→11, gate-on-green, never merge) → Task 4. ✓
- Wiring (`npm run build:chain`, contract test, live proof, README, autonomous-lane) → Tasks 4 + 5. ✓
- Failure-mode defenses (voluntary yield, oversized-wave sequential fallback, partial-state trust order, never-PR-over-red, runaway budget) → Tasks 2 (loop + fallback), 3 (clean-exit), 4 (finalize gate). ✓
- Non-goals (`--pod` out of v1, no snapshots, no `claude --resume`) → stated in Global Constraints + autonomous-lane note. ✓
- The spec's "Open Implementation Detail" (pin exact handoff strings) → resolved: Global Constraints "Exact handoff strings" + Task 3 Step 4 pins `next_action: DONE` / `CONTINUE` + accurate `groups_remaining`. ✓

**Deviations from spec (intentional):**
- Spec said "update `harness-auto-run.test.js`" for the live proof; the plan instead adds a dedicated `harness-chain-run.test.js`, matching the existing one-runner-per-mode convention (auto/semi/plan/smoke). Equivalent coverage, cleaner separation.
- Pure helpers live in `build-chain-state.js` (sibling), not inlined in the driver — required to keep the driver unit-testable and under the 300-line file gate.

**Placeholder scan:** none — every code/step is concrete.

**Type/name consistency:** `runChain(deps)`, `spawnLink(kind, opts)`, `loadState()`, `parseLastBlock`, `isBuildComplete`, `nextPhase`, `stallExceeded`, `budgetExceeded`, `STATES.{PLAN,BUILD,FINALIZE,DONE,STUCK}` used identically across Tasks 1, 2, and tests. ✓
