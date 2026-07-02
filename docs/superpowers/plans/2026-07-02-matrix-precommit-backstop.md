# Verification-Matrix Pre-Commit Backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pre-commit hook deterministically re-run `verification-matrix-gate.js --phase executed`, so a session that skips Gate 9 cannot commit stale or missing runtime evidence — and fix the `auto/SKILL.md:131` claim so it describes what pre-commit actually re-checks.

**Architecture:** A new `checkVerificationMatrix(projectDir, group)` in `.claude/git-hooks/pre-commit`, called from `checkSprintContract` after `checkSecurityVerdict`. It lazy-requires the real gate script (`.claude/scripts/verification-matrix-gate.js` exports `runGate`) so semantics stay single-sourced, guards on matrix-file existence (absent = pre-matrix project, silent skip), and announces via `noteSkip` when the matrix exists but the script is unresolvable (fail-open-but-loud, per hook convention). It calls `runGate` in-process — no child process, and no verdict-file write (the hook is read-only; only the CLI writes `verification-matrix-verdict.json`).

**Tech Stack:** Node stdlib only (repo rule: `.claude/scripts` and hooks have zero deps). Tests: `node:test` + the existing `test/helpers/hook-fixture.js` (`makeGitProject`/`runGitHook`).

**Branch:** `fix/matrix-precommit-backstop` off `main`, PR when green.

## Global Constraints

- Node stdlib only; no new dependencies anywhere.
- Hook failure philosophy: gates that cannot run must be announced (`noteSkip`), never silently skipped; a broken gate must not brick committing (outer try/catch already handles that).
- The fixture helper `makeGitProject` copies `.claude/git-hooks/` and `.claude/hooks/lib/` into the temp project but NOT `.claude/scripts/` — tests that need the gate script must copy it in explicitly (same pattern as `installContractSchema`).
- Run the suite with `npm test`. Gotcha (CLAUDE.md): this checkout is under iCloud-synced Documents — if `npm test` hangs, kill orphaned `node --test` processes and delete any ` 2.`-suffixed duplicate files, then re-run.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `checkVerificationMatrix` in the pre-commit hook

**Files:**
- Modify: `.claude/git-hooks/pre-commit` (new function after `checkSecurityVerdict` ~line 172; call added at the end of `checkSprintContract` ~line 197)
- Test: `test/pre-commit-git-hook.test.js` (append new tests + fixture helpers)

**Interfaces:**
- Consumes: `runGate({ root, phase: 'executed', group })` from `.claude/scripts/verification-matrix-gate.js` → returns `{ phase, group, pass, rows_checked, failures: [{code, ...}] }`, throws if the matrix file is unreadable. `fail(message)` and `noteSkip(gate, reason)` already defined in the hook.
- Produces: `checkVerificationMatrix(projectDir, group)` — called only from `checkSprintContract`; Task 2's doc wording refers to this behavior.

- [ ] **Step 1: Write the failing tests**

