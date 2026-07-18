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
6. If the agent completed (not `inconclusive`, and this step wasn't skipped
   at 1), record that a real review just ran (gap G19 — the drift-cadence
   staleness proxy that tells the next drift run which unstable hubs are new
   since this review): `node .claude/scripts/record-modularity-review.js
   --scope-path <path1> --scope-path <path2> ...` — pass the SAME
   touched-scope path list from step 3, one `--scope-path` per path. This is
   required, not optional: without it the marker would record every
   currently-unstable hub as "reviewed," including ones this scoped pass
   never looked at, silently clearing their staleness. With the scope passed,
   only in-scope hubs are newly marked reviewed; a hub outside scope keeps
   whatever status it already had (still stale if never reviewed before).

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
prior sprints' entries), then check only this sprint's set. As in full mode, a
new `design-traces.json` entry may carry optional `"extends_seam"` /
`"budget_inherited_from"` keys, and a `component-map.md` row for a designed
extension point may carry optional `seam: true` / `extension_mechanism` /
`instances:` / `budget:` metadata — non-path values only, never backtick-
wrapped (the ownership sensor treats backticked tokens as owned file paths):

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
