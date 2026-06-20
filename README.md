# Claude Harness Engine v5 — Getting Started

A Claude Code plugin for autonomous, long-running application development. GAN-inspired generator-evaluator architecture with Karpathy ratcheting — quality only moves forward.

Current version: `2.0.0`

You need to hold exactly four ideas to use this:

1. **One decision:** are you building something new, or changing existing code? Pick a lane below.
2. **The ratchet blocks regressions** — tests, coverage, lint/types, and security gates only ever tighten.
3. **A separate evaluator verifies** — the agent that writes code never grades its own work.
4. **You merge** — the harness produces commits and proof; it never merges on its own.

Everything else (telemetry, trackers, modes, framework packs) is optional tuning.

---

## Quickstart

**Prerequisite — Playwright plugin.** The evaluator's browser checks (Layer 2) and the design-critic vision loop (Layer 3) call the official Playwright plugin's MCP browser tools. `/scaffold` enables `playwright@claude-plugins-official` in the target project's `.claude/settings.json` automatically; if you skip scaffolding or trimmed `enabledPlugins`, add `"playwright@claude-plugins-official": true` yourself or `/evaluate` degrades to API-only checks (and says so with a `failure_layer: infrastructure` verdict).

```bash
# 1. Clone the harness
git clone https://github.com/cwijayasundara/claude_harness_eng_v5.git ~/claude_harness_eng_v5

# 2. Load it as a plugin from your target project
cd ~/my-project
claude --plugin-dir ~/claude_harness_eng_v5/.claude
```

> **Path matters:** keep the clone path as shown so docs and `--plugin-dir` examples match. If your Claude Code UI shows a namespaced command, use `/claude_harness_eng_v5:scaffold`.

Then, inside Claude Code:

```
/scaffold
```

Run `/scaffold`. This asks a few questions about your stack and project type, then generates the `.claude/` directory (agents, skills, hooks, templates), `project-manifest.json`, `CLAUDE.md`, `design.md`, `init.sh`, `features.json`, and initializes git with the harness commit hooks.

## One decision: new code or existing code?

```
Are you building something NEW?
├── Yes → small scope (CLI, library, ≤5 stories)?  → /build --lite
│         otherwise                                 → /build
│
└── No (existing codebase) → first time here? run /brownfield once, then:
          ├── tiny safe edit (≤3 files, <150 lines, no auth/API) → /vibe
          ├── changed behavior (add --issue N for a GitHub bug)  → /change
          ├── structure only, no behavior change                 → /refactor
          └── big enough to need specs                           → /build (brownfield-aware)
```

`/build` runs the planning stages (BRD → spec → design → test plan) and the `/auto` loop for you, with human approval gates between each. Need the safest cut-points before a big change first? `/brownfield --seams "<goal>"`.

Not sure? Just describe the change in plain words — the harness classifies it and recommends a lane.

## What happens while it runs

Once planning is approved, `/auto` loops autonomously per dependency group:

1. Recovers state from prior sessions
2. Negotiates a sprint contract (generator + evaluator)
3. Spawns an agent team (up to 5 parallel teammates)
4. Runs 8 ratchet gates: tests → lint/types → coverage → architecture → evaluator → design-critic → security → fresh-context diff review
5. Self-heals failed gates (max 3 attempts, different strategy each time)
6. Commits, updates state, moves to next group

Steer it mid-run by editing `.claude/program.md`. Quality gates are enforced by hooks in real time and at commit time — they only ratchet upward.

## When it finishes

- Proof lands in `specs/reviews/`, `iteration-log.md`, `features.json`, plus the commits
- Review diffs in git as usual — the harness never merges on its own

---

## Command reference

These are the **entry points you actually type** — one per situation:

| Command | Purpose |
|---|---|
| `/scaffold` | Bootstrap a project (the only true slash command) |
| `/build` | Greenfield (or brownfield-aware) build: runs planning → `/auto` for you, with human gates. `--lite` for small new projects |
| `/auto` | Resume / steer the autonomous ratcheting loop directly |
| `/brownfield` | Map an existing codebase before changing it; `--seams "<goal>"` ranks the safest cut-points |
| `/vibe` | Controlled small-change lane (≤3 files, <150 lines, no auth/API) |
| `/change` | Behavior change on existing code (test-first); `--issue N` for a GitHub bug fix |
| `/refactor` | Behavior-preserving cleanup with ratchet gate; `--sweep` scans the repo for pattern drift |
| `/gate` | On-demand pre-merge quality gate (evaluator + security review) |
| `/tracker-publish` | Publish dependency groups to Linear/Jira (optional) |

