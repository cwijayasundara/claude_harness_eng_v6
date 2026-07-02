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
/auto --once
/auto --pod 3
/auto --single-pr
```

- `--mode` controls which ratchet gates are enforced. Default: `full`. Options: `full`, `lean` (`lean` skips only the per-iteration design-critic).
- `--group` resumes or targets a specific dependency group. If omitted, picks the next unfinished group from the dependency graph.
- `--parallel-groups N` enables cross-group parallelism: up to N independent dependency groups run concurrently as separate group-orchestrator subagents. Default: `3`. Set `1` (or pass `--sequential`) to force one-group-at-a-time behavior.
- `--sequential` shorthand for `--parallel-groups 1`. Use when you need deterministic group ordering for debugging.
- `--once` — **single-wave mode** for cross-process chaining: run exactly **one** wave (the next ready group, or up to `--parallel-groups N` ready groups), take it through all ratchet gates, commit, append the session block to `claude-progress.txt`, then **exit cleanly without looping to the next wave**. The driver (`.claude/scripts/build-chain.js`) re-spawns a fresh `claude -p` for the next wave. Use `--once --sequential` to shrink a link to a single group when a full wave is too large to finish under the per-link timeout.
- `--pod N` — **pod mode**: cross-group concurrency (implies `--parallel-groups N`, default `3`). PR granularity is decided automatically by `.claude/scripts/wave-plan.js` (`pr_mode`): when more than one cluster is unfinished, each cluster raises its **own stacked draft PR** instead of rolling its branch up to the trunk; a single remaining cluster (or `--single-pr`) yields one integrated PR. Each cluster is verified per-cluster (the Phase 9.5 deploy→API→E2E→fix ladder, scoped to that cluster). Dependent clusters **stack on their predecessor's branch** — they do **not** wait for any PR to merge. See Section 4B → *Pod mode*. Surfaced by `/build --autonomous --pod N`; `--single-pr` forces one integrated PR.
- `--single-pr` — forces **one integrated PR** regardless of cluster count. When `/auto` is invoked with `--single-pr`, it automatically passes the flag through to `.claude/scripts/wave-plan.js` so `pr_mode` resolves to `integrated` — even when multiple clusters are unfinished. In that case the parent merges all group branches into the trunk after the wave and opens a single PR, exactly as non-pod mode does. Overrides the per-cluster PR default. Takes effect ALWAYS — `/build path/to/prd.md --autonomous --pod 3 --single-pr` gives pod concurrency (up to 3 parallel clusters) but ONE integrated PR at the end.

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

### Long-run autonomy & grounded progress

`/auto` is an autonomous, multi-context-window loop. These rules keep it honest and unblocked over long runs (they matter most on the most capable orchestrator models, which sustain hours-long runs):

- **Ground every progress claim in evidence.** Before reporting that a group passed, a gate cleared, or tests are green, point to the actual tool result from this session that proves it — the evaluator verdict file, the test exit code, the `*-grounding.json`. Never report work you cannot point to; if something is not yet verified, say so explicitly. If tests failed, say so with the output; if a step was skipped, say that. This is the same groundedness discipline the pipeline enforces on artifacts, applied to the loop's own status.
- **Do not stop early on context-budget concern.** The context window compacts (or you start a fresh window from `claude-progress.txt`, `features.json`, and git state) — you can continue indefinitely. Do not summarize-and-hand-off or suggest a new session because tokens look low; save state to `claude-progress.txt` and keep going.
- **Proceed on reversible actions; pause only for genuine checkpoints.** Editing files, running tests, and committing to the work branch follow from the build goal — do them without asking. Pause and end the turn only for a truly destructive or irreversible action, a real scope change beyond the approved stories, or input only the human can provide. Do not end a turn on a promise ("I'll now run the evaluator…") — issue the tool call and do the work now.
- **Give subagents the full task spec up front.** When spawning generator/evaluator/design-critic agents, put the complete story context, acceptance criteria, and constraints in the first prompt rather than dripping them across turns — well-specified delegation is what makes the autonomous loop efficient.

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
3. **`claude-progress.txt`** — Read the LAST session block (the block after the final `=== Session` marker). Extract: `current_group`, `groups_completed`, `groups_remaining`, `last_commit`, `next_action`. If the file does not exist (`/auto` invoked standalone, without `/build`), create it now with a Session 0 block in the SECTION 10 format before reading.
4. **`features.json`** — Current pass/fail state for all features. Determines what work remains.
5. **`specs/stories/dependency-graph.md`** — Compute the current wave (Section 4B Wave Selection Algorithm). A group is "unfinished" if any of its stories' features are not passing in `features.json`. Respect dependency ordering: do not start a group whose upstream dependencies have failing features. With `--sequential` (or `--parallel-groups 1`), the wave is the single next unfinished group; with default `--parallel-groups 3`, the wave is up to 3 concurrently-ready groups.
6. **Target group story files** — Verify every story in every selected group is marked `Readiness: ready`. If any story is `needs_breakdown`, stop and request a story decomposition pass before implementation.

If `claude-progress.txt` indicates a `current_group` (or `current_wave`) that is not yet complete, resume from there. Otherwise, compute a fresh wave per Section 4B.

**First context window vs continuation — do the matching preflight.** The *first* window of a build initializes; *later* windows recover-and-execute. They are not the same job, so do not run identical logic on window 1 and window N. Decide which window you are in from the state you just read, and run its preflight before selecting work:

- **First window** — only a Session 0 block exists (no `=== Session N ===` with N ≥ 1), `groups_completed: []`, and `current_group: none`. Before computing the first wave, confirm the initializer left a coherent project: `features.json` is a populated feature array (not the empty `[]` seed), `init.sh` exists and is executable, and the SECTION 1 `specs/` prerequisites are present. If any is absent, stop and report exactly what the initializer left undone — do not build against a half-scaffolded project.
- **Continuation window** — any later window. Run the startup smoke check below, then resume from the last block's `current_group` / `next_action`.

**Startup smoke check on resume — catch undocumented bugs before building on them.** The first time you reach SECTION 2 in this process *and* there is prior committed work to boot against (`groups_completed` non-empty or an in-flight `current_group`), boot the app and confirm it is healthy **before** selecting work. A prior window may have been killed mid-group, leaving a broken or half-built tree that the append-only log never recorded; booting first turns that into an explicit infrastructure failure rather than a confusing build error three steps later. Boot it the way the evaluator does (`project-manifest.json#verification.mode`) and run the evaluator's **Health-Check Retry** loop (`.claude/agents/evaluator.md`). Keep the noise out of the orchestrator context: redirect boot output to `.claude/state/smoke-boot.log` and surface only the verdict. On failure, `tail -n 50 .claude/state/smoke-boot.log`, treat it as `failure_layer: "infrastructure"`, and route to the SECTION 6 self-healing loop instead of starting new work. Skip the check on the first window (nothing is built yet) and on later in-process iterations (the previous iteration's PASS already booted the app).

