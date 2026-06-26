---
name: build
description: Full SDLC pipeline. Runs all phases end-to-end with human gates on phases 1-3.
argument-hint: "[path-to-BRD] [--mode full|lean]"
context: fork
---

# Build Skill

Full software development lifecycle pipeline. Orchestrates BRD creation, story specification, architecture design, state initialization, and autonomous build execution across sequential phases (Phase 0 through Phase 10).

---

## Usage

```
/build path/to/requirements.md
/build path/to/requirements.md --mode lean
/build --lite "Python CLI that summarizes a URL"   # small new project (interactive)
/build --lite --auto path/to/prd.md                # headless lite: small PRD -> PR, zero gates
/build path/to/requirements.md --autonomous        # plan-approve once, then run to PR
/build path/to/prd.md --autonomous --plan-only     # produce specs/ for inspection, then stop
/build path/to/prd.md --autonomous --pod 3         # pod: each cluster raises its own PR
/build path/to/prd.md --auto --pod 3               # full-auto: PRD -> per-cluster PRs, zero gates
/build --auto --finalize                           # build-chain terminal link: Phases 9, 9.5, 10, 11 only
```

The `--mode` flag controls which ratchet gates `/auto` enforces. Default: `full`.

## Step 0 — Resolve the invocation (run this FIRST, before anything else)

**Do not parse the flags or the PRD path by hand.** Flag order is free (`--lite --auto path` and `path --lite --auto` are identical) and hand-parsing is exactly how a PRD path gets dropped. Resolve the invocation deterministically by running this command **verbatim** — `$ARGUMENTS` is interpolated by the harness to the exact string the user typed after `/build`, so do **not** substitute, retype, or quote it yourself:

```bash
node .claude/scripts/build-lane.js "$ARGUMENTS"
```

**Sanity-check the result before acting on it.** If the JSON comes back `lane: gated` with `prdPath: null` **and** the user's invocation clearly contained a path or flags (e.g. you can see `--lite`/`--auto`/a `.md` path in their message), then `$ARGUMENTS` did not reach the parser — do **not** proceed as a bare gated build. Re-run the parser with the literal invocation string explicitly, and only continue once the resolved `lane`/`prdPath`/flags match what the user actually typed.

It prints JSON. Act on it, do not second-guess it:

- **`valid: false`** → stop and show `error` to the user (e.g. a PRD is required for `--auto`/`--autonomous`/`--plan-only` but none was given). Do not invent scope.
- **`valid: true`** → bind the fields and route by them:
  - `lane` — one of `gated`, `autonomous`, `auto`, `lite`, `lite-autonomous`, `lite-auto`, `finalize`. This selects the phase flow below; do not re-derive it from the raw flags.
  - `prdPath` — the requirements/PRD file. **The positional argument is the PRD even when it follows the flags.** If `requiresPrd: true`, resolve `prdPath` to a readable file now; if it is null or unreadable, stop and ask for the PRD rather than reporting "no requirements came through".
  - `requiresPrd`, `humanGates` (0/1/3), `lite`, `auto`, `autonomous`, `planOnly`, `mode`, `pod` — carry these into the phases; e.g. `humanGates: 0` means full-auto (no Phase 1/2/3/3.5 stops), `humanGates: 1` means the single Phase 3.5 gate.

Only after Step 0 resolves cleanly do you proceed to Phase 0. If the workspace is also in a dirty/ambiguous git state, surface that *in addition to* — not instead of — the resolved lane, so the user sees you understood the command.

## Approval model

Three approval models, selected by `--autonomous` / `--auto`:

- **Gated (default).** Humans approve at Phases 1, 2, and 3 (BRD, stories, design+tests) before the autonomous build runs. The pipeline stops at each and waits for explicit approval. Best for new workflows, public APIs, security/privacy work, or anything ambiguous.
- **Semi-auto (`--autonomous`) — Devin-style plan-approve-once.** The Phase 1/2/3 stops are **collapsed into a single consolidated Plan Approval gate** (Phase 3.5): the human approves the whole plan — BRD + stories + design + test plan — **once**, and the pipeline then runs Phases 4–11 to an **open PR with no further human stops**.
- **Full-auto (`--auto`) — PRD straight to PR(s), zero build-time gates.** Exactly the semi-auto lane **minus** the Phase 3.5 plan gate: the human supplies only the PRD and the pipeline runs Phases 0–11 with **no human stops at all**. The human re-appears only as the **merge gate** on the resulting PR(s) — which is the one human touchpoint you keep by design (the `AUTO_MERGE` activation key removes even that, see the autonomous-engineer roadmap). `--auto` implies `--autonomous`'s tail; pair it with `--pod N` for one PR per cluster.

