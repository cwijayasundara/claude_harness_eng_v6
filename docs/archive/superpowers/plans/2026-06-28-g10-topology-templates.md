# G10 Per-Topology Harness Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/scaffold` resolve a named topology (`web-app` / `api-service` / `cli-or-library`) and apply a coherent preset of existing manifest knobs, replacing the implicit `lite`/projectType branching in `buildManifest`.

**Architecture:** A data-driven `topologies.js` registry maps a topology id to its knob posture (model_tier, ceremony, verification mode, observability on/off, architecture). `buildManifest` resolves the topology from the existing `isLiteShaped`/stack signals, reads the preset, and records `manifest.topology`. Behavior is preserved for all three shapes (existing scaffold/manifest tests are the guard).

**Tech Stack:** Node.js (`node:test`); the scaffold renderer (`scaffold-render.js`); the harness registry (`harness-manifest.json` + `validate-harness-manifest.js`).

## Global Constraints

- **Three topologies only:** `web-app`, `api-service`, `cli-or-library`. No JVM/Go/event-processor presets.
- **Presets existing manifest knobs only** — `model_tier`, `ceremony`, `verification` mode, `observability.enabled`, `architecture`. No new control types or thresholds.
- **Behavior-preserving:** for each shape the emitted manifest must be byte-identical to today's output, except the new `manifest.topology` label. In particular, for not-lite shapes `architecture` stays **omitted** (so `layers.js` defaults apply, as today); only `cli-or-library` sets `architecture: { enabled: false }`.
- **`resolveTopology(profile, lite)`** takes the already-computed `lite` flag (no dependency cycle with `isLiteShaped`). `cli-or-library` ⇔ `lite === true`, guaranteeing the lite path and the topology never diverge.
- **Manifest stays per-project overridable:** `profile.modelTier` / `profile.ceremony` / `profile.verificationMode` still win over the preset.
- **Manifest honesty:** every `active` manifest entry's `wired_at` resolves; `node .claude/scripts/validate-harness-manifest.js` must pass.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `.claude/scripts/topologies.js` — the `TOPOLOGIES` registry + `resolveTopology` + `topologyPreset` (Task 1).
- **Create** `test/topologies.test.js` — unit tests + buildManifest regression; grows across Tasks 1–3.
- **Modify** `.claude/scripts/scaffold-render.js` — `observabilityBlock` signature + `buildManifest` reads the preset (Task 2).
- **Modify** `.claude/commands/scaffold.md` — surface the detected topology (Task 3).
- **Modify** `harness-manifest.json` — `topology-templates` guide active (Task 3).
- **Modify** `HARNESS.md` — Architecture guides cell + holes line (Task 3).
- **Modify** `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` — G10 row + roadmap (Task 3).

---

### Task 1: `topologies.js` registry + resolver

**Files:**
- Create: `.claude/scripts/topologies.js`
- Test: `test/topologies.test.js`

**Interfaces:**
- Produces: `resolveTopology(profile, lite) -> 'web-app'|'api-service'|'cli-or-library'`; `topologyPreset(id) -> { lite, model_tier, ceremony, verification_mode, observability_enabled, architecture, summary }` (throws on unknown id); `TOPOLOGIES` map. CommonJS `module.exports`.

- [ ] **Step 1: Write the failing test**

Create `test/topologies.test.js`:

```javascript
'use strict';

// Contract for gap G10: per-topology harness templates. /scaffold resolves a
// named topology and presets a coherent bundle of existing manifest knobs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { resolveTopology, topologyPreset, TOPOLOGIES } = require('../.claude/scripts/topologies.js');

test('resolveTopology: lite -> cli-or-library', () => {
  assert.strictEqual(resolveTopology({ stack: { frontend: { framework: 'react' } } }, true), 'cli-or-library');
});

test('resolveTopology: not-lite with a frontend -> web-app', () => {
  assert.strictEqual(resolveTopology({ stack: { backend: {}, frontend: { framework: 'react' } } }, false), 'web-app');
});

test('resolveTopology: not-lite, no frontend -> api-service', () => {
  assert.strictEqual(resolveTopology({ stack: { backend: { framework: 'FastAPI' } } }, false), 'api-service');
});

test('topologyPreset: server topologies enable observability, lite disables it', () => {
  assert.strictEqual(topologyPreset('web-app').observability_enabled, true);
  assert.strictEqual(topologyPreset('api-service').observability_enabled, true);
  assert.strictEqual(topologyPreset('cli-or-library').observability_enabled, false);
});

test('topologyPreset: only cli-or-library sets an architecture override', () => {
  assert.strictEqual(topologyPreset('web-app').architecture, undefined);
  assert.deepStrictEqual(topologyPreset('cli-or-library').architecture, { enabled: false });
});

test('topologyPreset: unknown id throws (loud failure)', () => {
  assert.throws(() => topologyPreset('crud-on-jvm'), /Unknown topology/);
});

test('TOPOLOGIES has exactly the three supported topologies', () => {
  assert.deepStrictEqual(Object.keys(TOPOLOGIES).sort(), ['api-service', 'cli-or-library', 'web-app']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/topologies.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/topologies.js`:

