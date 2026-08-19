# Structured Story-Driven Development (SSDD)

The harness's adaptation of Thoughtworks [Structured Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/). SPDD treats a versioned REASONS prompt as the first-class artifact. SSDD treats the **user story** — joined into `specs/bundles/{id}.json` — as that artifact. The system REASONS Canvas stays the constitution; the per-story Generation Contract is the delta prompt `/implement` executes.

When reality diverges, **fix the structured story record first**, then re-render, then code. Do not patch generated prose or source and leave the record stale.

## Gate map (human-managed planning)

| Gate | SPDD analog | SSDD record (intent) | Volume (transcription) | REASONS slice |
|---|---|---|---|---|
| `/scaffold` | project norms | `.scaffold-profile.json` → manifest | `scaffold-apply.js` copies the tree | N — stack, verification, ceremony |
| `/brd` | story + analysis | `brd-requirements.json` + `analysis-seed.json` | `prd-extract.js` / `brd-lean-write.js` | R, E, Safeguards |
| `/spec` | `/spdd-story` | `spec-decisions.json` + story Generation Contract (skeleton) | `spec-render` + `spec-render-write.js` | R per story; INVEST slices |
| `/design` | analysis + REASONS Canvas | `design-decisions.json` + `reasons-canvas.md` + `program-design.md` | `design-render` | A, Structure, N, Safeguards |
| `/test --plan-only` | test scenarios | `verification-matrix.json` + `test-traces.json` | `test-plan-write.js` | Operations as testable seams |
| `/auto` | `/spdd-generate` | implementable `specs/bundles/{id}.json` | `/implement` fills Operations, writes code | execute the contract |

`node .claude/scripts/spdd-sync.js --write` is `/spdd-sync` (Canvas + bundles rewrite). Design amendments are `/spdd-prompt-update`. `/auto` does not reopen the human planning gates.

## Token discipline (planning gates + generate)

1. **Shape, then `/clear`, then render.** Judgement stays in the main session; volume forks to the sidekick. Same-session render re-bills the dialogue.
2. **Digest, do not dump.** `phase-digest.js` is the shaping input. Do not read `brd-requirements.json`, every `E*-S*.md`, or eval JSON whole.
3. **Scripts write volume.** Extractors, `spec-render-write.js`, `test-plan-write.js`, `bundle-write.js`, `scaffold-apply.js`. The model fills only what a script cannot.
4. **Review the pair in `lean-review-surface.md`**, not the artifact pile. Phase-eval is `--eval` only.
5. **One structured record per gate.** A change request edits that record, then `--render-only` / the writer script. Re-present a changelog.
6. **Generate from the sealed pack.** After `plan-seal.js check`, `/auto` loads `specs/bundles/{id}.json` plus the slices the bundle cites. Do not reload `/brd`, `brd.md`, or every `E*-S*.md`.
7. **Teammates get the bundle, not the pile.** Sprint contracts, spawn prompts, and reviews take ACs / owned files / matrix ids from the bundle. A second pass over `specs/stories/` is a token leak and a drift source.
8. **Fix the record, then the code.** A discovered design gap edits the Generation Contract / `reasons-canvas.md` / `design-decisions.json` first, then `bundle-write.js` / `story-sync.js`, then source. Do not patch `api-contracts.md` and leave the Canvas stale.

## Alignment, abstraction, iterative review

- **Alignment** — `/brd` and `/spec` lock what is in, what is out, and the observable postcondition before design.
- **Abstraction first** — `/design` reviews the Canvas + `program-design.md` (types, signatures, call stack) before any product file is written.
- **Iterative review** — `plan-review-loop` is the bounded dialogue; `plan-approval.js` is the receipt. Headless lanes waive; they do not skip silently.
- **Generate from the join** — `/auto` executes implementable bundles. `GATE_CATALOG` runs `generation-contract`, `story-bundle-check`, and `canvas-sync-check` at commit (skipping SECTION 5 still fails). `spdd-sync.js --write` rewrites the record. G16 runs per `/auto` group; `regression-gate.js --replay` is the merge-time / `--once` Success sweep.
