---
name: test
description: "[Internal pipeline stage — run by /build and /auto; invoke directly only as a power user.] /test writes the matrix + plan before source exists; Playwright only with --e2e-only after source exists."
argument-hint: "[--plan-only | --e2e-only]"
---

# Test Skill — Plan, then (later) E2E

**Runs in the main session — do not add `context: fork`.** Operators run
`/test`. `--plan-only` is an alias for the default hop when no application
source exists (matrix + human review). A fork starts a generator with a
fresh 100K+ prefix; that is what billed ~200K tokens on a 6-story API.
`--e2e-only` is the other hop, after source exists. Use `--plan-only`
explicitly only to force the plan hop when `backend/`/`frontend/` source
already exists.

This skill is an **orchestrator index**. Read only the reference for the flag
you were invoked with. No flag and no `backend/`/`frontend/` source means
the plan hop (`--plan-only`).

| Flag | Read | Writes |
|---|---|---|
| `--plan-only` (default when no source) | `references/test-plan.md` | script writes matrix + traces + skeleton plan |
| `--eval` (with `--plan-only`) | also `references/test-eval.md` | `phase-test-eval.json` |
| `--e2e-only` or full `/test` after source exists | `references/e2e-authoring.md` | `e2e/` |
| `--deployed` | `references/e2e-deployed.md` | deployed Playwright suite |
| `--from-cr` | `references/brownfield-cr.md` | `specs/test_artefacts/cr-<id>/` |

### Route

1. Parse flags. Missing flag + no **application** source → `--plan-only`. Scaffold `backend/CLAUDE.md` / `frontend/CLAUDE.md` is not source.
2. Load **only** that mode's reference.
3. `--plan-only` does **not** load Playwright, AT source, the evaluate skill, or `test-authoring.md`. Do not spawn a generator.
4. First command: `node .claude/scripts/test-plan-write.js` then `phase-digest.js --phase test`. Do not read `acceptance-criteria.json` whole. The writer attaches `OBL-` ids, layers, and `implementation_paths`. Do not remap them by hand.

The plan hop gates on `plan-approval.js check --phase spec`. When
`design-decisions.json` exists and `architecture.md` does not, prefer
`/design` first unless `--in-session`.

When schemas exist, `references/test-plan.md` runs `constraints-extract.js`.
Load `references/test-design.md` only to add extra negative rows.

The review surface is `test-plan.md` (seams, Given/When/Then, proposed
evaluator checks, untested) + `verification-matrix.json`
(`plan-review-loop/references/lean-review-surface.md` and `ssdd.md`).
SSDD: this gate writes testable Operations (seams + behavior spec + matrix)
and joins `specs/bundles/` via `bundle-write.js`.
