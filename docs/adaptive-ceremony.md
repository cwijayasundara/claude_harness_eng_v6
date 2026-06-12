# Adaptive ceremony — re-baseline the harness per model generation

Harness structure that was load-bearing for one model generation becomes drag
for the next. Anthropic's harness-design work documented this directly: sprint
decomposition was *necessary* for Opus 4.5 and became *optional* on Opus 4.6,
while the independent evaluator stayed worth its cost ("worth it when the task
sits beyond what the current model does reliably solo"). Ceremony is a dial,
not a constant — and the dial must be re-measured, not guessed.

## The knob

`project-manifest.json` → `execution.ceremony`:

| Value | Behavior |
|---|---|
| `full` (default) | Current pipeline exactly as documented in `/auto` |
| `trimmed` | Single-story groups skip sprint decomposition (straight to contract + implement); design-critic GAN loop caps at 3 iterations instead of 10 |

Two components are **never** trimmed, at any setting:

- **The independent evaluator.** Self-evaluation bias does not improve with
  model capability; an agent grading its own work over-praises it regardless
  of generation. Gates 5/7/8 run in every profile.
- **The deterministic gates** (hooks, ratchet, contracts). They cost almost
  nothing and they are the part that does not depend on the model behaving.

## The re-baselining ritual

Run this when the orchestrator or teammate model changes generation (not for
patch releases):

1. Pick one representative story group from a real project (mid-complexity,
   touches API + UI).
2. Run it twice from the same base commit: once at `ceremony: full`, once at
   `trimmed`. Same model, same prompts.
3. Compare: evaluator verdict, gate failures, fix cycles, wall-clock, cost.
4. Decide per component: a component earns its place only if removing it
   degraded the outcome (not just changed the style). Record the decision and
   the evidence in this file's changelog below.
5. Default new projects to the cheapest profile that held quality.

Do not trim from memory of an older model's failures, and do not add ceremony
to compensate for a weakness the current model no longer has.

## Changelog

| Date | Models | Decision | Evidence |
|---|---|---|---|
| 2026-06 | Opus 4.8 / Fable 5 orchestrators, Sonnet 4.6 teammates | `full` remains default; `trimmed` available per-project | Knob introduced; no measured run yet — first re-baseline owed at next model-generation change |
