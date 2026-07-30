# SPDD uplift for `/brd` and `/spec` — design

Date: 2026-07-22
Status: proposed (scope approved: P0 + P1 + P2; clusters additive, waves unchanged)
Sources: [SPDD, martinfowler.com](https://martinfowler.com/articles/structured-prompt-driven/) · [gszhangwei/open-spdd](https://github.com/gszhangwei/open-spdd)

## Why

`/brd` and `/spec` are the highest-leverage stages in the pipeline: every downstream
phase (`/design`, `/test`, `/auto`, `/implement`) is grounded in their output, so a
defect here cascades and cannot be recovered by better code generation.

SPDD is already ~60% landed in this harness, but it landed at the **design** layer
(`specs/design/reasons-canvas.md`, `validate-canvas.js`, `canvas-sync-check.js`,
`canvas-semantic-check.js`) and at the BRD **analysis** layer (`brd-analysis.json`,
which is a faithful port of `/spdd-analysis`). Three SPDD surfaces did not land:
the INVEST story artifact (`/spdd-story`), Given/When/Then acceptance criteria, and
BRD-level Norms/Safeguards feeding the Canvas.

Separately — and independent of SPDD — the dependency graph answers the wrong
question for its stated purpose.

## Problem statement

### The dependency graph is a scheduling decomposition, not an ownership one

`specs/stories/dependency-graph.json` groups stories by **topological depth**
("Group A: no dependencies. Group B: depends only on A"). `.claude/scripts/wave-plan.js`
branches `auto/group-${id}` and the `/auto` docs call these "clusters". They are not.

Two failure modes follow:

- A depth level holds unrelated subsystems. Group A with 9 stories across 4 subsystems
  is one branch, one PR, one owner — not allocatable to 4 engineers.
- A vertical feature slice (`E1-S1 → E1-S2 → E1-S3`) spans groups A/B/C and is **split
  across three branches**. The single thing you would hand to one engineer is the
  single thing the graph tears apart.

Independence-for-ownership is a connected-component / min-cut problem over the edge
set. Depth layering is orthogonal to it. Both views are needed; only one exists.

### Edges are untyped, so no edge can be cut

`depends_on: ["E1-S1"]` records *that* S2 depends on S1, never *why*. But the kind
decides whether parallelism is achievable:

- **contract** — S2 needs S1's type / schema / endpoint shape. Breakable: publish the
  interface first and both engineers proceed simultaneously.
- **data** / **behavior** — S2 needs S1's runtime effect. A hard sequence.

Treating every edge as hard systematically under-estimates achievable parallelism.

### Remaining gaps

| ID | Gap | Impact |
|----|-----|--------|
| G3 | ACs are free prose, not Given/When/Then | `/test` re-infers preconditions; `features.json` steps authored, not derived |
| G4 | No per-story Scope In / Scope Out / Business Value | BRD's global Forbidden Actions never scoped to a story; reviewer has no local boundary |
| G5 | INVEST never checked | Independent / Negotiable / Valuable unverified — Independent is what allocation depends on |
| G6 | Cluster independence asserted, never measured | `ownership-check.js` runs at `/design`; at spec time there is no file-overlap signal |
| G7 | BRD→story coverage is story-granular | Nothing proves a story's ACs cover `BR-n.acceptance`; `ac_coverage_matrix` is self-graded by the model that wrote the BRD |
| G8 | "Comprehensive BRD" == "sections non-empty" | No taxonomy floor: a silent FRD yields a silent BRD and the gate passes |
| G9 | Norms/Safeguards born at `/design` | A business invariant can fail to reach the design contract |
| G10 | `planner.md` drifted from the skills it runs | Its Quality Gates list omits every hard gate |

## Design

### D1 — Typed dependency edges

Story front-matter gains structured dependencies. Backward compatible: a bare string
is read as `{ story, kind: "behavior" }`.

```json
{ "story": "E1-S1", "kind": "contract", "artifact": "User type", "reason": "E1-S2 serialises User in its response body" }
```

`kind` ∈ `contract` | `data` | `behavior` | `ui`. `artifact` names the shared thing
(a type, a table, an endpoint, a component). `reason` is one sentence.

New machine artifact `specs/stories/dependency-edges.json`:

```json
[{ "from": "E1-S2", "to": "E1-S1", "kind": "contract", "artifact": "User type", "reason": "..." }]
```

Edge direction: `from` depends on `to`. `dependency-graph.md`/`.json` keep their
current shape and meaning — this is a sibling artifact.

### D2 — `story-clusters.js` (new deterministic script)

Pure function `planClusters({ stories, edges, options })`, CLI wrapper reading the
canonical spec files. No git, no network — matching `wave-plan.js`'s testability
contract.

Algorithm (fully deterministic; every iteration sorts by story id):

1. **Hard graph.** Build an undirected graph over stories using only non-cuttable
   edges (`data`, `behavior`). `contract` and `ui` edges are *cuttable* and excluded.
2. **Base clusters** = weakly connected components of the hard graph.
3. **Split oversized.** While a component's total story points exceed
   `maxPointsPerCluster` (default 21): cut bridge edges first (removal disconnects),
   else bisect on the sorted edge list choosing the cut that most evenly splits points.
4. **Merge undersized.** A component below `minPointsPerCluster` (default 5) merges
   into the component it shares the most cut edges with; ties break on lowest story id.
5. **Interface contracts** = every edge crossing a final cluster boundary.

Output `specs/stories/story-clusters.json`:

```json
{
  "cluster_count": 3,
  "max_points_per_cluster": 21,
  "clusters": [
    {
      "id": "C1",
      "stories": ["E1-S1", "E1-S2", "E1-S3"],
      "story_points": 13,
      "layers": ["Types", "Service", "API"],
      "epics": ["E1"],
      "internal_edges": 2,
      "external_edges": 1,
      "coordination_cost": 0.33,
      "waves": ["A", "B", "C"]
    }
  ],
  "interface_contracts": [
    {
      "id": "IC-1",
      "artifact": "User type",
      "kind": "contract",
      "producer_cluster": "C1",
      "consumer_cluster": "C2",
      "edge": { "from": "E2-S1", "to": "E1-S1" },
      "contract_story": "E1-S1"
    }
  ]
}
```

`coordination_cost = external_edges / (internal_edges + 1)` — a comparable
independence score per cluster. `waves` records which depth groups a cluster spans,
making the orthogonality of the two views explicit and reviewable.

### D3 — Contract-first stories

Cutting a contract edge is fiction unless the interface actually lands first. For
every `interface_contracts` entry, `/spec` must ensure a story exists that publishes
that artifact (a type, schema, or endpoint-stub story) and sits in the earliest wave.
Where none exists, the planner emits one; `contract_story` records which story owns it.
An interface contract whose `contract_story` is null is a hard failure of D2's CLI —
the cut is not honoured, and the two clusters are not actually independent.

### D4 — Cluster view for humans

`/spec` Step 7 gains a cluster summary: *N clusters → N engineers, K interface
contracts to publish first, critical path P points*, plus a Mermaid view with
clusters as `subgraph` blocks and cut edges dashed (`-.->`), so a reviewer sees the
allocation and the coordination surface at a glance.

### D5 — Structured acceptance criteria (G3)

Each AC becomes an object with the stable id that `story-traces.json` already assigns:

```json
{ "id": "E1-S1-AC1", "given": "a visitor with no account", "when": "they POST /api/auth/register with a valid email and password", "then": "the response is 201 and the body contains a non-null userId" }
```

Written to `specs/stories/acceptance-criteria.json`. The story `.md` renders the same
data as prose. `features.json` `steps` are **generated from** the G/W/T triple rather
than authored, which removes the current re-interpretation step and makes
AC→feature coverage checkable instead of assertable.

### D6 — Scope In / Scope Out / Business Value (G4)

Three new required story fields. `scope_out` is seeded from the BRD's *Forbidden
Actions* section plus the story's own boundary, phrased as checkable prohibitions
(matching the existing Forbidden Actions convention). The reviewer checks the diff
against the story's `scope_out`, giving per-story scope enforcement where only a
global deny-list existed.

### D7 — INVEST scorecard (G5)

Per story, six booleans plus evidence. Critically, `independent` is **computed** from
D2's output (does the story sit in a cluster with no unresolved inbound hard edge from
another cluster?), not self-judged. `estimable` and `small` map to the existing
story-point rubric and add no new judgement. `valuable` requires a non-empty
`business_value`; `testable` requires ≥3 well-formed G/W/T ACs; `negotiable` requires
`scope_out` to be non-empty.

