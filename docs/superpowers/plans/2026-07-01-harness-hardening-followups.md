# Harness Hardening Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining harness-hardening items after the SPDD analysis, sensor arbitration, drift template, Canvas sync, and modularity-guidance pass.

**Architecture:** Keep the public workflow simple: `/build`, `/feature`, and `/gate` remain the user-facing routes. Add enforcement and optional depth as small scripts, templates, and prompt wiring inside the existing harness instead of introducing new top-level pipelines.

**Tech Stack:** Node.js CommonJS scripts, `node:test`, Markdown skill docs, JSON schemas/templates, GitHub Actions workflow templates.

---

## File Structure

- Modify `.claude/skills/spec/SKILL.md` to consume `specs/brd/brd-analysis.json` during story generation.
- Modify `.claude/skills/design/SKILL.md` to consume `specs/brd/brd-analysis.json` during architecture and Canvas generation.
- Modify `.claude/skills/gate/SKILL.md`, `.claude/skills/change/SKILL.md`, and `.claude/skills/refactor/SKILL.md` to document where `canvas-sync-check.js` runs and whether it blocks.
- Modify `.claude/scripts/scaffold-apply.js` to optionally activate the drift workflow template.
- Modify `.claude/commands/scaffold.md` to expose the drift workflow activation flag or profile rule.
- Modify `.claude/templates/project-readme.template.md` to present the simplified three-route public UX.
- Create `.claude/scripts/validate-sensor-waivers.js` for waiver schema validation and expiry detection.
- Create `.claude/scripts/deep-mutation.js` for optional Stryker/mutmut-style deep mutation orchestration.
- Create `.claude/scripts/flake-history.js` for cross-run flake trend aggregation.
- Create or update tests under `test/` for every new command, prompt contract, and scaffold behavior.
- Update `package.json`, `HARNESS.md`, `README.md`, and `harness-manifest.json` after each new guide/sensor becomes real.

---

### Task 1: Thread BRD Analysis Into Spec And Design

**Files:**
- Modify: `.claude/skills/spec/SKILL.md`
- Modify: `.claude/skills/design/SKILL.md`
- Modify: `.claude/templates/phase-eval-rubrics.json`
- Test: `test/harness-improvements-contract.test.js`

- [x] **Step 1: Write failing prompt-contract tests**

Add assertions to `test/harness-improvements-contract.test.js` that require:

```js
test('spec and design consume the BRD analysis pack downstream', () => {
  const spec = read('.claude/skills/spec/SKILL.md');
  const design = read('.claude/skills/design/SKILL.md');
  for (const doc of [spec, design]) {
    assert.match(doc, /brd-analysis\.json/);
    assert.match(doc, /ambiguity_table/);
    assert.match(doc, /edge_case_table/);
    assert.match(doc, /risk_gap_table/);
  }
});
```

- [x] **Step 2: Run the targeted test and verify RED**

Run:

```bash
node --test test/harness-improvements-contract.test.js
```

Expected: FAIL because `/spec` and `/design` do not yet consume `brd-analysis.json`.

- [x] **Step 3: Wire `/spec` to read BRD analysis**

In `.claude/skills/spec/SKILL.md`, add `specs/brd/brd-analysis.json` to prerequisites when present. In story generation instructions, require:

```markdown
- Use `ambiguity_table` to avoid converting unresolved ambiguity into implementation scope.
- Use `edge_case_table` to create acceptance criteria for failure, empty, limit, and security/privacy paths.
- Use `ac_coverage_matrix` to preserve every source requirement's observable acceptance criterion.
- Use `risk_gap_table` to tag stories that need human review or explicit non-goals.
```

- [x] **Step 4: Wire `/design` to read BRD analysis**

In `.claude/skills/design/SKILL.md`, add `specs/brd/brd-analysis.json` to planner inputs when present. Require architecture and Canvas output to incorporate domain concepts, risks, edge cases, and unresolved ambiguities.

- [x] **Step 5: Run targeted tests and verify GREEN**

Run:

```bash
node --test test/harness-improvements-contract.test.js
```

Expected: PASS.

---

### Task 2: Enforce Sensor Waiver Validation

**Files:**
- Create: `.claude/scripts/validate-sensor-waivers.js`
- Modify: `package.json`
- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `harness-manifest.json`
- Test: `test/sensor-waivers.test.js`

- [x] **Step 1: Write failing waiver validator tests**

