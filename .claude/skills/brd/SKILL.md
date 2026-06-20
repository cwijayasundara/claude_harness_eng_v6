---
name: brd
description: "[Internal pipeline stage — run by /build; invoke directly only as a power user.] Create a Business Requirements Document — from a Socratic interview, or grounded in a Functional Requirements Document via --frd (with a deterministic net-new/dropped gate). First step in the SDLC pipeline."
context: fork
agent: planner
---

# BRD Skill — Business Requirements Document

## Usage

```
/brd                              # interview-from-scratch
/brd --frd path/to/frd.md         # ground the BRD in a Functional Requirements Document
```

Two modes:
- **FRD-grounded (recommended for greenfield):** pass `--frd <path>` to a Functional Requirements Document. The FRD becomes the immutable grounding baseline — Claude interrogates it for gaps, then generates a BRD in which **every requirement traces back to an FRD section or to a confirmed clarification.** A deterministic gate (Step 4.4) hard-blocks anything invented or dropped relative to the FRD before you ever see it for approval.
- **Interview-from-scratch:** no argument — an interactive Socratic interview gathers requirements from nothing. Use only when there is no source document.

---

## Overview

This is the first gate in the SDLC pipeline, and the origin of the whole grounding chain (`BRD → /spec → /design → /test → /auto`). Mistakes here cascade through every downstream phase, so the BRD must invent nothing the business did not state. With `--frd`, the FRD plus the human's confirmed interrogation answers are the **only** sanctioned sources of content; with no FRD, the confirmed interview answers are. Either way the planner interviews the human across five dimensions to surface the full problem space — Socratic: ask clarifying questions, probe assumptions, reflect answers back for confirmation before moving on.

---

## Steps

### Step 0.0 — Ingest the FRD (only when `--frd <path>` was given)

If an FRD path was provided:

1. **Copy it verbatim** to `specs/brd/source-frd.md` — this is the immutable grounding baseline. Never edit it.
2. **Extract its requirements** into `specs/brd/frd-requirements.json` — one entry per discrete functional requirement, with a stable id, the requirement text, and the source section:
   ```json
   [
     { "id": "FRD-1", "text": "Users can reset their password via an emailed link", "section": "3.2 Authentication" },
     { "id": "FRD-2", "text": "Users can view their order history", "section": "4.1 Orders" }
   ]
   ```
   Be exhaustive and faithful — every "the system must / shall / should" statement, every user-facing behavior, every business rule becomes one `FRD-n`. Do not paraphrase away constraints. This list is what the BRD will be checked against, so a requirement you fail to extract here is a requirement that can be silently dropped.

If no `--frd` was given, skip this step; the BRD's grounding baseline is the confirmed interview answers (Step 0.5) alone.

### Step 0 — Brainstorm with Superpowers

Before beginning the interview, invoke `superpowers:brainstorming` to explore the user's intent, requirements, and design space. This surfaces hidden assumptions and alternative framings before the structured Socratic interview locks in a direction. In FRD-grounded mode, brainstorm **gaps and ambiguities in the FRD** specifically — what it leaves unspecified. The brainstorming output feeds into the interview — it does not replace it.

### Step 0.5 — Apply the Clarification Budget (and log every answer)

Before asking interview questions, invoke `.claude/skills/clarify/SKILL.md`. Use it to cap the total clarification burden:
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
The clarification log is the **only** sanctioned channel for content not already in the FRD. A BRD requirement may legitimately introduce something new *only* if it traces to an FRD section or a `C-n` clarification here — so anything the human confirms that expands scope must be captured as a `C-n` entry, not absorbed silently into the BRD prose.

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

### Step 3 — Synthesize into BRD

After all five dimensions are confirmed, produce a structured BRD with these sections:

1. Executive Summary
2. Problem Statement
3. Target Users
4. Success Metrics
5. Scope (In / Out)
6. MVP Definition
7. Alternatives Considered (with rationale for chosen approach)
8. Technical Architecture
9. Data Model Overview
10. External Integrations
11. Edge Cases & Constraints
12. UI Context
13. Open Questions

### Step 4 — Write to `specs/brd/`

- For a new project: write to `specs/brd/brd.md`
- For a feature addition: write to `specs/brd/feature-{name}.md`

Also write the **machine-readable requirement spine** to `specs/brd/brd-requirements.json` — one entry per BRD requirement, each with a stable id and a `traces` array citing the FRD section ids and/or `C-n` clarification ids it derives from:
```json
[
  { "id": "BR-1", "text": "Password reset via emailed link, token valid 1h", "traces": ["FRD-1", "C1"] },
  { "id": "BR-2", "text": "Paginated order history (20/page)", "traces": ["FRD-2", "C2"] }
]
```
**Every BR entry must carry at least one valid trace.** If you cannot trace a requirement to an FRD section or a clarification, it is invented — either remove it, or (if the human genuinely wants it) capture the human's confirmation as a new `C-n` entry in `clarification-log.json` first, then trace to it. In interview-from-scratch mode (no FRD), trace BR entries to `C-n` clarifications only.

