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
