# Verification Matrix Gate

**Date:** 2026-07-01
**Goal:** Make generated code prove conformance to the BRD as mechanically as possible, across unit tests, API checks, and Playwright black-box tests.

## Scope

Add a first-class verification matrix that becomes the shared oracle for all generated verification:

- BRD requirement -> story -> acceptance criterion -> verification obligation.
- Each obligation declares the required verification layers: `unit`, `integration`, `api`, `e2e`, `accessibility`, `security`, `performance`.
- Unit tests, API checks, and Playwright checks must all trace to matrix obligation IDs.
- A deterministic gate blocks when required coverage, executable artifacts, or execution evidence is missing.
- The gate is hard-blocking before PR creation in `/auto`, with explicit human waivers only through the existing sensor-waiver mechanism.

This closes the gap where coverage proves that code ran, and mutation proves that some assertions bite, but neither proves that the assertions correspond to BRD requirements.

## Artifact Contract

Create `specs/test_artefacts/verification-matrix.json`.

Minimum shape:

```json
{
  "version": 1,
  "requirements": [
    {
      "id": "VM-001",
      "brd_id": "BR-1",
      "story_id": "E1-S1",
      "ac_id": "E1-S1-AC1",
      "text": "User can create a todo item with title and due date",
      "required_layers": ["unit", "api", "e2e"],
      "checks": [
        {
          "id": "UT-001",
          "layer": "unit",
          "kind": "test",
          "path": "tests/unit/todo.test.ts",
          "status": "planned"
        },
        {
          "id": "API-001",
          "layer": "api",
          "kind": "sprint-contract-check",
          "path": "sprint-contracts/A.json",
          "status": "planned"
        },
        {
          "id": "E2E-001",
          "layer": "e2e",
          "kind": "playwright",
          "path": "e2e/E1-S1.spec.ts",
          "status": "planned"
        }
      ]
    }
  ]
}
```

Rules:

- `id` is a stable matrix obligation id.
- `brd_id`, `story_id`, and `ac_id` must resolve through the existing BRD/story trace spines.
- `required_layers` is derived from story layer, API contracts, UI presence, schema constraints, trust boundaries, and non-functional requirements.
- `checks[].status` transitions from `planned` to `implemented` to `executed`.
- `checks[].evidence` is required for `executed` checks and points to deterministic output: test report, evaluator report section, coverage summary, Playwright report, security verdict, or accessibility verdict.

## Generation Flow

### `/test --plan-only`

After `test-traces.json` and constraint obligations are generated, create `verification-matrix.json` from:

- `specs/brd/brd-requirements.json`
- `specs/stories/story-traces.json`
- `specs/test_artefacts/test-traces.json`
- `specs/test_artefacts/constraint-obligations.json`
- `specs/design/api-contracts.schema.json` when available
- `specs/design/component-map.md`

Then run the new matrix gate in planning mode:

```bash
node .claude/scripts/verification-matrix-gate.js --phase plan
```

Planning mode blocks when:

- an implementation-ready AC has no matrix obligation;
- an obligation has no required layer;
- an API-layer story lacks an API check obligation;
- a UI story lacks an E2E obligation;
- a schema constraint obligation is not represented in the matrix;
- any matrix row traces to no BRD/story AC.

### Sprint Contract Negotiation

Update `/auto` Section 3 so sprint contract negotiation consumes the matrix.

The generator proposal prompt must include `specs/test_artefacts/verification-matrix.json` and require each `api_checks`, `playwright_checks`, `accessibility_checks`, `security_checks`, and `performance_checks` entry to carry a `matrix_ids` array.

The evaluator approval prompt must add missing checks for uncovered matrix IDs, remove checks that trace to no matrix ID, and write the same `contract-audit-{group}.json` it writes today.

After `validate-contract.js`, run:

```bash
node .claude/scripts/verification-matrix-gate.js --phase contract --group "$GROUP_ID"
```

Contract mode blocks when:

- a contract check lacks `matrix_ids`;
- a `matrix_ids` entry does not exist;
- a matrix row requiring `api`, `e2e`, `accessibility`, `security`, or `performance` has no matching contract check;
- a contract check belongs to another group;
- the contract schema is valid but verification coverage is incomplete.

### Implementation and Unit Tests

Generated unit and integration tests must emit trace evidence. Start with sidecar files because they are stack-neutral:

- `specs/test_artefacts/unit-traces.json`
- `specs/test_artefacts/integration-traces.json`

Shape:

```json
[
  {
    "id": "UT-001",
    "matrix_id": "VM-001",
    "test_name": "creates todo with title and due date",
    "path": "tests/unit/todo.test.ts"
  }
]
```

The generator and teammate prompts must require these trace files when they add or change tests.

After unit tests and coverage run, `/auto` Gate 3 runs:

```bash
node .claude/scripts/verification-matrix-gate.js --phase implementation --group "$GROUP_ID"
```

Implementation mode blocks when:

- a matrix row requiring `unit` lacks a unit trace;
- a matrix row requiring `integration` lacks an integration trace;
- a trace references a missing test file;
- a trace references no valid matrix row;
- a production file changed for a story but its corresponding unit/integration matrix rows remain `planned`.

Coverage and mutation remain separate hard gates. The matrix gate does not replace them.

### Playwright Generation

Update `/test --e2e-only` so Playwright specs are generated from the matrix rather than directly from prose stories.

