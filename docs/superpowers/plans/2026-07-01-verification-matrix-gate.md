# Verification Matrix Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hard-blocking verification matrix gate that ties BRD/story acceptance criteria to unit, API, and Playwright verification evidence.

**Architecture:** Implement a deterministic Node.js gate in `.claude/scripts/verification-matrix-gate.js` with pure validation helpers and phase-specific checks. Keep semantic enforcement in the gate, while contract schema changes stay additive by allowing optional `matrix_ids` fields. Wire the gate into harness prompts, docs, and manifest so generated tests and runtime evaluator checks share the same requirement oracle.

**Tech Stack:** Node.js CommonJS, `node:test`, existing JSON artifacts under `specs/`, harness prompt Markdown files, `harness-manifest.json`, `HARNESS.md`.

---

## File Structure

- Create `.claude/scripts/verification-matrix-gate.js`
  - CLI and pure validation helpers.
  - Reads `verification-matrix.json`, trace sidecars, sprint contracts, evaluator reports, and file existence.
  - Writes `specs/reviews/verification-matrix-verdict.json`.
- Create `test/verification-matrix-gate.test.js`
  - Unit tests for the pure helpers and CLI behavior.
- Modify `.claude/skills/evaluate/references/contract-schema.json`
  - Allow optional `matrix_ids` arrays on runtime check objects.
- Modify `test/contract-validate.test.js`
  - Assert contracts with `matrix_ids` validate.
- Modify `.claude/skills/test/SKILL.md`
  - Generate `verification-matrix.json`.
  - Generate unit, integration, and E2E trace sidecars.
  - Run `verification-matrix-gate.js --phase plan`.
- Modify `.claude/skills/auto/SKILL.md`
  - Include matrix in sprint contract negotiation.
  - Run matrix gate in `contract`, `implementation`, and `executed` phases.
  - Add matrix failures to self-healing classification.
- Modify `.claude/agents/generator.md`
  - Require test trace sidecars and matrix IDs.
- Modify `.claude/agents/evaluator.md`
  - Require matrix IDs in report sections and treat matrix coverage failures as hard failures.
- Modify `.claude/skills/evaluate/SKILL.md`
  - Report matrix IDs for executed checks.
- Modify `harness-manifest.json`
  - Add `verification-matrix-gate` traceability sensor.
- Modify `HARNESS.md`
  - Document the matrix gate in the Traceability row.
- Modify `test/trace-check.test.js`
  - Add wiring assertions for the new files/prompts.
- Modify `test/harness-manifest.test.js`
  - Assert the manifest entry points to an existing file.

---

### Task 1: Failing Gate Tests

**Files:**
- Create: `test/verification-matrix-gate.test.js`
- No production changes in this task.

- [ ] **Step 1: Write failing tests for plan, contract, implementation, and executed phases**

