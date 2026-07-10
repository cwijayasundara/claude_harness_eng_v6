## Prerequisites (full mode only — `--doc-only` has none)

`specs/stories/` must exist and contain story files. If it does not, halt and tell the human to run `/spec` first.

Every story consumed by `/design` must have `Readiness: ready`. If any story is marked `needs_breakdown`, halt and ask the human to approve a breakdown pass before generating architecture artifacts.

---
