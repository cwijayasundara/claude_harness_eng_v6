---
name: sprouting-instead-of-editing
description: Use when a symbol that must change is UNCOVERED and unpinnable (seam score < 0.5, or a skeletons/-flagged god file with no clean boundary) — adds behavior in a new fully-tested unit instead of editing legacy code in place.
---

# Sprouting Instead of Editing

Feathers' escape hatch for the worst case: code you cannot pin must not be edited in place. Put the new behavior in a new unit you can TDD from scratch, and touch the legacy code at exactly one line.

## The Iron Law

```
IF YOU CANNOT PIN IT, DO NOT EDIT IT — SPROUT BESIDE IT
```

## Decision Table

| Situation | Move |
|---|---|
| Seam `total_score ≥ 0.5` and output observable | Not this skill — `REQUIRED SUB-SKILL: pinning-down-behavior` |
| Adding behavior inside an unpinnable function | **Sprout method/class**: new code in a new unit, called from one new line in the legacy body |
| Behavior must run before/after an unpinnable function | **Wrap method**: rename old → `_old_name`, create same-signature `name()` that calls `_old_name()` plus the addition |
| God file flagged in `specs/brownfield/skeletons/` | Default to sprout; never inline new logic into the god body |

## Process

1. Write the sprout as a brand-new module/class/function — the existing TDD gate applies in full (failing test first; `superpowers:test-driven-development`).
2. Touch the legacy file at **exactly one call line** (or the rename pair for wrap). Verify mechanically: the diff to the legacy file intersects one symbol; for the call-line check use the symbol ranges in `specs/brownfield/code-graph.json`.
3. Confirm with the code graph that no other caller of the legacy symbol changes behavior unintentionally (`edges` where `target` = the legacy file, `symbol_to` = the symbol).
4. Run the full suite plus any oracle tests from checking-coverage-before-change.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "I'll just quickly inline it" | Inlining into unpinned code is an unobserved behavior change. That is the definition of risk. |
| "The function is only 30 lines, editing is fine" | Size is not coverage. Unpinned is unpinned. |
| "A sprout adds indirection" | One extra call is cheaper than one silent regression. Fold it in later, under tests. |

## Red Flags — STOP

- More than one changed line in the legacy file (excluding the wrap rename pair)
- New logic appearing inside the legacy function body
- Sprout code written before its failing test

## Checklist

- [ ] Sprout/wrap chosen via the decision table
- [ ] Sprout fully TDD'd as new code
- [ ] Legacy diff = one call line (or rename pair), verified against symbol ranges
- [ ] Full suite + oracle tests green

New code gets tests; old code gets one line. No exceptions without your human partner's permission.
