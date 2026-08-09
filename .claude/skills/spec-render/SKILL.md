---
name: spec-render
description: "[Internal pipeline stage — dispatched by /spec after its decisions gate passes; invoke directly only to re-render an already-approved decisions file.] Expand an approved spec-decisions.json into the story graph: story files, typed dependency edges, ownership clusters, features.json and the trace spines."
argument-hint: "[path-to-BRD]"
context: fork
agent: generator
---

# Spec Render — Story Graph Expansion (sidekick)

This is the **rendering** half of `/spec`. `/spec` holds the dialogue and records
the load-bearing calls in `specs/decisions/spec-decisions.json`; this skill
expands those recorded decisions into the full artifact set. It decides nothing.

Runs on the sidekick model by design: expansion is mechanical transcription of
decisions already made, and it is where nearly all of the token volume lives.

Ambiguity is not resolved here — it is returned. If expanding a decision needs a
judgement the decisions file does not contain, stop and report it as an
`unresolved[]` entry rather than inventing an answer; `/spec` will put it to the
human and re-dispatch. Guessing here is the exact failure this split removes.

**This applies to gate inputs, not just to decisions.** If a hard gate below
cannot be run as written — its `--required` file is the wrong scope, a path does
not exist, a flag seems not to fit this run — that is an `unresolved[]` entry.
Constructing an input the skill did not specify, in order to get a gate to pass,
is the one move you must never make: the gate then reports green against data
you chose, which is indistinguishable from a real pass and strictly worse than a
red gate. A live run did exactly this at Step 6.45 — it hand-built a narrowed
requirements file, passed, and left 18 of 24 requirements unchecked with nothing
recording it. The supported route for that case is the Milestone addendum below.

`/spec` dispatches this skill once its decisions gate passes. Reached on its own
without a shaped decisions file, it stops at Step 0 rather than rendering.

---

## Steps

### Step 0 — Decisions Gate [HARD BLOCK]

```bash
node .claude/scripts/validate-spec-decisions.js            # gated lane
node .claude/scripts/validate-spec-decisions.js --lane --auto   # headless only
```

Non-zero exit: **halt immediately and render nothing.** A failure means the
decisions file was never shaped by a human, or names no milestone scope. Report
stderr verbatim to the caller. Do not repair the file yourself — writing the
missing decisions is precisely what this skill must not do.

Then read `specs/decisions/spec-decisions.json`. It is the authority for:

- **Scope** — expand only epics listed in `milestone.epics`. Epics in
  `milestone.deferred_epics` stay at epic granularity: one line in `epics.md`, no
  story files, no features, no dependency edges. Do not decompose them "while you
  are here" — deferring them was a human decision, and re-deriving it is how a
  9-epic PRD became 16 epics of 5 stories each.
- **Boundaries** — where a decision fixes an epic or story split, follow it exactly.
- **Dependency intent** — where a decision records an edge as real or defensive,
  type it accordingly instead of re-deriving it.

`decisions[].chosen` outranks anything you would otherwise infer from the BRD.

---

### Step 1 — Read the BRD

Read the file at the path provided as the argument. Confirm the document exists and is an approved BRD. If the file is missing, halt and ask the human to run `/brd` first.

If `specs/brd/brd-analysis.json` exists, read it before decomposing stories. It is the BRD analysis pack produced by `/brd`, and it carries the ambiguity, edge-case, acceptance-coverage, and risk signals that should shape story boundaries.

Use the analysis pack this way:
- Use `ambiguity_table` to avoid converting unresolved ambiguity into implementation scope. A high-risk deferred ambiguity should become `needs_breakdown` or an explicit Open Question, not a guessed story.
- Use `edge_case_table` to create acceptance criteria for failure, empty, limit, concurrency, and security/privacy paths.
- Use `ac_coverage_matrix` to preserve every source requirement's observable acceptance criterion.
- Use `risk_gap_table` to tag stories that need human review, explicit non-goals, or later release deferral.

**Read the domain glossary.** If `CONTEXT.md` exists, read it before writing story titles, descriptions, or acceptance criteria. Reuse its terms verbatim — do not introduce a new name for a concept `CONTEXT.md` already defines. If a story needs a domain concept not yet in `CONTEXT.md`, add a `### <term>` entry there before finalizing the story.

