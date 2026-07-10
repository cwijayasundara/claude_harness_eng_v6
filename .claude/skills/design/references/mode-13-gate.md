## Gate

**Phase evaluation gate runs before human approval.** The evaluator agent (artifact mode) validates:
- Cross-phase traceability (every story has component-map entry, API endpoints, mockups)
- Schema validity (OpenAPI + JSON Schema syntax)
- Field-shape consistency (mockup fields match API contracts)
- Component-map coverage and file ownership
- Folder structure viability

**Human approval is required before proceeding to `/auto`.**

After presenting all artifacts and validation results, ask: "Does this architecture and these mockups look correct? Approve to proceed to `/auto`, or provide corrections."

> `/auto` is the next step in the greenfield path (`/brd` → `/spec` → `/design` → `/auto`). `/build` is the wrapper that runs the whole pipeline starting from a BRD path; it is not intended to be invoked mid-pipeline after `/design` has already been approved.

**Delta mode's GATE 2 is never collapsed** by `--autonomous` in `/sprint` or
`/feature` — there is no zero-gate mode for a design amendment, unlike the
autonomous scope-routing gates elsewhere in the harness.

---
