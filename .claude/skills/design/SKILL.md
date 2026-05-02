---
name: design
description: Generate system architecture, machine-readable schemas, and UI mockups. Spawns planner + ui-designer concurrently.
context: fork
---

# Design Skill — System Architecture & UI Mockups

## Usage

```
/design
```

No arguments. Reads from `specs/stories/` and produces architecture documents, machine-readable schemas, and HTML mockups concurrently.

---

## Overview

This is the third gate in the SDLC pipeline. Two agents run concurrently in a single message: a `planner` agent produces system architecture and machine-readable schemas, while a `ui-designer` agent produces self-contained HTML mockups. After both complete, a post-completion validation step verifies that UI data shapes align with API contracts.

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
- Record assumptions in `system-design.md` or `api-contracts.md` when risk is low.

## Step 1 — Spawn Two Agents Concurrently

In a single message, invoke both agents using the Agent tool. Do not wait for the planner to finish before starting the ui-designer.

---

### Agent 1 — planner

**Prompt:**

> Read all ready story files in specs/stories/ plus specs/stories/epics.md and specs/stories/dependency-graph.md. Ignore any story listed in specs/stories/backlog-needs-breakdown.md. Design the full system architecture for this project.
>
> Write the following files to specs/design/:
>
> 1. **system-design.md** — High-level architecture overview: components, data flows, infrastructure topology, key design decisions and rationale.
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

### Agent 2 — ui-designer

**Prompt:**

> Read all ready story files in specs/stories/ and specs/design/api-contracts.md (if it exists; wait or proceed with story context if not yet available).
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

## Step 2 — Post-Completion Validation

After both agents complete, perform a validation pass:

1. Read `specs/design/api-contracts.md`
2. Read all HTML files in `specs/design/mockups/`
3. For each mockup, extract field names used in forms and displayed data
4. Compare against the corresponding API endpoint schemas in `api-contracts.md`
5. Flag any divergence: field present in mockup but missing from API contract, or vice versa

Report the validation results:
- List any mismatches found (mockup file, field name, expected vs. actual)
- If all shapes align, confirm: "All UI data shapes validated against API contracts."

---

## New Artifacts vs forge_v2

| Artifact | Purpose |
|----------|---------|
| `api-contracts.schema.json` | OpenAPI 3.0 schema — machine-readable by the evaluator for contract testing |
| `data-models.schema.json` | JSON Schema — used by builder agents to generate type-safe code |
| `component-map.md` | Maps stories to implementation files — used by builder agents for routing |

These are new in this pipeline. forge_v2 produced only markdown documents. The `.schema.json` files enable automated validation in later pipeline stages.

---

## Output

| File | Purpose |
|------|---------|
| `specs/design/system-design.md` | Architecture overview |
| `specs/design/api-contracts.md` | Human-readable API contracts |
| `specs/design/api-contracts.schema.json` | OpenAPI 3.0 machine-readable schema |
| `specs/design/data-models.md` | Human-readable data model definitions |
| `specs/design/data-models.schema.json` | JSON Schema for all data entities |
| `specs/design/folder-structure.md` | Proposed directory tree with annotations |
| `specs/design/component-map.md` | Story ID → implementation files mapping |
| `specs/design/deployment.md` | Deployment architecture and CI/CD plan |
| `specs/design/mockups/E{n}-S{n}.html` | One self-contained HTML mockup per UI story |

---

## Gate

**Human approval is required before proceeding to `/build`.**

After presenting all artifacts and validation results, ask: "Does this architecture and these mockups look correct? Approve to proceed to `/build`, or provide corrections."

---

## Gotchas

- **API shape divergence.** The planner and ui-designer run concurrently and may independently invent field names. The post-completion validation step exists specifically to catch this. Never skip it.
- **Missing deployment.md.** Builder agents need to know the target environment. This file is required, not optional.
- **Mock data must match API contracts.** If a mockup shows a `user_name` field but the API contract defines `username`, the downstream evaluator will flag a mismatch.
- **No folder structure means builder agents guess.** The `folder-structure.md` and `component-map.md` are the routing instructions for the build phase. Missing or vague entries cause agents to create files in wrong locations.
- **Unready stories must not get a component map.** `needs_breakdown` stories are product-planning backlog, not implementation input.
- **Ambiguous ownership creates merge conflicts.** Each file in `component-map.md` needs one owner. When multiple stories need a shared file, mark one story as owner and list the others under `Consumes:` or `Declares additions:`.
- **Schema files must be valid JSON.** Run a syntax check on both `.schema.json` files before presenting for human review.
- **Concurrent execution requires a single message.** Both Agent tool calls must appear in the same response. Do not run them sequentially.