Create `test/verification-matrix-gate.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'verification-matrix-gate.js');
const gate = require(SCRIPT);

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-gate-'));
  fs.mkdirSync(path.join(root, 'specs', 'test_artefacts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'stories'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sprint-contracts'), { recursive: true });
  return root;
}

function writeJson(root, rel, data) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

function writeText(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function baseProject() {
  const root = tmpProject();
  writeJson(root, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC1', 'E1-S1-AC2'] },
  ]);
  writeJson(root, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [
      {
        id: 'VM-001',
        brd_id: 'BR-1',
        story_id: 'E1-S1',
        ac_id: 'E1-S1-AC1',
        text: 'Create todo',
        group: 'A',
        required_layers: ['unit', 'api', 'e2e'],
        checks: [
          { id: 'UT-001', layer: 'unit', kind: 'test', path: 'tests/unit/todo.test.js', status: 'implemented' },
          { id: 'API-001', layer: 'api', kind: 'sprint-contract-check', path: 'sprint-contracts/A.json', status: 'implemented' },
          { id: 'E2E-001', layer: 'e2e', kind: 'playwright', path: 'e2e/E1-S1.spec.ts', status: 'implemented' },
        ],
      },
      {
        id: 'VM-002',
        brd_id: 'BR-1',
        story_id: 'E1-S1',
        ac_id: 'E1-S1-AC2',
        text: 'Reject invalid title',
        group: 'A',
        required_layers: ['unit'],
        checks: [
          { id: 'UT-002', layer: 'unit', kind: 'test', path: 'tests/unit/todo.test.js', status: 'implemented' },
        ],
      },
    ],
  });
  writeJson(root, 'sprint-contracts/A.json', {
    api_checks: [{ id: 'api-create', matrix_ids: ['VM-001'], method: 'POST', path: '/todos', expect: { status: 201 } }],
    playwright_checks: [{ id: 'e2e-create', matrix_ids: ['VM-001'], name: 'create todo flow', steps: [] }],
    design_checks: [],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  });
  writeJson(root, 'specs/test_artefacts/unit-traces.json', [
    { id: 'UT-001', matrix_id: 'VM-001', test_name: 'creates todo', path: 'tests/unit/todo.test.js' },
    { id: 'UT-002', matrix_id: 'VM-002', test_name: 'rejects invalid title', path: 'tests/unit/todo.test.js' },
  ]);
  writeJson(root, 'specs/test_artefacts/e2e-traces.json', [
    { id: 'E2E-001', matrix_id: 'VM-001', test_name: 'creates todo through UI', path: 'e2e/E1-S1.spec.ts' },
  ]);
  writeText(root, 'tests/unit/todo.test.js', 'test("creates todo", () => {});\n');
  writeText(root, 'e2e/E1-S1.spec.ts', 'test("VM-001 creates todo", async () => {});\n');
  writeText(root, 'specs/reviews/evaluator-report.md', '# Evaluator Report\n\nVERDICT: PASS\n');
  return root;
}

test('plan phase passes a matrix covering every implementation-ready AC', () => {
  const root = baseProject();
  const verdict = gate.runGate({ root, phase: 'plan' });
  assert.strictEqual(verdict.pass, true);
  assert.deepStrictEqual(verdict.failures, []);
});

test('plan phase fails when an AC has no matrix obligation', () => {
  const root = baseProject();
  writeJson(root, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC1', 'E1-S1-AC2', 'E1-S1-AC3'] },
  ]);
  const verdict = gate.runGate({ root, phase: 'plan' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_matrix_obligation' && f.ac_id === 'E1-S1-AC3'));
});

test('contract phase fails when required API coverage has no contract check', () => {
  const root = baseProject();
  writeJson(root, 'sprint-contracts/A.json', {
    api_checks: [],
    playwright_checks: [{ id: 'e2e-create', matrix_ids: ['VM-001'], name: 'create todo flow', steps: [] }],
    design_checks: [],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  });
  const verdict = gate.runGate({ root, phase: 'contract', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_contract_layer' && f.matrix_id === 'VM-001' && f.layer === 'api'));
});

test('contract phase fails when a contract check references an unknown matrix id', () => {
  const root = baseProject();
  writeJson(root, 'sprint-contracts/A.json', {
    api_checks: [{ id: 'api-create', matrix_ids: ['VM-999'], method: 'POST', path: '/todos', expect: { status: 201 } }],
    playwright_checks: [],
    design_checks: [],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  });
  const verdict = gate.runGate({ root, phase: 'contract', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'unknown_matrix_id' && f.matrix_id === 'VM-999'));
});

test('implementation phase fails when a required unit trace is missing', () => {
  const root = baseProject();
  writeJson(root, 'specs/test_artefacts/unit-traces.json', [
    { id: 'UT-001', matrix_id: 'VM-001', test_name: 'creates todo', path: 'tests/unit/todo.test.js' },
  ]);
  const verdict = gate.runGate({ root, phase: 'implementation', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_trace' && f.matrix_id === 'VM-002' && f.layer === 'unit'));
});

test('implementation phase fails when a trace points to a missing test file', () => {
  const root = baseProject();
  fs.unlinkSync(path.join(root, 'tests/unit/todo.test.js'));
  const verdict = gate.runGate({ root, phase: 'implementation', group: 'A' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'missing_artifact' && f.path === 'tests/unit/todo.test.js'));
});

test('executed phase fails when evaluator report is not PASS for API/E2E rows', () => {
  const root = baseProject();
  writeText(root, 'specs/reviews/evaluator-report.md', '# Evaluator Report\n\nVERDICT: FAIL\n');
  const verdict = gate.runGate({ root, phase: 'executed' });
  assert.strictEqual(verdict.pass, false);
  assert.ok(verdict.failures.some((f) => f.code === 'evaluator_not_pass'));
});

test('CLI writes verdict JSON and exits 0 on pass', () => {
  const root = baseProject();
  execFileSync(process.execPath, [SCRIPT, '--phase', 'plan', '--root', root], { stdio: 'pipe' });
  const verdict = JSON.parse(fs.readFileSync(path.join(root, 'specs/reviews/verification-matrix-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.pass, true);
});

test('CLI exits 1 on gate failure', () => {
  const root = baseProject();
  writeJson(root, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC9'] },
  ]);
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--phase', 'plan', '--root', root], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 1);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
node --test test/verification-matrix-gate.test.js
```

