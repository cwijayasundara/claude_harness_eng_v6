---
name: spec
description: "[Internal pipeline stage — run by /build; invoke directly only as a power user.] Shape the decomposition with the human — milestone scope, epic boundaries, real-vs-defensive dependencies — then dispatch spec-render to expand those decisions into the story graph."
argument-hint: "[path-to-BRD]"
---

# Spec Skill — Decomposition Shaping

## Usage

```
/spec specs/brd/brd.md
/spec specs/brd/sprint-N/brd.md --sprint N   # sprint N: write to specs/stories/sprint-N/
/spec --render-only                          # re-run the renderer against an existing decisions file
```

**Runs in the main session — do not add `context: fork`.** This skill owns the
decision dialogue and the human review gate. A forked skill cannot pause for
`AskUserQuestion`, so a forked shaping phase can only answer its own questions.
The renderer it dispatches forks; the shaping does not.

---

## Overview

Decomposition is two different jobs wearing one name.

A small number of calls are genuinely product-shaped and cannot be derived from
the BRD: which epics are in the next milestone, where an epic splits, which
dependencies are real rather than defensive, what gets deferred. Everything
after that — story files, typed edges, ownership clusters, point estimates,
`features.json`, the trace spines — is transcription of those calls.

This skill does the first job with the human and records the result in
`specs/decisions/spec-decisions.json`. `spec-render` does the second on the
sidekick model. The decisions file is the contract between them, and
`validate-spec-decisions.js` is what stops the renderer running without one.

**Why this order.** The previous shape generated the whole story graph and then
asked the human to review it. That asks someone to relitigate decisions already
baked into ten files, and the cheapest correct answer is always "looks fine". A
measured run produced 84 stories, 257 features and 1.83 MB of artifacts from 14
real decision points, with 12 of 16 epics landing on exactly 5 stories. Deciding
first is what stops the harness rendering work nobody chose.

---

## Steps

### Step 1 — Read the BRD and the grounding spine

Read the BRD at the given path. If it is missing, halt and ask the human to run
`/brd` first. Also read `specs/brd/brd-requirements.json` and
`specs/brd/brd-acceptance.json` when present — they are the requirement spine the
rendered stories must trace to.

Read `specs/plan-confidence.json` if it exists. A `low` band is a signal to spend
questions on its drivers rather than on general scope.

### Step 2 — Draft the decision set, do not ask it yet

Work out privately which calls are load-bearing. A call is load-bearing when a
different answer changes what gets built or in what order — not when it merely
changes wording. Typically:

1. **Milestone scope** — which epics are in the next milestone, and which are
   explicitly deferred. This is always load-bearing; it governs everything the
   renderer will and will not expand.
2. **Epic boundaries** — any epic you would split or merge, and why.
3. **Real vs defensive dependencies** — edges where you are unsure whether the
   consumer truly needs the producer, or you are adding the edge to be safe.
4. **Deferrals** — anything you would mark `needs_breakdown` rather than guess at.

Cap the set at what genuinely changes the outcome. Ten well-chosen decisions
beat thirty confirmations.

### Step 3 — Put them to the human, one at a time

Follow the dialogue discipline in `.claude/skills/clarify/SKILL.md` for budget
(10 default, 15 hard cap) and `.claude/skills/plan-review-loop/SKILL.md` for how
to present a contested fork.

Two rules govern how you ask:

**Propose a default with reasoning; never ask an open question you could answer.**
The human is far better at editing a proposal than generating one. Ask "I'd put
E1–E3 in milestone 1 and defer E4–E9, because E4 onward all depend on the
ingestion contract E2 publishes — take it, or move something?" rather than
"which epics should be in milestone 1?".

**Use `AskUserQuestion` for discrete choices**, prose for open ones. Lead with
your recommendation and say what it costs.

Record every answer as you go. A decision the human changed is worth more than
one they accepted — note both, and note *why* in `rationale`.

### Step 4 — Write `specs/decisions/spec-decisions.json`

```json
{
  "version": 1,
  "phase": "spec",
  "source": "specs/brd/brd.md",
  "confirmed_at": "<ISO 8601>",
  "milestone": {
    "name": "M1 — ingestion",
    "epics": ["E1", "E2", "E3"],
    "deferred_epics": ["E4", "E5"]
  },
  "decisions": [
    {
      "id": "D1",
      "question": "Which epics are in milestone 1?",
      "options": ["E1-E3 (ingestion only)", "E1-E5 (ingestion + ranking)"],
      "proposed_default": "E1-E3 (ingestion only)",
      "chosen": "E1-E3 (ingestion only)",
      "rationale": "E4 onward depend on the ingestion contract E2 publishes.",
      "basis": "human",
      "load_bearing": true
    }
  ]
}
```

`basis` is the honest record of who decided:

| value | meaning |
|---|---|
| `human` | you asked, the human answered — including accepting your proposed default |
| `default-accepted` | you did **not** ask; you recorded your own default as an assumption |
| `headless-default` | `--auto` / `--autonomous`; no human was available |

Do not write `human` for a decision you never put to them. The gate exists
because a previous run recorded six clarifications whose every basis ended
"Original planner reasoning: …" — model-authored on both sides.

