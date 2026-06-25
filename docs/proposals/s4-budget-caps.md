# Proposal: Per-Task Budget Caps (S4)

Status: Draft (design narrative — not yet implemented)
Roadmap: S4 "Devin primitives — per-task budget caps" in `autonomous-engineer-roadmap` memory.
Related: opportunity #2 (compute/budget metering + budget-halt) in the Devin comparison;
`docs/proposals/confidence-gated-planning.md` (same staged-rollout, pure-core-first shape).

## Problem

An autonomous `/build --auto` (or `/auto`) run can spend an unbounded amount of compute
before a human sees a result. The only ceilings today are **coarse and count-based**, not
spend-based:

- `/auto` hard-stops at **50 iterations** (`max_auto_iterations`, SECTION 11 of `auto/SKILL.md`).
- `build-chain.js` halts at **50 links** (`maxLinks`) or **3 no-progress links** (`maxNoProgress`),
  with a **30-min per-link wall-clock timeout** (`BUILD_CHAIN_LINK_TIMEOUT_MS`, default `1800000`).

None of these is a *budget* in the sense a user means it ("don't spend more than ~2 hours / ~$X /
~N agents on this"). A 49-iteration run that burns through a fortune still completes; a user who
wants to cap spend on an unattended run has no knob. This is Devin's **ACU model** (≈1 ACU ≈ 15 min
of active work, metered and surfaced) — and the explicit **edge over Symphony**, which *accounts*
tokens but does not *cap* them. We have neither the meter nor the cap.

## The hard constraint (why this isn't just "count tokens")

The harness **makes no direct Anthropic API calls** — it runs *inside* Claude Code, which owns the
API conversation (this is also why prompt caching is automatic and there are no `cache_control`
breakpoints to manage; see CLAUDE.md → *Prompt Caching*). Consequently the orchestrator **cannot
read an exact running token count synchronously** the way a script wrapping the SDK could. Today's
run receipts (`.claude/hooks/record-run.js` → `.claude/runs/YYYY-MM-DD.jsonl`) record
`{kind, ts, lane, mode, iteration, group_id, story_id, session_id, host, …}` and **no token or cost
fields at all**.

So the budget has two layers, and the spec keeps them honest and separate:

1. **Enforceable units — directly observable, drive the halt.**
   - **Wall-clock** (`Date.now()` deltas across the run — already how `build-chain.js` times links).
     This is the ACU-aligned primary unit: a wall-clock cap maps directly to "≈N×15-min of work."
   - **Agent-spawn count** (countable from receipts — every `subagent` receipt is one dispatch).
     A proxy for fan-out cost; cheap and exact.

2. **Estimated overlay — surfaced, can also trip the cap, never the *sole* gate.**
   - **Tokens / cost**, estimated as `Σ receipts × rate[tier][agent_kind]` (a small calibrated
     rate table, seeded with rough defaults and refined from telemetry over time). Labelled an
     **estimate** everywhere it appears. If/when Claude Code's hook payloads or OTEL stream expose
     real usage, the estimate is transparently replaced by measured values (see §Accounting).

The design principle: **the halt must key off a unit the orchestrator can read synchronously and
exactly** (wall-clock, agent count). Tokens/cost ride on top for visibility and as a soft cap, but
we never pretend to a precision the runtime can't give us.

## Goal

A single, configurable **budget** that the autonomous lanes meter, surface, and halt on — stopping
at a **clean checkpoint** (after a commit, never mid-write) when exhausted, and warning before then.

Non-goals: throttling individual agents, per-token billing accuracy, or any change to the machine
verification gates. Budget caps **wall-clock/compute**, never quality.

## Design

### 1. The budget abstraction

A run's budget is one or more **dimensions**, each `{unit, limit, spent}`. A dimension is
*exhausted* when `spent >= limit`; the run is *exhausted* when **any** dimension is. Defaults set
only the wall-clock dimension; users can add agent-count or estimated-cost caps.

```jsonc
// resolved budget (in-memory; persisted spend lives in the receipts + a marker)
{
  "dimensions": [
    { "unit": "wall_clock_ms", "limit": 5400000, "spent": 3120000 },  // 90 min cap, 52 min in
    { "unit": "agents",        "limit": 200,      "spent": 86 },
    { "unit": "est_cost_usd",  "limit": 25.0,     "spent": 11.4, "estimated": true }
  ],
  "warn_at_pct": 80
}
```

