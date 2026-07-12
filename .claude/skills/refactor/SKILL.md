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
/refactor --mechanical       # bulk mechanical transform via specs/migrate/ (Bun Phase B)
```

Provide a file path or directory for a **targeted** refactor. Use `--sweep` for a **whole-repo entropy scan** that reports accumulated drift and routes findings back into the per-principle fix flow. Use **`--mechanical`** for a large pattern→pattern transform (port, framework swap, monorepo split) driven by `specs/migrate/` mapping artifacts — not for principle-by-principle cleanup. The skill analyzes the target against core quality principles, plans the changes, and executes them one principle at a time (except `--mechanical`, which follows the migrate flow below).

---

## Overview

Refactoring improves the internal structure of existing code without changing its observable behavior. No new features. No behavior changes. Every change must trace to a violation of the core quality principles.

For tiny cleanup that is obviously safe and local (for example one unused import, one typo in a comment, one lint-only change), use `/vibe` instead. Use `/refactor` when the change affects structure, module boundaries, tests, or multiple files.

---

## Mechanical Migrate Mode (`/refactor --mechanical`)

For **bulk faithful transforms** (language port, framework upgrade call-sites, monorepo split) where the behaviour oracle is the existing suite — not a new product feature.

1. **Ensure `specs/migrate/` exists.** If missing, copy templates from `.claude/templates/migrate/` (`README.md`, `MAPPING.md`, `CONSTRAINTS.tsv`, `CANARY.md`) into `specs/migrate/`.
2. **Draft or load `MAPPING.md`** (and optional `CONSTRAINTS.tsv`). Do not fan out code until the mapping is specific enough that two independent readers would make the same mechanical choice.
3. **Adversarially review the mapping** (not the whole tree): spawn two independent `code-reviewer` instances on `specs/migrate/MAPPING.md` (+ `CONSTRAINTS.tsv` if present) with fresh context; merge with `merge-review-verdicts.js --policy union` if both produce verdict JSON, or require a human ack for high-risk ports. Fix mapping conflicts before any production edit.
4. **Canary always:** apply the transform to **3 files** (or the smallest representative sample), run tests/lint/types, record results in `specs/migrate/CANARY.md`. A canary failure revises the mapping — do not extend a broken pattern.
5. **Fan-out** only after canary pass, under file ownership / ownership map when present. Prefer `fix-from-diagnostics` when the fan-out produces a large type/lint wall.
6. **Oracle:** G31 still applies — do not delete or skip tests to green the suite. Prefer dual adversarial review on large diffs (`review-tier.js`).
7. **Semantic divergence:** instruct every `code-reviewer` spawn to apply `.claude/skills/code-gen/references/semantic-divergence.md` (assert side effects, rounding, bounds, Drop/defer, placeholder constants). Record open hazards in `MAPPING.md` → Semantic divergence watchlist.
8. **Commits:** keep mapping/canary commits separate from bulk code when practical (`keeping-refactors-pure` when behaviour is unchanged). Prefer review-attributed subjects after dual review:
   ```bash
   git commit -m "$(node .claude/scripts/review-commit-msg.js --subject 'port: canary batch' --from-audit specs/reviews/adversarial-review-audit.json)"
   ```

This mode is **not** `/build` or `/sprint`. If the work needs new product behaviour, use `/change` or `/feature` instead.

---

## Drift Sweep Mode (`/refactor --sweep`)

`/refactor <path>` fixes a targeted area. `/refactor --sweep` runs the whole-repo **entropy scan** (this absorbs the former `/lint-drift` skill): it *reports* accumulated drift and routes the findings back into the per-principle fix flow below. Entropy control for agent-generated code — as agents replicate patterns, drift accumulates.

What the sweep scans:
- **Structural drift (from `code-graph.json`, not grep):** orphan/dead files (`fan_in == 0`), layer-violation import directions, unstable hubs, cycles. Run `/code-map` first if the graph is missing or stale (stale = `.claude/state/graph-dirty.jsonl` non-empty — the `graph-refresh` Stop hook normally drains it); prefer the graph over grep. Always grep for *dynamic* references (`getattr`, registries, `importlib`) before declaring anything dead.
- **Cross-file duplicate logic:** near-identical function bodies across 3+ files → extract a shared utility. This is the sweep's unique signal (neither `code-map` nor a targeted refactor finds it).
- **Principle violations:** file/function length, missing types, bare excepts, hardcoded config. Thresholds are single-sourced in `code-gen/SKILL.md` (do not restate them); the length/type cases are also enforced live by the hooks — the sweep catches what predates them.
- **Test-quality drift:** assert-nothing tests, mocked business logic.

Sweep workflow:
1. Refresh `code-graph.json` (`/code-map`) if missing or stale.
2. Scan files changed since the last sweep (marker `.claude/state/last-drift-scan.txt`, a commit SHA); full scan if no marker.
3. Write `specs/reviews/drift-report.md` — category, `file:line`, suggested fix, severity (CLEANUP / REFACTOR / DEBT).
4. Route REFACTOR-class items through Steps 1–8 below (the ratchet-gated fix). With `--auto-fix`, CLEANUP-class items may be auto-committed — they must pass the full ratchet gate.
5. Record the new scan SHA to `.claude/state/last-drift-scan.txt`.

When to sweep: after every ~5 `/auto` iterations, before a release, or when `learned-rules.md` grows past ~10 rules (pattern-accumulation signal). Do not refactor code outside the current change's scope without recording it as drift first.

---

## Steps

### Step 1 — Read Quality Principles

Read `.claude/skills/code-gen/SKILL.md` in full. Its core quality principles are the refactoring standard. Every change planned in Step 4 must cite a specific principle.

### Step 2 — Analyze Current State

**Context-first (Iron Law) — REQUIRED when `specs/brownfield/code-graph.json` exists and is not a placeholder.** Before broad source reads or unconstrained search over the target:

```bash
node .claude/scripts/context-pack.js --diff --budget 1600 "<refactor goal or target path>"
# blast radius for renames/moves (when you have a node id or path):
node .claude/skills/code-map/scripts/code_wiki.js query --graph specs/brownfield/code-graph.json --callers <id>
```

Read only pack `read_next` ranges (and skeletons + `Read(offset, limit)` for god files). Use `task_map` and caller results as the impact seed. If `confidence` is low / `no_match`, one narrow `rg` then re-pack — do not multi-file explore. If the graph is missing on a non-trivial codebase, recommend `/brownfield` before broad refactoring.

If maps exist and pack confidence is low, optionally read `architecture-map.md`, `risk-map.md`, or `change-strategy.md` — do not front-load every essay when the pack is high-confidence. Locate symbols via pack ranges first, then `symbol-map.md` (`Lstart-Lend`); for files flagged in `skeletons/`, read the `.skel.md` and then only the relevant symbol slice with `Read(offset, limit)` instead of the whole file.

**Coverage preflight — REQUIRED SUB-SKILL: `checking-coverage-before-change`** for every symbol in the target path before the first edit. COVERED symbols give you the regression oracle to run after each step; UNCOVERED symbols route to `pinning-down-behavior` (or `sprouting-instead-of-editing`) before any in-place edit.

**Migration preflight — REQUIRED SUB-SKILL: `checking-migration-safety`** if the refactor touches ORM models or schema files (e.g. renaming a model field). A behavior-preserving refactor that requires a schema migration is two deployables, not one commit.

**Canvas sync preflight:** if `specs/design/reasons-canvas.md` exists and the refactor moves, renames, splits, deletes, or creates governed source files, update the Canvas `Operations` and `Governs` sections before the refactor is considered complete. After the file movement/change, run `npm run canvas-sync`; a mismatch is a **hard-block** because a refactor must not leave the living design pointing at stale paths.

For each file in the target path:

- **Architecture compliance:** does the file import from a layer above it? (see layering rules in `code-gen/references/architecture.md`)
- **Function lengths:** count lines in each function. Flag any over 30 lines (the pre-write-gate hook limit).
- **Type coverage:** identify any `any` (TypeScript) or missing type hints (Python). Count unannotated parameters and return types.
- **Test coverage baseline:** run the test suite and record current pass/fail counts and coverage percentage.
- **Dead code:** identify unused imports, unreachable branches, commented-out code.
- **Documentation style:** identify comments that restate the code rather than explaining non-obvious decisions.

Record findings in a structured list before proceeding.

### Step 3 — Identify Violations

Map each finding from Step 2 to one of the core quality principles:
1. Small Modules — file exceeds 300 lines (block) or 200 lines (warning).
2. Static Typing — `any`, missing annotations, untyped domain concepts.
3. Functions Under 30 Lines — function body exceeds 30 lines.
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

**Canary a large mechanical fix first.** When a single principle's fix spans more than ~10 files (typical of a `--sweep --auto-fix` batch, or a large targeted refactor), apply it to a small trial batch — 3 files, or the smallest representative sample — and run tests, lint, and type checks on that batch before extending the same mechanical edit to the rest. A canary failure is a fast, cheap signal about the mechanical pattern itself; discovering the same defect after applying it to all N files means bisecting after the fact. Skip this for small batches (~10 files or fewer) — the canary's overhead isn't worth it.

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

When committing, follow **`keeping-refactors-pure`**: commit with `HARNESS_COMMIT_KIND=refactor git commit …` — the pre-commit hook then blocks any staged test/snapshot edits (a pure refactor leaves them byte-identical). Any behavioral fix discovered en route goes in a separate behavior commit.

### Step 6 — Mechanical Cleanup Pass (native `/simplify`)

After the principle-driven refactor is complete and the suite is green (Step 5), run Claude Code's native **`/simplify`** over the refactor's changed files to catch mechanical cleanups the manual pass missed — duplicate logic that should reuse a helper, redundant branches, needless intermediate variables, altitude/efficiency tweaks. Native `/simplify` *applies* the kind of fix the harness reviewers only *report*, so it is genuinely additive — not a duplicate of `code-reviewer`, which owns the structural / SOLID / module-depth judgment `/simplify` does not do.

Fence it with the same behavior-preservation discipline as the rest of this skill:

1. **Green precondition.** Only run with a passing suite — `/simplify` is quality-only (it does not hunt bugs) and assumes already-correct code.
2. **Scope to the diff.** `/simplify` operates on the changed code; do not let it wander outside the refactor's target path. Reject any edit to a file the refactor did not already touch.
3. **Re-verify.** Re-run tests, lint, and type checks after. If `/simplify` turns a test red, that edit was not behavior-preserving — revert that specific change, never the test.
4. **Pure-refactor commit.** Commit under **`keeping-refactors-pure`** (`HARNESS_COMMIT_KIND=refactor`). The pre-commit hook blocks staged test edits, so a cleanup that quietly rewrites a test is caught automatically.

Skip this step when the refactor's entire purpose *was* a single mechanical change `/simplify` would itself propose — there is nothing left to clean.

### Step 7 — Spawn code-reviewer

After all changes are complete, spawn the `code-reviewer` agent (harness-provided: `.claude/agents/code-reviewer.md`) on the full diff. Native `/simplify` (Step 6) already absorbed the mechanical cleanups; the reviewer now judges **structure** — SOLID, module depth, abstraction quality, public-interface testing — which `/simplify` does not touch.

The reviewer will return findings at three severity levels:
- **BLOCK** — must fix before this refactor is considered complete.
- **WARN** — should fix; document if deferring.
- **INFO** — optional improvement.

### Step 8 — Fix BLOCK Findings

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
