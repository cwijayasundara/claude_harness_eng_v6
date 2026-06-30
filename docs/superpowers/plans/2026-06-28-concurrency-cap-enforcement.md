# Concurrency-cap Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `/auto`'s concurrency caps with a `PreToolUse(Task)` hook that denies (exit 2) a subagent spawn exceeding a configured ceiling and decrements on `SubagentStop`, replacing the prose-only caps.

**Architecture:** `.claude/hooks/concurrency-gate.js` wraps pure `decideSpawn`/`decideStop` over a `.claude/state/inflight-agents.json` `{ active: [timestamps] }` counter (TTL-pruned, fail-open). It is wired into `settings.json`'s existing `PreToolUse` `Task` matcher and `SubagentStop`. The cap is global, configurable, default 15.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test` + `assert`, Claude Code hook protocol (stdin JSON, exit 2 = block).

## Global Constraints

- Node CommonJS with `'use strict';`. Pure `decideSpawn`/`decideStop`/`resolveCap`/`normalizeState` take parsed inputs (no fs/stdin) and are unit-tested; the hook wrapper does the fs + protocol.
- Hook reads its event from stdin via `fs.readFileSync(0, 'utf8')` (fd 0 — `.claude/hooks/lib/common.js#readHookInput` does the same). Branch on `input.hook_event_name`; for `PreToolUse` also check `input.tool_name === 'Task'`.
- **Deny** = `process.stderr.write(reason + '\n'); process.exit(2);` (the `pre-bash-gate.js` block protocol). **Allow / other event / any error** = `process.exit(0)` (**fail-open**).
- State file: `.claude/state/inflight-agents.json` under `process.env.CLAUDE_PROJECT_DIR || process.cwd()`, shape `{ active: number[] }` (epoch-ms). A denial does NOT add to `active`.
- `CAP` = `project-manifest.json#execution.max_concurrent_agents` (if present & finite & >0) → env `CLAUDE_MAX_CONCURRENT_AGENTS` (if finite & >0) → default `15`. `TTL_MS = 30 * 60 * 1000`.
- `settings.json` is JSON (no comments); add `concurrency-gate.js` to the `PreToolUse` `Task` matcher (before `record-run.js`) and to `SubagentStop`.
- Tests use `const { test } = require('node:test');` + `const assert = require('assert');` in `test/*.test.js` (run by `npm test`).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT edit `CLAUDE.md`. Work stays on branch `feat/concurrency-cap-enforcement`.

---

### Task 1: `concurrency-gate.js` — the gate hook

**Files:**
- Create: `.claude/hooks/concurrency-gate.js`
- Test: `test/concurrency-gate.test.js`

**Interfaces:**
- Produces: `decideSpawn(state, { cap, now, ttlMs }) -> { allow, reason?, state }`; `decideStop(state, { now, ttlMs }) -> { state }`; `resolveCap(manifest, env) -> number`; `normalizeState(raw) -> { active: number[] }`. Exported for tests. The CLI (`require.main`) is the hook wrapper.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `test/concurrency-gate.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/concurrency-gate.test.js`
Expected: FAIL — `Cannot find module '.../concurrency-gate.js'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/concurrency-gate.js`:

```js
'use strict';

// PreToolUse(Task) + SubagentStop concurrency gate. Enforces a global ceiling on
// concurrent Task subagents: deny (exit 2) a spawn that would exceed the cap;
// decrement on SubagentStop. Fail-open on any error; TTL-pruning self-heals a
// leaked count (a subagent that never fired SubagentStop). Pure decideSpawn/
// decideStop are unit-tested.

const fs = require('fs');
const path = require('path');

const TTL_MS = 30 * 60 * 1000;
const DEFAULT_CAP = 15;

function normalizeState(raw) {
  if (raw && Array.isArray(raw.active)) {
    return { active: raw.active.filter((n) => Number.isFinite(n)) };
  }
  return { active: [] };
}

function resolveCap(manifest, env) {
  const m = manifest && manifest.execution && Number(manifest.execution.max_concurrent_agents);
  if (Number.isFinite(m) && m > 0) return m;
  const e = Number((env || {}).CLAUDE_MAX_CONCURRENT_AGENTS);
  if (Number.isFinite(e) && e > 0) return e;
  return DEFAULT_CAP;
}

function decideSpawn(state, { cap, now, ttlMs }) {
  const active = normalizeState(state).active.filter((ts) => ts > now - ttlMs);
  if (active.length >= cap) {
    return {
      allow: false,
      reason: `Concurrency cap reached (${active.length}/${cap} subagents in flight). Wait for in-flight subagents to finish, then retry the spawn.`,
      state: { active },
    };
  }
  return { allow: true, state: { active: [...active, now] } };
}

function decideStop(state, { now, ttlMs }) {
  const active = normalizeState(state).active.filter((ts) => ts > now - ttlMs).sort((a, b) => a - b);
  active.shift();
  return { state: { active } };
}

// ---- hook wrapper ----

function statePath(projectDir) {
  return path.join(projectDir, '.claude', 'state', 'inflight-agents.json');
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function writeState(p, state) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state));
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { process.exit(0); }
  try {
    const event = (input.hook_event_name || '').toString();
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const sp = statePath(projectDir);
    const now = Date.now();

    if (event === 'PreToolUse' && (input.tool_name || '') === 'Task') {
      const cap = resolveCap(readJsonSafe(path.join(projectDir, 'project-manifest.json')), process.env);
      const r = decideSpawn(readJsonSafe(sp), { cap, now, ttlMs: TTL_MS });
      writeState(sp, r.state);
      if (!r.allow) { process.stderr.write(`${r.reason}\n`); process.exit(2); }
      process.exit(0);
    }
    if (event === 'SubagentStop') {
      const r = decideStop(readJsonSafe(sp), { now, ttlMs: TTL_MS });
      writeState(sp, r.state);
      process.exit(0);
    }
  } catch (_) { process.exit(0); }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { decideSpawn, decideStop, resolveCap, normalizeState };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/concurrency-gate.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/concurrency-gate.js test/concurrency-gate.test.js
git commit -m "feat(hooks): concurrency-gate (PreToolUse Task cap + SubagentStop decrement)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire the gate into `settings.json`

**Files:**
- Modify: `.claude/settings.json` (`PreToolUse` `Task` matcher + `SubagentStop`)
- Test: `test/concurrency-gate-wiring-contract.test.js`

**Interfaces:**
- Consumes: `concurrency-gate.js` (Task 1).
- Produces: the wired hook (active in this repo and shipped via the scaffold seed).

- [ ] **Step 1: Write the failing test**

Create `test/concurrency-gate-wiring-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const settings = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));

function commandsFor(hookList) {
  return (hookList || []).flatMap((m) => (m.hooks || []).map((h) => h.command || ''));
}

test('concurrency-gate is wired into the PreToolUse Task matcher', () => {
  const taskMatchers = (settings.hooks.PreToolUse || []).filter((m) => m.matcher === 'Task');
  const cmds = commandsFor(taskMatchers);
  assert.ok(cmds.some((c) => c.includes('concurrency-gate.js')), 'PreToolUse Task must run concurrency-gate.js');
});

test('concurrency-gate is wired into SubagentStop', () => {
  const cmds = commandsFor(settings.hooks.SubagentStop);
  assert.ok(cmds.some((c) => c.includes('concurrency-gate.js')), 'SubagentStop must run concurrency-gate.js');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/concurrency-gate-wiring-contract.test.js`
Expected: FAIL — `concurrency-gate.js` is not yet in `settings.json`.

- [ ] **Step 3: Wire the hook**

In `.claude/settings.json`:

(a) In the `PreToolUse` array, the matcher object `{ "matcher": "Task", "hooks": [ ... ] }` — add `concurrency-gate.js` as the FIRST hook in its `hooks` array (so a deny short-circuits before `record-run.js`):

```json
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/concurrency-gate.js\"",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/record-run.js\"",
            "timeout": 5000
          }
        ]
      },
```

(b) In the `SubagentStop` array's matcher `hooks`, add `concurrency-gate.js` (alongside `graph-refresh.js`/`record-run.js`):

```json
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/concurrency-gate.js\"",
            "timeout": 5000
          },
