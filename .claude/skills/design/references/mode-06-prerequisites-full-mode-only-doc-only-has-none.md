## Prerequisites (full mode only — `--doc-only` has none)

`specs/stories/` must exist and contain story files. If it does not, halt and tell the human to run `/spec` first.

Every story consumed by `/design` must have `Readiness: ready`. If any story is marked `needs_breakdown`, halt and ask the human to approve a breakdown pass before generating architecture artifacts.

**The spec review must have closed [HARD BLOCK]:**

```bash
node .claude/scripts/plan-approval.js check --phase spec
```

A non-zero exit means the stories were never reviewed, are still in `changes-requested`, or have been edited since approval. Halt and run `/spec`'s Step 7 loop — designing against an unapproved story graph spends the expensive phase on a decomposition the human may still reject.

---