Execution modes for `/auto`: **Full** (all gates, the default) and **Lean** (same as Full but skips the design-critic vision loop). Both run the security gate and the evaluator. For small or quick work use `/build --lite` or `/vibe` rather than a weaker `/auto` mode.

### Internal pipeline stages

`/build`, `/auto`, and `/brownfield` run these for you. They remain invokable directly as a power-user escape hatch, but you don't need to learn them to use the harness:

| Stage | Run by | Purpose |
|---|---|---|
| `/brd` | `/build` | BRD from a Socratic interview; `--frd <path>` grounds it in a Functional Requirements Document |
| `/spec` | `/build` | BRD → stories + dependency graph + features.json |
| `/design` | `/build` | Architecture + schemas + UI mockups; `--doc-only` for a standalone ARB narrative (no pipeline) |
| `/test` | `/build`, `/auto` | Test plan + Playwright E2E |
| `/implement` | `/auto` | Code generation with agent teams |
| `/evaluate` | `/auto`, `/gate` | Run app, verify sprint contract (API + Playwright + schema) |
| `/deploy` | `/build` | Docker Compose + init.sh |
| `/code-map` | `/brownfield`, `/seam-finder` | Deterministic AST dependency graph (`code-graph.json` + symbol map + skeletons; hook-refreshed) |
| `/seam-finder` | `/brownfield --seams` | Rank safe cut-points for a goal |
| `/clarify` | planning stages | Bounded clarification gate |
| `/install-framework-packs` | `/scaffold` | Verify configured framework packs |

Behavior-preservation sub-skills run automatically when editing existing code (see below).

### Harness vs native Claude Code commands

The harness commands above are loaded via `--plugin-dir`. Claude Code also ships **native** built-in
commands with similar-sounding names. They are not interchangeable — reach for the right one:

| If you want to… | Native command | Harness command |
|---|---|---|
| Review a GitHub **PR** | `/review` | — |
| Run the harness pre-merge **quality gate** (evaluator + security, blocking verdicts) | — | `/gate` (renamed from `/review` to end the collision) |
| Review the current **diff** for bugs/cleanups (advisory, one-shot) | `/code-review`, `/simplify`, `/security-review` | the GAN reviewers inside `/gate` / `/auto` Gate 7–8 (blocking + ratcheted) |
| **Run / drive the app** to eyeball a change | `/run`, `/verify` | `/evaluate` (three-layer weighted scoring on top) |
| **Recurring/interval** execution | `/loop`, `/schedule` | — (use these to *pace or schedule* `/auto`; `/auto` is the build loop, not a scheduler) |
| Generate just a **CLAUDE.md** | `/init` | `/scaffold` (full bootstrap; CLAUDE.md is one step of it) |

Rule of thumb: **the harness owns orchestration, ratcheting, and the GAN writer/grader separation;
native commands own the atomic operations** (review a diff, run the app, schedule a job). Where a
native command is a strictly better engine for an atomic step, the harness *delegates* to it rather
than re-implementing it — e.g. `/refactor` runs native **`/simplify`** as its mechanical-cleanup
engine (Step 6), fenced by the behavior-preservation gates, then `clean-code-reviewer` judges
structure. Full analysis and the integration roadmap: [docs/native-command-integration.md](docs/native-command-integration.md).

