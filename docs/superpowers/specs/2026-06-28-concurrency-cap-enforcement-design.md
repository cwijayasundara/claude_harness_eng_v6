# Concurrency-cap enforcement

**Date:** 2026-06-28
**Status:** Approved (design)
**Scope:** The last open fix-#4 item (the `context:fork` gate cleanup remains
after this). Make `/auto`'s agent-team concurrency caps a **harness-enforced**
ceiling instead of prose, by denying subagent spawns that exceed a configured
limit.

## Problem

`/auto`'s caps — `--parallel-groups 3`, 5 teammates per group, "~15 concurrent
subagents at peak" — are **prose** injected into agent prompts (Section 4B). Line
154 already *logs* every teammate spawn to `iteration-log.md`, and line 166 does a
*post-hoc* under-spawn check, but nothing **prevents** an LLM orchestrator from
spawning past the caps. A runaway over-spawn (resource exhaustion) would not be
caught.

## Decisions (from brainstorming)

- **Hard prevention via a `PreToolUse(Task)` hook** (not post-hoc detection, not a
  prose-invoked validator): the harness denies an over-cap spawn before resources
  are consumed.
- **Global ceiling** on concurrent `Task` subagents (no per-group tag parsing) —
  the proportionate, simple mechanism; per-group precision is out of scope.
- **Backpressure, not failure:** a denied spawn tells the agent to wait; in-flight
  subagents finish (`SubagentStop` decrements) and the spawn succeeds on retry.
- **Fail-open + TTL self-heal:** any gate error → allow; a leaked count (a subagent
  that never fires `SubagentStop`) self-heals via TTL pruning.

## Architecture

### New: `.claude/hooks/concurrency-gate.js`

A thin hook wrapper around pure decision logic. It handles **two** events,
branching on `hook_event_name` from the hook stdin payload:

- **`PreToolUse` with `tool_name === 'Task'`:** read the in-flight state, prune
  stale, and `decideSpawn`. If denied → write the reason to **stderr** and
  **`exit(2)`** (the `pre-bash-gate.js` block protocol); if allowed → persist the
  new state and `exit(0)`.
- **`SubagentStop`:** `decideStop` (prune + remove one), persist, `exit(0)`.
- **Any other event, or any error** (unreadable/parse/CAP-resolution failure) →
  `exit(0)` (**fail-open** — a gate bug must never block all subagents).

**Pure logic (unit-tested, no fs / no hook protocol):**

```
decideSpawn(state, { cap, now, ttlMs }) -> { allow, reason?, state }
decideStop(state, { now, ttlMs })       -> { state }
```

`state = { active: number[] }` (epoch-ms timestamps of in-flight spawns).

- `decideSpawn`: `pruned = state.active.filter(ts => ts > now - ttlMs)`; if
  `pruned.length >= cap` → `{ allow: false, reason, state: { active: pruned } }`
  (state NOT grown — a denial does not count); else `{ allow: true, state:
  { active: [...pruned, now] } }`.
- `decideStop`: prune, then drop the oldest (`shift`) → `{ state: { active: rest } }`.
- A malformed/empty/missing state is treated as `{ active: [] }`.

**State file:** `.claude/state/inflight-agents.json`. Read with a default of
`{ active: [] }` on missing-or-malformed; write the pruned/updated state back.

**CAP resolution:** `project-manifest.json#execution.max_concurrent_agents` → env
`CLAUDE_MAX_CONCURRENT_AGENTS` → default **15**. **TTL:** 30 min (`1800000` ms),
fixed.

### Changed: `.claude/settings.json`

- Add `concurrency-gate.js` to the existing `PreToolUse` `Task` matcher, **before**
  `record-run.js` (so a denial short-circuits the spawn; `record-run` telemetry is
  unaffected — a denied spawn is simply not run).
- Add `concurrency-gate.js` to `SubagentStop` (alongside `graph-refresh.js` /
  `record-run.js`).
- `settings.json` is also the scaffold seed, so the hook ships to target projects.

### Changed: `.claude/skills/auto/SKILL.md` (Section 4B)

Note that the concurrency caps are now **enforced** by `concurrency-gate.js`: the
documented `--parallel-groups`/teammate caps are backed by a hard
`max_concurrent_agents` ceiling, and a denied `Task` spawn is **backpressure** —
wait for in-flight subagents to finish, then retry (do not treat it as a failure).

## Data flow

```
agent calls Task ─► PreToolUse(Task): concurrency-gate.js
   read inflight-agents.json → prune (ts > now - ttl)
   active >= CAP ? ── yes ─► stderr(reason) + exit(2)   [DENY → spawn blocked]
                   └─ no  ─► active.push(now) → save → exit(0)   [ALLOW]
subagent finishes ─► SubagentStop: concurrency-gate.js
   prune + drop oldest → save → exit(0)
```

A denied spawn never increments the counter and never starts a subagent, so it
produces no `SubagentStop` — the accounting stays balanced.

## Error / robustness behavior

- **Fail-open:** any exception in the gate → `exit(0)` (allow). The harness must
  never be bricked by a gate bug.
- **TTL self-heal:** a subagent that dies without a `SubagentStop` leaks a
  timestamp; pruning entries older than the TTL on every access guarantees the
  counter cannot permanently lock out spawns.
- **Concurrent-burst race (documented limitation):** the file-based counter is a
  read-modify-write, so a batch of `Task` spawns fired in one message can race and
  let a few past the cap. This is a **best-effort safety ceiling**, not a
  transactional limit — it reliably bounds runaway parallelism (a 50-spawn fan-out
  is still throttled once the first ~CAP land) while tolerating an occasional
  off-by-a-few during a simultaneous burst. Acceptable for the resource-safety
  goal; per-spawn transactional precision is out of scope.

## Testing

`test/concurrency-gate.test.js` on the pure functions (no fs / no hooks):

- `decideSpawn` under cap → `allow: true`, `state.active` grows by one (ends with
  `now`).
- `decideSpawn` at cap → `allow: false`, a non-empty `reason`, `state.active`
  unchanged (denial does not count).
- stale pruning: a state full of timestamps older than `ttlMs` → those are pruned,
  so a spawn is **allowed** (count resets via TTL).
- `decideStop` → `state.active` shrinks by one (oldest dropped); also prunes stale.
- malformed/empty state input → treated as `{ active: [] }` (allow).

`test/concurrency-gate-wiring-contract.test.js`:

- `.claude/settings.json` wires `concurrency-gate.js` into the `PreToolUse` `Task`
  matcher and into `SubagentStop` (parse the JSON; assert the command strings are
  present under those events).

(The fail-open + exit-code behavior of the wrapper is exercised by a focused
integration test that runs the script with a stubbed stdin payload and asserts the
exit code — included in the same test file.)

## Out of scope

- Per-group (5-teammate) precision — a global ceiling is the chosen mechanism.
- The `context:fork` gate-mechanism cleanup (the final remaining fix-#4 item).
