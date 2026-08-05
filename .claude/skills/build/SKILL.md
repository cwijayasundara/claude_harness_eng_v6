---
name: build
description: Full SDLC pipeline. Runs all phases end-to-end with human gates on phases 1-3.
argument-hint: "[path-to-BRD] [--mode full|lean]"
---

# Build Skill

Full software development lifecycle pipeline. Orchestrates BRD creation, story specification, architecture design, state initialization, and autonomous build execution across sequential phases (Phase 0 through Phase 10).

**Runs in the main session — do not add `context: fork`.** This conductor owns
the human gates on Phases 1–3. A forked skill cannot pause for `AskUserQuestion`
and returns a single result, so a forked `/build` silently converted all four of
its gated stops into prose the model read to itself: Phase 1's BRD approval,
Phase 2's `/spec` decision dialogue, and Phase 3's two `plan-review-loop` rounds.
That is not a hypothetical — a real gated run produced no `brd-approval.json` and
no `design-approval.json`, and left five design questions queued for a human who
was never asked.

All three planning phases now share this shape: `/brd`, `/spec` and `/design`
each run their dialogue in this session and dispatch a forked sidekick
(`brd-render`, `spec-render`, `design-render`) for the expansion. So Phase 1's
five-dimension interview, Phase 2's decision dialogue and Phase 3's architecture
brainstorm all reach the human, and each phase records a `plan-approval`
receipt — including `brd`, which had no phase at all until the intake was
de-forked.

The delegated sub-skills (`/brownfield`, the three `*-render` skills, `/test`,
`/auto`, `/gate`) fork their own work as they already do; the conductor itself
stays in the main conversation loop. Same rule, same reason, as `/feature` and
`/sprint`. Nothing else depends on the fork: resumability is file-existence
checks (Phase 4 re-entry rule), and headless session chaining spawns its own
`claude -p` links via `build-chain.js`.

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