```

Keep the file valid JSON (commas correct).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/concurrency-gate-wiring-contract.test.js`
Expected: PASS (2 tests). Also confirm valid JSON: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`.

- [ ] **Step 5: Commit**

```bash
git add .claude/settings.json test/concurrency-gate-wiring-contract.test.js
git commit -m "feat(hooks): wire concurrency-gate into PreToolUse Task + SubagentStop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Document enforcement in `/auto` Section 4B

**Files:**
- Modify: `.claude/skills/auto/SKILL.md` (Section 4B concurrency note)
- Test: `test/concurrency-gate-doc-contract.test.js`

**Interfaces:**
- Consumes: the hook (Task 1) + wiring (Task 2).
- Produces: prose telling the runtime agent the caps are enforced and a denied spawn is backpressure.

- [ ] **Step 1: Write the failing test**

Create `test/concurrency-gate-doc-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const AUTO = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'auto', 'SKILL.md'), 'utf8');

test('/auto documents that the concurrency caps are hook-enforced', () => {
  assert.match(AUTO, /concurrency-gate/);
  assert.match(AUTO, /max_concurrent_agents|CLAUDE_MAX_CONCURRENT_AGENTS/);
  assert.match(AUTO, /backpressure|wait for in-flight|denied/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/concurrency-gate-doc-contract.test.js`
Expected: FAIL — SKILL.md doesn't mention the gate yet.

- [ ] **Step 3: Add the enforcement note**

In `.claude/skills/auto/SKILL.md` Section 4B, where the concurrency limits (`--parallel-groups`, the 5-teammate / ~15-peak caps) are described, add a paragraph:

```markdown
**Enforced, not advisory.** The concurrency caps above are now backed by a hard
ceiling: the `PreToolUse(Task)` hook `.claude/hooks/concurrency-gate.js` counts
in-flight subagents and **denies** a spawn that would exceed
`max_concurrent_agents` (`project-manifest.json#execution.max_concurrent_agents`
→ env `CLAUDE_MAX_CONCURRENT_AGENTS` → default 15), decrementing on
`SubagentStop`. A denied spawn is **backpressure, not a failure** — wait for
in-flight subagents to finish, then retry; do not treat it as a ratchet failure.
The gate fails open (a gate error never blocks spawns) and TTL-prunes a leaked
count.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/concurrency-gate-doc-contract.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: PASS (all suites, including the three new concurrency-gate test files).

```bash
git add .claude/skills/auto/SKILL.md test/concurrency-gate-doc-contract.test.js
git commit -m "docs(auto): note concurrency caps are now hook-enforced (backpressure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `concurrency-gate.js` (pure `decideSpawn`/`decideStop`/`resolveCap`/`normalizeState` + wrapper, fail-open, TTL prune, exit-2 deny) → Task 1. ✓
- State file `inflight-agents.json` `{active:[ts]}`; denial doesn't count → Task 1 (`decideSpawn`) + test. ✓
- CAP precedence (manifest → env → 15), TTL 30min → Task 1 (`resolveCap`, constants) + test. ✓
- `settings.json` wiring into `PreToolUse(Task)` (before record-run) + `SubagentStop` → Task 2 + contract test. ✓
- `/auto` Section 4B "enforced, not advisory" + backpressure note → Task 3 + contract test. ✓
- Robustness (fail-open on malformed stdin / non-Task / errors; TTL self-heal) → Task 1 wrapper + tests (`fails open`, `ignores non-Task`, `prunes stale`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step has assertions + the exact `node --test …` command and expected result.

**Type consistency:** `decideSpawn(state,{cap,now,ttlMs})→{allow,reason?,state}`, `decideStop(state,{now,ttlMs})→{state}`, `resolveCap(manifest,env)`, `normalizeState(raw)` — defined in Task 1 and asserted by its test with matching signatures; the wrapper reads/writes `{ active: number[] }` consistently; the wiring test reads the same `concurrency-gate.js` command string Task 2 writes.

**Out of scope (unchanged):** per-group (5-teammate) precision; the `context:fork` gate cleanup.
