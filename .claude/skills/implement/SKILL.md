---
name: implement
description: Generate production code and tests for a story group using agent teams for parallel execution.
argument-hint: "[group-id]"
context: fork
agent: generator
---

# Implement Skill

Generate production-quality code and tests for all stories in a dependency group, using a Claude Code agent team for parallel execution.

> **Ultracode tip:** Leave ultracode **off** here (`/effort high`). This skill already spawns an agent team for parallel story execution; ultracode's auto-workflows would double-orchestrate and conflict with the per-story contracts.

> **/goal tip (single-story only, optional unattended iteration):** For a focused *single-story* group (Step 6, generator-direct path), Claude Code v2.1.139+ lets `/goal` drive that one bounded session toward a verifiable condition — e.g. `/goal the story's tests pass and lint is clean, or stop after N turns`. Always include the "or stop after N turns" safety clause, and phrase conditions so each turn must produce *fresh* evidence (re-run the tests, show the exit code) to avoid false-positive completion. `/goal`'s evaluator (Haiku) only judges what is in the transcript — it does **not** run tools or read files — so the proof must be printed in the conversation. Because that conflicts with routing verbose output through the parallel teammate subagents of a multi-story group, reserve `/goal` for the single-story lane. Do **not** use `/goal` inside `/auto`: it is single-session and would conflict with session chaining, the GAN evaluator, and sprint contracts. `/goal` does not replace the evaluator/sprint-contract gate.

---

## Usage

```
/implement C
```

Implements all stories in group C. The group ID corresponds to a node in `specs/stories/dependency-graph.md`.

---

## Prerequisites

Before running `/implement`, verify:

- `specs/stories/dependency-graph.md` exists and lists groups with story assignments.
- `specs/design/component-map.md` exists and maps each story to the files it owns.
- All stories in the target group have acceptance criteria written.
- All stories in the target group are marked `Readiness: ready`.
- All upstream groups are already implemented and passing evaluation.

If any prerequisite is missing, stop and report what is absent. Do not proceed with partial context.

---

## Execution Steps

### Step -1 — Load Brownfield Constraints

If `specs/brownfield/` exists, read `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md` before planning. Treat these as implementation constraints:

- Preserve existing public interfaces unless the story explicitly changes them.
- Reuse established modules, framework patterns, and test entry points.
- Escalate if the target path is marked high-risk or requires human approval.
- Navigate via `symbol-map.md` and, for files flagged in `skeletons/`, read only the relevant symbol slice with `Read(offset, limit)` — never whole-file-read a skeleton-flagged file. Pass this instruction into teammate spawn prompts.

### Step 0 — Write Implementation Plan with Superpowers

Before loading code or spawning agents, invoke `superpowers:writing-plans` to produce a structured implementation plan for this group. The plan identifies task decomposition, dependencies, and risk areas. This feeds into the teammate spawn prompts and prevents ad-hoc implementation.

If story metadata, component ownership, or API/data contracts conflict, invoke `.claude/skills/clarify/SKILL.md` before planning implementation. Keep clarification bounded:
- Ask only questions that block implementation or could cause rework.
- Stop at 10 questions by default.
- Continue to 15 only if the user explicitly asks.
- If the uncertainty means a story is not implementable, mark it `needs_breakdown` and stop instead of guessing.

### Step 1 — Load Quality Principles

Read `.claude/skills/code-gen/SKILL.md` in full. Its core quality principles apply to every line of code produced. Inject the full text into every teammate prompt.

Pay particular attention to deep modules and public-interface testing:
- New modules must hide meaningful behavior behind a small interface.
- Do not create pass-through abstractions to satisfy a pattern.
- Tests must enter through public interfaces and survive internal refactors.

### Step 2 — Load Dependency Graph

Read `specs/stories/dependency-graph.md`. Identify:
- Which stories belong to the requested group.
- Which groups must be complete before this group (upstream dependencies).
- The total story count for this group.

For every story in the group, read the corresponding `specs/stories/E{n}-S{n}.md` file and verify:
- `Readiness: ready`
- 3-6 acceptance criteria
- `Layer` is present
- `Group` matches the requested group
- `Depends On` matches the dependency graph

Abort if any story is marked `needs_breakdown`, lacks concrete acceptance criteria, or has metadata that conflicts with the dependency graph. Abort if upstream groups are not yet evaluated as PASS.