Create `test/sensor-waivers.test.js` with tests for valid waivers, missing required fields, expired date waivers, and non-date expiry strings.

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test test/sensor-waivers.test.js
```

Expected: FAIL because `.claude/scripts/validate-sensor-waivers.js` does not exist.

- [x] **Step 3: Implement `validate-sensor-waivers.js`**

Implement a CommonJS CLI that:

- Reads `specs/reviews/sensor-waivers.json` by default.
- Reads `.claude/templates/sensor-waivers.schema.json`.
- Validates required fields without adding a heavy JSON Schema dependency.
- Treats missing waiver file as pass.
- Treats ISO date `expires` before today as exit 1.
- Treats non-date expiry strings as valid review conditions.
- Writes `specs/reviews/sensor-waivers-verdict.json`.

- [x] **Step 4: Wire package and `/gate` docs**

Add to `package.json`:

```json
"sensor-waivers": "node .claude/scripts/validate-sensor-waivers.js"
```

Document in `.claude/skills/gate/SKILL.md` that waiver validation runs before accepting any waiver-backed suppression.

- [x] **Step 5: Register in `harness-manifest.json`**

Add an active computational traceability sensor:

```json
{
  "id": "sensor-waiver-validation",
  "axis": "traceability",
  "type": "computational",
  "cadence": "commit",
  "status": "active",
  "scope": "artifacts",
  "wired_at": ".claude/scripts/validate-sensor-waivers.js",
  "signal": "invalid or expired sensor waiver",
  "description": "Validates specs/reviews/sensor-waivers.json so threshold bumps and suppressions are reviewed and expire."
}
```

- [x] **Step 6: Run tests**

Run:

```bash
node --test test/sensor-waivers.test.js test/harness-manifest.test.js
```

Expected: PASS.

---

### Task 3: Decide And Wire Canvas Sync Blocking

**Files:**
- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `.claude/skills/change/SKILL.md`
- Modify: `.claude/skills/refactor/SKILL.md`
- Modify: `package.json` if needed
- Test: `test/canvas-sync-wiring.test.js`

- [x] **Step 1: Write failing wiring tests**

Create `test/canvas-sync-wiring.test.js` asserting:

- `/gate` mentions `npm run canvas-sync`.
- `/change` says behavior changes update Canvas first when `specs/design/reasons-canvas.md` exists.
- `/refactor` says moved/renamed governed files must update Canvas.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/canvas-sync-wiring.test.js
```

Expected: FAIL where wiring text is missing.

- [x] **Step 3: Add blocking policy**

Use this policy:

- `/change`: run `npm run canvas-sync` after code changes when `specs/design/reasons-canvas.md` exists. A mismatch is `self-correct`.
- `/refactor`: run `npm run canvas-sync` after moves/renames. A governed-path mismatch is `hard-block` until Canvas `Governs` is updated.
- `/gate`: run `npm run canvas-sync` when changed source files and `reasons-canvas.md` both exist. Exit 1 is a block unless a valid sensor waiver exists.

- [x] **Step 4: Run targeted tests**

Run:

```bash
node --test test/canvas-sync-wiring.test.js test/harness-improvements-contract.test.js
```

Expected: PASS.

---

### Task 4: Activate Drift Workflow Deliberately

**Files:**
- Modify: `.claude/scripts/scaffold-apply.js`
- Modify: `.claude/commands/scaffold.md`
- Modify: `.claude/templates/project-readme.template.md`
- Test: `test/scaffold-drift-workflow.test.js`

- [x] **Step 1: Write failing scaffold tests**

Create `test/scaffold-drift-workflow.test.js` asserting:

- Default scaffold does not create `.github/workflows/harness-drift.yml`.
- Profile with `quality.drift.workflow: true` or CLI `--drift-workflow` copies the workflow.
- The scaffold report mentions the workflow when copied.

- [x] **Step 2: Run RED**

Run:

```bash
node --test test/scaffold-drift-workflow.test.js
```

Expected: FAIL.

- [x] **Step 3: Implement opt-in copy**

In `scaffold-apply.js`, copy `.claude/templates/github-workflows/harness-drift.yml` to `.github/workflows/harness-drift.yml` only when explicitly enabled.

- [x] **Step 4: Document the flag**

In `.claude/commands/scaffold.md`, add `--drift-workflow` as an opt-in flag. Keep `/scaffold --telemetry` separate; telemetry and drift cadence are related but not identical.

- [x] **Step 5: Update generated README template**

In `.claude/templates/project-readme.template.md`, add:

```markdown
Primary routes: `/build`, `/feature "<request>"`, `/gate`.
Optional drift workflow: copy or scaffold `.github/workflows/harness-drift.yml` when you want weekly quality drift reports.
```

- [x] **Step 6: Run scaffold tests**

Run:

```bash
node --test test/scaffold-drift-workflow.test.js test/scaffold-copy.test.js test/scaffold-apply.test.js
```

Expected: PASS.

---

### Task 5: Add Optional Deep Mutation Tier

