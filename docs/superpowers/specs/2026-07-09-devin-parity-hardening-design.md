# Devin/Anthropic/Thoughtworks parity hardening — 3 items

**Date:** 2026-07-09
**Why:** a 2026-07-09 deep-research pass (memory: `devin-anthropic-thoughtworks-comparison-2026-07-09.md`) compared this harness's generator/evaluator + ratchet-gate + sprint-PRD design against current public practice from Cognition/Devin, Anthropic, and Thoughtworks. The core architecture matches or exceeds documented industry practice (ratchet-gate breadth, `/sprint`'s PRD-per-sprint grounding). Three concrete, narrower-than-first-reported gaps survived scoping and are closed here.

## Scope (decided)

- **Item 2 (learned-rules propagation)** turned out to be the cheapest and most concrete: `.claude/state/learned-rules.md` already exists and is already injected verbatim into `/auto`, `/implement`, and `/refactor` — it just isn't wired into `/change`, `/vibe`, `/sprint`, or `/feature`. This closes a wiring gap in an existing mechanism, not a new one.
- **Item 3 (generator-verifier self-audit)** is documentation-first: `evaluator.md`, `security-reviewer.md`, and `design-critic.md` already use explicit weighted/scored rubrics (not a bare accept/reject), and `/auto` already has three independent oscillation backstops. The audit makes this an explicit, cited claim in `HARNESS.md` rather than an implicit property, and fixes any concrete hole found while drafting it (none currently known — see §2).
- **Item 1 (bounded N-way re-verification)** is the one genuinely new mechanism. Scoped down from Devin's cloud-fleet pattern (10-20 parallel instances) to 3 independent passes, majority vote, and **`/gate` only** — not `/auto`'s per-group Gate 7, which fires the same boundary trigger far more often and would otherwise put new pressure on the wall-clock/spawn/cost budget cap.
- **Rejected alternative — apply Item 1 inside `/auto`'s Gate 7 too.** Rejected: multiplies review cost on every security/data/API-touching story group during autonomous building, not just once at merge time; `/gate` already runs before every merge regardless of how the change got there, so the extra confidence is captured at the point that matters without the recurring cost.
- **Rejected alternative — escalate to human on a genuine Item-1 vote split.** Rejected in favor of fail-safe-to-BLOCK/FAIL: with 3 voters a clean 2-of-3 is always achievable except when a pass errors out, and the harness's existing bias throughout (security gate, mutation gate, legacy-discipline gate) is to fail closed rather than open a new human-escalation path for a rare failure-to-return case.
- **Rejected alternative — build a new prompt-distillation "session insights" mechanism from scratch** (the literal reading of the research finding). Rejected once investigation showed `learned-rules.md` already does the equivalent job (distilled, reusable, project-scoped rules carried forward across sessions) — the gap was propagation, not the absence of a mechanism.

## §1 — Learned-rules propagation (`/change`, `/vibe`, `/sprint`, `/feature`)

Add the same step `/auto`, `/implement`, and `/refactor` already have (see `.claude/skills/auto/SKILL.md` line ~90, ~216) to each of the four skills' context-gathering step, immediately before the skill begins editing:

> Read `.claude/state/learned-rules.md`. If it exists and is non-empty, inject its contents verbatim into your working context before making any edits.

Placement per skill:
- **`/change`** — in the existing context-gathering step (alongside reading `component-map.md`/DeepWiki), before Step S4 (red test).
- **`/vibe`** — in the existing eligibility/context step, before the micro-contract is finalized (so a learned rule can inform scope, not just implementation).
- **`/sprint`** — once, in the shared `/auto` invocation at the end of the sprint flow — `/sprint` already delegates building to `/auto`, which already injects `learned-rules.md`, so **no change needed here**; confirmed by reading `sprint/SKILL.md`'s Step where it hands off to `/auto`, not duplicated.
- **`/feature`** — in its own context-refresh step, before it routes to `/vibe`/`/change`/`/refactor`/`/build` — since those downstream lanes each get the injection themselves (per this item, once shipped), `/feature` needs it only for its own routing/story-creation reasoning, not as a pass-through.

No new file format, no new promotion logic. `review-on-stop.js`'s CLAUDE.md-suggestion path (the human-mediated promotion step) is unchanged.

