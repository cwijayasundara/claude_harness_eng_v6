# Codebase Map

Top-level navigation for the Claude Harness Engine repository.

| Path | What it is |
|---|---|
| `.claude/commands/` | The one true slash command (`/scaffold` bootloader) |
| `.claude/skills/` | All pipeline workflows as skills (brd, spec, design, implement, evaluate, auto, brownfield, code-map, refactor, change, vibe, …) |
| `.claude/agents/` | Subagent definitions (planner, generator, evaluator, design-critic, security-reviewer, code-reviewer, codebase-explorer) |
| `.claude/hooks/` | Lifecycle hooks (pre-write gate, pre-bash gate, verify-on-save, record-run, review-on-stop, graph-refresh, check-git-hooks) + shared `lib/` |
| `.claude/git-hooks/` | Git-level hooks installed by `/scaffold` (pre-commit ratchet, commit-msg) |
| `.claude/scripts/` | Standalone utilities (model-tier, trace-check, archive-state, telemetry-*, certification, upstream-watch) |
| `.claude/templates/` | File templates `/scaffold` copies into target projects, including `state-seeds/` |
| `.claude/workflows/` | Empty slot for user-authored dynamic workflow commands |
| `.claude/state/` | Tracked runtime snapshot for this harness repo (lane, learned rules, failure log, telemetry ledger); scaffolded targets start from `.claude/templates/state-seeds/` |
| `.github/workflows/` | GitHub Actions for fast CI and upstream Claude Code drift watch |
| `.github/upstream/` | Checked-in upstream snapshots consumed by `.claude/scripts/upstream-watch.js` |
| `docs/` | Authoring standards, telemetry/testing guides, design proposals |
| `telemetry/` | Prometheus/Grafana/OTEL configs for opt-in cache + harness metrics |
| `test/` | Harness unit tests; `test/e2e/` runs live Claude pipeline checks; `test/evals/` holds golden assertion fixtures |
| `symphony_clone/` | Sibling Docker service: Linear/Jira-driven autonomous dispatch orchestrator |
| `design.md` | Full architecture reference |
| `README.md` | Install + command/agent/superpowers reference tables |
