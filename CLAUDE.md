# claude_harness_eng_v5

A Claude Code plugin scaffold for autonomous long-running application development.

## What This Is

A GAN-inspired harness combining Karpathy ratcheting + Anthropic/OpenAI harness engineering best practices:
- Generator-Evaluator architecture (no self-evaluation bias)
- Agent teams for parallel story execution
- Session chaining for multi-context-window builds
- Three-layer evaluation (API + Playwright + Vision with weighted scoring)
- Superpowers integration (brainstorming, TDD, debugging, verification at key stages)
- 2 execution modes: Full, Lean

## Installation

1. Clone: `git clone <repo-url> ~/claude_harness_eng_v5`
2. Load as plugin: `claude --plugin-dir ~/claude_harness_eng_v5/.claude`
3. Scaffold a project: `/claude_harness_eng_v5:scaffold`

## Commands, Agents & Superpowers Integration

The full Commands table, the 8-agent team (roles + model assignments), and the Superpowers pipeline-stage integration table live in `README.md` (sections *Command reference*, *Agent team*, *Superpowers integration*). They are reference material, not always-on rules, so they are kept out of this always-loaded file to preserve the prompt-cache prefix. Read `README.md` when you need the command/agent inventory.

If a `superpowers:*` skill invocation fails because the plugin is not installed, do not skip the step silently — apply the equivalent inline discipline (TDD red-green-refactor and quality rules from `.claude/skills/code-gen/SKILL.md`; for debugging, reproduce → isolate → root-cause before fixing) and note the degraded mode in the progress log.

## Coding Principles (Karpathy Guidelines)

These behavioral rules apply to all code generation — in agents, skills, and direct responses.

### Controlled Vibe Coding

Use `/vibe` for small, low-risk changes where the full SDLC pipeline would be disproportionate. `/vibe` still requires a micro-contract, narrow scope, targeted verification, and reviewer enforcement. Escalate to `/change` (add `--issue N` for a GitHub bug), `/refactor`, or the full pipeline for new workflows, public API changes, migrations, auth/security/privacy work, ambiguous requirements, or changes likely to touch more than 3 source files.

### Brownfield Discovery

Use `/brownfield` before broad planning, refactoring, or feature work in existing codebases. It creates factual architecture, test, risk, and change-strategy maps under `specs/brownfield/` so agents preserve existing contracts and choose the right lane. `/vibe` may still be used for tiny low-risk fixes, but it must respect any brownfield risk map already present. For end-to-end existing-code work (request → reviewed PR), use `/feature`, which runs `/brownfield` discovery, keeps the committed DeepWiki current, and routes to `/change` (single story) or `/spec`→`/design`→`/auto` (epic) behind three human gates.

### Disposable Artifacts (Non-Product Work)

UI mockups, architecture / ARB (Architecture Review Board) narrative documents, and research or analysis reports are **disposable artifacts**, not product code. They explain, explore, or persuade — they do not ship. They must **not** go through the generator/evaluator (GAN) loop, the ratchet gates, security review, or TDD, and you must **not** invoke `/build`, `/auto`, `/implement`, `/change`, `/refactor`, or `/scaffold` to produce them. Use the lightweight lane instead:

| Artifact | Lane |
|----------|------|
| UI mockup / component / page | `frontend-design` skill |
| Architecture / ARB / design narrative | `/design --doc-only` (single authored document; no planner/generator/evaluator, no `specs/design/` schema set) |
| Research / deep dive / analysis | `deep-research` skill |

These lanes skip contracts, ratcheting, and reviewer enforcement **by design** — abstaining from the pipeline is correct behavior here, not a shortcut, and it overrides the default impulse to brainstorm/escalate/TDD before acting. Only escalate to the SDLC pipeline if the artifact is being turned into shipped product code (e.g., a mockup becoming a real component). When in doubt about whether something is product code, ask. For a fully insulated workspace where the SDLC machinery is absent entirely, load the **harness-lite** plugin (`harness-lite/`) instead of this one. For small but *shippable* code, use `/build --lite` inside the full harness, not `harness-lite` — that loadout is only for artifacts that never ship.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask — don't guess.
- When a request is ambiguous, present multiple interpretations and let the user choose.
- Push back on unnecessary complexity. "Do you actually need X, or is Y sufficient?"

### 2. Simplicity First
- Minimum code that solves the stated problem. Nothing speculative.
- No unrequested features, single-use abstractions, premature flexibility, or speculative error handling.
- The bar: would an experienced engineer consider this overcomplicated?
- Avoid fake abstractions: a module should hide useful behavior behind a small interface, not just forward calls.

### 3. Surgical Changes
- Modify only what the request requires. Don't "improve" adjacent code, comments, or formatting.
- Match existing style conventions in the file being edited.
- When your changes orphan imports or variables, remove only what *your* changes made unused — not pre-existing dead code.
- Every altered line must trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform vague goals into verifiable success criteria before writing code.
- "Add validation" → "Write tests for invalid inputs, then make them pass."
- Plan multi-step work with clear checkpoints. Loop toward measurable outcomes.
- Tests verify public behavior through API routes, UI flows, CLIs, or exported module interfaces. Do not couple tests to private helpers or internal call order.

