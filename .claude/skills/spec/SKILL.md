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

**With `--render-only`, skip to Step 6.** The decisions file already exists and
was already gated; re-running the dialogue would re-ask settled questions. Use it
after resolving `spec-unresolved.json`, or to re-expand an amended scope.

### Step 0 — Context Handoff [HARD BLOCK]

```bash
node .claude/scripts/handoff-check.js --phase spec
```

Exit 1 means this session is the one that approved `/brd`. Stop and tell the
human to run `/clear`, then `/spec` again — do not continue and do not work
around it. Everything this phase needs is on disk, so clearing loses nothing; it
stops `/brd`'s conversation being re-billed on every turn of this one, which on
a metered run was the difference between a 273K and a ~110K average turn.

Add `--in-session` only when `/build` is conducting every phase from one session.

### Step 1 — Digest the BRD, do not read it whole

```bash
node .claude/scripts/phase-digest.js --phase spec
```

Exit 1 means `/brd` has not run — halt and ask the human to run it first.

The digest carries what this phase actually decides against: requirement count
and id range, the taxonomy spread, **how many requirements have no observable
acceptance criterion**, the PRD's own milestone order, the deny-list, the open
questions, the High risks, and the confidence band. That is the whole shaping
input, in about 4 KB.

**Do not read `brd-requirements.json`, `brd-acceptance.json` or `brd.md` in
full here.** Together they are ~62 KB, and this session does not decide anything
by requirement wording — it decides milestone scope, epic boundaries and which
dependencies are real. `spec-render` reads the spine in full when it expands the
stories, which is where the text is genuinely needed. Read a specific
requirement only when a decision turns on its exact wording, and read that
requirement, not the file.

Why this matters more than it looks: a blob pulled in at Step 1 is not paid for
once. It is re-billed on every remaining turn of the phase. A metered run of the
front half spent $74.10 of its $118.60 on cache reads alone.

The uncovered-criteria count is this phase's work-list, not a warning to note
and move past — `spec-render`'s Step 6.46 gate checks only the criteria that
already exist, so a requirement that reaches `/auto` without one is never
challenged by any gate.

### Step 2 — Draft the decision set, do not ask it yet

Work out privately which calls are load-bearing. A call is load-bearing when a
different answer changes what gets built or in what order — not when it merely
changes wording. Typically:

1. **Milestone scope** — which epics are in the next milestone, and which are
   explicitly deferred. This is always load-bearing; it governs everything the
   renderer will and will not expand.

   **Read `specs/brd/brd-milestones.json` first.** It is the PRD's own milestone
   plan, in document order — the build sequence the human already decided when
   they wrote the PRD. Do not re-derive it from scratch and do not silently
   depart from it.

   - Each entry carries `requirements[]`. Where those are present, propose
     `milestone.epics` as *the epics containing the next milestone's
     requirements*, and say which milestone you are scoping to.
   - Where `requirements[]` is **empty**, the PRD sequenced its milestones
     without mapping them to requirement ids — common, and `validate-prd`
     warns about it. The plan still gives you the order and the exit criteria,
     so propose a mapping from those and ask. Do not treat an unmapped plan as
     no plan.
   - Read `specs/milestones/*-log.md` if any exist. A completed milestone's log
     records what was actually built and where it deviated from the PRD, which
     is what makes "the next milestone" mean something rather than restarting
     from the document each time.

   The milestone that is *not* in scope is the point: a real run expanded 16
   epics to story depth against a plan-confidence of 0. Everything you defer
   here is work the renderer will not generate.
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

Add `--in-session` only when `/build` is conducting every phase from one session.

### Step 5.5 — Checkpoint: stop here and clear [HARD BLOCK]

When Step 5 passes it prints a checkpoint. **Obey it: stop, and tell the human to
run `/clear` then `/spec --render-only`.** Do not continue into Step 6 in this
session.

This is not politeness about context — it is the most expensive stretch of the
front half. Everything from Step 6 on reads
`specs/decisions/spec-decisions.json`, not this conversation. On a metered run,
40 of `/spec`'s 47 turns fell after this point at a **284K average context**;
re-entered fresh they run at ~110K.

No checkpoint is printed when the gate was waived by a headless lane or run
`--in-session` — neither has a human who can clear, and both continue straight
into Step 6.

### Step 6 — Dispatch `spec-render`

```bash
node .claude/scripts/handoff-check.js --phase spec --stage render
```

Exit 1 means Step 5.5 was skipped and this is still the shaping session. Stop and
hand off as above rather than working around it.

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

Spawn the `evaluator` agent in artifact mode **with `model: "sonnet"`**, and:

- Phase: `spec`
- Artifacts: `specs/stories/epics.md`, `specs/stories/E*-S*.md`, `specs/stories/stories.json`, `specs/stories/dependency-graph.md`, `features.json`
- Upstream: `specs/brd/brd.md` (+ `brd-requirements.json` when present)
- Grounding verdict: `specs/reviews/spec-grounding.json` when present (already PASS from `spec-render`'s Step 6.45 — anchor the traceability criterion to it)
- Rubric: read `.claude/templates/phase-eval-rubrics.json`, key `"spec"`
- **Iteration: 1** (increment on retry)
- **Previous score: null** (or the previous iteration's `weighted_average`)
- Write result to `specs/reviews/phase-spec-eval.json`

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to Step 8 with the eval summary.
2. If verdict is **FAIL** — fix the findings and re-run. Re-dispatch `spec-render` when the fix is structural rather than editorial.
3. **Ratchet rule:** `weighted_average` must be >= the previous iteration. Revert on regression.
4. After 3 iterations — carry the unresolved findings into Step 8's brief rather than looping further.

`Previous score` is load-bearing: the evaluator only applies the ratchet rule
when a caller passes it, so omitting it silently disables regression detection.

**Take the verdict from the agent's return message. Do not read
`specs/reviews/phase-spec-eval.json` back into this session** — one real one was
47 KB, more than the evaluation itself cost, and it then rides in context for
every remaining turn of the phase. The return message carries the verdict, the
failing criteria and the findings that need action; the file is for the receipt
and for `/retro`.

**Why Sonnet and not the frontier model.** The load-bearing checks on this
artifact are already deterministic and already passed before the evaluator runs:
the grounding gate, `trace-check.js`, the cluster gates. What the rubric scorer
adds on top is prose-level consistency — a summary contradicting its own matrix,
a story with no criterion, an override recorded as if it were the BRD's position.
Those findings are real and worth having, but the model tier is not what makes
them real. Escalate to `model: "opus"` when the decomposition itself carries a
security or data boundary the deterministic gates do not cover.

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