**Budget metering.** If `.claude/state/budget-start` does not exist, create it now with the current epoch-ms (`node -e 'process.stdout.write(String(Date.now()))' > .claude/state/budget-start` — portable; do **not** use `date +%s%3N`, which is GNU-only and on macOS/BSD writes a malformed `…N`-suffixed value) — this stamps the run origin so wall-clock metering has a start (`/build` Phase 4 already stamps it; this covers standalone `/auto`). Then read the live budget with `node .claude/scripts/budget-state.js` and honor the result per SECTION 11 criterion 1 — if it reports `[exhausted]`, stop at this iteration boundary before dispatching the group. A `warn` band is non-blocking: note it in the iteration log and keep building.

---

## SECTION 3: Sprint Contract Negotiation (Steps 2-3)

Sprint contracts define the verifiable done-criteria for a group. Two-step propose-approve process using generator and evaluator agents.

### Step 2 — Generator Proposes Contract

Spawn generator as a subagent with this prompt:

> Read stories [list IDs for this group], `specs/design/api-contracts.md`, `specs/design/component-map.md`, and `specs/test_artefacts/verification-matrix.json`. Propose a sprint contract for group {ID}. Include: api_checks, playwright_checks, design_checks, architecture_checks, features list. Every runtime check must carry the `matrix_ids` it verifies. Populate `architecture_checks.files_must_exist` with the file paths listed for this group's stories in `specs/design/component-map.md`. Write the contract to `sprint-contracts/{group}.json`.