After approval (or immediately, for `--auto`), the only barriers are machine gates that are **independent of the generator** — `/auto`'s ratchet, `/gate` (evaluator + adaptive review), and the Phase 9.5 pre-PR verify gate — so the code is never self-approved by the agent that wrote it, and **no PR is ever opened over a red build** regardless of model. Full lane detail: **`.claude/skills/build/references/autonomous-lane.md`**.

This is the in-session human trigger. The tracker-driven equivalent (Jira/Linear + symphony) reuses the same Phases 4–11 tail.

**PRD grounding (required for headless autonomy).** In `--autonomous` and `--auto` mode the input requirements document is treated as a **PRD** and passed to `/brd --prd <path>` — the deterministic grounding path, **not** the interactive Socratic interview. An interview cannot run headless, so these modes never use it; the PRD (see `docs/prd-format.md`) plus any pre-recorded clarifications are the only sanctioned content. If no usable PRD is supplied, stop and say so rather than inventing requirements — this is especially important in `--auto`, where there is no plan gate to catch a hallucinated scope.

**`--plan-only`.** Run the architect phases only — Phases 0–3 (`/brd --prd → /spec → /design → /test --plan-only`) — then **stop before Phase 3.5**, writing all `specs/` artifacts (BRD, stories + dependency graph, design, test plan) for inspection. No approval gate, no code generation, no PR. Use it to validate the plan locally (e.g. eyeball `specs/stories/dependency-graph.md` and its Mermaid cluster graph) before committing to a semi-auto or full-auto run. End by printing an inventory of what was written under `specs/`.

**`--finalize`.** Internal build-chain terminal link. Run only Phases 9, 9.5, 10, and 11 against an already-complete autonomous build, then raise the PR only if the final verify and `/gate` are green. Do not run planning, do not run `/auto`, and do not accept a PRD path here; the state must already show all groups complete.

**`--budget <spec>`.** Cap the compute the autonomous loop may spend before halting at a clean checkpoint: `--budget 2h` (wall-clock), `--budget 150agents` (agent spawns), `--budget '$20'` (estimated cost), or `--budget off`. Without the flag, a per-tier default applies (cost ≈ 30 min, balanced ≈ 90 min, max-quality ≈ 180 min; see `.claude/scripts/budget-state.js`). A `project-manifest.json#execution.budget` object overrides the default; `--budget` overrides both. The halt is enforced by `/auto` and `build-chain.js` at iteration/link boundaries — committed work is always preserved, and raising the cap resumes the run. **Wall-clock and agent-count are exact; estimated cost is a surfaced estimate** (the harness makes no direct API calls, so it cannot meter tokens exactly in-loop). Budget caps compute, never the verification gates.

### `--lite` — compressed greenfield lane

For a **small** new project (single language/runtime, one module, no DB/auth, ≤ ~5 stories — e.g. a CLI tool, single-script utility, or small library), pass `--lite` with a one-line description. Instead of the full phases below, follow the compressed lane in **`.claude/skills/build/references/lite-lane.md`**: a 5-question interview → one-page BRD-lite → ≤5 stories in a single group → minimal design artifacts → one approval gate → hand off to `/auto --group A`. It enforces the same ratchet/gates; it only compresses the planning ceremony. If the project exceeds the lite scope caps (a database, a second service, auth, >5 stories), the lane escalates you to the full pipeline. Everything from Phase 0 below is the full (non-lite) path.

**`--lite --auto` (and `--lite --autonomous`) — headless lite.** Combine the compressed lane with autonomous grounding to run a small **PRD** straight through to a PR with no interview and no approval gate — the cut-down equivalent of `/build --auto`. The two flags compose by their usual meaning: `--lite` picks the compressed lane (single group, ≤5 stories, minimal design), and `--auto`/`--autonomous` make it headless. Concretely, the lite lane runs with these substitutions (full detail: lite-lane.md → *Headless mode*):

