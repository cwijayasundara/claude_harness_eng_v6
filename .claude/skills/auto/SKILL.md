---
name: auto
description: Autonomous build loop with Karpathy ratcheting, GAN evaluator, and session chaining. Iterates story groups until all features pass or stopping criteria met.
argument-hint: "[--mode full|lean] [--group GROUP_ID]"
context: fork
---

# Auto Skill

Autonomous build loop implementing Karpathy's ratcheting pattern with GAN-style generator-evaluator separation, agent teams for parallel execution, sprint contracts for verifiable done-criteria, self-healing with failure-driven learning, and session chaining for multi-context-window builds.

> **Ultracode tip:** Leave ultracode **off** here (`/effort high` or lower). This loop already orchestrates its own agent teams and generator↔evaluator fan-out against sprint contracts; ultracode's auto-workflows would double-orchestrate, fight the contracts, and burn tokens. Do the divergent thinking earlier (`/brownfield`, `/design`, `/spec`) with ultracode on, then turn it off before running `/auto`.

---

## SECTION 1: Usage, Prerequisites, and Agent Delegation

### Usage

```
/auto
/auto --mode lean

/auto --group D
/auto --parallel-groups 3
/auto --sequential
```

- `--mode` controls which ratchet gates are enforced. Default: `full`. Options: `full`, `lean` (`lean` skips only the per-iteration design-critic).
- `--group` resumes or targets a specific dependency group. If omitted, picks the next unfinished group from the dependency graph.
- `--parallel-groups N` enables cross-group parallelism: up to N independent dependency groups run concurrently as separate group-orchestrator subagents. Default: `3`. Set `1` (or pass `--sequential`) to force one-group-at-a-time behavior.
- `--sequential` shorthand for `--parallel-groups 1`. Use when you need deterministic group ordering for debugging.

### Prerequisites

Before `/auto` can run, the following must exist:

- `specs/stories/` — approved story files with acceptance criteria.
- `specs/design/` — approved architecture artifacts including `api-contracts.md` and `component-map.md`.
- `.claude/program.md` — project constraints and conventions.
- `features.json` — feature tracking file (created by `/spec`).
- `specs/stories/dependency-graph.md` — group ordering and dependencies.
- `specs/stories/epics.md` — epic index and story membership.
- `claude-progress.txt` — session tracking file (created by `/build` phase 4).

If any prerequisite is missing, stop and report what is absent. Do not proceed with partial context.

### Agent Delegation

**Critical rule: /auto orchestrates but NEVER implements code directly.**

- `/auto` is the orchestrator. It reads state, makes decisions, spawns agents, and manages the loop.
- Code generation is delegated to the **generator** agent (via `/implement` or direct agent spawn).
- Code verification is delegated to the **evaluator** agent (via `/evaluate` or direct agent spawn).
- Design critique is delegated to the **design-critic** agent.
- `/auto` never writes application code, tests, or configuration files itself.

### Context & Token Discipline

`/auto` is the longest-running, most token-heavy loop in the harness. Every token in the orchestrator's context window is re-sent (cache permitting) on every turn, so keep the orchestrator context lean — delegate verbose work into subagents whose context is discarded when they return.

- **Keep verbose output out of the orchestrator.** Test logs, build output, full-file reads, and evaluation transcripts must be produced and consumed inside the `evaluator` / `codebase-explorer` / generator subagents — only their short verdict (PASS/FAIL + summary) returns to `/auto`. Never read raw test or build logs into the orchestrator directly.
- **Prefer Grep/Glob over full Reads.** When the orchestrator needs a fact from a file, search for it; do not read whole files into the loop's context.
- **Bound noisy command output.** Tool output cannot be compressed after the fact by a hook — `suppressOutput` only hides it from the UI, not from the model. So bound it *before* it crosses the tool boundary: run verbose commands as `cmd > /tmp/out.log 2>&1` then surface only what matters with `tail -n 50 /tmp/out.log` or `grep -E 'FAIL|Error' /tmp/out.log`, or have a subagent run the command and return only a summary. Never let a full build/test log stream into the orchestrator.
- **Compact at group boundaries, not mid-group.** Run `/compact` (or rely on session chaining via `claude-progress.txt`) at the seam between dependency groups, where the summary is cheap and the prefix rebuild is amortized — never mid-implementation, which throws away a warm cache. (See SECTION 10: Session Chaining.)
- **Don't break the cache prefix mid-run.** No tool/plugin/MCP churn, no `CLAUDE.md` edits, no main-loop model swap during a run (see the Prompt Caching rules in `CLAUDE.md`). Model changes happen via subagents only.

---

## SECTION 2: Context Recovery (Step 1 of Every Iteration)

At the start of EVERY iteration — including the first — read these files in order:

