---
name: design
description: "[Internal pipeline stage — run by /build (use --doc-only standalone for an ARB narrative); invoke directly only as a power user.] Generate system architecture, machine-readable schemas, and UI mockups. Spawns planner + generator concurrently."
argument-hint: "[--doc-only [path] | --delta --stories <dir> | --story <file> --amendment-id <id> | --baseline-recovery]"
context: fork
---

# Design Skill — System Architecture & UI Mockups

> **Ultracode tip:** This is the most reasoning-heavy, divergent phase in the pipeline — exploring a wide space of architecture and schema alternatives. Run `/effort ultracode` before invoking it so the design space is explored as a judge-panel of approaches, then drop back to `/effort high` before the execution phases (`/auto`, `/implement`).

## Usage

```
/design               # full pipeline mode (default)
/design --doc-only    # lightweight architecture narrative, no pipeline
/design --doc-only [path]   # write the doc to [path] instead of the default
/design --delta --stories specs/stories/sprint-N/ --amendment-id sprint-N   # sprint delta
/design --delta --story specs/stories/E{n}-S{n}.md --amendment-id story-E{n}-S{n}   # single-story delta
/design --baseline-recovery   # one-time: derive a living design from an existing codebase
```

The default reads from `specs/stories/` and produces architecture documents, machine-readable schemas, and HTML mockups concurrently — it is an SDLC gate.

`--doc-only` is a different lane entirely: it authors a single architecture / ARB narrative document and does **nothing else**. See **Doc-Only Mode** below. Use it for Architecture Review Board write-ups, design proposals, and discussion documents that are not (yet) driving a build.

`--delta` and `--baseline-recovery` are a third lane: amending or bootstrapping the **living** `specs/design/` baseline for a system already past sprint 1. See **Delta Mode** and **Baseline Recovery Mode** below. Unlike `--doc-only`, both write into `specs/design/` — they are SDLC gates, not disposable artifacts.

---

## Doc-Only Mode (`--doc-only`)

> A **disposable artifact** lane (see CLAUDE.md → *Disposable Artifacts*). It does **not** spawn the planner, generator, or evaluator; it produces **no** machine-readable schemas, mockups, trace spines, or grounding gates; it runs **no** ratchet loop and **no** security review. There is no story prerequisite. Skip every numbered step below — they belong to full mode only.

When `--doc-only` is present, do exactly this and stop:

1. **Gather context, don't generate it.** Read whatever already exists that is relevant — `CONTEXT.md`, ADRs, `specs/brownfield/` maps, existing source, `README.md`. If the request is ambiguous about scope or audience (ARB? internal proposal? RFC?), ask one or two clarifying questions before writing. Skip `superpowers:brainstorming` and the clarify skill's full budget — this is a write-up, not a design gate.

2. **Author one document.** Write a single self-contained Markdown file containing the sections an architecture/ARB review actually needs:
   - Context & problem statement (what, why, who it's for)
   - Proposed architecture: components, responsibilities, data flows, key interfaces
   - Design decisions & trade-offs considered (the part an ARB cares about most — alternatives weighed, not just the choice)
   - Risks, dependencies, and open questions
   - Diagrams as inline Mermaid where they clarify (sequence/component/deployment)

3. **Write it where the human wants it.** If a path argument was given, use it. Otherwise default to `docs/architecture/<slug>.md` (create the directory if needed) — **not** `specs/design/`, which is reserved for the SDLC pipeline's machine-readable artifact set.

4. **Stop.** Do not write schema files, do not produce mockups, do not spawn agents, do not run `trace-check.js`, do not run the evaluator. Present the document path and a one-paragraph summary. If the work later needs to become shipped code, that is a separate decision to enter the full pipeline (`/spec` → `/design` → `/auto`).

---

## Delta Mode (`--delta`)

> Invoked by `/sprint` (many stories) or `/feature`'s impact classifier (one
> design-touching story) when `specs/design/` already holds an approved
> baseline. **Never regenerates `specs/design/` from scratch** — it reads the
> living design as the baseline and writes a non-destructive amendment. See
> `docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md`.

### Prerequisites (delta mode only)

