---
name: status
description: Show SDLC pipeline progress — a one-shot snapshot, a live watch, or a step timeline. Read-only; aggregates the state the harness already writes. CLI-friendly (Devin-style status/watch/timeline with --json).
argument-hint: "[status|watch|timeline] [--json] [--interval N]"
context: fork
---

# Pipeline status

A read-only view of where the SDLC pipeline is right now. It aggregates the files
the harness already writes (`claude-progress.txt`, `.claude/state/*`,
`features.json`, `specs/stories/dependency-graph.md`, `.claude/runs/*.jsonl`) into
one normalized snapshot and renders it. It writes no state and makes no network
calls.

Design: `docs/internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md`.

## Usage

Run the script directly — it works inside or outside a Claude session, so you can
watch a running `/auto` from a second terminal:

```bash
# one-shot snapshot (default)
node .claude/scripts/pipeline-status.js status

# live view, redraws every 3s (override with --interval SECONDS)
node .claude/scripts/pipeline-status.js watch

# unified step timeline for the current session (Devin's Progress tab)
node .claude/scripts/pipeline-status.js timeline

# machine-readable — the deterministic contract for CI / e2e / scripts
node .claude/scripts/pipeline-status.js status --json
```

`npm run status` is a shortcut for `status`.

## What it reports

`status` prints: phase · health (`on_track` / `blocked` / `failing`) · group
progress (`done / current / remaining`) · features passing X/Y · coverage vs
baseline · current iteration · pending reviews · navigation freshness/token
savings · context-cache entries/token savings · next action · blocked stories.

`--json` emits the full snapshot object (`schema_version: 1`). Treat that object —
not the text rendering — as the stable interface; the text layout may change.

## When to use

- "Where is the build?" during or after an `/auto` / `/build` run.
- Scripting a gate or e2e assertion off `--json` (e.g. assert `health !== "failing"`).
- Reviewing what steps ran this session via `timeline`.

This is a reporting surface only. It does not advance the pipeline — use `/auto`,
`/build`, `/gate`, etc. for that.
