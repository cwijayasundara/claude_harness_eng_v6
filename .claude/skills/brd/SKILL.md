---
name: brd
description: Socratic interview to create a Business Requirements Document. First step in the SDLC pipeline.
context: fork
agent: planner
---

# BRD Skill — Business Requirements Document

## Usage

```
/brd
```

No arguments. Starts an interactive Socratic interview to gather requirements and produces a structured BRD.

---

## Overview

This is the first gate in the SDLC pipeline. Before any code is written, the planner agent interviews the human across five dimensions to surface the full problem space. The interview is Socratic: ask clarifying questions, probe assumptions, and reflect answers back for confirmation before moving on.

---

## Steps

### Step 0 — Brainstorm with Superpowers

Before beginning the interview, invoke `superpowers:brainstorming` to explore the user's intent, requirements, and design space. This surfaces hidden assumptions and alternative framings before the structured Socratic interview locks in a direction. The brainstorming output feeds into the interview — it does not replace it.

### Step 0.5 — Apply the Clarification Budget

Before asking interview questions, invoke `.claude/skills/clarify/SKILL.md`. Use it to cap the total clarification burden:
- Ask only load-bearing questions that affect requirements, scope, data, security, architecture, or story readiness.
- Default to 10 total questions across the BRD interview.
- Continue to 15 only if the user explicitly asks to keep going.
- Capture low-risk assumptions in the BRD instead of asking about them.

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

Create the `specs/brd/` directory if it does not exist.

### Step 5 — Present for Human Approval

Display the BRD and ask: "Does this BRD accurately capture the requirements? Approve to proceed to `/spec`, or provide corrections."

---

## Output

| File | Purpose |
|------|---------|
| `specs/brd/brd.md` | Full BRD for a new project |
| `specs/brd/feature-{name}.md` | BRD for a feature addition |

---

## Gate

**Human approval is required before proceeding to `/spec`.**

Do not auto-advance. Wait for explicit approval or correction.

---

## Gotchas

- **Do not skip the interview.** Never generate a BRD from a single sentence of input.
- **Do not skip Dimension 2.5.** Alternatives must be explored and documented.
- **Avoid vague success metrics.** "Users are happy" is not a metric. Push for numbers.
- **Check existing code first.** Proposing a new auth system when one already exists wastes cycles.
- **Confirm each dimension before moving on.** Misunderstood requirements compound.
- **Do not conflate MVP with the full product.** MVP is the smallest deployable slice.
