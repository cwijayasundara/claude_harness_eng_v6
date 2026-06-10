---
name: design
description: Generate system architecture, machine-readable schemas, and UI mockups. Spawns planner + generator concurrently.
context: fork
---

# Design Skill — System Architecture & UI Mockups

> **Ultracode tip:** This is the most reasoning-heavy, divergent phase in the pipeline — exploring a wide space of architecture and schema alternatives. Run `/effort ultracode` before invoking it so the design space is explored as a judge-panel of approaches, then drop back to `/effort high` before the execution phases (`/auto`, `/implement`).

## Usage

```
/design
```

No arguments. Reads from `specs/stories/` and produces architecture documents, machine-readable schemas, and HTML mockups concurrently.

---

## Overview

This is the third gate in the SDLC pipeline. Two agents run concurrently in a single message: a `planner` agent produces system architecture and machine-readable schemas, while the `generator` agent produces self-contained HTML mockups. After both complete, an `evaluator` agent (artifact mode) validates cross-phase traceability, schema correctness, and field-shape consistency between mockups and API contracts.

---

## Prerequisites

`specs/stories/` must exist and contain story files. If it does not, halt and tell the human to run `/spec` first.

Every story consumed by `/design` must have `Readiness: ready`. If any story is marked `needs_breakdown`, halt and ask the human to approve a breakdown pass before generating architecture artifacts.

---

## Step 0 — Brainstorm Architecture Direction

Before spawning agents, invoke `superpowers:brainstorming` to explore architectural trade-offs, technology choices, and design alternatives. This prevents the planner from committing to the first viable architecture without considering alternatives. Feed the brainstorming output into the planner agent's prompt.

## Step 0.5 — Clarify Load-Bearing Design Decisions

Invoke `.claude/skills/clarify/SKILL.md` only for decisions that materially affect API contracts, data models, security/privacy, external integrations, deployment topology, or file ownership.

Use the clarification budget:
- Ask at most 10 questions by default.
- Continue to 15 only if the user explicitly asks.
- Prefer existing code, `CONTEXT.md`, ADRs, stories, and manifest data over asking.
- Record assumptions in `architecture.md` or `api-contracts.md` when risk is low.

## Step 1 — Spawn Two Agents Concurrently

In a single message, invoke both agents using the Agent tool. Do not wait for the planner to finish before starting the generator.

---

### Agent 1 — planner

**Prompt:**

> Read all ready story files in specs/stories/ plus specs/stories/epics.md and specs/stories/dependency-graph.md. Ignore any story listed in specs/stories/backlog-needs-breakdown.md. Design the full system architecture for this project.
>
> Write the following files to specs/design/:
>
> 1. **architecture.md** — High-level architecture overview: components, data flows, infrastructure topology, key design decisions and rationale.
>    For every major module, describe its public interface, invariants, error modes, and why it is deep enough to justify existing as a module. Avoid pass-through modules that only forward calls.
>
> 2. **api-contracts.md** — Every API endpoint in detail: method, path, request schema (headers, params, body), response schema (success and error shapes), authentication requirements, rate limits. Use a consistent format for each endpoint.
>
> 3. **api-contracts.schema.json** — OpenAPI 3.0 JSON Schema representing all endpoints defined in api-contracts.md. Must be valid and parseable.
>
> 4. **data-models.md** — Every data entity: field names, types, constraints, relationships, indexes, and example records.
>
> 5. **data-models.schema.json** — JSON Schema (draft-07 or later) for every entity in data-models.md. Must be valid and parseable.
>
> 6. **folder-structure.md** — Full proposed directory tree for the implementation, with a one-line annotation for each directory explaining its purpose.
>
> 7. **component-map.md** — A table mapping every ready story ID (from specs/stories/) to the specific files that will be created or modified to implement it. Include `Produces:` and `Consumes:` notes for cross-story interfaces, and identify the owning story for every shared file.
>
> 8. **deployment.md** — Deployment architecture: environments (dev/staging/prod), CI/CD pipeline steps, infrastructure-as-code approach, secrets management strategy, rollback procedure.

---

### Agent 2 — generator (UI mockups)

Spawn the `generator` agent for the mockup step, pointed at `.claude/skills/design/references/ui-mockups.md` for the full self-contained-HTML / CDN-React+Tailwind / aesthetic / data-fidelity guidance.

**Prompt:**

> Read `.claude/skills/design/references/ui-mockups.md`, then read all ready story files in specs/stories/ and specs/design/api-contracts.md (if it exists; wait or proceed with story context if not yet available).
>
> For every story with layer "UI", create a self-contained HTML mockup:
>
> - The mockup must be a single .html file with all CSS and JavaScript inlined (no external dependencies).
> - Use realistic mock data that matches the field names and types defined in api-contracts.md.
> - Show the primary happy-path state. Include at least one empty/error state as a toggle or commented section.
> - Label each interactive element with its API call (e.g., "POST /api/auth/register").
> - The filename must match the story ID: E{n}-S{n}.html
>
> Write all mockups to specs/design/mockups/.

---

### Step 1.9 — Emit the trace spine + Grounding Gate [HARD BLOCK — when `specs/stories/story-traces.json` exists]

After both agents complete, write `specs/design/design-traces.json` — one entry per design component (module/service/endpoint group from `component-map.md`), each tracing to the story ids it realizes:

```json
[
  { "id": "auth-service", "text": "Registration + login endpoints", "traces": ["E1-S1", "E1-S2"] },
  { "id": "user-repository", "text": "User persistence", "traces": ["E1-S1"] }
]
```

