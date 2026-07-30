# Ubiquitous Language / Domain Vocabulary Consistency

**Date:** 2026-07-05
**Goal:** Make the harness carry a single, consistent domain vocabulary from BRD through spec, design, and generated code, so every agent in the pipeline shares the same concept model of the problem domain instead of independently naming the same entity differently at each phase.

## Motivation

Investigation this session (file:line citations from a full pipeline read) found that domain-vocabulary artifacts already exist — `brd-analysis.json#domain_concepts`, the REASONS Canvas `Entities` section, `data-models.schema.json`, `api-contracts.schema.json`, and brownfield's `CONTEXT.md` — but they are fragmented and none is mandatory end-to-end:

- `CONTEXT.md` is created only conditionally by `/brownfield` ("if recurring terms are discovered", `.claude/skills/brownfield/SKILL.md:203`) and is a required read only for `/clarify` (`.claude/skills/clarify/SKILL.md:30`). It is never a required input to `/spec`, `/design` full mode, `/implement`, or `.claude/agents/generator.md`.
- `design/SKILL.md`'s own Gotchas section (~line 487) admits the planner and generator "run concurrently and may independently invent field names," caught only by the evaluator's inferential field-shape check — after the fact, not before.
- The `traceability` axis sensors (`grounding-check`, `trace-check`, `verification-matrix-gate`) all operate on stable IDs (`BR-n`, `AC-n`, story IDs) via pure set-membership in `.claude/scripts/trace-check.js`. A requirement named "Account" in the BRD and "User" in the API contract traces cleanly as long as the IDs line up — nothing checks that the noun itself survived the trip.

This closes the gap between structural provenance (which the harness already does well) and semantic consistency (which it does not check at all).

## Scope

- Promote `CONTEXT.md` from an optional, brownfield-only artifact to a first-class glossary seeded at BRD time for every project, greenfield or brownfield.
- Make it a required read for `/spec`, `/design` (planner and generator prompts), `/implement`, and `generator.md`.
- Make it a required write wherever a phase introduces or renames a domain concept, extending the pattern `/clarify` already has.
- Add a new deterministic sensor, `vocabulary-check.js`, that hard-blocks when an entity/field name in `domain_concepts`, `data-models.schema.json`, or `api-contracts.schema.json` does not resolve to a glossary term.
- Make brownfield's Step 6 glossary extraction deterministic, fed by `/code-map`'s existing symbol data instead of open-ended LLM judgment.

Out of scope (see below): per-bounded-context glossaries, fuzzy/embedding-based term matching, a new pipeline phase.

## Artifact Contract

No new file format. `CONTEXT.md` keeps its existing template (`.claude/templates/context.template.md`):

```markdown
# Context

Domain glossary for this codebase. Use terms that matter to users and domain experts.

## Terms

### <Term>
Definition. Include how this term differs from nearby concepts if ambiguity is likely.

## Invariants

- Domain rule or invariant that should remain true across implementation changes.

## Out of Scope Terms

- Terms that are commonly confused with in-scope concepts but should not be used for this product.
```

`### <Term>` headings under `## Terms` are the parse target for the new sensor — no schema change needed.

## Generation Flow

### `/brd` — seed the glossary

Update `.claude/skills/brd/SKILL.md` Step 2.8. After `domain_concepts` is written to `brd-analysis.json`, add a sub-step:

> Write or update `CONTEXT.md` from `domain_concepts`: for each entry, add or update a `### <name>` section under `## Terms` using `notes` as the definition. Do this for both greenfield and brownfield BRDs — `CONTEXT.md` must exist after BRD synthesis whenever `domain_concepts` is non-empty (it always is; Step 2.8 requires it).

This removes the conditionality that made `CONTEXT.md` optional. Existing brownfield behavior (Step 6 of `/brownfield` may also create/update it before `/brd` ever runs) is additive: BRD Step 2.8 merges into an existing `CONTEXT.md` rather than overwriting it.

### `/spec` — required read, no reuse violation

Update `.claude/skills/spec/SKILL.md` Step 1:

> Read `CONTEXT.md` if present. Story titles, descriptions, and acceptance criteria must reuse its terms verbatim — do not introduce a new name for a concept `CONTEXT.md` already defines. If a story needs a concept not yet in `CONTEXT.md`, add it there (see Required Write below) before finalizing the story.

### `/design` — required read + required write

Update `.claude/skills/design/SKILL.md`:

