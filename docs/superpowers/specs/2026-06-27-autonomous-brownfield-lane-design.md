# Autonomous brownfield lane

**Date:** 2026-06-27
**Status:** Approved (design)
**Scope:** Fix #2 of the autonomous-path gap series. Give `/feature` (the
brownfield route) `--autonomous` and `--auto` lanes that converge on the same
`/auto` and `/change` engines greenfield uses, with **machine** enforcement
replacing the human design-adherence gate.

## Problem

Greenfield `/build` has three lanes: gated (3 human gates), `--autonomous`
(1 plan gate), `--auto` (0 gates). The brownfield counterpart `/feature` has
**only** the 3-gate interactive form. There is no autonomous brownfield surface —
no way to take an existing-code request to a reviewed PR without a human stopping
at every gate.

The reason this is not a trivial copy of `/build --auto`: `/feature`'s **GATE 2**
is a brownfield-specific safety check — a human verifying the plan cites the
committed DeepWiki and **extends an existing seam** rather than inventing a
parallel structure. Remove the human and something must still enforce that, or an
autonomous agent will bolt new structure onto a codebase it was supposed to
extend.

## Decisions (from brainstorming)

- **Layered adherence enforcement** (mirrors greenfield `--auto`'s
  plan-confidence + GAN evaluator):
  1. **Deterministic seam-confidence gate** at plan time — is there a clean seam
     to extend at all?
  2. **Judged adherence critic** in the loop — did the plan/diff actually cite
     and extend it?
- **Full `/build` lane parity** — add both `--autonomous` (1 gate) and `--auto`
  (0 gates). All lanes still stop at the open PR; merge stays human.
- **Adherence critic = reuse, not a new agent** — the existing **evaluator**
  (artifact mode) gets a brownfield-adherence rubric for plan-adherence; the
  existing **diff-reviewer** gets an adherence lens for diff-adherence.
- **Low seam-confidence in `--auto` → stop & surface** a report (never edit
  blind). Auto-routing to `sprouting-instead-of-editing` is deferred to a
  follow-up.

## Why `/feature` does not need `context: fork`

`/feature` already runs in the **main session** and delegates forked work to
`/brownfield`, `/change`, `/auto`. The autonomous lanes simply **do not stop** at
gates — they don't require the `context: fork` + skip-if-artifacts re-invocation
mechanism `/build` uses. The heavy long-run machinery (session chaining,
sprint contracts) already lives in the delegated `/auto`. `/feature` stays a thin
conductor at every lane.

## Lane model

| Invocation | Gates | Behavior |
|---|---:|---|
| `/feature "<req>"` | 3 | Today's interactive route (unchanged): decomposition, design-adherence, PR review. |
| `/feature "<req>" --autonomous` | 1 | One consolidated **seam-cited plan** gate (folds decomposition + design-adherence + the seam-confidence band), then autonomous → PR. |
| `/feature "<req>" --auto` | 0 | Request → PR(s). Machine seam-confidence + adherence enforcement replace the human GATE 2. Low confidence → stop & surface. |

All lanes stop at the open PR(s); the human owns merge.

## Architecture

### New: `.claude/scripts/feature-lane.js` (pure, deterministic)

Mirrors `build-lane.js`. Parses `/feature "<request>" [--autonomous|--auto]` →

```json
{ "lane": "gated|autonomous|auto", "humanGates": 3, "request": "<text>", "auto": false, "autonomous": false }
```

`--auto` implies `--autonomous`'s tail (gates 0). Order-independent. The request
string is everything that is not a recognized flag. Unit-tested like
`build-lane.test.js`.

### New: `.claude/scripts/seam-confidence.js` (pure, deterministic — the first layer)

Reads `seam-finder`'s scored seam list for the goal (the
`specs/brownfield/seams-<goal>.md` table `score_seams.js` writes — the
implementation plan pins the exact parse, adding a `--json` emit to
`score_seams.js` if the markdown table is not cleanly parseable) plus code-graph
god-file/sprouting flags, and emits:

```json
{ "band": "high|low", "target_seam": "<symbol/file>", "total_score": 0.0, "reasons": ["..."] }
```

- `band: low` when the best candidate `total_score < 0.5` (reusing the existing
  `sprouting-instead-of-editing` cutoff), or the target is a god-file with no
  clean boundary, or no candidate seam is found for the goal.
- `band: high` otherwise, naming the `target_seam` to extend.

Pure logic takes parsed inputs (no I/O) so it is unit-testable; a thin CLI reads
the canonical paths and prints JSON, exiting non-zero on a missing graph.