Mark `load_bearing: true` on the calls that change what gets built. Every one of
those must be `basis: "human"` outside headless lanes, or the gate blocks.

### Step 5 — Verify the gate passes before dispatching

```bash
node .claude/scripts/validate-spec-decisions.js
```

Fix what it reports — by asking, not by editing the basis field.

### Step 6 — Dispatch `spec-render`

Invoke the `spec-render` skill, passing the BRD path and any `--sprint N`. It
forks onto the sidekick model, re-runs the gate itself, and expands the decided
scope into the full artifact set.

**One dispatch, not one per story.** Coarse handoffs keep the renderer's context
cached; per-story round-trips pay cache creation on every switch and can cost
more than the cheaper model saves.

When it returns, read `specs/decisions/spec-unresolved.json` if present. Each
entry is a judgement the renderer refused to invent. Put them to the human as in
Step 3, append them to `decisions[]`, and re-dispatch with `--render-only`.
A renderer that returns unresolved items is working correctly.

### Step 7 — Phase Evaluation Gate

Run the evaluator agent in artifact mode against
`.claude/templates/phase-eval-rubrics.json#phases.spec`, exactly as before:
threshold weighted average >= 7.0, every criterion >= 5, max 3 iterations. It
validates cross-phase traceability, acceptance-criteria quality, dependency
graph consistency and feature coverage.

Evaluation stays on the frontier model. This is the "final review" half of the
split — the point of a cheap renderer is an expensive reviewer.

### Step 8 — Human Review Loop [REQUIRED SUB-SKILL: `plan-review-loop`]

Follow `.claude/skills/plan-review-loop/SKILL.md`. This review is now narrower
than it used to be: the human already set scope and boundaries in Step 3, so do
not re-ask them. Lead the brief with what *rendering* revealed that shaping could
not — clusters that came out coupled, edges that forced a wave boundary,
estimates that landed heavier than the milestone assumed.

Open with:

1. Epic summary table (ID, title, story count, groups covered) — flag any epic
   whose story count you would not defend
2. Dependency graph overview
3. Story point summary by epic and dependency group
4. **Allocation summary** — one row per cluster: id, story count, points, epics,
   layers, waves spanned, `coordination_cost`, independently startable or not.
   Then: *"N clusters for a team of K"* (and when `N < K`, say the work is more
   coupled than the team is wide rather than proposing a split the graph does not
   support); the **build-first list** of `interface_contracts` as
   `artifact → contract_story`; **hand-offs** as
   `blocked_cluster waits on producer_cluster (story)`; and any `warnings[]` verbatim.
5. Totals: stories, points, features

**Challenge sources** — read before asking, and lead with these rather than the tables:

- `specs/plan-confidence.json` — band and drivers
- `risk_gap_table` entries carried from the BRD
- `specs/reviews/phase-spec-eval.json` — findings accepted without a fix, and why
- `story-clusters.json#warnings`, and any cluster not `independently_startable`
- Any decision from Step 3 that rendering contradicted

Record each round with `plan-approval.js`, naming `specs/stories/epics.md`,
`specs/stories/dependency-graph.md`, `specs/stories/stories.json`,
`features.json`, and `specs/decisions/spec-decisions.json` on the approving
round. In `--auto` / `--autonomous`, waive with `--lane` per that skill's
*Headless lanes* rule.

---

## Output

| File | Purpose |
|------|---------|
| `specs/decisions/spec-decisions.json` | **This skill's artifact** — the recorded human calls the renderer expands |
| `specs/decisions/spec-unresolved.json` | Judgements the renderer refused to invent; resolved here and re-dispatched |
| *(all story-graph artifacts)* | Written by `spec-render` — see that skill's Output table |

---

## Gate

**Decisions gate — hard block.** `validate-spec-decisions.js` fails when no
decision is `basis: "human"`, when a `load_bearing` decision is not, when
`milestone.epics` is empty, or when the file is malformed. `spec-render` re-runs
it at its own Step 0, so the block holds even if this skill is bypassed.
Headless lanes waive only the human requirement — never the structural checks —
and the waiver is recorded in the verdict.

**Grounding, ownership-cluster, and phase-evaluation gates** are unchanged and
run inside `spec-render` (grounding, clusters) and Step 7 (evaluation). See
`spec-render/SKILL.md#gate`.

**Human review is still required before `/design`,** which hard-blocks on:

```bash
node .claude/scripts/plan-approval.js check --phase spec
```

Do not auto-advance. The loop ends on an explicit approving round, not on silence.

---

## Gotchas

- **Do not fork this skill.** `context: fork` would silently disable every
  question in Step 3 and leave the model answering itself.
- **Do not write `basis: "human"` for a decision you did not ask.** It is the one
  field the gate cannot verify, and the whole split rests on it being honest.
- **Do not re-ask in Step 8 what was settled in Step 3.** Review what rendering
  revealed, not what the human already decided.
- **Do not expand deferred epics.** Deferring was a decision; a renderer that
  decomposes them anyway has overruled the human.
- **Unresolved items are a success signal.** A renderer that returns questions is
  refusing to guess. Answer them and re-dispatch rather than lowering the bar.