Expected: FAIL with `Cannot find module '../.claude/scripts/verification-matrix-gate.js'`.

---

### Task 2: Implement Verification Matrix Gate

**Files:**
- Create: `.claude/scripts/verification-matrix-gate.js`
- Test: `test/verification-matrix-gate.test.js`

- [ ] **Step 1: Write the minimal implementation**

Create `.claude/scripts/verification-matrix-gate.js`:

```js
#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MATRIX = path.join('specs', 'test_artefacts', 'verification-matrix.json');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relExists(root, rel) {
  return !!rel && fs.existsSync(path.join(root, rel));
}

function loadMatrix(root, matrixPath) {
  const file = path.resolve(root, matrixPath || DEFAULT_MATRIX);
  const json = readJson(file, null);
  if (!json) throw new Error(`matrix not found: ${path.relative(root, file)}`);
  return {
    file,
    rows: asArray(json.requirements),
  };
}

function storyAcIds(root) {
  const storyTraces = readJson(path.join(root, 'specs', 'stories', 'story-traces.json'), []);
  return new Set(storyTraces.flatMap((story) => asArray(story.acs)));
}

function rowGroup(row) {
  return row.group || (typeof row.story_id === 'string' && row.story_id.includes('-') ? null : null);
}

function scopedRows(rows, group) {
  if (!group) return rows;
  return rows.filter((row) => !row.group || row.group === group);
}

function matrixIdSet(rows) {
  return new Set(rows.map((row) => row.id));
}

function add(failures, code, detail) {
  failures.push({ code, ...detail });
}

function validatePlan(root, rows, failures) {
  const acIds = storyAcIds(root);
  const coveredAcs = new Set();
  for (const row of rows) {
    if (!row.id) add(failures, 'missing_matrix_id', { row });
    if (!row.ac_id || !acIds.has(row.ac_id)) add(failures, 'invalid_ac_trace', { matrix_id: row.id, ac_id: row.ac_id || null });
    else coveredAcs.add(row.ac_id);
    if (asArray(row.required_layers).length === 0) add(failures, 'missing_required_layers', { matrix_id: row.id });
  }
  for (const ac_id of acIds) {
    if (!coveredAcs.has(ac_id)) add(failures, 'missing_matrix_obligation', { ac_id });
  }
}

function contractChecks(contract) {
  return [
    ...asArray(contract.api_checks).map((check) => ({ layer: 'api', check })),
    ...asArray(contract.playwright_checks).map((check) => ({ layer: 'e2e', check })),
    ...asArray(contract.design_checks).map((check) => ({ layer: 'design', check })),
    ...asArray(contract.performance_checks).map((check) => ({ layer: 'performance', check })),
    ...(contract.accessibility_checks ? [{ layer: 'accessibility', check: contract.accessibility_checks }] : []),
    ...(contract.security_checks ? [{ layer: 'security', check: contract.security_checks }] : []),
  ];
}

function validateContract(root, rows, group, failures) {
  const contractPath = group ? path.join(root, 'sprint-contracts', `${group}.json`) : null;
  if (!contractPath || !fs.existsSync(contractPath)) {
    add(failures, 'missing_contract', { group: group || null });
    return;
  }
  const contract = readJson(contractPath, {});
  const ids = matrixIdSet(rows);
  const covered = new Map();
  for (const { layer, check } of contractChecks(contract)) {
    const matrixIds = asArray(check.matrix_ids);
    if (matrixIds.length === 0) {
      add(failures, 'missing_matrix_ids', { layer, check_id: check.id || check.name || layer });
      continue;
    }
    for (const matrix_id of matrixIds) {
      if (!ids.has(matrix_id)) add(failures, 'unknown_matrix_id', { layer, matrix_id });
      if (!covered.has(matrix_id)) covered.set(matrix_id, new Set());
      covered.get(matrix_id).add(layer);
    }
  }
  for (const row of rows) {
    for (const layer of asArray(row.required_layers)) {
      if (!['api', 'e2e', 'accessibility', 'security', 'performance'].includes(layer)) continue;
      if (!covered.get(row.id)?.has(layer)) add(failures, 'missing_contract_layer', { matrix_id: row.id, layer });
    }
  }
}

function readTraceFile(root, rel) {
  return readJson(path.join(root, rel), []);
}

function validateTraceLayer(root, rows, layer, traceRel, failures) {
  const required = rows.filter((row) => asArray(row.required_layers).includes(layer));
  const traces = readTraceFile(root, traceRel);
  const rowsById = matrixIdSet(rows);
  const covered = new Set();
  for (const trace of traces) {
    if (!rowsById.has(trace.matrix_id)) {
      add(failures, 'unknown_matrix_id', { layer, matrix_id: trace.matrix_id || null });
      continue;
    }
    covered.add(trace.matrix_id);
    if (!relExists(root, trace.path)) add(failures, 'missing_artifact', { layer, matrix_id: trace.matrix_id, path: trace.path || null });
  }
  for (const row of required) {
    if (!covered.has(row.id)) add(failures, 'missing_trace', { matrix_id: row.id, layer });
  }
}

function validateImplementation(root, rows, failures) {
  validateTraceLayer(root, rows, 'unit', path.join('specs', 'test_artefacts', 'unit-traces.json'), failures);
  validateTraceLayer(root, rows, 'integration', path.join('specs', 'test_artefacts', 'integration-traces.json'), failures);
}

function validateExecuted(root, rows, failures) {
  validateImplementation(root, rows, failures);
  validateTraceLayer(root, rows, 'e2e', path.join('specs', 'test_artefacts', 'e2e-traces.json'), failures);
  const needsRuntime = rows.some((row) => asArray(row.required_layers).some((layer) => ['api', 'e2e', 'accessibility', 'security', 'performance'].includes(layer)));
  if (needsRuntime) {
    let report = '';
    try {
      report = fs.readFileSync(path.join(root, 'specs', 'reviews', 'evaluator-report.md'), 'utf8');
    } catch (_) {
      /* handled below */
    }
    if (!/^VERDICT:\s*PASS\s*$/m.test(report)) add(failures, 'evaluator_not_pass', { path: 'specs/reviews/evaluator-report.md' });
  }
}

function runGate(options) {
  const root = path.resolve(options.root || process.cwd());
  const phase = options.phase || 'plan';
  const { rows } = loadMatrix(root, options.matrix || DEFAULT_MATRIX);
  const filtered = scopedRows(rows, options.group);
  const failures = [];

  validatePlan(root, filtered, failures);
  if (phase === 'contract') validateContract(root, filtered, options.group, failures);
  else if (phase === 'implementation') validateImplementation(root, filtered, failures);
  else if (phase === 'executed') validateExecuted(root, filtered, failures);
  else if (phase !== 'plan') add(failures, 'invalid_phase', { phase });

  return {
    phase,
    group: options.group || null,
    pass: failures.length === 0,
    rows_checked: filtered.length,
    failures,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--phase') out.phase = argv[++i];
    else if (arg === '--group') out.group = argv[++i];
    else if (arg === '--matrix') out.matrix = argv[++i];
    else if (arg === '--root') out.root = argv[++i];
  }
  return out;
}

function writeVerdict(root, verdict) {
  const out = path.join(root, 'specs', 'reviews', 'verification-matrix-verdict.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || process.cwd());
  let verdict;
  try {
    verdict = runGate({ ...args, root });
  } catch (err) {
    process.stderr.write(`verification-matrix-gate: ${err.message}\n`);
    process.exit(2);
  }
  writeVerdict(root, verdict);
  process.stdout.write(
    `verification-matrix: ${verdict.pass ? 'PASS' : 'FAIL'} — ` +
      `${verdict.rows_checked} row(s), ${verdict.failures.length} failure(s)\n`
  );
  for (const failure of verdict.failures) {
    process.stdout.write(`  ${failure.code}: ${JSON.stringify(failure)}\n`);
  }
  process.exit(verdict.pass ? 0 : 1);
}

module.exports = { runGate, validatePlan, validateContract, validateImplementation, validateExecuted };

if (require.main === module) main();
```