## §2 — Generator-verifier failure-mode self-audit (`HARNESS.md`)

Add a new subsection under "Steering loop (the human layer)" in `HARNESS.md`, after the existing paragraph naming `program.md`/`learned-rules.md`/`review-on-stop.js`:

```markdown
### Self-audit against Anthropic's named generator-verifier failure modes

Anthropic's engineering writing on the generator-verifier pattern names two specific
failure modes. This harness's rubric agents and `/auto`'s convergence loop were
checked against both, 2026-07-09:

- **Rubber-stamping** ("a verifier told only to check whether output is good, with
  no further criteria, will rubber-stamp"): `evaluator.md`'s artifact mode uses a
  weighted 5-criteria rubric with a hard `>= 7.0` average and `>= 5` per-criterion
  floor; runtime mode requires all three verification layers plus the security gate
  plus the perf ratchet to independently pass — never a bare accept/reject.
  `security-reviewer.md` requires a mandatory find-then-refute adversarial pass
  before any BLOCK finding survives. `design-critic.md` scores 4 named criteria on
  a defined 1-10 rubric with worked calibration examples. None of the three ever
  emits an unstructured "looks good."
- **Oscillation without convergence** ("if the generator can't address the
  verifier's feedback, the system oscillates without converging"): `/auto` has
  three independent backstops — a 50-total-iteration hard stop, a 3-consecutive-
  failed-self-heal per-story escalation (marks BLOCKED, logs to `failures.md`,
  extracts a learned rule, moves on rather than looping forever), and a wall-clock/
  agent-spawn/est-cost budget cap checked every iteration. `/change` and `/vibe`
  contain risk by **scope** instead of iteration count — escalate out of the lane
  the moment a fix would expand past its micro-contract — a deliberate,
  blast-radius-appropriate alternative to iteration capping, not a gap.

No fix was required by this audit; it documents and cites existing coverage.
```

If drafting surfaces a genuine, concrete hole (not currently expected — see Scope), fix it inline in this same change and note it in this subsection rather than filing a separate follow-up.

## §3 — Bounded N-way re-verification at `/gate`

**Where:** `.claude/skills/gate/SKILL.md`, the existing security-trigger step (the deterministic boundary check already gating whether `security-reviewer` + the computational security scan run).

**Change:** when the trigger fires, spawn **3 independent instances each** of `security-reviewer` and `evaluator` via the `Agent` tool — fresh context per instance, no shared conversation. Each instance runs its full existing process unmodified (security-reviewer's own find-then-refute stays intact per instance; evaluator's three-layer run stays intact per instance).

**Vote resolution:** majority (2-of-3), voted independently per axis (security PASS/BLOCK; functional PASS/FAIL — these can legitimately disagree). A non-clean majority (an instance errors/times out rather than returning a verdict) fails safe to the stricter outcome (BLOCK/FAIL).

**Verdict files:**
- `specs/reviews/security-verdict.json` and the evaluator's existing verdict output are written exactly as today, sourced from one designated instance (the first spawned) — every existing consumer (`evaluator.md`'s hard-gate read, `/auto`, `/change`) is untouched.
- New: `specs/reviews/reverify-votes.json` —
  ```json
  {
    "gate": "gate-reverify",
    "trigger": "security-boundary",
    "security": {
      "votes": ["pass", "pass", "fail"],
      "majority": "fail",
      "fail_safe_triggered": false
    },
    "functional": {
      "votes": ["pass", "pass", "pass"],
      "majority": "pass",
      "fail_safe_triggered": false
    },
    "timestamp": "<ISO 8601>"
  }
  ```
  Records all 3 raw verdicts per axis, the majority decision, and whether fail-safe fired. Audit trail only — no existing code reads this file.

**Scope boundary:** `/gate` only. `/auto`'s per-group Gate 7 (`.claude/skills/auto/SKILL.md` line ~434, ~553-557) is untouched — it keeps its existing single-pass security review during autonomous building. The final `/gate` check before merge is where the extra confidence is captured, once per merge rather than once per story group.

## §4 — Registry + docs

