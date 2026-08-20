# Lean review surface — `--full` planning

What a human must be able to approve in one sitting. Machine gates may still
write extra files; those are not the review brief.

Use this when running `/brd`, `/spec`, `/design`, or `/test --plan-only` on the
default `--full` path. Pass `--eval` only when a security or persisted-data
boundary needs an inferential phase score.

SSDD (see `ssdd.md`): each gate has **one structured record**. A change request
edits that record, then re-renders. Do not rubber-stamp the volume.

## Review pair (one human doc + one machine file)

| Phase | Human reads | Machine spine | Do not put in the approval brief |
|---|---|---|---|
| `/brd` | `specs/brd/brd.md` (≤80 lines: problem, success, in/out, risks). Lean `--prd` writes this pointer automatically. | `specs/brd/brd-requirements.json` + `analysis-seed.json` | analysis pack tables, phase-eval JSON (`--full` / `--eval` only) |
| `/spec` | `specs/stories/epics.md` + **Generation Contract** skeletons as **vertical slices** | `specs/stories/stories.json` + `features.json` + `spec-decisions.json` | layer-ladder schedules, phase-eval JSON |
| `/design` | `architecture.md` + **`program-design.md`** + **`reasons-canvas.md`** | `specs/design/component-map.md` + `design-decisions.json` | mockups (unless a UI story), deployment essay, per-entity schema dumps |
| `/test --plan-only` | `specs/test_artefacts/test-plan.md` (seams + Given/When/Then scenarios + proposed evaluator checks + untested) | `specs/test_artefacts/verification-matrix.json` + `specs/bundles/` | Playwright files, AT source, `sprint-contracts/*.json`, phase-eval JSON |

## Vertical slices (spec)

A story is a tracer bullet: one demoable path through the layers it needs
(schema + API + UI + test as applicable). Do not split a capability into
`Types` then `Config` then `Repository` then `Service` then `API` then `UI`
stories. `layer` is a tag for the primary surface, not a reason to split.

## Program design (design)

`specs/design/program-design.md` is required. It carries types, method
signatures, a call-stack tree (diff syntax for changes), and a file-tree
diff. That is what the human approves instead of 2,000 lines of generated
code later.

## Test plan-only

`--plan-only` names seams, restates each AC as Given/When/Then, and lists
proposed evaluator checks (`api` / `playwright`) derived from the matrix.
It does not write Playwright files, AT source, or `sprint-contracts/*.json`.
Acceptance-test source files are written at implement time against those seams
and must match the reviewed scenario wording. `/test --e2e-only` runs after
code exists.

## Phase-eval

Skip the inferential phase-eval loop unless the invocation includes `--eval`.
Auth, tenant, migration, or an external-trust boundary is **not** a reason to
run it — those are design decisions plus the deterministic gates. Grounding,
taxonomy, and trace-check stay on — they are cheap and computational.
