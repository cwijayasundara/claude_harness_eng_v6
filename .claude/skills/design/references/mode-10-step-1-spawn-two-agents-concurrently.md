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

### 3. Dispatch `design-render`

```bash
node .claude/scripts/handoff-check.js --phase design --stage render
```

Exit 1 means §2.5 was skipped and this is still the shaping session. Stop and
hand off as above rather than working around it.

Invoke the `design-render` skill (forked, sidekick model), passing any
`--sprint N`. It re-runs the gate at its own Step 0 and renders the nine
documents, the two schemas, the REASONS Canvas, and one mockup per UI story.

**One dispatch, not one per document.** Coarse handoffs keep the renderer's
context cached; per-document round-trips pay cache creation on every switch and
can cost more than the cheaper model saves.

When it returns, read `specs/decisions/design-unresolved.json` if present. Each
entry is a call the renderer refused to invent. Put them to the human as in
Step 0.5, append them to `decisions[]`, and re-dispatch with `--render-only`.
A renderer that returns unresolved items is working correctly.

Then continue with Step 1.9 below — the deterministic gates and the evaluator
run here, in the main session, not inside the fork.

### Step 1.9 — Emit the trace spine + Grounding Gate [HARD BLOCK — when `specs/stories/story-traces.json` exists]

After both agents complete, write `specs/design/design-traces.json` — one entry per design component (module/service/endpoint group from `component-map.md`), each tracing to the story ids it realizes:

```json
[
  { "id": "auth-service", "text": "Registration + login endpoints", "traces": ["E1-S1", "E1-S2"] },
  { "id": "user-repository", "text": "User persistence", "traces": ["E1-S1"] }
]
```

A component entry may also carry optional `"extends_seam": "<seam-id>"` and `"budget_inherited_from": "<seam-id>"` keys when it reuses a seam from `component-map.md` — the validator (`trace-check.js`) reads only `id`/`text`/`traces` and passes extra keys through untouched.

Every component must trace to at least one story. A component realizing no story is scope creep or dead design; a story with no component will never be built. Prove it deterministically (when the spec emitted a trace spine):

```bash
node .claude/scripts/trace-check.js \
  --required specs/stories/story-traces.json \
  --downstream specs/design/design-traces.json \
  --layer design \
  --out specs/reviews/design-grounding.json
```

`specs/reviews/design-grounding.json` is a **hard gate independent of the rubric**: any `net_new` (component tracing to no story) or `dropped` (story no component realizes) blocks. Resolve before Step 2. (Skip when `story-traces.json` does not exist.)

Also run the **Canvas structure gate** (deterministic, always — the Canvas ships in every design):

```bash
node .claude/scripts/validate-canvas.js specs/design/reasons-canvas.md
```

A non-zero exit **BLOCKS** — fix the Canvas before Step 2. It covers two things:

- **Structure** — a missing REASONS section, or a `Governs` list with no source paths. The `Governs` list must be non-empty so the drift monitor can detect Canvas↔code drift later.
- **Safeguard coverage (D9)** — when `specs/brd/brd-safeguards.json` exists, every `SG-n` must be cited in the Canvas's `## Safeguards` or `## Norms` section. Structure alone cannot catch a Safeguards section that is present, well-formed, and silently missing a business invariant, which is how a BRD constraint fails to reach the design contract. `UNCOVERED` means a constraint the business required that this design does not carry; `UNKNOWN` means the Canvas cites an `SG-n` that does not exist (a typo, or an invented constraint). A `misplaced` warning — a norm filed under Safeguards or vice versa — does not block; the constraint reached the design and only the filing is off.

Skipped loudly when `brd-safeguards.json` does not exist (a BRD authored before this gate). Do not create an empty `brd-safeguards.json` to silence it: an empty spine reports `empty_spine` and fails, precisely so a missing input cannot read as a clean bill of health.

Also run the **vocabulary-consistency gate** (deterministic; skip only when `CONTEXT.md` does not exist yet):

