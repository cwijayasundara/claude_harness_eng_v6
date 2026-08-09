## Prerequisites (full mode only — `--doc-only` has none)

`specs/stories/` must exist and contain story files. If it does not, halt and tell the human to run `/spec` first.

**Orient from the digest, not the story set:**

```bash
node .claude/scripts/phase-digest.js --phase design
```

It reports the story count by epic and layer, cluster count, dependency-edge count, feature count, any `needs_breakdown` stories, and unresolved interface contracts — the shape of the graph this phase designs against, in well under a kilobyte. `stories.json` plus `acceptance-criteria.json` are ~124 KB; pulling them into this session buys nothing the digest does not already give, and is then re-billed on every later turn of the phase. `design-render` reads them in full when it expands the architecture. Read an individual `E*-S*.md` when a specific architectural call turns on that story's detail.

Every story consumed by `/design` must have `Readiness: ready`. If the digest lists any story under `⚠ NEEDS BREAKDOWN`, halt and ask the human to approve a breakdown pass before generating architecture artifacts.

**The spec review must have closed [HARD BLOCK]:**

```bash
node .claude/scripts/plan-approval.js check --phase spec
```

A non-zero exit means the stories were never reviewed, are still in `changes-requested`, or have been edited since approval. Halt and run `/spec`'s Step 8 loop — designing against an unapproved story graph spends the expensive phase on a decomposition the human may still reject.

---
