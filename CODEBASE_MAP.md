# Codebase Map

Top-level navigation for the Claude Harness Engine repository. **This file is the
canonical "where things live" map** — start here, then follow the pointer to the one doc
that owns each topic (below) instead of piecing it together from several.

## Documentation map — which doc is canonical for what

The harness has several long-lived docs that used to overlap ("how does this work?"
answered in three places). Each now owns one thing; the others link here rather than
restate:

| Doc | Canonical for | Not for |
|---|---|---|
| `README.md` | Install, SKUs, first run, command/agent/superpowers reference tables | The control system's internals; architecture rationale |
| `HARNESS.md` + `harness-manifest.json` | **The control system** — every guide × sensor by axis, cadence, and wiring; the control budget | Install steps; product architecture |
| `design.md` | Full architecture reference (the GAN loop, ratchet, lanes, session chaining) | The live gate/sensor inventory (that's HARNESS.md) |
| `CODEBASE_MAP.md` *(this file)* | Directory layout + which doc owns which topic | Any topic's details — it points, it doesn't restate |
| `docs/legacy-change-disciplines.md` | The 7 legacy-change disciplines as one family + their gates | The rest of the control system (HARNESS.md) |
| `wiki/` (committed DeepWiki) | Generated, code-synced map of the current source | Hand-authored rationale (design.md) |
| `CLAUDE.md` | Always-loaded project rules for agents | Reference material (kept out to protect the prompt-cache prefix) |

## Directory layout

| Path | What it is |
|---|---|
| `.claude/commands/` | The one true slash command (`/scaffold` bootloader) |
| `.claude/skills/` | All pipeline workflows as skills (brd, spec, design, implement, evaluate, auto, brownfield, code-map, refactor, change, vibe, …) |
| `.claude/agents/` | Subagent definitions (planner, generator, evaluator, design-critic, security-reviewer, code-reviewer, codebase-explorer) |
| `.claude/hooks/` | Lifecycle hooks (pre-write gate, pre-bash gate, verify-on-save, record-run, review-on-stop, graph-refresh, check-git-hooks) + shared `lib/` |
| `.claude/git-hooks/` | Git-level hooks installed by `/scaffold` (pre-commit ratchet, commit-msg) |
| `.claude/scripts/` | Standalone utilities (model-tier, trace-check, archive-state, telemetry-*, certification, upstream-watch, control-budget-gate, sensor-value-report) |
| `.claude/templates/` | File templates `/scaffold` copies into target projects, including `state-seeds/` |
| `.claude/workflows/` | Empty slot for user-authored dynamic workflow commands |
| `.claude/state/` | Tracked runtime snapshot for this harness repo (lane, learned rules, failure log, telemetry ledger, ratchet baselines); scaffolded targets start from `.claude/templates/state-seeds/` |
| `.github/workflows/` | GitHub Actions for fast CI and upstream Claude Code drift watch |
| `.github/upstream/` | Checked-in upstream snapshots consumed by `.claude/scripts/upstream-watch.js` |
| `docs/` | Authoring standards, telemetry/testing guides, design proposals, legacy-change-disciplines map |
| `docs/zl-continuum-rubric.md` | One-page Z/L task-placement rubric (L/M/Z bands → harness lanes + human review) |
| `telemetry/` | Prometheus/Grafana/OTEL configs for opt-in cache + harness metrics |
| `test/` | Harness unit tests; `test/e2e/` runs live Claude pipeline checks; `test/evals/` holds golden assertion fixtures |
| `packages/` | Reusable packaged pieces consumed by the SKU builder |
| `harness-lite/` | The artifact-only loadout (mockups / ARB docs / research) — a real, working plugin, not a stub; load *instead of* the full harness for disposable-artifact work |
| `symphony_clone/` | Sibling Docker service: Linear/Jira-board-as-control-plane autonomous dispatch orchestrator |
| `HARNESS.md` | The control-system registry (guides × sensors); see the doc map above |
| `harness-manifest.json` | Machine-readable source of truth behind HARNESS.md |
| `design.md` | Full architecture reference |
| `CLAUDE.md` | Always-loaded project rules for agents |
| `README.md` | Install + command/agent/superpowers reference tables |
