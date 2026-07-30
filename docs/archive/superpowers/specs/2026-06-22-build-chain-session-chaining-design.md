# Build-Chain: Cross-Process Session Chaining for `/build --auto`

**Date:** 2026-06-22
**Status:** Approved design — ready for implementation plan
**Related:** `autonomous-engineer-roadmap` memory (S4 runtime gap), `.claude/skills/auto/SKILL.md`, `.claude/skills/build/references/autonomous-lane.md`, `symphony_clone/`

## Problem

A full `/build --auto` run on a multi-story PRD plans fully headless (e.g. 2 clusters / 7 stories / design) but is SIGKILLed at ~40 min before code generation completes. A single `claude -p` process cannot carry plan → build → deploy → test in one turn. This is the one remaining gap to Devin-parity on fully-autonomous PRD-in / PR-out for the **tracker-free** path (symphony already covers the tracker-driven path by spawning a fresh `claude -p` per issue/cluster).

The checkpoint infrastructure to resume already exists and is in-session-proven:

- `claude-progress.txt` — last session block carries `next_action`, `groups_remaining`, `current_group`, `features_passing: X / Y`, `last_commit`.
- `features.json` — granular per-feature pass/fail.
- Per-group git commits on `auto/group-{G}` branches.
- `/auto` SECTION 2 already recovers from these at iteration start.

What is missing is purely a **cross-process driver**: nothing detects that a `claude -p` ended (cleanly or via SIGKILL) with groups remaining and spawns a fresh process to continue. In-session chaining works; it cannot outlive one process.

## Goals

- A multi-story PRD reaches an open PR via the tracker-free path, surviving past single-process lifetime.
- No regression to existing invariants: the writer never grades its own work; no PR opens over a red build; the harness never merges on its own.
- Reuse the existing checkpoint contract and `/auto` recovery; add the smallest possible new surface.

## Non-Goals (v1)

- `--pod` per-cluster chaining (already yields per-cluster PRs; lives closer to symphony; design-compatible but not built in v1).
- Warm-start machine snapshots (Devin S4 primitive).
- `claude --resume` conversation-context continuation — we deliberately use fresh-context **file recovery**, not conversation replay, so each link starts with a clean context window.
- Interactive `/build --auto` behavior is unchanged.

## Decisions (locked)

1. **Engine home:** a dedicated lightweight driver, not an extension of symphony. Smallest surface; no tracker concepts leak into the integrated single-PR path.
2. **Link boundary:** voluntary yield per wave. Each fresh `claude -p` does exactly one group/wave, commits, checkpoints, then exits cleanly. SIGKILL never lands mid-write.
3. **Trigger:** the driver is the **headless entrypoint** (driver-as-entrypoint). It is wired into the e2e auto runner, exposed as `npm run build:chain`, and callable by symphony's per-cluster tail. Interactive `/build --auto` keeps today's single-process behavior. Headless `/build --auto` prints a one-line pointer to the driver instead of silently dying at the wall.

## Architecture

```
build-chain.js  (node, the headless entrypoint)
   │
   ├─ Link 0  PLAN      →  claude -p "/build --auto --plan-only <prd>"   (already exists)
   │                        writes specs/, dependency-graph.md, features.json
   │
   ├─ Link 1..N BUILD   →  claude -p "/auto --once"   (new single-wave mode)
   │     (loop)             each link: one wave → 8 ratchet gates → commit → checkpoint → clean exit
   │                        driver re-spawns a FRESH process per wave until groups_remaining empty
   │
   └─ Link F  FINALIZE  →  claude -p "/build --auto --finalize"   (new thin alias)
                            Phases 9 (E2E gen) → 9.5 (pre-PR verify+repair) → 10 (README) → 11 (PR)
```

The driver wraps `claude`; a `claude` session never wraps the driver. Between links the driver reads only state the harness **already writes** (`claude-progress.txt` last block + `features.json`). The handoff contract already exists; the driver consumes it.

## Components

