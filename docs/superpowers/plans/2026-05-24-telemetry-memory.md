# Telemetry Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scaffold dashboard show durable cumulative harness telemetry instead of depending on the latest Pushgateway sample.

**Architecture:** `record-run.js` writes every harness telemetry record to an append-only JSONL ledger in `.claude/state/telemetry-ledger.jsonl`. A shared telemetry memory module replays that ledger into cumulative Prometheus samples under the stable Pushgateway job `claude_harness_memory`, and the Grafana dashboard reads that memory job.

**Tech Stack:** Node.js CommonJS scripts, Claude Code hooks, Prometheus Pushgateway text exposition, Grafana PromQL dashboard JSON.

---

### Task 1: Tests

**Files:**
- Modify: `test/record-run-hook.test.js`
- Modify: `test/scaffold-command.test.js`

- [ ] Add a test proving hook telemetry writes `.claude/state/telemetry-ledger.jsonl` and pushes cumulative samples to `/metrics/job/claude_harness_memory/instance/<project>`.
- [ ] Add a test proving two hook events produce a cumulative value of `2` from ledger replay.
- [ ] Add dashboard assertions that harness panels filter `job="claude_harness_memory"`.

### Task 2: Memory Module

**Files:**
- Create: `.claude/scripts/telemetry-memory.js`
- Create: `.claude/scripts/replay-telemetry.js`

- [ ] Implement JSONL append/read helpers that ignore malformed ledger lines.
- [ ] Aggregate cumulative counters for `harness_agent_runs_total`, `harness_conversation_turns_total`, `harness_command_invocations_total`, and `harness_tool_events_total`.
- [ ] Aggregate latest-value gauges for `harness_pending_reviews`, `harness_iteration_current`, and `harness_story_active`.
- [ ] Push the full snapshot to Pushgateway job `claude_harness_memory`.

### Task 3: Hook Wiring

**Files:**
- Modify: `.claude/hooks/record-run.js`

- [ ] Replace per-session counter pushes with ledger append plus full memory replay.
- [ ] Keep `/scaffold` excluded from command telemetry.
- [ ] Keep unnamed `SubagentStop` events out of `harness_agent_runs_total`.

### Task 4: Dashboard And Scaffold Coverage

**Files:**
- Modify: `telemetry/grafana/dashboards/harness-overview.json`
- Modify: `test/scaffold-command.test.js`

- [ ] Update all harness-specific Grafana queries to read `job="claude_harness_memory"`.
- [ ] Leave native `claude_code_*` OTEL queries unchanged because they come from the collector, not the memory job.
- [ ] Verify `/scaffold` already copies `.claude/scripts`, so target repos receive the replay script.

### Task 5: Verification And Target Sync

**Files:**
- Copy into target repo after tests pass:
  - `.claude/hooks/record-run.js`
  - `.claude/scripts/telemetry-memory.js`
  - `.claude/scripts/replay-telemetry.js`
  - `telemetry/grafana/dashboards/harness-overview.json`

- [ ] Run `node --test test/*.test.js`.
- [ ] Copy changed assets to the target scaffolded repo.
- [ ] Recreate Grafana in the target repo.
- [ ] Run the replay script once in the target repo to seed cumulative memory.
