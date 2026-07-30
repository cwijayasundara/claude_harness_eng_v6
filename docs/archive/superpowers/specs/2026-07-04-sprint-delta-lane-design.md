# Sprint/Story Evolution Lane (`/sprint` + `/design --delta`) — Design

**Date:** 2026-07-04
**Status:** Approved design, pre-implementation
**Problem:** The harness builds sprint 1 well (`/build`) and changes code well (`/feature`/`/change`), but `/design` regenerates the entire `specs/design/` set from stories every time it runs. There is no mechanism that reads the prior approved design, produces a reviewable amendment, and gates code generation on its approval. Sprint-over-sprint (or story-over-story) evolution therefore risks architectural silos — the exact failure mode Kiro, Spec Kit, Factory, and Devin all guard against with delta specs, steering files, and hard design gates.

**Goal:** A system evolves PRD-by-PRD *and* story-by-story through one shared design-delta stage: impact analysis against the living design → human-approvable amendment → machine + human gates → only then code generation. Works identically for harness-built systems and true brownfield apps (after a one-time baseline recovery).

---

## 1. Architecture — one delta stage, two intakes

The core new capability is a single reusable stage, **`/design --delta`**: input is a story set (1..n) plus the living `specs/design/` baseline; output is a design amendment + non-destructive updates to the living design. Two routes feed it:

| Intake | Command | Granularity |
|---|---|---|
| Sprint PRD | `/sprint <prd-file>` (new thin conductor, main-session like `/feature`) | Many stories |
| Single story / feature request | `/feature` (modified) | 1 story or small cluster |

**`/feature` integration:** after decomposition, a new **impact classifier** (script: seam-confidence + heuristics — touches `api-contracts` surface? data model? new module/layer? >3 files?) routes each story:

- *Architecturally invisible* → `/change` as today. No amendment, no GATE 2. A one-line fix never hits a design gate.
- *Design-touching* → `/design --delta` for that story (mini-amendment `amendments/story-E{n}-S{n}.md`) → GATE 2 → implementation.
- `/feature`'s epic path replaces its bare `/design` call with `/design --delta` — this fixes the existing regeneration bug in that path.

**Decision concentration (Cognition principle):** all architectural decisions happen in this single-threaded stage. `/auto`'s parallel story execution stays below the decision line; parallel workers never make implicit design decisions.

## 2. Artifact model

Design is **living**; intake is **per-sprint**; amendments are **immutable records**.

```
specs/brd/sprint-N/            brd.md, brd-requirements.json (BR-N.x ids), brd-analysis.json,
                               requirements-delta.json      # new/changed/carried/dropped vs prior spine
specs/stories/sprint-N/        epics.md, E{n}-S{n}.md, dependency-graph.md/.json, story-traces.json
specs/design/                  LIVING truth — architecture.md, api-contracts(.schema.json),
                               data-models(.schema.json), component-map.md, reasons-canvas.md,
                               folder-structure.md, deployment.md, design-traces.json
                               (updated non-destructively; existing sensors keep working unchanged)
specs/design/constitution.md   Cross-sprint invariants. Human-owned, PR-reviewed. Seeded as a
                               template by /scaffold; first authored at sprint-1 design approval.
specs/design/amendments/       sprint-N.md | story-E{n}-S{n}.md — immutable, dated, approved records:
                               impact narrative, options considered, recommendation, per-component
                               impact, breaking-change list with justifications
specs/reviews/                 contract-diff-sprint-N.json (oasdiff), design-delta-eval.json,
                               requirements-delta grounding verdicts
features.json                  Single cumulative ledger at root; F-ids gain "sprint": N
```