### D8 — BRD requirement-taxonomy floor (G8)

New gate `brd-taxonomy-check.js`. Asserts `brd-requirements.json` +
`brd-analysis.json` carry ≥1 entry, **or an explicit recorded justification**, for
each taxonomy slot:

`functional`, `data_lifecycle`, `integration`, `performance`, `security_authz`,
`privacy_retention`, `observability`, `operability_failure`, `ux_accessibility`,
`constraints`.

Each BR entry gains `taxonomy: [...]`. An uncovered slot must be answered with
`{ "slot": "privacy_retention", "na_reason": "no personal data is stored or processed" }`
in a new `specs/brd/taxonomy-coverage.json`. Silence is not a pass — this is the
mechanical lever for "comprehensive", replacing rubric judgement of completeness.

### D9 — BRD Safeguards and Norms → Canvas (G9)

The BRD emits `safeguards[]` (invariants, limits, prohibitions — a superset of
Forbidden Actions) and `norms[]` (cross-cutting engineering standards the business
requires) into `specs/brd/brd-safeguards.json`. These become **required** trace
targets for the Canvas's Safeguards and Norms sections; `validate-canvas.js` is
extended to check coverage rather than a new control being added.

### D10 — AC-granularity round-trip (G7)

Replace the self-graded `ac_coverage_matrix` with a real round-trip through the
existing engine. `BR-n.acceptance` gains stable ids (`BR-1-AC1`), and `trace-check.js`
runs at AC granularity:

