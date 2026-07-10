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

