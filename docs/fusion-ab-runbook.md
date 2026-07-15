# Fusion A/B runbook — `balanced` vs `fusion` (cheap-worker experiment)

**Question:** does routing per-story implementation to a cheaper worker model (Haiku 4.5, the `fusion` preset) lower **cost-per-passed-story** *at equal-or-better score* versus the current same-tier worker (Sonnet 5, the `balanced` preset)?

This is the measured decision behind Fusion idea #1 (Cognition, "Making Fable Cheaper Than Opus"): a per-token-cheaper worker can be *dearer per outcome* if it needs more evaluator/self-heal cycles. We don't guess — we run both arms and read the number.

Only `balanced` and `fusion` differ in exactly one pin: the `implementer` (per-story team worker) is **Sonnet 5** vs **Haiku 4.5**. Judgment (Opus) and the generator lead (Sonnet 5) are identical in both.

## Why two isolated project dirs (not one project, two sessions)

Per-arm receipt filtering **cannot** scope an arm: `build-chain.js` spawns a fresh `claude -p` per wave, so `session_id` fragments across a build, and `cost-per-outcome.js` reads *all* of `.claude/runs` against one whole-project `features.json`. Preset stamping (`model-tier.js --apply`) is also in-place and global, and you may not swap models mid-run (cache-prefix rule). So each arm gets its **own project dir** — own `.claude/runs`, own `features.json`, one-time stamp. Each project's receipts *are* the arm.

## Prerequisites

- `ANTHROPIC_API_KEY` set (`build-chain.js` shells out to `claude -p`).
- A **budget cap** per arm: `BUILD_CHAIN_MAX_BUDGET_USD` (set it — a runaway build is real money).
- The harness available as a plugin to each arm dir: point `HARNESS_PLUGIN_DIR` at this repo's control plane (`.claude`), the same way the `live` e2e layers do.
- **Fixture:** reuse a small `live` e2e PRD (e.g. the one `test/e2e/harness-auto-run.test.js` feeds `freshProject`) as the story-group input — no new fixture needed. Both arms build the **same** PRD.
- The arms **cannot overlap** (in-place stamp + cache rule): run them serially, or in two clones.

## One-command orchestration (`ab-run.js`)

Once both arm dirs are **scaffolded** (see below — that step stays manual, it's the model-driven `/scaffold` flow), `ab-run.js` runs the whole deterministic protocol: stamp each arm's own control plane, drive each arm's build with the budget cap, snapshot, and compare.

```bash
# DRY-RUN (default): print the exact plan, validate prereqs, spend/mutate nothing.
node .claude/scripts/ab-run.js <PRD> <BALANCED_DIR> <FUSION_DIR>

# EXECUTE: run both arms serially (billed). --budget and ANTHROPIC_API_KEY required.
node .claude/scripts/ab-run.js <PRD> <BALANCED_DIR> <FUSION_DIR> --budget 10 --execute
```

Guardrails: dry-run is the default (nothing runs without `--execute`); `--execute` refuses without a positive `--budget` and `ANTHROPIC_API_KEY`; each arm's `HARNESS_PLUGIN_DIR` points at its **own** stamped `.claude` so the presets can't collide; and if a preset **stamp** fails, that arm's build is **skipped** (no spend on a wrong-model arm) and the run is marked VOID. Writes `.claude/state/ab-run.json`.

The manual per-arm steps below are what `ab-run.js` automates — run them by hand only to debug an arm.

## Per-arm protocol (manual / underlying)

Run this once per arm. `<ARM>` ∈ {`balanced`, `fusion`}; `<ARM_DIR>` is that arm's isolated project dir; `<PRD>` is the shared PRD path.

```bash
# 1. Fresh, isolated project dir seeded with the shared PRD (follow the e2e
#    fresh-project + scaffold pattern; HARNESS_PLUGIN_DIR points at this repo).
#    Result: <ARM_DIR> with the harness control plane + <ARM_DIR>/prd.md.

# 2. Stamp the preset into that arm's agents (mutates <name>.md `model:` in place).
cd <ARM_DIR>
node <HARNESS>/.claude/scripts/model-tier.js <ARM> --apply .claude/agents
#    ...and set execution.model_tier=<ARM> in <ARM_DIR>/project-manifest.json
#    so cost-report/pricing read the same posture.

# 3. Run the build headlessly, capped. (fusion stamps implementer=Haiku 4.5.)
BUILD_CHAIN_MAX_BUDGET_USD=<cap> HARNESS_PLUGIN_DIR=<HARNESS>/.claude \
  node <HARNESS>/.claude/scripts/build-chain.js prd.md

# 4. Snapshot this arm's outcome + cost + loop-health (writes the artifacts
#    ab-report reads: .claude/state/cost-per-outcome.json, specs/retro/loop-health.json).
node <HARNESS>/.claude/scripts/cost-per-outcome.js --json
node <HARNESS>/.claude/scripts/loop-health.js
```

## Compare

```bash
node <HARNESS>/.claude/scripts/ab-report.js <BALANCED_DIR> <FUSION_DIR>
# add --json for the machine-readable verdict; writes .claude/state/ab-report.json
```

`ab-report` reads each arm's `cost-per-outcome.json` (run-total cost, passed/total, cost-per-passed-story, inferred tier) and `loop-health.json` (turns-per-dispatch), and returns a verdict:

- **winner** = the arm with the lower cost-per-passed-story **only if** its pass-rate is `>=` the other's (equal-or-better score). Cheaper-but-worse → *no clear winner*.
- one arm passed 0 → *inconclusive*, naming it; both 0 → *inconclusive*.
- a missing/unreadable arm artifact → *arm-missing*, naming it.

## Reading the result

- **`fusion` wins** (cheaper per passed story, score held): adopt it, then build the Phase-2 **complexity router** — route small/medium stories to the Haiku worker, keep complex ones (auth, schema migration, low plan-confidence, ambiguous ACs, serial-debug chains) on the stronger worker. Signals already exist: `team-policy.js` file-counts, `plan-confidence.js`, `impact-classifier.js` boundary, brownfield `risk-map`/`seam-confidence`.
- **`fusion` cheaper but score dropped** (the likely failure mode — Haiku has no `effort` lever, a 200K window, and is vendor-positioned for *simple* tasks): keep `balanced`, or try the fallback asymmetry **Sonnet worker under an Opus lead** (a `max-quality`-style lead + Sonnet implementer) as a separate arm.

## Caveats (baked into the instruments)

- **Cost is a surfaced estimate** (Σ receipts × per-model price). Real builds carry token fields, so pricing is per-model-exact; prefer OTEL/`cost-report` for billed truth.
- **Attribution is per-GROUP** (`story_id` is often `none`).
- **Tier label is inferred**, not stamped — `cost-per-outcome.js` distinguishes `fusion` (Haiku implementer) from `cost` (Haiku explorer) by which agent carries the Haiku pin.
- **One trial is a signal, not proof.** Re-run each arm ≥2–3× on the same PRD (evaluator/model variance) before trusting the delta; the verdict is directional.
