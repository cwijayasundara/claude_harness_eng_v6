---
name: checking-coverage-before-change
description: Use when about to edit any existing (non-greenfield) symbol — before the first Edit/Write to production code in /refactor, /change, or /vibe — to learn which tests cover it and route uncovered code to pinning or sprouting. [Internal discipline — applied automatically by pipeline agents mid-task; direct use is a power-user path.]
---

# Checking Coverage Before Change

The preflight router for behavior-preserving change. You cannot protect behavior you cannot observe; the first question before any edit is "which tests will tell me if I break this?"

## The Iron Law

```
NO EDIT TO A SYMBOL UNTIL YOU KNOW WHICH TESTS COVER IT
```

## Process

1. Ensure coverage data exists. Python: `pytest --cov --cov-context=test` (writes `.coverage` with per-test contexts). JS: `nyc --reporter=json` (or Jest `--coverage`, file-level). If data is missing or stale, regenerate. **Under time pressure, scope the regen** — `pytest tests/<area> --cov=<affected.module> --cov-context=test` answers the symbol's verdict in minutes; the Iron Law needs this symbol's verdict, not the whole repo's. A scoped regen is compliance; a skipped one is not.
2. Run the verdict script for every symbol in the planned diff:

```bash
python3 .claude/skills/code-map/scripts/code_index/coverage_map.py \
  --graph specs/brownfield/code-graph.json \
  --coverage .coverage \
  --files <each affected file>
```

3. Route on the verdict:
   - **COVERED** → the listed tests are your **fast regression oracle**. Run exactly them before the change (must pass) and after every edit (must still pass).
   - **UNCOVERED** → STOP. `REQUIRED SUB-SKILL: pinning-down-behavior`. If the symbol is unpinnable (see that skill's threshold), `REQUIRED SUB-SKILL: sprouting-instead-of-editing`.
   - **Exit code 3** (graph has no symbol records — regex-fallback producer, e.g. Java/C#/Go) → symbol verdicts are unavailable. Treat every symbol you plan to edit as UNCOVERED and route accordingly; do not interpret the absence of data as coverage.
4. Record the verdicts in your impact assessment / plan before the first edit.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It's a small change" | Small changes to uncovered code are how regressions ship. The check takes seconds. |
| "The evaluator will catch it later" | The evaluator checks sprint contracts, not the legacy behavior you just altered. |
| "Coverage data is stale, skip it" | Regenerating it is one test run. Stale data is an instruction, not an excuse. |
| "The suite is green, so I'm safe" | Green proves the *covered* code works. The verdict tells you whether yours is. |
| "The deploy pipeline's suite is my backstop" | Only if the verdict proves the suite reaches this symbol. Green without coverage is noise, not a backstop. |
| "I'll honor the Iron Law in substance with something cheaper" | Grepping for test files and manually tracing logic is not a verdict. Violating the letter is violating the spirit — run the script on real (scoped is fine) coverage data. |

## Red Flags — STOP

- About to Edit a production file with no coverage verdict for its symbols
- Treating a file-level coverage % as a symbol-level answer
- Skipping the check because the diff "only touches one function"
- Substituting `grep` for test files in place of a `coverage_map.py` verdict
- Declaring the check "honored in substance" while the script never ran

## Checklist

- [ ] Coverage data fresh (regenerated since last suite-affecting change)
- [ ] Verdict obtained for every symbol in the planned diff
- [ ] COVERED symbols: oracle tests ran green before the first edit
- [ ] UNCOVERED symbols: routed to pinning-down-behavior or sprouting-instead-of-editing

Symbol verdict first, edit second. No exceptions without your human partner's permission.
