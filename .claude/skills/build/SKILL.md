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
(`brd-render` only on `--full` or interview-from-scratch; `spec-render`,
`design-render`) for the expansion. Phase 1 on `/brd --prd` is lean adopt
(scripts). The five-dimension interview runs only for interview-from-scratch
or `--full`. Phase 2's decision dialogue and Phase 3's architecture
brainstorm still reach the human, and each phase records a `plan-approval`
receipt.

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

### Iron law — gated `--full` stops at the seal; only `--auto` codes in-session

When `build-lane.js` reports `stopsAfterSeal: true` (gated, `--autonomous`, interactive `--lite`):

1. Finish Phases 1–3 and the human approvals.
2. Run `node .claude/scripts/plan-seal.js write`.
3. **Stop.** Print: `/clear`, then `/auto --sealed` (and `--mode` if set). Do not enter Phase 4 or `/auto` in this session.

When the invocation includes **`--auto`** (`stopsAfterSeal: false`):

1. Completing BRD / stories / design / test plan is **not** done. That is only Phases 1–3.
2. Write phase waivers, then `node .claude/scripts/plan-seal.js write --lane --auto`.
3. **Immediately** continue into Phase 4 and invoke **`/auto`** so production code exists.
4. Do **not** end the session with only `specs/` written unless `--plan-only` was passed.

