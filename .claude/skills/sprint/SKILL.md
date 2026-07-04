---
name: sprint
description: PRD-per-sprint evolution route for an existing harness-built (or brownfield) system — grounds a new PRD against the prior requirement spine, produces a human-approved design amendment against the living specs/design/ baseline, then runs /auto. Companion to /build (sprint 1) and /feature (single-story changes).
argument-hint: "<prd-file> [--autonomous]"
---

# Sprint Skill — PRD-per-Sprint Evolution

`/sprint` is a **thin conductor**, like `/feature`, for evolving a system PRD
by PRD without regenerating its architecture from scratch each time. It
grounds the new PRD against the prior sprint's requirement spine, amends the
living `specs/design/` baseline instead of replacing it, and gates code
generation on a human-reviewable diff of the design amendment — never a
regenerated document. See
`docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md` for the full
design rationale.

Use `/build` for sprint 1 (no existing code or specs). Use `/feature` for a
single story or small cluster that doesn't need a full PRD. `/sprint` is for
"here is the next PRD" — many stories, evolving an existing architecture.

**Runs in the main session — do not add `context: fork`.** Like `/feature`,
this conductor owns interactive human gates (GATE 1, GATE 2) and delegates the
actual work to forked sub-skills.

## Usage

```text
/sprint prd-sprint2.md                  # 2 gates (default)
/sprint prd-sprint2.md --autonomous     # 1 consolidated gate (folds GATE 1 into GATE 2)
```

There is no `--auto` (zero-gate) mode — GATE 2 (design-delta approval) is
never collapsible, by design.

## Wrong-door protection

Before anything else, check `specs/design/architecture.md`:
- If it does not exist **and** the repo has no source code (a fresh, empty
  project) — this is sprint 1, not sprint N. Stop and tell the human to run
  `/build <prd>` instead.
- If it does not exist **but** source code exists (a true brownfield app the
  harness did not build) — proceed to Phase 0's baseline recovery.
- If it exists — proceed normally.

`/build`'s own Step 0 carries the mirror check: if `specs/design/architecture.md`
already exists when `/build` is invoked, `/build` stops and redirects here.

## Phase 0 — Preflight & Baseline (fully automatic, no flags)

1. **Baseline recovery.** If `specs/design/architecture.md` is missing (true
   brownfield): run `/design --baseline-recovery` (see `design/SKILL.md`'s
   Baseline Recovery Mode). This runs `/brownfield` discovery first if
   `specs/brownfield/code-graph.json` does not exist, then derives a living
   design set from the graph, stamped `provenance: derived-from-code`, with
   a one-time human approval before proceeding. After this, treat the repo
   as if it already had an approved baseline.
2. **DeepWiki freshness.** If `specs/brownfield/wiki/` exists, check for a
   `> STALE since…` banner; if present, patch it incrementally via
   `/code-map --files` on the flagged files, the same mechanism `/feature`
   already uses.
3. **Sprint number.** List `specs/brd/sprint-*/` directories; the sprint
   number for this run is one greater than the highest found, or `2` if only
   the flat legacy `specs/brd/brd.md` exists (sprint 1 was built before
   sprint-numbered directories existed). State the resolved sprint number
   before proceeding.

## Phase 1 — Requirements Delta

Run `/brd --delta <prd-file>` (see `brd/SKILL.md`'s Delta Mode). This writes
`specs/brd/sprint-N/` and, critically,
`specs/brd/sprint-N/requirements-delta.json` classifying every requirement as
new/changed/carried against the prior sprint's spine. Any unresolved
`dropped` entry halts here per that skill's Step Δ2 — do not proceed with a
silent requirement regression.

## Phase 2 — Story Decomposition

Run `/spec specs/brd/sprint-N/brd.md --sprint N` (see `spec/SKILL.md`'s
sprint addendum). Writes `specs/stories/sprint-N/`.

## GATE 1 — Approve Requirement Delta + Decomposition

Present, on one screen:
- The requirements-delta classification (new / changed / carried / dropped,
  with resolution for each dropped item)
- The story decomposition summary (epic table, dependency graph, story-point
  total) from `/spec`'s own Step 7 output

Ask: "Does this requirement delta and story decomposition look correct?
Approve to proceed to the design amendment, or provide corrections."

With `--autonomous`, skip this as a separate stop — fold its summary into the
single GATE 2 presentation instead (do not skip the underlying `/brd --delta`
and `/spec` grounding gates themselves, only the human stop).

## Phase 3 — Design Delta

Run `/design --delta --stories specs/stories/sprint-N/ --amendment-id sprint-N`
(see `design/SKILL.md`'s Delta Mode, Steps D1–D6): read the living baseline,
spawn one planner agent to write the amendment and amend the living design
non-destructively, emit the grounding gate, run the contract-drift check, and
run the design-delta evaluator rubric.

## GATE 2 — Approve Design Amendment (never collapsible)

This is `design/SKILL.md` Delta Mode's Step D7, run from here. Never skipped,
never folded away in any autonomy mode. On approval, the amendment and
updated living-design files are committed together in one commit.

## Phase 4 — Tracker Publish (optional)

If a tracker is configured (`.claude/tracker-config.json`), run
`tracker-publish --granularity group` exactly as `/feature`'s epic lane does.

## Phase 5 — Delta Test Plan

Run `/test` (the normal flow, not `--from-cr` — that lane is for a single
change-request bug fix with no stories directory) scoped to
`specs/stories/sprint-N/`, so every new story gets a proper test plan and
grounded verification-matrix entries exactly as a fresh spec/design pass
would produce. Any existing area the amendment's Breaking Changes section
names is covered by that area's own existing tests, which `/auto`'s normal
test gate re-runs — no separate regression-pin pass is needed since sprint-N
stories already carry proper `story-traces.json`.

## Phase 6 — Build

Run `/auto`. The merged `specs/design/component-map.md` (already updated by
Phase 3) means the existing ownership, canvas-sync, layer, and context
sensors now enforce the evolved design automatically — no `/auto` changes
needed.

## Phase 7 — Gate and PR

Run `/gate`, then open the PR(s) exactly as `/build`/`/feature` do. Merge
stays human.

## State markers

At the start of Phase 0, write `.claude/state/current-sprint` (the resolved
sprint number, e.g. `2`) and update `.claude/state/sprint-phase` at the start
of every phase (`preflight`, `requirements-delta`, `story-decomposition`,
`design-delta`, `tracker-publish`, `test-plan`, `build`, `gate`) so `/status`
can show sprint progress:

```bash
mkdir -p .claude/state
printf '%s' "N" > .claude/state/current-sprint
printf '%s' "<phase-name>" > .claude/state/sprint-phase
```

## Gotchas

- **Never let Phase 3 regenerate `specs/design/` from scratch.** If the
  planner agent's output looks like a fresh design rather than an amendment
  (missing prior component-map rows, a rewritten architecture.md with no
  trace to the prior version), stop and re-invoke Delta Mode Step D3 with a
  stronger instruction to read the baseline first.
- **GATE 2 here is not `/feature`'s GATE 2.** They serve different lanes
  (PRD-scale vs single-story) but share the same underlying
  `design/SKILL.md` Delta Mode machinery — do not conflate the two
  conductors.
- **Do not skip the requirements-delta dropped-item resolution.** An
  unresolved `dropped` entry is exactly the silent regression this lane
  exists to prevent.
- **`--autonomous` folds human stops, never machine gates.** The grounding
  gates, contract-drift check, and design-delta evaluator all still run.
