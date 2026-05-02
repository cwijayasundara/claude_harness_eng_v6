---
name: lint-drift
description: Scan codebase for pattern drift and generate targeted cleanup PRs. Entropy control for agent-generated code.
context: fork
---

# /lint-drift — Entropy Scanner

Inspired by OpenAI's "garbage collection" pattern: as agents replicate code, patterns drift.
This skill scans for deviations from golden principles and generates targeted refactoring PRs.

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

### 3. Layer Violations (beyond imports)
- Service functions that directly access env vars (should go through config)
- API handlers with business logic (should be in service layer)
- Repository functions with HTTP calls (should be in service)

### 4. Dead Code
- Functions never called (grep for references)
- Imports never used
- Files not imported by anything
- Config values not referenced

### 5. Test Quality Drift
- Tests that only assert truthiness (assert result) without checking values
- Tests with no assertions
- Test files with no test functions
- Mocked business logic (should only mock boundaries)

### 6. Golden Principle Violations
- Files > 200 lines (warn) or > 300 lines (flag)
- Functions > 50 lines
- Missing type annotations
- Bare except/catch blocks
- Hardcoded values that should be config

## Steps

1. Read `.claude/skills/code-gen/SKILL.md` for golden principles
2. Read `.claude/state/learned-rules.md` for project-specific rules
3. Scan source directories for each category above
4. Generate report to `specs/reviews/drift-report.md`:
   - Category, file:line, description, suggested fix
   - Severity: CLEANUP (auto-fixable), REFACTOR (needs thought), DEBT (track)
5. If `--auto-fix`: generate targeted commits for CLEANUP items
6. For REFACTOR items: create GitHub issues or add to backlog

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