### Reused: adherence critic (the second, judged layer)

No new agent. Two touchpoints, both grounded in the committed DeepWiki +
`code-graph.json`:

- **Plan-adherence** — the **evaluator** in artifact mode scores the plan against
  a new `brownfield-adherence` rubric: does each edit cite a specific DeepWiki
  page/symbol and name the existing module/seam/layer it extends? Reject plans
  that invent a parallel structure. This is the machine form of human GATE 2.
- **Diff-adherence** — the pre-PR **diff-reviewer** gets an adherence lens: did
  the actual diff extend the cited seam, or drift into a parallel structure
  during implementation? A fail blocks the PR.

In autonomous lanes these run as machine gates (self-heal N attempts, else stop &
surface). In the default 3-gate lane the human GATE 2 still owns this; the machine
checks are additive safety, not the sole gate.

### Rewritten: `.claude/skills/feature/SKILL.md`

Document the three lanes and the autonomous spine. The existing spine
(Discover → Decompose → Plan/adherence → Publish → Implement → Test → Verify →
PR) is preserved; the autonomous lanes thread the deterministic seam-confidence
gate before decomposition and run the adherence critic where the human gates were.

## Data flow (`--auto`)

```
/feature "<req>" --auto
  └─ feature-lane.js  (lane=auto, humanGates=0, request)
       │
       ▼
  ensure DeepWiki fresh  (/brownfield: build if absent, patch if stale — no gate)
       │
       ▼
  seam-finder --goal "<req>"  →  seam-confidence.js  →  { band, target_seam }
       │
       ├─ band=low  → write specs/brownfield/adherence-report.md → STOP & surface
       │
       └─ band=high
             │
             ▼
       auto-classify scope (reuse /feature's existing size thresholds + risk-map)
             ├─ single-story → /change   (bounded, single session)
             └─ epic         → /spec → /design → /auto  (agent teams; the
                               existing brownfield epic lane — NOT /build)
             │
             ▼
       MACHINE plan-adherence (evaluator artifact rubric)   ← replaces human GATE 2
             │  fail → self-heal N → else STOP & surface
             ▼
       build (the chosen engine)
             │
             ▼
       MACHINE diff-adherence (diff-reviewer lens) + /gate  ← pre-PR safety
             │  fail → self-heal N → else STOP & surface
             ▼
       open PR(s), link Linear if configured → STOP at PR (human merges)
```

`--autonomous` is identical except the seam-confidence band + the seam-cited plan
are presented at **one** human gate before the build; a low band surfaces there
instead of stopping headlessly.

## Error / stop behavior

- **No DeepWiki** → build it via `/brownfield` (no gate), then continue.
- **Stale DeepWiki** → incremental `--files` patch (existing `graph-refresh`), no
  gate.
- **Low seam-confidence in `--auto`** → write `specs/brownfield/adherence-report.md`
  (the goal, the best candidate seams + scores, why it's low) and STOP. Never edit
  a high-risk seam or god-file blind.
- **Plan-adherence fail** → self-heal N attempts (re-plan citing a real seam);
  else stop & surface.
- **Diff-adherence fail** → block the PR; self-heal; else stop & surface.
- **Scope classification ambiguous** → take the larger (epic/`/auto`) lane, which
  carries more verification, rather than the bounded `/change` lane.

## Testing

- `test/feature-lane.test.js` — gates 3/1/0; `--auto` implies autonomous tail;
  flag order independence; request extraction ignores flags.
- `test/seam-confidence.test.js` — `band: high` for a clean seam (score ≥ 0.5);
  `band: low` for score < 0.5, for a god-file target, and for no-candidate; the
  named `target_seam`; CLI exits non-zero on a missing graph.
- `test/feature-autonomous-contract.test.js` — `/feature` SKILL.md documents the
  three lanes, that machine seam-confidence + adherence enforcement replace the
  human GATE 2 in autonomous lanes, the low-confidence stop-and-surface, and
  stop-at-PR in every lane.
- Adherence rubric presence — a contract assertion that the evaluator's
  brownfield-adherence rubric and the diff-reviewer adherence lens are documented.

## Out of scope (tracked separately)

- **Tracker-driven brownfield** (fix #3) — routing non-PRD tracker issues through
  this lane + `publish-to-jira.js`.
- **`context: fork` gate-mechanism cleanup** (fix #4).
- **Auto-routing low-confidence changes to `sprouting-instead-of-editing`** —
  deferred follow-up; v1 stops & surfaces.