The generator produces a draft contract based on the story acceptance criteria and the architecture design.

### Step 3 — Evaluator Approves Contract

Spawn evaluator as a subagent with this prompt:

> Read the proposed sprint contract at `sprint-contracts/{group}.json` and `specs/test_artefacts/verification-matrix.json`. Review each check against the story acceptance criteria, API contracts, and matrix obligations. Add any missing checks. Remove any checks that do not trace to an acceptance criterion. Ensure every runtime check carries the `matrix_ids` it verifies. Write the final contract to the same path. Also write an audit of your edits to `specs/reviews/contract-audit-{group}.json`: `{"group": "...", "added": [{"check": ..., "reason": ...}], "removed": [{"check": ..., "reason": ...}]}` — an empty `added`/`removed` means the proposal was accepted as-is.

Rules:
- **No back-and-forth.** The evaluator has final say. The generator does not get to dispute.
- **The edit is not silent.** The orchestrator reads `contract-audit-{group}.json` after negotiation and surfaces it in the progress log (and to the user at the next escalation point). A removal whose `reason` contradicts a story acceptance criterion is grounds to re-run negotiation once with the audit attached — this is the only permitted second cycle.
- **Contract is immutable after negotiation.** Once the evaluator writes the final version, no one edits it — the single permitted exception is the deterministic, additive-only accessibility normalizer (Step 3.5), which may inject a default `accessibility_checks` block for UI stories; it never edits or removes other checks.
- **Validate before it freezes.** After the evaluator writes the final contract, run `node .claude/scripts/validate-contract.js sprint-contracts/{group}.json`, then `node .claude/scripts/verification-matrix-gate.js --phase contract --group "$GROUP_ID"`. A non-zero exit means the contract is structurally malformed or missing required matrix coverage — re-run Step 3 once with the validator output attached. Do not proceed to execution with an invalid contract: on every commit that stages source files during an active sprint group, the pre-commit hook deterministically re-validates the contract's schema shape and — when `specs/test_artefacts/verification-matrix.json` exists — re-runs the verification-matrix `executed` phase, so a malformed contract or missing/stale runtime evidence blocks the commit regardless of whether this step was run.

### Step 3.5 — Default-on accessibility (G12)

After the sprint contract is finalized and validated, run the accessibility normalizer on it:

`node .claude/scripts/contract-accessibility-default.js sprint-contracts/{group}.json`

When the contract has `playwright_checks` (a UI story) and the project has not set `accessibility.enabled:false`, this deterministically injects a default `accessibility_checks` block so the evaluator's axe-core gate runs (Full FAIL / Lean WARN on serious/critical impacts). A contract that already defines `accessibility_checks` is left untouched. This makes accessibility a default for UI work instead of something the generator must remember to request. (In parallel mode, run it per group on each `sprint-contracts/{group}.json`.)

After running the normalizer, re-run `node .claude/scripts/validate-contract.js sprint-contracts/{group}.json` to confirm the (possibly-augmented) contract is still schema-valid before moving to execution.

### Ceremony profile

Read `project-manifest.json#execution.ceremony` (default `full`). At `trimmed`:

- A group containing a **single story** skips sprint decomposition — negotiate the contract (Steps 2–3 above, unchanged) and go straight to implementation with one teammate. Multi-story groups keep the full decomposition regardless of profile.
- The design-critic GAN loop (SECTION 9) caps at **3 iterations** instead of 10.
- Nothing else changes. The evaluator, adaptive review policy, and every deterministic gate run identically in both profiles — ceremony trims coordination overhead, never verification.

When a new model generation lands, re-baseline the profile per `docs/adaptive-ceremony.md` instead of carrying forward last generation's settings.

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
- If the story edits pre-existing (non-sprint-new) symbols and `specs/brownfield/code-graph.json` exists: run `checking-coverage-before-change` on those symbols before the first edit; UNCOVERED routes through `pinning-down-behavior` / `sprouting-instead-of-editing`

### Model Tiering

Roles are assigned by **capability tier**, not a specific model — no prompt in this harness assumes which model it is running on (see `docs/prompting-standards.md` → "Model-agnostic by construction").

| Role | Tier | Rationale |
|------|------|-----------|
| `/auto` orchestrator | top-capability | Judgment, architectural decisions |
| Evaluator | top-capability | Skeptical verification |
| Design critic | top-capability | Subjective visual judgment |
| Generator lead | cost-efficient | Coordination, lower cost |
| Generator teammates | cost-efficient | Mechanical implementation |
| Security reviewer | top-capability | Contextual vuln reasoning + adversarial find-then-refute |

- **top-capability** = Opus 4.8.
- **cost-efficient** = Sonnet 4.6.

The orchestrator runs on the **session model** (whatever `/model` is set to — Opus 4.8). Subagent models are pinned per agent in `.claude/agents/<name>.md` frontmatter (`model:`), stamped from the cost-posture preset in `project-manifest.json` → `execution.model_tier` (default `balanced`):

- **cost** — Sonnet generation, Opus judgment.
- **balanced** (default) — identical pins to `cost` today (top tier is a single model, Opus 4.8); kept as a distinct posture name for per-project re-tuning.
- **max-quality** — generation bumped to Opus 4.8; everything else already Opus, codebase-explorer stays Sonnet.

Re-stamp after editing the manifest: `node .claude/scripts/model-tier.js <preset> --apply .claude/agents`. Full rationale + decision rule: `docs/model-allocation.md`.

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
| Peak total subagents | 18 (3 orchestrators + 3×5 teammates) | Gate counts ALL Task subagents including group-orchestrators; 18 fits the documented peak |

If `--parallel-groups N > 3`, accept it but emit a warning to the iteration log. The 3-default is conservative; teams with higher API throughput can raise it.

**Enforced, not advisory.** The concurrency caps above are now backed by a hard
ceiling: the `PreToolUse(Task)` hook `.claude/hooks/concurrency-gate.js` counts
in-flight subagents and **denies** a spawn that would exceed
`max_concurrent_agents` (`project-manifest.json#execution.max_concurrent_agents`
→ env `CLAUDE_MAX_CONCURRENT_AGENTS` → default 18), decrementing on
`SubagentStop`. The gate counts **ALL** Task subagents, including the
group-orchestrators themselves (which are also Task spawns). At the documented
3-group × 5-teammate peak that is 3 orchestrators + 15 teammates = 18 concurrent
subagents — the default of 18 accommodates that peak without throttling. Below
the default, or with a tighter configured cap, spawns past the ceiling receive
**backpressure, not a failure** — wait for in-flight subagents to finish, then
retry; do not treat backpressure as a ratchet failure. The gate fails open (a
gate error never blocks spawns) and TTL-prunes a leaked count.

### Pod mode (`--pod N`) — per-cluster PRs