```
required   = specs/brd/brd-acceptance.json      (BR-n-ACm)
downstream = specs/stories/acceptance-criteria.json  (E1-S1-ACn, traces: [BR-1-AC1])
layer      = spec-acceptance
```

No new control — a second invocation of `trace-check.js`. `/test` then traces its
cases to the same AC ids, closing BRD → story → test at criterion granularity.

### D11 — Cluster-independence measurement (G6)

Extend `ownership-check.js` (do not add a control). Two modes:

- **spec time** — edge-based only: report `coordination_cost` per cluster and flag any
  interface contract with a null `contract_story`.
- **design time** — once `component-map.md` exists, re-run with file overlap: two
  clusters owning the same file is a warning at first, ratcheted to a block once a
  baseline exists (following the `length.js` ratchet precedent — grandfather existing,
  block new/grown).

## Non-goals

- **Waves are not touched.** `dependency-graph.json`, `wave-plan.js`, `--pod`,
  per-cluster PRs, and `features.json#group` keep their exact current semantics.
  Clusters are additive. Wiring `--pod` to consume clusters is explicitly deferred.
- No change to `/design`'s Canvas structure beyond D9's trace check.
- No change to the `/auto` execution loop.

## Control accounting

Budget is at **130, baseline held** (`control-budget-gate.js`).

| Control | Kind | Delta |
|---|---|---|
| `story-clusters.js` | planner + sensor | +1 |
| `brd-taxonomy-check.js` | hard gate | +1 |
| `trace-check.js` @ AC granularity | new invocation of existing engine | 0 |
| `ownership-check.js` cluster mode | extension | 0 |
| `validate-canvas.js` safeguards coverage | extension | 0 |

Net **+2 → 132**. Requires a `harness-manifest.json` baseline bump and `HARNESS.md`
registration in the same commit (enforced by `validate-harness-manifest.js` under
`npm test`).

## Task breakdown