- `harness-manifest.json`: no new sensor entry — Item 1 extends `/gate`'s existing security-review orchestration (not itself a separate manifest entry today), Item 2 extends an existing guide's reach, Item 3 is documentation. No manifest schema change.
- `HARNESS.md`: §2's new self-audit subsection (this is the only `HARNESS.md` content change); the Steering loop paragraph's existing `learned-rules.md` description is unchanged (still accurate — this closes wiring, not the mechanism's description).
- `README.md`: no change — `/gate`'s existing one-line description ("Evaluator + diff review, with security review only when the diff crosses a security/data/API boundary") remains accurate; the re-verification detail is gate-internal, not part of the command's public contract.

## §5 — Tests

- **Item 1:** a `/gate` test fixture proving (a) the boundary trigger causes 3 spawns of each agent type rather than 1, (b) majority vote resolves a 2-1 split to the majority outcome, (c) an errored/missing third instance triggers the fail-safe BLOCK/FAIL path, (d) `reverify-votes.json`'s shape doesn't alter `security-verdict.json`'s existing shape or any downstream consumer's read path (re-run `test/gate-*.test.js` — whatever currently covers `/gate`'s security trigger — unmodified, to confirm no regression).
- **Item 2:** a skill-consistency-style test (mirrors `test/skills-consistency.test.js`) asserting `change/SKILL.md`, `vibe/SKILL.md`, and `feature/SKILL.md` each reference reading `.claude/state/learned-rules.md`. `sprint/SKILL.md` is asserted to delegate to `/auto` rather than duplicate the injection (confirms §1's "no change needed" claim stays true, not just true today).
- **Item 3:** no test — documentation only, same convention as other doc-only gaps in this harness (e.g. G24's scaffold-prompt discoverability fix had no dedicated test either, being prose/documentation).

## Risks & mitigations

- **Item 1 triples security/evaluator agent cost at `/gate`.** Mitigation: scoped to `/gate` only (on-demand, once per merge), explicitly not `/auto`'s recurring Gate 7 — see Scope's rejected alternative.
- **Item 1's fail-safe-to-BLOCK could false-positive-block a merge on a transient agent error, not a real finding.** Mitigation: `reverify-votes.json` names which instance errored and why, so a human re-running `/gate` (transient failures don't reproduce) is a one-command recovery, not a dead end.
- **Item 2 makes `/vibe` (meant to be lightweight) read an extra file on every invocation.** Mitigation: the read is conditional on the file existing and non-empty, and injection is the same low-cost verbatim-text pattern `/auto` already uses at much higher frequency — no meaningful overhead added.
- **Item 3's audit could go stale as agents are edited later without re-checking the cited evidence.** Mitigation: none added beyond normal doc-maintenance discipline — this is a point-in-time audit, explicitly dated, not a live-checked invariant; out of scope to make it self-verifying.

## Out of scope

- A new, from-scratch "session insights" prompt-distillation mechanism — superseded by §1's finding that `learned-rules.md` already serves this purpose; only its propagation was missing.
- Applying Item 1's re-verification inside `/auto`'s Gate 7 — rejected, see Scope.
- Any change to `evaluator.md`, `security-reviewer.md`, or `design-critic.md`'s actual scoring rubrics or criteria — Item 3 audits and documents existing rubrics, it does not change them (no gap found requiring a change).
- Escalate-to-human handling for Item 1 vote splits — rejected in favor of fail-safe, see Scope.

## Known limitations

- Item 1's 3-instance majority vote adds confidence against a *single instance's* blind spot or non-determinism; it does not add confidence against a *systemic* blind spot shared by all instances (e.g., a vulnerability class `security-reviewer.md`'s own category list doesn't cover) — voting three copies of the same rubric doesn't diversify the rubric itself. Out of scope here; a genuinely different lens per vote (the research's own "perspective-diverse verify" idea) is a larger, separate design.
- Item 2's propagation is one-way (rules flow from `/auto`/`/implement`/`/refactor` outward to the smaller lanes) — a rule discovered during a `/vibe` micro-fix is not itself promoted to `learned-rules.md` unless a human runs the existing Stop-hook review-and-promote flow. This matches the existing mechanism's design (promotion is deliberately human-mediated) and is not a new gap introduced here.
