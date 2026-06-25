# Claude Harness Engine v5 — Getting Started

A Claude Code plugin for autonomous, long-running application development. GAN-inspired generator-evaluator architecture with Karpathy ratcheting — quality only moves forward.

Current version: `2.0.0`

You need to hold exactly four ideas to use this:

1. **One decision:** are you building something new, or changing existing code? Pick a lane below.
2. **The ratchet blocks regressions** — tests, coverage, lint/types, and security gates only ever tighten.
3. **A separate evaluator verifies** — the agent that writes code never grades its own work.
4. **You merge** — the harness produces commits and proof; it never merges on its own.

Everything else (telemetry, trackers, modes, framework packs) is optional tuning.

> **Building docs, not shippable code?** UI mockups, architecture/ARB narratives, and research reports are disposable artifacts — they should *not* go through the GAN/ratchet/TDD pipeline. Load the lighter **harness-lite** plugin instead (`claude --plugin-dir ~/claude_harness_eng_v5/harness-lite/.claude`); it ships only `/mockup`, `/arch-doc`, and `/research` and makes the heavyweight machinery structurally unreachable. Switch to the full harness the moment an artifact becomes shipped product code. See `harness-lite/README.md`.

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

`/build` runs the planning stages (BRD → spec → design → test plan) and the `/auto` loop for you, with human approval gates between each. To skip the gates and run hands-off from a PRD, add `--auto` — see [Run a build fully autonomously from a PRD](#run-a-build-fully-autonomously-from-a-prd). Need the safest cut-points before a big change first? `/brownfield --seams "<goal>"`.

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
- Review diffs in git as usual — locally the harness never merges on its own

---

## Operating modes

A few independent choices decide how a build runs — how much human approval, how big the project is, and `--mode full|lean`. Full flag detail lives in `.claude/skills/build/SKILL.md` — this is the summary.

**How much human approval?**

| Lane | Command | Human gates |
|---|---|---|
| Gated (default) | `/build <prd>` | Approve BRD, stories, design+tests — then it builds to a PR |
| Semi-auto | `/build <prd> --autonomous` | One plan-approval gate, then runs to an open PR |
| Full-auto | `/build <prd> --auto` | None — PRD straight to PR |

In every lane the **machine gates still run** (ratchet, security, pre-PR verify) — the agent never grades its own work and no PR opens over a red build. `--auto` requires a PRD (`docs/prd-format.md`); it cannot interview headless.

**How big is the project?**

| Scope | Command | What it does |
|---|---|---|
| Full | `/build <prd>` | The full 11-phase pipeline (above) |
| Lite (interactive) | `/build --lite "<one-line desc>"` | Compressed greenfield lane for a small project — single language/runtime, one module, no DB/auth, ≤5 stories. A 5-question interview → one-page BRD-lite → ≤5 stories in one group → minimal design → one approval gate → `/auto`. |
| **Lite + headless** | `/build --lite --auto <prd>` | The compressed lane run hands-off — the cut-down equivalent of `--auto`. PRD grounding replaces the interview, the approval gate is dropped, and it runs straight to a PR. If the PRD exceeds the lite caps it **auto-escalates** to the full `--auto` pipeline rather than cramming the project into 5 stories. |

Flag order does not matter — `/build --lite --auto <prd>` and `/build --auto --lite <prd>` are the same command. `--lite` composes with `--autonomous` too (`/build --lite --autonomous <prd>` keeps the single consolidated approval). Either way the lite lane only compresses *planning ceremony* — the ratchet, evaluator, security, and Phase 9.5 verify run unchanged. A lite-shaped project also scaffolds with the cheaper **cost** posture by default (see *Agent team* → model tiers).

#### Run a build fully autonomously from a PRD

`--auto` is the hands-off lane: a PRD goes in, an open PR comes out, with **no human approval gates** in between. Three things have to be true for a run to need *zero* babysitting, and the scaffold sets all three up:

- **No approval gates** — `--auto` collapses every planning gate (the pipeline never stops to ask "approve?").
- **No "continue" prompts** — `CLAUDE_AUTO_CONTINUE=1` (shipped on by default, see *Auto-continue on long runs* below) makes the loop re-enter itself across turns.
- **No permission prompts** — the unattended profile `.claude/settings.auto.json` allows the core tools so a headless run never stops for an approval no human is there to give.

**Steps:**

1. **Scaffold the project** (once): `/scaffold` — writes `.claude/settings.json` (auto-continue on) and the unattended `.claude/settings.auto.json`.
2. **Write a PRD.** `--auto` cannot run the Socratic interview headless, so the requirements must live in a PRD file. Follow `docs/prd-format.md` and save it, e.g. `docs/prd.md`.
3. **Launch it.** Two ways, depending on whether a human is at the keyboard at all:

   **Truly unattended (headless — cron, CI, "kick it off and walk away"):**

   ```bash
   claude -p "/build docs/prd.md --auto" \
     --settings .claude/settings.auto.json \
     --strict-mcp-config \
     --max-budget-usd 50 \
     --output-format stream-json --verbose
   ```

   `--settings .claude/settings.auto.json` is the piece that removes permission prompts; it merges over the project's `settings.json`, so the gate hooks and ratchet still apply. `--strict-mcp-config` stops the run from hanging on unrelated global MCP servers. Set `--max-budget-usd` to a real ceiling — it is your spend stop. (Prefer the curated profile over the blunt `--dangerously-skip-permissions` flag, which skips *all* prompts; the profile is auditable and still leaves the hooks in force.)

   **From inside an interactive session** (you may still get an occasional permission prompt for a novel command):

   ```
   /build docs/prd.md --auto
   ```

   Either way the harness grounds a BRD in the PRD (`/brd --prd …`), decomposes stories, designs, generates tests, then runs the `/auto` ratchet loop per dependency group — recovering state, self-healing failed gates, committing as it goes — until every feature passes, then opens a PR.

   - Add `--pod N` for **one PR per independent story cluster** instead of a single integrated PR.
   - `--mode lean` skips only the design-critic vision loop; every verification gate still runs.
   - Steer a run in flight by editing `.claude/program.md` — no need to stop it.

4. **You still merge.** The harness produces commits, verdicts in `specs/reviews/`, and an open PR; it never merges on its own. Review the diff and merge when satisfied.

**What stays in force even with nobody watching** — removing the *prompts* does not remove the *guardrails*. The deterministic hooks (`pre-write-gate`, `pre-bash-gate`) run regardless of permission mode and block out-of-project writes, edits to the gates themselves, and secret/`.env` writes; the `/auto` ratchet, security review, and Phase 9.5 pre-PR verify still block; and **no PR opens over a red build**. If a run stalls (no feature progress for several turns), auto-continue **fails open loudly** with a `STUCK` warning and lets the session stop so you can step in — it is never spun forever.

> **⚠️ Isolate the unattended run.** The `settings.auto.json` profile allows `Bash(*)`, and the gate hooks only constrain *writes* — they do **not** stop a broad shell from *reading* host secrets (`~/.ssh`, cloud credentials) or making network egress. Run the headless `--auto` command inside an **isolation boundary** — a container, CI runner, or VM with no host secrets mounted and egress limited to what the build needs (package registries, your git remote). Treat the machine you give `settings.auto.json` to as one the agent fully controls. For interactive work, keep using `settings.json`'s curated allowlist, which never grants blanket `Bash`.

For a fully unattended **backlog-to-merge** pipeline (PRD-issue in, *merged* code out, `AUTO_MERGE` removing even the merge touchpoint), use the standalone **symphony** orchestrator — see *Tracker-driven builds* below.

**One PR or many?** Default is a single integrated PR; add `--pod N` for **one PR per independent story cluster** (dependent clusters wait for theirs to merge).

`--mode full|lean` is orthogonal to both: each runs every gate; `lean` only skips the design-critic vision loop.

## Tracker-driven builds (symphony)

For fully autonomous delivery from a backlog, run **`symphony_clone/`** — a standalone orchestrator, deployed separately from any Claude Code session, that turns a **Linear, Jira, or Azure DevOps** board into the control plane:

- Drop a PRD as an issue labelled `agent-plan` → it plans (`/brd → /spec → /design → /test`), publishes one `agent-ready` issue per cluster, then builds each cluster into its own PR.
- `AUTO_MERGE=true` merges each PR once required checks pass — PRD in, merged code out, no human in the loop. Leave it off (default) to stop at Human Review.

Setup, the three trackers, and the end-to-end test recipe live in **`symphony_clone/README.md`**.

---

## Command reference

These are the **entry points you actually type** — one per situation:

| Command | Purpose |
|---|---|
| `/scaffold` | Bootstrap a project (the only true slash command) |
| `/build` | Greenfield (or brownfield-aware) build: runs planning → `/auto` for you, with human gates. `--lite` for small new projects; `--lite --auto <prd>` runs a small project headless to a PR |
| `/auto` | Resume / steer the autonomous ratcheting loop directly |
| `/brownfield` | Map an existing codebase before changing it; `--seams "<goal>"` ranks the safest cut-points |
| `/vibe` | Controlled small-change lane (≤3 files, <150 lines, no auth/API) |
| `/change` | Behavior change on existing code (test-first); `--issue N` for a GitHub bug fix |
| `/refactor` | Behavior-preserving cleanup with ratchet gate; `--sweep` scans the repo for pattern drift |
| `/gate` | On-demand pre-merge quality gate (evaluator + security review) |
| `/status` | Read-only SDLC pipeline progress — one-shot snapshot, live `watch`, or step `timeline`; `--json` for scripting. Runs as a plain script too (`npm run status`), so you can watch a running `/auto` from a second terminal |
| `/tracker-publish` | Publish dependency groups to a tracker (Linear/Jira/Azure DevOps); the symphony lane uses it |

Approval lanes, `--pod`, and `--mode full|lean` are covered in **Operating modes** above. For small or quick work prefer `/build --lite` or `/vibe` over `/auto`.

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
| Generator | Feature implementation (spawns teammates); also authors tests and UI mockups | Opus 4.7 |
| Evaluator | Runtime mode: runs app, API + Playwright verification + latency regression ratchet. Artifact mode: rubric-scores planning docs (BRD/spec/design/brownfield/seam-finder/deploy) | Opus 4.8 |
| Design Critic | GAN visual scoring loop (max 10 iterations) | Opus 4.8 |
| Security Reviewer | OWASP audit, blocking `security-verdict.json` | Opus 4.8 |
| Diff Reviewer | Fresh-context correctness review of the group diff (Gate 8), blocking `diff-review-verdict.json` | Opus 4.8 |
| Clean Code Reviewer | Post-implementation structural review, `clean-code-verdict.json` | Opus 4.8 |
| Codebase Explorer | Read-only discovery for brownfield work | Sonnet 4.6 |

The Model column shows the **`balanced` default** (Profile B). **Opus 4.8 is the top-capability tier** — the prompts are written to be model-agnostic (see [docs/prompting-standards.md](docs/prompting-standards.md) → "Model-agnostic by construction"); the actual model is named only in each agent's `model:` frontmatter.

The cost/quality posture is one field — `execution.model_tier` in `project-manifest.json` (`cost` / `balanced` / `max-quality`), stamped onto the agent `model:` pins (exact ids like `claude-opus-4-8`) by `.claude/scripts/model-tier.js`. **`balanced`** runs generation on Opus 4.7 and judgment on Opus 4.8; `cost` drops generation to Sonnet 4.6 and `max-quality` bumps it to Opus 4.8. Full rationale + decision rule: [docs/model-allocation.md](docs/model-allocation.md).

**Scope-aware default.** `/scaffold` picks the posture from project shape: a **lite-shaped** project (CLI / library / single-script, or any non-web stack) defaults to `model_tier: cost` + `ceremony: trimmed` (single-story groups skip sprint decomposition) + `verification.mode: local` (no Docker deploy phase), so a small `/build --auto` run isn't taxed with full-stack ceremony. Full-stack projects keep `balanced` / `full` / `docker`. Every default stays overridable by editing the manifest, and no verification gate is weakened in either posture.

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

### Auto-continue on long runs (on by default)

The `auto-continue-on-stop.js` Stop hook replaces manually typing **"continue"** when the orchestrator ends a turn while the build still has verifiable unfinished work. **`/scaffold` turns it on by default** — every scaffolded project ships `CLAUDE_AUTO_CONTINUE=1` in `.claude/settings.json`'s `env` block, so a `/build … --auto` run drives itself from PRD to PR without you babysitting the prompt. To go back to manual "continue" for ordinary interactive sessions, set `CLAUDE_AUTO_CONTINUE=0` (or remove the line) in that `env` block.

It nudges the loop onward **only** while harness state proves work remains (an incomplete `current_group`/`groups_remaining` in `claude-progress.txt`, or a still-failing `features.json` feature) **and** the build is making progress. The bound is on *stalled* progress, not total turns: while the passing-feature count keeps rising it continues indefinitely, but once that count stalls for 5 consecutive turns it **fails open loudly** (writes a `STUCK` warning + a `hook-errors.log` entry) and lets the session stop so a human can step in — a stuck build is surfaced, never spun forever. It defers to the review gate while a review cycle is open, and honors an explicit `next_action: DONE …` as a clean stop.

---

## Key files in your scaffolded project

| File | Purpose |
|---|---|
| `SCAFFOLD_README.md` | Project-tailored guide to driving the harness in *this* project — start here |
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

### Telemetry (on by default in scaffolded projects)

A **scaffolded project ships with telemetry on**: `/scaffold` bakes the OTEL + Pushgateway env vars into the new project's `.claude/settings.json` and `.claude/settings.auto.json`, so Claude Code exports metrics and the `record-run` hook pushes harness metrics from the first run — in both `/build` and headless `/build --auto`. (The harness's *own* repo stays telemetry-off; only the projects it scaffolds default on.) The env vars baked in:

```json
"env": {
  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
  "OTEL_METRICS_EXPORTER": "otlp",
  "OTEL_LOGS_EXPORTER": "otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
  "OTEL_LOG_TOOL_DETAILS": "1",
  "HARNESS_PUSHGATEWAY_URL": "http://localhost:9091"
}
```

`HARNESS_PUSHGATEWAY_URL` is the master switch the `record-run` hook checks; the `OTEL_*` block feeds the cache-health dashboard. The push has a 2s timeout and swallows connection errors, so until the stack is up it simply no-ops — a project with telemetry on but no stack running behaves like one with it off.

**To actually see data on the dashboards, two steps remain** (scaffold can't automate either):

1. **Start the stack:** `docker compose -f telemetry_docker_compose.yml up -d` (OTEL Collector :4317, Prometheus :9090, Pushgateway :9091, Grafana :3001 — login `admin`/`harness`). The compose file, `telemetry/` configs, and dashboards are already copied into the project.
2. **Restart the Claude Code session** so it picks up the env block.

Each team member can set `HARNESS_USER` in their `settings.json` to label their metrics; left unset, the hook derives it from git `user.name` / the OS username. Point `OTEL_EXPORTER_OTLP_ENDPOINT` / `HARNESS_PUSHGATEWAY_URL` at a shared host to aggregate a whole team. To turn telemetry **off** for a project, remove those env keys. Full setup, the metric catalog, and PromQL queries are in [docs/telemetry.md](docs/telemetry.md).

---

## Testing the harness

Unit suite (fast, no API calls): `npm test` or `node --test "test/*.test.js"`. Full E2E pipeline build: `npm run test:e2e` or `./test/e2e/run.sh` (~15-20 min, live Claude required). Symphony orchestrator suite: `npm run test:symphony` (installs its deps on first run). Golden assertion and upstream-watch guards live in `test/evals/`, `test/golden-assertions.test.js`, `test/plugin-schema.test.js`, and `test/upstream-watch.test.js`. Details: [docs/testing.md](docs/testing.md).

**Full scaffold lifecycle (self-healing smoke):** `npm install && npm run install:browser`, then `npm run test:smoke` (~15 min, live Claude required, costs tokens). This is the end-to-end proof that the engine is wired together and can extend code it already generated. It `/scaffold`s a fresh repo, `/build --lite`s a dependency-free counter web app, then **independently verifies it in a headless browser** (click `#increment` → `#count` rises 0→1), `/change`s the *generated* code to add a `#decrement` button, and re-verifies that decrement works **and** increment still does (regression). The browser is the oracle — the generator never grades its own work, which is what distinguishes this from self-judged verification — and each failed gate feeds concrete diagnostics back into a grounded `/change` repair (max 3 attempts). The app-runtime helpers (`test/e2e/helpers/app-runtime.js`) free the fixed port before every boot and reap on teardown, so a server leaked by a prior attempt cannot stay bound and silently serve stale code to the verifier (a false-negative class guarded by `app-runtime.test.js`). Related live runs: `npm run test:auto` (autonomous loop) and `npm run test:semi` (semi-auto).

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
| Artifact-only loadout (mockups / ARB / research) | `harness-lite/README.md` |
| Design history & internal proposals | `docs/internal/` |
| Orchestrator operator guide | `symphony_clone/README.md` in the harness repo |
| Any skill's full instructions | `.claude/skills/<name>/SKILL.md` |
| Any agent's definition | `.claude/agents/<name>.md` |