**Sprint addendum.** When the BRD path is under `specs/brd/sprint-N/` (or
`--sprint N` is passed explicitly), write every output of this skill to
`specs/stories/sprint-N/` instead of the flat `specs/stories/` path, and
suffix every `--out` argument in the grounding-gate commands below with
`-sprint-N` (e.g. `specs/reviews/spec-grounding-sprint-N.json`). For every
story whose scope overlaps existing code, require a citation to the specific
DeepWiki page/symbol or code-graph node it extends (the same design-adherence
discipline `/feature` already applies) — do not decompose a story that
silently re-implements existing functionality.

### Step 1.5 — Return Readiness Gaps, Do Not Resolve Them

**Never invoke `/clarify` here.** A forked skill cannot reach the human, so
"clarifying" in this context means answering your own question — the exact
pattern that produced a decisions record in which every basis ended "Original
planner reasoning: …".

When the BRD or the decisions file leaves uncertainty that affects story
readiness, dependencies, acceptance criteria, layer assignment, or whether a
story must be split, record it and keep going on everything it does not block:

```json
{ "unresolved": [ { "epic": "E3", "question": "...", "blocks": ["E3-S2"], "options": ["...", "..."] } ] }
```

Write these to `specs/decisions/spec-unresolved.json` and name them in your
return message. `/spec` owns putting them to the human.

There is no question budget here because there is no one to ask. Prefer marking
an oversized or ambiguous story `needs_breakdown` over guessing at it, and
capture low-risk assumptions in story `Notes` so the reviewer can see them.

### Step 2 — Decompose or Normalize into Epics

Group related functionality into epics. Rules:
- Each epic represents a coherent vertical slice of the system (e.g., "User Authentication", "Data Ingestion", "Reporting")
- Let the story count follow the work. Do not decompose toward a number: a real
  run produced 12 of 16 epics with exactly 5 stories, which is a target being hit,
  not a domain being decomposed. An epic that genuinely resists splitting is
  `needs_breakdown`, not padding.
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
- `business_value`: One sentence naming the outcome the business gets. Not a restatement of the capability — "cuts support tickets for locked-out users" is value; "users can reset passwords" is the capability.
- `scope_in`: 1-3 bullets naming what this story does change.
- `scope_out`: 1-3 bullets naming what it must **not** change, phrased as checkable prohibitions (e.g. "must not alter the session cookie format"). Seed from the BRD's *Forbidden Actions* section plus this story's own boundary. The reviewer checks the diff against this list, so a vague entry is useless — name a file, contract, or behavior.
- `acceptance_criteria`: 3-6 items in **Given / When / Then** form. Each criterion is an object with a stable id:
  ```json
  { "id": "E1-S1-AC1", "given": "a visitor with no account", "when": "they POST /api/auth/register with a valid email and password", "then": "the response is 201 and the body contains a non-null userId" }
  ```
  Each must be testable (verifiable by running code or inspecting output) and specific (concrete values, states, status codes). Vague criteria ("works properly", "loads fast") are rejected. The `then` clause is the observable outcome — that is what `/test` asserts and what `features.json` steps are generated from, so it must not restate the `when`.
- `layer`: One of `Types` | `Config` | `Repository` | `Service` | `API` | `UI`
- `group`: Dependency group letter (`A`, `B`, `C` ...) — see Step 4
- `depends_on`: Typed dependency edges — see Step 3.5. A bare story-id string is still accepted and read as a `behavior` edge, but new stories must use the typed form.
- `invest`: INVEST scorecard — see Step 3.7
- `readiness`: `ready` | `needs_breakdown`
- `breakdown_reason`: Required when readiness is `needs_breakdown`; otherwise `null`
- `story_points`: One of `1`, `2`, `3`, `5`, `8`, `13` for ready stories; `null` for `needs_breakdown`
- `estimation_confidence`: `high` | `medium` | `low`
- `estimation_drivers`: Rubric dimension scores and short evidence for the chosen point value

**Readiness rule:** A story is `ready` only when it can be implemented by one teammate without further product decomposition and has 3-6 concrete acceptance criteria. Mark it `needs_breakdown` when it combines unrelated workflows, has multiple independent user goals, lacks verifiable criteria, requires unresolved product decisions, or would force multiple teammates to own the same broad scope.

