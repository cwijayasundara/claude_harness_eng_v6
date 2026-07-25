## Gate

**Phase evaluation gate runs before human approval.** The evaluator agent (artifact mode) validates:
- Cross-phase traceability (every story has component-map entry, API endpoints, mockups)
- Schema validity (OpenAPI + JSON Schema syntax)
- Field-shape consistency (mockup fields match API contracts)
- Component-map coverage and file ownership
- Folder structure viability

**Human approval is required before proceeding to `/auto`.** Run it as a dialogue, not a single question — follow `.claude/skills/plan-review-loop/SKILL.md` with `--phase design`.

Architecture is the phase where a wrong call is cheapest to fix now and most expensive to fix later, so the review brief leads with the choices rather than the artifacts: the layering and module boundaries you chose and the alternatives you rejected, the contracts that lock in data shape, and anything Step 0's brainstorm left genuinely open.

**Challenge sources for this phase:**

- `specs/design/reasons-canvas.md` — the decisions and their rejected alternatives
- `specs/plan-confidence.json` — band and drivers
- `specs/reviews/phase-design-eval.json` — findings accepted without a fix
- The modularity assessment from Step 0.7, and any hub or cycle it flagged
- Schema constraints that will become hard obligations for `/test` (each one becomes negative tests the human is implicitly signing up for)

Record each round with `plan-approval.js`, naming the architecture doc, `api-contracts.md`, `component-map.md`, and the `.schema.json` files on the approving round. Then:

```bash
node .claude/scripts/plan-approval.js check --phase design
```

In `--auto` / `--autonomous`, waive with `--lane` instead of looping.

> `/auto` is the next step in the greenfield path (`/brd` → `/spec` → `/design` → `/auto`). `/build` is the wrapper that runs the whole pipeline starting from a BRD path; it is not intended to be invoked mid-pipeline after `/design` has already been approved.

**Delta mode's GATE 2 is never collapsed** by `--autonomous` in `/sprint` or
`/feature` — there is no zero-gate mode for a design amendment, unlike the
autonomous scope-routing gates elsewhere in the harness.

---
