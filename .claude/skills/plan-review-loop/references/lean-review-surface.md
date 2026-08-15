# Lean review surface — `--full` planning

What a human must be able to approve in one sitting. Machine gates may still
write extra files; those are not the review brief.

Use this when running `/brd`, `/spec`, `/design`, or `/test --plan-only` on the
default `--full` path. Pass `--eval` only when a security or persisted-data
boundary needs an inferential phase score.

## Review pair (one human doc + one machine file)

| Phase | Human reads | Machine spine | Do not put in the approval brief |
|---|---|---|---|
| `/brd` | `specs/brd/brd.md` (≤80 lines: problem, success, in/out, risks) | `specs/brd/brd-requirements.json` | analysis pack tables, phase-eval JSON |
| `/spec` | `specs/stories/epics.md` + story files as **vertical slices** | `specs/stories/stories.json` + `features.json` | layer-ladder schedules, phase-eval JSON |
| `/design` | `specs/design/architecture.md` + **`program-design.md`** | `specs/design/component-map.md` | mockups (unless a UI story), constitution, deployment essay |
| `/test --plan-only` | `specs/test_artefacts/test-plan.md` (named seams + what is untested) | `specs/test_artefacts/verification-matrix.json` | Playwright, AT source files, phase-eval JSON |

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

`--plan-only` names seams and maps every AC onto the verification matrix.
It does not write Playwright. Acceptance-test source files are written at
implement time against those seams. `/test --e2e-only` runs after code exists.

## Phase-eval

Skip the inferential phase-eval loop unless the invocation includes `--eval`
or the artifact introduces an auth, tenant, migration, or external-trust
boundary. Grounding, taxonomy, and trace-check stay on — they are cheap and
computational.