- [ ] **Step 2: Run the focused gate tests**

Run:

```bash
node --test test/verification-matrix-gate.test.js
```

Expected: PASS.

- [ ] **Step 3: Commit the gate and tests**

Run:

```bash
git add .claude/scripts/verification-matrix-gate.js test/verification-matrix-gate.test.js
git commit -m "feat: add verification matrix gate"
```

---

### Task 3: Contract Schema Support

**Files:**
- Modify: `.claude/skills/evaluate/references/contract-schema.json`
- Modify: `test/contract-validate.test.js`

- [ ] **Step 1: Inspect the existing contract schema and tests**

Run:

```bash
sed -n '1,260p' .claude/skills/evaluate/references/contract-schema.json
sed -n '1,260p' test/contract-validate.test.js
```

Expected: identify where object properties are defined for `api_checks`, `playwright_checks`, `design_checks`, `accessibility_checks`, `security_checks`, and `performance_checks`.

- [ ] **Step 2: Write a failing contract validation test**

Add this case to `test/contract-validate.test.js`, adapting the helper names to the existing file:

```js
test('contract schema accepts optional matrix_ids on verification checks', () => {
  const contract = {
    api_checks: [
      {
        id: 'api-create',
        matrix_ids: ['VM-001'],
        method: 'POST',
        path: '/todos',
        expect: { status: 201 },
      },
    ],
    playwright_checks: [
      {
        id: 'e2e-create',
        matrix_ids: ['VM-001'],
        name: 'create todo',
        steps: [],
      },
    ],
    design_checks: [
      {
        id: 'design-create',
        matrix_ids: ['VM-001'],
        page: '/',
        criteria: 'Primary todo creation flow is visible',
        min_score: 7,
      },
    ],
    accessibility_checks: {
      matrix_ids: ['VM-001'],
      required: true,
      urls: ['/'],
      block_impacts: ['serious', 'critical'],
    },
    security_checks: {
      matrix_ids: ['VM-001'],
      block_severities: ['critical', 'high'],
    },
    performance_checks: [
      {
        id: 'perf-list',
        matrix_ids: ['VM-001'],
        method: 'GET',
        path: '/todos',
        max_response_time_ms: 300,
      },
    ],
    architecture_checks: { files_must_exist: [] },
    features: ['F001'],
  };

  assert.deepStrictEqual(validateContract(contract), []);
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run the existing contract test command. If the file uses direct `node:test`, run:

```bash
node --test test/contract-validate.test.js
```

Expected: FAIL because `matrix_ids` is not allowed by the current schema.

- [ ] **Step 4: Add reusable `matrix_ids` schema property**

In `.claude/skills/evaluate/references/contract-schema.json`, add an optional property to each relevant check object:

```json
"matrix_ids": {
  "type": "array",
  "items": { "type": "string" }
}
```

Do not make it required. The semantic requirement belongs to `verification-matrix-gate.js`.

- [ ] **Step 5: Run contract tests**

Run:

```bash
node --test test/contract-validate.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit schema support**

