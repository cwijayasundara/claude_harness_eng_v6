---
name: spec
description: Decompose BRD into epics, stories, dependency graph, and feature list for agent team execution.
argument-hint: "[path-to-BRD]"
context: fork
agent: planner
---

# Spec Skill — Story Decomposition & Feature Generation

## Usage

```
/spec specs/brd/brd.md
```

Pass the path to the approved BRD as the argument. Produces epics, stories, a dependency graph, and a `features.json` for session chaining.

---

## Overview

This is the second gate in the SDLC pipeline. The planner agent reads an approved BRD, or an existing set of user stories, and normalizes them into structured, independently executable units of work. Every implementation-ready story gets testable acceptance criteria, a layer assignment, a dependency group, and a readiness marker. A machine-readable root `features.json` is generated from those criteria so the evaluator can track pass/fail state across sessions.

---

## Steps

### Step 1 — Read the BRD

Read the file at the path provided as the argument. Confirm the document exists and is an approved BRD. If the file is missing, halt and ask the human to run `/brd` first.

### Step 1.5 — Clarify Story Readiness Gaps

Invoke `.claude/skills/clarify/SKILL.md` only if the BRD or existing stories contain uncertainty that affects story readiness, dependencies, acceptance criteria, layer assignment, or whether a story must be split.

Use the clarification budget:
- Ask at most 10 questions by default.
- Continue to 15 only if the user explicitly asks.
- Prefer marking oversized or ambiguous stories as `needs_breakdown` over extending the interview.
- Capture low-risk assumptions in story `Notes`.

### Step 2 — Decompose or Normalize into Epics

Group related functionality into epics. Rules:
- Each epic represents a coherent vertical slice of the system (e.g., "User Authentication", "Data Ingestion", "Reporting")
- Each epic contains 3-5 stories. Never fewer than 2, never more than 5.
- Epic IDs use the format: `E1`, `E2`, `E3` ...
- Write the epic index to `specs/stories/epics.md`.
- If the input already contains epics and stories, preserve their intent but normalize IDs, acceptance criteria, dependencies, layers, groups, and readiness fields to this harness format.

### Step 3 — Write Stories

For each story:

**Story ID:** `E{n}-S{n}` (e.g., `E1-S2`)

**Required fields per story:**
- `title`: Short imperative phrase (e.g., "User can register with email and password")
- `description`: 2-4 sentences of context and motivation
- `user_story`: "As a <persona>, I want <capability> so that <value>."
- `acceptance_criteria`: 3-6 items. Each criterion must be:
  - Testable (can be verified by running code or inspecting output)
  - Specific (includes concrete values, states, or behaviors)
  - Not vague ("works properly", "loads fast" are not acceptable)
- `layer`: One of `Types` | `Config` | `Repository` | `Service` | `API` | `UI`
- `group`: Dependency group letter (`A`, `B`, `C` ...) — see Step 4
- `depends_on`: List of story IDs this story depends on (empty list if group A)
- `readiness`: `ready` | `needs_breakdown`
- `breakdown_reason`: Required when readiness is `needs_breakdown`; otherwise `null`

**Readiness rule:** A story is `ready` only when it can be implemented by one teammate without further product decomposition and has 3-6 concrete acceptance criteria. Mark it `needs_breakdown` when it combines unrelated workflows, has multiple independent user goals, lacks verifiable criteria, requires unresolved product decisions, or would force multiple teammates to own the same broad scope.

Do not assign `needs_breakdown` stories to an implementation group. Either break them into smaller ready stories before writing the dependency graph, or place them in `specs/stories/backlog-needs-breakdown.md` for human review.

### Step 4 — Build the Dependency Graph

Write `specs/stories/dependency-graph.md` with:
- Group A: stories with no dependencies (can run in parallel)
- Group B: stories that depend only on Group A
- Group C: stories that depend on Group B (and/or A)
- ... and so on

Format each group as a table showing Story ID, Title, Layer, and Dependencies.

Rules:
- No circular dependencies. Validate before writing.
- Stories in the same group must be independently executable in parallel.
- Foundation layers (Types, Config, Repository) should appear in earlier groups.
- UI stories typically appear in later groups.

