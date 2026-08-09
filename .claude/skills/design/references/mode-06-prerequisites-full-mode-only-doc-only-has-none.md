## Prerequisites (full mode only — `--doc-only` has none)

**This must not be the session that approved `/spec` [HARD BLOCK]:**

```bash
node .claude/scripts/handoff-check.js --phase design
```

Exit 1 means `/spec`'s conversation is still resident and would be re-billed on every turn of this phase. Halt and tell the human to run `/clear`, then `/design` again — do not work around it. The digest below is exactly why clearing is free: this phase re-reads what it needs from disk. Add `--in-session` only when `/build` is conducting every phase from one session.

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
