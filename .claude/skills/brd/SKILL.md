---
name: brd
description: "[Internal pipeline stage — run by /build; invoke directly only as a power user.] Create a Business Requirements Document — from a Socratic interview, or grounded in a Functional Requirements Document via --frd (with a deterministic net-new/dropped gate). First step in the SDLC pipeline."
---

# BRD Skill — Requirements Intake

**Runs in the main session — do not add `context: fork`.** This skill owns the
five-dimension interview, the clarification budget, and the human approval. A
forked skill cannot pause for `AskUserQuestion`, so a forked intake phase can
only answer its own questions — which is exactly what a real run recorded: six
clarifications whose every `basis` ended "Original planner reasoning: …", the
planner writing both the question and the answer, and 258 KB of requirements
nobody had been asked about.

The rendering half forks: `brd-render` expands the confirmed spine and
clarification log into the analysis pack, the BRD document, and the two hard
gates, on the sidekick model. Judgement here, volume there.

## Usage

```
/brd                              # interview-from-scratch
/brd --frd path/to/frd.md         # ground the BRD in a Functional Requirements Document
/brd --prd path/to/prd.md         # alias for --frd: a PRD is the grounding baseline
/brd --delta path/to/prd-sprintN.md    # ground sprint N's PRD against the prior sprint's requirement spine
```

Two modes:
- **Document-grounded (recommended for greenfield):** pass `--frd <path>` (or its alias `--prd <path>`) to a Functional/Product Requirements Document. `--prd` and `--frd` are treated identically — the document becomes the immutable grounding baseline, extracted into the same requirements spine (`frd-requirements.json`); only the input flag name differs. For the canonical PRD shape this skill grounds best against, see `docs/prd-format.md`. The document becomes the immutable grounding baseline — Claude interrogates it for gaps, then generates a BRD in which **every requirement traces back to a source section or to a confirmed clarification.** A deterministic gate (Step 4.4) hard-blocks anything invented or dropped relative to the source before you ever see it for approval.
- **Interview-from-scratch:** no argument — an interactive Socratic interview gathers requirements from nothing. Use only when there is no source document.

---

## Overview

This is the first gate in the SDLC pipeline, and the origin of the whole grounding chain (`BRD → /spec → /design → /test → /auto`). Mistakes here cascade through every downstream phase, so the BRD must invent nothing the business did not state. With `--frd`, the FRD plus the human's confirmed interrogation answers are the **only** sanctioned sources of content; with no FRD, the confirmed interview answers are. Either way you interview the human across five dimensions, in this session to surface the full problem space — Socratic: ask clarifying questions, probe assumptions, reflect answers back for confirmation before moving on.

---

## Delta Mode (`--delta`)

> Invoked by `/sprint` for sprint N (N >= 2). Grounds a new PRD against the
> **prior sprint's approved requirement spine**, not against nothing — this is
> what proves the new PRD's requirements are new/changed/carried, and flags
> anything it silently drops. See
> `docs/archive/superpowers/specs/2026-07-04-sprint-delta-lane-design.md`.

### Step Δ0 — Locate the prior spine and resolve N

List `specs/brd/sprint-*/` directories; let `prev` be the highest number found.
If none exist, the prior spine is the flat legacy `specs/brd/brd-requirements.json`
(sprint 1 predates sprint-numbered directories) and `N = 2`. If sprint
directories exist, `N = prev + 1`. If neither the flat file nor any sprint
directory exists, halt — `--delta` requires a prior sprint; use `--frd`/`--prd`
for the very first sprint.

### Step Δ1 — Run Steps 0.0 through 4 unchanged, writing to `specs/brd/sprint-N/`

Run the FRD-grounded flow exactly as written, across both halves of the phase:
Steps 0.0 (ingest), **0.1 (adopt)**, 0, 0.5, 1 and 2 here, then dispatch
`brd-render` (Step 2.9) for its Steps 2.7, 2.8, 3, 4, 4.4 and 4.45. Adoption
**does** run in delta mode — the new sprint PRD is a source document like any
other — so pass `--out-dir specs/brd/sprint-N` so the adopted files land where
Step Δ2's trace-check reads them. `--root` alone cannot express this: it
prefixes `specs/brd/` again, and without `--out-dir` adoption would overwrite
sprint 1's approved flat spine, after which Δ2 compares sprint N against itself
and passes vacuously with 0 dropped.

