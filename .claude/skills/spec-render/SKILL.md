---
name: spec-render
description: "[Internal pipeline stage — dispatched by /spec after its decisions gate passes; invoke directly only to re-render an already-approved decisions file.] Expand an approved spec-decisions.json into the story graph: story files, typed dependency edges, ownership clusters, features.json and the trace spines."
argument-hint: "[path-to-BRD]"
context: fork
agent: generator
---

# Spec Render — Story Graph Expansion (sidekick)

`/spec` recorded the load-bearing calls in `specs/decisions/spec-decisions.json`. This skill expands that file. It decides nothing. Ambiguity goes in `specs/decisions/spec-unresolved.json`.

**Turn budget.** Each tool turn re-bills the cached prefix. Do not `Read` or `sed` gate scripts. Do not edit `spec-decisions.json`. Do not write `CONTEXT.md`. Procedure detail lives in `references/render-procedure.md` — do not load it unless a gate fails.

## Steps

### 0 — Decisions gate

```bash
node .claude/scripts/validate-spec-decisions.js
```

Non-zero: halt, report stderr, write nothing.

### 1 — Write only `specs/stories/stories.json`

One `Write`. Include every ready story with: `id`, `title`, `epic`, `layer`, `group` (optional), `story_points`, `estimation_confidence`, `readiness`, `business_value`, `scope_in`, `scope_out`, `depends_on` (typed), `traces` (FRD-* or BR-* ids), and `acceptance_criteria` as `{id, given, when, then, traces}` objects.

Expand only `milestone.epics`. Deferred epics stay out of this file.

Do not emit a Types/Config story just to "buy" parallelism if a `data`/`behavior` edge will still join those stories — `story-clusters` will warn and `/auto` will still serialize.

### 2 — Expand + gate (one bash)

```bash
node .claude/scripts/spec-render-write.js
node .claude/scripts/validate-generation-contract.js --mode skeleton --stories specs/stories
node .claude/scripts/trace-check.js \
  --required specs/brd/brd-requirements.json \
  --scope specs/decisions/spec-decisions.json \
  --downstream specs/stories/story-traces.json \
  --layer spec \
  --out specs/reviews/spec-grounding.json
node .claude/scripts/trace-check.js \
  --required specs/brd/brd-acceptance.json \
  --scope specs/decisions/spec-decisions.json \
  --downstream specs/stories/acceptance-criteria.json \
  --layer spec-acceptance \
  --accepted specs/decisions/spec-decisions.json \
  --out specs/reviews/spec-acceptance-grounding.json
```

Skip a `trace-check` only when its `--required` file is absent. Non-zero on the writer or generation-contract: fix `stories.json` and re-run the block. Non-zero on grounding: fix traces in `stories.json`, re-run — do not invent a narrowed `--required` file.

`--accepted` reads `accepts_verdict` off the decisions file. It never softens `pass`; it clears `blocking` only when *every* finding names the decision that accepted it. Gate on `blocking`, and never hand-write an acceptance the human did not make — see Step 6.46.

Load/crypto ACs become `verification: "characterization"` in `features.json`. Leave them; do not drop the AC.

### 3 — Return

One screen: story count, points, cluster count, `warnings[]` verbatim, unresolved items. Do not `cat` story files back into this session.

## Gate

Grounding, generation-contract, and ownership-cluster gates run in Step 2. Human review is `/spec` Step 8, not yours.
