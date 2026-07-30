# G11 Harness-Coverage Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated `scope` field to every active sensor and a report-only `harness-coverage.js` that maps each source file against the manifest's active sensors by axis, reporting per-axis coverage % + ungoverned holes.

**Architecture:** The registry change is a controlled `scope` field on each active/partial sensor (enforced by `validate-harness-manifest.js`), which makes coverage computable. `harness-coverage.js` reads the manifest + a project's `code-graph.json` + coverage + `project-manifest.json#architecture`, resolves each file-mapping sensor's file set, and emits an `.md` + `.json` report (mirroring `coupling-report`/`drift-report`). Report-only.

**Tech Stack:** Node.js (`node:test`); the harness registry (`harness-manifest.json` + `validate-harness-manifest.js`); `code-graph.json`.

## Global Constraints

- **`scope` controlled vocabulary** (exact set): `universal`, `test-covered`, `layer-roots`, `contexts`, `runtime`, `dependencies`, `artifacts`, `repo`. Required on every **active/partial sensor**; planned sensors and all guides are exempt.
- **File-mapping scopes** (counted in the per-file per-axis %): exactly `universal`, `test-covered`, `layer-roots`, `contexts`. The other four (`runtime`, `dependencies`, `artifacts`, `repo`) are reported separately, never folded into the per-file %.
- **Report-only:** `harness-coverage.js` exits `0` always; an opt-in `--check` flag MAY exit non-zero only if an axis is 0%-covered.
- **Graceful no-graph:** if `code-graph.json` is absent, exit 0 with a message (the harness's own repo has no graph).
- **No silent truncation:** always print the total hole count even if the printed hole list is capped.
- **Per-file, not per-symbol.** No new sensor behavior. No new guide/sensor manifest entry for the report itself.
- **Manifest honesty:** `node .claude/scripts/validate-harness-manifest.js` must pass on the updated manifest.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Modify** `.claude/scripts/validate-harness-manifest.js` — add `SCOPES` + require `scope` on active/partial sensors (Task 1).
- **Modify** `harness-manifest.json` — add `scope` to every active/partial sensor (Task 1).
- **Modify** `test/harness-manifest.test.js` — assert every active/partial sensor has a valid scope (Task 1).
- **Create** `.claude/scripts/harness-coverage.js` — the report reader (Task 2).
- **Create** `test/harness-coverage.test.js` — fixture-driven unit tests (Task 2).
- **Modify** `package.json` — add the `harness-coverage` script (Task 2).
- **Modify** `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` — G11 done (Task 3).

---

### Task 1: `scope` field + validator enforcement

**Files:**
- Modify: `.claude/scripts/validate-harness-manifest.js`
- Modify: `harness-manifest.json` (add `scope` to every active/partial sensor)
- Test: `test/harness-manifest.test.js`

**Interfaces:**
- Produces: every active/partial sensor carries a `scope` from the controlled set; `validate()` rejects an active/partial sensor without a valid `scope`.

**Scope assignment rule** (apply to EVERY active/partial sensor; the validator + test guarantee none is missed):
- Lint/type/length/secret/SAST + inferential diff reviews (eslint-ruff, type-check, length-caps, secret-scan, sast, clean-code-review, diff-review, security-review) → `universal`
- Test-effectiveness (coverage-ratchet, coverage-diff, mutation-smoke, unit-tests) → `test-covered`
- layer-imports → `layer-roots`; bounded-context-rules → `contexts`
- Running-app / endpoint sensors (eval-api, eval-playwright, eval-design-critic, perf-ratchet, runtime-slo, api-schema-validation, accessibility) → `runtime`
- dep-audit, drift-deps → `dependencies`
- Planning-artifact sensors (grounding-check, trace-check, constraints-extract, plan-confidence, seam-confidence, canvas-structure) → `artifacts`
- Whole-graph / repo-wide (cycle-detection, coupling-report, modularity-pack, modularity-review, drift-architecture, drift-design-code, drift-dead-code) → `repo`
- Planned entries (e.g. api-contract-drift) → no `scope` (exempt).

- [ ] **Step 1: Write the failing test**

Add to `test/harness-manifest.test.js` (a new `test(...)` block; reuse the file's existing `validate`/`DEFAULT_MANIFEST`/`manifest` setup):

```javascript
test('every active or partial sensor declares a valid scope (G11)', () => {
  const SCOPES = new Set(['universal', 'test-covered', 'layer-roots', 'contexts', 'runtime', 'dependencies', 'artifacts', 'repo']);
  const offenders = manifest.sensors
    .filter((s) => (s.status || 'active') !== 'planned')
    .filter((s) => !SCOPES.has(s.scope))
    .map((s) => s.id);
  assert.deepStrictEqual(offenders, [], `sensors missing/invalid scope: ${offenders.join(', ')}`);
});

test('validate() rejects an active sensor with no scope (G11)', () => {
  const bad = { version: '1', guides: [], sensors: [
    { id: 'x', axis: 'behaviour', type: 'computational', cadence: 'commit', status: 'active', wired_at: 'package.json' },
  ] };
  const { errors } = validate(bad);
  assert.ok(errors.some((e) => /scope/i.test(e)), 'expected a scope error');
});
```

(If `test/harness-manifest.test.js` does not already bind `manifest`/`validate`/`DEFAULT_MANIFEST` at module scope, add `const { validate, DEFAULT_MANIFEST } = require('../.claude/scripts/validate-harness-manifest.js');` and `const manifest = JSON.parse(require('fs').readFileSync(DEFAULT_MANIFEST, 'utf8'));` at the top, matching the existing test style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/harness-manifest.test.js`
Expected: FAIL — sensors have no `scope`; `validate()` doesn't check it.

- [ ] **Step 3: Add `SCOPES` + enforcement to the validator**

In `.claude/scripts/validate-harness-manifest.js`, after the `STATUSES` set, add:

```javascript
const SCOPES = new Set(['universal', 'test-covered', 'layer-roots', 'contexts', 'runtime', 'dependencies', 'artifacts', 'repo']);
```

In `validate()`, inside the `for (const s of sensors)` loop (after the existing `type`/`cadence` checks), add:

```javascript
    if ((s.status || 'active') !== 'planned' && !SCOPES.has(s.scope)) {
      errors.push(`sensor ${s.id}: active/partial sensor needs a scope in {${[...SCOPES].join(', ')}}`);
    }
```

- [ ] **Step 4: Add `scope` to every active/partial sensor in `harness-manifest.json`**

For each entry in the `sensors` array whose `status` is not `planned`, add a `"scope": "<value>"` field per the assignment rule above. (Leave planned entries, e.g. `api-contract-drift`, without a scope.) Example — `eslint-ruff` gains `"scope": "universal"`, `coverage-ratchet` gains `"scope": "test-covered"`, `layer-imports` gains `"scope": "layer-roots"`, `runtime-slo` gains `"scope": "runtime"`, `dep-audit` gains `"scope": "dependencies"`, `grounding-check` gains `"scope": "artifacts"`, `cycle-detection` gains `"scope": "repo"`. Keep the JSON valid.

- [ ] **Step 5: Run validator + tests**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`
Run: `node --test test/harness-manifest.test.js`
Expected: PASS (the two new tests + existing).

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/validate-harness-manifest.js harness-manifest.json test/harness-manifest.test.js
git commit -m "feat(g11): validated scope field on every active sensor (registry measurable)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `harness-coverage.js` reader + report

**Files:**
- Create: `.claude/scripts/harness-coverage.js`
- Create: `test/harness-coverage.test.js`
- Modify: `package.json` (add `harness-coverage` script)

**Interfaces:**
- Consumes: the `scope` field from Task 1.
- Produces: `harness-coverage.js` writing `specs/harness-coverage/harness-coverage.{md,json}`; exit 0 (report-only) or non-zero under `--check` when an axis is 0%. Flags: `--root`, `--graph`, `--coverage`, `--check`.

- [ ] **Step 1: Write the failing test**

Create `test/harness-coverage.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'harness-coverage.js');

function run(files, scopedManifest, coverage, arch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'),
    JSON.stringify({ nodes: files.map((p) => ({ id: p, kind: 'file', path: p })) }));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({ architecture: arch || {} }));
  const covPath = path.join(dir, 'cov.json');
  fs.writeFileSync(covPath, JSON.stringify(coverage || {}));
  const manPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manPath, JSON.stringify(scopedManifest));
  let code = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', dir, '--manifest', manPath, '--coverage', covPath], { stdio: 'pipe' });
  } catch (e) { code = e.status; }
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'harness-coverage', 'harness-coverage.json'), 'utf8'));
  return { code, report };
}

const MANIFEST = {
  version: '1', guides: [], sensors: [
    { id: 'lint', axis: 'maintainability', type: 'computational', cadence: 'session', status: 'active', scope: 'universal' },
    { id: 'cov', axis: 'behaviour', type: 'computational', cadence: 'commit', status: 'active', scope: 'test-covered' },
    { id: 'layers', axis: 'architecture', type: 'computational', cadence: 'session', status: 'active', scope: 'layer-roots' },
    { id: 'slo', axis: 'behaviour', type: 'computational', cadence: 'integration', status: 'active', scope: 'runtime' },
  ],
};

test('maintainability is 100% (universal); behaviour holes = untested files', () => {
  const { code, report } = run(
    ['src/a.js', 'src/b.js', 'lib/c.js'],
    MANIFEST,
    { 'src/a.js': { lines: { covered: 5, total: 5 } } }, // only a.js tested
    { layer_roots: ['src'] });
  assert.strictEqual(code, 0);
  assert.strictEqual(report.perAxis.maintainability.pct, 100); // universal covers all 3
  assert.strictEqual(report.perAxis.behaviour.covered, 1);      // only a.js test-covered
  assert.ok(report.perAxis.behaviour.holes.includes('src/b.js'));
  assert.strictEqual(report.perAxis.architecture.covered, 2);   // a.js + b.js under src/
  assert.ok(report.perAxis.architecture.holes.includes('lib/c.js'));
});

test('runtime-scoped sensors are reported separately, not in per-file %', () => {
  const { report } = run(['src/a.js'], MANIFEST, {}, { layer_roots: ['src'] });
  assert.ok(report.nonFileMapping.runtime.includes('slo'));
  // behaviour per-file only counts the test-covered sensor, so 0% here (no coverage)
  assert.strictEqual(report.perAxis.behaviour.pct, 0);
});

test('graceful exit 0 with message when no code-graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST));
  let code = 0; let out = '';
  try { out = execFileSync('node', [SCRIPT, '--root', dir, '--manifest', path.join(dir, 'manifest.json')], { encoding: 'utf8' }); }
  catch (e) { code = e.status; }
  assert.strictEqual(code, 0);
  assert.ok(/code-graph/i.test(out), 'should mention the missing code-graph');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/harness-coverage.test.js`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/harness-coverage.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Harness-coverage report (gap G11). Maps each source file in a project's
// code-graph against the manifest's active sensors by axis, reporting per-axis
// coverage % + ungoverned holes. Report-only (exit 0) unless --check. Makes the
// G1 registry measurable. The non-file-mapping scopes (runtime/dependencies/
// artifacts/repo) are reported separately, not folded into the per-file %.

const fs = require('fs');
const path = require('path');

const FILE_SCOPES = new Set(['universal', 'test-covered', 'layer-roots', 'contexts']);
const AXES = ['maintainability', 'architecture', 'behaviour', 'traceability'];

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }
function toFwd(p) { return String(p).replace(/\\/g, '/'); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function coveredSet(covJson) {
  const out = new Set();
  if (!covJson) return out;
  for (const [f, s] of Object.entries(covJson)) {
    if (f === 'total' || !s) continue;
    const c = (s.lines && s.lines.covered) || (s.summary && s.summary.covered_lines) || 0;
    if (c > 0) out.add(toFwd(f));
  }
  return out;
}

function sourceFiles(graph) {
  return ((graph && graph.nodes) || [])
    .filter((n) => n.kind === 'file' && n.path).map((n) => toFwd(n.path));
}

function underRoots(file, roots) {
  return (roots || []).some((r) => { const b = toFwd(r).replace(/\/$/, ''); return file === b || file.startsWith(b + '/'); });
}

function inScope(scope, file, ctx) {
  if (scope === 'universal') return true;
  if (scope === 'test-covered') return ctx.covered.has(file);
  if (scope === 'layer-roots') return underRoots(file, ctx.layerRoots);
  if (scope === 'contexts') return underRoots(file, ctx.ctxRoots);
  return false;
}

function buildReport(manifest, files, ctx) {
  const active = (manifest.sensors || []).filter((s) => (s.status || 'active') !== 'planned');
  const fileSensors = active.filter((s) => FILE_SCOPES.has(s.scope));
  const perAxis = {};
  for (const axis of AXES) {
    const ax = fileSensors.filter((s) => s.axis === axis);
    const holes = files.filter((f) => !ax.some((s) => inScope(s.scope, f, ctx)));
    perAxis[axis] = {
      sensors: ax.map((s) => s.id),
      total: files.length,
      covered: files.length - holes.length,
      pct: files.length ? Math.round(((files.length - holes.length) / files.length) * 100) : 0,
      holes,
    };
  }
  const nonFileMapping = {};
  for (const s of active.filter((s) => !FILE_SCOPES.has(s.scope))) {
    (nonFileMapping[s.scope] = nonFileMapping[s.scope] || []).push(s.id);
  }
  return { files: files.length, perAxis, nonFileMapping };
}

function renderMd(r) {
  const lines = [`# Harness coverage`, ``, `Source files: ${r.files}`, ``, `| Axis | Coverage | Sensors | Holes |`, `|---|---|---|---|`];
  for (const axis of AXES) {
    const a = r.perAxis[axis];
    lines.push(`| ${axis} | ${a.pct}% (${a.covered}/${a.total}) | ${a.sensors.join(', ') || '—'} | ${a.holes.length} |`);
  }
  for (const axis of AXES) {
    const a = r.perAxis[axis];
    if (a.holes.length) {
      lines.push('', `## Ungoverned — ${axis} (${a.holes.length})`, ...a.holes.slice(0, 50).map((f) => `- ${f}`));
      if (a.holes.length > 50) lines.push(`- … and ${a.holes.length - 50} more`);
    }
  }
  lines.push('', `## Non-file-mapping governance`);
  for (const [scope, ids] of Object.entries(r.nonFileMapping)) lines.push(`- **${scope}**: ${ids.join(', ')}`);
  return lines.join('\n') + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const manifest = readJson(arg(argv, '--manifest', path.join(__dirname, '..', '..', 'harness-manifest.json')));
  const graphPath = arg(argv, '--graph', path.join(root, 'specs', 'brownfield', 'code-graph.json'));
  const graph = readJson(graphPath);
  if (!graph) { process.stdout.write(`harness-coverage: no code-graph.json at ${graphPath} — run /code-map first.\n`); process.exit(0); }
  const projManifest = readJson(path.join(root, 'project-manifest.json')) || {};
  const arch = projManifest.architecture || {};
  const ctx = {
    covered: coveredSet(readJson(arg(argv, '--coverage', path.join(root, 'coverage', 'coverage-summary.json')))),
    layerRoots: arch.layer_roots || [],
    ctxRoots: (arch.contexts && arch.contexts.roots) || [],
  };
  const report = buildReport(manifest, sourceFiles(graph), ctx);
  const outDir = path.join(root, 'specs', 'harness-coverage');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'harness-coverage.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'harness-coverage.md'), renderMd(report));
  const zeroAxis = AXES.find((a) => report.perAxis[a].total > 0 && report.perAxis[a].pct === 0);
  process.stdout.write(`harness-coverage: ${report.files} files; ` + AXES.map((a) => `${a} ${report.perAxis[a].pct}%`).join(', ') + '\n');
  process.exit(argv.includes('--check') && zeroAxis ? 1 : 0);
}

main();
```

(If the pre-write 30-line cap trips `main` or `buildReport`/`renderMd`, extract a small helper; keep behavior/exit codes identical.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/harness-coverage.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the npm script**

In `package.json`, add to `scripts` (next to `"drift"`):

```json
    "harness-coverage": "node .claude/scripts/harness-coverage.js",
```

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/harness-coverage.js test/harness-coverage.test.js package.json
git commit -m "feat(g11): harness-coverage.js — per-axis coverage report from manifest scopes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Docs + surface + validate

**Files:**
- Modify: `HARNESS.md`
- Modify: `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`
- Test: `test/harness-coverage.test.js` (append wiring assertion)

**Interfaces:**
- Consumes: `harness-coverage.js` + the `harness-coverage` npm script.

- [ ] **Step 1: Write the failing test (append to `test/harness-coverage.test.js`)**

```javascript
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G11: harness-coverage is surfaced + scripted', () => {
  assert.strictEqual(JSON.parse(rd('package.json')).scripts['harness-coverage'], 'node .claude/scripts/harness-coverage.js');
  assert.ok(/harness-coverage/.test(rd('HARNESS.md')), 'HARNESS.md must document harness coverage');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/harness-coverage.test.js`
Expected: FAIL — HARNESS.md not updated yet.

- [ ] **Step 3: Update `HARNESS.md`**

Add a subsection after "The current holes" (or near the matrix), and update the holes line:

```
## Harness coverage (G11)

`harness-coverage.js` (`npm run harness-coverage`) makes this registry measurable: it maps each source file in a project's `code-graph.json` against the active sensors' `scope` field and reports per-axis coverage % + the ungoverned holes (files with no scoped sensor on an axis). Runtime / dependency / artifact / repo-wide sensors are reported separately. Report-only; run it on a cadence via `/schedule`.
```

Change the holes line from `G11–G12 (P2)` to:

```
- ~~**G11**~~ ✅ **done** — `harness-coverage.js` reports per-axis coverage from the sensors' `scope` field (`npm run harness-coverage`). Remaining: **G12 (P2)** — behaviour extras (oasdiff contract-drift, default a11y, flake detection).
```

- [ ] **Step 4: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, change the G11 row status from `Missing | **P2**` to:

```
| ✅ **DONE** — `harness-coverage.js` maps source files against the sensors' validated `scope` field and reports per-axis coverage % + ungoverned holes (`npm run harness-coverage`); report-only. | **P2** |
```

In the §5 roadmap Phase 3 list, mark G11 complete.

- [ ] **Step 5: Run the new test + validator + full suite**

Run: `node --test test/harness-coverage.test.js`
Expected: PASS (4 tests).
Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: OK.
Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|cancelled)"`
Expected: `fail 0`, `cancelled 0` (or only the known scaffold/skills open-handle cancellations — report explicitly if so; do not loop npm test).

- [ ] **Step 6: Commit**

```bash
git add HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/harness-coverage.test.js
git commit -m "feat(g11): document harness-coverage; mark G11 done

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 scope vocabulary + validator enforcement + per-sensor assignment → Task 1. ✅
- §2 harness-coverage.js reader (inputs, file-mapping resolution, per-axis %, holes, non-file-mapping split) → Task 2. ✅
- §3 outputs (.md + .json, graceful no-graph, exit 0 / --check, no silent truncation via the `… and N more` line) → Task 2. ✅
- §4 npm script + surface → Task 2 (script) + Task 3 (HARNESS.md). ✅
- §5 registry (scope is the footprint, no fake entry) + HARNESS/gap-doc → Tasks 1 + 3. ✅
- §6 tests (validator scope enforcement, fixture coverage report incl. holes + runtime-separate + no-graph, wiring, full suite) → Tasks 1–3. ✅

**Placeholder scan:** No TBD/TODO; full code in every step; commands have expected output; the per-sensor scope assignment is a complete rule + the validator/test guarantee completeness. ✅

**Type/name consistency:** the `scope` vocabulary set is identical in the validator (Task 1 Step 3), the manifest test (Task 1 Step 1), and `FILE_SCOPES` (Task 2). The report JSON shape (`{files, perAxis: {<axis>: {sensors, total, covered, pct, holes}}, nonFileMapping: {<scope>: [ids]}}`) is identical in `buildReport` and the Task 2/3 tests (`report.perAxis.maintainability.pct`, `report.nonFileMapping.runtime`). Flags `--root`/`--manifest`/`--graph`/`--coverage`/`--check` consistent. ✅

**Test growth note:** `test/harness-coverage.test.js` is created in Task 2 (3 tests) and appended in Task 3 (→4). `test/harness-manifest.test.js` gains 2 tests in Task 1.