### 1. `build-chain.js` (new driver)

A state machine: `PLAN → BUILD* → FINALIZE → DONE` (plus a terminal `STUCK`).

- `runLink(promptKind)` — spawns a fresh `claude -p` for the link's slash command with a per-link timeout (`killSignal: SIGKILL`, mirroring `test/e2e/helpers/claude-runner.js`).
- **State decider** (pure fn) — given the last `claude-progress.txt` block + `features.json`, returns the next state:
  - `next_action: DONE …` or empty `groups_remaining` after BUILD → `FINALIZE`.
  - `next_action: CONTINUE` / non-empty `groups_remaining` → another `BUILD` link.
  - finalize complete → `DONE`.
- **Cross-process stall watchdog** (pure fn) — lift `MAX_NO_PROGRESS` semantics from `auto-continue-on-stop.js`: if K consecutive BUILD links add no new passing feature (`features_passing` count does not rise), write a loud `STUCK` marker and stop. Never spin.
- **Link budget cap** (pure fn) — max links derived from group count × max self-heal attempts. A slice of Devin's S4 per-task budget cap. Exceeding it → `STUCK`.
- **Trust order for "what passed":** git + `features.json` over `claude-progress.txt` (defends against a checkpoint that lagged a commit).

File-size discipline: keep `build-chain.js` < 300 lines and every top-level function ≤ 30 lines (harness gates). Extract pure helpers (state decider, stall watchdog, budget) into a sibling module if needed so they are unit-testable without spawning `claude`.

### 2. `/auto --once` (single-wave mode)

A terminating condition added to the existing loop. Computes the ready wave, runs it through all 8 ratchet gates, commits, checkpoints `claude-progress.txt`, then exits cleanly with `next_action: CONTINUE` (or `DONE` if no groups remain) — does **not** loop to the next wave. Everything else in `/auto` is reused unchanged. Optional `--sequential --once` shrinks a link to a single group when a wave is too large.

### 3. `/build --auto --finalize` (new thin alias)

Runs Phases 9 → 9.5 → 10 → 11 only (E2E generation, pre-PR verification + bounded defect repair, README, raise PR). Asserts all features pass and `/gate` is green before Phase 11. **Never merges.**

### 4. Wiring & docs

- `npm run build:chain` script.
- Update `test/e2e/harness-auto-run.test.js` to drive the multi-story PRD that currently SIGKILLs — the live proof.
- New static `test/build-chain-contract.test.js` to keep `npm test` green without a live run (mirrors existing `*-contract.test.js` pattern: asserts driver state-machine transitions and flag wiring by parsing skill/driver files).
- README "Operating modes" + `autonomous-lane.md` notes.

## Failure-Mode Defenses

- **Voluntary yield** ⇒ clean exit *after* commit + checkpoint, so SIGKILL never lands mid-write.
- **Oversized wave** ⇒ if a link dies uncleanly, the driver counts no-progress; optional fallback to `--sequential --once` to shrink the link.
- **Partial state** ⇒ driver trusts git + `features.json` over `claude-progress.txt`.
- **Never PR over red** ⇒ finalize gates on all-features-pass + green `/gate` before Phase 11.
- **Runaway spend** ⇒ link budget cap → loud `STUCK`, never infinite spin.

## Testing Strategy (TDD)

1. Static contract test (`build-chain-contract.test.js`) first — asserts the state-machine transitions and flag wiring exist.
2. Unit tests for the pure helpers — state decider (progress + features → next state), stall watchdog, link budget. No `claude` spawning required.
3. `/auto --once` terminating-condition tests.
4. Live e2e (opt-in, not in CI): the multi-story PRD that currently dies, now reaching an open PR.

## Open Implementation Detail

`/auto --once` must distinguish "this wave finished, more remain" from "all groups done." The existing `claude-progress.txt` fields (`groups_remaining`, `next_action`) already encode both; the implementation plan should pin the exact strings the driver keys off so the handoff contract is unambiguous.
