---
name: evaluation
description: "[Reference, not a command] Evaluation patterns — sprint contract format, three-layer verification, scoring rubric references. Read by the evaluator agent. To run an evaluation, use /evaluate instead."
---

# Evaluation Skill — Reference Only

> **This is a reference skill, not an action skill.** It is read by the evaluator agent for sprint-contract format and scoring patterns. **Do not invoke `/evaluation` directly** — there is no workflow here. To run an evaluation against the sprint contract, run `/evaluate`.

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
7. **Run checks in order.** Layer 1 before Layer 2 before Layer 3, then the Layer 4 security gate.
8. **Document every check result,** even passing ones.
9. **Security is a gate, not advice.** The overall verdict is FAIL if `specs/reviews/security-verdict.json#pass` is false (any critical/high finding). A functional pass with an open BLOCK vulnerability is still a FAIL. The `security-guidance` plugin is advisory and does not satisfy this gate — the `security-reviewer` agent does.
