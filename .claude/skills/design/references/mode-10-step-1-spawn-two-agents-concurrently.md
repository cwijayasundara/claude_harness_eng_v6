## Step 0.9 — Record the decisions, then dispatch the renderer

The architecture dialogue (Step 0) and the load-bearing clarifications
(Step 0.5) have happened. Write down what was decided, gate it, and hand the
expansion to the sidekick.

This step used to spawn a `planner` (frontier) to write all nine documents and a
`generator` (sidekick) to write only the mockups. That put the frontier model on
the transcription and asked the human to review the result — 632 KB of output on
a run whose durable human input was six confirmations.

### 1. Write `specs/decisions/design-decisions.json`

```json
{
  "version": 1,
  "phase": "design",
  "source": "specs/stories/stories.json",
  "confirmed_at": "<ISO 8601>",
  "stack": {
    "backend": "Python 3.12 / FastAPI / uv",
    "frontend": "Next.js / TypeScript",
    "datastores": ["Postgres (primary)", "Neo4j (secondary)"]
  },
  "decisions": [
    {
      "id": "D-A",
      "question": "How is engagement isolation enforced?",
      "options": ["One shared database, isolation as a repository contract", "Database per engagement"],
      "proposed_default": "One shared database, isolation as a repository contract",
      "chosen": "One shared database; isolation is the repository contract.",
      "rules_out": "Database-per-engagement provisioning. Query-level inexpressibility is explicitly not delivered in v1.",
      "rationale": "Per-engagement provisioning cannot be operated by one part-time person.",
      "basis": "human",
      "load_bearing": true
    }
  ]
}
```

`basis` means what it means in `/spec`: `human` when you asked and they answered
(including accepting your proposed default), `default-accepted` when you did not
ask, `headless-default` in `--auto` / `--autonomous`. Do not write `human` for a
decision you never put to them.

**`rules_out` is the field that matters.** A load-bearing decision must name what
it forecloses, and the gate rejects `n/a`, `none`, `TBD`. This is not
bookkeeping: the audited design's most useful content was its
`| Decision | What it rules out |` table and its alternatives-rejected section,
because those are what stop an implementer three phases later quietly doing the
thing the design ruled out. A decision that forecloses nothing is a preference.

Record the **stack** too — it is committed, and naming it here is what stops the
renderer re-selecting technologies.

### 2. Gate

```bash
node .claude/scripts/validate-design-decisions.js
```

Fix what it reports by asking, not by editing `basis` or padding `rules_out`.

Add `--in-session` only when `/build` is conducting every phase from one session.

### 2.5. Checkpoint: stop here and clear [HARD BLOCK]

When the gate passes it prints a checkpoint. **Obey it: stop, and tell the human
to run `/clear` then `/design --render-only`.** Do not continue into §3 in this
session.

Everything from §3 on — the renderer, Step 1.9's gates, the Step 2 evaluator —
reads `specs/decisions/design-decisions.json`, not this conversation. The
equivalent stretch in `/spec` was 40 of 47 turns at a **284K average context**;
`/design` carries the same shape, and its dialogue (Step 0 brainstorm, Step 0.5
clarify, Step 0.7 modularity) is the largest of any planning phase.

No checkpoint is printed when the gate was waived by a headless lane or run
`--in-session` — neither has a human who can clear, and both continue into §3.

Shaping stops at §2.5. `--render-only` loads `mode-10-render-and-gates.md`.