Pod mode keeps everything above (wave selection, branch isolation, state coordination, concurrency caps) and changes **only the wave's terminal step**: instead of the parent merging group branches into `WAVE_BASE`, **each cluster raises its own draft PR**. The architect (planning + parent) hands each independent cluster to an "engineer" (group-orchestrator) that delivers a reviewable PR — matching how a real pod assigns clusters to developers.

**What changes vs default cross-group:**

1. **Per-cluster verification before the PR.** After a group's ratchet gate passes, the group-orchestrator runs the **Phase 9.5 pre-PR ladder scoped to its cluster** — deploy locally → API tests (if the cluster touches an API) → Playwright E2E (if it touches UI) → bounded defect-repair loop. A cluster that can't go green within the repair budget does **not** open a PR; it returns failed, exactly like a ratchet failure.
2. **Each engineer opens its own draft PR.** A green group-orchestrator pushes `auto/group-{G}` and opens the stacked draft PR via `wave-pr.js` using the cluster's computed `base` from `wave-plan.js`; body = the cluster's stories + the Phase 9.5 proof + Forbidden-Actions check. It returns the PR URL in its summary. It does **not** merge and does **not** roll up to the trunk.
3. **The parent does NOT merge branches and does NOT wait for merges.** Run
   `node .claude/scripts/wave-plan.js` (if `/auto` was invoked with `--single-pr`,
   pass it through automatically — `wave-plan.js --single-pr` — so `pr_mode` resolves
   to `integrated` regardless of cluster count; this is automatic, not manual) to get
   the deterministic plan: `pr_mode` and, per group, its `branch`, `base`, and
   `mergeIn`. For each cluster `G` in the wave (injecting its computed `base` and `mergeIn` list from the plan directly into the group-orchestrator's spawn prompt, so the subagent uses the planner's values verbatim and does not recompute them):
   - create the cluster's `branch` (`auto/group-{G}`) from its computed `base`: a **root** cluster branches from `main`; a **single-parent** cluster branches from its predecessor's branch — a stacked PR whose `base` is `auto/group-{predecessor}`; a **diamond-join** cluster branches from `main`, then merges each `mergeIn` branch in locally so it builds against all upstream code;
   - on green, open the stacked PR with
     `node .claude/scripts/wave-pr.js --branch auto/group-{G} --base <base> --title "<cluster title>" --body "<stories + Phase 9.5 proof + Forbidden-Actions check; for a mergeIn group, list the predecessor PRs as dependencies>"`.
   Then roll up per-group *state* as usual and **compute the next wave immediately** —
   dependent clusters build on their predecessor's *branch*, never on a merged trunk.
   Humans merge the stack bottom-up; GitHub auto-retargets each child PR to `main`
   as its parent merges. If `pr_mode` is `integrated`, skip per-cluster PRs and roll
   the wave up to the trunk exactly as non-pod mode does.
4. **Conflict avoidance is structural.** Independent clusters in one wave have **disjoint file ownership** (from `component-map.md`): each cluster owns a non-overlapping set of files, so their PRs don't collide regardless of which branch each one starts from. Root clusters branch from `main`; dependent clusters stack on their predecessor's branch — clusters in one wave can have different computed bases. Cross-cutting/shared files (routing, config, schema) live in **foundation clusters that land in earlier waves** (per `/spec` ordering) so no two concurrent engineers edit a shared file. This is the defense against the ~23% parallel-agent merge-conflict rate.

**Group-orchestrator spawn protocol — pod addendum.** In pod mode, append to the spawn prompt's mandatory steps (after the existing step 5 "commit to branch"):

```
5a. [POD MODE] Run the Phase 9.5 pre-PR ladder for THIS cluster only: deploy locally,
    run API tests if your cluster exposes an API, run Playwright E2E if it has UI,
    and repair defects (fix implementation, not tests) up to the attempt cap. If it
    cannot go green, return passes=false — do NOT open a PR.
5b. [POD MODE] On green, push auto/group-{G} and open the stacked draft PR with
    `node .claude/scripts/wave-pr.js --branch auto/group-{G} --base <base from wave-plan.js>
    --title "<cluster title>" --body "stories + Phase 9.5 proof + Forbidden-Actions check"`.
    Do NOT merge. Add "pr_url" to your returned summary.
```