**Behavior-preservation sub-skills** (invoked automatically by `/refactor`, `/change`, `/vibe`, `/implement`, and `/auto` teammates when editing existing code; see `docs/behavior-preservation.md`): `checking-coverage-before-change` (symbol-level coverage verdicts via `coverage_map.py`), `pinning-down-behavior` (characterization tests that you watch bite), `sprouting-instead-of-editing` (Feathers' escape hatch for unpinnable code), `keeping-refactors-pure` (no tangled commits; enforced by the pre-commit hook via `HARNESS_COMMIT_KIND=refactor`), `checking-migration-safety` (expand-contract for schema changes, proven reversibility), `upgrading-dependencies` (one dependency bump per commit, changelog + blast-radius audit).

---

## Agent team

Eight agents (model pinned in each agent's frontmatter):

| Agent | Role | Model |
|---|---|---|
| Planner | Sprint planning, story breakdown, design architecture | Opus 4.8 |
| Generator | Feature implementation (spawns teammates); also authors tests and UI mockups | Sonnet 4.6 |
| Evaluator | Runtime mode: runs app, API + Playwright verification + latency regression ratchet. Artifact mode: rubric-scores planning docs (BRD/spec/design/brownfield/seam-finder/deploy) | Opus 4.8 |
| Design Critic | GAN visual scoring loop (max 10 iterations) | Opus 4.8 |
| Security Reviewer | OWASP audit, blocking `security-verdict.json` | Opus 4.8 |
| Diff Reviewer | Fresh-context correctness review of the group diff (Gate 8), blocking `diff-review-verdict.json` | Opus 4.8 |
| Clean Code Reviewer | Post-implementation structural review, `clean-code-verdict.json` | Opus 4.8 |
| Codebase Explorer | Read-only discovery for brownfield work | Sonnet 4.6 |

The Model column shows the **`balanced` default** (Profile B). **Opus 4.8 is the top-capability tier** — the prompts are written to be model-agnostic (see [docs/prompting-standards.md](docs/prompting-standards.md) → "Model-agnostic by construction"); the actual model is named only in each agent's `model:` frontmatter.

The cost/quality posture is one field — `execution.model_tier` in `project-manifest.json` (`cost` / `balanced` / `max-quality`), stamped onto the agent `model:` pins (exact ids like `claude-opus-4-8`) by `.claude/scripts/model-tier.js`. The default **`balanced`** keeps generation on Sonnet 4.6 and judgment on Opus 4.8; `max-quality` bumps generation to Opus 4.8. Full rationale + decision rule: [docs/model-allocation.md](docs/model-allocation.md).

The former `phase-evaluator` is now the evaluator's **artifact mode**; `test-engineer` and `ui-designer` folded into the **generator** (their authoring guides live in `skills/test/references/` and `skills/design/references/`).

---

## Superpowers integration

The harness invokes [superpowers](https://github.com/obra/superpowers) skills at fixed pipeline stages — brainstorming during `/brd` and `/design`, test-driven development inside every generator teammate, systematic debugging during self-heal, verification before completion at gate time. The full stage-by-stage table lives in `design.md` (Superpowers Integration section).

---

## Coding principles enforced by hooks

1. **TDD mandatory** — failing tests first, then implement
2. **100% meaningful coverage**, 80% hard floor
3. **Functions ≤ 30 lines, files ≤ 300 lines**
4. **Static typing everywhere** — no `any`
5. **Strict layered architecture** — one-way dependencies (Types → Config → Repository → Service → API → UI)
6. **No silent fallbacks** — typed errors, callers decide
7. **Surgical changes** — only what the request requires
8. **Brownfield discipline** — dependency claims must cite `code-graph.json` evidence

Hooks enforce these in real time; ratchet gates enforce them at commit time.

---

## Key files in your scaffolded project

| File | Purpose |
|---|---|
| `.claude/program.md` | Human-agent bridge — edit mid-run to steer `/auto` |
| `.claude/settings.json` | Hook config, permissions, enabled plugins |
| `.claude/state/learned-rules.md` | Accumulated rules from past failures (never deleted) |
| `.claude/state/` | Tracked harness runtime snapshot for this repo; scaffolded projects receive initial seeds from `.claude/templates/state-seeds/` |
| `project-manifest.json` | Stack, evaluation config, execution mode, framework packs |
| `features.json` | Granular pass/fail registry |
| `claude-progress.txt` | Session chaining recovery context |
| `specs/stories/dependency-graph.md` | Group ordering — source of truth for `/auto` |
| `design.md` | Full architecture reference |

---

## Optional power-ups

| Power-up | What it adds | Docs |
|---|---|---|
| Telemetry dashboards | Grafana/Prometheus team metrics, cost tracking, PromQL reference | [docs/telemetry.md](docs/telemetry.md) |
| Tracker agent factory | Linear/Jira queue + parallel orchestrator | [docs/extras.md](docs/extras.md) |
| Framework skill packs | LangChain / Google ADK aware codegen | [docs/extras.md](docs/extras.md) |
| Understand-Anything | AST-backed graphs for brownfield work | [docs/extras.md](docs/extras.md) |
| Dynamic workflows | Author your own multi-agent orchestration | [docs/extras.md](docs/extras.md) |
| Scheduled quality runs | Native `/schedule` cron for nightly `/gate` / `/evaluate` on `main` | see below |

### Scheduled quality runs (off by default)

This applies to **projects you scaffold with the harness**, not the harness repo itself (which
already runs CI on push/PR and a weekly upstream-watch via GitHub Actions).

CI catches regressions at merge time, but a built app still drifts *after* merge — a transitive
dependency rots, an external API contract shifts, a runtime flake appears. Claude Code's native
**`/schedule`** command runs a routine on a cron, so you can re-prove the ratchet on `main` without
standing up extra infrastructure. It composes the commands the scaffold already gives you:

```
/schedule create --cron "0 6 * * *" \
  --prompt "On main: run /gate on the latest group, then /evaluate against features.json. \
            If any feature regresses or a BLOCK finding appears, open a GitHub issue with the verdict."
```

Because `/gate` and `/evaluate` write the same blocking verdicts (`security-verdict.json`,
`evaluator-report.md`) and update `features.json`, a scheduled run produces the same proof a manual
gate does — just unattended. Keep it off until the project has a green `main` to protect; a nightly
routine on a red tree is noise. This is a thin convenience over commands you already have, not new
harness machinery.

### Enable telemetry (off by default)

The harness ships with telemetry **off** — a fresh scaffold sets no OTEL or Pushgateway env vars, Claude Code exports nothing, and the `record-run` hook stays inert (it only pushes when `HARNESS_PUSHGATEWAY_URL` is set). The `record-run` hook and the `telemetry/` config files are still installed, just dormant, so turning it on is a small change. To enable it:

1. **Add the env vars to `.claude/settings.json`** (Claude Code reads env only from here, not `.env`). Merge into the existing `env` object:

   ```json
   "env": {
     "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
     "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
     "OTEL_METRICS_EXPORTER": "otlp",
     "OTEL_LOGS_EXPORTER": "otlp",
     "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
     "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
     "OTEL_LOG_TOOL_DETAILS": "1",
     "HARNESS_PUSHGATEWAY_URL": "http://localhost:9091",
     "HARNESS_USER": "Your Name"
   }
   ```

   `HARNESS_PUSHGATEWAY_URL` is the switch the `record-run` hook checks — without it, no metrics are pushed. Give each team member their own `HARNESS_USER`.

2. **Start the stack:** `docker compose -f telemetry_docker_compose.yml up -d` (OTEL Collector :4317, Prometheus :9090, Pushgateway :9091, Grafana :3001 — login `admin`/`harness`).

3. **Restart the Claude Code session** so it picks up the new env block.

Point `OTEL_EXPORTER_OTLP_ENDPOINT` / `HARNESS_PUSHGATEWAY_URL` at a shared host to aggregate a whole team. Full setup, the metric catalog, and PromQL queries are in [docs/telemetry.md](docs/telemetry.md).

---

## Testing the harness

Unit suite (fast, no API calls): `npm test` or `node --test "test/*.test.js"`. Full E2E pipeline build: `npm run test:e2e` or `./test/e2e/run.sh` (~15-20 min, live Claude required). Symphony orchestrator suite: `npm run test:symphony` (installs its deps on first run). Golden assertion and upstream-watch guards live in `test/evals/`, `test/golden-assertions.test.js`, `test/plugin-schema.test.js`, and `test/upstream-watch.test.js`. Details: [docs/testing.md](docs/testing.md).

GitHub CI runs the fast harness suite from `.github/workflows/ci.yml`. `.github/workflows/upstream-watch.yml` periodically compares the checked-in upstream snapshots in `.github/upstream/` against Anthropic Claude Code changes and opens a report when scaffold/plugin assumptions may need review.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/auto` runs but quality regresses | Check `.claude/program.md` — edit to steer. Check `learned-rules.md` for accumulated rules |
| Scaffold says "plugin source stale" | Update the harness: `cd ~/claude_harness_eng_v5 && git pull` |
| A hook blocks a legitimate write | The block message names the gate; fix the cause rather than disabling. Escape hatches: `HARNESS_TDD_GATE=off`, `HARNESS_COVERAGE_GATE=off` (use sparingly) |
| Telemetry problems (no metrics, Grafana empty, missing `user` label) | See [docs/telemetry.md](docs/telemetry.md) troubleshooting table |
| Framework pack `PENDING MANUAL INSTALL` | See [docs/extras.md](docs/extras.md) |

---

## Further reading

| Document | Where |
|---|---|
| Architecture reference | `design.md` in your project |
| Simplification roadmap | `docs/SIMPLIFICATION_PROPOSAL.md` |
| Orchestrator operator guide | `symphony_clone/README.md` in the harness repo |
| Any skill's full instructions | `.claude/skills/<name>/SKILL.md` |
| Any agent's definition | `.claude/agents/<name>.md` |
