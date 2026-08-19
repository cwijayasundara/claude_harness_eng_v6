---
name: brd
description: "[Internal pipeline stage — run by /build; invoke directly only as a power user.] /brd --prd is adopt-only (scripts, no interview) unless --full."
---

# BRD Skill — Requirements Intake

**Runs in the main session — do not add `context: fork`.** This skill owns the
intake dialogue and the human approval. The rendering half (`brd-render`) forks.

This skill is an **orchestrator index**. Read only the reference for the mode
you were invoked with.

| Flag | Read |
|---|---|
| `--prd` / `--frd` without `--full` (default) | `references/prd-lean.md` — then stop |
| `--prd` / `--frd` `--full`, or no document | `references/interview.md` |
| `--delta` | `references/delta.md` then lean or interview |
| `--eval` | also `references/interview.md` Step 4.5 |

<lean_prd>
When the invocation includes `--prd` or `--frd` and is without `--full`, follow
`references/prd-lean.md` and stop. Do not continue into brainstorm, interview,
`brd-render`, or eval (eval only if `--eval` was passed). Auth, tenant,
migration, or an external-trust boundary is **not** a reason to run eval.
</lean_prd>

Lean `--prd` runs `validate-prd.js` **before** dispatching the extractor, then `prd-extract.js --tag --write-brd`. Do not extract the spine yourself. Do not read `frd-requirements.json` when it returns. A requirement with no acceptance postcondition is the work-list `/spec` inherits.

`--full` only writes `brd-analysis.json`. Lean writes `analysis-seed.json`.

The review surface is `brd.md` + `brd-requirements.json`
(`plan-review-loop/references/lean-review-surface.md` and `ssdd.md`).
SSDD: this gate writes R / E / Safeguards (`analysis-seed.json`). Record with
`plan-approval.js record --phase brd`. On approval: `/clear` before `/spec`.
