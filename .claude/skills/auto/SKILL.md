---
name: auto
description: Autonomous build loop with Karpathy ratcheting, GAN evaluator, and session chaining. Iterates story groups until all features pass or stopping criteria met.
argument-hint: "[--mode full|lean|solo|turbo] [--group GROUP_ID]"
context: fork
---

# Auto Skill

Autonomous build loop implementing Karpathy's ratcheting pattern with GAN-style generator-evaluator separation, agent teams for parallel execution, sprint contracts for verifiable done-criteria, self-healing with failure-driven learning, and session chaining for multi-context-window builds.

---

## SECTION 1: Usage, Prerequisites, and Agent Delegation

### Usage

```
/auto
/auto --mode lean
/auto --mode solo
/auto --group D
```

- `--mode` controls which ratchet gates are enforced. Default: `full`. Options: `full`, `lean`, `solo`, `turbo`.
- `--group` resumes or targets a specific dependency group. If omitted, picks the next unfinished group from the dependency graph.

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

---

## SECTION 2: Context Recovery (Step 1 of Every Iteration)

At the start of EVERY iteration — including the first — read these files in order:

1. **`.claude/program.md`** — Constraints may have changed mid-run. Re-read every iteration. Never cache.
2. **`.claude/state/learned-rules.md`** — Accumulated project rules. Inject verbatim into ALL agent prompts spawned this iteration.
3. **`claude-progress.txt`** — Read the LAST session block (the block after the final `=== Session` marker). Extract: `current_group`, `groups_completed`, `groups_remaining`, `last_commit`, `next_action`.
4. **`features.json`** — Current pass/fail state for all features. Determines what work remains.
5. **`specs/stories/dependency-graph.md`** — Pick the next unfinished group. A group is "unfinished" if any of its stories' features are not passing in `features.json`. Respect dependency ordering: do not start a group whose upstream dependencies have failing features.
6. **Target group story files** — Verify every story in the selected group is marked `Readiness: ready`. If any story is `needs_breakdown`, stop and request a story decomposition pass before implementation.

If `claude-progress.txt` indicates a `current_group` that is not yet complete, resume that group. Otherwise, select the next unfinished group in dependency order.

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
- **Skip in Solo mode.** In Solo mode, the generator works directly without contracts or evaluator verification.

---

## SECTION 4: Agent Team Execution (Step 4)

Spawn the generator agent to create and manage a Claude Code agent team for the current group.

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

### Solo Mode

In Solo mode, the generator works alone sequentially. No team spawning, no phases. Read stories in dependency order and implement one at a time.

### Model Tiering

| Role | Model | Rationale |
|------|-------|-----------|
| `/auto` orchestrator | Opus | Judgment, architectural decisions |
| Evaluator | Opus | Skeptical verification |
| Design critic | Opus | Subjective visual judgment |
| Generator lead | Sonnet | Coordination, lower cost |
| Generator teammates | Sonnet | Mechanical implementation |
| Security reviewer | Sonnet | Pattern matching |

Configure via `project-manifest.json` field `execution.model_tier`.

---

## SECTION 5: Ratchet Gate (Step 5)

After the agent team completes, run the ratchet gate. The ratchet is monotonic: progress never regresses. Six sub-gates, mode-dependent:

| Gate | Full | Lean | Solo | Turbo |
|------|------|------|------|-------|
| 1. Unit tests (pytest, vitest) | Yes | Yes | Yes | Yes (per commit) |
| 2. Lint + types (ruff, mypy, tsc) | Yes | Yes | Yes | Yes (per commit) |
| 3. Coverage >= baseline | Yes | Yes | Yes | Yes (per commit) |
| 4. Architecture (files exist, schema validation) | Yes | Yes | No | Once at end |
| 5. Evaluator (API + Playwright vs running Docker) | Yes | Yes | No | Once at end |
| 6. Design critic (vision scoring, GAN loop) | Yes | No | No | Once at end |

### Turbo Mode (for highly capable models)

For builds using Opus 4.6+ where the model can sustain coherence across long tasks:
- Generator works without story group decomposition — implements all stories sequentially in a single pass
- Sprint contracts NOT negotiated per-group — one contract for the entire build
- Evaluator runs ONCE at the end (not per-group)
- Ratchet gates 1-3 still run after each commit (tests + lint + coverage)
- Design critic runs once at the end
- Significantly cheaper (~$30-50) but less incremental verification

Use when: Model is highly capable AND project is well-specified AND you trust the generator to self-correct.
Do NOT use when: External API integrations, complex multi-service architecture, or first time using the harness.

### Fast Lane (trivial changes)

Skip gates 4-6 (architecture, evaluator, design critic) for commits that ONLY contain:
- Lint/format fixes (ruff auto-fix, eslint --fix)
- Documentation updates (.md files only)
- Type annotation fixes (no logic changes)
- Learned rules updates

Detection: If `git diff --name-only` shows only .md files, or if the commit message starts with `fix: lint` or `docs:`, skip the evaluator. Gates 1-3 (tests + lint + coverage) always run.

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

---

## SECTION 6: PASS/FAIL Handling (Steps 6-7)

### On PASS (All Gates Clear)

Execute these steps in order:

1. **Commit:** `git add -A && git commit -m "feat: implement group {group}"`
2. **Update features.json:** Set `passes: true` for all features in this group's sprint contract.
3. **Update claude-progress.txt:** Append a new session block (see SECTION 10 for format).
4. **Update iteration-log.md:** Append entry with group ID, timestamp, verdict, and summary.
5. **Update coverage-baseline.txt:** Write the new coverage percentage (ratchet up).
6. **Next group:** Return to SECTION 2 (context recovery) for the next iteration.

### On FAIL — Self-Healing Loop (Max 3 Attempts)

Do not immediately revert. Attempt targeted self-healing first.

**Attempt 1-3:**

1. **Diagnose:** Invoke `superpowers:systematic-debugging` to analyze the failure before attempting a fix. This prevents jumping to conclusions and ensures the root cause is identified. Read the evaluator report (`specs/reviews/evaluator-report.md`) for specific failure details. Identify the exact check that failed and the error output.

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
- Lean/Solo/Turbo modes: skip this section entirely

---

## SECTION 10: Session Chaining

`claude-progress.txt` is the memory bridge between context windows. Each iteration appends a new session block.

### Format

```
=== Session {N} ===
date: {ISO 8601}
mode: {full|lean|solo}
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