- Step 0.5 / planner prompt: add `CONTEXT.md` to the list of context gathered before design starts (it is already read in `--doc-only` mode per line 37; extend to full mode).
- REASONS Canvas `Entities` section instructions (`.claude/skills/design/references/reasons-canvas-template.md`): "Entity names must match `CONTEXT.md` terms exactly. A new domain concept must be added to `CONTEXT.md` first, then reflected in `data-models.schema.json`/`api-contracts.schema.json` — not invented in the schema alone."
- Gotchas section: replace the passive acknowledgment that planner/generator "may independently invent field names" with an instruction that both read `CONTEXT.md` before naming entities, and that `vocabulary-check.js` (below) is the backstop, not the primary mechanism.

### `/implement` and `generator.md` — required read + required write

Update `.claude/skills/implement/SKILL.md` and `.claude/agents/generator.md`:

> Schema field names (`data-models.schema.json`, `api-contracts.schema.json`) are already authoritative for API/data fields. For domain concepts not yet represented in a schema — internal services, aggregates, business rules — read `CONTEXT.md` before choosing a class/variable/service name. If a new domain concept is introduced during implementation, add it to `CONTEXT.md` before the story is marked done.

### `/clarify` — no change needed

`clarify/SKILL.md:108` already updates `CONTEXT.md` when a term is clarified. This design generalizes that same discipline to design and implement; clarify's existing behavior is the model, not something to change.

## New Sensor: `vocabulary-check.js`

Add `.claude/scripts/vocabulary-check.js`, modeled on the pure-core-plus-CLI shape of `.claude/scripts/trace-check.js`.

**Inputs:**
- `--glossary CONTEXT.md` — parsed for `### <Term>` headings under `## Terms`.
- `--candidates <file...>` — one or more JSON sources to extract candidate names from:
  - `brd-analysis.json#domain_concepts[].name`
  - `data-models.schema.json` entity/property titles (`$defs.*.title`, top-level schema keys)
    (Implementation note: the shipped extractor reads `$defs`/`definitions` object keys only — entity/model definition names, not per-field `.title` values or nested property names. This was a deliberate scope narrowing made during implementation, not a bug.)
  - `api-contracts.schema.json` `components.schemas` keys

**Algorithm (pure function, exported for `node:test`):**

```js
function normalize(name) {
  // lowercase, strip punctuation/whitespace, naive trailing-"s" singularize
}

function checkVocabulary({ glossaryTerms, candidates }) {
  const glossarySet = new Set(glossaryTerms.map(normalize));
  const undocumented = candidates
    .filter((c) => !glossarySet.has(normalize(c.name)))
    .map((c) => ({ name: c.name, source: c.source }));
  const candidateSet = new Set(candidates.map((c) => normalize(c.name)));
  const unused = glossaryTerms.filter((t) => !candidateSet.has(normalize(t)));
  return {
    pass: undocumented.length === 0,
    undocumented,   // hard-block reasons — same semantics as trace-check's net_new
    unused,         // report-only — a stale glossary entry, not a build blocker
  };
}
```

Matching is exact-after-normalization only. No fuzzy or embedding-based matching — the failure mode this fixes is "Account vs. User" (a wholly different noun), not "Account vs. Accounts" (already handled by naive singularization), and embedding-based matching would add nondeterminism to a sensor whose entire value is being deterministic.