Each Playwright test must include the matrix ID in its test title or metadata and update `verification-matrix.json` or a sidecar:

- `specs/test_artefacts/e2e-traces.json`

Shape mirrors unit traces, with `path` pointing to `e2e/{story-id}.spec.ts`.

Rules:

- one Playwright spec per story remains the default;
- one `test()` block maps to one matrix obligation unless a single user flow intentionally covers multiple obligations;
- CSS/XPath selectors remain forbidden by the existing Playwright patterns;
- black-box checks must assert user-visible behavior, not implementation details.

### Phase 9.5 Pre-PR Verification

Before opening a PR, run:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed
```

Executed mode blocks when:

- any required matrix row lacks executed evidence;
- an evidence path is missing or stale relative to the latest implementation commit;
- `specs/reviews/evaluator-report.md` is not `PASS` for matrix rows covered by API/E2E;
- unit/integration test reports do not include the traced tests;
- a required accessibility/security/performance row has no corresponding verdict.

## New Script

Add `.claude/scripts/verification-matrix-gate.js`.

Inputs:

- `--phase plan|contract|implementation|executed`
- `--group <id>` optional for scoped `/auto` groups
- `--matrix specs/test_artefacts/verification-matrix.json`
- existing trace spines and sprint contract files

Outputs:

- `specs/reviews/verification-matrix-verdict.json`
- concise stdout summary:
  - matrix rows checked
  - missing layer coverage
  - invalid traces
  - missing artifacts
  - missing or stale execution evidence

Exit codes:

- `0` pass
- `1` gate failure
- `2` usage or unreadable artifacts

The script should expose pure helpers for `node:test`: loading, normalization, grouping, phase-specific validation, and verdict rendering.

## Schema Changes

Update `.claude/skills/evaluate/references/contract-schema.json` to allow optional `matrix_ids` arrays on:

- `api_checks[]`
- `playwright_checks[]`
- `design_checks[]`
- `accessibility_checks`
- `security_checks`
- `performance_checks[]`

The schema should not require `matrix_ids` by itself, because the matrix gate owns semantic enforcement and can produce better diagnostics.

## Harness Manifest

Register a new traceability sensor:

- `id`: `verification-matrix-gate`
- `axis`: `traceability`
- `type`: `computational`
- `cadence`: `integration`
- `status`: `active`
- `scope`: `artifacts`
- `wired_at`: `.claude/scripts/verification-matrix-gate.js`

The description must state that the sensor runs in planning, contract, implementation, and pre-PR executed phases even though the manifest has one canonical cadence value. Update `HARNESS.md` Traceability row to name the matrix gate as the BRD-to-test-to-runtime conformance control.

## Prompt and Skill Updates

Update:

- `.claude/skills/test/SKILL.md`
  - generate `verification-matrix.json`;
  - generate unit/integration/e2e trace sidecars;
  - run the planning matrix gate.
- `.claude/skills/auto/SKILL.md`
  - include matrix in contract negotiation;
  - run contract, implementation, and executed phase gates;
  - include matrix failures in the self-healing classification table.
- `.claude/agents/generator.md`
  - require unit/integration test trace sidecars for every generated test;
  - require matrix IDs in teammate prompts.
- `.claude/agents/evaluator.md`
  - treat missing matrix coverage in a sprint contract as a hard verification failure;
  - include matrix IDs in evaluator report sections.
- `.claude/skills/evaluate/SKILL.md`
  - report which matrix IDs each API/Playwright/accessibility/security/performance check executed.

## Tests

Add or extend `node:test` coverage:

- `test/verification-matrix-gate.test.js`
  - passes a fully covered matrix;
  - fails AC with no obligation;
  - fails obligation with required `api` but no contract check;
  - fails contract check with unknown matrix ID;
  - fails required `unit` row with missing unit trace;
  - fails missing artifact path;
  - fails missing executed evidence;
  - supports `--group` scoping.
- `test/contract-validate.test.js`
  - contract schema accepts optional `matrix_ids`.
- `test/trace-check.test.js`
  - wiring assertions that `/test`, `/auto`, `generator`, `evaluator`, and `evaluate` mention the verification matrix and the new gate.
- `test/harness-manifest.test.js`
  - manifest entry is present and points to an existing file.

Run target verification:

```bash
npm test
node --test test/verification-matrix-gate.test.js
```

## Risks

- **Matrix false confidence:** a test can claim a matrix ID but assert weakly. Mitigation: keep coverage and mutation smoke as separate hard gates; matrix is traceability, not assertion strength.
- **Over-constraining small projects:** a tiny CLI may not need API or E2E. Mitigation: required layers are derived from topology and story layer; CLI/library stories can require `unit` and optional `integration` only.
- **Schema churn in sprint contracts:** adding `matrix_ids` should be additive and optional at schema level; the semantic gate enforces only when a matrix exists.
- **Stale evidence complexity:** first implementation can require evidence paths to exist; commit-staleness checks may start with best-effort `mtime`/git hash and tighten later.
- **Agent sidecar drift:** generated tests and sidecars can disagree. Mitigation: the gate verifies sidecar paths exist and, for supported stacks, later can parse test titles for matrix IDs.

## Out of Scope

- Replacing coverage, mutation, evaluator, security, or accessibility gates.
- Building a full test report parser for every stack in the first implementation.
- Proving semantic adequacy of each assertion beyond existing mutation and reviewer gates.
- Changing the BRD/spec/design trace spine format except where needed to read existing IDs.