Band per dimension and overall: **ok** (< warn), **warn** (≥ warn_at_pct), **exhausted** (≥ 100%).

### 2. Accounting — `budget-state.js` (pure, testable)

Mirrors `build-chain-state.js` / `plan-confidence.js`: the math is pure (takes already-read spend +
config, returns the banded budget object) so it unit-tests without I/O. A thin reader gathers spend.

```
computeBudget(spent, config) -> { dimensions[], band, exhausted, warn, remaining{} }   // pure
gatherSpend(readReceipts, startedAtMs, nowMs, tier) -> { wall_clock_ms, agents, est_cost_usd }
estimateCost(receipts, tier) -> number     // Σ rate[tier][agent_kind]; pure, rate table is a const
```

- `wall_clock_ms` = `nowMs - startedAtMs` (run start stamped in a `.claude/state/budget-start` marker
  at Phase 4 / `/auto` entry).
- `agents` = count of `kind === 'subagent'` receipts for this `session_id`/run.
- `est_cost_usd` = `estimateCost(receipts, tier)` using a `RATE_USD` table keyed by tier and agent
  kind (generator/evaluator/security/…), seeded from rough per-agent averages. **If a receipt
  carries real `output_tokens`/`input_tokens`** (see §5), `estimateCost` uses those × model price
  instead of the flat per-agent rate — so the same function returns measured cost once the data
  exists, with no caller change.

Each function stays well under the 30-line gate; the rate table is a top-level `const`.

### 3. Where the halt fires — clean-checkpoint guarantee