Append to `test/pre-commit-git-hook.test.js` (after the existing security-verdict tests, before the coverage tests). The fixtures round-trip the REAL gate script (CLAUDE.md principle #5) — no hand-built verdict files.

```js
// --- verification-matrix backstop (2026-07-02 audit fix #2) ---------------

function installMatrixGate(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'verification-matrix-gate.js'),
    path.join(dir, 'verification-matrix-gate.js')
  );
}

// Minimal but REAL artifact set that satisfies runGate --phase executed:
// one unit-only matrix row, its story trace, a unit trace, and fresh evidence.
function armMatrixGate(projectDir, { checkStatus = 'executed', staleEvidence = false } = {}) {
  const write = (rel, content) => {
    const p = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  };
  write('specs/stories/story-traces.json', JSON.stringify([
    { id: 'S1', acs: ['AC-1'], traces: ['BRD-1'] },
  ]));
  write('specs/test_artefacts/unit-traces.json', JSON.stringify([
    { matrix_id: 'VM-1', path: 'tests/test_models.py' },
  ]));
  write('tests/test_models.py', 'def test_x():\n    assert True\n');
  const implPath = write('src/types/models.py', 'X = 1\n');
  const evidencePath = write('reports/unit-evidence.txt', 'PASS\n');
  if (staleEvidence) {
    // Evidence predates the implementation file it claims to verify.
    const past = (Date.now() - 60 * 60 * 1000) / 1000;
    fs.utimesSync(evidencePath, past, past);
    const now = Date.now() / 1000;
    fs.utimesSync(implPath, now, now);
  }
  write('specs/test_artefacts/verification-matrix.json', JSON.stringify({
    requirements: [{
      id: 'VM-1',
      ac_id: 'AC-1',
      story_id: 'S1',
      brd_id: 'BRD-1',
      group: 'group-01',
      required_layers: ['unit'],
      checks: [{
        id: 'chk-1',
        layer: 'unit',
        status: checkStatus,
        evidence: 'reports/unit-evidence.txt',
        implementation_paths: ['src/types/models.py'],
      }],
    }],
  }));
}

// The contract gate must be green in these tests so the matrix backstop is
// the only thing that can block.
function armGreenContractGate(projectDir) {
  installContractSchema(projectDir);
  armContractGate(projectDir, VALID_CONTRACT);
  fs.writeFileSync(path.join(projectDir, 'specs', 'reviews', 'security-verdict.json'), '{"verdict":"PASS"}');
}

test('matrix backstop: passes when executed evidence is present and fresh', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  installMatrixGate(projectDir);
  armMatrixGate(projectDir);
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('matrix backstop: blocks when a required check is not executed', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  installMatrixGate(projectDir);
  armMatrixGate(projectDir, { checkStatus: 'planned' });
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('verification matrix'), result.stdout);
  assert.ok(result.stdout.includes('missing_executed_evidence'), result.stdout);
});

test('matrix backstop: blocks stale evidence (older than its implementation path)', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  installMatrixGate(projectDir);
  armMatrixGate(projectDir, { staleEvidence: true });
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('stale_executed_evidence'), result.stdout);
});

test('matrix backstop: silent no-op when no matrix file exists', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  // No installMatrixGate / armMatrixGate: pre-matrix project.
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('verification-matrix'), result.stdout);
});

test('matrix backstop: announces the skip when the matrix exists but the gate script is missing', async () => {
  const projectDir = makeGitProject();
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  armGreenContractGate(projectDir);
  armMatrixGate(projectDir); // matrix present…
  // …but .claude/scripts/verification-matrix-gate.js was never copied in.
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED'), result.stdout);
  assert.ok(result.stdout.includes('verification-matrix'), result.stdout);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test --test-name-pattern "matrix backstop" test/pre-commit-git-hook.test.js`
Expected: the two `blocks…` tests and the `announces the skip` test FAIL (hook currently exits 0 and prints nothing about the matrix); the `passes…` and `silent no-op` tests may already pass — that is fine, they pin the non-regression behavior.

- [ ] **Step 3: Implement `checkVerificationMatrix` in the hook**

In `.claude/git-hooks/pre-commit`, insert after `checkSecurityVerdict` (line ~172):

```js
// The verification-matrix gate's in-session invocation points are prompt
// discipline; this backstop re-runs the executed phase at commit time so a
// session that skipped Gate 9 cannot commit stale or missing runtime evidence.
// Lazy require: the script ships in .claude/scripts (not hooks/lib), and its
// absence must degrade to an announced skip, not crash every other gate.
function checkVerificationMatrix(projectDir, group) {
  if (!fs.existsSync(path.join(projectDir, 'specs', 'test_artefacts', 'verification-matrix.json'))) return;
  let runGate;
  try {
    ({ runGate } = require(path.join(__dirname, '..', 'scripts', 'verification-matrix-gate')));
  } catch (_) {
    noteSkip('verification-matrix', 'gate script missing from .claude/scripts');
    return;
  }
  let verdict;
  try {
    verdict = runGate({ root: projectDir, phase: 'executed', group });
  } catch (err) {
    fail(`BLOCKED: verification-matrix gate could not run: ${err.message}\nFix: repair specs/test_artefacts/verification-matrix.json, then retry the commit.\n`);
  }
  if (!verdict.pass) {
    const lines = verdict.failures
      .slice(0, 10)
      .map((f) => `  - ${f.code}${f.matrix_id ? ` (${f.matrix_id})` : ''}${f.layer ? ` [${f.layer}]` : ''}`);
    const more = verdict.failures.length > 10 ? `  … ${verdict.failures.length - 10} more\n` : '';
    fail(
      `BLOCKED: verification matrix (executed phase) not satisfied for group ${group} — ${verdict.failures.length} failure(s):\n` +
      lines.join('\n') + '\n' + more +
      `Fix: run /evaluate to (re)generate runtime evidence and update the matrix, then retry the commit.\n` +
      `Check: node .claude/scripts/verification-matrix-gate.js --phase executed --group "${group}"\n`
    );
  }
}
```

And add the call as the last line of `checkSprintContract` (after `checkSecurityVerdict(projectDir, group);`, line ~197):

```js
  checkSecurityVerdict(projectDir, group);
  checkVerificationMatrix(projectDir, group);
```

Also update the hook's header comment (line ~10-11) gate list: `staged-file layer check → sprint contract (+ verification matrix) → project-wide tsc (TS) → pytest coverage ratchet (Python)`.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `node --test --test-name-pattern "matrix backstop" test/pre-commit-git-hook.test.js`
Expected: all 5 PASS.

- [ ] **Step 5: Run the full pre-commit test file (non-regression)**

Run: `node --test test/pre-commit-git-hook.test.js`
Expected: all tests PASS (the existing contract-gate tests don't create a matrix file, so the new guard keeps them green).

- [ ] **Step 6: Commit**

```bash
git add .claude/git-hooks/pre-commit test/pre-commit-git-hook.test.js
git commit -m "feat: re-run verification-matrix executed phase in pre-commit

The gate's five in-session invocation points are prompt discipline; this
backstop makes the executed phase deterministic at commit time (2026-07-02
audit fix #2). Lazy-requires the real gate script; matrix-absent projects
skip silently, script-absent projects skip loudly.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Truth-up the docs and the registry

**Files:**
- Modify: `.claude/skills/auto/SKILL.md:131` (one sentence)
- Modify: `harness-manifest.json` (sensor `verification-matrix-gate`, index 28 in `sensors`)
- Modify: `HARNESS.md` (the verification-matrix-gate sensor row/section)

**Interfaces:**
- Consumes: `checkVerificationMatrix` behavior from Task 1 (schema-shape re-check + executed-phase re-run are what pre-commit now actually does).
- Produces: nothing downstream; this task makes registry/prompt claims match reality.

- [ ] **Step 1: Fix the false claim in `auto/SKILL.md:131`**

Replace the final sentence of the Step-3 "Validate before it freezes" bullet:

Old:
```
Do not proceed to execution with an invalid contract: the pre-commit hook repeats this check deterministically and will block every commit until it is fixed.
```

New:
```
Do not proceed to execution with an invalid contract: the pre-commit hook deterministically re-validates the contract's schema shape and re-runs the verification-matrix `executed` phase on every commit, so, whenever `specs/test_artefacts/verification-matrix.json` exists, a malformed contract or missing/stale runtime evidence blocks the commit regardless of whether this step was run.
```
(Reviewer-amended wording: the original sentence over-claimed — the hook is a silent no-op when the matrix file is absent.)

- [ ] **Step 2: Update the manifest sensor entry**

In `harness-manifest.json`, sensor id `verification-matrix-gate`: append to `wired_at` the hook location, and extend the description's final sentence. Exact edits:

```json
"wired_at": ".claude/scripts/verification-matrix-gate.js; .claude/git-hooks/pre-commit (executed phase, commit-time backstop)",
```

and append to `description`:

```
 The executed phase is additionally re-run by the pre-commit hook (checkVerificationMatrix) as a deterministic commit-time backstop, so skipping the in-session invocation cannot bypass it.
```

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exit 0. If it rejects the two-location `wired_at` string, keep `wired_at` unchanged and put the hook location only in the description sentence above — the validator is the source of truth for field shape.

- [ ] **Step 3: Update HARNESS.md**

Find the sensor's row/section: `grep -n "verification-matrix-gate" HARNESS.md`. Append the same fact to its description text: enforced at commit time by the pre-commit hook's `checkVerificationMatrix` (executed phase). Match the surrounding rows' phrasing style.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS (~1009 tests). If it hangs, apply the iCloud gotcha from Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/auto/SKILL.md harness-manifest.json HARNESS.md
git commit -m "docs: register pre-commit matrix backstop; fix auto SKILL claim

auto/SKILL.md:131 claimed pre-commit repeats the matrix check; that was
only true for contract schema shape. Now the claim matches reality.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan (workflow, not tasks)

Fresh-context diff review of the branch, then whole-branch review on the strongest model, then PR (`gh pr create`) titled "feat: verification-matrix pre-commit backstop (audit fix #2)" referencing `docs/superpowers/specs/2026-07-02-audit-fixes-design.md`. Human owns merge.