```javascript
'use strict';

// Per-topology harness templates (gap G10). Resolves a scaffold profile to a
// named topology and the coherent preset of manifest knobs it implies, so
// /scaffold applies topology-aware defaults (Ashby's-Law variety reduction)
// instead of one uniform manifest. Drop-in extensible: add a TOPOLOGIES entry
// and a resolveTopology clause. The manifest stays per-project overridable.
//
// Knobs preset per topology (existing manifest fields only):
//   - model_tier / ceremony  (execution posture)
//   - verification_mode       (how /evaluate reaches the app; undefined -> docker default)
//   - observability_enabled   (gates the observability guide + runtime-SLO sensor)
//   - architecture            (undefined -> layers.js defaults apply; {enabled:false} -> off)

const SERVER = {
  lite: false, model_tier: 'balanced', ceremony: 'full',
  verification_mode: undefined, observability_enabled: true, architecture: undefined,
};

const TOPOLOGIES = {
  'web-app': {
    ...SERVER,
    summary: 'layered architecture · observability · docker verify · full ceremony · balanced model tier',
  },
  'api-service': {
    ...SERVER,
    summary: 'layered architecture · observability · docker verify · full ceremony · balanced model tier (no UI)',
  },
  'cli-or-library': {
    lite: true, model_tier: 'cost', ceremony: 'trimmed',
    verification_mode: 'B', observability_enabled: false, architecture: { enabled: false },
    summary: 'no layer enforcement · no observability · local verify · trimmed ceremony · cost model tier',
  },
};

// `lite` is computed by scaffold-render's isLiteShaped and passed in, so the
// lite path and the cli-or-library topology can never diverge.
function resolveTopology(profile, lite) {
  if (lite) return 'cli-or-library';
  const stack = profile.stack || {};
  if (stack.frontend) return 'web-app';
  return 'api-service';
}

function topologyPreset(id) {
  if (!Object.prototype.hasOwnProperty.call(TOPOLOGIES, id)) {
    throw new Error(`Unknown topology: ${id}`);
  }
  return TOPOLOGIES[id];
}

module.exports = { TOPOLOGIES, resolveTopology, topologyPreset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/topologies.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/topologies.js test/topologies.test.js
git commit -m "feat(g10): topologies registry + resolveTopology (web-app/api-service/cli-or-library)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `buildManifest` reads the topology preset

**Files:**
- Modify: `.claude/scripts/scaffold-render.js` (`observabilityBlock`, `buildManifest`)
- Test: `test/topologies.test.js` (append regression tests)

**Interfaces:**
- Consumes: `resolveTopology`, `topologyPreset` from Task 1.
- Produces: `buildManifest(profile)` now includes `manifest.topology` and derives `execution.model_tier`/`ceremony`, `verification`, `observability.enabled`, and `architecture` from the preset. Output is byte-identical to today for each shape except the added `topology` field.

- [ ] **Step 1: Write the failing test (append to `test/topologies.test.js`)**

```javascript
const { buildManifest } = require('../.claude/scripts/scaffold-render.js');

test('buildManifest: web-app profile gets the server preset + topology label', () => {
  const m = buildManifest({ projectType: 'A', name: 'shop',
    stack: { backend: { language: 'python', framework: 'FastAPI' }, frontend: { framework: 'react' }, database: { primary: 'postgresql' } } });
  assert.strictEqual(m.topology, 'web-app');
  assert.strictEqual(m.observability.enabled, true);
  assert.strictEqual(m.verification.mode, 'docker');
  assert.strictEqual(m.execution.model_tier, 'balanced');
  assert.strictEqual(m.execution.ceremony, 'full');
  assert.strictEqual(m.architecture, undefined); // not-lite: layers.js defaults apply, no key
});

test('buildManifest: backend-only projectType C -> api-service', () => {
  const m = buildManifest({ projectType: 'C', name: 'svc',
    stack: { backend: { language: 'python', framework: 'FastAPI' } } });
  assert.strictEqual(m.topology, 'api-service');
  assert.strictEqual(m.observability.enabled, true);
  assert.strictEqual(m.verification.mode, 'docker');
  assert.strictEqual(m.stack.frontend, null);
});

