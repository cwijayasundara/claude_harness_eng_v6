# Claude Harness Engine v4 — Getting Started

A Claude Code plugin for autonomous, long-running application development. GAN-inspired generator-evaluator architecture with Karpathy ratcheting — quality only moves forward.

Current version: `1.1.5`

You need to hold exactly four ideas to use this:

1. **One decision:** are you building something new, or changing existing code? Pick a lane below.
2. **The ratchet blocks regressions** — tests, coverage, lint/types, and security gates only ever tighten.
3. **A separate evaluator verifies** — the agent that writes code never grades its own work.
4. **You merge** — the harness produces commits and proof; it never merges on its own.

Everything else (telemetry, trackers, modes, framework packs) is optional tuning.

---

## Quickstart

```bash
# 1. Clone the harness
git clone https://github.com/cwijayasundara/claude_harness_eng_v4.git ~/claude_harness_eng_v4

# 2. Load it as a plugin from your target project
cd ~/my-project
claude --plugin-dir ~/claude_harness_eng_v4/.claude
```

Then, inside Claude Code:

```
/scaffold
```

This asks a few questions about your stack and project type, then generates the `.claude/` directory (agents, skills, hooks, templates), `project-manifest.json`, `CLAUDE.md`, `design.md`, `init.sh`, `features.json`, and initializes git with the harness commit hooks.

## One decision: new code or existing code?

```
Are you building something NEW?
├── Yes → small scope (CLI, library, ≤5 stories)?  → /lite
│         otherwise → /brd → /spec → /design → /auto
│
└── No (existing codebase) → first time here? run /brownfield once, then:
          ├── tiny safe edit (≤3 files, <150 lines, no auth/API) → /vibe
          ├── bug with a GitHub issue                            → /fix-issue
          ├── new or changed behavior                            → /improve
          ├── structure only, no behavior change                 → /refactor
          └── big enough to need specs → /seam-finder, then /spec → /design → /auto
```

Not sure? Just describe the change in plain words — the harness classifies it and recommends a lane.

## What happens while it runs

Once planning is approved, `/auto` loops autonomously per dependency group:

1. Recovers state from prior sessions
2. Negotiates a sprint contract (generator + evaluator)
3. Spawns an agent team (up to 5 parallel teammates)
4. Runs 7 ratchet gates: tests → lint/types → coverage → architecture → evaluator → design-critic → security
5. Self-heals failed gates (max 3 attempts, different strategy each time)
6. Commits, updates state, moves to next group

Steer it mid-run by editing `.claude/program.md`. Quality gates are enforced by hooks in real time and at commit time — they only ratchet upward.

## When it finishes

- Proof lands in `specs/reviews/`, `iteration-log.md`, `features.json`, plus the commits
- Review diffs in git as usual — the harness never merges on its own

---

## Command reference

The commands you'll actually type are the lane entry points above. The full surface:

| Command | Purpose |
|---|---|
| `/scaffold` | Bootstrap a project (only true slash command) |
| `/brd` | Socratic interview → Business Requirements Document |
| `/spec` | BRD → stories + dependency graph + features.json |
| `/design` | Architecture + schemas + UI mockups |
| `/build` | Full pipeline, phases 0–10, end to end |
| `/auto` | Autonomous ratcheting loop |
| `/lite` | Compressed lane for small new projects |
| `/vibe` | Controlled small-change lane |
| `/brownfield` | Map an existing codebase before changing it |
| `/code-map` | Build deterministic dependency graph |
| `/seam-finder` | Rank safe cut-points for a goal |
| `/implement` | Code generation with agent teams |
| `/evaluate` | Run app, verify sprint contract |
| `/review` | Evaluator + security review |
| `/test` | Test plan + Playwright E2E |
| `/deploy` | Docker Compose + init.sh |
| `/fix-issue` | GitHub issue → branch → fix → test → PR |
| `/refactor` | Quality-driven refactoring with ratchet gate |
| `/improve` | Feature enhancement with verification |
| `/refactor --sweep` | Whole-repo entropy scan for pattern drift |
| `/tracker-publish` | Publish dependency groups to Linear/Jira (optional) |
| `/install-framework-packs` | Verify configured framework packs (optional) |

Execution modes for `/auto`: **Full** (all gates, the default), **Lean** (skip design-critic per-iteration), **Solo** (single agent), **Turbo** (parallel groups). Start with Full; the others are cost/speed tuning.

---

## Agent team

| Agent | Role | Model |
|---|---|---|
| Planner | Sprint planning, story breakdown | Opus |
| Generator | Feature implementation, spawns teammates | Sonnet |
| Evaluator | Runs app, API + Playwright verification | Opus |
| Phase Evaluator | Rubric-scores planning artifacts (BRD, spec, design) | Opus |
| Design Critic | GAN scoring loop (max 10 iterations) | Opus |
| UI Designer | React + Tailwind mockups | Sonnet |
| Test Engineer | Test plans + Playwright E2E | Sonnet |
| Security Reviewer | OWASP audit, blocking `security-verdict.json` | Opus |
| Codebase Explorer | Read-only discovery for brownfield work | Sonnet |

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
| Dynamic workflows | Parallel fan-out forms of four skills | [docs/extras.md](docs/extras.md) |

---

## Testing the harness

Unit suite (fast, no API calls): `node --test test/*.test.js`. Full E2E pipeline build: `./test/e2e/run.sh` (~15-20 min, ~$5-10). Details: [docs/testing.md](docs/testing.md).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/auto` runs but quality regresses | Check `.claude/program.md` — edit to steer. Check `learned-rules.md` for accumulated rules |
| Scaffold says "plugin source stale" | Update the harness: `cd ~/claude_harness_eng_v4 && git pull` |
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
