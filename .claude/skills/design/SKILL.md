---
name: design
description: "[Internal pipeline stage — run by /build (use --doc-only standalone for an ARB narrative); invoke directly only as a power user.] Generate system architecture, machine-readable schemas, and UI mockups. Spawns planner + generator concurrently."
argument-hint: "[--doc-only [path] | --delta --stories <dir> | --story <file> --amendment-id <id> | --baseline-recovery]"
context: fork
---

# Design Skill — System Architecture & UI Mockups

> **Ultracode tip:** This is the most reasoning-heavy, divergent phase in the pipeline — exploring a wide space of architecture and schema alternatives. Run `/effort ultracode` before invoking it so the design space is explored as a judge-panel of approaches, then drop back to `/effort high` before the execution phases (`/auto`, `/implement`).

## Progressive loading (Phase 4+)

This skill is an **orchestrator index**. Read only the reference file for the mode you are running.

| Mode / section | Read |
|---|---|
| Usage | `references/mode-01-usage.md` |
| Doc-Only Mode (`--doc-only`) | `references/mode-02-doc-only-mode-doc-only.md` |
| Delta Mode (`--delta`) | `references/mode-03-delta-mode-delta.md` |
| Baseline Recovery Mode (`--baseline-recovery`) | `references/mode-04-baseline-recovery-mode-baseline-recovery.md` |
| Overview (full mode) | `references/mode-05-overview-full-mode.md` |
| Prerequisites (full mode only — `--doc-only` has none) | `references/mode-06-prerequisites-full-mode-only-doc-only-has-none.md` |
| Step 0 — Brainstorm Architecture Direction | `references/mode-07-step-0-brainstorm-architecture-direction.md` |
| Step 0.5 — Clarify Load-Bearing Design Decisions | `references/mode-08-step-0-5-clarify-load-bearing-design-decisions.md` |
| Step 0.7 — Pre-Code Modularity Assessment | `references/mode-09-step-0-7-pre-code-modularity-assessment.md` |
| Step 1 — Spawn Two Agents Concurrently | `references/mode-10-step-1-spawn-two-agents-concurrently.md` |
| Machine-Readable Artifacts | `references/mode-11-machine-readable-artifacts.md` |
| Output | `references/mode-12-output.md` |
| Gate | `references/mode-13-gate.md` |
| Gotchas | `references/mode-14-gotchas.md` |

### Route

1. Parse flags (`--doc-only`, `--delta`, `--baseline-recovery`, default full).
2. Load **only** that mode's reference file and execute it.
3. Do not load delta/full procedure when running `--doc-only`.

### Load-bearing names (always visible)

Full/delta modes still run `trace-check.js`, `validate-canvas.js`, `vocabulary-check.js`, `modularity-pack.js`, `record-modularity-review.js`, and `contract-drift-gate.js` where the mode file specifies them. Wiring tests scan this entry file **and** `references/*.md` as one corpus.