1. **`.claude/program.md`** — Constraints may have changed mid-run. Re-read every iteration. Never cache.
2. **`.claude/state/learned-rules.md`** — Accumulated project rules. Inject verbatim into ALL agent prompts spawned this iteration.
3. **`claude-progress.txt`** — Read the LAST session block (the block after the final `=== Session` marker). Extract: `current_group`, `groups_completed`, `groups_remaining`, `last_commit`, `next_action`.
4. **`features.json`** — Current pass/fail state for all features. Determines what work remains.
5. **`specs/stories/dependency-graph.md`** — Compute the current wave (Section 4B Wave Selection Algorithm). A group is "unfinished" if any of its stories' features are not passing in `features.json`. Respect dependency ordering: do not start a group whose upstream dependencies have failing features. With `--sequential` (or `--parallel-groups 1`), the wave is the single next unfinished group; with default `--parallel-groups 3`, the wave is up to 3 concurrently-ready groups.
6. **Target group story files** — Verify every story in every selected group is marked `Readiness: ready`. If any story is `needs_breakdown`, stop and request a story decomposition pass before implementation.

If `claude-progress.txt` indicates a `current_group` (or `current_wave`) that is not yet complete, resume from there. Otherwise, compute a fresh wave per Section 4B.

---

## SECTION 3: Sprint Contract Negotiation (Steps 2-3)

Sprint contracts define the verifiable done-criteria for a group. Two-step propose-approve process using generator and evaluator agents.

### Step 2 — Generator Proposes Contract

Spawn generator as a subagent with this prompt:

> Read stories [list IDs for this group], `specs/design/api-contracts.md`, `specs/design/component-map.md`. Propose a sprint contract for group {ID}. Include: api_checks, playwright_checks, design_checks, architecture_checks, features list. Write the contract to `sprint-contracts/{group}.json`.

The generator produces a draft contract based on the story acceptance criteria and the architecture design.

### Step 3 — Evaluator Approves Contract

Spawn evaluator as a subagent with this prompt:

> Read the proposed sprint contract at `sprint-contracts/{group}.json`. Review each check against the story acceptance criteria and API contracts. Add any missing checks. Remove any checks that do not trace to an acceptance criterion. Write the final contract to the same path.

Rules:
- **No back-and-forth.** The evaluator has final say. The generator does not get to dispute.
- **Contract is immutable after negotiation.** Once the evaluator writes the final version, no one edits it.

---

## SECTION 4: Agent Team Execution (Step 4)

Spawn the generator agent to create and manage a Claude Code agent team for the current group.

### Orchestrator Spawn Prompt (Mandatory Template)

When invoking the generator from `/auto`, you (the orchestrator) **MUST** use a prompt that carries the team mandate inline — a terse one-liner like `"Implement group A"` leaves too much latitude and the generator will sometimes implement solo. Use this template verbatim, substituting `{GROUP_ID}` and the story count:

```
Implement group {GROUP_ID} ({N_STORIES} stories) using the mandatory parallel-team protocol from generator.md Rule 2.

You are dispatching, not implementing. Concretely:
1. Read specs/stories/ for every story in this group.
2. Read specs/design/component-map.md and build the micro-DAG (Step 2.5).
3. Spawn one Agent(subagent_type=generator) per story — in parallel for Phase 1, then Phase 2 after Phase 1 commits.
4. Do NOT call Write or Edit on production files yourself unless you are the designated integrator for a shared file in Phase 3.
5. Log every teammate spawn to .claude/state/iteration-log.md with the story ID, owned files, and phase.
6. After all teammates complete, run the validation gate (pytest, ruff, mypy/tsc, coverage) and hand off to the evaluator.

This applies for any group with N_STORIES >= 2 regardless of how small the stories look. There is no bypass — every multi-story group spawns a team.
```

If the group has only **1 story**, use the legacy single-generator prompt instead — no team needed.

### Verification After Generator Returns

After the generator subagent returns, verify the team actually executed before trusting the result:

1. Read `.claude/state/iteration-log.md` — there must be one teammate-spawn entry per story in the group (minus integrators for Phase 3-only files).
2. If the log shows zero teammate spawns for a multi-story group, the generator violated Rule 2. Surface this as a ratchet failure, record it in `.claude/state/learned-rules.md` (under "Process rules"), and re-dispatch with an even stricter prompt that names the violation.

This verification is non-optional: the user has explicitly requested parallel agent teams for independent story clusters and silent fallback to solo execution defeats the purpose.

### Dependency Handshake

Before spawning teammates, the generator analyzes the component map:
1. Identifies shared files (files in 2+ stories)
2. Identifies interface boundaries (`Produces:` / `Consumes:` in component map)
3. Builds a micro-DAG grouping teammates into execution phases
4. Designates integrators for shared files

Log the micro-DAG to `iteration-log.md`.

If no cross-dependencies exist, all teammates spawn in parallel (legacy behavior).

### Phased Execution

| Phase | Who | Starts When | Must Do |
|-------|-----|------------|---------|
| 1 | Teammates with no upstream deps | Immediately | Implement + commit typed interface contracts |
| 2 | Teammates consuming Phase 1 outputs | All Phase 1 teammates complete | Code against committed interface contracts |
| 3 | Integrators for shared files | All Phase 2 teammates complete | Collect declared additions, write to shared files |

Max 5 concurrent teammates per phase. Batch in groups of 5 if more.

### Teammate Spawn Prompt

