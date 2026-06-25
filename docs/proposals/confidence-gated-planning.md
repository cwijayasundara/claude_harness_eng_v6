# Proposal: Confidence-Gated Planning Checkpoint

Status: Draft (design narrative — not yet implemented)
Author: harness maintainers
Roadmap link: S2 "symphony Planning state" in `autonomous-engineer-roadmap` memory.

## Problem

`/build --auto` spends the **entire** build budget (Phases 4–11) before any human
sees a result. Its only pre-spend signal is the plan written to `specs/`, which a
headless run never pauses on. `/build --autonomous` does pause once — Phase 3.5 — but
that gate is a **binary approve** with no signal of *how sure the planner is*. A human
approving a confidently-wrong plan and a human approving a guess look identical.

The worst failure mode is therefore invisible: the ratchet, evaluator, security, and
Phase 9.5 gates all verify that the code is **correct against the spec** — none of them
verify that the **spec is what the user meant**. A flawless build of the wrong thing
passes every machine gate we have.

Devin addresses exactly this with an *Interactive Planning Checkpoint* plus a
**confidence rating (low/medium/high)**: when confidence is not high, it digs deeper or
asks clarifying questions *before consuming compute*. We have all the raw material to do
the same — we just don't compute or act on a confidence signal.

## Goal

Emit a deterministic **plan-confidence score** from the planner, and let each build lane
*act* on it:

- `--autonomous`: show confidence + its drivers at the Phase 3.5 gate (better-informed approval).
- `--auto`: **auto-pause for clarification when confidence is below threshold**, instead of
  building blind. This is the only behavioral change to the zero-gate lane, and it fires
  *only* on low confidence.
- `--lite --auto`: reuse the existing eligibility auto-escalation path; low confidence is
  one more escalation trigger.

Non-goal: replacing human judgment at Phase 3.5, or weakening any machine gate. Confidence
gates **planning**, never verification.

## Design

### 1. The confidence score is derived, not guessed

The planner already produces every signal we need; we only need to count them. Confidence
is computed from artifacts the planner writes in Phases 1–3 (no new LLM judgment call,
so it is cheap and reproducible):

| Signal | Source (already written today) | Lowers confidence when… |
|---|---|---|
| Unresolved assumptions | BRD `Assumptions` section (`specs/brd/brd.md`) | count is high relative to requirement count |
| Open questions | BRD `Open Questions` section | any remain unanswered |
| `needs_breakdown` stories | `specs/stories/backlog-needs-breakdown.md` | any story could not be made `ready` |
| Acceptance-criteria thinness | story files (`min 3` rule in planner) | stories sit at the floor with vague criteria |
| Missing schema coverage | planner Quality Gates (endpoints↔schema, entities↔schema) | any gate is satisfied only by placeholder |
| Brownfield risk conflicts | `specs/brownfield/risk-map.md` vs proposed changes | plan touches high-risk seams without a strategy |
| PRD grounding gaps | `--auto`/`--autonomous` PRD vs derived fields | fields were inferred rather than stated |

Score → band (tunable in `calibration-profile.json`, defaults shown):

- **high** — 0 open questions, 0 `needs_breakdown`, ≤1 assumption per epic, all schema gates substantive.
- **medium** — minor assumptions or 1 thin story; implementable, low risk if proceeded.
- **low** — any open question, any `needs_breakdown` reaching implementation, or a brownfield
  risk conflict with no strategy.

All seven signals are computed deterministically by `plan-confidence.js` from the
planning artifacts — including schema gaps (hollow definitions left in the design
schemas) and brownfield conflicts (high/critical risk-map seams with no
`change-strategy.md`). No planner side-channel or hand-editing is involved.

The planner writes the result to a new artifact:

```jsonc
// specs/plan-confidence.json
{
  "band": "low",
  "score": 0.42,
  "drivers": [
    { "signal": "open_questions", "detail": "2 unanswered in BRD", "weight": -0.3 },
    { "signal": "needs_breakdown", "detail": "E2-S3 not decomposable", "weight": -0.2 }
  ],
  "computed_at": "<iso8601>",
  "threshold": 0.6
}
```

This file is the single contract every consumer reads — keeps the logic in one place and
out of prompts (cache-safe).

### 2. Lane behavior

