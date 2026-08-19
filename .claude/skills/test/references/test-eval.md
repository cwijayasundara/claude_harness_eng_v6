# `--eval` — artefact-mode phase evaluation (opt-in)

Skip unless `--eval`. Load this only when `/test --plan-only --eval` was
invoked. Auth, tenant, migration, or an external-trust boundary is **not**
a reason to run it.

Spawn the `evaluator` agent in **artifact mode** with `model: "sonnet"` against
`.claude/templates/phase-eval-rubrics.json#phases.test`:

| Input | Value |
|---|---|
| `phase` | `test` |
| `artifact_paths` | `specs/test_artefacts/test-plan.md`, `verification-matrix.json`, `test-traces.json`, and `constraint-obligations.json` when it exists |
| `upstream_paths` | `specs/stories/story-traces.json` |
| `verdict_path` | `specs/reviews/phase-test-eval.json` |

Threshold: weighted average >= 7.0, every criterion >= 5, max 3 iterations.
On FAIL, fix findings and re-run; on the third failure, carry them into the
review brief.

**The grounding verdict is a hard gate.** When `story-traces.json` exists,
`test-grounding.json#pass` must be `true`.

**Take the verdict from the return message. Do not read
`specs/reviews/phase-test-eval.json` back into this session.** Escalate to
`model: "opus"` only when the operator passed `--eval` *and* the plan covers
a security or data boundary the deterministic gates do not cover.
