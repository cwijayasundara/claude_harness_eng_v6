# Evolution-Loop Harness Mechanism — Design Spec

**Status:** Design (ready for implementation-plan)
**Date:** 2026-07-17
**Branch:** `evolutionary-arch-patterns`
**Implements:** [Reuse-or-Justify](../../patterns/reuse-or-justify-evolution.md) + [Performance Budgets as Ratchets](../../patterns/performance-budgets-as-ratchets.md)

---

## 1. Goal & scope

Wire the two evolutionary-architecture patterns into this harness so that sprint-by-sprint builds cannot silently (a) clone existing structure or (b) regress performance. The mechanism must reuse the harness's existing gate chassis, living-design baseline, and code-graph — **net-new surface is minimized deliberately** (the user is wary of harness bloat; this design retires one coarse control while adding focused ones, see §10).

**In scope:** an intake dialogue, seam metadata on the existing design artifacts, and stage-4 structural + performance fitness functions, wired into `/change`, `/feature`, `/sprint`, `/auto`, `/gate`.

**Out of scope:** a new command (reuse existing lanes); a new gate framework (reuse `gate-registry.js`); versioned design snapshots; changing the human-gate model (GATE 1/2 stay).

## 2. Decisions carried in from brainstorming

| Decision | Choice |
|----------|--------|
| Gate posture | **B** — stage-2 firing is confidence-gated; the stage-3 decision hard-gates; stage-4 is a hard ratchet |
| Batch scope | **(2)** — new-vs-existing **and** intra-batch (same-release clone detection) |
| Performance | **Companion axis** — separate pattern, same enforcement chassis |
| Dialogue timing | **At intake gates, before `/auto`** — decisions pre-resolved at GATE 1/2, `/auto` executes against them, stage-4 catches deviation |
| Seam registry | **Extend `component-map` / `design-traces.json`** — no new artifact |
| Confidence threshold | Per-project config, sane default |

## 3. The six components

### C1 — Intake dialogue skill (`.claude/skills/reuse-or-justify/SKILL.md`)
A shared, confidence-gated dialogue invoked from the intake step of `/change` (single story), `/feature` (feature), and `/sprint` (release batch). One skill, three entry points.

- **Input:** the story/feature/story-batch + the grounding pack from C3.
- **Firing rule:** runs the dialogue **only** when C3 returns a reuse candidate scoring ≥ `reuse_threshold` **or** a touched constitution invariant. Otherwise emits `decision: net-new, auto` and proceeds (no human stop).
- **Dialogue:** one question at a time (mirrors `superpowers:brainstorming` cadence), scoped to the three evolution-decision types (reuse-vs-new / invariant-impact / contract-impact) from the pattern doc §4. For a **feature/release batch**, it first runs the intra-batch pass (C3) and asks the "these N stories share a seam — consolidate?" question before per-story questions.
- **Output:** appends a **decision record** (C4) per resolved fork, including the named seam and — for any new/extended seam — its declared **performance budget** (mandatory; missing budget = intake fail).
- **Autonomy:** in `/auto`, this skill does **not** run — all its decisions were already recorded at GATE 2. `/auto` reads the recorded decisions; if it encounters work with no matching decision, it stops and surfaces the gap (fail-loud, not best-guess).

### C2 — Seam metadata (extend `component-map` + `design-traces.json`)
No new file. Add optional fields to existing rows:

- `component-map` row gains: `seam: true|false`, `extension_mechanism: "config" | "strategy" | "node" | "subclass" | null`, `instances: [<ids>]`, `budget: { latency_ms_p95?, mem_mb_peak?, throughput_rps?, tokens_per_task?, cost_per_run? }`.
- `design-traces.json` gains per-component: `extends_seam: <seam-id> | null` and `budget_inherited_from: <seam-id> | null`.
- A seam is just a component flagged `seam: true` with an `extension_mechanism`. The "registry" is the set of such rows — queryable, but stored in artifacts that already exist and already have validators.

### C3 — Grounding / reuse-scout (`.claude/scripts/reuse-scout.js`)
Deterministic. Given a story/feature (+ batch), returns ranked reuse candidates with evidence and a score.