Do not assign `needs_breakdown` stories to an implementation group. Either break them into smaller ready stories before writing the dependency graph, or place them in `specs/stories/backlog-needs-breakdown.md` for human review.

**Story point rubric:** Assign points deterministically from the story evidence, not from intuition. Use only the scale `1, 2, 3, 5, 8, 13`. Anything above `13` must be marked `needs_breakdown` and excluded from implementation artifacts.

Score each story from `0` to `3` on these dimensions:

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Functional scope | tiny behavior, one path | one bounded capability | several states or variants | multiple workflows |
| Technical complexity | known pattern | minor new logic | new integration, model, or API | novel architecture or algorithm |
| Data/state impact | no persistence | simple CRUD or config | schema/state migration | cross-entity consistency or concurrency |
| Integration surface | isolated unit | one internal boundary | external API, UI/backend, or storage boundary | multi-service, auth, payments, or async |
| Uncertainty/risk | fully specified | minor assumptions | unclear edge cases | unresolved product, security, or performance risk |

Map the total score to points:

| Rubric total | Story Points | Meaning |
|---:|---:|---|
| 0-2 | 1 | trivial, localized change |
| 3-4 | 2 | small, known pattern |
| 5-6 | 3 | normal story, one clear slice |
| 7-9 | 5 | moderately complex story |
| 10-12 | 8 | large but still implementable by one teammate |
| 13-15 | 13 | very large, high risk, should be rare |
| >15 or any hard blocker | `needs_breakdown` | do not implement yet |

Hard estimation rules:
- If a story has fewer than 3 concrete acceptance criteria, do not estimate it as ready.
- If a story has more than 6 acceptance criteria, first try to split it.
- If it spans more than one independent user goal, mark `needs_breakdown`.
- If it needs unresolved product decisions, mark `needs_breakdown`.
- If it touches auth, billing, security, migrations, external APIs, concurrency, or irreversible data changes, add at least +1 risk unless the BRD or design already resolves it.
- Cap implementation-ready stories at `13`; larger work belongs at epic level.

Set `estimation_confidence` this way:
- `high`: all acceptance criteria are concrete, dependencies are known, and no unresolved assumptions affect scope.
- `medium`: minor assumptions or familiar integration risk remain, but the story is implementable.
- `low`: ambiguity, missing design detail, risky integration, or weak criteria remain. Prefer clarify or breakdown before `/auto`.

### Step 3.5 — Type Every Dependency Edge

A dependency records *that* one story needs another. Typing it records *why*, and the kind decides whether two engineers can work at the same time:

| `kind` | Meaning | Parallelisable? |
|---|---|---|
| `contract` | The consumer needs the producer's **shape** — a type, schema, endpoint signature | **Yes** — publish the interface first and both proceed |
| `ui` | The consumer needs a component/page contract | **Yes** — same mechanism |
| `data` | The consumer needs data the producer writes | No — real hand-off |
| `behavior` | The consumer needs the producer's runtime effect | No — real hand-off |

Write each entry as an object:

```json
{ "story": "E1-S1", "kind": "contract", "artifact": "User type", "reason": "E1-S2 serialises User in its response body" }
```

`artifact` names the shared thing (a type, table, endpoint, or component). `reason` is one sentence. Default to `behavior` only when the consumer genuinely needs the producer to *run* — over-declaring `behavior` silently destroys parallelism, and under-declaring it invents parallelism that does not exist.

**Every `contract` edge needs a publisher.** If the producer is not a `Types` or `Config` story and has no `Types`/`Config` ancestor, the consumer must wait for the producer's whole implementation and the edge is not really cuttable. Add an interface story (layer `Types` or `Config`) that publishes just the artifact, and place it in the earliest group. Step 4.5 blocks on this mechanically.

### Step 3.7 — INVEST Scorecard

Score each ready story. Record `invest` as six booleans plus one line of evidence each:

| Letter | Passes when |
|---|---|
| `independent` | **Computed in Step 4.5, not asserted here** — a story is independent when its cluster has no inbound blocking dependency. Write `null` now; Step 4.5 fills it. |
| `negotiable` | `scope_in` and `scope_out` are both non-empty, so the boundary is explicit and can be renegotiated |
| `valuable` | `business_value` names a business outcome, not a capability restatement |
| `estimable` | `story_points` assigned from the Step 3 rubric with `estimation_confidence` >= `medium` |
| `small` | `story_points` <= 13 |
| `testable` | >= 3 acceptance criteria, each a well-formed Given/When/Then with an observable `then` |

