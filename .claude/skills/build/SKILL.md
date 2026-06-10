---
name: build
description: Full SDLC pipeline. Runs all phases end-to-end with human gates on phases 1-3.
argument-hint: "[path-to-BRD] [--mode full|lean|solo|turbo]"
context: fork
---

# Build Skill

Full software development lifecycle pipeline. Orchestrates BRD creation, story specification, architecture design, state initialization, and autonomous build execution across sequential phases (Phase 0 through Phase 10).

---

## Usage

```
/build path/to/requirements.md
/build path/to/requirements.md --mode lean
/build path/to/requirements.md --mode solo
/build --lite "Python CLI that summarizes a URL"   # small new project
```

The `--mode` flag controls which ratchet gates `/auto` enforces. Default: `full`.

### `--lite` — compressed greenfield lane

For a **small** new project (single language/runtime, one module, no DB/auth, ≤ ~5 stories — e.g. a CLI tool, single-script utility, or small library), pass `--lite` with a one-line description. Instead of the full phases below, follow the compressed lane in **`.claude/skills/build/references/lite-lane.md`**: a 5-question interview → one-page BRD-lite → ≤5 stories in a single group → minimal design artifacts → one approval gate → hand off to `/auto --group A`. It enforces the same ratchet/gates; it only compresses the planning ceremony. If the project exceeds the lite scope caps (a database, a second service, auth, >5 stories), the lane escalates you to the full pipeline. Everything from Phase 0 below is the full (non-lite) path.

---

## Pipeline Phases (0–10)

### Phase 0 — Brownfield Discovery [EXISTING CODEBASES]

If this is a non-trivial existing codebase and `specs/brownfield/codebase-map.md` does not exist, run `/brownfield` before Phase 1. Use the generated architecture, test, risk, and change-strategy maps as constraints for the BRD, stories, and design.

Skip Phase 0 only for greenfield projects, documentation-only work, or tiny `/vibe`-eligible changes.

### Phase 1 — Business Requirements [HUMAN APPROVAL]

Run `/brd` with the provided requirements document. Outputs are written to `specs/brd/`.

**Stop and wait for explicit human approval before proceeding.** Present a summary of the BRD and ask: "Approve BRD to proceed to Phase 2?"

Do NOT proceed without a clear "yes" or "approved" from the user.

### Phase 2 — Story Specification [HUMAN APPROVAL]

Run `/spec` using the approved BRD. Outputs are written to `specs/stories/` and root `features.json`.

**Stop and wait for explicit human approval before proceeding.** Present the story count, dependency groups, and feature list. Ask: "Approve stories to proceed to Phase 3?"

Do NOT proceed without a clear "yes" or "approved" from the user.

If the user already has product stories, `/spec` may normalize those existing stories instead of deriving them from the BRD. The output contract is still the same: `epics.md`, ready story files, `dependency-graph.md`, and root `features.json`. Stories marked `needs_breakdown` must be resolved before Phase 3.

### Phase 3 — Architecture Design + Test Planning [HUMAN APPROVAL]

Run `/design` and `/test --plan-only` **in parallel** using two concurrent Agent calls. Both consume `/spec` output independently:

- **`/design`** — produces architecture artifacts in `specs/design/` (architecture, api-contracts, component-map, data-models, schemas).
- **`/test --plan-only`** — produces test plan, test cases mapped to acceptance criteria, and test data fixtures in `specs/test_artefacts/` (test-plan.md, test-cases.md, test-data/).

Wait for BOTH to complete before presenting results.

**Stop and wait for explicit human approval before proceeding.** Present:
1. Architecture summary: tech stack, component count, API surface area.
2. Test plan summary: test case count, story coverage, fixture count.

Ask: "Approve design and test plan to proceed to autonomous build?"

Do NOT proceed without a clear "yes" or "approved" from the user.

### Phase 4 — Initialize State

Create the following state files before entering the autonomous loop:

1. `.claude/state/coverage-baseline.txt` — Write `0` (initial baseline).
2. `.claude/state/iteration-log.md` — Write header: `# Iteration Log\n\nTracking all autonomous build iterations.\n`
3. `claude-progress.txt` — Write session 0 block:
   ```
   === Session 0 ===
   date: {ISO 8601 now}
   mode: {mode}
   groups_completed: []
   groups_remaining: [all group IDs from dependency-graph.md]
   current_group: none
   features_passing: 0 / {total features}
   coverage: 0%
   learned_rules: 0
   next_action: Begin autonomous build with /auto
   ```

### Phase 4.5 — Generate Deployment Artifacts [DOCKER MODE]

If `project-manifest.json` has `verification.mode: "docker"` (the default for full-stack projects), run `/deploy` now — before `/auto`. It generates the Docker Compose stack, Dockerfiles, `.env.example`, and **`init.sh`**, which `/auto`'s Gate 5 (docker startup) requires to bring the app up for evaluation. Skipping this in docker mode leaves `/auto` unable to start the stack.