- **PRD grounding replaces the interview.** The input is a PRD file path, not a one-liner. Derive the lite-lane Step 1 fields (name, runtime, capability, deps, interface) from the PRD instead of asking; record assumptions rather than questions. If no usable PRD is supplied, stop and say so — do not invent scope.
- **Automated eligibility gate with auto-escalation.** Before writing any artifact, check the PRD against the lite-lane eligibility caps. If it exceeds them (a database, a second service, auth, >5 stories, a real public API), **auto-escalate to the full `--auto` pipeline** (Phase 0 below) instead of cramming the project into 5 stories — there is no human to ask, so escalation is automatic and must be logged.
- **Low plan confidence is an escalation trigger.** After the compressed plan is written, run `node .claude/scripts/plan-confidence.js`. A **low** band (open questions or an undecomposable story) means the PRD is too under-determined for the headless lite lane — **auto-escalate to the full `--auto` pipeline** (which has the clarify-on-low confidence gate at Phase 3.5) rather than compressing ambiguity into 5 stories. Log the escalation reason, exactly as the eligibility caps do.
- **The Step 7 approval gate is dropped** (that is what `--auto` means) and the lane **auto-invokes `/auto --group A`**, then runs the autonomous tail (Phase 9.5 pre-PR verify → PR). `--lite --autonomous` keeps the *one* consolidated approval before handoff; `--lite --auto` keeps zero gates. Either way the machine gates — ratchet, evaluator, adaptive review, Phase 9.5 — run unchanged; headless lite compresses planning, never verification.

---

## Pipeline Phases (0–11)

> **Numbering note.** The phases run **0 → 11**, with three half-step inserts (3.5 plan gate, 4.5 deploy, 9.5 pre-PR verify) for steps that only apply in some modes. The autonomous *execution* is a **single `/auto` call** — the "Phases 5–8" heading below is one step, not four; the sub-numbers are historical and kept only so cross-references stay stable. When in doubt, the canonical list is the tail diagram in `references/autonomous-lane.md`.

> **Resumability.** `/build` is re-entrant. Each planning phase (0–3) is **skip-if-its-artifacts-exist**: if `specs/brd/`, `specs/stories/`, or `specs/design/` are already populated from an interrupted run, do not regenerate them — confirm they are complete and move on (re-running a phase silently discards human-approved plan edits). Phase 4 state files follow the per-file reset-vs-preserve rule documented there. Only force a regenerate when the user explicitly asks to redo a phase.

### Phase 0 — Brownfield Discovery [EXISTING CODEBASES]

**Boundary with `/feature`.** `/build` is the **greenfield** pipeline. For *changing existing-code behavior* — adding or altering a feature in a live codebase — use **`/feature`**, the brownfield change route (it owns the DeepWiki lifecycle, Linear tracking, and the single-story-vs-epic routing). Reach Phase 0 here only when you are running a **full greenfield-style build that happens to be layered onto an existing repo** (e.g. standing up a new service inside a monorepo) and you need the discovery maps as planning constraints. If the request is really an existing-code change, stop and route to `/feature`.

If this is a non-trivial existing codebase and `specs/brownfield/codebase-map.md` does not exist, run `/brownfield` before Phase 1. Use the generated architecture, test, risk, and change-strategy maps as constraints for the BRD, stories, and design.

Skip Phase 0 only for greenfield projects, documentation-only work, or tiny `/vibe`-eligible changes.

### Phase 1 — Business Requirements [HUMAN APPROVAL]

Run `/brd` with the provided requirements document. Outputs are written to `specs/brd/`.

**Stop and wait for explicit human approval before proceeding.** Present a summary of the BRD and ask: "Approve BRD to proceed to Phase 2?"

Do NOT proceed without a clear "yes" or "approved" from the user. *(In `--autonomous` mode, do not stop here — the BRD is approved together with everything else at the consolidated Plan Approval gate, Phase 3.5.)*

### Phase 2 — Story Specification [HUMAN APPROVAL]

Run `/spec` using the approved BRD. Outputs are written to `specs/stories/` and root `features.json`.

**Stop and wait for explicit human approval before proceeding.** Present the story count, dependency groups, and feature list. Ask: "Approve stories to proceed to Phase 3?"

Do NOT proceed without a clear "yes" or "approved" from the user. *(In `--autonomous` mode, do not stop here — deferred to the consolidated Plan Approval gate, Phase 3.5.)*