Any letter other than `independent` scoring false means the story is not ready — fix it or mark `needs_breakdown`.

### Step 3.9 — Write the Machine-Readable Story Index

Write `specs/stories/stories.json` — the machine view of the same stories whose `.md` files Step 5 renders. Downstream tooling reads this; the `.md` files are for humans. Keep them in sync.

```json
[
  {
    "id": "E1-S1", "title": "User can register with email and password",
    "epic": "E1", "layer": "API", "group": "A",
    "story_points": 5, "estimation_confidence": "medium", "readiness": "ready",
    "business_value": "Cuts drop-off at signup", 
    "scope_in": ["POST /api/auth/register"], "scope_out": ["must not alter the session cookie format"],
    "depends_on": [{ "story": "E1-S0", "kind": "contract", "artifact": "User type", "reason": "..." }],
    "invest": { "independent": null, "negotiable": true, "valuable": true, "estimable": true, "small": true, "testable": true }
  }
]
```

Include `needs_breakdown` stories with `readiness: "needs_breakdown"` and `story_points: null` — the clusterer excludes them, but recording them keeps the index a complete picture of the decomposition.

### Step 4 — Build the Dependency Graph

Write `specs/stories/dependency-graph.md` with:
- Group A: stories with no dependencies (can run in parallel)
- Group B: stories that depend only on Group A
- Group C: stories that depend on Group B (and/or A)
- ... and so on

Format each group as a table showing Story ID, Title, Layer, Story Points, Estimation Confidence, and Dependencies.

Then, directly below the tables, render the same graph visually as a Mermaid `flowchart TD` so reviewers see the parallelism and critical path at a glance (not just rows). One node per story (label `E{n}-S{n}`), one edge per `depends_on` (`dependency --> story`), and group the nodes with `subgraph Group A`/`Group B`/… blocks matching the tables. Example:

```mermaid
flowchart TD
  subgraph GroupA[Group A]
    E1S1[E1-S1 Types]
    E1S2[E1-S2 Config]
  end
  subgraph GroupB[Group B]
    E2S1[E2-S1 Repository]
  end
  E1S1 --> E2S1
  E1S2 --> E2S1
```

Then write a machine-readable sibling `specs/stories/dependency-graph.json` with the
exact same groups, for deterministic downstream wave planning (`.claude/scripts/wave-plan.js`):

```json
{
  "groups": [
    { "id": "A", "stories": ["E1-S1", "E1-S2"], "blockedBy": [] },
    { "id": "B", "stories": ["E1-S3"], "blockedBy": ["A"] }
  ]
}
```

`id` is the group letter, `stories` lists its story IDs, and `blockedBy` lists the
group IDs it depends on (empty for roots). The `.md` is the human artifact; the
`.json` is the contract code reads — keep them in sync.

The Mermaid block must stay consistent with the tables — every story and every dependency edge appears in both. The tables remain the machine-checkable source; the diagram is the human-readable view of the same data.

Rules:
- No circular dependencies. Validate before writing.
- Stories in the same group must be independently executable in parallel.
- Foundation layers (Types, Config, Repository) should appear in earlier groups.
- UI stories typically appear in later groups.

**Groups are not owners.** A group is a scheduling wave — "these can run next" — and its members are frequently unrelated. Do not read a group as a work package for one engineer; Step 4.5 computes that separately and the two views deliberately cross-cut each other.

### Step 4.5 — Ownership Clusters [HARD BLOCK]

The groups from Step 4 answer **"what can be scheduled next"**. They do not answer **"what can one engineer own end to end"** — a group mixes unrelated subsystems into one branch, and a vertical feature slice spans three groups. Allocation needs the orthogonal view: connected components over the dependency edges.

Run the clusterer over the Step 3.9 index:

```bash
node .claude/scripts/story-clusters.js \
  --stories specs/stories/stories.json \
  --out specs/stories/story-clusters.json \
  --edges-out specs/stories/dependency-edges.json
```