Create the `specs/brd/` directory if it does not exist.

### Step 4.4 — Grounding Gate [HARD BLOCK — FRD mode]

When an FRD was provided, run the deterministic grounding check before the rubric evaluation. This proves mechanically — not by judgement — that the BRD invented and dropped nothing relative to the FRD + clarifications:

```bash
node .claude/skills/brd/scripts/grounding-check.js \
  --frd specs/brd/frd-requirements.json \
  --clarifications specs/brd/clarification-log.json \
  --brd specs/brd/brd-requirements.json \
  --out specs/reviews/brd-grounding.json
```

The script writes `specs/reviews/brd-grounding.json` (`{ pass, frd_total, frd_covered, net_new[], dropped[] }`) and exits non-zero on any violation. **This is a hard gate, independent of the rubric score:**
- **`net_new` non-empty** → the BRD invented a requirement not in the FRD or any clarification. For each, either delete it or get explicit human sign-off and record it as a `C-n` clarification (then re-trace and re-run). Do **not** proceed with an unresolved net-new requirement.
- **`dropped` non-empty** → the BRD silently lost an FRD requirement. Add a BR entry covering it (or, if the human confirms it is intentionally out of scope, record that decision as a `C-n` clarification noting the deferral) and re-run.

Only when `brd-grounding.json#pass === true` may you proceed to Step 4.5. (Skip this step entirely in interview-from-scratch mode — there is no FRD to ground against.)

### Step 4.5 — Phase Evaluation Gate

Spawn the `evaluator` agent (artifact mode) to validate the BRD before human review.

**Agent invocation:**

Spawn Agent with subagent_type="evaluator" and prompt:
- Phase: brd
- Artifact: the BRD file path (specs/brd/brd.md or specs/brd/feature-{name}.md)
- Upstream: in FRD mode, `specs/brd/source-frd.md` + `specs/brd/frd-requirements.json` + `specs/brd/clarification-log.json`; otherwise none
- Grounding verdict: in FRD mode, `specs/reviews/brd-grounding.json` (already PASS from Step 4.4 — the evaluator confirms the rubric's traceability criterion against it)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "brd"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Write result to specs/reviews/phase-brd-eval.json

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to Step 5. Attach the eval summary (weighted average, any warnings).
2. If verdict is **FAIL** — revise the BRD to address ALL error-severity findings. Re-run the evaluator with incremented iteration and previous score.
3. **Ratchet rule:** weighted_average must be >= previous iteration's score. If it decreases, revert to the previous version and try a different revision approach.
4. After 3 iterations without PASS — present the best-scoring version to the human with all findings attached. Note: "Phase evaluator did not reach threshold after 3 iterations. Findings below require human judgment."

### Step 5 — Present for Human Approval

Display the BRD and ask: "Does this BRD accurately capture the requirements? Approve to proceed to `/spec`, or provide corrections."

---

## Output

| File | Purpose |
|------|---------|
| `specs/brd/brd.md` | Full BRD for a new project |
| `specs/brd/feature-{name}.md` | BRD for a feature addition |
| `specs/brd/brd-requirements.json` | Machine-readable requirement spine; each BR carries `traces` to FRD/clarification ids |
| `specs/brd/source-frd.md` | (FRD mode) immutable copy of the provided FRD — the grounding baseline |
| `specs/brd/frd-requirements.json` | (FRD mode) extracted `FRD-n` requirements the BRD is checked against |
| `specs/brd/clarification-log.json` | Confirmed interrogation answers (`C-n`) — the only sanctioned net-new content |
| `specs/reviews/brd-grounding.json` | (FRD mode) deterministic grounding verdict (`pass`, `net_new[]`, `dropped[]`) |

---

## Gate

**Grounding gate (FRD mode) — hard block.** `grounding-check.js` proves mechanically that the BRD invented nothing (`net_new`) and dropped nothing (`dropped`) relative to the FRD + clarifications. Any violation blocks before the rubric even runs, regardless of quality score — see Step 4.4.

**Phase evaluation gate runs before human approval.** The evaluator agent (artifact mode) scores the BRD against 5 criteria (completeness, traceability, specificity, consistency, actionability). Threshold: average >= 7.0, all criteria >= 5. In FRD mode the traceability criterion is anchored to the grounding verdict, not free judgement.

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