Every teammate receives:
- Story acceptance criteria (from `specs/stories/E{n}-S{n}.md`)
- Story readiness metadata (must be `ready`; otherwise do not spawn)
- File ownership (from `specs/design/component-map.md`)
- Learned rules (from `.claude/state/learned-rules.md` — inject verbatim)
- Quality principles (from `.claude/skills/code-gen/SKILL.md`)
- Interface contracts from upstream teammates (Phase 2+ only)
- If story involves external API: `.claude/skills/code-gen/references/api-integration-patterns.md`

### Model Tiering

| Role | Model | Rationale |
|------|-------|-----------|
| `/auto` orchestrator | Opus | Judgment, architectural decisions |
| Evaluator | Opus | Skeptical verification |
| Design critic | Opus | Subjective visual judgment |
| Generator lead | Sonnet | Coordination, lower cost |
| Generator teammates | Sonnet | Mechanical implementation |
| Security reviewer | Opus | Contextual vuln reasoning + adversarial find-then-refute |

Configure via `project-manifest.json` field `execution.model_tier`.

---

## SECTION 4B: Cross-Group Parallelism

Within-group teams (Section 4) parallelize *stories inside one group*. Cross-group parallelism parallelizes *independent groups* of the dependency graph. The two compose: a wave of 3 concurrent groups, each with 5 teammates, is 15 concurrent subagents at peak.

### When It Applies

Cross-group parallelism activates when **all** of the following hold:
- `--parallel-groups N` is `> 1` (default `3`; pass `--sequential` or `--parallel-groups 1` to opt out).
- The dependency graph (`specs/stories/dependency-graph.md`) declares **two or more groups whose upstream dependencies are all satisfied** (already-complete groups or zero upstream deps).

If only one group is ready in the current wave, behave exactly as sequential `/auto` — no extra branches, no parent/child split. Don't pay the coordination tax when there's nothing to coordinate.

### Wave Selection Algorithm

1. Read `specs/stories/dependency-graph.md` and `features.json`.
2. A group `G` is *complete* when every story in `G` has `passes: true` in `features.json`.
3. A group `G` is *ready* when every upstream group of `G` is complete (or `G` has no upstream deps).
4. The current **wave** = the set of ready, not-yet-complete groups.
5. Cap the wave at `--parallel-groups N` (default 3). If more groups are ready than the cap, pick the first N in dependency-graph order; the remainder fall into the next wave.

Log the wave selection to `.claude/state/iteration-log.md` before dispatching:

```
=== Wave 1 (2026-05-13T12:30:00Z, parallel-groups=3) ===
Ready: [B, C, D]
Selected: [B, C, D]
Deferred: []
```

### Git Branch Strategy

Each group in a wave runs on its own branch to eliminate parallel-commit conflicts on the trunk.

1. Before dispatch, the parent orchestrator captures the current branch as `WAVE_BASE` (e.g., `main` or `feat/new-thing`).
2. For each group `G` in the wave, the parent creates `auto/group-{G}` from `WAVE_BASE` and dispatches the group-orchestrator subagent against it.
3. Each group-orchestrator commits all its work to its own branch.
4. After all group-orchestrators in the wave complete, the parent merges branches back into `WAVE_BASE` **sequentially in dependency-graph order**. Failed groups are NOT merged; their branches are preserved for inspection.

Merge conflicts at this stage indicate a file-ownership violation (two groups touched the same file). When that happens:
- Abort the merge.
- Record the violation in `.claude/state/learned-rules.md` under "Process rules".
- Surface it as a ratchet failure for the offending group.
- Resume `/auto` to re-plan with the user.

If `--sequential`, skip branch creation entirely and commit directly to `WAVE_BASE`.

### State Coordination

Concurrent group-orchestrators MUST NOT write to shared state files. The parent owns shared state and merges per-group artifacts between waves.

**Parent-owned (read-write only by parent orchestrator):**
- `claude-progress.txt`
- `.claude/state/learned-rules.md`
- `features.json` (parent rolls up per-group status updates between waves)