One change throughout: every output path becomes
`specs/brd/sprint-N/` (e.g. `specs/brd/sprint-N/brd.md`,
`specs/brd/sprint-N/brd-requirements.json`, `specs/brd/sprint-N/clarification-log.json`).
When writing `brd-requirements.json`, any requirement that carries forward a
prior-sprint requirement unchanged (or with only minor edits) must include
that prior sprint's BR id in its `traces` array alongside this sprint's own
FRD/clarification traces — this is what lets Step Δ2's classification tell
"carried forward" apart from "silently dropped."

### Step Δ2 — Requirements-delta classification [HARD BLOCK]

Step 4.4's grounding gate still runs unchanged (this sprint's BRD vs this
sprint's own FRD/PRD spine). In addition, classify this sprint's spine against
the **prior sprint's** spine — the same `trace-check.js` engine, reused with
the prior spine as `required`, this sprint's spine also as a valid trace
target (`optional`), and this sprint's spine as `downstream`:

```bash
node .claude/scripts/trace-check.js \
  --required specs/brd/sprint-{prev}/brd-requirements.json \
  --optional specs/brd/sprint-N/brd-requirements.json \
  --downstream specs/brd/sprint-N/brd-requirements.json \
  --layer requirements-delta \
  --out specs/brd/sprint-N/requirements-delta.json
```

(When `prev` refers to the flat legacy layout, use `--required specs/brd/brd-requirements.json`.)

Read the resulting `requirements-delta.json`:
- `net_new` entries are genuinely new requirements this sprint introduces — expected, not a failure.
- `dropped` entries are prior-sprint requirements this sprint's spine does not cover — **each one needs an explicit human decision**: still active (add a BR entry carrying it forward) or intentionally retired (record why in this sprint's BRD Open Questions). A `dropped` entry with no such resolution is a silent regression — halt and ask before proceeding to Step 4.5.

