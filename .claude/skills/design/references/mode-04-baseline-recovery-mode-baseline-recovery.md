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
