## SECTION 3: Sprint Contract Negotiation (Steps 2-3)

Sprint contracts define the verifiable done-criteria for a group. Two-step propose-approve process using generator and evaluator agents.

### Step 2 — Generator Proposes Contract

Spawn generator as a subagent with this prompt:

> Read stories [list IDs for this group], `specs/design/api-contracts.md`, `specs/design/component-map.md`, and `specs/test_artefacts/verification-matrix.json`. Propose a sprint contract for group {ID}. Include: api_checks, playwright_checks, design_checks, architecture_checks, features list. Every runtime check must carry the `matrix_ids` it verifies. Populate `architecture_checks.files_must_exist` with the file paths listed for this group's stories in `specs/design/component-map.md`. Write the contract to `sprint-contracts/{group}.json`.

The generator produces a draft contract based on the story acceptance criteria and the architecture design.

### Step 3 — Evaluator Approves Contract

Spawn evaluator as a subagent with this prompt:

> Read the proposed sprint contract at `sprint-contracts/{group}.json` and `specs/test_artefacts/verification-matrix.json`. Review each check against the story acceptance criteria, API contracts, and matrix obligations. Add any missing checks. Remove any checks that do not trace to an acceptance criterion. Ensure every runtime check carries the `matrix_ids` it verifies. Write the final contract to the same path. Also write an audit of your edits to `specs/reviews/contract-audit-{group}.json`: `{"group": "...", "added": [{"check": ..., "reason": ...}], "removed": [{"check": ..., "reason": ...}]}` — an empty `added`/`removed` means the proposal was accepted as-is.

Rules:
- **No back-and-forth.** The evaluator has final say. The generator does not get to dispute.
- **The edit is not silent.** The orchestrator reads `contract-audit-{group}.json` after negotiation and surfaces it in the progress log (and to the user at the next escalation point). A removal whose `reason` contradicts a story acceptance criterion is grounds to re-run negotiation once with the audit attached — this is the only permitted second cycle.
- **Contract is immutable after negotiation.** Once the evaluator writes the final version, no one edits it — the single permitted exception is the deterministic, additive-only accessibility normalizer (Step 3.5), which may inject a default `accessibility_checks` block for UI stories; it never edits or removes other checks.
- **Validate before it freezes.** After the evaluator writes the final contract, run `node .claude/scripts/validate-contract.js sprint-contracts/{group}.json`, then `node .claude/scripts/verification-matrix-gate.js --phase contract --group "$GROUP_ID"`. A non-zero exit means the contract is structurally malformed or missing required matrix coverage — re-run Step 3 once with the validator output attached. Do not proceed to execution with an invalid contract: on every commit that stages source files during an active sprint group, the pre-commit hook deterministically re-validates the contract's schema shape and — when `specs/test_artefacts/verification-matrix.json` exists — re-runs the verification-matrix `executed` phase, so a malformed contract or missing/stale runtime evidence blocks the commit regardless of whether this step was run.

### Step 3.5 — Default-on accessibility (G12)

After the sprint contract is finalized and validated, run the accessibility normalizer on it:

`node .claude/scripts/contract-accessibility-default.js sprint-contracts/{group}.json`

When the contract has `playwright_checks` (a UI story) and the project has not set `accessibility.enabled:false`, this deterministically injects a default `accessibility_checks` block so the evaluator's axe-core gate runs (Full FAIL / Lean WARN on serious/critical impacts). A contract that already defines `accessibility_checks` is left untouched. This makes accessibility a default for UI work instead of something the generator must remember to request. (In parallel mode, run it per group on each `sprint-contracts/{group}.json`.)

After running the normalizer, re-run `node .claude/scripts/validate-contract.js sprint-contracts/{group}.json` to confirm the (possibly-augmented) contract is still schema-valid before moving to execution.

### Ceremony profile

Read `project-manifest.json#execution.ceremony` (default `full`). At `trimmed`:

- A group containing a **single story** skips sprint decomposition — negotiate the contract (Steps 2–3 above, unchanged) and go straight to implementation with one teammate. Multi-story groups keep the full decomposition regardless of profile.
- The design-critic GAN loop (SECTION 9) caps at **3 iterations** instead of 10.
- Nothing else changes. The evaluator, adaptive review policy, and every deterministic gate run identically in both profiles — ceremony trims coordination overhead, never verification.

When a new model generation lands, re-baseline the profile per `docs/adaptive-ceremony.md` instead of carrying forward last generation's settings.

---