- Sprint-1 layout is grandfathered as the baseline (no migration of existing projects' `specs/brd/`, `specs/stories/`).
- Amendments are append-only: a correction after approval is a **new** amendment, never an edit.
- `specs/design/amendments/` already exists as `/auto`'s in-sprint design-gap channel (SECTION 8); sprint/story amendments share the directory with distinct filename patterns; the in-sprint channel is unchanged.

## 3. `/sprint` flow

**Phase 0 — preflight & baseline (auto-detected, no flags).**
- Repo empty / no code → redirect to `/build` (wrong-door protection; `/build` Phase 0 gains the mirror redirect to `/sprint` when `specs/` + code exist).
- `specs/design/` missing but code exists (true brownfield) → **baseline recovery**: `/brownfield` discovery (committed DeepWiki + code-graph), then a design-recovery pass deriving the living design set from the graph — every derived artifact stamped `provenance: derived-from-code`, low-confidence areas flagged — one-time human baseline approval, commit. After this, brownfield and harness-built systems evolve through the identical lane.
- `specs/design/` present → DeepWiki freshness check via existing graph-refresh machinery (incremental patch, not rebuild).
- Sprint number auto-detected: next after highest existing `specs/brd/sprint-*`.

**Phases 1–2 — intake.** `/brd --delta` grounds the new PRD against the latest prior requirement spine and writes `requirements-delta.json` (new/changed/carried/dropped; the existing grounding gate blocks silent drops — a missing prior spine fails loud, pointing at baseline recovery). Then `/spec` sprint mode writes `specs/stories/sprint-N/`; stories touching existing areas must cite existing seams (DeepWiki/code-graph). → **GATE 1 (human):** approve requirement delta + story decomposition together, one screen.

**Phase 3 — design delta.** `/design --delta` over all sprint stories → machine gates (§4) → **GATE 2 (human, never collapsible):** amendment narrative + `git diff specs/design/` + oasdiff report + rubric verdict, one screen. Approve → amendment + living-design updates committed together (`design: sprint-N amendment`).

**Phases 4–7.** Optional `tracker-publish` (Linear/Jira, as `/feature`) → `/test` delta mode (verification matrix for new ACs + regression pins on touched areas, reusing the `--from-cr` delta pattern) → `/auto` unchanged (merged `component-map.md` means ownership/canvas-sync/layer/context sensors now enforce the *evolved* design) → `/gate` → PR(s). Merge stays human.

**Autonomy:** `--autonomous` folds GATE 1 into GATE 2 (one consolidated human stop). Nothing removes GATE 2 — the design gate is Kiro-style hard by decision. No `--auto` (zero-gate) mode in v1.

## 4. Machine evaluation of the amendment

Runs **before** the human sees it; evaluator ratchet ≤3 iterations, then stop and surface (never silent-proceed).

**Deterministic gates:**
- Trace-check grounding: every design change ↔ a sprint story/BR (net-new and dropped both block), extending the existing `design-grounding.json` mechanism.
- `validate-canvas.js` (unchanged).
- **oasdiff** on `api-contracts.schema.json` before/after: any breaking change without a matching justification entry in the amendment's breaking-change list blocks. (Reuses the oasdiff contract-drift sensor already registered in HARNESS.md.)
- **Amendment-provenance check** (new pre-commit sensor): a commit touching `specs/design/**` without a matching `amendments/` file in the same commit fails. Exemptions: baseline-recovery commit, `/auto`'s in-sprint amendment channel.

**New evaluator artifact-mode phase `design-delta`:** the brownfield-adherence checks (cites committed DeepWiki; extends existing seams per code-graph; no parallel structure) **plus** delta criteria: constitution compliance (hard criterion — any invariant violation fails regardless of weighted score), breaking changes justified, and the standard completeness/traceability/specificity/consistency/actionability weights applied to the amendment document. Verdict written to `specs/reviews/design-delta-eval.json` and shown at GATE 2.

**Registration:** every new gate/sensor is added to `HARNESS.md` + `harness-manifest.json` (validated by `validate-harness-manifest.js` / `npm test`).

## 5. Ease of use (first-class requirement)

- **One command, zero required flags:** `/sprint prd-sprint2.md`. Sprint number, baseline need, and DeepWiki freshness are auto-detected. `--autonomous` is the only optional flag in v1.
- **Wrong-door protection:** `/build` on an existing system redirects to `/sprint`; `/sprint` on an empty repo redirects to `/build`. `/feature` remains the door for ad-hoc single stories; its impact classifier decides whether design machinery engages — the user never chooses.
- **Gate ergonomics:** each gate is a single screen — short summary first (what changed, what breaks, rubric verdict), evidence (diffs, reports) linked below; one approve/revise prompt.
- **`/status` integration:** the pipeline-status CLI shows the sprint lane (current sprint, phase, gate awaiting).
- **Scaffold seeds everything:** `/scaffold` creates the `sprint-N` dir conventions, `constitution.md` template, and amendments patterns — no manual setup in target projects. README gains a "Sprint 2 in one command" quick-start.

## 6. Error handling

| Failure | Behavior |
|---|---|
| Design-delta rubric fails 3× | Stop; surface failing criteria + amendment draft to human. No silent proceed. |
| oasdiff breaking change, no justification | Hard block at the deterministic gate (before rubric). |
| Missing prior requirement spine in `/brd --delta` | Fail loud (vacuous-pass class), point at baseline recovery. |
| Baseline recovery low confidence | `derived-from-code` + flagged sections in baseline artifacts; human corrects at the one-time baseline approval. |
| Amendment edited after approval | Blocked by append-only convention + provenance check; correction = new amendment. |
| `specs/design/**` changed without amendment | Pre-commit provenance sensor fails the commit. |

## 7. Testing (real-artifact round-trips only — CLAUDE.md principle #5)

- Amendment files round-trip through their real validator (schema + provenance check), never hand-built fixtures.
- oasdiff gate tested against real generated `api-contracts.schema.json` pairs (one benign change, one breaking-with-justification, one breaking-without → block).
- `/brd --delta` grounding tested against a real prior spine produced by the real `/brd` path.
- Impact classifier unit tests over real `code-graph.json` slices (invisible story, contract-touching story, new-module story).
- Scaffold-copy test extended for new templates (constitution, amendment patterns); skills-consistency and harness-manifest validation cover the new skill modes and sensors.
- Final whole-branch review on the strongest model before merge (standing discipline).

## 8. Out of scope (v1, deliberate)

- Versioned per-sprint design snapshots (git history + amendments are the record).
- Full bidirectional `/sync` design regeneration (drift *detection* via `drift-report.js` stays).
- LLM-based code-vs-design conformance checking (deterministic sensors remain the enforcement layer, per Thoughtworks fitness-function guidance).
- Zero-gate `--auto` mode for `/sprint`.
- Auto-merge, multi-repo sprints.

## 9. Implementation surface (summary)

| Piece | Kind | Touches |
|---|---|---|
| `/sprint` conductor | New skill | `.claude/skills/sprint/SKILL.md` (+ command registration) |
| `/design --delta` | Mode in existing skill | `.claude/skills/design/SKILL.md`, planner agent prompt |
| Baseline recovery | Step inside `/sprint` Phase 0 | reuses `/brownfield` + a design-recovery planner pass |
| `/brd --delta` | Mode in existing skill | `.claude/skills/brd/SKILL.md` + grounding script |
| `/spec` sprint mode | Small mod | `.claude/skills/spec/SKILL.md` |
| Impact classifier | New script + `/feature` wiring | `.claude/scripts/`, `.claude/skills/feature/SKILL.md` |
| `design-delta` rubric | New evaluator artifact phase | `.claude/agents/evaluator.md` |
| Amendment-provenance sensor | New pre-commit check | `.claude/scripts/`, git-hook wiring, HARNESS.md registry |
| Constitution template | New template | `/scaffold` seed set, `/design` full-mode final step |
| `/status`, README, HARNESS.md | Docs/registry | respective files |

Grounding for this design: 2026-07-04 three-track audit (greenfield pipeline map, brownfield lane map, external research on Devin/Kiro/Spec Kit/Factory/Thoughtworks) — see memory note `sprint-evolution-gap-2026-07-04`.