If the user already has product stories, `/spec` may normalize those existing stories instead of deriving them from the BRD. The output contract is still the same: `epics.md`, ready story files, `dependency-graph.md`, and root `features.json`. Stories marked `needs_breakdown` must be resolved before Phase 3.

### Phase 3 — Architecture Design + Test Planning [HUMAN APPROVAL]

Run `/design` and `/test --plan-only` **in parallel** using two concurrent Agent calls. Both consume `/spec` output independently:

- **`/design`** — produces architecture artifacts in `specs/design/` (architecture, api-contracts, component-map, data-models, schemas).
- **`/test --plan-only`** — produces test plan, test cases mapped to acceptance criteria, and test data fixtures in `specs/test_artefacts/` (test-plan.md, test-cases.md, test-data/).

Wait for BOTH to complete before presenting results.

**Then compute plan confidence.** Run `node .claude/scripts/plan-confidence.js`, which writes `specs/plan-confidence.json` — a band (high/medium/low), a score, and its risk drivers, derived deterministically from the BRD's open questions and assumptions, the needs-breakdown backlog, the epic count, hollow definitions in the design schemas, and unmitigated high/critical seams in the brownfield risk map. This gates **planning only** and never touches the machine verification gates; it just makes the planner's own uncertainty visible to the gate that follows.

**Stop and wait for explicit human approval before proceeding.** Present:
1. Architecture summary: tech stack, component count, API surface area.
2. Test plan summary: test case count, story coverage, fixture count.
3. **Plan confidence** from `specs/plan-confidence.json`: the band and its drivers — present it here too, not only in the `--autonomous` Phase 3.5 gate, so the human approves with the planner's uncertainty in view.

Ask: "Approve design and test plan to proceed to autonomous build?" **When confidence is LOW, lead with the drivers and recommend `/clarify` first** — e.g. *"Plan confidence is LOW (2 open questions, 1 undecomposable story). Recommend `/clarify` before building. Clarify now, approve anyway, or stop?"* — rather than the bare approve/reject question. (This mirrors what `--auto` does automatically; in the gated model the human makes the call.)

Do NOT proceed without a clear "yes" or "approved" from the user. *(In `--autonomous` mode, do not present a design-only gate here — go to Phase 3.5, which presents the whole plan at once.)*

### Phase 3.5 — Consolidated Plan Approval [`--autonomous` ONLY]

**Skipped entirely in `--auto` (full-auto).** In full-auto there is no human approval gate — Phases 1–3 produce the plan and the pipeline proceeds straight to Phase 4. (In `--auto` you may still print the plan summary below for the log, but do **not** stop for approval.)

**Confidence gate in `--auto` — the one exception to "zero gates".** After Phase 3 writes `specs/plan-confidence.json`, read the band. If **high** or **medium**, proceed to Phase 4 with no stop (unchanged). If **low**, auto-invoke `/clarify` **once** — it resolves what it can from local context and records assumptions headlessly — then recompute with `node .claude/scripts/plan-confidence.js`. If it clears to high/medium, proceed. If it is **still low with unresolved open questions**, stop and surface them rather than building blind — the same bar `--auto` already applies to a missing PRD. Never loop `/clarify` more than once; a plan that stays under-determined after one pass is a human decision, not a retry.

In `--autonomous` mode this is the **single** human gate. After Phases 1–3 have produced the BRD, stories, design, and test plan **without stopping**, present them together in one summary:
1. BRD: problem, scope (in/out), **Forbidden Actions**, success metrics.
2. Stories: count, dependency groups, the Mermaid dependency graph.
3. Design: tech stack, component count, API surface, data model.
4. Test plan: case count, story coverage, fixture count.
5. Deliverable shape detected from `project-manifest.json` (has API? has UI?) and the verification mode — so the human knows which pre-PR checks (Phase 9.5) will run.
6. **Plan confidence** from `specs/plan-confidence.json`: the band (high/medium/low) and its drivers — so the human approves with the planner's own uncertainty in view, not blind.
7. **Projected spend** vs the budget cap: a rough estimate from the story/group count (`~N min · ~M agents · ~$K`, same rate table as `budget-state.js`) against the resolved cap — so the human sees the likely cost before approving. In `--auto`, if the projection already exceeds the cap before a single group runs, stop and surface it rather than starting a run that cannot finish in budget.

