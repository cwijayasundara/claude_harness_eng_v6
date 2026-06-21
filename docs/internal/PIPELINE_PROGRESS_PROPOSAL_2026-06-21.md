# SDLC Pipeline Progress Visibility — Grounded Proposal

**Date:** 2026-06-21
**Status:** Analysis + roadmap. Disposable artifact (not product code; not run through the GAN pipeline).
**Inputs:** User ask (a CLI-friendly view of pipeline progress + verify the telemetry dashboard receives e2e pushes) + Devin CLI research (docs.devin.ai/cli) + codebase map of the existing telemetry/state surface.

---

## 0. TL;DR

The data for a full progress view **already exists on disk** — there is no display layer. The harness already writes a typed step stream (`.claude/runs/*.jsonl`) and rich session state (`claude-progress.txt`, `.claude/state/*`, `features.json`, `iteration-log.md`). What's missing is what Devin shipped: **one normalized status object + a snapshot view + a live-tail view + a `--json` contract.**

Two concrete gaps:

1. **No CLI progress surface.** `/auto` and `/build` print to stdout mid-run, but you cannot ask "where is the pipeline right now?" from another terminal. This is exactly the Devin gap.
2. **The dashboard is never exercised by e2e.** The e2e runner never sets `HARNESS_PUSHGATEWAY_URL`, so runs write local receipts but **push nothing** to Prometheus/Grafana. The "is the dashboard receiving e2e updates?" concern is correct — today it is not tested end-to-end.

This proposal closes both with a thin, read-only layer: **one aggregator script + three presenters + one e2e wiring change + one Grafana dashboard.** Zero new state files, zero new always-on instrumentation.

---

## 1. What Devin does (the part worth stealing)

Devin's progress model is three primitives, not a UI:

| Primitive | Devin | Notes |
|---|---|---|
| Work = a **session** of typed **steps** | every shell command, edit, browser action is a logged step linked to a progress update | the GUI "Progress tab" is just this stream rendered |
| **`devin status`** | one-line snapshot of the active session | read-only view over the step stream |
| **`devin watch`** | live-tail of the active session in the terminal | same data, continuously redrawn |
| Global **`--json`** | suppresses all color/visual output; returns raw JSON for *every* command | makes the CLI deterministically scriptable |
| `/session-stats`, `--output-format atif` | cumulative stats; per-step token + cost export | derived from the step stream |

**The insight:** Devin didn't build a dashboard, it built **one status object** with a snapshot view, a live view, and a `--json` contract. Everything else (GUI Progress tab, session-stats) is a render of that object.

