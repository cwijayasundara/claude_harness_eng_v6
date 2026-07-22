## Machine-Readable Artifacts

| Artifact | Purpose |
|----------|---------|
| `api-contracts.schema.json` | OpenAPI 3.0 schema — machine-readable by the evaluator for contract testing |
| `data-models.schema.json` | JSON Schema — used by builder agents to generate type-safe code |
| `component-map.md` | Maps stories to implementation files — used by builder agents for routing |

The `.schema.json` files enable automated validation in later pipeline stages (the evaluator validates contracts and shapes against them).

### Cluster-independence check (when `specs/stories/story-clusters.json` exists)

`/spec` proved the ownership clusters have no dependency edges between them. That is edge-level independence, and it is blind to the collision that actually hurts a parallel team: two clusters intending to edit the *same file*. `component-map.md` is the first artifact that knows, so the check runs here:

```bash
node .claude/scripts/ownership-check.js --clusters
```

- **`collisions[]`** — a file owned by stories in two different clusters. Each is a merge conflict waiting for the two engineers who own those clusters. Resolve by moving the shared file's ownership into one cluster, or by extracting the shared surface into an interface story both depend on (which converts an invisible collision into a declared `contract` edge).
- **`unmapped_stories[]`** — a clustered story with no files in the map. The builder has no routing for it.
- **`unclustered_stories[]`** — a mapped story missing from the cluster plan, meaning `/spec` and `/design` disagree about the decomposition. Re-run `/spec` Step 4.5.

Reported as **warnings**; add `--strict` to make collisions block. Warning is the default because a genuinely shared surface — a route registry, a DI container, a barrel file — is a legitimate design outcome, and a gate that blocks on it would train people to route around it. A collision on a *behavior-bearing* file is the one to act on.

A verdict with `reason: "empty_map"` or `reason: "no_clusters"` means the check ran against nothing. That is a broken control, not a pass — fix the input.

---
