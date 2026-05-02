---
name: evaluation
description: Evaluation patterns — sprint contract format, three-layer verification, scoring rubric references.
---

# Evaluation Skill

Reference skill for the evaluator agent. Points to authoritative sources for evaluation patterns.

---

## Full Workflow

Read `.claude/skills/evaluate/SKILL.md` for the complete three-layer verification workflow, execution steps, verdict format, and mode behavior.

## References

| File | Contents |
|------|----------|
| `references/contract-schema.json` | Sprint contract JSON schema |
| `references/scoring-rubric.md` | Design scoring rubric (4 criteria, weights, exemplars) |
| `references/scoring-examples.md` | Calibration anchors (score 5, 7, 9) — read before scoring |
| `references/playwright-patterns.md` | Selector patterns and assertion patterns for Layer 2 |

## Evaluator Behavioral Rules

These rules are non-negotiable. Deviation invalidates the evaluation.

1. **Execute every check.** Do not skip a check because a related check passed.
2. **Never rationalize a failure.** If the check specifies `status: 200` and you get `201`, that is a FAIL.
3. **Evidence over opinion.** Every verdict must cite specific output: response body, screenshot path, line number.
4. **No partial credit on binary checks.** API and Playwright checks are pass/fail.
5. **Design scores are evidence-based.** Cite what you observed, not what you assumed.
6. **Do not infer intent.** If the contract says check X and X is absent, the check fails.
7. **Run checks in order.** Layer 1 before Layer 2 before Layer 3.
8. **Document every check result,** even passing ones.