**Failure handling addendum (pod):** a cluster whose Phase 9.5 ladder fails is treated as a wave failure — no PR opened, branch preserved, retry via `/auto --group {G} --pod`. A cluster whose PR opens but whose merge is rejected by review blocks only its *dependents*; independent later clusters proceed.

---

## SECTION 5: Ratchet Gate (Step 5)

After the agent team completes, run the ratchet gate. The ratchet is monotonic: progress never regresses. Eight sub-gates, mode-dependent:

| Gate | Full | Lean |
|------|------|------|
| 1. Unit tests (pytest, vitest) | Yes | Yes |
| 2. Lint + types (ruff, mypy, tsc) | Yes | Yes |
| 3. Coverage >= baseline + mutation-smoke (test adequacy) | Yes | Yes |
| 4. Architecture (files exist, schema validation) | Yes | Yes |
| 5. Evaluator (API + Playwright vs running Docker) | Yes | Yes |
| 6. Design critic (vision scoring, GAN loop) | Yes | No |
| 7. Adaptive security review (security-reviewer only on security/data/API boundary, block on critical/high) | Yes | Yes |
| 8. Fresh-context diff review (diff-reviewer, block on correctness defects) | Yes | Yes |

**Lean** differs from **Full** only at Gate 6: it does **not** run the design-critic vision loop at all. Every other gate — including the Gate 7 adaptive security policy, Gate 8 diff review, and the Gate 5 evaluator — runs in both modes. There is no mode that skips the evaluator, and there is no mode that can silently bypass a required security review; that is the whole point of the ratchet.

### Fast Lane (trivial commits)

The Fast Lane is a per-*commit* optimization (not an execution mode): for a commit that introduces no production logic, skip the expensive **gates 4, 5, and 6** (architecture, evaluator, design-critic). It applies to commits that ONLY contain:
- Lint/format fixes (ruff auto-fix, eslint --fix)
- Documentation updates (.md files only)
- Type annotation fixes (no logic changes)
- Learned-rules updates

**Gates 1, 2, 3, and 7 still run** — tests, lint/types, coverage, **and the adaptive security policy**. On docs/config-only changes the policy records `security_review: skipped_no_boundary`; if a "trivial" commit quietly touches a secret, auth, API, persistence, or env boundary, security review is required and a missing verdict blocks.

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

**Per-diff coverage (catches dark code the repo-wide average hides).** The repo-wide number can rise while this group ships a large untested surface, as long as other files carry the average. So in addition to the ratchet, measure coverage over **only the files this group changed**. Emit a machine-readable coverage summary (`pytest --cov --cov-report=json:coverage.json`, or Istanbul/vitest `--coverage --coverage-reporter=json-summary`), then:

```bash
node .claude/scripts/coverage-diff.js \
  --coverage coverage.json \
  --diff-base "$(git merge-base HEAD main)" \
  --floor "${HARNESS_DIFF_COVERAGE_FLOOR:-80}" \
  --history .claude/state/coverage-history.jsonl \
  --label "$GROUP_ID"
```

Exit 1 (per-diff coverage below the floor) **FAILS the gate** even when the repo-wide ratchet passes; a group with no measurable changed files passes (nothing to measure). The per-diff floor defaults to 80% and is overridable via `project-manifest.json#execution.diff_coverage_floor` (or the `HARNESS_DIFF_COVERAGE_FLOOR` env). Each run appends a record to `coverage-history.jsonl` for trend visibility.

