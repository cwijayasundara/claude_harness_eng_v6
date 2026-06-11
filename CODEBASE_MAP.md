# Codebase Map

Top-level navigation for the Claude Harness Engine repository.

| Path | What it is |
|---|---|
| `.claude/commands/` | The one true slash command (`/scaffold` bootloader) |
| `.claude/skills/` | All pipeline workflows as skills (brd, spec, design, implement, evaluate, auto, brownfield, code-map, refactor, change, vibe, …) |
| `.claude/agents/` | Subagent definitions (planner, generator, evaluator, design-critic, security-reviewer, clean-code-reviewer, codebase-explorer) |
| `.claude/hooks/` | Lifecycle hooks (pre-write gate, verify-on-save, record-run, review-on-stop, graph-refresh) + shared `lib/` |
| `.claude/git-hooks/` | Git-level hooks installed by `/scaffold` (pre-commit ratchet, commit-msg) |
| `.claude/scripts/` | Standalone utilities (model-tier, trace-check, archive-state, telemetry-*) |
| `.claude/templates/` | File templates `/scaffold` copies into target projects |
| `.claude/workflows/` | Empty slot for user-authored dynamic workflow commands |
| `.claude/state/` | Runtime state (lane, learned rules, failure log, telemetry ledger) |
| `docs/` | Authoring standards, telemetry/testing guides, design proposals |
| `telemetry/` | Prometheus/Grafana/OTEL configs for opt-in cache + harness metrics |
| `test/` | Harness's own unit tests; `test/e2e/` runs the pipeline against a live Claude |
| `symphony_clone/` | Sibling Docker service: Linear/Jira-driven autonomous dispatch orchestrator |
| `design.md` | Full architecture reference |
| `README.md` | Install + command/agent/superpowers reference tables |