### Step 5 — Write Individual Story Files

Write each story to: `specs/stories/E{n}-S{n}.md`

Each file includes: ID, title, description, user_story, acceptance criteria, layer, group, depends_on, readiness, and breakdown_reason.

Use this shape:

```markdown
# E1-S1 — User can register with email and password

## Metadata
- Epic: E1 — User Authentication
- Layer: API
- Group: A
- Depends On: []
- Readiness: ready
- Breakdown Reason: null

## User Story
As a visitor, I want to create an account with email and password so that I can access protected features.

## Description
...

## Acceptance Criteria
- ...
```

### Step 6 — Generate `features.json`

This is the key enhancement over forge_v2. Transform every acceptance criterion into one or more testable features.

**Mapping rule:** Each acceptance criterion produces 1-3 feature entries. The feature description must be a specific, observable behavior. Each feature has executable steps describing how to verify it.

**Output file:** `features.json` at the project root.

Do not write `specs/features.json`. `features.json` is root-level because `/auto`, `/evaluate`, and session chaining read it from the project root.

**Schema for each feature entry:**

```json
{
  "id": "F001",
  "category": "functional",
  "story": "E1-S1",
  "group": "A",
  "description": "User registration endpoint returns 201 with user ID on valid input",
  "steps": [
    "POST /api/auth/register with valid email and password",
    "Assert response status is 201",
    "Assert response body contains a non-null userId field"
  ],
  "passes": false,
  "last_evaluated": null,
  "failure_reason": null,
  "failure_layer": null
}
```

**Field rules:**
- `id`: Sequential, zero-padded to 3 digits (`F001`, `F002` ...)
- `category`: `functional` | `integration` | `ui` | `security` | `performance`
- `story`: Story ID this feature belongs to
- `group`: Inherited from the story's dependency group
- `description`: Single sentence, specific and observable
- `steps`: Ordered list of verification steps (at least 2)
- `passes`: Always `false` at generation time
- `last_evaluated`: Always `null` at generation time
- `failure_reason`: Always `null` at generation time
- `failure_layer`: Always `null` at generation time

Every acceptance criterion must map to at least one feature. No criteria may be omitted.

### Step 7 — Present for Human Review

Display:
1. Epic summary table (ID, title, story count, groups covered)
2. Dependency graph overview
3. Total story count, total feature count
4. Ask: "Does this decomposition look correct? Approve to proceed to `/design`, or provide corrections."

---

## Output

| File | Purpose |
|------|---------|
| `specs/stories/epics.md` | Epic index with story membership and readiness summary |
| `specs/stories/dependency-graph.md` | Parallel execution groups with dependency mapping |
| `specs/stories/E{n}-S{n}.md` | One file per story |
| `specs/stories/backlog-needs-breakdown.md` | Optional list of oversized or ambiguous stories that cannot enter implementation |
| `features.json` | Machine-readable feature list for evaluator |

---

## Gate

**Human review is required before proceeding to `/design`.**

Do not auto-advance. Every story must have testable criteria, a layer assignment, and a group before approval is requested.

Pre-approval checklist:
- [ ] Every story has 3-6 specific, testable acceptance criteria
- [ ] Every story has a layer assignment
- [ ] Every story has a group assignment
- [ ] Every story has `readiness: ready` before it appears in `dependency-graph.md`
- [ ] No circular dependencies in the graph
- [ ] Every acceptance criterion maps to at least one feature in `features.json`
- [ ] All `passes` fields are `false`

---

## Gotchas

- **Vague criteria are rejected.** "The system works properly" fails the gate. Rewrite as an observable behavior.
- **Missing layers break agent routing.** Every story needs a layer so the builder knows which agent handles it.
- **Unready stories block implementation.** If a story is marked `needs_breakdown`, it must not appear in a dependency group or `features.json`. Break it down first.
- **Circular dependencies deadlock the pipeline.** Validate the graph before writing.
- **More than 5 stories per epic** signals the epic is too broad — split it.
- **Do not skip human review.** The dependency graph must be confirmed before design begins.
- **features.json must cover all criteria.** The evaluator uses this file to track pipeline health across sessions.
