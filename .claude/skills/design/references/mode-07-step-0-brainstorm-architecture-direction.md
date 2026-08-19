## Step 0 — Brainstorm Architecture Direction

Load this only when `--brainstorm` or `project-manifest.json#execution.ceremony`
is `full`. On `trimmed` (the product default) **skip Superpowers**. The
approved spec, the PRD stack, and `project-manifest.json` already constrain
the architecture; write `rules_out` from those. Invoking
`superpowers:brainstorming` on every simple API is how shaping became a
second interview.

When this file is in play, invoke `superpowers:brainstorming` to explore
architectural trade-offs with the human in this session. Each conclusion
becomes a `decisions[]` entry in `specs/decisions/design-decisions.json`
(Step 0.9). The alternative you rejected is the `rules_out` field, and the
gate requires it.