Run:

```bash
git add .claude/skills/evaluate/references/contract-schema.json test/contract-validate.test.js
git commit -m "feat: allow matrix ids in sprint contracts"
```

---

### Task 4: Harness Registry and Documentation

**Files:**
- Modify: `harness-manifest.json`
- Modify: `HARNESS.md`
- Modify: `test/harness-manifest.test.js`

- [ ] **Step 1: Write failing manifest test**

Add this test to `test/harness-manifest.test.js`, adapting helper names to the existing file:

```js
test('manifest registers verification matrix gate sensor', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness-manifest.json'), 'utf8'));
  const sensor = manifest.sensors.find((entry) => entry.id === 'verification-matrix-gate');
  assert.ok(sensor, 'verification-matrix-gate sensor must be registered');
  assert.strictEqual(sensor.axis, 'traceability');
  assert.strictEqual(sensor.type, 'computational');
  assert.strictEqual(sensor.status, 'active');
  assert.strictEqual(sensor.scope, 'artifacts');
  assert.strictEqual(sensor.wired_at, '.claude/scripts/verification-matrix-gate.js');
  assert.ok(fs.existsSync(path.join(ROOT, sensor.wired_at)), `${sensor.wired_at} must exist`);
});
```

- [ ] **Step 2: Run the manifest test and verify it fails**