```bash
node .claude/scripts/vocabulary-check.js \
  --glossary CONTEXT.md \
  --domain-concepts specs/brd/brd-analysis.json \
  --data-models specs/design/data-models.schema.json \
  --api-contracts specs/design/api-contracts.schema.json \
  --out specs/reviews/vocabulary-check.json
```

Exit code 1 means a real vocabulary mismatch: an entity/model name in `domain_concepts`, `data-models.schema.json`, or `api-contracts.schema.json` has no matching term in `CONTEXT.md` — add the missing term to `CONTEXT.md` (or fix the name to match an existing one) before Step 2. Exit code 2 means an infrastructure/usage problem, not a vocabulary mismatch — most commonly `CONTEXT.md` does not exist yet (run `/brd` first) or a candidate JSON file is malformed; resolve the underlying problem rather than adding a glossary term. This is the deterministic backstop for the API-shape-divergence gotcha below.

> **Living artifact — fix the prompt first (gap G4).** The Canvas is not write-once. When a later `/change` or `/refactor` alters behavior or moves code, update `reasons-canvas.md` *with the same change* — change the design, then the code — and keep its `Governs` list accurate. The G2 drift monitor (`drift-report.js`) flags governed paths that vanished as **design-vs-code drift**, so a Canvas left to rot will surface in the next drift run rather than silently misleading the next reader.

### Step 2 — Phase Evaluation Gate

After `design-render` returns and Step 1.9 is green, spawn the `evaluator` agent (artifact mode) here in the main session. This replaces and extends the previous field-shape validation.

**Model tier — this is the one planning phase where the choice is real.** Default to `model: "sonnet"`: the traceability property is already proven deterministically by Step 1.9's grounding gate, and what the rubric adds on top is prose-level consistency plus the mockup/contract field-shape comparison. **Escalate to `model: "opus"` when this design introduces a security or data boundary the deterministic gates do not cover** — an authn/authz model, a tenant-isolation decision, a schema migration or a persisted-data reshape, an external trust boundary, or any area a `specs/brownfield/` risk map marks high-risk. Architecture is where a wrong call is most expensive to unwind, so escalate on doubt rather than on certainty. Record which tier ran in the Step 3 review brief.

**Take the verdict from the return message; do not read `specs/reviews/phase-design-eval.json` back into this session.** The actionable findings are in the return.

**Agent invocation:**

Spawn Agent with subagent_type="evaluator", the model chosen above, and prompt:
- Phase: design
- Artifacts: specs/design/architecture.md, specs/design/api-contracts.md, specs/design/api-contracts.schema.json, specs/design/data-models.md, specs/design/data-models.schema.json, specs/design/folder-structure.md, specs/design/component-map.md, specs/design/deployment.md, specs/design/reasons-canvas.md, all specs/design/mockups/*.html files
- Upstream: specs/stories/ (all story files; and specs/stories/story-traces.json when present)
- Grounding verdict: specs/reviews/design-grounding.json when present (already PASS from Step 1.9 — anchor the traceability criterion to it)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "design"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Cross-phase traceability: with a grounding verdict, confirm it; otherwise verify every story ID appears in component-map.md, every API-layer story has endpoints in api-contracts.schema.json, and every UI-layer story has a mockup in specs/design/mockups/.
- Include field-shape check: Compare mockup field names against API contract field names. Flag mismatches.
- Write result to specs/reviews/phase-design-eval.json

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to human approval with eval summary + traceability report.
2. If verdict is **FAIL** — fix the findings, re-dispatching `design-render` when the fix is structural rather than editorial. Re-run the evaluator. `Previous score` is load-bearing: the evaluator applies the ratchet rule only when a caller passes it, so omitting it silently disables regression detection.
3. **Ratchet rule:** weighted_average must be >= previous iteration. Revert on regression.
4. After 3 iterations — present best version with findings.

---