**Empty-spine guard:** a `required_total: 0` here means the prior sprint's
spine is empty — a pre-spine legacy project. Skip this step in that case and
note it in the BRD summary (Step 4.4's own grounding gate still runs
normally against this sprint's spine).

### Step Δ3 — Present for Human Approval (delta mode)

Same as Step 5, plus display the requirements-delta classification (new /
changed / carried / dropped, with the human's resolution for each dropped
item) before asking for approval.

**Name the sprint paths on the receipt, not the flat ones.** Step 5's artifact
list is `specs/brd/brd.md` etc., which for sprint N are sprint 1's files — they
exist, so `plan-approval` would happily digest them and the receipt would go on
matching while this sprint's BRD changed underneath it. Pass
`specs/brd/sprint-N/brd.md`, `sprint-N/brd-requirements.json` and
`sprint-N/clarification-log.json` explicitly. The digest-voids-on-change
property is the whole point of the receipt.

---

## Steps

### Step 0.0a — Check the PRD's shape first [`--prd` / `--frd` only]

```bash
node .claude/scripts/validate-prd.js <path-to-prd.md>
```

Run this **before** dispatching the extractor. This document is about to become
the immutable grounding baseline, and every downstream gate measures against it:
a requirement with no id can be dropped with nothing to notice, and a
requirement with no acceptance postcondition gives the evaluator no oracle — so
its check passes by default, forever.

A non-zero exit is **not** a hard stop; a real PRD is a human document and may be
worth adopting as it stands. But you must put the errors to the human before
extraction, because this is the last cheap moment to fix them:

- **Requirements with no acceptance postcondition** — these become the "no
  observable criterion" work-list that `/spec` inherits, and nothing downstream
  will challenge them mechanically. Ask whether to add postconditions to the PRD
  now, or to accept the list and author criteria in `/spec`. Record the answer
  as a `C-n` clarification either way.
- **Structural errors** (duplicate ids, an empty Out of Scope, placeholder text,
  a section that parses to zero ids) — fix these in the source document before
  adopting. An empty Out of Scope in particular is read as *nothing is
  forbidden* by the autonomous gate.
- **Warnings** (an unmeasurable NFR, a milestone with no `Done when:`, a
  milestone naming no requirements) — carry them into the Step 5 review brief.

On a real run this step did not exist. The PRD had **35 structural errors**,
34 of them requirements with no postcondition; adoption carried them faithfully
into the spine, and the gap was found by hand three hours later, after the BRD
had already been rendered and scored. `docs/prd-format.md` is what to point the
human at, and `docs/shortlink-prd.md` is a worked example that passes clean.

### Step 0.0 — Dispatch `brd-extract` (only in `--prd` / `--frd` mode)

Invoke the `brd-extract` skill, passing the same `--prd` / `--frd` path and any
`--sprint N`. It copies the source verbatim to `specs/brd/source-frd.md`,
extracts the spine into `specs/brd/frd-requirements.json`, and runs
`brd-adopt.js`. It returns counts.

**Do not extract the spine yourself.** Extraction is transcription — every
MUST/SHALL/SHOULD statement copied verbatim with a stable id — and it needs
none of this session's context. On a real run the main session did it here and
wrote a **34 KB** JSON file with the frontier model before the interview had
even begun; that blob was the largest single thing in the session and it was
then re-billed on all 337 remaining turns. The phase cost $15.58 and the
sidekick produced 8.6% of it.

**Do not read `frd-requirements.json` when it returns.** You need its counts,
which are in the return message, and its open questions, which you read in
Step 0.5 from `brd-open-questions.json`. Everything else you need arrives via
`phase-digest.js`. Reading the spine back in is the same cost as having written
it, paid a second time.

If no `--prd` / `--frd` was given, skip this step. The BRD's grounding baseline
is then the confirmed `INT-n` interview requirements captured in Step 2
(`specs/brd/interview-requirements.json`), plus the Step 0.5 clarification log.

### Step 0.1 — Tag the taxonomy [`--frd` / `--prd` only]

Adoption (inside `brd-extract`) derives `brd-requirements.json`,
`brd-acceptance.json`, `brd-safeguards.json`, `brd-open-questions.json`,
`brd-milestones.json` and `brd-risks.json` **deterministically** from the spine:
requirement text carried verbatim, each entry tracing to its own source id,
`Out of Scope` / `Non-goals` becoming Forbidden Actions, and per-requirement
`… AC` sections becoming acceptance criteria linked to their requirement.
**Never write those files by hand in `--frd` mode.**

**Why adoption rather than re-expression.** On an earlier run this phase turned
149 source requirements into 88 BRD ones, and the grounding gate then proved the
mapping lossless both ways — 149/149, 0 net-new, 0 dropped. That is a formal
proof that the re-expression added no requirement content: `BR-1` was a
paraphrase of `FRD-1`. It cost 258 KB of frontier output, and every paraphrase
is a chance to shift a constraint the gate cannot detect, because the gate
checks coverage rather than meaning. Adopting makes grounding an identity —
there is nothing to prove because nothing was transformed.

**What still needs you.** Adoption deliberately leaves `taxonomy: null` on every
requirement. Slot classification is a judgement, and the ten-slot floor
(Step 4.45) still has to be satisfied — that gate, the analysis pack, and the
clarification log are what this phase contributes over the PRD. Fill the
taxonomy tags and record `na_reason` entries where a slot genuinely does not
apply. Tag from each requirement's id and section, which `brd-extract` reports;
where a slot is genuinely unclear, read that one requirement rather than the
file.

Resolve any warning `brd-extract` reports rather than carrying it forward: an
acceptance criterion naming a requirement outside the spine is an untraceable
postcondition.

Steps 3 and 4 then write a **short** `brd.md` — a pointer to `source-frd.md`,
the confirmed clarifications, the taxonomy verdict, and the open questions. Not
a restatement of the requirements, which now live in the adopted spine.

### Step 0 — Brainstorm with Superpowers

Before beginning the interview, invoke `superpowers:brainstorming` to explore the user's intent, requirements, and design space. This surfaces hidden assumptions and alternative framings before the structured Socratic interview locks in a direction. In FRD-grounded mode, brainstorm **gaps and ambiguities in the FRD** specifically — what it leaves unspecified. The brainstorming output feeds into the interview — it does not replace it.

### Step 0.5 — Apply the Clarification Budget (and log every answer)

**Start from `specs/brd/brd-open-questions.json`.** Adoption (Step 0.1) extracts
the PRD's own Open Questions section into it — the author wrote those down
*because they did not know the answer*, which makes them the highest-value
questions in the budget and the ones you did not have to invent. Put them first,
before anything you thought of yourself.

This is the loop the audited run left open: that PRD stated five open questions
and the clarification log recorded six entries, every one of which the planner
had written both sides of. The document's actual unknowns were never
systematically asked.

An open question the human resolves becomes a normal `C-n` clarification with
`basis: "user decision"`. One they decline to resolve stays open and must appear
in the BRD's Open Questions section — deferred is a valid answer, silently
dropped is not.

Then invoke `.claude/skills/clarify/SKILL.md`. Use it to cap the total clarification burden:
- Ask only load-bearing questions that affect requirements, scope, data, security, architecture, or story readiness.
- Default to 10 total questions across the BRD interview.
- Continue to 15 only if the user explicitly asks to keep going.
- Capture low-risk assumptions in the BRD instead of asking about them.

**Persist every confirmed answer to `specs/brd/clarification-log.json`** with a stable id:
```json
[
  { "id": "C1", "question": "What is the password-reset token TTL?", "answer": "1 hour" },
  { "id": "C2", "question": "Should order history paginate?", "answer": "Yes, 20 per page" }
]
```
The clarification log is the **only** sanctioned channel for content not already in the FRD. A BRD requirement may legitimately introduce something new *only* if it traces to an FRD section, an `INT-n` interview requirement, or a `C-n` clarification here — so anything the human confirms that expands scope must be captured as a `C-n` entry, not absorbed silently into the BRD prose.

### Step 1 — Analyze Existing Codebase (if any)

Before beginning the interview, scan the working directory for existing code. Note:
- Current tech stack, frameworks, languages
- Existing data models or schemas
- Existing API surface
- Any patterns or conventions already in use

If this is an existing non-trivial codebase and `specs/brownfield/codebase-map.md` does not exist, recommend running `/brownfield` first. For small or urgent work, continue only after documenting the risk and the limited scope.

This prevents proposing solutions that conflict with what is already built.

### Step 2 — Conduct the Five-Dimension Interview

Work through each dimension in order. Do not skip dimensions. Ask only the highest-value questions within the clarification budget, then summarize what you heard and ask the human to confirm before proceeding. If a dimension is already answered by local context, document the assumption and move on.

**As each dimension is confirmed, append the confirmed requirement statements to `specs/brd/interview-requirements.json`** — one entry per discrete requirement the human signed off:

```json
[{ "id": "INT-1", "text": "Admins invite users by email", "section": "users-and-permissions" }]
```

Write entries **at confirmation time, not after synthesis** — this file is the grounding baseline the BRD is mechanically checked against (Step 4.4), so it must capture what the human confirmed before BRD prose can drift. Q&A detail that is context rather than a requirement stays in `clarification-log.json` (`C-n`); a statement the human confirmed as something the system must do is an `INT-n`.

---

#### Dimension 1 — Why (Problem & Goals)

- What problem does this solve, and for whom?
- Who are the target users (role, technical level, context of use)?
- What does success look like in 90 days? What metrics will you track?
- What is the cost of not solving this problem?

Confirm: "Here is what I understand the problem and goals to be: [summary]. Is this correct?"

---

#### Dimension 2 — What (Scope & MVP)

- What are the core operations this system must perform? (List them.)
- What is explicitly out of scope for the first version?
- What is the minimum viable product — the smallest slice that delivers real value?
- Are there existing tools or systems this must integrate with?

Confirm: "Here is the core scope and MVP as I understand it: [summary]. Anything to add or change?"

---

#### Dimension 2.5 — Alternatives (Implementation Approaches)

Propose 2-3 concrete implementation approaches with trade-offs. For each option:
- Brief description of the approach
- Key advantages
- Key disadvantages / risks
- Best suited for (what context)

Ask the human to choose an approach or blend aspects. Document the chosen direction and the rationale for rejecting alternatives.

---

#### Dimension 3 — How (Technical Architecture)

- What is the preferred tech stack, or are there constraints (language, cloud, existing infra)?
- How will data be stored? What are the main data entities?
- Are there external integrations, APIs, or third-party services involved?
- What are the performance or scalability requirements?

Confirm: "Here is the technical direction I am capturing: [summary]. Does this match your expectations?"

---

#### Dimension 4 — Edge Cases (Failure & Constraints)

- What happens when [key operation] fails? Who is notified, and how?
- What are the operational constraints (uptime requirements, rate limits, budget)?
- Does this system handle sensitive data (PII, financial, health)? What compliance applies?
- What are the most likely failure modes in the first 6 months?

Confirm: "Here are the constraints and failure scenarios I am recording: [summary]. Anything missing?"

---

#### Dimension 5 — UI Context (Interface & Design)

- Is there a UI? If so, what are the primary screens or flows?
- Are there design references, mockups, or brand guidelines to follow?
- What devices and viewports must be supported (desktop, tablet, mobile)?
- Are there accessibility requirements (WCAG level)?

Confirm: "Here is the UI context I have captured: [summary]. Is this complete?"

---

### Step 2.9 — Dispatch `brd-render`

The interview and the clarification log are the confirmed intake. Hand the
expansion to the sidekick: invoke the `brd-render` skill, passing any
`--sprint N`. It writes the analysis pack, the BRD document, and runs the two
hard gates (Step 4.4 grounding, Step 4.45 taxonomy floor) before returning.

**One dispatch, not one per table.** Coarse handoffs keep the renderer's context
cached; per-artifact round-trips pay cache creation on every switch.

When it returns, read `specs/brd/brd-unresolved.json` if present. Each entry is
a gap the renderer refused to fill by inventing something. Put them to the human
using the Step 0.5 budget, append the confirmed answers to
`clarification-log.json`, and re-dispatch. A renderer that returns unresolved
items is working correctly.

In `--prd` / `--frd` mode the spine is already adopted deterministically
(Step 0.1), so the renderer is expanding, never re-deriving.

**Prove it — do not read for it [HARD BLOCK, `--prd` / `--frd` only]:**

```bash
node .claude/scripts/brd-adopt.js --verify
```

This re-derives the spine from the immutable source and compares `id`, `text`
and `label` against what is on disk. Exit 1 means the renderer changed the
baseline it was told to leave alone — restore it from the source, or fix the
source document and re-adopt. Exit 2 means there is nothing to verify against,
which is a setup problem, not a pass.

Neither existing hard gate can catch this: an adopted spine passes the grounding
gate as an identity, and a re-keyed spine that still carries `traces` passes it
as coverage. A live run re-keyed all 24 requirements from the spine ids
(`FRD-n`) to the PRD labels (`FR-n`) and nothing noticed — leaving two runs of
the same pipeline emitting `brd-requirements.json` in two different id spaces,
which is what stranded a milestone-scoped gate downstream with no way to join
them.

(In delta mode add the same `--out-dir specs/brd/sprint-N` you adopted with.)

### Step 4.5 — Phase Evaluation Gate

Spawn the `evaluator` agent (artifact mode) to validate the BRD before human review.

Run it with **`model: "sonnet"`**. The BRD's load-bearing properties are already
proven deterministically before this gate — grounding is an identity in adopt
mode, and the ten-slot taxonomy floor is a hard block. What the rubric adds is
prose-level consistency, which is exactly what it caught on a real run: a §14
summary claiming 107/107 acceptance coverage when the matrix showed 26. A real
and valuable finding — and not one that needed the frontier model. Escalate to
`model: "opus"` only when the requirements carry a security or data boundary the
deterministic gates do not cover.

**Take the verdict from the agent's return message. Do not read
`specs/reviews/phase-brd-eval.json` back into this session** — it is for the
receipt and for `/retro`, and pulling it in costs more than the evaluation did.

**Agent invocation:**

Spawn Agent with subagent_type="evaluator", model "sonnet", and prompt:
- Phase: brd
- Artifact: the BRD file path (specs/brd/brd.md or specs/brd/feature-{name}.md)
- Upstream: in FRD mode, `specs/brd/source-frd.md` + `specs/brd/frd-requirements.json` + `specs/brd/clarification-log.json`; in interview mode, `specs/brd/interview-requirements.json` + `specs/brd/clarification-log.json`
- Grounding verdict: `specs/reviews/brd-grounding.json` in both modes (already PASS from Step 4.4 — the evaluator confirms the rubric's traceability criterion against it) (absent only for pre-spine legacy projects, where the gate was skipped and noted)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "brd"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Write result to specs/reviews/phase-brd-eval.json

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to Step 5. Attach the eval summary (weighted average, any warnings).
2. If verdict is **FAIL** — revise the BRD to address ALL error-severity findings. Re-run the evaluator with incremented iteration and previous score.
3. **Ratchet rule:** weighted_average must be >= previous iteration's score. If it decreases, revert to the previous version and try a different revision approach.
4. After 3 iterations without PASS — present the best-scoring version to the human with all findings attached. Note: "Phase evaluator did not reach threshold after 3 iterations. Findings below require human judgment."

### Step 5 — Present for Human Approval [REQUIRED SUB-SKILL: `plan-review-loop`]

Follow `.claude/skills/plan-review-loop/SKILL.md` with `--phase brd`. This is a
**dialogue across rounds**, not a single approve/reject question.

**Do not end this phase by displaying the BRD and asking "does this capture the
requirements? Approve, or provide corrections."** That is precisely the shape
the loop skill exists to replace: it offers a yes/no on a wall of artifacts,
where the cheapest correct answer is always "yes". A real run ended exactly that
way and closed in one round on a one-word reply — while the document still
carried four decisions that overrode the source PRD, an unconfirmed
accessibility assumption, and 79 requirements with no observable criterion.
Everything the human most needed to weigh was in the artifacts and none of it
was put to them as a question.

Open with the review brief the loop describes — what was built, the load-bearing
decisions with the alternatives you rejected, what the machine gates already
proved (so they do not re-check grounding or the taxonomy floor), and where you
would push back if you were reviewing this.

**Challenge sources for this phase** — where this phase's uncertainty already
lives, so you ask about it rather than re-deriving it:

- `specs/brd/brd-open-questions.json` — the source document's own unknowns. Any
  entry still unresolved at this gate is the highest-value question in the room:
  its author wrote it down *because they did not know the answer*.
- `clarification-log.json` entries whose `basis` is an assumption rather than a
  user decision — you chose these instead of asking. Each is a question you
  deferred, and this is the last cheap moment to ask it.
- Clarifications that **override** the source document rather than resolving it.
  An override is a decision to depart from what the human wrote, and it must be
  put to them as one, not recorded as if the document had said it.
- The uncovered-criteria count from `phase-digest.js --phase spec`. Requirements
  with no observable criterion are not protected by the `brd-acceptance.json`
  hard gate, so nothing downstream will challenge them mechanically.
- `phase-brd-eval.json` findings you accepted without a fix.
- Risks this analysis added that the source document did not carry — you
  inferred them, so they need confirming.

Record each round with `plan-approval.js record --phase brd`, naming
`specs/brd/brd.md`, `brd-requirements.json` and `clarification-log.json` on the
approving round; in `--auto` / `--autonomous`, waive with `--lane`. Until this
phase was de-forked its approval could not reach a human, so no receipt existed
and nothing downstream could tell whether the requirements were ever agreed.

On approval the recorder prints the handoff: **`/clear` before `/spec`**. `/spec`
re-reads what it needs from disk, so clearing costs nothing and stops this
phase's context being re-billed through the next one.

---

## Output

| File | Purpose |
|------|---------|
| `specs/brd/brd.md` | Full BRD for a new project |
| `specs/brd/feature-{name}.md` | BRD for a feature addition |
| `specs/brd/brd-requirements.json` | Machine-readable requirement spine; each BR carries `traces` to FRD/clarification ids and `taxonomy` slots |
| `specs/brd/brd-acceptance.json` | Postconditions split into individually traceable `BR-n-ACm` ids — what `spec-render` Step 6.46 checks |
| `specs/brd/brd-safeguards.json` | Invariants, prohibitions, limits, and norms — required trace targets for the Canvas |
| `specs/brd/taxonomy-coverage.json` | Recorded `na_reason` for any taxonomy slot no requirement covers |
| `specs/reviews/brd-taxonomy.json` | Ten-slot comprehensiveness verdict (`pass`, `uncovered[]`, `unjustified[]`) |
| `specs/brd/source-frd.md` | (FRD mode) immutable copy of the provided FRD — the grounding baseline |
| `specs/brd/frd-requirements.json` | (FRD mode) extracted `FRD-n` requirements the BRD is checked against |
| `specs/brd/interview-requirements.json` | (interview mode) confirmed `INT-n` requirement spine — the grounding baseline |
| `specs/brd/clarification-log.json` | Confirmed interrogation answers (`C-n`) — the only sanctioned net-new content |
| `specs/brd/brd-analysis.json` | SPDD-grade analysis pack: Domain Concepts, Ambiguity Table, Edge-Case Table, decision log, AC Coverage Matrix, and Risk & Gap Table |
| `specs/reviews/brd-grounding.json` | deterministic grounding verdict (`pass`, `net_new[]`, `dropped[]`) |
| `specs/brd/sprint-N/*` | (delta mode) sprint-N's BRD artifact set, same shape as the flat sprint-1 layout |
| `specs/brd/sprint-N/requirements-delta.json` | (delta mode) new/changed/carried/dropped classification vs the prior sprint's spine |

---

## Gate

**Grounding gate — hard block (both modes).** `grounding-check.js` proves mechanically that the BRD invented nothing (`net_new`) and dropped nothing (`dropped`) relative to the FRD spine (FRD mode) or the confirmed interview spine (interview mode), plus clarifications. Any violation blocks before the rubric even runs, regardless of quality score — see Step 4.4.

**Adopted-spine integrity — hard block (`--prd` / `--frd` only).** `brd-adopt.js --verify` proves the renderer left `id`, `text` and `label` exactly as adoption produced them, filling only `taxonomy`. This is the one property the grounding gate structurally cannot check, because grounding is satisfied by any spine that traces — including a re-keyed or re-worded one. See Step 4.2.

**Taxonomy floor — hard block (both modes).** `brd-taxonomy-check.js` proves every one of the ten requirement slots is either covered by a tagged requirement or excused with a substantive, committed reason — the check the grounding gate structurally cannot make, since grounding is relative to a source that may itself be silent. See Step 4.45.

**Phase evaluation gate runs before human approval.** The evaluator agent (artifact mode) scores the BRD against 5 criteria (completeness, traceability, specificity, consistency, actionability). Threshold: average >= 7.0, all criteria >= 5. In both modes the traceability criterion is anchored to the grounding verdict, and the completeness criterion to the taxonomy verdict, rather than free judgement.

**Human approval is still required before proceeding to `/spec`.** The gates validate quality + grounding; the human validates intent.

Do not auto-advance. Wait for explicit approval or correction.

---

## Gotchas

- **Do not skip the interview.** Never generate a BRD from a single sentence of input.
- **Do not skip Dimension 2.5.** Alternatives must be explored and documented.
- **Avoid vague success metrics.** "Users are happy" is not a metric. Push for numbers.
- **Check existing code first.** Proposing a new auth system when one already exists wastes cycles.
- **Confirm each dimension before moving on.** Misunderstood requirements compound.
- **Do not conflate MVP with the full product.** MVP is the smallest deployable slice.