`pass = undocumented.length === 0`. `unused` never fails the gate — a glossary term with no current schema reference (e.g., a concept the BRD named that design hasn't reached yet) is expected mid-pipeline noise, not a defect.

**CLI contract**, matching `trace-check.js`'s conventions: `--glossary`, `--candidates` (repeatable), `--out <path>`, exit `0` pass / `1` fail / `2` usage error, stdout verdict summary listing each undocumented name and its source file.

**Where it runs:** planning cadence, alongside `validate-canvas.js` at the end of `/design` Step 1.9 (schemas exist by then; `CONTEXT.md` was seeded at BRD). Also re-run at `/implement` pre-commit if new schema entities were added during implementation.

## Harness Manifest

Register a new traceability sensor in `harness-manifest.json`:

```json
{
  "id": "vocabulary-check",
  "axis": "traceability",
  "type": "computational",
  "cadence": "planning",
  "status": "active",
  "scope": "artifacts",
  "wired_at": ".claude/scripts/vocabulary-check.js",
  "signal": "entity/field names in domain_concepts, data-models.schema.json, or api-contracts.schema.json that do not resolve to a CONTEXT.md term",
  "description": "Deterministic vocabulary-consistency sensor: extends the traceability axis from ID-linkage (trace-check) to term-linkage. Catches 'Account in the BRD, User in the API contract' before code is written."
}
```

Update `HARNESS.md`'s traceability row to mention term-consistency alongside ID-linkage. Run `node .claude/scripts/validate-harness-manifest.js` to confirm the new entry validates.

## Brownfield Determinism

Update `.claude/skills/brownfield/SKILL.md` Step 6. Today it says "If recurring domain terms are discovered, create or update `CONTEXT.md`" with no deterministic input — pure LLM judgment on an unstructured prompt.

Change the input to a deterministic naming-cluster extraction from `/code-map`'s existing `code-graph.json`:

- Add a small pure helper (co-located with or added to `.claude/scripts/modularity-pack.js`, which already extracts evidence from `code-graph.json` for a similar "deterministic evidence, LLM judgment" split) that strips common suffixes (`Controller`, `Service`, `Repository`, `DTO`, `Handler`) from class/file names and counts root-noun frequency.
- Surface the top-N recurring root nouns with file:line evidence (e.g., "`Account` appears in `AccountController`, `AccountRepository`, `AccountService` — 3 files") as candidate terms for Step 6 to confirm into `CONTEXT.md`, rather than the LLM inventing terms unprompted from a full source read.
- This mirrors the existing `modularity-pack.js` → `modularity-reviewer.md` split (deterministic evidence extraction feeding an inferential confirmation pass) rather than introducing a new pattern.

## Prompt and Skill Updates (summary)

- `.claude/skills/brd/SKILL.md` — Step 2.8 sub-step writing `CONTEXT.md` from `domain_concepts`.
- `.claude/skills/spec/SKILL.md` — Step 1 required read + reuse instruction.
- `.claude/skills/design/SKILL.md` + `.claude/skills/design/references/reasons-canvas-template.md` — required read, entity-naming rule, updated Gotchas.
- `.claude/skills/implement/SKILL.md` + `.claude/agents/generator.md` — required read + required write.
- `.claude/skills/brownfield/SKILL.md` — Step 6 fed by deterministic naming-cluster evidence.
- `.claude/scripts/modularity-pack.js` (or a new sibling script) — naming-cluster extraction helper.
- `harness-manifest.json` + `HARNESS.md` — new sensor registration.

## Tests

- `test/vocabulary-check.test.js`:
  - passes when all candidate names resolve to glossary terms;
  - fails on an undocumented candidate name, with the correct source file in the verdict;
  - naive singularization matches `Account`/`Accounts`;
  - `unused` terms are reported but do not fail the gate;
  - CLI usage error on missing `--glossary`.
- `test/harness-manifest.test.js` — assert the new `vocabulary-check` entry exists and `wired_at` resolves to a real file (existing manifest test pattern).
- `test/trace-check.test.js`-style wiring assertions — confirm `/spec`, `/design`, `/implement`, and `generator.md` prompts mention `CONTEXT.md` as a required read.
- Brownfield naming-cluster helper: unit tests for suffix-stripping and frequency counting against a small fixture `code-graph.json`.

Run target verification:

```bash
npm test
node --test test/vocabulary-check.test.js
node .claude/scripts/validate-harness-manifest.js
```

## Risks

- **False positives on legitimate technical-only names** (e.g., a `CacheEntry` class with no domain meaning): mitigate by scoping candidate extraction to `data-models.schema.json`/`api-contracts.schema.json`/`domain_concepts` only — these are already domain-schema files by construction, not arbitrary source symbols.
- **Glossary bloat for tiny projects**: a one-entity CLI tool still gets a `CONTEXT.md` with one term. Acceptable — the cost is a few lines, not a new phase.
- **Existing brownfield projects with no `CONTEXT.md` yet**: the sensor should degrade loudly (exit 2, not silently pass) when no glossary exists yet but candidates do, prompting the missing BRD/brownfield step rather than skipping the check.
- **Naive singularization edge cases** (e.g., "Address" vs "Addresses" is fine; irregular plurals like "Person"/"People" are not handled): acceptable for v1 — false negatives here just mean a term isn't flagged as undocumented when it technically is a near-miss; document as a known limitation rather than building a stemming library.

## Out of Scope

- Per-bounded-context glossaries (splitting `CONTEXT.md` when a project grows multiple bounded contexts). Worth a future amendment once a project actually needs it — not needed for the common case this fixes.
- Fuzzy or embedding-based synonym matching.
- A new pipeline phase or agent dedicated to vocabulary management.
- Retrofitting existing (already-generated) projects' `CONTEXT.md` files — this design governs new BRD/spec/design/implement runs going forward.