Run:

```bash
node --test test/harness-manifest.test.js
```

Expected: FAIL because the sensor is not registered.

- [ ] **Step 3: Register the sensor**

Add this entry to `harness-manifest.json` in the Traceability sensor section near `trace-check`:

```json
{
  "id": "verification-matrix-gate",
  "axis": "traceability",
  "type": "computational",
  "cadence": "integration",
  "status": "active",
  "scope": "artifacts",
  "wired_at": ".claude/scripts/verification-matrix-gate.js",
  "signal": "BRD/story acceptance criteria without required unit/API/E2E evidence",
  "description": "Verification matrix gate: a deterministic BRD-to-test-to-runtime conformance control. Runs in planning, sprint-contract, implementation, and pre-PR executed phases, requiring every implementation-ready acceptance criterion to have the required verification layers and evidence."
}
```

- [ ] **Step 4: Update `HARNESS.md` Traceability row**

In `HARNESS.md`, add `verification-matrix-gate` to the Traceability sensors list:

```markdown
✅ `verification-matrix-gate` (BRD/story AC -> unit/API/E2E evidence matrix, hard-blocking before PR)
```

Keep the existing traceability wording intact.

- [ ] **Step 5: Run manifest tests**

Run:

```bash
node --test test/harness-manifest.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit registry/docs**

Run:

```bash
git add harness-manifest.json HARNESS.md test/harness-manifest.test.js
git commit -m "docs: register verification matrix sensor"
```

---

### Task 5: Prompt and Skill Wiring

**Files:**
- Modify: `.claude/skills/test/SKILL.md`
- Modify: `.claude/skills/auto/SKILL.md`
- Modify: `.claude/agents/generator.md`
- Modify: `.claude/agents/evaluator.md`
- Modify: `.claude/skills/evaluate/SKILL.md`
- Modify: `test/trace-check.test.js`

- [ ] **Step 1: Write failing wiring assertions**

Append to `test/trace-check.test.js`:

```js
test('verification matrix gate is wired through test, auto, generator, evaluator, and evaluate prompts', () => {
  const files = {
    testSkill: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'test', 'SKILL.md'), 'utf8'),
    autoSkill: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'auto', 'SKILL.md'), 'utf8'),
    generator: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'agents', 'generator.md'), 'utf8'),
    evaluator: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'agents', 'evaluator.md'), 'utf8'),
    evaluateSkill: fsw.readFileSync(pathw.join(ROOTW, '.claude', 'skills', 'evaluate', 'SKILL.md'), 'utf8'),
  };

  assert.match(files.testSkill, /verification-matrix\.json/);
  assert.match(files.testSkill, /verification-matrix-gate\.js --phase plan/);
  assert.match(files.testSkill, /unit-traces\.json/);
  assert.match(files.testSkill, /e2e-traces\.json/);

  assert.match(files.autoSkill, /verification-matrix\.json/);
  assert.match(files.autoSkill, /verification-matrix-gate\.js --phase contract/);
  assert.match(files.autoSkill, /verification-matrix-gate\.js --phase implementation/);
  assert.match(files.autoSkill, /verification-matrix-gate\.js --phase executed/);

  assert.match(files.generator, /unit-traces\.json/);
  assert.match(files.generator, /matrix_id/);
  assert.match(files.evaluator, /matrix_ids/);
  assert.match(files.evaluateSkill, /matrix_ids/);
});
```

- [ ] **Step 2: Run wiring test and verify it fails**

Run:

```bash
node --test test/trace-check.test.js
```

Expected: FAIL on missing matrix wording.

- [ ] **Step 3: Update `/test` skill**

In `.claude/skills/test/SKILL.md`:

- Add `verification-matrix.json` to Step 4 outputs.
- Add `unit-traces.json`, `integration-traces.json`, and `e2e-traces.json` to the output table.
- Add this command after the existing `test-grounding.json` gate:

```bash
node .claude/scripts/verification-matrix-gate.js --phase plan
```

- State that `/test --e2e-only` generates Playwright specs from `verification-matrix.json`.

- [ ] **Step 4: Update `/auto` skill**

In `.claude/skills/auto/SKILL.md`:

- In Section 3, require generator and evaluator sprint-contract prompts to read `specs/test_artefacts/verification-matrix.json`.
- Require `matrix_ids` on runtime checks.
- After `validate-contract.js`, add:

```bash
node .claude/scripts/verification-matrix-gate.js --phase contract --group "$GROUP_ID"
```

- In Gate 3, after coverage/mutation, add:

```bash
node .claude/scripts/verification-matrix-gate.js --phase implementation --group "$GROUP_ID"
```

- In Phase 9.5, before PR creation, add:

```bash
node .claude/scripts/verification-matrix-gate.js --phase executed
```

- In failure classification, add category `Verification matrix` with strategy: add or execute the missing traced verification, never weaken the matrix.

- [ ] **Step 5: Update generator and evaluator prompts**

In `.claude/agents/generator.md`:

- Add `specs/test_artefacts/verification-matrix.json` to inputs.
- Require tests added by teammates to update `unit-traces.json` or `integration-traces.json` with `matrix_id`.

In `.claude/agents/evaluator.md` and `.claude/skills/evaluate/SKILL.md`:

- Require API/Playwright/accessibility/security/performance report entries to include the `matrix_ids` they executed.
- State that a missing required matrix check is a hard failure.

- [ ] **Step 6: Run wiring assertions**

Run:

```bash
node --test test/trace-check.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit prompt wiring**