Ask once: **"Approve this plan to build autonomously through to an open PR?"** On a clear "yes/approved", proceed through Phases 4–11 with **no further human stops** — the machine gates carry the rest. On anything else, fall back to the gated model (treat the remaining phases as gated). In the default (non-`--autonomous`) model, skip Phase 3.5 entirely; the per-phase gates above already ran.

When confidence is **low**, do not present the bare approve/reject question — lead with the drivers and recommend resolving them first, e.g. *"Plan confidence is LOW (2 open questions, 1 undecomposable story). Recommend `/clarify` before an unattended run. Clarify now, approve anyway, or stop?"* High/medium confidence keeps the single question above.

### Phase 4 — Initialize State

Create the following state files before entering the autonomous loop. **Re-entry rule:** `/build` is resumable — if a state file already exists (a prior run was interrupted), follow the per-file reset-vs-preserve note below rather than blindly clobbering it. Only `budget-start` resets on every fresh run; the accumulated ratchet state must survive a re-run.

1. `.claude/state/coverage-baseline.txt` — **Preserve if present.** Write `0` only when the file does not yet exist; if it already holds a value (a prior run ratcheted it up), leave it — resetting it to `0` would discard the coverage floor the ratchet has earned.
2. `.claude/state/iteration-log.md` — **Preserve if present.** Write the header `# Iteration Log\n\nTracking all autonomous build iterations.\n` only when the file does not exist; otherwise append, never overwrite — the log is the audit trail across sessions.
2b. `.claude/state/budget-start` — **Always reset.** Write the current epoch-ms with `node -e 'process.stdout.write(String(Date.now()))' > .claude/state/budget-start` (portable; do **not** use `date +%s%3N`, which is GNU-only and on macOS/BSD writes a malformed `…N`-suffixed value). Stamps the run origin for budget metering (SECTION 11 of `auto/SKILL.md`); overwrite on each fresh `/build` so a new run resets the clock.
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