Every component must trace to at least one story. A component realizing no story is scope creep or dead design; a story with no component will never be built. Prove it deterministically (when the spec emitted a trace spine):

```bash
node .claude/scripts/trace-check.js \
  --required specs/stories/story-traces.json \
  --downstream specs/design/design-traces.json \
  --layer design \
  --out specs/reviews/design-grounding.json
```

`specs/reviews/design-grounding.json` is a **hard gate independent of the rubric**: any `net_new` (component tracing to no story) or `dropped` (story no component realizes) blocks. Resolve before Step 2. (Skip when `story-traces.json` does not exist.)

### Step 2 — Phase Evaluation Gate

After both agents (planner + generator) complete, spawn the `evaluator` agent (artifact mode). This replaces and extends the previous field-shape validation.

**Agent invocation:**

Spawn Agent with subagent_type="evaluator" and prompt:
- Phase: design
- Artifacts: specs/design/architecture.md, specs/design/api-contracts.md, specs/design/api-contracts.schema.json, specs/design/data-models.md, specs/design/data-models.schema.json, specs/design/folder-structure.md, specs/design/component-map.md, specs/design/deployment.md, all specs/design/mockups/*.html files
- Upstream: specs/stories/ (all story files; and specs/stories/story-traces.json when present)
- Grounding verdict: specs/reviews/design-grounding.json when present (already PASS from Step 1.9 — anchor the traceability criterion to it)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "design"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Cross-phase traceability: with a grounding verdict, confirm it; otherwise verify every story ID appears in component-map.md, every API-layer story has endpoints in api-contracts.schema.json, and every UI-layer story has a mockup in specs/design/mockups/.
- Include field-shape check: Compare mockup field names against API contract field names. Flag mismatches.
- Write result to specs/reviews/phase-design-eval.json

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to human approval with eval summary + traceability report.
2. If verdict is **FAIL** — revise design artifacts. May re-invoke planner or generator for specific fixes. Re-run evaluator.
3. **Ratchet rule:** weighted_average must be >= previous iteration. Revert on regression.
4. After 3 iterations — present best version with findings.

---

## Machine-Readable Artifacts

| Artifact | Purpose |
|----------|---------|
| `api-contracts.schema.json` | OpenAPI 3.0 schema — machine-readable by the evaluator for contract testing |
| `data-models.schema.json` | JSON Schema — used by builder agents to generate type-safe code |
| `component-map.md` | Maps stories to implementation files — used by builder agents for routing |

The `.schema.json` files enable automated validation in later pipeline stages (the evaluator validates contracts and shapes against them).

---

## Output

| File | Purpose |
|------|---------|
| `specs/design/architecture.md` | Architecture overview |
| `specs/design/api-contracts.md` | Human-readable API contracts |
| `specs/design/api-contracts.schema.json` | OpenAPI 3.0 machine-readable schema |
| `specs/design/data-models.md` | Human-readable data model definitions |
| `specs/design/data-models.schema.json` | JSON Schema for all data entities |
| `specs/design/folder-structure.md` | Proposed directory tree with annotations |
| `specs/design/component-map.md` | Story ID → implementation files mapping |
| `specs/design/design-traces.json` | Trace spine: each component → story id(s) |
| `specs/reviews/design-grounding.json` | (when story-traces exists) deterministic story-coverage verdict |
| `specs/design/deployment.md` | Deployment architecture and CI/CD plan |
| `specs/design/mockups/E{n}-S{n}.html` | One self-contained HTML mockup per UI story |

---

## Gate

**Phase evaluation gate runs before human approval.** The evaluator agent (artifact mode) validates:
- Cross-phase traceability (every story has component-map entry, API endpoints, mockups)
- Schema validity (OpenAPI + JSON Schema syntax)
- Field-shape consistency (mockup fields match API contracts)
- Component-map coverage and file ownership
- Folder structure viability

**Human approval is required before proceeding to `/auto`.**

After presenting all artifacts and validation results, ask: "Does this architecture and these mockups look correct? Approve to proceed to `/auto`, or provide corrections."

> `/auto` is the next step in the greenfield path (`/brd` → `/spec` → `/design` → `/auto`). `/build` is the wrapper that runs the whole pipeline starting from a BRD path; it is not intended to be invoked mid-pipeline after `/design` has already been approved.

---

## Gotchas

- **API shape divergence.** The planner and generator run concurrently and may independently invent field names. The evaluator (artifact mode) gate exists specifically to catch this. Never skip it.
- **Missing deployment.md.** Builder agents need to know the target environment. This file is required, not optional.
- **Mock data must match API contracts.** If a mockup shows a `user_name` field but the API contract defines `username`, the downstream evaluator will flag a mismatch.
- **No folder structure means builder agents guess.** The `folder-structure.md` and `component-map.md` are the routing instructions for the build phase. Missing or vague entries cause agents to create files in wrong locations.
- **Unready stories must not get a component map.** `needs_breakdown` stories are product-planning backlog, not implementation input.
- **Ambiguous ownership creates merge conflicts.** Each file in `component-map.md` needs one owner. When multiple stories need a shared file, mark one story as owner and list the others under `Consumes:` or `Declares additions:`.
- **Schema files must be valid JSON.** Run a syntax check on both `.schema.json` files before presenting for human review.
- **Concurrent execution requires a single message.** Both Agent tool calls must appear in the same response. Do not run them sequentially.