Sources: [Devin CLI overview](https://docs.devin.ai/cli) · [CLI command reference / changelog](https://docs.devin.ai/cli/changelog/stable) · [Devin session tools (Progress tab)](https://docs.devin.ai/work-with-devin/devin-session-tools).

---

## 2. What this harness already has (ground truth)

All paths verified against the current tree.

### 2.1 Step stream — already running, always-on
- `.claude/hooks/record-run.js` fires on `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop`.
- Writes a typed record per event to `.claude/runs/YYYY-MM-DD.jsonl` (local, always-on) and — only if `HARNESS_PUSHGATEWAY_URL` is set — pushes Prometheus metrics via `.claude/scripts/telemetry-memory.js`.
- Record kinds: `prompt`, `turn`, `subagent`, `subagent_stop`, `tool`, `phase_eval`. **This is Devin's "steps".**

### 2.2 Session state — already written by the orchestrator
- `claude-progress.txt` — session blocks with `groups_completed`, `groups_remaining`, `current_group`, `features_passing: 47 / 203`, `coverage`, `next_action`, `blocked_stories`.
- `.claude/state/current-{lane,mode,iteration,group,story}` — transient markers.
- `features.json` — feature matrix (`{id, category, story, group, passes}`).
- `.claude/state/iteration-log.md` — per-group outcome (status, checks, coverage delta, micro-DAG).
- `.claude/state/pending-reviews.jsonl` — line count = pending reviews.
- `specs/stories/dependency-graph.md` — Mermaid + group list → wave plan.
- `.claude/certification/status.json` — capability proof matrix.

### 2.3 Telemetry pipeline — already works
- `telemetry-memory.js` builds a Prometheus snapshot and `pushSnapshot()`s to Pushgateway → Prometheus (`telemetry/prometheus.yml`) → Grafana.
- Existing metrics: `harness_agent_runs_total`, `harness_conversation_turns_total`, `harness_pending_reviews` (gauge), `harness_iteration_current` (gauge), `harness_story_active` (gauge), `harness_tool_events_total`, `harness_command_invocations_total`, `harness_phase_eval_score`, plus native Claude Code OTEL token/cost metrics.
- Dashboards: `telemetry/grafana/dashboards/cache-health.json` and `harness-overview.json` (Team Productivity).

### 2.4 The two gaps
- **No CLI display.** No `--status` / progress-summary command. State is queryable only by reading files or hitting the Prometheus API.
- **E2E never pushes.** `test/e2e/run.sh` brings up Prometheus/Grafana (proven by `test/e2e/results/stage-5-prometheus.json` / `stage-6-grafana.json`) but never sets `HARNESS_PUSHGATEWAY_URL`, so no `harness_*` metrics are produced during e2e. The dashboard's e2e ingestion path is untested.

---

## 3. Proposal

### Part A — `pipeline-status` CLI (the Devin steal)

One read-only **aggregator** + three thin presenters. No new state — it reads what's already on disk.

**`.claude/scripts/pipeline-status.js`** produces a single normalized snapshot:

```json
{
  "schema_version": 1,
  "generated_at": "<injected at call time, never cached>",
  "run":     { "lane": "auto", "mode": "lean", "session_id": "…", "harness_sha": "…" },
  "phase":   "implement",
  "wave":    { "current": 2, "total": 4 },
  "groups":  { "completed": ["A","B"], "current": "C", "remaining": ["D"], "blocked": [] },
  "stories": { "active": ["E4-S1"], "blocked": [] },
  "iteration": { "group": "C", "current": 2, "max": 3 },
  "features":  { "passing": 47, "total": 203, "by_group": { "A": "12/12" } },
  "coverage":  { "current": 82, "baseline": 80 },
  "pending_reviews": 1,
  "last_step": { "kind": "subagent", "agent": "generator", "exit": "ok", "ts": "…" },
  "next_action": "Run evaluator against group C",
  "health": "on_track"
}
```

| Source file | Snapshot field(s) |
|---|---|
| `.claude/state/current-*` | `run.lane`, `run.mode`, `iteration`, `groups.current`, `stories.active` |
| `claude-progress.txt` (latest block) | `groups.*`, `features.passing/total`, `coverage`, `next_action`, `stories.blocked` |
| `features.json` | `features.passing/total`, `features.by_group` |
| `specs/stories/dependency-graph.md` | `wave.total`, group set |
| `.claude/state/iteration-log.md` | `iteration.current/max`, `health` |
| `.claude/state/pending-reviews.jsonl` | `pending_reviews` |
| `.claude/runs/*.jsonl` (current `session_id`) | `last_step`, `timeline` |

`health` derivation: `failing` if the latest iteration-log entry is `FAIL (attempt 3 of 3)` or coverage < baseline; `blocked` if any blocked stories/groups; else `on_track`.

Three subcommands, mirroring Devin 1:1:

| Devin | Harness | Behavior |
|---|---|---|
| `devin status` | `pipeline-status.js status` | One-shot snapshot: phase · wave x/y · features X/Y · coverage · pending reviews · next action · blocked. Color terminal. |
| `devin watch` | `pipeline-status.js watch [--interval N]` | Re-render every N s (default 3); tails `.claude/runs/*.jsonl` + re-reads state. Wave/group progress bar for long `/auto` runs. |
| Progress tab | `pipeline-status.js timeline` | Devin's unified step view: chronological render of run-receipt events for the current `session_id`, grouped by group/story, status glyphs (✓/✗/⋯). |
| global `--json` | `--json` on all three | Suppresses color; emits the snapshot object verbatim. The machine contract for CI + e2e. |

**Surface:** a plain `node` script (works *outside* a Claude session — watch a running `/auto` from a second terminal, which is the whole point), plus a thin **`/status` skill** wrapper for in-session use. No new hooks; no churn to the cached prompt prefix.

### Part B — Close the e2e → dashboard loop

1. In `test/e2e/run.sh`, when the telemetry stack is up (already proven by the `stage-5-prometheus.json` / `stage-6-grafana.json` checks), export `HARNESS_PUSHGATEWAY_URL` for the run so receipts actually push, scoped to a test `instance` id.
2. Add an e2e assertion: after the run, query Prometheus for `harness_agent_runs_total{instance="<test project id>"}` and assert non-zero — the missing proof that **the dashboard receives e2e updates.**
3. Have `pipeline-status.js --json` optionally reuse `telemetry-memory.js`'s `pushSnapshot()` to emit two new gauges — `harness_features_passing` and `harness_coverage` — so CLI and Grafana share one source of truth.

### Part C — Grafana "SDLC Pipeline Progress" dashboard

A second dashboard alongside `harness-overview.json`, sourced from existing metrics (`harness_iteration_current`, `harness_story_active`, `harness_pending_reviews`) plus the two new gauges from B.3: wave progress, features-passing trend, blocked stories, current group/iteration. **CLI stays the primary surface** (matches the ask); this complements the telemetry already in place. Auto-provisioned like `cache-health.json`.

---

## 4. Why this is the right size

Per the harness build principle (*prefer out-of-box, only build what's missing*):

- **No new state** — every field is read from files that already exist.
- **No new always-on instrumentation** — the step stream (`record-run.js`) and ledger already run; Part A only *reads* them.
- **Reuses the telemetry path** — Part B/C extend `telemetry-memory.js` and the existing Grafana provisioning rather than adding a parallel system.
- **Doesn't touch the cached prefix** — a node script + one skill, no `CLAUDE.md` / tool / MCP changes mid-session.

Net new surface: **one aggregator script + three presenters (same file) + one `/status` skill + one e2e wiring change + one dashboard JSON.**

---

## 5. Build order

All three parts approved for build (2026-06-21). **Status: all shipped 2026-06-21** (branch `feat/pipeline-status-cli`).

1. **Part A — DONE.** `pipeline-status.js` (`status` / `watch` / `timeline` / `--json`), split into `pipeline-state-readers.js` + `pipeline-snapshot.js` + `pipeline-status.js` for the 300-line/SRP gate; `/status` skill + `npm run status`. 17 tests.
2. **Part B — DONE.** `claude-runner` sets `HARNESS_PUSHGATEWAY_URL` so e2e builds push live; Stage 5 asserts `harness_conversation_turns_total` reaches Prometheus; `telemetry-pipeline-gauges.js` emits `harness_features_passing`/`_total` + `harness_coverage`/`_baseline` on every push. Contract + unit tests.
3. **Part C — DONE.** `telemetry/grafana/dashboards/pipeline-progress.json` (auto-provisioned), guarded by `test/pipeline-progress-dashboard.test.js` including an emitter↔dashboard drift check.

### Open questions — resolved during build
- **Snapshot freshness in `watch`:** re-reads all state each tick (simple, correct). Not optimized; no measurable cost.
- **`session_id` scoping for `timeline`:** defaults to the most recent session's id (the last run receipt). `--session <id>` not yet added (deferred; low demand).
- **Multi-wave `wave.total`:** derived from the dependency-graph group count. Accurate for the single-wave graphs in the repo; true multi-wave partitioning remains deferred.

### Remaining
- Live e2e assertion runs only in the gated suite (needs `claude` + the telemetry docker stack); the wiring is contract-locked in the cheap suite.
- Branch not yet pushed / no PR opened.
