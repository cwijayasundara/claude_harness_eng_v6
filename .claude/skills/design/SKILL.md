---
name: design
description: "[Internal pipeline stage — run by /build (use --doc-only standalone for an ARB narrative); invoke directly only as a power user.] Generate system architecture, machine-readable schemas, and UI mockups. Spawns planner + generator concurrently."
argument-hint: "[--doc-only [path] | --delta --stories <dir> | --story <file> --amendment-id <id> | --baseline-recovery | --render-only]"
---

# Design Skill — Architecture Shaping

**Runs in the main session — do not add `context: fork`.** This skill owns the
architecture dialogue (Step 0 brainstorm, Step 0.5 clarify) and the human review
gate. A forked skill cannot pause for `AskUserQuestion`, so a forked design
phase can only answer its own questions — which is how nine documents and every
mockup came to be written before the human was asked anything, and how five
queued design questions were never put at all.

The rendering half forks: `design-render` expands the recorded decisions onto
the sidekick model. Judgement here, volume there.

> **Effort.** The *shaping* dialogue is where extra reasoning pays — a judge-panel of architecture approaches is worth it across a handful of decisions. The *rendering* is transcription and runs on the sidekick model, so do not raise effort for it. Keep `/effort high` for the execution phases (`/auto`, `/implement`).

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
| Step 0.9 — Record decisions + dispatch the renderer | `references/mode-10-step-1-spawn-two-agents-concurrently.md` |
| Machine-Readable Artifacts | `references/mode-11-machine-readable-artifacts.md` |
| Output | `references/mode-12-output.md` |
| Gate | `references/mode-13-gate.md` |
| Gotchas | `references/mode-14-gotchas.md` |

### Route

1. Parse flags (`--doc-only`, `--delta`, `--baseline-recovery`, `--render-only`, default full).
2. Load **only** that mode's reference file and execute it.
3. Do not load delta/full procedure when running `--doc-only`.
4. **With `--render-only`, run full mode from Step 0.9 §3 onward** — load `references/mode-10-step-1-spawn-two-agents-concurrently.md` and skip Steps 0, 0.5 and 0.7. The decisions file already exists and was already gated; re-running the dialogue would re-ask settled questions. Do not load the Step 0/0.5/0.7 reference files at all.

### Load-bearing names (always visible)

Full/delta modes still run `trace-check.js`, `validate-canvas.js`, `vocabulary-check.js`, `modularity-pack.js`, `record-modularity-review.js`, and `contract-drift-gate.js` where the mode file specifies them. Wiring tests scan this entry file **and** `references/*.md` as one corpus.

