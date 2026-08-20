---
name: spec
description: "[Internal pipeline stage — run by /build; invoke directly only as a power user.] Shape the decomposition with the human — milestone scope, epic boundaries, real-vs-defensive dependencies — then dispatch spec-render to expand those decisions into the story graph."
argument-hint: "[path-to-BRD]"
---

# Spec Skill — Decomposition Shaping

**Runs in the main session — do not add `context: fork`.** This skill owns the
decision dialogue and the human review gate. The renderer it dispatches forks.

This skill is an **orchestrator index** (SSDD `/spdd-story`). Read only the
reference for `NEXT`. Two sessions produce the story graph: shape
`spec-decisions.json`, `/clear`, then `/spec`. `--render-only` is an alias
for the render hop. `/build` passes `--in-session`. Upstream pointer:
`specs/brd/brd.md`.

| Flag / NEXT | Read |
|---|---|
| `shape` (default) | `references/shape.md` |
| `render` or `--render-only` | `references/render.md` |
| `review` | `references/review.md` |

### Route

1. `node .claude/scripts/handoff-check.js --phase spec` then
   `node .claude/scripts/phase-digest.js --phase spec`.
2. Load **only** that mode's reference.
3. **Do not read `brd-requirements.json`**, `brd-acceptance.json`, or `brd.md`
   whole. The digest is the shaping input (~4 KB).
4. Do not re-open the dialogue when `NEXT` is `render` or `review`.

The review pair is `epics.md` + story Generation Contracts
(`plan-review-loop/references/lean-review-surface.md` and `ssdd.md`).

### Load-bearing names (always visible)

`fill-spec-scope.js`, `validate-spec-decisions.js`, Invoke the `spec-render`
skill, `spec-render-write.js`, `bundle-write.js`, `plan-approval.js`
`--phase spec`. Phase-eval: Skip unless `--eval`.
