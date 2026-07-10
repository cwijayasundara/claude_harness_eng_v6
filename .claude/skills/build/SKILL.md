---
name: build
description: Full SDLC pipeline. Runs all phases end-to-end with human gates on phases 1-3.
argument-hint: "[path-to-BRD] [--mode full|lean]"
context: fork
---

# Build Skill

Full software development lifecycle pipeline. Orchestrates BRD creation, story specification, architecture design, state initialization, and autonomous build execution across sequential phases (Phase 0 through Phase 10).

---

## Progressive loading

This skill is an **orchestrator index**. Load only the section file for the step you are on.

| When | Read |
|---|---|
| Usage | `references/section-01-usage.md` |
| Step 0 — Resolve the invocation (run this FIRST, before anything else) | `references/section-02-step-0-resolve-invocation.md` |
| Approval model | `references/section-03-approval-model.md` |
| Pipeline Phases (0–11) | `references/section-04-pipeline-phases.md` |
| Mode Reference | `references/section-05-mode-reference.md` |
| Gotchas | `references/section-06-gotchas.md` |

### Route

1. Always start with **Step 0** (`references/section-02-step-0-resolve-invocation.md`) — resolve flags via `build-lane.js`.
2. Apply **Approval model** for gated / autonomous / auto / lite.
3. Execute **Pipeline Phases** in order (0–11), loading detail from that section file.
4. Existing lane detail: `references/lite-lane.md`, `references/autonomous-lane.md`.

### Load-bearing names (always visible)

Headless modes use `plan-confidence.js` (and `--gate`), `build-lane.js`, `budget-state.js`, `build-chain.js`, `/auto`, `/gate`, `/pr-respond`. Full procedure is in the section files. Wiring tests scan entry + `references/*.md` as one corpus.

### Iron law — `--auto` / `--autonomous` (never stop after planning)

When the invocation includes **`--auto`** (or **`--autonomous`** after its single plan gate is satisfied, or is headless with no human):

1. Completing BRD / stories / design / test plan is **not** done. That is only Phases 1–3.
2. **Immediately** continue into Phase 4 (state init) and invoke **`/auto`** (with `--mode` if set) so production code and the project test suite exist.
3. Do **not** end the session with only `specs/` written. A successful `--auto` leaves a green app (or a machine-gate failure with code attempted) — never “plan only” unless `--plan-only` was passed.
4. Read `references/autonomous-lane.md` and `references/section-04-pipeline-phases.md` for the tail (Phases 4–11).