- Reuses `code-graph.json` + `modularity-pack.js` `duplicationCandidates()`, **upgraded** from the import-set heuristic to the real clone signal from C5.
- Score combines: seam-name/responsibility match against `component-map` seams, clone-similarity to existing instances, and touched-invariant detection.
- **Intra-batch mode:** when handed multiple stories, also scores stories pairwise against each other (the same-release-twins case single-story scope can't see).
- Output feeds C1's firing rule.

### C4 — Decision record (extend `amendments/` + `design-traces.json`)
Reuses the existing immutable amendment mechanism. Each resolved fork appends: `{ decision: "extend"|"new-seam"|"net-new", seam: <id>, options_considered, justification, invariant_impact, budget }`. Immutable (a correction is a new record). This is what C6 verifies against.

### C5 — Stage-4 structural enforcement
Two gates, registered in `gate-registry.js` + `harness-manifest.json`, ratcheted like `cycle-gate`/`coupling-gate`:

- **`duplication-gate.js`** — wraps a real AST/token clone detector (**jscpd**, multi-language: JS/TS + Python + more). Baseline in `.claude/state/duplication-baseline.json`. Blocks when new duplication rises above baseline. Runs in two modes: changed-vs-existing, and **whole-tree for net-new files + intra-batch for multi-file commits** (closes the net-new blind spot). Replaces the coarse import-set heuristic as the duplication signal.
- **`seam-conformance-gate.js`** — reads the C4 decision for the increment; if it said `extend seam X`, verifies the diff touched X's files and did **not** create a sibling module. Turns the human's promise into a machine constraint.

### C6 — Stage-4 performance enforcement
- **Static — `complexity.js`** (new, mirrors `length.js` ratchet shape): cyclomatic/cognitive complexity per function; blocks new/grown complexity over threshold. Wired into `pre-write-gate.js` (session cadence, all tiers) like `length.js`.
- **Static — `perf-smell-gate.js` rewiring:** the detector already exists but only runs at `/gate`. **Add it to `/auto`'s per-group gate list and the `gate-registry.js` GATE_CATALOG** so it runs per-commit, not just pre-PR. Extend its heuristics with algorithmic-hotspot (nested loop calling a similarity/DB/fuzzy fn; unbounded scan) and resource anti-patterns (per-call heavyweight-client instantiation, unbounded cache on large objects, double-parse).
- **Dynamic — `perf-baseline.js` upgrade:** ratchet against the **original** committed baseline (not the previous run) + a **cumulative-drift** field; tighten default regression threshold (50% → 15%). Already wired into the evaluator PASS gate.
- **Dynamic — `load-probe.js`** (new, opt-in via `project-manifest.json#observability`): a k6/locust wrapper that drives declared hot paths concurrently to surface pool exhaustion / lock contention. Opt-in because it needs a runnable environment.

## 4. Wiring into existing lanes

| Lane | Change |
|------|--------|
| `/change` | Intake calls C1 (single-story mode) before writing the test; records decision + budget |
| `/feature` | Scope classifier already routes; C1 runs at the feature-intake step (batch mode if epic) |
| `/sprint` | C1 runs inside GATE 2 design-amendment review (batch mode over the release's stories); decisions + budgets recorded in the amendment |
| `/auto` | Reads recorded decisions; runs C5 (duplication + seam-conformance) at Gate 4 alongside cycle/coupling; runs rewired `perf-smell-gate` per group; evaluator runs upgraded `perf-baseline` |
| `/gate` | Runs full C5 + C6 (incl. load-probe if enabled) pre-PR |

## 5. Config knobs (`project-manifest.json`)
```
"evolution": {
  "reuse_threshold": 0.6,          // C1 firing sensitivity
  "duplication_ratchet": true,
  "seam_conformance": true,
  "perf": { "regression_pct": 15, "load_probe": false }
}
```
All default-on except `load_probe` (needs environment). Thresholds tunable per project.

## 6. Testing approach
- **Real-schema round-trip** for every contract/artifact change (CLAUDE.md principle #5): decision records and seam metadata validated through the real validator, not hand-built fixtures.
- **Ratchet tests** for `duplication-gate` / `complexity`: prove they grandfather existing debt and block *new*/grown debt (the boundary cases — mirror `length.js`'s `newlyOversized` tests).
- **Fixture repo** with a known clone pair + a known O(n²) hotspot; assert each gate bites.
- **Seam-conformance:** a decision that says `extend X` + a diff that forks a sibling → must BLOCK.
- Whole-branch review on the strongest model before merge (principle #5).

## 7. Rollout phasing (each independently shippable)
1. **P0 — `duplication-gate.js`** (C5 clone detector + net-new/intra-batch modes). Highest leverage vs the audit; ship first, standalone.
2. **P1 — seam metadata (C2) + reuse-scout (C3) + dialogue skill (C1)** wired into `/change` first, then `/feature`/`/sprint`.
3. **P2 — `seam-conformance-gate.js` (C5)** — needs C1/C4 recording decisions to check against.
4. **P3 — performance axis (C6)**: `complexity.js`, `perf-smell` rewiring, `perf-baseline` upgrade, `load-probe`.

## 8. Non-goals
- No new top-level command. No parallel gate system. No versioned design snapshots. No change to GATE 1/2 human-gate model. No auto-refactor of existing debt (ratchets grandfather it).

## 9. Risks
- **jscpd Python fidelity** — validate clone detection on a Python fixture before committing to it; fall back to a tree-sitter clone pass on the existing code-graph if inadequate.
- **Dialogue fatigue** — if `reuse_threshold` is too low, C1 over-fires and trains rubber-stamping. Default conservative; measure fire-rate.
- **`/auto` fail-loud on missing decision** could halt long runs — acceptable (fail-loud > silent best-guess), but needs a clear operator message.

## 10. Harness control-budget impact
Net-new registered controls: `duplication-gate`, `seam-conformance-gate`, `complexity`, `load-probe` (+ `reuse-scout`/dialogue as non-gate tooling). **Retired:** the import-set duplication heuristic in `modularity-pack.js` (superseded by the real detector). Net add is small and every control closes a gap the motivating audit proved real — run `node .claude/scripts/validate-harness-manifest.js` after registration and record the control-budget delta per the existing meta-ratchet.