Tune with `--max-points N` (default 21 — one engineer's comfortable slice) and `--min-points N` (default 5). For a team of *K* engineers, aim for `cluster_count >= K`; if it comes back lower, the work is more coupled than the team is wide, and the honest answer is fewer parallel owners, not a forced split.

It writes `story-clusters.json`, whose fields carry the allocation decision:

- `clusters[]` — each with `stories`, `story_points`, `layers`, `epics`, `waves` (which Step 4 groups it spans), `internal_edges`, `external_edges`, `coordination_cost`, and `independently_startable`.
- `interface_contracts[]` — cuttable edges crossing a cluster boundary, each naming the `artifact` and the `contract_story` that publishes it. **These are the things to build first**, before the owners split up.
- `blocking_dependencies[]` — hard edges crossing a boundary. Each is a genuine hand-off: the `blocked_cluster` cannot start until the producer ships.
- `warnings[]` — oversized tightly-coupled clusters and unpublishable contracts.

**Hard block on exit 1** — one or more `interface_contracts` has `contract_story: null`, meaning the consumer must wait for the producer's full implementation and the "independent" clusters are not independent. Fix it at the source: add a `Types`/`Config` story publishing that artifact (Step 3.5), re-run Step 3.9, and re-run this step. Do not proceed with an unresolved contract.

Exit 2 is a malformed index (unknown story id, unknown edge kind, or an empty story set) — a Step 3.9 bug, not a legacy condition. Fix and re-run.

**Backfill `invest.independent`** into `stories.json` and the story files: `true` when the story's cluster has `independently_startable: true`, `false` otherwise. This is the one INVEST letter that is measured rather than judged.

Append a cluster view to `specs/stories/dependency-graph.md` — clusters as `subgraph` blocks, cut edges dashed — so the reviewer sees allocation and coordination surface together:

```mermaid
flowchart TD
  subgraph C1[C1 · 13 pts · owner ?]
    E1S1[E1-S1 Types]
    E1S2[E1-S2 Service]
  end
  subgraph C2[C2 · 11 pts · owner ?]
    E2S1[E2-S1 API]
  end
  E1S1 --> E1S2
  E1S1 -.->|User type| E2S1
```

Solid edges are internal; dashed edges are interface contracts (label them with the `artifact`). A `blocking_dependencies` edge is drawn solid **between** subgraphs — it is the visual signal that two clusters are not truly parallel.

### Step 5 — Write Individual Story Files

Write each story to: `specs/stories/E{n}-S{n}.md`

Each file includes: ID, title, description, user_story, business value, scope in/out, acceptance criteria, layer, group, cluster, depends_on, INVEST, readiness, breakdown_reason, story_points, estimation_confidence, and estimation_drivers.

Use this shape:

```markdown
# E1-S1 — User can register with email and password

## Metadata
- Epic: E1 — User Authentication
- Layer: API
- Group: A
- Cluster: C1 (independently startable: yes)
- Depends On: [{ story: E1-S0, kind: contract, artifact: User type }]
- INVEST: independent ✓ · negotiable ✓ · valuable ✓ · estimable ✓ · small ✓ · testable ✓
- Readiness: ready
- Breakdown Reason: null
- Story Points: 5
- Estimation Confidence: medium
- Estimation Drivers:
  - Functional scope: 2 — registration has success and validation paths
  - Technical complexity: 1 — known endpoint pattern
  - Data/state impact: 1 — persists one user record
  - Integration surface: 1 — API to service boundary
  - Uncertainty/risk: 1 — minor password-policy assumption

## User Story
As a visitor, I want to create an account with email and password so that I can access protected features.

## Business Value
Cuts drop-off at signup, the largest funnel loss in the current product.

## Description
...

## Scope
**In:** `POST /api/auth/register`, the `users` table insert.
**Out:** must not alter the session cookie format; must not send marketing email.

## Acceptance Criteria
- **E1-S1-AC1** — *Given* a visitor with no account, *when* they POST /api/auth/register with a valid email and password, *then* the response is 201 and the body contains a non-null userId.
- ...
```

### Step 6 — Generate `features.json`

Transform every acceptance criterion into one or more testable features.

**Mapping rule:** Each acceptance criterion produces 1-3 feature entries. The feature description must be a specific, observable behavior. Each feature has executable steps describing how to verify it.

**Generate the steps from the criterion's Given/When/Then — do not re-author them.** The mapping is mechanical, which is the point of the structured form: `given` becomes the setup step(s), `when` becomes the action step, and `then` becomes one assertion step per observable claim. Re-writing the behavior here instead of transcribing it reintroduces the drift the structure exists to prevent. Every feature carries the `acceptance_criterion` id it came from.

**Output file:** `features.json` at the project root.

Do not write `specs/features.json`. `features.json` is root-level because `/auto`, `/evaluate`, and session chaining read it from the project root.

**Schema for each feature entry:**

```json
{
  "id": "F001",
  "category": "functional",
  "story": "E1-S1",
  "group": "A",
  "cluster": "C1",
  "acceptance_criterion": "E1-S1-AC1",
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
- `group`: Inherited from the story's dependency group (the scheduling wave)
- `cluster`: Inherited from the story's ownership cluster in `story-clusters.json`
- `acceptance_criterion`: The `{story}-AC{n}` id this feature verifies
- `description`: Single sentence, specific and observable
- `steps`: Ordered list of verification steps (at least 2)
- `passes`: Always `false` at generation time
- `last_evaluated`: Always `null` at generation time
- `failure_reason`: Always `null` at generation time
- `failure_layer`: Always `null` at generation time

Every acceptance criterion must map to at least one feature. No criteria may be omitted.

### Step 6.4 — Emit the trace spine `specs/stories/story-traces.json`

Write the machine-readable spine that grounds the stories to the BRD requirements and seeds the test layer. One entry per story, each with a stable id, its BRD-requirement traces, and the stable ids of its acceptance criteria:

```json
[
  { "id": "E1-S1", "text": "User registration endpoint", "traces": ["BR-1"],
    "acs": ["E1-S1-AC1", "E1-S1-AC2"] },
  { "id": "E1-S2", "text": "Login endpoint", "traces": ["BR-1", "BR-3"],
    "acs": ["E1-S2-AC1"] }
]
```

**Every story must carry at least one `BR-n` trace** (the ids in `specs/brd/brd-requirements.json`). A story that traces to no BRD requirement is scope the BRD never authorized — either remove it, or escalate to the human and add the requirement to the BRD first (re-run `/brd`). Give each acceptance criterion a stable `{story}-AC{n}` id; `/test` traces its test cases to these.

Also write `specs/stories/acceptance-criteria.json` — the criterion-level spine, one entry per AC, each tracing to the **BRD acceptance id** (`BR-n-ACm`) it realizes:

```json
[
  { "id": "E1-S1-AC1", "story": "E1-S1", "traces": ["BR-1-AC1"],
    "given": "a visitor with no account",
    "when": "they POST /api/auth/register with a valid email and password",
    "then": "the response is 201 and the body contains a non-null userId" }
]
```

Story-level tracing proves a requirement has *a* story. It does not prove the story's criteria actually cover what the requirement demanded — that gap is where a requirement gets nominally covered and substantively lost. This file is what Step 6.46 checks.

### Step 6.45 — Grounding Gate [HARD BLOCK — when `specs/brd/brd-requirements.json` exists]

If the BRD was produced with a machine-readable spine (FRD-grounded `/brd`), prove mechanically — not by judgement — that the stories invented and dropped nothing relative to it:

```bash
node .claude/scripts/trace-check.js \
  --required specs/brd/brd-requirements.json \
  --downstream specs/stories/story-traces.json \
  --layer spec \
  --out specs/reviews/spec-grounding.json
```

**Milestone addendum [use this whenever D1 scoped the run to one milestone].**
Run as written above, a milestone-scoped story set fails: every requirement D1
deferred shows as `dropped`. Do **not** narrow `--required` by hand — add
`--scope`, which reads the in-scope set from the decisions file you were
dispatched with:

```bash
node .claude/scripts/trace-check.js \
  --required specs/brd/brd-requirements.json \
  --scope specs/decisions/spec-decisions.json \
  --downstream specs/stories/story-traces.json \
  --layer spec \
  --out specs/reviews/spec-grounding.json
```

Deferred requirements become valid trace targets that need not be covered, and
the verdict records `scope.deferred_ids` so the narrowing is visible to the
human review and to the next `/spec` run. A hand-built `--required` file does
none of that: it makes the gate green against inputs you chose.

**Sprint addendum.** In sprint mode, point `--required` at
`specs/brd/sprint-N/brd-requirements.json`, `--downstream` at
`specs/stories/sprint-N/story-traces.json`, and `--out` at
`specs/reviews/spec-grounding-sprint-N.json`.

The verdict (`specs/reviews/spec-grounding.json` — `{ pass, required_covered, net_new[], dropped[] }`) is a **hard gate, independent of the rubric score**:
- **`net_new` non-empty** → a story introduces scope tracing to no BRD requirement. Remove it, or get the requirement into the BRD first.
- **`dropped` non-empty** → a BRD requirement that no story realizes. Add a story covering it (or, if intentionally deferred, record the deferral and re-run `/brd` so the BRD reflects it).

Only return to `/spec` when `spec-grounding.json#pass === true`. (Skip this step if `brd-requirements.json` does not exist — an older or interview-only BRD; the LLM traceability check in `/spec`'s phase-evaluation gate then stands alone.)

### Step 6.46 — Acceptance-Criterion Grounding [HARD BLOCK — when `specs/brd/brd-acceptance.json` exists]

Step 6.45 proves every BRD requirement has a story. This proves every BRD **acceptance postcondition** has a criterion that realizes it — the same engine, one level finer:

```bash
node .claude/scripts/trace-check.js \
  --required specs/brd/brd-acceptance.json \
  --downstream specs/stories/acceptance-criteria.json \
  --layer spec-acceptance \
  --out specs/reviews/spec-acceptance-grounding.json
```

- **`dropped` non-empty** → a BRD acceptance postcondition no criterion asserts. The requirement is covered on paper and unverifiable in practice. Add a criterion (or, if genuinely out of scope, retire the postcondition in `/brd`).
- **`net_new` non-empty** → a criterion asserting something the BRD never required. Either it is scope creep, or the BRD is missing a postcondition — resolve at the source, not here.

**Milestone addendum.** As in Step 6.45, add
`--scope specs/decisions/spec-decisions.json` when D1 scoped the run to one
milestone. Acceptance ids are scoped by the requirement they gate, so the same
decisions file drives both gates.

Expect an `UNMATCHED` line here naming in-scope requirements with no acceptance
record. That is not a failure — it is the un-oracled-requirement set the BRD
already tracks, surfacing where it is actionable. Carry those ids into the
`unresolved[]` you return: they are requirements `/spec` scoped into this
milestone that no criterion can verify.

**Sprint addendum.** Point `--required` and `--downstream` at the `sprint-N/` paths and suffix `--out` with `-sprint-N`.

Skip only when `brd-acceptance.json` does not exist (a BRD authored before this gate); note the skip in the human review.

## Output

| File | Purpose |
|------|---------|
| `specs/stories/epics.md` | Epic index with story membership and readiness summary |
| `specs/stories/dependency-graph.md` | Scheduling waves with dependency mapping, plus the ownership-cluster view |
| `specs/stories/E{n}-S{n}.md` | One file per story |
| `specs/stories/stories.json` | Machine-readable story index (the `.md` files are the human view) |
| `specs/stories/dependency-edges.json` | Flat typed edge list derived from `stories.json#depends_on` |
| `specs/stories/story-clusters.json` | Ownership clusters, interface contracts, blocking dependencies — the allocation contract |
| `specs/stories/backlog-needs-breakdown.md` | Optional list of oversized or ambiguous stories that cannot enter implementation |
| `features.json` | Machine-readable feature list for evaluator |
| `specs/stories/story-traces.json` | Trace spine: each story's `BR-n` traces + stable AC ids (grounds spec to BRD, seeds `/test`) |
| `specs/stories/acceptance-criteria.json` | Criterion-level spine: each AC's Given/When/Then + `BR-n-ACm` traces |
| `specs/reviews/spec-grounding.json` | (FRD-grounded BRD) deterministic spec-vs-BRD verdict (`pass`, `net_new[]`, `dropped[]`) |
| `specs/reviews/spec-acceptance-grounding.json` | Criterion-level spec-vs-BRD verdict |
| `specs/stories/sprint-N/*` | (sprint mode) same artifact set as the flat layout, scoped to sprint N |

---

## Gate

**Grounding gate (FRD-grounded BRD) — hard block.** `trace-check.js` proves mechanically that no story invented scope (`net_new`) and no BRD requirement was dropped (`dropped`) — see Step 6.45. Any violation blocks before the rubric runs, independent of quality score. Step 6.46 repeats the check at acceptance-criterion granularity when `brd-acceptance.json` exists.

**Ownership-cluster gate — hard block.** `story-clusters.js` (Step 4.5) exits non-zero when an interface contract has no story that can publish it. The clusters are then not independent, and allocating them to separate engineers would produce a hidden serial dependency discovered mid-sprint.

**Decisions gate — hard block (Step 0).** `validate-spec-decisions.js` refuses to render against a decisions file no human shaped. It runs here as well as in `/spec` so the block holds even when this skill is reached directly.

**Phase evaluation gate runs in `/spec` (Step 7), after this skill returns and before human review.** It stays on the frontier model — a cheap renderer is only safe under an expensive reviewer. The evaluator agent (artifact mode) validates:
- Cross-phase traceability (anchored to `spec-grounding.json` when present, else every story traces to a BRD goal)
- Acceptance criteria quality (no vague language)
- Dependency graph consistency (acyclic, valid groups)
- Feature coverage (every AC maps to features.json)

**Human review is still required before proceeding to `/design`.** The evaluator validates structure and traceability; the human validates product intent. `/spec` Step 8 runs that review as a `plan-review-loop` dialogue and records it — `/design` hard-blocks on the receipt:

```bash
node .claude/scripts/plan-approval.js check --phase spec
```

Pre-approval checklist (verified by evaluator, confirmed by human):
- [ ] Every story has 3-6 specific, testable acceptance criteria in Given/When/Then form with stable `{story}-AC{n}` ids
- [ ] Every story has `business_value`, `scope_in`, and `scope_out`
- [ ] Every dependency is typed (`contract` | `data` | `behavior` | `ui`) with an `artifact` and a `reason`
- [ ] Every story has an INVEST scorecard, with `independent` backfilled from `story-clusters.json`
- [ ] `story-clusters.json` exists and has no unresolved interface contracts
- [ ] Every interface contract names the `contract_story` that publishes it
- [ ] Every story has a layer assignment
- [ ] Every story has a group assignment
- [ ] Every ready story has Story Points on the `1, 2, 3, 5, 8, 13` scale
- [ ] Every ready story has Estimation Confidence and Estimation Drivers
- [ ] Any story estimated above `13` is marked `needs_breakdown` and excluded from implementation artifacts
- [ ] Every story has `readiness: ready` before it appears in `dependency-graph.md`
- [ ] No circular dependencies in the graph
- [ ] Every acceptance criterion maps to at least one feature in `features.json`
- [ ] All `passes` fields are `false`
- [ ] Every story traces to a BRD goal (evaluator-enforced)

Do not auto-advance. The loop ends on an explicit approving round, not on silence or a lack of objections.

---

## Gotchas

- **Vague criteria are rejected.** "The system works properly" fails the gate. Rewrite as an observable behavior.
- **Missing layers break agent routing.** Every story needs a layer so the builder knows which agent handles it.
- **Unready stories block implementation.** If a story is marked `needs_breakdown`, it must not appear in a dependency group or `features.json`. Break it down first.
- **Circular dependencies deadlock the pipeline.** Validate the graph before writing.
- **Story count per epic is an observation, not a target.** If an epic keeps
  landing on the same count as its neighbours, you are hitting a number rather
  than decomposing a domain — a real run produced 12 of 16 epics with exactly 5
  stories each. Let the count follow the work, and where an epic genuinely
  resists decomposition, mark it `needs_breakdown` instead of padding it.
- **Human review is `/spec`'s job, not yours.** Return when the artifacts are
  written; do not attempt to present or approve them.
- **Do not allocate by group.** A group is a scheduling wave, not a work package. Allocate by cluster (`story-clusters.json`); the two views cross-cut each other by design.
- **Do not type every edge `behavior` to be safe.** It is not safe — it collapses the cluster count and serialises a team that could have worked in parallel. Type the edge by what the consumer actually needs.
- **A cluster that is not `independently_startable` is a hand-off, not a parallel stream.** Report it as such in the allocation summary instead of presenting it as an independent slice.
- **features.json must cover all criteria.** The evaluator uses this file to track pipeline health across sessions.