**Pod mode (`--pod N`).** Pass `--pod N` through to `/auto` to run the **multi-engineer pod**: each independent cluster (dependency group) is built by its own engineer-orchestrator, verified per-cluster (the Phase 9.5 ladder, scoped to the cluster), and raised as its own draft PR (stacked on its predecessor's branch when the cluster is dependent) via `wave-pr.js` — one per cluster, opened immediately. Dependent clusters open **stacked** draft PRs whose base is the predecessor's branch (`auto/group-{predecessor}`) — there is no merge wait; the next wave starts right away. Humans merge the stack bottom-up (GitHub auto-retargets each child PR to `main` as its parent merges); `AUTO_MERGE` auto-merges per PR when checks pass. In pod mode the per-cluster PRs ARE the deliverable, so Phase 9.5 and Phase 11 below run **inside** `/auto` per cluster rather than once over the whole app — see `.claude/skills/auto/SKILL.md` Section 4B → *Pod mode*. Without `--pod`, the pipeline produces a single integrated PR (Phases 9.5 + 11 below).

**Parallel agent teams:** the full SDLC pipeline runs each dependency group through `/auto`, which parallelizes on two axes:
- **Within-group:** one teammate per story for any group with **≥ 2 stories** — see `.claude/agents/generator.md` Rule 2.
- **Cross-group:** up to 3 independent dependency groups run concurrently as group-orchestrator subagents (configurable via `--parallel-groups N`; opt out with `--sequential`) — see Section 4B of `.claude/skills/auto/SKILL.md`.

For a multi-group project with multi-story groups, peak parallelism is 3 groups × 5 teammates = 15 concurrent subagents. Cross-group parallelism uses per-group git branches (`auto/group-B`, `auto/group-C`) merged sequentially after each wave to avoid trunk commit conflicts.

### Phase 9 — E2E Test Generation

After `/auto` completes (all groups done or stopping criteria met), run `/test --e2e-only` to generate Playwright E2E tests against the built source code. This uses the test plan and cases from Phase 3 as input.

The generator generates one Playwright spec per story (`e2e/{story-id}.spec.ts`), copies the Playwright config template, installs Playwright, and runs the full E2E suite. All tests must pass.

If E2E tests fail, fix them before proceeding. The tests are the specification — if a test fails because the implementation is wrong, fix the implementation, not the test.

### Phase 9.5 — Pre-PR Verification & Defect Repair

The final acceptance run on the **integrated** build, against a **locally deployed** app — the Devin-style "deploy, test, fix defects" gate that must pass before any PR. It is **shape-aware**: read `project-manifest.json` to detect whether the deliverable has an API, a UI, or both, then run only the relevant checks **in this order**:

1. **Deploy locally.** Bring the whole app up the way it actually runs — honor `verification.mode`: `docker` → `bash init.sh` (compose up + health checks); `local` → the manifest's start command (e.g. `npm start`); `stub` → the in-process harness. Confirm health before testing.
2. **API tests (if the deliverable exposes an API).** Run the API/integration suite against the running app, asserting the `api-contracts` (status codes, schemas, auth). API tests run **first** — a broken API makes UI failures noise.
3. **Playwright E2E (if the deliverable has a UI).** Only after the API is green, run the Phase 9 Playwright suite against the deployed UI.
4. **Defect-repair loop (bounded).** On any failure, capture the concrete diagnostics (failing assertion, response body, browser console errors, service logs), fix the **implementation** (not the test), redeploy, and re-run from step 2. Cap at a small number of attempts; if still failing, stop and surface the diagnostics rather than raising a PR. The evaluator agent is the oracle — the generator never declares this green itself.

   **On give-up, write a structured failure report** to `specs/verification/failure-report.md` before stopping: which suite failed, the final failing assertion(s), the captured diagnostics, the attempt count, and the last implementation diff tried. In `--auto`/`--autonomous` mode no human is watching the loop live, so this artifact is the only durable record of *why* the run halted — without it the failure is invisible until someone re-derives it. A human (or a later resumed run) reads this report instead of re-running the loop from scratch.

Only when the applicable suites are all green does the pipeline proceed. Full loop detail: `.claude/skills/build/references/autonomous-lane.md`.

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

### Phase 11 — Raise PR [gated on all-green]

The pipeline's terminal step. **Only reachable when Phase 9.5 passed** (applicable API + E2E suites green) and `/gate` (evaluator + adaptive review) is clean — never raise a PR over a failing or unverified build.

1. Run `/gate` if it has not already run on the final integrated state; abort the PR on any block-level finding.
2. Push the build branch and open the PR with `gh pr create`, body summarizing: stories delivered, the Phase 9.5 proof (which suites ran + results), `/gate` verdict, and any Forbidden-Actions checks. Link the source requirement/PRD.
3. **Do not merge.** Raising the PR is the autonomous boundary; merge is a separate decision (a human, or the symphony `AUTO_MERGE` activation key — see the autonomous-engineer roadmap).

In the **gated** model, offer to raise the PR rather than doing it unprompted. In **`--autonomous`** mode, raise it automatically once green — that is the point of the run. **In `--pod` mode this phase is superseded:** the per-cluster PRs were already raised by the engineer-orchestrators inside `/auto` (Section 4B → Pod mode), so there is no single integrated PR to open here — instead, confirm every cluster's PR is open and green and report the set. Detail: `.claude/skills/build/references/autonomous-lane.md`.

---

## Mode Reference

| Mode | Description |
|------|-------------|
| `full` | All ratchet gates including design critic and GAN loop |
| `lean` | Skip design critic and GAN loop; keep API + Playwright checks |

---

## Gotchas

- **Proceeding without approval:** in the default gated model, Phases 1-3 each require explicit human approval — silence is not consent; if the user has not clearly approved, ask again. In `--autonomous` mode there is exactly **one** gate (Phase 3.5) — never invent extra stops after it, and never skip it. In `--auto` mode there are **zero** human gates before the PR(s); the machine gates carry all the weight, so never weaken them to "make it run".
- **Raising a PR over a red build:** Phase 11 is reachable only when Phase 9.5 and `/gate` are green. Never open a PR on a failing or unverified build, even in `--autonomous` mode.
- **Skipping the design phase:** Phase 3 produces `component-map.md` and `api-contracts.md` which are required by `/auto` for sprint contracts and file ownership. Skipping design breaks the entire downstream pipeline.
- **Not initializing state files:** Phase 4 must create all three state files before `/auto` runs. Missing state files cause context recovery failures in session chaining.
- **Wrong mode passthrough:** Read the `--mode` flag from the user's invocation and pass it to `/auto` exactly. Do not default silently if the user specified a mode.