**Per-group-owned (read-write only by that group's orchestrator):**
- `.claude/state/wave-{N}/group-{G}/iteration-log.md` — micro-DAG, teammate spawns, ratchet results
- `.claude/state/wave-{N}/group-{G}/features-update.json` — proposed updates to `features.json` for stories in `G`
- `.claude/state/wave-{N}/group-{G}/learned-rule-candidates.md` — candidate rules to roll up
- `.claude/state/wave-{N}/group-{G}/sprint-contract.json` — copy of the approved contract for this group
- `sprint-contracts/group-{G}.json` — the canonical contract (each group writes only its own file)

The parent creates `.claude/state/wave-{N}/` before dispatch and rolls per-group artifacts up into parent-owned state between waves. Roll-up steps:

1. Append each `iteration-log.md` section to the canonical `.claude/state/iteration-log.md` (preserving group tags).
2. Merge each `features-update.json` into `features.json` (key-disjoint by story ID — no conflicts possible if file ownership held).
3. Triage each `learned-rule-candidates.md` — promote the strong ones to `.claude/state/learned-rules.md`; discard duplicates and weak signals.
4. Update `claude-progress.txt` with the wave summary (groups completed, stories passing, next wave preview).

### Group-Orchestrator Spawn Protocol

For each group `G` in the current wave, the parent spawns a subagent with this prompt template. Use `Agent(subagent_type=generator)` — the generator agent's instructions cover both implementation AND orchestration when given the group-orchestrator role.

```
You are the group-orchestrator for dependency group {G} of wave {N}.

Your scope is EXACTLY one group. Do not touch other groups, do not advance the wavefront, do not write to parent-owned state files.

Mandatory steps:
1. Read sprint-contracts/group-{G}.json. If missing, propose one (Section 3 of /auto), get evaluator approval, then proceed.
2. Switch to branch auto/group-{G} (parent has already created it from {WAVE_BASE}).
3. Run the in-group flow: micro-DAG → teammate dispatch (Rule 2 in generator.md) → ratchet gate for this group only.
4. Write per-group state to .claude/state/wave-{N}/group-{G}/ ONLY. Do not write to claude-progress.txt, learned-rules.md, or features.json directly.
5. Commit all work to auto/group-{G}. Do NOT merge — the parent handles merging after the wave.
6. Return a structured summary: { "group": "{G}", "passes": <bool>, "stories_passing": [...], "stories_failing": [...], "rule_candidates_path": "...", "iteration_log_path": "..." }

You may parallelize teammates within this group up to 5 (Rule 2 mandate). You may NOT spawn nested group-orchestrators or touch other groups.
```

### Wait + Merge Protocol

The parent dispatches all group-orchestrators in the wave in a single message (multiple `Agent` tool calls in one block — Claude Code runs them concurrently). The parent then:

1. Waits for all group-orchestrator subagents to return.
2. For each returned summary, runs the roll-up steps above (in dependency-graph order, deterministic).
3. Merges successful groups' branches into `WAVE_BASE` (sequential merges).
4. If any group failed: leave its branch unmerged, log the failure under `.claude/state/iteration-log.md`, advance to the next wave with the failed group still incomplete. The next wave may unlock different groups via the dependency graph; failed groups can be retried by re-running `/auto --group {G}` later.
5. Recompute the wave (Wave Selection Algorithm) and dispatch the next one until all groups are complete or no groups can advance.

### Failure Handling

| Failure mode | Parent action |
|---|---|
| One group in wave fails ratchet gate | Leave branch unmerged, advance other groups, surface failure summary at end of wave |
| Group-orchestrator subagent crashes / times out | Treat as failed; do NOT auto-retry inside the same wave (avoid infinite loops); user can `/auto --group {G}` to retry |
| Merge conflict during roll-up | Abort merge for that group, treat as failure, record as a file-ownership-violation rule candidate |
| All groups in wave fail | Stop. Print wave summary and ask user how to proceed |

### Concurrency Limits

| Resource | Cap | Rationale |
|---|---|---|
| Concurrent group-orchestrators per wave | 3 (default, override with `--parallel-groups N`) | Below most rate limits; leaves headroom for within-group teams |
| Concurrent teammates per group-orchestrator | 5 (Section 4 mandate) | Existing within-group cap |
| Peak total subagents | 15 (3 × 5) | Safety ceiling; raise only after observing actual usage |

If `--parallel-groups N > 3`, accept it but emit a warning to the iteration log. The 3-default is conservative; teams with higher API throughput can raise it.

---

## SECTION 5: Ratchet Gate (Step 5)

After the agent team completes, run the ratchet gate. The ratchet is monotonic: progress never regresses. Seven sub-gates, mode-dependent:

| Gate | Full | Lean |
|------|------|------|
| 1. Unit tests (pytest, vitest) | Yes | Yes |
| 2. Lint + types (ruff, mypy, tsc) | Yes | Yes |
| 3. Coverage >= baseline | Yes | Yes |
| 4. Architecture (files exist, schema validation) | Yes | Yes |
| 5. Evaluator (API + Playwright vs running Docker) | Yes | Yes |
| 6. Design critic (vision scoring, GAN loop) | Yes | No |
| 7. Security (security-reviewer, block on critical/high) | Yes | Yes |

**Lean** differs from **Full** only at Gate 6: it does **not** run the design-critic vision loop at all. Every other gate — including the Gate 7 security review and the Gate 5 evaluator — runs in both modes. There is no mode that skips the security gate or the evaluator; that is the whole point of the ratchet.

### Fast Lane (trivial commits)

The Fast Lane is a per-*commit* optimization (not an execution mode): for a commit that introduces no production logic, skip the expensive **gates 4, 5, and 6** (architecture, evaluator, design-critic). It applies to commits that ONLY contain:
- Lint/format fixes (ruff auto-fix, eslint --fix)
- Documentation updates (.md files only)
- Type annotation fixes (no logic changes)
- Learned-rules updates

**Gates 1, 2, 3, and 7 still run** — tests, lint/types, coverage, **and the security review**. The security gate is never skipped, even on the Fast Lane (it is cheap and a no-op on a docs-only diff, but a "trivial" commit that quietly touches a secret or an env file must still be caught).

Detection: take the Fast Lane only when `git diff --cached --name-only` shows **no** files with a source extension (`.py`/`.ts`/`.tsx`/`.js`/…) — i.e. only `.md`, config, or annotation-only changes — or the commit message starts with `fix: lint`, `style:`, or `docs:`. When in doubt, run the full ratchet.

This prevents the expensive evaluator from blocking trivial housekeeping changes.

For small work requested outside `/auto`, use `/vibe` instead of starting the autonomous loop. `/vibe` applies the same fast-lane idea at interactive scale: micro-contract, narrow edits, targeted checks, and reviewer enforcement without sprint contracts or full SDLC artifacts.

### Gate 1 — Unit Tests

```bash
cd backend && uv run pytest -x -q && cd ..
cd frontend && npm test && cd ..
```

Both must pass with zero failures. The `-x` flag stops at first failure for fast feedback.

### Gate 2 — Lint + Types

```bash
# Backend
uv run ruff check . && uv run mypy src/
# Frontend
npm run lint && npm run typecheck
```

All four commands must exit with code 0.

### Gate 3 — Coverage >= Baseline

```bash
uv run pytest --cov=src --cov-report=term-missing -q | grep "^TOTAL" | awk '{print $NF}'
```

Compare the result with `.claude/state/coverage-baseline.txt`. The new coverage percentage must be **greater than or equal to the baseline AND >= 80% (hard floor)**. If it drops below either threshold, the gate FAILS — even if all tests pass.

**Coverage policy (ref: "AI is forcing us to write good code" by Steve Krenzel):**
- **Floor: 80%.** No commit may drop below this. The ratchet gate BLOCKS.
- **Target: 100%.** Every line the agent wrote must be verified by a test. At 100%, any uncovered line is an unambiguous signal of missing verification.
- **TDD enforced:** Tests are written BEFORE implementation. The generator and teammates must follow the red-green-refactor cycle: write failing test → implement → verify pass → commit.

### Gate 4 — Architecture Checks

Spawn evaluator to verify `architecture_checks` from the sprint contract:
- All files in `files_must_exist` must be present on disk.
- Schema validation against `specs/design/api-contracts.schema.json` if specified.

### Gate 5 — Evaluator (API + Playwright)

Spawn evaluator with the full sprint contract. The evaluator runs:
- All `api_checks` against the live Docker stack.
- All `playwright_checks` against the running UI.

The evaluator writes its report to `specs/reviews/evaluator-report.md`.

### Gate 6 — Design Critic (Full Mode Only)

Spawn design-critic on every page listed in the sprint contract's `design_checks`. The critic screenshots each page, scores visual fidelity, and returns PASS/FAIL per check. See SECTION 9 for the full GAN loop if scores are below threshold.

### Gate 7 — Security (Full + Lean)

Spawn the `security-reviewer` agent against the group's changed files. It writes `specs/reviews/security-verdict.json`. The gate **FAILs** if `security-verdict.json#pass === false` — i.e. any finding whose `severity` is in the contract's `contract.security_checks.block_severities` (default `["critical", "high"]`). Medium/low findings are WARN/INFO and do not fail the gate. A missing verdict file is a FAIL (`failure_layer: "security"`) — a skipped scan is never a pass. This gate does not need the Docker stack and can run concurrently with Gate 5.

---

## SECTION 6: PASS/FAIL Handling (Steps 6-7)

### On PASS (All Gates Clear)

**Sequential mode (`--sequential` or wave-of-one):**

1. **Commit:** `git add -A && git commit -m "feat: implement group {group}"`
2. **Update features.json:** Set `passes: true` for all features in this group's sprint contract.
3. **Update claude-progress.txt:** Append a new session block (see SECTION 10 for format).
4. **Update iteration-log.md:** Append entry with group ID, timestamp, verdict, and summary.
5. **Update coverage-baseline.txt:** Write the new coverage percentage (ratchet up).
6. **Next group:** Return to SECTION 2 (context recovery) for the next iteration.

**Parallel mode (wave of ≥ 2 groups):**

The above steps are split across the group-orchestrator subagent and the parent orchestrator:

*Group-orchestrator (per group, runs in subagent):*
1. **Commit to per-group branch:** `git commit -m "feat: implement group {group}" auto/group-{group}` (already checked out).
2. **Update per-group state:** Write proposed `features.json` updates to `.claude/state/wave-{N}/group-{group}/features-update.json` and the per-group `iteration-log.md` and `learned-rule-candidates.md`. Do NOT touch parent-owned files.
3. **Return summary** to the parent (see Section 4B Group-Orchestrator Spawn Protocol for schema).

*Parent (after all group-orchestrators in the wave return):*
4. **Roll-up state** (Section 4B Wait + Merge Protocol): merge per-group `features-update.json` files into `features.json`, append per-group `iteration-log.md` sections to the canonical log, triage `learned-rule-candidates.md` into `learned-rules.md`.
5. **Merge branches sequentially** into `WAVE_BASE` in dependency-graph order (passing groups only).
6. **Update parent state:** append a new session block to `claude-progress.txt` with the wave summary; ratchet `coverage-baseline.txt` to the new repo-wide coverage after all merges.
7. **Next wave:** Return to SECTION 2 (context recovery) to compute the next wave.

### On FAIL — Self-Healing Loop (Max 3 Attempts)

Do not immediately revert. Attempt targeted self-healing first.

**Attempt 1-3:**

1. **Diagnose:** Invoke `superpowers:systematic-debugging` to analyze the failure before attempting a fix. This prevents jumping to conclusions and ensures the root cause is identified. Read the evaluator report (`specs/reviews/evaluator-report.md`) and, for security failures, the security verdict (`specs/reviews/security-verdict.json`) for specific failure details. Identify the exact check or finding that failed and the error output.

2. **Classify** the failure into one of 10 categories:

| Category | Signal | Auto-Fix Strategy |
|----------|--------|-------------------|
| Lint/format | ruff/eslint error output | `ruff check --fix && ruff format` |
| Type error | mypy/tsc error with file:line | Fix the type annotation at the specified location |
| Test failure | pytest/vitest assertion error | Fix the production code, NOT the test |
| Import error | ImportError / ModuleNotFoundError | Fix the import path or `__init__.py` |
| Coverage drop | Coverage % below baseline | Add tests for the specific uncovered lines |
| API check fail | HTTP 500/404/wrong schema | Read `docker compose logs backend --tail=50`, identify root cause from stack trace, fix service/router |
| Playwright fail | Element not found / assertion error | Read the selector, fix the component |
| Design score low | Score below threshold | Apply the critique text, regenerate the UI |
| Docker fail | Container exit code / won't start | Read `docker compose logs`, fix config or deps |
| Architecture drift | Schema mismatch / missing file | Read the schema, fix the response or create the file |
| Security (BLOCK) | `security-verdict.json#pass === false` (critical/high finding) | Apply the finding's `fix`; parameterize queries, add authz/validation, remove hardcoded secrets. Re-run the security-reviewer to confirm the verdict clears |

3. **Spawn generator** to apply the targeted fix. The generator prompt must include:
   - The structured failure JSON from `specs/reviews/eval-failures-NNN.json` (see evaluator agent for schema).
   - The category and auto-fix strategy from the table above.
   - All learned rules.
   - Instruction to fix ONLY the failing issue — no other changes.
   - **Accumulated `prior_attempts`:** On attempt 2, include attempt 1's fix description and result. On attempt 3, include both. This prevents the generator from re-trying the same fix.

   **Error type to fix strategy mapping:**

   | error_type | Strategy |
   |-----------|----------|
   | `lint_format` | Run auto-fix tools (`ruff check --fix`, `eslint --fix`) |
   | `type_error` | Fix annotation at file:line from stack trace |
   | `import_error` | Check module path, fix import statement |
   | `key_error` | Check data shape at source — log incoming data, fix accessor |
   | `timeout` | Check if service is started, increase timeout, add retry |
   | `connection_refused` | Verify service URL in config, check port mapping |
   | `validation_error` | Compare request/response against schema, fix model |
   | `assertion_error` | Read test assertion, compare expected vs actual, fix logic |
   | `api_transient` | Retry evaluator check once (code may be correct, API was flaky). If retry passes, do not count as a self-heal attempt. |
   | `api_permanent` | Fix wrapper error handling or request format |

4. **Re-run the failed gate** (not all gates — just the one that failed).

5. **3rd failure — hard stop for this group:**
   - Revert changes: `git checkout -- .`
   - Log the failure to `.claude/state/failures.md` with group ID, failure category, all three attempt summaries.
   - Extract a learned rule (see SECTION 12).
   - Mark the group as BLOCKED in `claude-progress.txt`.
   - Escalate to the user with a summary.
   - Continue to the next unblocked group.

---

## SECTION 7: App Lifecycle Management

`/auto` is responsible for starting and stopping the application. The evaluator does NOT manage the app lifecycle.

Read `verification.mode` from `project-manifest.json`. Default: `docker`.

### Mode: docker (default)

**Startup:**
1. Run `bash init.sh` before first evaluator check
2. Run health-check retry loop (see evaluator agent for protocol)
3. If health check fails: FAIL the current group, log to failures.md

**Between Groups:**
```bash
docker compose up -d --build
```
Wait for health check before handing off to evaluator.

**Teardown:**
```bash
docker compose down -v
```

**Error Context:** `docker compose logs --tail=50 {service_name}`

### Mode: local

**Startup:**
1. Read `verification.local.start_commands` from manifest
2. Start each command as a background process, capture stdout/stderr to `.claude/state/process-{name}.log`
3. Run health-check retry loop against configured URLs

**Between Groups:** Kill and restart processes (re-run start commands).

**Teardown:** Kill all background processes started by the orchestrator.

**Error Context:** Read from `.claude/state/process-{name}.log`

### Mode: stub

**Startup:**
1. Read `verification.stub.schema_source` from manifest
2. Generator creates a lightweight mock server (FastAPI or Express) that serves schema-valid example responses for every endpoint in the schema
3. Start the mock server on a free port
4. Run health-check retry loop

**Between Groups:** Regenerate mock server if schema has been amended (check `specs/design/amendments/`).

**Teardown:** Kill mock server process.

**Error Context:** Stub mismatch reports — when a request doesn't match any endpoint in the schema, log the requested path and method.

**Stub mode limitations:** Layer 1 checks validate request/response shapes but cannot verify business logic. Layer 2 (Playwright) skipped unless a separate frontend URL is configured.

### Worktree Isolation (All Modes)

When using `--worktree` flag, each worktree gets its own app instance:
- Docker mode: different port mappings (configured via `project-manifest.json`)
- Local mode: different port arguments in start commands
- Stub mode: different mock server port (auto-selected)

---

## SECTION 8: Architecture Amendment Detection

After each agent team completes (before the ratchet gate):

1. Check `specs/design/amendments/` for new files that were not present at the start of this iteration.
2. If new amendment files are found:
   - Read each amendment file to understand the architectural change.
   - Spawn a planner agent to update affected architecture artifacts (`api-contracts.md`, `component-map.md`, schema files).
   - Commit the amendment: `git add specs/design/ && git commit -m "refactor: update api-contracts for {change description}"`
3. Proceed to the ratchet gate with the updated architecture.

Amendments are a signal that the implementation discovered a design gap. They must be incorporated before evaluation, not deferred.

---

## SECTION 9: GAN Design Loop (Frontend Groups Only, Full Mode)

Read `calibration-profile.json` for all scoring and iteration parameters. Fall back to defaults if file does not exist.

### Configuration

| Parameter | Source | Default |
|-----------|--------|---------|
| Scoring weights | `calibration-profile.json` → `scoring.weights` | DQ=1.5, O=1.5, C=0.75, F=0.75 |
| Pass threshold | `calibration-profile.json` → `scoring.threshold` | 7 |
| Per-criterion minimum | `calibration-profile.json` → `scoring.per_criterion_minimum` | 5 |
| Max iterations | `calibration-profile.json` → `iteration.max_iterations` | 10 |
| Plateau window | `calibration-profile.json` → `iteration.plateau_window` | 3 |
| Plateau delta | `calibration-profile.json` → `iteration.plateau_delta` | 0.3 |
| Pivot on plateau | `calibration-profile.json` → `iteration.pivot_after_plateau` | true |

### Loop

For each frontend page in the current group:

1. **Screenshot** — Take screenshots of the page at 1280px and 375px widths using Playwright
2. **Score** — Spawn design-critic agent with screenshots + calibration profile
3. **Check threshold** — weighted average >= threshold AND all criteria >= per_criterion_minimum
4. **If PASS** — Record score to `specs/reviews/eval-scores.json`, continue to next page
5. **If FAIL** — Send critique to generator, generator iterates on UI code

### Plateau Detection

After each iteration, check the last `plateau_window` weighted scores:
- If `max(recent) - min(recent) < plateau_delta`: scores have plateaued
- If `pivot_after_plateau` is true: instruct generator to make a fundamental change (different palette, layout, or typography) — not incremental tweaks
- If false: log warning, continue with incremental critique

### Termination

- Score meets threshold → PASS, move to next page
- `max_iterations` reached → log to `failures.md`, extract learned rule, escalate to user. Do NOT revert (ratchet gate already passed for functional checks).
- Lean mode: skips this section entirely (the design-critic does not run in Lean)

---

## SECTION 10: Session Chaining

`claude-progress.txt` is the memory bridge between context windows. Each iteration appends a new session block.

### Format

```
=== Session {N} ===
date: {ISO 8601}
mode: {full|lean}
groups_completed: [A, B, C]
groups_remaining: [D, E, F]
current_group: D (extraction)
current_stories: [E4-S1, E4-S2]
sprint_contract: sprint-contracts/group-D.json
last_commit: {hash} "{message}"
features_passing: 47 / 203
coverage: 82%
learned_rules: 6
blocked_stories: none
next_action: Run evaluator against group D
```

### Rules

- **Append, never overwrite.** Each session block is added after the previous one. The file is an append-only log.
- **Read the LAST block** for recovery. When context recovery (SECTION 2) reads this file, it parses only the final session block to determine current state.
- **Session number increments monotonically.** Parse the last session number and add 1.
- **`next_action` is critical.** This field tells a fresh context window exactly what to do first. Be specific: "Run evaluator against group D" is good. "Continue" is not.
- **Include `blocked_stories`** if any stories failed 3 consecutive self-heal attempts. Format: `[E4-S3 (import error), E5-S1 (docker fail)]`.

---

## SECTION 11: Stopping Criteria

OR logic with priority (check in order):

1. **Hard stop:** An architecture violation that self-healing cannot fix, OR the total iteration count exceeds 50. Stop the entire `/auto` run. Report status and hand off to the user.

2. **Escalate (per-story):** A story fails 3 consecutive self-heal iterations. Mark it BLOCKED. Log to `failures.md`. Extract learned rule. Skip to the next group. Do NOT stop the entire run.

3. **Coverage gate:** Coverage drops below the baseline AFTER a successful commit. This overrides the pass — revert the commit (`git revert HEAD --no-edit`), log the regression, and re-enter self-healing for coverage.

4. **Success:** All features in `features.json` have `passes: true` AND coverage >= baseline threshold. Before claiming completion, invoke `superpowers:verification-before-completion` to run all verification commands and confirm output. Evidence before assertions. Print:
   ```
   === BUILD COMPLETE ===
   Features passing: {N}/{N}
   Coverage: {X}%
   Groups completed: [list]
   Blocked stories: [list or "none"]
   Learned rules: {count}
   Total iterations: {count}
   ```
   Then:
   1. Run `docker compose down -v`
   2. Generate `README.md` for the built application (see below)
   3. Commit: `git add README.md && git commit -m "docs: add README with architecture, setup, and API reference"`
   4. Exit

### README Generation (on completion)

After the build completes, generate a `README.md` that describes the GENERATED APP (not the harness).

Read these files for content:
- `specs/brd/brd.md` — project description
- `specs/design/architecture.md` — system architecture
- `specs/design/api-contracts.md` or `api-contracts.schema.json` — API surface
- `specs/design/component-map.md` — module structure
- `project-manifest.json` — tech stack
- `init.sh` — setup steps
- `docker-compose.yml` (if exists) — services
- `.env.example` (if exists) — required environment variables

**Required sections:** Project description, Architecture (diagram/layers), Tech Stack (table), Prerequisites, Quick Start (copy-paste commands), API Endpoints (table), Project Structure (directory tree), Running Tests, Environment Variables (table from .env.example), Development notes.

**Rules:**
- Do NOT mention Claude, the harness, `/auto`, agents, or the GAN loop. This is a developer README for the app.
- All commands must work against the generated code.
- API table must match actual routes, not just the spec.
- Environment variables must match `.env.example` exactly.

---

## SECTION 12: Failure-Driven Learning

Learned rules are the harness's long-term memory. They prevent the same mistake from recurring across iterations and context windows.

### When to Extract a Rule

Extract a new rule when the same error type (by category from SECTION 6) appears **2 or more times** in `.claude/state/failures.md`. Check after every failure entry.

### Rule Format

Append to `.claude/state/learned-rules.md`:

```markdown
## Rule {N}: {descriptive title}

- **Source:** Group {group}, Story {story}, Iteration {iter}
- **Impact:** {quantified damage — e.g., "test coverage dropped 18%", "deployment failed", "3 iterations wasted"}
- **Pattern:** {what went wrong — the repeated error signature}

### Mistake
{description of what happened and why it failed}

### Anti-Pattern (Avoid This)
\`\`\`{language}
{code example showing the bad pattern — actual code from the failure}
\`\`\`

### Better Approach
\`\`\`{language}
{code example showing the correct pattern — the fix that resolved it}
\`\`\`

- **Rule:** {the concrete instruction to prevent recurrence}
- **Applied in:** {list of agents/skills that must follow this rule}
```

Include code examples whenever the mistake involves a code pattern. For non-code mistakes (e.g., wrong deployment sequence), describe the steps instead of code blocks. Always quantify impact — agents prioritize rules with higher impact.

### Injection

- Rules are injected verbatim into ALL future agent prompts: generator teammates, evaluator, design-critic, planner.
- Include the full text of every rule, not just titles or references.
- Rules are NEVER deleted. The rule set is monotonically growing — it is a ratchet on institutional knowledge.
- If `learned-rules.md` does not exist yet, create it with a header: `# Learned Rules\n\nRules extracted from failure patterns during autonomous build.\n`

---

## SECTION 13: Gotchas

- **Not reading `program.md` each iteration:** Constraints can change mid-run (e.g., a human updates program.md while /auto is running). Always re-read at the start of every iteration.
- **Retrying the same approach after failure:** The self-healing loop must classify the failure and apply a DIFFERENT fix strategy. If attempt 1 failed with a type error fix, attempt 2 must try a different approach (e.g., restructure the function signature, not just change the annotation).
- **Reverting too eagerly:** Self-heal first (3 attempts). Only revert after the 3rd failure. Premature revert wastes working code.
- **Reverting too broadly:** `git checkout -- .` reverts everything. After the 3rd failure, only the current group's files should be reverted. Use the file ownership list from `component-map.md` to scope the revert: `git checkout -- {file1} {file2} ...`
- **Ignoring failure log patterns:** Check `failures.md` for recurring patterns BEFORE spawning the generator. If the same error has appeared before, inject the relevant learned rule into the generator prompt proactively.
- **Autonomous drift:** Every code change must trace to a story in the current group. If the generator introduces code that does not map to any acceptance criterion, reject it. No speculative features.
- **No human check-in:** Cap at 50 total iterations. After 50 iterations, stop and present a status report regardless of completion state. Long autonomous runs without human oversight risk compounding errors.
- **Not injecting learned rules:** Every agent prompt must include the full text of all learned rules. This is the most common cause of repeated failures. If you spawn an agent without learned rules, you are guaranteeing a preventable regression.