TDD throughout — test first, watch it fail, then implement.

**P0 — allocatable graph**

1. `dependency-edges.json` schema + typed-edge parsing in `/spec` Step 3/4, with
   string→`{kind:"behavior"}` back-compat. Tests: parse both shapes; reject unknown `kind`.
2. `story-clusters.js` pure core `planClusters()`. Tests: single component;
   disconnected components; oversized split on a bridge; undersized merge with
   deterministic tie-break; contract edges excluded from the hard graph; identical
   output across repeated runs on shuffled input (determinism).
3. `story-clusters.js` CLI + `specs/stories/story-clusters.json` emission. Tests:
   round-trip real spec files, not hand-built fixtures.
4. Interface-contract derivation + null-`contract_story` failure. Tests: cut edge with
   no publishing story fails; with one, resolves.
5. `/spec` Step 4b (write clusters) + Step 7 (cluster summary + Mermaid subgraph view).
6. `ownership-check.js` spec-time cluster mode (D11 part 1).

**P1 — SPDD story artifact**

7. `acceptance-criteria.json` schema + G/W/T authoring rules in `/spec` Step 3.
8. `features.json` steps generated from G/W/T. Tests: every AC yields ≥1 feature;
   generated steps round-trip through the real `features.json` consumer.
9. `scope_in` / `scope_out` / `business_value` fields; `scope_out` seeded from BRD
   Forbidden Actions.
10. INVEST scorecard with computed `independent`. Tests: a story with an unresolved
    inbound cross-cluster hard edge scores `independent: false`.
11. Story `.md` template + `epics.md` updated for the new fields.

**P2 — BRD comprehensiveness**

12. `taxonomy` field on BR entries + `taxonomy-coverage.json` schema.
13. `brd-taxonomy-check.js` gate. Tests: uncovered slot fails; slot with `na_reason`
    passes; empty spine fails loudly (vacuous-pass guard — the failure class from the
    2026-07-02 audit).
14. `/brd` Step 4.6 wires the gate before the evaluator; rubric `completeness`
    criterion anchored to the taxonomy verdict instead of judging prose.
15. `brd-acceptance.json` (`BR-n-ACm`) + AC-level `trace-check` invocation in `/spec`
    Step 6.46; retire `ac_coverage_matrix` self-grading.
16. `brd-safeguards.json` + `validate-canvas.js` Safeguards/Norms coverage.

**P3 — hygiene**

17. Sync `planner.md` to the skills — or reduce it to a pointer so it cannot drift again.
18. `HARNESS.md` + `harness-manifest.json` registration; control-budget baseline 130 → 132.
19. `/scaffold` propagation: new scripts into `scaffold-copy.js`'s file list (the
    `wave-plan.js` precedent) so scaffolded projects get them.

## Verification

- `npm test` green, including `validate-harness-manifest.js` and `skills-consistency`.
- Round-trip discipline (CLAUDE.md principle #5): every contract test drives the
  **real** artifact through the **real** validator. No hand-built fixture may stand in
  for `story-clusters.json`, `acceptance-criteria.json`, or `taxonomy-coverage.json`.
- Independent whole-branch review on the strongest model before merge — per the
  standing lesson, per-task review inherits the builder's mental model.
- Determinism check: `story-clusters.js` on shuffled input produces byte-identical output.

## Risks

| Risk | Mitigation |
|---|---|
| Story-format change breaks `/test`, `/implement`, `/auto` consumers | Additive fields only; back-compat parsing for bare-string `depends_on`; consumers read new fields optionally in this wave |
| Clustering heuristic produces unhelpful partitions on real graphs | `maxPointsPerCluster` / `minPointsPerCluster` configurable; human review gate at Step 7 is the backstop; `coordination_cost` makes a bad partition visible |
| +2 controls against a held budget | Three of five changes are extensions, not new controls, by design; budget bump is explicit and reviewed |
| Taxonomy floor becomes box-ticking | `na_reason` must be a substantive sentence; the gate records it in a committed artifact, so a bogus justification is reviewable |