The budget is checked at **iteration boundaries only**, never mid-step, so a halt never lands on a
half-written file (the same discipline `build-chain.js`'s voluntary-yield already uses).

- **`/auto` loop (SECTION 11, new stop criterion — priority 1, checked *before* the iteration cap):**
  At the top of SECTION 2 (Context Recovery), after reading state and **before** dispatching the
  next group, compute the budget. If **exhausted**, stop the run cleanly: write `claude-progress.txt`
  with `next_action: "BUDGET — {dimension} cap reached ({spent}/{limit}); raise --budget or merge what's done"`,
  print a status report, run `docker compose down -v`, and exit. Work already committed is preserved;
  the run is resumable by raising the cap.
- **`build-chain.js` (cross-process):** add a budget dimension alongside the existing
  `budgetExceeded(linkCount, maxLinks)` check (lines 42–43). Between links the driver already reads
  only harness-written state — it computes `gatherSpend` and, if exhausted, returns
  `done(STATES.STUCK, 'budget exhausted')` exactly like the link-budget path. (The existing
  link-count cap becomes one dimension of the general budget; kept for backward compatibility.)
- **Soft warn (non-blocking):** when any dimension crosses `warn_at_pct`, surface it in the next
  `/status` render and the iteration log, but keep building.

### 4. Plan-time estimate (spend before you commit)

Devin's checkpoint exists to prevent wasted spend; ours should *predict* it. After planning, compute
a rough **projected spend** from the story/group count × per-group average (same rate table) and
surface it where the plan is shown:

- `--autonomous` Phase 3.5: add a line — `Est. spend: ~62 min · ~140 agents · ~$18 (cap: 90 min)` —
  so the human approves with the projected cost in view (complements the confidence band already
  there).
- `--auto`: if the projection **already exceeds** the cap before a single group runs, treat it like
  a low-confidence plan — stop and surface rather than starting a run that can't finish in budget.

### 5. Receipt schema extension (opportunistic real usage)

Extend `record-run.js` receipts with **optional** usage fields, populated only if the hook input
exposes them (no fabrication when it doesn't): `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_creation_tokens`, `model`. `telemetry-memory.js` gains a
`harness_token_usage_total{lane,mode,group}` gauge and a `harness_est_cost_usd` gauge so the existing
Prometheus/Grafana stack charts spend over time (authoritative, async). The in-loop halt does **not**
depend on these — it uses wall-clock/agents — but when present they sharpen the cost estimate and the
dashboards.

### 6. Surfacing in `/status`

Add a `budget` field to the snapshot (`pipeline-snapshot.js`, sibling to `coverage`/`iteration`),
read by a new `readBudget` in `pipeline-state-readers.js` from the `budget-start` marker + receipts:

```
Budget:    52m/90m wall (58%) · 86/200 agents · ~$11.4 est  [ok]
```

Omitted entirely when no budget is configured (backward compatible, like the `confidence` line).

### 7. Config & precedence

One resolved budget, from (lowest → highest precedence):

1. **Per-tier manifest defaults** — `project-manifest.json#execution.budget`, stamped by
   `scaffold-render.js#buildManifest` keyed to `model_tier` (burn rate scales with tier):

   | tier | wall_clock default | agents | est_cost cap |
   |---|---|---|---|
   | cost (lite) | 30 min | 80 | $8 |
   | balanced | 90 min | 200 | $25 |
   | max-quality | 180 min | 400 | $60 |

2. **`.claude/program.md`** — a `Budget` constraint line the orchestrator re-reads every iteration
   (so a human can tighten/loosen mid-run, like the existing `Max iterations` knob).
3. **Env** — `HARNESS_BUDGET_WALL_MS`, `HARNESS_BUDGET_AGENTS`, `HARNESS_BUDGET_USD` (for
   `build-chain.js` headless runs, alongside `BUILD_CHAIN_LINK_TIMEOUT_MS`).
4. **`--budget` flag** on `/build` and `/auto` — `--budget 2h`, `--budget 150agents`, `--budget '$20'`,
   or `--budget off`. Highest precedence; the explicit per-run override.

A budget of `off` disables the cap (restores today's count-only behavior).

## Files to change

| File | Change |
|---|---|
| `.claude/scripts/budget-state.js` *(new)* | Pure `computeBudget` / `estimateCost` + `RATE_USD`; thin `gatherSpend` over receipts. |
| `test/budget-state.test.js` *(new)* | Band boundaries, multi-dimension exhaustion (any-dimension), wall-clock vs agents vs est-cost, real-token override of the estimate, `off`. |
| `.claude/scripts/build-chain.js` / `build-chain-state.js` | Add the budget dimension to the between-link halt; keep link-count cap as one dimension. |
| `.claude/skills/auto/SKILL.md` | SECTION 11: budget as priority-1 clean-checkpoint stop; SECTION 2: pre-dispatch budget read + warn. |
| `.claude/scripts/pipeline-state-readers.js` | `readBudget(projectDir)` from `budget-start` marker + receipts. |
| `.claude/scripts/pipeline-snapshot.js` | Add `budget` to the snapshot. |
| `.claude/scripts/pipeline-status.js` | Render the `Budget:` line when present. |
| `.claude/hooks/record-run.js` | Stamp `budget-start` on first run receipt; add optional usage fields when the hook input exposes them. |
| `.claude/scripts/telemetry-memory.js` | `harness_token_usage_total` + `harness_est_cost_usd` gauges. |
| `.claude/scripts/scaffold-render.js` | Per-tier `execution.budget` defaults in `buildManifest`. |
| `.claude/skills/build/SKILL.md` | Phase 3.5 est-spend line; `--auto` over-budget-projection stop; document `--budget`. |
| `.claude/program.md` (+ template) | `Budget` constraint line. |
| `project-manifest.json` template | `execution.budget` block. |

## Edge cases & non-goals

- **Never mid-write.** Halt only at iteration/link boundaries; committed work always survives and the
  run resumes by raising the cap. This is the whole point of "clean checkpoint."
- **Estimate honesty.** Cost/token figures are labelled `~`/`est` until real usage data exists; the
  *enforceable* halt never depends on an estimate it can't verify. If a user sets only an
  `est_cost_usd` cap (no wall-clock), document that it halts on an **estimate** and recommend pairing
  it with a wall-clock cap.
- **Budget ≠ quality.** No verification gate is touched; a budget halt leaves a partially-built but
  fully-verified-so-far tree (every committed group passed the ratchet).
- **Cache safety.** All state lives in the `budget-start` marker + receipts + snapshot; no new
  always-injected prompt content, so the cached prefix is untouched.
- **Backward compatible.** No budget configured → `readBudget` returns null → `/status` omits the line
  and the loops behave exactly as today (count-based caps only).

## Rollout (staged, pure-core first)

1. `budget-state.js` + tests — pure logic, mergeable alone, nothing reads it yet.
2. `readBudget` + snapshot + `/status` line — read-only surfacing of wall-clock/agent spend.
3. `record-run.js` `budget-start` stamp + optional usage fields; telemetry gauges (observability).
4. Config plumbing — manifest defaults, `--budget` flag, `program.md` line, env (resolution only).
5. **The halt** — `/auto` SECTION 11 + `build-chain.js` budget dimension (the one behavior change),
   landing last, behind everything that makes it observable. Plan-time estimate ships with it.

Each step is independently shippable and reversible; the behavior change is last.