**`--autonomous` (Phase 3.5).** The consolidated gate already presents BRD + stories +
design + test plan. Add the confidence band and its top drivers to that summary, and make
the question confidence-aware:

- high → `"Approve this plan to build autonomously through to an open PR?"` (unchanged).
- medium → same question, with drivers listed so the human can weigh them.
- low → lead with the drivers and recommend `/clarify` before approval:
  `"Plan confidence is LOW (2 open questions, 1 undecomposable story). Recommend resolving
  these before an unattended run. Clarify now, approve anyway, or stop?"`

**`--auto` (the zero-gate lane).** Today Phase 3.5 is skipped entirely. Change: after
Phase 3 writes `plan-confidence.json`, read the band.

- high / medium → proceed to Phase 4 exactly as today (still zero human stops).
- low → **auto-invoke `/clarify` headlessly first.** `/clarify` already resolves from local
  context and records assumptions without a human (its "Before Asking" path). It only
  surfaces to the human for the residue it genuinely cannot decide. Re-compute confidence
  after clarify:
  - now high/medium → proceed (the run stayed autonomous, just better-grounded).
  - still low and unresolved questions remain → **pause and surface** the open questions,
    exactly as `--auto` already pauses when no usable PRD is supplied. This is consistent
    with the existing rule "stop and say so rather than inventing requirements."

The key property: `--auto` stays headless on good inputs and only ever stops when the plan
is genuinely under-determined — which is the same bar the lane already applies to a missing
PRD.

**`--lite --auto`.** Low confidence joins the existing eligibility caps as an escalation
trigger: a low-confidence lite plan auto-escalates to the full `--auto` pipeline (which has
the clarify-on-low path above) rather than compressing ambiguity into 5 stories. Log the
reason, as eligibility escalation already does.

### 3. Surfacing in `/status`

`pipeline-status.js` already renders a one-shot snapshot. Add one line, read from
`plan-confidence.json`:

```
Plan:      confidence=low (2 open questions, 1 needs_breakdown)  threshold=0.60
```

Absent file → omit the line (backward compatible; pre-existing runs are unaffected).

## Files to change

| File | Change |
|---|---|
| `.claude/agents/planner.md` | After Step 5, compute and write `specs/plan-confidence.json` from the signals in §1. Add to Quality Gates: "confidence artifact written." |
| `.claude/scripts/plan-confidence.js` *(new)* | Pure function: read BRD/stories/schemas/brownfield, emit band+score+drivers. Deterministic, unit-testable, no model call. Mirrors `build-chain-state.js` style. |
| `.claude/skills/build/SKILL.md` | Phase 3.5: render confidence + drivers; confidence-aware question. `--auto`: clarify-on-low path before Phase 4. |
| `.claude/skills/build/references/lite-lane.md` | Add low confidence to the auto-escalation triggers. |
| `.claude/scripts/pipeline-status.js` | Add the `Plan:` line when `plan-confidence.json` exists. |
| `calibration-profile.json` (template) | Add `plan_confidence.threshold` and per-signal weights (defaults baked in script). |
| `test/plan-confidence.test.js` *(new)* | Cover band boundaries: clean plan → high; one open question → low; thin stories → medium; brownfield conflict → low. |

## Edge cases & non-goals

- **No regression to clean runs.** A well-specified PRD yields high confidence → every lane
  behaves exactly as today. The feature is invisible until a plan is actually shaky.
- **Don't loop.** `/clarify` runs **once** in the `--auto` low path. If still low afterward,
  pause — never re-clarify in a loop (matches clarify's own stop conditions).
- **Cache safety.** All state lives in `plan-confidence.json`, read by scripts/skills — no
  new always-injected prompt content, so the cached prefix is untouched.
- **Confidence ≠ correctness.** A high-confidence plan can still be wrong; this gates
  *ambiguity*, not truth. The machine gates remain the correctness authority and are unchanged.

## Rollout

1. Land `plan-confidence.js` + tests (pure logic, no pipeline wiring) — safe to merge alone.
2. Wire the planner to write the artifact (additive; nothing reads it yet).
3. Add the `/status` line (read-only surfacing).
4. Wire Phase 3.5 display, then the `--auto` clarify-on-low path (the only behavior change).
5. Add lite escalation trigger.

Each step is independently shippable and reversible; the behavior change (step 4) lands last,
behind everything that makes it observable.