**Coverage policy (ref: "AI is forcing us to write good code" by Steve Krenzel):**
- **Floor: 80%.** No commit may drop below this — repo-wide AND on the group's diff. The ratchet gate BLOCKS.
- **Target: 100%.** Every line the agent wrote must be verified by a test. At 100%, any uncovered line is an unambiguous signal of missing verification.
- **TDD enforced:** Tests are written BEFORE implementation. The generator and teammates must follow the red-green-refactor cycle: write failing test → implement → verify pass → commit.

**Mutation smoke — does the suite actually *bite*? (gap G7).** Coverage proves a line ran; it does not prove a test would fail if that line broke. AI-generated suites routinely hit 100% coverage while asserting nothing at the boundary. So the test-adequacy gate also runs a bounded, **diff-scoped** mutation smoke over the group's changed production files:

```bash
node .claude/scripts/mutation-gate.js --staged   # or pass explicit changed files
```

It applies one high-signal operator mutation at a time (`>`↔`>=`, `==`↔`!=`, `&&`↔`||`, boolean literals) to the changed code and re-runs the project test command; a **survivor** is a mutation no test killed — behavior the suite does not verify. Below the threshold (default 0.8 of mutants killed) the gate **BLOCKS**, naming each survivor's file:line and the exact flip so the generator adds the missing boundary/false-branch assertion. The gate is enforced deterministically by the pre-commit hook during `/auto` builds (scoped to an active sprint group; bounded by `--max-mutants`), and is disabled with `HARNESS_MUTATION_GATE=off`. A language whose test command can't be discovered is skipped loudly, never silently passed.

After coverage and mutation gates pass, run:

```bash
node .claude/scripts/verification-matrix-gate.js --phase implementation --group "$GROUP_ID"
```

This blocks if required unit, integration, or E2E trace sidecars are missing for the group's matrix obligations.

### Gate 4 — Architecture Checks

Spawn evaluator to verify `architecture_checks` from the sprint contract:
- All files in `files_must_exist` must be present on disk.
- Schema validation against `specs/design/api-contracts.schema.json` if specified.

Also run the **import-cycle ratchet** (gap G8) when a code-graph exists (it does in brownfield builds; `/code-map` or the graph-refresh hook keeps it fresh):

```bash
node .claude/scripts/cycle-gate.js   # exit 1 if the group ADDED an import cycle
```

Cycles are a monotonic ratchet like coverage — the count may only stay equal or drop. A new cycle **BLOCKS** with the offending cycle named; removing cycles ratchets the baseline (`.claude/state/cycle-baseline.txt`) down. No graph → skipped loudly, never silently passed.

### Gate 5 — Evaluator (API + Playwright)

Spawn evaluator with the full sprint contract. The evaluator runs:
- All `api_checks` against the live Docker stack.
- All `playwright_checks` against the running UI.

The evaluator writes its report to `specs/reviews/evaluator-report.md`.

### Gate 6 — Design Critic (Full Mode Only)

Spawn design-critic on every page listed in the sprint contract's `design_checks`. The critic screenshots each page, scores visual fidelity, and returns PASS/FAIL per check. See SECTION 9 for the full GAN loop if scores are below threshold.

### Gate 7 — Adaptive Security (Full + Lean)

First write `specs/reviews/review-context-pack.md` with the changed files, acceptance criteria, relevant DeepWiki/code-map links, and deterministic test output. Then inspect the changed files for security triggers: auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns.

If a trigger fires, spawn the `security-reviewer` agent against the group's changed files. It writes `specs/reviews/security-verdict.json`. The gate **FAILs** if `security-verdict.json#pass === false` — i.e. any finding whose `severity` is in the contract's `contract.security_checks.block_severities` (default `["critical", "high"]`). Medium/low findings are WARN/INFO and do not fail the gate. A missing selected verdict file is a FAIL (`failure_layer: "security"`). This gate does not need the Docker stack and can run concurrently with Gate 5.

