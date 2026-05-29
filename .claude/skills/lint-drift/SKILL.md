---
name: lint-drift
description: Scan codebase for pattern drift and generate targeted cleanup PRs. Entropy control for agent-generated code.
context: fork
---

# /lint-drift — Entropy Scanner

Inspired by OpenAI's "garbage collection" pattern: as agents replicate code, patterns drift.
This skill is the **repo-wide, periodic entropy SWEEP that REPORTS** drift; it hands fixes to `/refactor`.

## Relationship to `/refactor` and `/code-map` (no overlap)

- **`/code-map`** produces the deterministic `code-graph.json` (orphans, cycles, unstable hubs, layer import directions). lint-drift **consumes** it — it does not re-derive structure by grep.
- **`/refactor`** owns the *targeted, ratchet-gated fix* of a specific area. lint-drift **does not fix** REFACTOR-class findings — it routes them to `/refactor`.
- **lint-drift's unique niche:** the scheduled, whole-repo sweep and the cross-file *duplicate-logic* detection that neither code-map (structural only) nor refactor (targeted) performs. If a finding is structural, cite `code-graph.json`; if it's a principle threshold, cite `code-gen/SKILL.md` — never restate either here.

## Usage

```
/lint-drift                    # full scan
/lint-drift src/service/       # scan specific directory
/lint-drift --auto-fix         # scan + generate fix PRs
```

## What It Scans For

### 1. Duplicate Logic
- Grep for similar function bodies across files
- Flag when 3+ files have near-identical patterns
- Recommend extracting to shared utility

### 2. Inconsistent Naming
- Check function/class naming follows conventions from code-gen/SKILL.md
- Flag mixed camelCase/snake_case within same language
- Flag inconsistent error class naming

### 3. Layer Violations (from `code-graph.json` import directions)
- Use the graph's layer/import edges to find lower→higher imports (the `check-architecture` hook enforces the import case live; this catches semantic cases the hook can't):
- Service functions that directly access env vars (should go through config)
- API handlers with business logic (should be in service layer)
- Repository functions with HTTP calls (should be in service)

### 4. Dead Code (from `code-graph.json`, not grep)
- **Orphan files** — nodes with `fan_in == 0` in `code-graph.json` (code-map already computes these deterministically). Prefer this signal over grep.
- Functions never referenced / imports never used (LSP find-references or graph edges).
- Config values not referenced.
- Always grep for **dynamic** references (`getattr`, decorator registries, `importlib`, string-keyed dispatch) before declaring anything dead — the graph can't see these.

### 5. Test Quality Drift
- Tests that only assert truthiness (assert result) without checking values
- Tests with no assertions
- Test files with no test functions
- Mocked business logic (should only mock boundaries)

### 6. Golden Principle Violations
Use the thresholds defined in `.claude/skills/code-gen/SKILL.md` as the **single source of truth** — do not hardcode numbers here (they drift from code-gen). The categories: file length, function length, missing type annotations (zero `any`), bare except/catch, and hardcoded values that should be config. The length/typing cases are also enforced live by the `check-file-length`/`check-function-length`/`typecheck` hooks; this sweep catches what predates the hooks or slipped through (e.g. files committed before a threshold change).

## Steps

1. **Refresh the graph:** ensure `code-graph.json` exists and is current (run `/code-map` if missing or stale). Categories 3 (layer violations) and 4 (dead code) read from it deterministically instead of grepping.
2. Read `.claude/skills/code-gen/SKILL.md` for golden principles (the threshold source of truth) and `.claude/state/learned-rules.md` for project-specific rules.
3. Scan for each category — graph-backed where possible (3, 4), grep/LSP for the rest (1, 2, 5, 6). Scope to files changed since the last scan when the marker exists.
4. Generate report to `specs/reviews/drift-report.md`:
   - Category, file:line, description, suggested fix
   - Severity: CLEANUP (auto-fixable), REFACTOR (needs thought), DEBT (track)
5. **Route, don't fix in place:** REFACTOR-class findings go to `/refactor` (which owns the ratchet-gated fix). Only `--auto-fix` CLEANUP-class items are auto-committed, and they must pass the full ratchet gate.
6. Record the scan point to `.claude/state/last-drift-scan.txt` (current commit SHA) so the next run can scope to files changed since.

## When to Run

- After every 5 iterations of /auto (automatic)
- Before creating a PR
- When learned-rules.md grows past 10 rules (pattern accumulation signal)
- Weekly maintenance

## Gotchas

- Don't refactor code you're not working on (scope creep)
- Don't flag pre-existing issues — only scan files changed since last scan
- CLEANUP fixes must pass the full ratchet gate before merging
- Never delete "unused" code without grepping for dynamic references