**Files:**
- Create: `.claude/scripts/deep-mutation.js`
- Modify: `package.json`
- Modify: `.claude/skills/test/references/mutation-smoke.md`
- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `harness-manifest.json`
- Test: `test/deep-mutation.test.js`

- [x] **Step 1: Write failing deep mutation tests**

Create tests that use injected command runners to verify:

- JS/TS projects prefer Stryker when `stryker.conf.*` or `@stryker-mutator/core` is present.
- Python projects prefer mutmut when `mutmut` config or executable is present.
- Missing tools exit 0 with an `unprovisioned` verdict.
- `--critical-only` limits files to configured critical globs.

- [x] **Step 2: Run RED**

Run:

```bash
node --test test/deep-mutation.test.js
```

Expected: FAIL.

- [x] **Step 3: Implement wrapper**

Implement `.claude/scripts/deep-mutation.js` as an optional orchestrator that:

- Detects Stryker or mutmut.
- Runs changed-files or critical-glob mode.
- Writes `specs/reviews/deep-mutation-verdict.json`.
- Exits 0 for `pass`, `skipped`, or `unprovisioned`.
- Exits 1 for mutation failures in an explicitly requested deep run.

- [x] **Step 4: Wire docs and manifest**

Add:

```json
"deep-mutation": "node .claude/scripts/deep-mutation.js"
```

Document that this is not an inner-loop replacement for `mutation-gate.js`; it is a release/critical-module tier.

- [x] **Step 5: Run tests**

Run:

```bash
node --test test/deep-mutation.test.js test/harness-manifest.test.js
```

Expected: PASS.

---

### Task 6: Add Cross-Run Flake History

**Files:**
- Create: `.claude/scripts/flake-history.js`
- Modify: `.claude/scripts/flake-detector.js` if it needs stable output fields
- Modify: `package.json`
- Modify: `HARNESS.md`
- Modify: `harness-manifest.json`
- Test: `test/flake-history.test.js`

- [x] **Step 1: Write failing history tests**

Create tests for:

- Appending one flake detector result to `specs/drift/flake-history.jsonl`.
- Rendering `specs/drift/flake-history.md`.
- Ranking recurring flakes across runs.
- Handling missing detector output as no-op.

- [x] **Step 2: Run RED**

Run:

```bash
node --test test/flake-history.test.js
```

Expected: FAIL.

- [x] **Step 3: Implement history script**

Implement `.claude/scripts/flake-history.js`:

- Reads `specs/reports/flake-report.json` or a `--report` path.
- Appends compact JSONL entries with date, commit, test name, passed count, failed count.
- Renders top recurring flakes.
- Exits 0 always unless file I/O is invalid.

- [x] **Step 4: Wire package and drift docs**

Add:

```json
"flake-history": "node .claude/scripts/flake-history.js"
```

Update the drift workflow template to run `npm run flake-history` after `npm run flakes`.

- [x] **Step 5: Run tests**

Run:

```bash
node --test test/flake-history.test.js test/harness-improvements-contract.test.js
```

Expected: PASS.

---

### Task 7: Final UX And Verification Pass

**Files:**
- Modify: `README.md`
- Modify: `.claude/templates/project-readme.template.md`
- Modify: `HARNESS.md`
- Modify: `docs/prd-format.md` if needed
- Test: existing docs/scaffold contract tests

- [x] **Step 1: Write docs consistency test**

Add or extend a docs contract test to require the same public routes in README and the generated project README template:

```text
New product -> /build
Existing product -> /feature "<request>"
Verify/review -> /gate
```

- [x] **Step 2: Run RED if needed**

Run:

```bash
node --test test/scaffold-command.test.js test/scaffold-copy.test.js
```

Expected: FAIL if the template does not yet carry the same wording.

- [x] **Step 3: Update docs**

Keep command simplification as presentation only. Do not remove advanced commands.

- [x] **Step 4: Run full verification**

Run:

```bash
npm test
```

Expected: PASS, all tests green.

- [x] **Step 5: Review changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: Only planned files changed.

---

## Execution Order

1. Task 1: BRD analysis downstream consumption.
2. Task 2: Sensor waiver validation.
3. Task 3: Canvas sync blocking.
4. Task 4: Drift workflow activation.
5. Task 6: Cross-run flake history.
6. Task 5: Optional deep mutation tier.
7. Task 7: UX and full verification.

Deep mutation is intentionally after the lightweight controls because it has the most external-tool variability.

## Self-Review

- Spec coverage: all seven pending findings are covered by one task each.
- Placeholder scan: no TBD/TODO placeholders; each task has files, tests, commands, and expected results.
- Type consistency: script names and npm script names are stable across tasks.