`specs/design/architecture.md` must already exist — delta mode amends a
baseline, it does not create one. If it does not exist, halt and tell the
human to run `/sprint` (which bootstraps a baseline via `--baseline-recovery`
first) or full `/design` for a true sprint-1 build.

The caller passes either `--stories specs/stories/sprint-N/` (many stories,
from `/sprint`) or `--story specs/stories/E{n}-S{n}.md` (one story, from
`/feature`'s impact classifier) plus `--amendment-id <sprint-N|story-E{n}-S{n}>`
— the id used for the amendment filename.

### Step D1 — Read the living baseline

Read every file in `specs/design/` (architecture.md, api-contracts.md +
`.schema.json`, data-models.md + `.schema.json`, component-map.md,
reasons-canvas.md, folder-structure.md, deployment.md) plus
`specs/design/constitution.md` if present. This is the baseline every change
must extend, not replace.

### Step D2 — Read the delta input

Read the story file(s) passed in (`--stories`/`--story`), the committed
DeepWiki (`specs/brownfield/wiki/`), and `specs/brownfield/code-graph.json`
when present. If `specs/brd/sprint-N/requirements-delta.json` exists for this
sprint (from `/brd --delta`), read it too — it names which requirements are
new, changed, carried, or dropped.

### Step D3 — Spawn the planner (single agent, not concurrent with a generator)

Delta mode never spawns the mockup generator — an amendment is a narrative +
schema diff, not a fresh UI pass. Spawn one `planner` agent:

**Prompt:**

> Read every file in specs/design/ (the living baseline) plus
> specs/design/constitution.md if it exists. Read the story file(s) at
> `<stories path>`, the committed DeepWiki at specs/brownfield/wiki/, and
> specs/brownfield/code-graph.json.
>
> For each story, decide what it changes in the existing architecture. Do not
> regenerate any file from scratch — every change must be additive or a
> targeted edit to the existing content. Write:
>
> 1. **specs/design/amendments/<amendment-id>.md** — the amendment narrative:
>    - One subsection per story: what it changes, options considered, the
>      recommendation, and the per-component impact.
>    - A citation to a specific DeepWiki page/symbol or code-graph node for
>      every edit — an edit with no citation is not allowed.
>    - For every edit, name the existing module/seam/layer it extends. If no
>      existing seam fits, say so explicitly and justify introducing a new one
>      — do not silently create a parallel structure.
>    - A **Breaking Changes** section listing every API/schema change that
>      breaks an existing consumer, each with a concrete justification. Empty
>      section (`None.`) if there are none.
>
> 2. **Updated specs/design/architecture.md, api-contracts.md,
>    api-contracts.schema.json, data-models.md, data-models.schema.json,
>    component-map.md** — edited in place, additively. Preserve every existing
>    entry that this sprint's stories do not change. Add new component-map
>    rows for the new stories; do not remove existing rows unless a story
>    explicitly retires that component (state this in the amendment).
>
> 3. **specs/design/reasons-canvas.md** — append to (do not replace) the
>    Entities and Governs sections: mark new entities `new`, cite existing
>    graph nodes for touched entities, and add newly governed paths to
>    `Governs` without removing paths this sprint didn't touch.
>
> If `specs/design/constitution.md` exists, treat every line under its
> `## Invariants` heading as a hard constraint. Before writing, check each
> proposed change against every invariant; if a change would violate one, do
> not make it — find another approach or flag the conflict in the amendment's
> Breaking Changes section for human resolution at GATE 2.

### Step D3.5 — Duplication pre-check (scoped, non-blocking)

1. Check whether `specs/brownfield/code-graph.json` exists.
   - Missing (a pure-greenfield sprint that never ran `/brownfield`) — skip
     the rest of this step entirely. Record
     `"duplication_precheck": "skipped-no-graph"` to carry into Step D7.
     Do not run the pack script or spawn a reviewer.
2. If it exists, refresh the pack: `node .claude/scripts/modularity-pack.js`.
3. From the amendment just written in Step D3, collect the touched scope:
   the new/changed `component-map.md` rows and the paths just added to
   `reasons-canvas.md`'s `Governs` list for this amendment.
4. Spawn Agent with `subagent_type="modularity-reviewer"`:

   > You are being invoked as part of `/design --delta` Step D3.5, not a
   > full `/brownfield --full` pass. Read `specs/brownfield/modularity-pack.md`/`.json`
   > as usual, but restrict your duplication/responsibility/argument-clump
   > judgment to entries that overlap these paths (this amendment's
   > new/changed components): `<touched-scope path list>`. Ignore
   > pre-existing candidates unrelated to this sprint's changes. Write your
   > output to `specs/reviews/design-delta-duplication-<amendment-id>.md`
   > and `specs/reviews/design-delta-duplication-<amendment-id>.json`
   > instead of the default `specs/reviews/modularity-review.md`/`-verdict.json`
   > — do not touch those default files.
5. If the agent errors, or the JSON file is absent/unparseable afterward,
   record `"duplication_precheck": "inconclusive"` — never silently treated
   as `PASS`.

**Known limitation:** this pre-check compares touched-scope paths against
*existing* code via the modularity pack (itself derived from
`code-graph.json`), so it is strongest for changed-existing components and
paths pulled in via the amendment's `Governs` list — both have pack entries
to compare against — and weakest for a component that is entirely net-new,
since a brand-new path has no pack entry yet and will typically read as
`PASS` even if it duplicates existing functionality.

### Step D4 — Emit the trace spine + Grounding Gate [HARD BLOCK]

Same mechanism as full mode Step 1.9, scoped to this sprint's stories. Append
new entries to the existing `specs/design/design-traces.json` (do not drop
prior sprints' entries), then check only this sprint's set:

```bash
node .claude/scripts/trace-check.js \
  --required <stories-path>/story-traces.json \
  --downstream specs/design/design-traces.json \
  --layer design-delta \
  --out specs/reviews/design-grounding.json
```

Any `net_new` or `dropped` for this sprint's stories blocks Step D5.

### Step D5 — Contract-drift check

```bash
node .claude/scripts/contract-drift-gate.js --spec specs/design/api-contracts.schema.json
```

A `breaking` verdict is not automatically a hard stop in delta mode — cross-
reference `specs/reviews/contract-drift-verdict.json` against the amendment's
Breaking Changes section. Every breaking endpoint the tool reports must have a
matching justification entry; if any does not, revise the amendment or the
change before Step D6.

### Step D6 — Design-delta Evaluation Gate

Spawn Agent with subagent_type="evaluator" and prompt:
- Phase: design-delta
- Artifacts: specs/design/amendments/<amendment-id>.md, specs/design/architecture.md, specs/design/api-contracts.md, specs/design/api-contracts.schema.json, specs/design/data-models.md, specs/design/data-models.schema.json, specs/design/component-map.md, specs/design/reasons-canvas.md
- Upstream: the story file(s) passed in, specs/design/constitution.md, specs/brownfield/wiki/, specs/brownfield/code-graph.json
- Grounding verdict: specs/reviews/design-grounding.json (already checked in Step D4)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "design-delta"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Write result to specs/reviews/phase-design-delta-eval.json

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to Step D7 with the eval summary.
2. If verdict is **FAIL** — revise the amendment/living design and re-run.
3. **Ratchet rule:** weighted_average must be >= previous iteration. Revert on regression.
4. After 3 iterations — present best version with findings.

### Step D7 — Present for Human Approval (GATE 2 — never collapsible)

Display:
1. The amendment narrative (`specs/design/amendments/<amendment-id>.md`)
2. `git diff -- specs/design/ ':!specs/design/amendments'` so the human
   reviews exactly what changed in the living design, excluding the
   amendment file itself
3. The contract-drift verdict and the amendment's Breaking Changes section side by side
4. The design-delta evaluator verdict
5. The duplication pre-check result from Step D3.5 — the verdict and
   findings from `specs/reviews/design-delta-duplication-<amendment-id>.json`,
   or the `skipped-no-graph` / `inconclusive` marker if it didn't run to
   completion

Ask: "Does this design amendment correctly evolve the existing architecture?
Approve to commit the amendment and proceed, or provide corrections."

Do not auto-advance — this gate is never skipped by `--autonomous` in
`/sprint` or `/feature` (there is no `--auto` zero-gate mode for the design
amendment). On approval, commit the amendment together with the updated
living-design files in one commit:

```bash
git add specs/design/
git commit -m "design: <amendment-id> amendment"
```

(The amendment-provenance pre-commit gate requires exactly this — a new file
under `specs/design/amendments/` in the same commit as any other
`specs/design/` change.)

---

## Baseline Recovery Mode (`--baseline-recovery`)

> A one-time bootstrap for a true brownfield app the harness did not build —
> invoked by `/sprint` Phase 0 when `specs/design/architecture.md` is missing
> but source code exists. After this runs once, the app evolves through
> Delta Mode exactly like a harness-built system.

### Step BR1 — Ensure discovery exists

If `specs/brownfield/code-graph.json` does not exist, run full `/brownfield`
discovery first (it produces the code graph and the committed DeepWiki).

### Step BR2 — Derive the living design from the graph

Spawn one `planner` agent:

**Prompt:**

> Read specs/brownfield/code-graph.json and the committed DeepWiki at
> specs/brownfield/wiki/. Derive the full living design set this codebase
> already implements — do not invent improvements, describe what exists:
>
> 1. **specs/design/architecture.md** — components, data flows, and key
>    design decisions as observed in the graph and wiki.
> 2. **specs/design/api-contracts.md** + **api-contracts.schema.json** —
>    every endpoint the graph/wiki surfaces, in OpenAPI 3.0 shape.
> 3. **specs/design/data-models.md** + **data-models.schema.json** — every
>    entity observed.
> 4. **specs/design/component-map.md** — map every existing top-level module
>    to a synthetic story id (`LEGACY-1`, `LEGACY-2`, ...) so the ownership
>    sensor has something to check changes against going forward.
> 5. **specs/design/reasons-canvas.md** — mark every entity `existing`, citing
>    its code-graph node; the `Governs` list is every source path the graph
>    contains.
> 6. **specs/design/folder-structure.md** and **specs/design/deployment.md** —
>    as observed, or "not determinable from static analysis — fill in
>    manually" where the graph has no signal.
>
> Stamp every file's frontmatter or opening line with
> `<!-- provenance: derived-from-code, low-confidence areas flagged below -->`.
> For any section built on a weak signal (e.g. a low seam-confidence area, or
> an endpoint inferred rather than directly observed), add an inline
> `<!-- LOW CONFIDENCE: ... -->` marker so the human reviewer knows exactly
> where to look harder.

### Step BR3 — One-time human approval

This is a separate gate from Delta Mode's GATE 2 — it approves the recovered
baseline itself, not an amendment to it. Display the derived artifacts and
every `LOW CONFIDENCE` marker found, and ask: "Does this recovered baseline
accurately describe the existing system? Correct any inaccuracies now — this
becomes the baseline every future sprint amends."

On approval, commit as the initial baseline (the amendment-provenance gate's
`initial-design` exemption applies — there is no prior baseline to amend):

```bash
git add specs/design/
git commit -m "design: recovered baseline from existing codebase"
```

---

## Overview (full mode)

This is the third gate in the SDLC pipeline. Two agents run concurrently in a single message: a `planner` agent produces system architecture and machine-readable schemas, while the `generator` agent produces self-contained HTML mockups. After both complete, an `evaluator` agent (artifact mode) validates cross-phase traceability, schema correctness, and field-shape consistency between mockups and API contracts.

---

## Prerequisites (full mode only — `--doc-only` has none)

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

**Required glossary read.** Before the planner names any entity, read `CONTEXT.md` if present. Every entity in `data-models.schema.json`, `api-contracts.schema.json`, and the REASONS Canvas `Entities` section must use `CONTEXT.md`'s term for that concept. A new domain concept goes into `CONTEXT.md` first (add a `### <term>` entry), then into the schema — never invent a name in the schema alone.

## Step 0.7 — Pre-Code Modularity Assessment

Before spawning the planner, perform a lightweight greenfield modularity assessment so the design does not bake in avoidable coupling:

- Classify each domain area as **core/supporting/generic** and record expected **volatility** (high/medium/low).
- Identify module boundaries and the **integration contracts** between them before naming files.
- Apply the Balanced Coupling lens: stronger integration is acceptable only when distance is low or volatility is low; high-volatility areas need explicit public contracts and lower knowledge leakage.
- Name likely **coupling risks**: shared mutable models, cross-context imports, duplicated business rules, argument clumps, and pass-through modules.
- Feed the result into the planner prompt and require the REASONS Canvas `Structure` and `Safeguards` sections to carry the relevant boundaries and coupling risks.

## Step 1 — Spawn Two Agents Concurrently

In a single message, invoke both agents using the Agent tool. Do not wait for the planner to finish before starting the generator.

---

### Agent 1 — planner

**Prompt:**

> Read all ready story files in specs/stories/ plus specs/stories/epics.md and specs/stories/dependency-graph.md. If present, also read `specs/brd/brd-analysis.json` and use its `domain_concepts`, `ambiguity_table`, `edge_case_table`, `ac_coverage_matrix`, and `risk_gap_table` as design inputs. Ignore any story listed in specs/stories/backlog-needs-breakdown.md. Design the full system architecture for this project.
>
> When `specs/brd/brd-analysis.json` exists: carry unresolved `ambiguity_table` entries into architecture assumptions or open questions, map `edge_case_table` entries to API/UI/error-state design, use `risk_gap_table` to drive Safeguards, and ensure `domain_concepts` align with Entities in the REASONS Canvas.
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
> 7. **component-map.md** — A table mapping every ready story ID (from specs/stories/) to the specific files that will be created or modified to implement it. Include `Produces:` and `Consumes:` notes for cross-story interfaces, and identify the owning story for every shared file. Wrap every file/directory path in backticks — the ownership sensor (`ownership-check.js`) parses only backticked tokens, and a map it cannot parse blocks commits loudly (`empty_map`).
>
> 8. **deployment.md** — Deployment architecture: environments (dev/staging/prod), CI/CD pipeline steps, infrastructure-as-code approach, secrets management strategy, rollback procedure.
>
> 9. **reasons-canvas.md** — The SPDD **REASONS Canvas**: the design's single narrative spine, consolidating the above into eight sections — **R**equirements, **E**ntities, **A**pproach, **S**tructure, **O**perations, **N**orms, **S**afeguards, and **Governs**. Follow `.claude/skills/design/references/reasons-canvas-template.md` exactly. The `Entities` section marks each entity **existing** (citing a `specs/brownfield/code-graph.json` node) or **new** when that graph is present, so the design extends real code. The `Governs` section is a machine-read bullet list of every source path this design creates or modifies (derive it from `component-map.md`) — the drift monitor uses it to detect Canvas↔code drift, so it must be accurate.
>
> Include the Step 0.7 modularity assessment in `architecture.md` and the Canvas: domain classification (`core/supporting/generic`), volatility, module boundaries, integration contracts, Balanced Coupling trade-offs, and coupling risks that the implementation must guard against.

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

Also run the **Canvas structure gate** (deterministic, always — the Canvas ships in every design):

```bash
node .claude/scripts/validate-canvas.js specs/design/reasons-canvas.md
```

A non-zero exit (a missing REASONS section, or a `Governs` list with no source paths) **BLOCKS** — fix the Canvas before Step 2. The `Governs` list must be non-empty so the drift monitor can detect Canvas↔code drift later.

Also run the **vocabulary-consistency gate** (deterministic; skip only when `CONTEXT.md` does not exist yet):

```bash
node .claude/scripts/vocabulary-check.js \
  --glossary CONTEXT.md \
  --domain-concepts specs/brd/brd-analysis.json \
  --data-models specs/design/data-models.schema.json \
  --api-contracts specs/design/api-contracts.schema.json \
  --out specs/reviews/vocabulary-check.json
```

Exit code 1 means a real vocabulary mismatch: an entity/model name in `domain_concepts`, `data-models.schema.json`, or `api-contracts.schema.json` has no matching term in `CONTEXT.md` — add the missing term to `CONTEXT.md` (or fix the name to match an existing one) before Step 2. Exit code 2 means an infrastructure/usage problem, not a vocabulary mismatch — most commonly `CONTEXT.md` does not exist yet (run `/brd` first) or a candidate JSON file is malformed; resolve the underlying problem rather than adding a glossary term. This is the deterministic backstop for the API-shape-divergence gotcha below.

> **Living artifact — fix the prompt first (gap G4).** The Canvas is not write-once. When a later `/change` or `/refactor` alters behavior or moves code, update `reasons-canvas.md` *with the same change* — change the design, then the code — and keep its `Governs` list accurate. The G2 drift monitor (`drift-report.js`) flags governed paths that vanished as **design-vs-code drift**, so a Canvas left to rot will surface in the next drift run rather than silently misleading the next reader.

### Step 2 — Phase Evaluation Gate

After both agents (planner + generator) complete, spawn the `evaluator` agent (artifact mode). This replaces and extends the previous field-shape validation.

**Agent invocation:**

Spawn Agent with subagent_type="evaluator" and prompt:
- Phase: design
- Artifacts: specs/design/architecture.md, specs/design/api-contracts.md, specs/design/api-contracts.schema.json, specs/design/data-models.md, specs/design/data-models.schema.json, specs/design/folder-structure.md, specs/design/component-map.md, specs/design/deployment.md, specs/design/reasons-canvas.md, all specs/design/mockups/*.html files
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
| `specs/design/reasons-canvas.md` | SPDD REASONS Canvas — the design's narrative spine + machine-read `Governs` list (drift source of truth) |
| `specs/design/design-traces.json` | Trace spine: each component → story id(s) |
| `specs/reviews/design-grounding.json` | (when story-traces exists) deterministic story-coverage verdict |
| `specs/design/deployment.md` | Deployment architecture and CI/CD plan |
| `specs/design/mockups/E{n}-S{n}.html` | One self-contained HTML mockup per UI story |
| `specs/design/constitution.md` | (when present) cross-sprint invariants delta mode and the design-delta rubric check every amendment against |
| `specs/design/amendments/<id>.md` | (delta mode) the amendment narrative: per-story impact, seam citations, breaking changes |
| `specs/reviews/phase-design-delta-eval.json` | (delta mode) design-delta rubric verdict |

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

**Delta mode's GATE 2 is never collapsed** by `--autonomous` in `/sprint` or
`/feature` — there is no zero-gate mode for a design amendment, unlike the
autonomous scope-routing gates elsewhere in the harness.

---

## Gotchas

- **API shape divergence.** The planner and generator run concurrently and may independently invent field names. Both must read `CONTEXT.md` before naming entities — that is the primary defense. `vocabulary-check.js` (Step 1.9) and the evaluator (artifact mode) gate are the deterministic and inferential backstops that catch what slips through — never skip either.
- **Missing deployment.md.** Builder agents need to know the target environment. This file is required, not optional.
- **Mock data must match API contracts.** If a mockup shows a `user_name` field but the API contract defines `username`, the downstream evaluator will flag a mismatch.
- **No folder structure means builder agents guess.** The `folder-structure.md` and `component-map.md` are the routing instructions for the build phase. Missing or vague entries cause agents to create files in wrong locations.
- **Unready stories must not get a component map.** `needs_breakdown` stories are product-planning backlog, not implementation input.
- **Ambiguous ownership creates merge conflicts.** Each file in `component-map.md` needs one owner. When multiple stories need a shared file, mark one story as owner and list the others under `Consumes:` or `Declares additions:`.
- **Schema files must be valid JSON.** Run a syntax check on both `.schema.json` files before presenting for human review.
- **Concurrent execution requires a single message.** Both Agent tool calls must appear in the same response. Do not run them sequentially.
- **Delta mode must never regenerate `specs/design/` from scratch.** If the planner's output looks like a fresh design rather than an amendment (missing prior component-map rows, a rewritten architecture.md with no trace to the prior version), stop and re-invoke Step D3 with a stronger instruction to read the baseline first.
- **Baseline recovery is a one-time event, not a re-run.** Once `specs/design/architecture.md` exists, always use Delta Mode — recovery mode is only for the very first bootstrap of a true brownfield app.