test('buildManifest: lite projectType D -> cli-or-library, knobs off', () => {
  const m = buildManifest({ projectType: 'D', name: 'tool', stack: { backend: { language: 'python' } } });
  assert.strictEqual(m.topology, 'cli-or-library');
  assert.strictEqual(m.observability.enabled, false);
  assert.deepStrictEqual(m.architecture, { enabled: false });
  assert.strictEqual(m.execution.model_tier, 'cost');
  assert.strictEqual(m.execution.ceremony, 'trimmed');
  assert.strictEqual(m.verification.mode, 'local');
});

test('buildManifest: explicit profile fields still override the preset', () => {
  const m = buildManifest({ projectType: 'D', name: 't', modelTier: 'max-quality', ceremony: 'full',
    stack: { backend: { language: 'python' } } });
  assert.strictEqual(m.execution.model_tier, 'max-quality');
  assert.strictEqual(m.execution.ceremony, 'full');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/topologies.test.js`
Expected: FAIL — `m.topology` is undefined.

- [ ] **Step 3: Change `observabilityBlock` to take an explicit enabled flag**

In `.claude/scripts/scaffold-render.js`, replace the `observabilityBlock` function with:

```javascript
// G9: app-level observability baseline. `enabled` is decided by the topology
// preset (G10) AND-ed with the presence of a backend to instrument.
function observabilityBlock(enabled) {
  return {
    enabled: !!enabled,
    metrics_path: '/metrics',
    red_labels: ['method', 'route', 'status'],
    slo: { error_rate_pct: 1.0, p95_ms: 500 },
  };
}
```

- [ ] **Step 4: Rewire `buildManifest` to read the preset**

In `.claude/scripts/scaffold-render.js`, add the require near the top (with the other requires):

```javascript
const { resolveTopology, topologyPreset } = require('./topologies.js');
```

Replace the body of `buildManifest` with:

```javascript
function buildManifest(profile) {
  const stack = profile.stack || {};
  const lite = isLiteShaped(profile);
  const topology = resolveTopology(profile, lite);
  const preset = topologyPreset(topology);
  const manifest = {
    name: profile.name || 'untitled-project',
    description: profile.description || '',
    stack: { backend: stack.backend || null, frontend: stack.frontend || null, database: stack.database || null },
    lsp: { servers: lspServers(profile) },
    evaluation: evaluationBlock(),
    execution: {
      default_mode: 'full',
      model_tier: profile.modelTier || preset.model_tier,
      ceremony: profile.ceremony || preset.ceremony,
      session_chaining: true, teammate_model: 'sonnet',
    },
    verification: verificationBlock(profile.verificationMode || preset.verification_mode),
    topology,
  };
  manifest.observability = observabilityBlock(preset.observability_enabled && !!stack.backend);
  if (Array.isArray(profile.frameworkPacks) && profile.frameworkPacks.length) {
    manifest.framework_skill_packs = profile.frameworkPacks;
  }
  if (preset.architecture) {
    manifest.architecture = preset.architecture;
  }
  return manifest;
}
```

(This preserves today's output: lite → `cli-or-library` preset gives cost/trimmed/local + observability off + `architecture:{enabled:false}`; not-lite → balanced/full/docker + observability on + no `architecture` key.)

- [ ] **Step 5: Run the new test + the existing regression guards**

Run: `node --test test/topologies.test.js`
Expected: PASS (11 tests total).
Run: `node --test test/scaffold-render.test.js test/project-manifest-contract.test.js test/scaffold-command.test.js test/layers-config.test.js`
Expected: PASS — behavior preserved (no pre-existing manifest test breaks). If `project-manifest-contract.test.js` fails ONLY because it asserts an exact key set that now includes `topology`, update that assertion to include the new optional field (a deliberate, reviewed change); if it fails for any other reason, the refactor changed behavior — fix the preset to match the old output.

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/scaffold-render.js test/topologies.test.js
git commit -m "feat(g10): buildManifest applies the topology preset + records manifest.topology

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Surface + registry + docs flip + validate

**Files:**
- Modify: `.claude/commands/scaffold.md` (surface the topology)
- Modify: `harness-manifest.json` (`topology-templates` guide)
- Modify: `HARNESS.md` (Architecture guides cell + holes line)
- Modify: `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` (G10 row + roadmap)
- Test: `test/topologies.test.js` (append wiring assertion)

**Interfaces:**
- Consumes: `topologies.js` (the guide's `wired_at` target).
- Produces: `topology-templates` guide `status: active`.

- [ ] **Step 1: Write the failing test (append to `test/topologies.test.js`)**

```javascript
test('G10: topology-templates guide is registered active and wired', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const g = m.guides.find((x) => x.id === 'topology-templates');
  assert.ok(g, 'topology-templates guide must exist');
  assert.strictEqual(g.status, 'active');
  assert.strictEqual(g.gap_ref, 'G10');
  assert.ok(g.wired_at && fs.existsSync(path.join(ROOT, g.wired_at)), 'wired_at must resolve');
});

test('G10: scaffold.md surfaces the detected topology', () => {
  assert.ok(/topology/i.test(read('.claude/commands/scaffold.md')), 'scaffold.md must mention topology');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/topologies.test.js`
Expected: FAIL — guide not registered; scaffold.md unchanged.

- [ ] **Step 3: Register the guide in `harness-manifest.json`**

In `harness-manifest.json`, add to the `guides` array (after the `observability-conventions` guide):

```json
    { "id": "topology-templates", "axis": "architecture", "kind": "feedforward", "wired_at": ".claude/scripts/topologies.js", "status": "active", "gap_ref": "G10", "description": "Per-topology harness templates (gap G10): /scaffold resolves a detected topology (web-app / api-service / cli-or-library) and presets a coherent bundle of existing manifest knobs (architecture, observability, verification, ceremony, model_tier) via the TOPOLOGIES registry, instead of a uniform default. Ashby's-Law variety reduction; drop-in extensible; the manifest stays per-project overridable." }
```

- [ ] **Step 4: Surface the topology in `scaffold.md`**

In `.claude/commands/scaffold.md`, in the step that reports the generated manifest (Step 2 / the scaffold summary), add a line:

```
- **Topology:** the manifest records a detected `topology` (`web-app` / `api-service` / `cli-or-library`) and applies its preset bundle of harness knobs (architecture, observability, verification mode, ceremony, model tier). Print the detected topology and its `summary` (from `.claude/scripts/topologies.js`) in the scaffold report, e.g. "Detected topology: web-app → layered architecture · observability · docker verify · full ceremony · balanced model tier." Every field stays overridable in `project-manifest.json`.
```

- [ ] **Step 5: Run validator + test**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`
Run: `node --test test/topologies.test.js`
Expected: PASS (13 tests total).

- [ ] **Step 6: Update `HARNESS.md`**

In `HARNESS.md`, in the **Architecture** matrix row Guides cell, add `· ✅ **topology-templates** (per-topology manifest-knob presets, G10)`.

In the holes list, change the `G10–G12` line to:

```
- ~~**G10**~~ ✅ **done** — `/scaffold` resolves a named topology (web-app / api-service / cli-or-library) and presets the manifest-knob bundle via `topologies.js` (Ashby's-Law variety reduction). Remaining: **G11–G12 (P2)** — a harness-coverage metric and behaviour extras.
```

- [ ] **Step 7: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, change the G10 row status from `Missing | **P2**` to:

```
| ✅ **DONE** — `topologies.js` registry resolves web-app / api-service / cli-or-library and presets the manifest-knob bundle in `buildManifest` (behavior-preserving refactor of the implicit lite/projectType branching; drop-in extensible). | **P2** |
```

In the §5 roadmap Phase 3 list, mark G10 complete.

- [ ] **Step 8: Run the full suite**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|cancelled)"`
Expected: `fail 0`, `cancelled 0`, count up by the new tests.

- [ ] **Step 9: Commit**

```bash
git add harness-manifest.json .claude/commands/scaffold.md HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/topologies.test.js
git commit -m "feat(g10): register topology-templates guide active; surface + docs (G10 done)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 three topologies + knob table → Task 1 `TOPOLOGIES` + Task 2 buildManifest. ✅
- §2 topologies.js (`resolveTopology`/`topologyPreset`/`TOPOLOGIES`, unknown-id throw) → Task 1 + tests. ✅
- §3 buildManifest merge + `manifest.topology`, behavior-preserving, reuse helpers → Task 2 + regression guards. ✅
- §4 scaffold surfacing → Task 3 Step 4 + wiring test. ✅
- §5 registry/HARNESS/gap-doc → Task 3. ✅
- §6 tests (resolver, preset, unknown-id, buildManifest regression, existing tests green, validator, npm test) → Tasks 1–3. ✅
- Risks: behavior drift (Task 2 Step 5 runs the existing manifest tests as the pin); new `topology` field vs contract test (Task 2 Step 5 handles it explicitly); resolveTopology⇔isLiteShaped consistency (resolveTopology takes `lite` as input). ✅

**Placeholder scan:** No TBD/TODO; full code in every step; commands have expected output. ✅

**Type/name consistency:** `resolveTopology(profile, lite)`, `topologyPreset(id)`, `TOPOLOGIES`, and the preset fields (`model_tier`, `ceremony`, `verification_mode`, `observability_enabled`, `architecture`, `summary`) are identical across Task 1 def, Task 2 consumption, and the tests. `observabilityBlock(enabled)` new signature is defined and called consistently in Task 2. `manifest.topology` used identically in Task 2 impl and tests. ✅

**Test growth note:** `test/topologies.test.js` is created in Task 1 (7 tests) and appended in Task 2 (→11) and Task 3 (→13).
