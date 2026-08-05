---
name: design-render
description: "[Internal pipeline stage — dispatched by /design after its decisions gate passes; invoke directly only to re-render an approved decisions file.] Expand design-decisions.json into the architecture documents, machine-readable schemas, REASONS Canvas and UI mockups."
argument-hint: "[--sprint N]"
context: fork
agent: generator
---

# Design Render — Architecture Expansion (sidekick)

This is the **rendering** half of `/design`. `/design` holds the architecture
dialogue and records the load-bearing calls in
`specs/decisions/design-decisions.json`; this skill expands them into the
document set. It decides nothing.

Runs on the sidekick model by design. Nine documents, two JSON Schemas and one
mockup per UI story is where the token volume lives, and almost all of it is
transcription of decisions already made: a folder tree, a story-to-files table,
and schemas that restate the prose contracts. The judgement — which datastore,
where the chokepoints are, what the design forecloses — happened upstream and is
in the decisions file.

Ambiguity is not resolved here, it is returned. If rendering needs a call the
decisions file does not contain, record it in
`specs/decisions/design-unresolved.json` and name it in your return message.
`/design` puts it to the human and re-dispatches. Guessing here is the failure
this split exists to remove.

---

## Steps

### Step 0 — Decisions Gate [HARD BLOCK]

```bash
node .claude/scripts/validate-design-decisions.js            # gated lane
node .claude/scripts/validate-design-decisions.js --lane --auto   # headless only
```

Non-zero exit: **halt and render nothing.** Report stderr verbatim to the
caller. Do not repair the decisions file — writing the missing decisions is
precisely what this skill must not do.

Then read `specs/decisions/design-decisions.json`. It is the authority for:

- **The stack** — `stack` is committed. Do not re-select technologies.
- **Every load-bearing call** — `chosen` governs, and `rules_out` is a
  prohibition. A document that proposes something a decision rules out is
  wrong even if it is otherwise sound.
- **Precedence** — where the stories or the BRD imply something a decision
  forecloses, the decision wins. Say so in the document rather than silently
  reconciling.

Open `architecture.md` with the recorded-decisions table, one row per
load-bearing decision: id, the decision, and what it rules out. It is the
contract the rest of the design is bound by, and the implementer reads it first.

---

### Step 1 — Render the documents

Read all ready story files in `specs/stories/`, plus `epics.md` and
`dependency-graph.md`. If `specs/brd/brd-analysis.json` exists, use its
`ambiguity_table`, `edge_case_table`, `ac_coverage_matrix` and `risk_gap_table`
as inputs. Ignore anything listed in `backlog-needs-breakdown.md`. Read
`CONTEXT.md` and reuse its vocabulary verbatim.

Write to `specs/design/`:

1. **architecture.md** — the recorded-decisions table first, then components,
   data flows, infrastructure topology. For every major module: its public
   interface, invariants, error modes, and why it is deep enough to justify
   existing. No pass-through modules that only forward calls.
2. **api-contracts.md** — every endpoint: method, path, request schema
   (headers, params, body), response schema for success *and* error, auth
   requirements, rate limits.
3. **api-contracts.schema.json** — OpenAPI 3.0 for those endpoints. It must
   parse, and its `$ref` dialect must match its declared version — a real run
   shipped 3.0.3 declaring `$ref`s to a 2020-12 schema, invalid under either,
   and nothing downstream could generate a client from it.
4. **data-models.md** — every entity: fields, types, constraints, relationships,
   indexes, example records.
5. **data-models.schema.json** — JSON Schema (draft-07+) for every entity. Must parse.
6. **folder-structure.md** — the directory tree, one line per directory.
7. **component-map.md** — every ready story id to the files implementing it,
   with `Produces:` / `Consumes:` for cross-story interfaces and an owning story
   for every shared file. Wrap **only** file paths in backticks —
   `ownership-check.js` parses backticked tokens as owned paths, so a backticked
   mechanism name or budget figure breaks it.
8. **deployment.md** — environments, CI/CD steps, IaC approach, secrets
   handling, rollback.
9. **reasons-canvas.md** — the REASONS Canvas per
   `.claude/skills/design/references/reasons-canvas-template.md`. `Entities`
   marks each entity existing (citing a `code-graph.json` node) or new when that
   graph is present. `Governs` is the machine-read list of every source path
   this design creates or modifies, derived from `component-map.md` — the drift
   monitor reads it, so it must be accurate.

Carry the Step 0.7 modularity assessment from the decisions file into
`architecture.md` and the Canvas: domain classification, volatility, module
boundaries, integration contracts, coupling risks.

### Step 2 — Render the UI mockups

Read `.claude/skills/design/references/ui-mockups.md` and follow it. One
self-contained `.html` per UI-layer story, named `E{n}-S{n}.html`, into
`specs/design/mockups/`. Field names must match `api-contracts.md`.

### Step 3 — Machine-readable artifacts, then hand back

Follow `.claude/skills/design/references/mode-11-machine-readable-artifacts.md`
for the schema and canvas artifacts you must emit.

Then **return**. The deterministic gates (`trace-check`, `validate-canvas`,
`vocabulary-check`), the evaluator, and the human review all run in `/design`'s
main session after you hand back. Report what you wrote and any unresolved
entries; do not run those gates or present the result yourself.

---

## Gotchas

- **Do not re-open a recorded decision.** If one looks wrong, return it as
  unresolved. Quietly designing around it produces a document the human
  approved the premise of but not the content.
- **Do not invent a threshold, limit, or retention window** the decisions file
  does not give you. A number nobody chose reads as decided once it is written
  down.
- **`rules_out` is binding.** Check each document against it before returning.
