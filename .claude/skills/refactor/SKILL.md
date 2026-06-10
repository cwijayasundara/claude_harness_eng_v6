---
name: refactor
description: Refactor existing code for quality, performance, or maintainability. Enforces core quality principles with ratchet gate.
argument-hint: "[file-or-module-path]"
context: fork
---

# Refactor Skill — Quality-Driven Code Improvement

> **Ultracode tip:** A whole-repo `--sweep` is a broad "scan many files, report the conclusion" task — run `/effort ultracode` before it for wider coverage. A **targeted** `/refactor <path>` is narrow and deterministic; leave ultracode off (`/effort high`) for those.

## Usage

```
/refactor src/service/extraction.py
/refactor src/repository/
/refactor --sweep            # whole-repo entropy scan (formerly /lint-drift)
/refactor --sweep --auto-fix # sweep + auto-commit CLEANUP-class items
```

Provide a file path or directory for a **targeted** refactor. Use `--sweep` for a **whole-repo entropy scan** that reports accumulated drift and routes findings back into the per-principle fix flow. The skill analyzes the target against core quality principles, plans the changes, and executes them one principle at a time.

---

## Overview

Refactoring improves the internal structure of existing code without changing its observable behavior. No new features. No behavior changes. Every change must trace to a violation of the core quality principles.

For tiny cleanup that is obviously safe and local (for example one unused import, one typo in a comment, one lint-only change), use `/vibe` instead. Use `/refactor` when the change affects structure, module boundaries, tests, or multiple files.

---

## Drift Sweep Mode (`/refactor --sweep`)

`/refactor <path>` fixes a targeted area. `/refactor --sweep` runs the whole-repo **entropy scan** (this absorbs the former `/lint-drift` skill): it *reports* accumulated drift and routes the findings back into the per-principle fix flow below. Entropy control for agent-generated code — as agents replicate patterns, drift accumulates.

What the sweep scans:
- **Structural drift (from `code-graph.json`, not grep):** orphan/dead files (`fan_in == 0`), layer-violation import directions, unstable hubs, cycles. Run `/code-map` first if the graph is missing or stale; prefer the graph over grep. Always grep for *dynamic* references (`getattr`, registries, `importlib`) before declaring anything dead.
- **Cross-file duplicate logic:** near-identical function bodies across 3+ files → extract a shared utility. This is the sweep's unique signal (neither `code-map` nor a targeted refactor finds it).
- **Principle violations:** file/function length, missing types, bare excepts, hardcoded config. Thresholds are single-sourced in `code-gen/SKILL.md` (do not restate them); the length/type cases are also enforced live by the hooks — the sweep catches what predates them.
- **Test-quality drift:** assert-nothing tests, mocked business logic.

Sweep workflow:
1. Refresh `code-graph.json` (`/code-map`) if missing or stale.
2. Scan files changed since the last sweep (marker `.claude/state/last-drift-scan.txt`, a commit SHA); full scan if no marker.
3. Write `specs/reviews/drift-report.md` — category, `file:line`, suggested fix, severity (CLEANUP / REFACTOR / DEBT).
4. Route REFACTOR-class items through Steps 1–7 below (the ratchet-gated fix). With `--auto-fix`, CLEANUP-class items may be auto-committed — they must pass the full ratchet gate.
5. Record the new scan SHA to `.claude/state/last-drift-scan.txt`.

When to sweep: after every ~5 `/auto` iterations, before a release, or when `learned-rules.md` grows past ~10 rules (pattern-accumulation signal). Do not refactor code outside the current change's scope without recording it as drift first.

---

## Steps

### Step 1 — Read Quality Principles

Read `.claude/skills/code-gen/SKILL.md` in full. Its core quality principles are the refactoring standard. Every change planned in Step 4 must cite a specific principle.

### Step 2 — Analyze Current State

If `specs/brownfield/` exists, read `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md` before analyzing the target. If this is a non-trivial existing codebase and those maps do not exist, recommend `/brownfield` before broad refactoring.

For each file in the target path:

- **Architecture compliance:** does the file import from a layer above it? (see layering rules in `code-gen/references/architecture.md`)
- **Function lengths:** count lines in each function. Flag any over 50 lines.
- **Type coverage:** identify any `any` (TypeScript) or missing type hints (Python). Count unannotated parameters and return types.
- **Test coverage baseline:** run the test suite and record current pass/fail counts and coverage percentage.
- **Dead code:** identify unused imports, unreachable branches, commented-out code.
- **Documentation style:** identify comments that restate the code rather than explaining non-obvious decisions.