### 5. Verify Independently, at the Branch Level
- The final whole-branch review on the most capable model is load-bearing, not a formality: per-task reviews tend to inherit the builder's mental model and miss the defects it encodes. Run an independent whole-branch review before merging non-trivial work — it has repeatedly caught Criticals the per-task pass cleared.
- Integration/contract tests must round-trip the **real** artifact through its **real** validator/schema, never hand-built fixtures. A fixture that encodes the wrong shape keeps every test green while the feature is inert — "tests pass" ≠ "feature works." (A gate once shipped reading a *flat* contract while real sprint contracts nest checks under a `contract` key; flat-fixture tests hid it until the whole-branch review + a `validate-contract` round-trip caught it.)

> These guidelines bias toward caution over speed. Success = fewer unnecessary diffs, simpler code on first attempt, clarifying questions before implementation.

## Large Codebase Best Practices

The harness follows [Anthropic's guidance for large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start):

- **Hierarchical CLAUDE.md** — Root CLAUDE.md for project-wide rules; subdirectory CLAUDE.md files for scoped test/lint commands (generated by `/scaffold` Step 5.B for multi-module projects)
- **File exclusions** — `.gitignore` is the exclusion mechanism (Claude Code respects it by default via `respectGitignore: true`)
- **Read-only exploration** — Use the `codebase-explorer` agent for discovery before editing; separates exploration from modification
- **Session learnings** — Stop hook (`review-on-stop.js`) reviews accumulated rules and suggests CLAUDE.md updates
- **State archival** — Run `node .claude/scripts/archive-state.js` to archive oversized state files to `.claude/state/archive/`
- **Codebase map** — `CODEBASE_MAP.md` documents top-level directory structure for navigation
- **Context-first navigation** — when `specs/brownfield/code-graph.json` is real, run `node .claude/scripts/nav-query.js pack --diff --budget 1600 "<question>"` (or `/context`) before broad source reads; use `read_next` line ranges, not whole files. Refresh secondary indexes with `nav-query.js refresh`.
- **LSP integration** — `/scaffold` auto-detects LSP servers from the stack (pyright, typescript-language-server, gopls, etc.), writes them to `project-manifest.json`, and checks availability in `init.sh`
- **MCP servers** — `.mcp.json` template for connecting to internal tools, databases, and documentation
- **Subdirectory commands** — Scope test/lint commands per module to avoid running full suites on minor changes
- **Working-tree hygiene (this checkout)** — the repo lives under an iCloud-synced `Documents/` path; concurrent writes (parallel subagents) can spawn `<name> 2.<ext>` duplicate files that hang the `scaffold-copy` / `scaffold-apply` / `skills-consistency` tests. If `npm test` hangs, kill orphaned `node --test` processes and delete the ` 2.`-suffixed dupes, then re-run. Moving the clone outside the synced path prevents it.

## Prompt Caching

Claude Code is built around prompt caching: the API caches the request prefix (static system prompt + tools → `CLAUDE.md` → session context) and reuses it across turns, which is what makes long agentic sessions cheap and fast. **Caching is automatic and always-on inside Claude Code — there is nothing to enable**, and the harness makes no direct Anthropic API calls, so there are no `cache_control` breakpoints to manage. The only job is to avoid invalidating the cached prefix: a change anywhere in the prefix invalidates everything after it.

Three rules keep the prefix stable during a run:

1. **Don't churn tools mid-session.** Adding/removing a tool, plugin, or MCP server during a run rebuilds the whole cache. Settle `enabledPlugins` and `.mcp.json` *before* long `/auto` runs. (Claude Code defers MCP tool schemas via tool search rather than removing them — leave that mechanism in place.)
2. **Don't edit `CLAUDE.md` mid-session.** It's cached per-project; an edit busts the prefix for every later turn. The `session-learnings` Stop hook only *suggests* updates — apply them between sessions, not during a build.
3. **Don't swap the orchestrator's model mid-session.** Model changes happen via subagents with their own context windows (planner=Opus, generator=Sonnet, etc. — see the Agents table), never by `/model`-switching the main loop. Dynamic values (dates, timestamps) belong in messages / `<system-reminder>` tags, never in cached content.

Monitor cache hit rate like uptime. Telemetry is **off by default** (opt-in) — enable it per the README's "Enable telemetry" section (`CLAUDE_CODE_ENABLE_TELEMETRY=1` + the OTEL/Pushgateway env vars in `.claude/settings.json`). Once enabled, `telemetry/cache-alerts.rules.yml` (wired into `telemetry/prometheus.yml`) and `telemetry/grafana/dashboards/cache-health.json` (auto-provisioned) add a hit-rate alert and dashboard on top of it. See `telemetry/CACHE_MONITORING.md`.

## Key Files

- `.claude/program.md` — Karpathy human-agent bridge (edit to steer /auto)
- `.claude/settings.json` — Hook config, permissions, enabled plugins
- `.claude/workflows/` — Slot for dynamic workflows you author (each `.js` you add becomes a `/<name>` command). Ships empty; `/scaffold` copies the slot to target projects. See `.claude/workflows/README.md`
- `design.md` — Full architecture reference (copied to target projects)
- `HARNESS.md` + `harness-manifest.json` — Registry of the control system (guides × sensors across maintainability/architecture/behaviour/traceability). Read before adding or changing any gate/sensor/reviewer so the new control gets registered, not orphaned; keep the manifest honest (`node .claude/scripts/validate-harness-manifest.js`, enforced by `npm test`)
- `README.md` — Installation and usage guide
- `docs/prompting-standards.md` — How to author agent/skill prompts for the current models (read before editing any `.claude/agents/*` or `.claude/skills/*` prompt)