Skip Phase 4.5 for `local` or `stub` verification modes — those reach the app without Docker, so no deploy artifacts are needed yet.

### Phases 5-8 — Autonomous Execution

Run `/auto --mode {mode}` to enter the autonomous build loop. The `/auto` skill handles all remaining execution: sprint contracts, agent teams, ratchet gates, self-healing, and session chaining.

**Parallel agent teams:** the full SDLC pipeline runs each dependency group through `/auto`, which parallelizes on two axes:
- **Within-group:** one teammate per story for any group with **≥ 2 stories** — see `.claude/agents/generator.md` Rule 2.
- **Cross-group:** up to 3 independent dependency groups run concurrently as group-orchestrator subagents (configurable via `--parallel-groups N`; opt out with `--sequential`) — see Section 4B of `.claude/skills/auto/SKILL.md`.

For a multi-group project with multi-story groups, peak parallelism is 3 groups × 5 teammates = 15 concurrent subagents. Cross-group parallelism uses per-group git branches (`auto/group-B`, `auto/group-C`) merged sequentially after each wave to avoid trunk commit conflicts.

### Phase 9 — E2E Test Generation

After `/auto` completes (all groups done or stopping criteria met), run `/test --e2e-only` to generate Playwright E2E tests against the built source code. This uses the test plan and cases from Phase 3 as input.

The generator generates one Playwright spec per story (`e2e/{story-id}.spec.ts`), copies the Playwright config template, installs Playwright, and runs the full E2E suite. All tests must pass.

If E2E tests fail, fix them before proceeding. The tests are the specification — if a test fails because the implementation is wrong, fix the implementation, not the test.

### Phase 10 — Generate README.md

After E2E tests pass, generate a `README.md` for the built application. This is the developer-facing guide for running, understanding, and contributing to the generated project.

Read the following to build the README:
- `specs/brd/brd.md` — what the app does (project description)
- `specs/design/architecture.md` — system architecture
- `specs/design/api-contracts.md` or `api-contracts.schema.json` — API surface
- `specs/design/component-map.md` — module structure
- `project-manifest.json` — tech stack, verification mode
- `init.sh` — setup steps
- `docker-compose.yml` (if exists) — services
- `.env.example` (if exists) — required environment variables

**README must include these sections:**

```markdown
# {Project Name}

{1-2 sentence description from BRD}

## Architecture

{System diagram: layers, services, data flow. Use ASCII art or bullet list.
Show: frontend -> API -> service -> repository -> database.
Note external APIs if any.}

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | {from manifest} |
| Frontend | {from manifest} |
| Database | {from manifest} |
| Testing | {from manifest} |

## Prerequisites

- {language version}
- Docker + Docker Compose
- {any external API keys needed — reference .env.example}

## Quick Start

```bash
# 1. Clone and enter
git clone <repo-url> && cd {project-name}

# 2. Copy environment config
cp .env.example .env
# Edit .env with your API keys

# 3. Start everything
bash init.sh
# OR: docker compose up -d

# 4. Verify
curl http://localhost:{port}/health
```

## API Endpoints

{Table of all endpoints from api-contracts: method, path, description, auth required}

## Project Structure

```
{Directory tree showing key files and their responsibilities.
 Use component-map.md as source. Show backend/, frontend/, tests/}
```

## Running Tests

```bash
# Backend
cd backend && uv run pytest --cov=src -v

# Frontend
cd frontend && npm test
```

## Environment Variables

{Table from .env.example: variable name, description, required/optional, example value}

## Development

{Brief notes on: how to add a new endpoint, how to run linters,
 how to run the app locally without Docker}
```

**Rules:**
- README describes the GENERATED APP, not the harness. Do not mention Claude, the harness, `/auto`, or agents.
- All commands must be tested — run them mentally against the generated code to verify they work.
- API endpoint table must match the actual routes in the code, not just the spec.
- Environment variables table must match `.env.example` exactly.

Commit the README: `git add README.md && git commit -m "docs: add README with architecture, setup, and API reference"`

---

## Mode Reference

| Mode | Description |
|------|-------------|
| `full` | All ratchet gates including design critic and GAN loop |
| `lean` | Skip design critic and GAN loop; keep API + Playwright checks |
| `solo` | Generator works alone; skip evaluator, team, and Docker checks |
| `turbo` | For highly capable models: single-pass implementation, ratchet gates 4–6 batched once at the end (see `/auto` → Turbo Mode) |

---

## Gotchas

- **Proceeding without approval:** Phases 1-3 each require explicit human approval. Silence is not consent. If the user has not clearly approved, ask again.
- **Skipping the design phase:** Phase 3 produces `component-map.md` and `api-contracts.md` which are required by `/auto` for sprint contracts and file ownership. Skipping design breaks the entire downstream pipeline.
- **Not initializing state files:** Phase 4 must create all three state files before `/auto` runs. Missing state files cause context recovery failures in session chaining.
- **Wrong mode passthrough:** Read the `--mode` flag from the user's invocation and pass it to `/auto` exactly. Do not default silently if the user specified a mode.