Record findings in a structured list before proceeding.

### Step 3 — Identify Violations

Map each finding from Step 2 to one of the core quality principles:
1. Small Modules — file exceeds 300 lines (block) or 200 lines (warning).
2. Static Typing — `any`, missing annotations, untyped domain concepts.
3. Functions Under 50 Lines — function body exceeds 50 lines.
4. Explicit Error Handling — bare `except`, untyped catches, swallowed errors.
5. No Dead Code — unused imports, commented-out code, unreachable branches.
6. Self-Documenting — comments that restate what the code does, not why.
7. Deep Modules — shallow pass-through modules, speculative interfaces, or abstractions with no real hidden behavior.
8. Public Interface Testing — tests coupled to private helpers, internal call order, or mock interactions instead of observable behavior.

Only violations of these principles justify a change. Do not refactor code that complies with the principles.

### Step 4 — Plan Changes with Superpowers

Invoke `superpowers:writing-plans` to produce a structured refactoring plan. This ensures the plan is reviewed before execution and prevents ad-hoc changes that drift from the quality principles.

Produce a written plan before touching any code:

```
File: src/service/extraction.py
Change: Split extract_data() into extract_raw(), validate_schema(), transform_fields()
Principle: #3 — extract_data() is 87 lines
Risk: One caller in api/routes.py — update import after split

File: src/service/extraction.py
Change: Add return type annotation to all 4 functions
Principle: #2 — return types missing
Risk: None
```

List every file, what will change, which principle it violates, and any known call-site impact.

### Step 5 — Execute One Principle at a Time

Apply changes for one principle across all affected files. Then run the test suite. Then proceed to the next principle.

Order of execution:
1. Static typing (lowest risk, foundation for other changes)
2. Dead code removal
3. Public-interface test repairs or characterization tests
4. Function decomposition
5. Deepening modules or removing shallow pass-through abstractions
6. Module splitting (if needed)
7. Error handling
8. Self-documenting cleanup

After each principle: run tests, run lint, run type checks. If anything breaks, fix it before moving to the next principle.

### Step 6 — Spawn clean-code-reviewer

After all changes are complete, spawn the `clean-code-reviewer` agent (plugin-provided; recognized by the `review-on-stop` Stop hook) on the full diff.

The reviewer will return findings at three severity levels:
- **BLOCK** — must fix before this refactor is considered complete.
- **WARN** — should fix; document if deferring.
- **INFO** — optional improvement.

### Step 7 — Fix BLOCK Findings

Address every BLOCK finding. Re-run the reviewer after each fix cycle. Maximum 3 retry cycles.

If BLOCK findings remain after 3 cycles, stop and report the unresolved issues. Do not ship code with unresolved BLOCK findings.

---

## Non-Negotiable Rules

- **Tests must pass after every change.** If a refactor breaks a test, fix the code — not the test.
- **No behavior changes.** The refactored code must produce identical outputs for all existing inputs.
- **No new features.** If you identify a missing capability, open a story and use `/change`.
- **Every change traces to a principle.** If you cannot cite which principle a change addresses, do not make the change.
- **Update all call sites.** When renaming or moving a symbol, update every import and reference before committing.
- **Do not add fake abstractions.** If an interface has one implementation and no clear external boundary or domain seam, keep the code concrete.

---

## Output

The target path contains refactored code that:
- Passes the full test suite.
- Has no new lint or type errors.
- Has no BLOCK findings from the code reviewer.
- Has coverage equal to or better than the baseline recorded in Step 2.

---

## Gotchas

- **Refactoring without tests.** If the target code has no tests, write characterization tests before refactoring. Refactoring untested code silently introduces regressions.
- **Big-bang changes.** Applying all principles at once makes failures hard to diagnose. Execute one principle at a time.
- **Renaming without updating imports.** A renamed function that is still referenced by its old name will fail at runtime, not compile time in Python. Search all call sites.
- **Breaking layering while splitting modules.** When extracting a new file, verify it does not introduce an upward dependency.
- **Deleting "unused" code that is used dynamically.** Python's `getattr`, decorator registries, and plugin systems reference symbols by string. Verify with a project-wide search before deleting.