Run:

```bash
git add .claude/skills/test/SKILL.md .claude/skills/auto/SKILL.md .claude/agents/generator.md .claude/agents/evaluator.md .claude/skills/evaluate/SKILL.md test/trace-check.test.js
git commit -m "docs: wire verification matrix through harness prompts"
```

---

### Task 6: Full Verification

**Files:**
- No source changes unless earlier tests reveal a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test test/verification-matrix-gate.test.js
node --test test/contract-validate.test.js
node --test test/harness-manifest.test.js
node --test test/trace-check.test.js
```

Expected: all PASS.

- [ ] **Step 2: Run root unit/contract suite**

Run:

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 3: Check worktree**

Run:

```bash
git status --short
```

Expected: no unstaged or uncommitted changes except intentional commits already created by previous tasks.

---

## Self-Review Notes

- Spec coverage: Tasks cover the gate script, phase behavior, contract schema, prompt wiring, manifest/HARNESS docs, and tests named in the approved spec.
- Out of scope respected: no full stack-specific test report parser; evidence checking starts with existing artifacts and evaluator PASS.
- Type consistency: matrix rows use `id`; sidecars use `matrix_id`; sprint contracts use `matrix_ids`.
- Execution order: all production changes have failing tests first, then minimal implementation, then verification.
