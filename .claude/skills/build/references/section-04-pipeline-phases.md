## Pipeline Phases (0–11)

> **Numbering note.** The phases run **0 → 11**, with three half-step inserts (3.5 plan gate, 4.5 deploy, 9.5 pre-PR verify) for steps that only apply in some modes. The autonomous *execution* is a **single `/auto` call** — the "Phases 5–8" heading below is one step, not four; the sub-numbers are historical and kept only so cross-references stay stable. When in doubt, the canonical list is the tail diagram in `references/autonomous-lane.md`.

> **Resumability.** `/build` is re-entrant. Each planning phase (0–3) is **skip-if-its-artifacts-exist**: if `specs/brd/`, `specs/stories/`, or `specs/design/` are already populated from an interrupted run, do not regenerate them — confirm they are complete and move on (re-running a phase silently discards human-approved plan edits). Phase 4 state files follow the per-file reset-vs-preserve rule documented there. Only force a regenerate when the user explicitly asks to redo a phase.

**Boundary with `/sprint`.** If `specs/design/architecture.md` already
exists, this project has already been through sprint 1 (or a recovered
baseline) — `/build` is not the right entry point for further work. Stop and
tell the human to run `/sprint <prd-file>` instead, which grounds the new PRD
against the prior sprint and amends the living design rather than
regenerating it. Only continue past this check when `specs/design/` does not
yet have an approved baseline.

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

**Confidence gate in `--auto` — the one exception to "zero gates".** After Phase 3 writes `specs/plan-confidence.json`, enforce it **mechanically** as well as in prose:

1. Run `node .claude/scripts/plan-confidence.js .` (writes the artifact) then `node .claude/scripts/plan-confidence.js . --gate`.
2. Exit code **0** (band high|medium) → proceed to Phase 4 with no stop.
3. Exit code **2** (band **low**) → auto-invoke `/clarify` **once** (local context + recorded assumptions; headless). Recompute: `node .claude/scripts/plan-confidence.js .` then `node .claude/scripts/plan-confidence.js . --gate` again.
4. If the second `--gate` is still **2**, **stop** and surface `specs/plan-confidence.json` drivers — do not start `/auto` / Phase 4. Never loop `/clarify` more than once; a plan that stays under-determined after one pass is a human decision, not a retry.

(The same bar as a missing PRD: unattended mode must not invent a sure plan.)

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

Run `/auto --mode {mode}` to enter the autonomous build loop. If the resolved lane has `singlePr: true` (i.e. the user passed `--single-pr`), forward it: run `/auto --mode {mode} --single-pr`. The `/auto` skill handles all remaining execution: sprint contracts, agent teams, ratchet gates, self-healing, and session chaining.

**Pod mode (`--pod N`).** Pass `--pod N` through to `/auto` to run the **multi-engineer pod**: each independent cluster (dependency group) is built by its own engineer-orchestrator, verified per-cluster (the Phase 9.5 ladder, scoped to the cluster), and raised as its own draft PR (stacked on its predecessor's branch when the cluster is dependent) via `wave-pr.js` — one per cluster, opened immediately. Dependent clusters open **stacked** draft PRs whose base is the predecessor's branch (`auto/group-{predecessor}`) — there is no merge wait; the next wave starts right away. Humans merge the stack bottom-up (GitHub auto-retargets each child PR to `main` as its parent merges); `AUTO_MERGE` auto-merges per PR when checks pass. In pod mode the per-cluster PRs ARE the deliverable, so Phase 9.5 and Phase 11 below run **inside** `/auto` per cluster rather than once over the whole app — see `.claude/skills/auto/SKILL.md` Section 4B → *Pod mode*. Without `--pod`, the pipeline produces a single integrated PR (Phases 9.5 + 11 below). **With `--pod N --single-pr`**, you get pod concurrency (up to N parallel cluster builds) but ONE integrated PR at the end — `--single-pr` overrides the per-cluster PR default regardless of cluster count. Pass both flags through: `/auto --mode {mode} --pod N --single-pr`.

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
3. **Playwright E2E (if the deliverable has a UI).** If the deliverable has a UI, first run `npx playwright install --with-deps chromium` — idempotent, and chained sessions can span long enough for browser binaries to be missing. Only after the API is green, run the Phase 9 Playwright suite against the deployed UI.
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

The pipeline's terminal step. **Only reachable when Phase 9.5 passed** (applicable API + E2E suites green) and `/gate` (evaluator + adaptive review + quality-card) is clean — never raise a PR over a failing or unverified build.

1. Run `/gate` if it has not already run on the final integrated state; abort the PR on any block-level finding. `/gate` Step 4 must have written `specs/reviews/quality-card.md` + `walkthrough.md` (and stamped `.claude/state/gate-receipt.json`).
2. Compose the PR body from the gate receipts (do **not** hand-roll a thin summary):
   ```bash
   node .claude/scripts/pr-body.js --require-gate --title "<stories delivered>" > /tmp/pr-body.md
   # exit 1 if quality-card is FAIL/incomplete — abort PR open
   gh pr create --title "..." --body-file /tmp/pr-body.md
   ```
   The body includes the quality card, logical walkthrough, and navigation links (`docs/CODEBASE.md`, DeepWiki, `npm run ask`). Append Phase 9.5 proof and the PRD link under the generated body or via `--extra`. Pod mode: pass the same body into `wave-pr.js --body "$(node .claude/scripts/pr-body.js --require-gate)"`.
3. **Merge.** Raising the PR is the autonomous boundary, and merge stays human
   **unless** AUTO_MERGE is active — the `--auto-merge` flag or `AUTO_MERGE=true`
   env (method from `MERGE_METHOD`, default `merge`). When active, run
   `node .claude/scripts/auto-merge.js <prUrl> --auto-merge`: it pins the PR to
   the current repo (`git remote get-url origin`) and runs `gh pr merge --auto
   --<method>`, so **GitHub merges only once the repo's required status checks
   pass** — never a red build. If auto-merge can't be enabled (the repo lacks
   "Allow auto-merge", a `gh` error, or a repo-slug mismatch), it leaves the PR
   open and surfaces the reason; the run never fails over auto-merge. **Caveat:**
   on a repo with no required status checks, `gh pr merge --auto` merges
   immediately, so AUTO_MERGE there merges right after the harness gates — assume
   "Allow auto-merge" + branch protection with required checks.

4. **Respond pass (opt-in).** If `--respond` was passed (default off), invoke `/pr-respond <pr#> --watch` on each PR just opened, so red CI or early review comments get one bounded response pass before handoff. Merge remains human-owned regardless.

In the **gated** model, offer to raise the PR rather than doing it unprompted. In **`--autonomous`** mode, raise it automatically once green — that is the point of the run. **In `--pod` mode this phase is superseded:** the per-cluster PRs were already raised by the engineer-orchestrators inside `/auto` (Section 4B → Pod mode), so there is no single integrated PR to open here — instead, confirm every cluster's PR is open and green and report the set. Detail: `.claude/skills/build/references/autonomous-lane.md`.

---
