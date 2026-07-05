# REASONS Canvas — `specs/design/reasons-canvas.md`

The Canvas is `/design`'s narrative spine: one reviewable artifact that carries intent → design → execution → governance, consolidating `architecture.md`, `data-models.md`, `api-contracts.md`, and `component-map.md` into the SPDD **REASONS** structure. The machine-readable schemas (`api-contracts.schema.json`, `data-models.schema.json`) stay as-is — the Canvas is the *prose* spine that explains and governs them.

Reviews shift from "spot the bug" to "check the intent." When requirements change later, **fix the Canvas first, then the code** ([[gap G4]] sync discipline) — the Canvas is a living artifact, not a write-once spec.

Emit all eight sections. The `Governs` list is **required and machine-read** by the drift monitor, so keep it accurate.

---

## Requirements
Problem statement, definition of done, and the acceptance criteria this design realizes (cite story IDs / AC IDs from `specs/stories/`).

## Entities
The domain entities, their relationships, and business rules — a Mermaid `classDiagram` plus prose. Entity names must match `CONTEXT.md` terms exactly; a new domain concept is added to `CONTEXT.md` first, then reflected here and in the schemas — never invented in the Canvas or schema alone. **In brownfield** (when `specs/brownfield/code-graph.json` exists), mark each entity **existing** (cite the code-graph node) or **new**, so the design extends real code instead of re-inventing it.

## Approach
The strategy chosen to meet the requirements, and the alternatives rejected (with the trade-off that decided each). This is where the thinking lives.

## Structure
How the work fits the system: components, layers, dependencies, and architectural placement. Must agree with `architecture.md` and the layer config.

## Operations
The concrete, testable implementation steps — down to method signatures and execution order. Each operation names the file it lands in (these files feed the `Governs` list).

## Norms
Cross-cutting engineering standards for this work: naming conventions, annotation/decorator rules, dependency-injection style, logging, error handling, data-type choices.

## Safeguards
Non-negotiable boundaries: invariants, precision/rounding rules, performance budgets, security/authz limits. A reviewer checks the diff against these.

## Governs
A bullet list of the repo-relative source paths (or globs) this Canvas designs — every file the Operations create or modify. The drift monitor flags a governed path that no longer exists as **design-vs-code drift**. Example:

- `src/billing/service.py`
- `src/billing/models.py`
- `src/billing/api/*.py`