### Step 3 — Load Component Map

Read `specs/design/component-map.md`. For each story in the group, extract:
- The list of files the story owns (may create or modify).
- Any shared interface or type files that multiple stories reference.

This ownership map is the single source of truth for file assignments during parallel execution.

### Step 4 — Load Learned Rules

Read `.claude/state/learned-rules.md`. Inject ALL rules verbatim into every teammate spawn prompt. Learned rules include anti-pattern code examples and better approach code — teammates must study these before writing code, not just read the rule text. Rules represent project-specific decisions made during previous sprints (naming conventions, library choices, API patterns). Skipping this step causes regressions.

### Step 5 — Execute the Group via the /auto Team Protocol

The agent-team execution protocol is defined **once**, in `/auto` SECTION 4 (Agent Team Execution) — `.claude/skills/auto/SKILL.md`. Follow it verbatim in **standalone mode** (skip SECTION 3's sprint-contract negotiation): the mandatory team spawn for 2+ story groups (1 teammate per story, max 5 concurrent, batch the remainder), the orchestrator and teammate spawn prompt templates, model tiering, the shared-type dependency handshake, and the spawn-evidence logging to `.claude/state/iteration-log.md`. Do not restate or improvise that protocol here — if this skill and SECTION 4 ever disagree, SECTION 4 wins.

For a **single-story** group, skip the team: use the generator agent directly — present a plan, await approval, write the failing test first, watch it fail, then implement the minimum to pass.

> **Ratchet warning:** `/implement` runs outside the `/auto` loop, so its output bypasses auto's ratchet Gates 1–7 (contract negotiation, evaluator scoring, regression ratchet, security gate). Steps 6–7 below cover validation and clean-code review only. **Run `/evaluate` (or `/review`) on the group after this skill completes** before treating it as merge-ready.

### Step 6 — Validation Gate

After all teammates (or the generator) complete:

1. Run the full test suite: `npm test` or `pytest` (whichever applies to the project).
2. Run the linter: `npm run lint` or `ruff check .`.
3. Run the type checker: `tsc --noEmit` or `mypy .`.

All three must pass with zero errors before proceeding. If any fails, return the failure output to the responsible teammate for a fix, then re-run the validation gate.

### Step 7 — Code Review

Spawn the `clean-code-reviewer` agent (plugin-provided; recognized by the `review-on-stop` Stop hook) on the set of changed files:

- Pass the list of modified files and the story acceptance criteria.
- The reviewer emits findings at three severity levels: **BLOCK**, **WARN**, **INFO**.
- **BLOCK** findings must be fixed. Spawn the responsible teammate to address the finding, re-run tests, re-run the reviewer. Maximum **3 retry cycles**.
- **WARN** findings are logged but do not block merge.
- **INFO** findings are optional improvements.

If the reviewer still emits BLOCK findings after 3 retries, escalate to the user with a summary of the unresolved issues.

---

## Rules

- Every file produced must trace to a story in the current group. No story, no code.
- Tests are written first, against the public interface. No implementation code may be written until the failing test has been observed.
- No speculative code ("might need later"). If it is not in an acceptance criterion, it does not exist.
- No implementation for stories marked `needs_breakdown`. Break the story down and update `specs/stories/`, `dependency-graph.md`, `component-map.md`, and `features.json` first.
- Teammates may not edit files outside their ownership assignment without coordinator approval.
- Plan approval is mandatory before any teammate begins coding. Skipping this step is not a time-saver — it causes conflicts and rework.

---

## Gotchas

- **Teammates editing the same file:** Prevent this with the ownership map. If it happens anyway, stop both teammates, resolve ownership, reconcile changes manually.
- **Skipping plan approval:** Leads to scope creep, missed acceptance criteria, and merge conflicts. Always require the plan step.
- **Deferring test coverage:** Tests are written in the same sprint cycle, not later. "I'll add tests in the next sprint" is not acceptable.
- **Vibe coding without acceptance criteria:** Every function must trace to an acceptance criterion. If the criterion does not exist, do not write the code — write the criterion first.
- **Ignoring learned rules:** Failing to inject `.claude/state/learned-rules.md` recreates decisions the team has already made, causing style and pattern drift.