If no trigger fires, do not spawn `security-reviewer`; record `security_review: skipped_no_boundary` in `review-context-pack.md`. This is an explicit policy decision, not a silent skip.

### Gate 8 — Fresh-Context Diff Review (Full + Lean)

Spawn the `diff-reviewer` agent on the group's diff (give it the commit range or branch, acceptance criteria, and `specs/reviews/review-context-pack.md` — nothing else from this session). It reads the diff cold, hunts correctness defects (logic errors, missing edge cases, contract breaks against existing callers), and writes `specs/reviews/diff-review-verdict.json`. The gate **FAILs** on any BLOCK finding or a missing verdict file. Route BLOCK findings to the generator like any other gate failure (max 3 fix cycles). Runs concurrently with Gates 5 and any selected Gate 7 security review — it needs only the repo, not the running app. The reviewer's value comes from its empty context: do not paste progress logs or builder reasoning into its spawn prompt.

### Gate 9 — Executed Matrix Gate

Before entering PASS handling for the group, run:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed --group "$GROUP_ID"
```

This blocks if the group's evaluator report or trace sidecars failed to execute required matrix rows.

### Phase 9.5 — Pre-PR Executed Matrix Gate

Before a Phase 9.5 pre-PR proof or draft PR for one group/cluster, run the
executed matrix gate scoped to that group:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed --group "$GROUP_ID"
```

Before an integrated PR or final completion claim for the whole wave/product,
run the full executed matrix gate:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed
```

This blocks if evaluator execution failed to cover required matrix rows.

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
| Verification matrix | `verification-matrix-verdict.json#pass === false` or missing `matrix_ids` / trace sidecar coverage | Add or execute the missing traced verification, preserving the matrix requirement. Never weaken or remove matrix rows to make the gate pass |

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
   - Revert ONLY this group's files, scoped via the file ownership list in `specs/design/component-map.md`: `git checkout -- {file1} {file2} ...`. Never `git checkout -- .` — in parallel-group mode that discards other groups' in-flight work.
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

### SECTION 10.1: Single-wave mode (`--once`) — cross-process handoff

When invoked with `--once`, `/auto` performs **one** pass of the loop and then stops, instead of iterating until all features pass:

1. Run Context Recovery (SECTION 2) and select the current wave exactly as normal.
2. Execute that one wave through Sprint Contract negotiation, agent-team build, all 8 ratchet gates, and pass/fail handling (SECTIONS 3–6) — unchanged.
3. On a clean wave, **commit** and **append the session block** (SECTION 10 format) — this is the durable checkpoint.
4. Set `next_action` precisely so a fresh process can continue with zero ambiguity:
   - If `features.json` now has every feature passing (or no groups remain): `next_action: DONE — all groups complete` and `groups_remaining: []`.
   - Otherwise: `next_action: CONTINUE — next wave: [<group ids>]` with an accurate `groups_remaining: [...]`.
5. **Exit the turn** — do not loop back to SECTION 2.

This is the voluntary-yield boundary the chain driver relies on: because the process exits cleanly *after* the commit and checkpoint, a per-link timeout/SIGKILL can never land mid-write. Do **not** rely on the `auto-continue-on-stop` hook here — `--once` is driven across processes, not nudged within one; the driver owns re-spawning.

---

## SECTION 11: Stopping Criteria

OR logic with priority (check in order):

1. **Hard stop:** Any of — an architecture violation that self-healing cannot fix; the total iteration count exceeds 50; **or the per-task budget is exhausted** (the wall-clock / agent-spawn / est-cost cap, read at the top of each iteration via `node .claude/scripts/budget-state.js`). Stop the entire `/auto` run **cleanly at this iteration boundary** (never mid-step — committed work is always preserved). For a budget stop, set `next_action: "BUDGET — {dimension} cap reached; raise --budget or merge what's done"` in `claude-progress.txt`; raising the cap (or `--budget off`) resumes the run. Report status and hand off to the user.

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
