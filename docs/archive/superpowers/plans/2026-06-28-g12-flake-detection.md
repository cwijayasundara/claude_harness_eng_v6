# G12 Flake Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal flake detector that runs a test command N times, parses node:test TAP per run, and reports tests that both passed and failed across runs — completing G12.

**Architecture:** A `flake-detector.js` with two pure functions (`parseTap`, `aggregateFlakes`) wrapped by a CLI that spawns the test command N times. Drift cadence, opt-in (`npm run flakes`), non-blocking — never a `/gate` or `/auto` gate. Errored runs (timeout / no parseable TAP) are excluded from aggregation.

**Tech Stack:** Node.js (`node:test`, `child_process`); the harness registry.

## Global Constraints

- **Per-test:** parse node:test TAP (`ok N - name` / `not ok N - name`); a test that is both `ok` (≥1 run) and `not ok` (≥1 run) is a flake.
- **Exit codes:** `0` no flakes; `1` flakes found; `2` no run produced parseable results (WARN — couldn't run).
- **Errored runs** (timeout via `--timeout`, or zero parsed tests) are counted separately and **excluded** from `aggregateFlakes`.
- **Defaults:** `--test-cmd` `npm test`, `--runs` 5, `--timeout` 600000 ms, `--out` `specs/reports/flake-report.json`, `--root` cwd.
- **Drift cadence, opt-in, non-blocking** — NOT wired into `/gate` or `/auto`. Manifest sensor `cadence: "drift"`, `scope: "repo"`, `axis: "behaviour"`.
- **EXCLUDE:** k6/load-flake, quarantine DB, CI-matrix retry, auto-retry-wrapping the real suite, statistical scoring, cross-run history/trend, gate/auto wiring.
- **`module.exports = { parseTap, aggregateFlakes }` BEFORE the `require.main` guard.**
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `.claude/scripts/flake-detector.js` + `test/flake-detector.test.js` (Task 1).
- **Modify** `package.json` — `flakes` script (Task 1).
- **Modify** `harness-manifest.json`, `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` (Task 2).

---

### Task 1: `flake-detector.js` + tests + npm script

**Files:**
- Create: `.claude/scripts/flake-detector.js`, `test/flake-detector.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseTap(stdout)→{name:'ok'|'not ok'}`, `aggregateFlakes(perRun)→[{name,passed,failed}]` (exported); a CLI writing `specs/reports/flake-report.json` and exiting 0/1/2.

- [ ] **Step 1: Write the failing test**

Create `test/flake-detector.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'flake-detector.js');
const { parseTap, aggregateFlakes } = require('../.claude/scripts/flake-detector.js');

test('parseTap reads ok/not ok lines, strips directives, ignores plan/comments', () => {
  const tap = 'TAP version 13\n1..2\nok 1 - a\nnot ok 2 - b # AssertionError\n# a comment\n';
  assert.deepStrictEqual(parseTap(tap), { a: 'ok', b: 'not ok' });
});

test('aggregateFlakes flags a test that both passed and failed', () => {
  const perRun = [{ t: 'ok' }, { t: 'not ok' }, { t: 'ok' }, { s: 'ok' }];
  const flakes = aggregateFlakes(perRun);
  assert.deepStrictEqual(flakes, [{ name: 't', passed: 2, failed: 1 }]); // s is consistent -> not a flake
});

// CLI: a deterministically-flaky fake command (alternates ok/not ok by a counter file).
function flakyFake(dir) {
  const p = path.join(dir, 'flaky.sh');
  fs.writeFileSync(p,
    '#!/bin/sh\n' +
    'C=$(cat "$PWD/counter" 2>/dev/null || echo 0)\n' +
    'echo $((C+1)) > "$PWD/counter"\n' +
    'echo "TAP version 13"; echo "1..1"\n' +
    'if [ $((C % 2)) -eq 0 ]; then echo "ok 1 - flaky test"; else echo "not ok 1 - flaky test"; fi\n');
  return p;
}

function runDetector(dir, testCmd, runs) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir, '--test-cmd', testCmd, '--runs', String(runs)], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reports', 'flake-report.json'), 'utf8'));
  return { code, r };
}

test('CLI detects a flaky test across runs -> exit 1, names it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const { code, r } = runDetector(dir, `sh ${flakyFake(dir)}`, 4);
  assert.strictEqual(code, 1);
  assert.strictEqual(r.flakes.length, 1);
  assert.strictEqual(r.flakes[0].name, 'flaky test');
  assert.strictEqual(r.all_consistent, false);
});

test('CLI on a deterministic-pass command -> exit 0, no flakes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const stable = path.join(dir, 'stable.sh');
  fs.writeFileSync(stable, '#!/bin/sh\necho "TAP version 13"; echo "1..1"; echo "ok 1 - stable"\n');
  const { code, r } = runDetector(dir, `sh ${stable}`, 3);
  assert.strictEqual(code, 0);
  assert.strictEqual(r.flakes.length, 0);
  assert.strictEqual(r.all_consistent, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flake-detector.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/flake-detector.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Flake detection (gap G12, slice 4). Runs a test command N times, parses
// node:test TAP per run, and reports tests that BOTH passed and failed across
// runs (flakes). Drift cadence, opt-in (npm run flakes / /schedule), non-
// blocking — never a /gate or /auto gate. Errored runs (timeout / no parseable
// TAP) are excluded from aggregation.
//
// CLI: node .claude/scripts/flake-detector.js [--test-cmd CMD] [--runs N]
//        [--timeout MS] [--out FILE] [--root DIR]
// Exit 0 = no flakes; 1 = flakes found; 2 = no run produced parseable results.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

// node:test TAP: `ok N - name` / `not ok N - name` (strip a trailing ` # directive`).
function parseTap(stdout) {
  const out = {};
  for (const line of String(stdout).split('\n')) {
    const m = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.*)$/);
    if (!m) continue;
    const name = m[2].replace(/\s+#.*$/, '').trim();
    if (name) out[name] = m[1];
  }
  return out;
}

// A test is a flake iff it passed in >=1 run AND failed in >=1 run.
function aggregateFlakes(perRun) {
  const pass = {};
  const fail = {};
  for (const run of perRun) {
    for (const [name, status] of Object.entries(run)) {
      if (status === 'ok') pass[name] = (pass[name] || 0) + 1;
      else fail[name] = (fail[name] || 0) + 1;
    }
  }
  const flakes = [];
  for (const name of new Set([...Object.keys(pass), ...Object.keys(fail)])) {
    if ((pass[name] || 0) > 0 && (fail[name] || 0) > 0) flakes.push({ name, passed: pass[name], failed: fail[name] });
  }
  return flakes.sort((a, b) => (a.name < b.name ? -1 : 1));
}

function runOnce(cmd, root, timeout) {
  const res = spawnSync(cmd, { cwd: root, shell: true, timeout, encoding: 'utf8' });
  if (res.error || res.signal === 'SIGTERM') return null; // spawn error or timeout -> errored run
  const map = parseTap((res.stdout || '') + '\n' + (res.stderr || ''));
  return Object.keys(map).length ? map : null;
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const cmd = arg(argv, '--test-cmd', 'npm test');
  const runs = parseInt(arg(argv, '--runs', '5'), 10);
  const timeout = parseInt(arg(argv, '--timeout', '600000'), 10);
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reports', 'flake-report.json'));
  const perRun = [];
  let errored = 0;
  for (let i = 0; i < runs; i++) {
    const map = runOnce(cmd, root, timeout);
    if (map) perRun.push(map); else errored++;
  }
  const flakes = aggregateFlakes(perRun);
  const report = { runs, completed_runs: perRun.length, errored_runs: errored, flakes, all_consistent: flakes.length === 0 };
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  } catch (e) { process.stderr.write(`flake-detector: could not write report: ${e.message}\n`); }
  process.stdout.write(`flake-detector: ${flakes.length} flake(s) over ${perRun.length}/${runs} completed runs (${errored} errored)` + (flakes.length ? ': ' + flakes.map((f) => f.name).join(', ') : '') + '\n');
  process.exit(perRun.length === 0 ? 2 : flakes.length > 0 ? 1 : 0);
}

module.exports = { parseTap, aggregateFlakes };

if (require.main === module) main();
```

(If the pre-write 30-line cap trips `main`, extract the run loop into a small `runAll(cmd, root, timeout, runs)` helper; keep behavior/exit codes identical.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/flake-detector.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, add (next to `"drift"`):

```json
    "flakes": "node .claude/scripts/flake-detector.js",
```

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/flake-detector.js test/flake-detector.test.js package.json
git commit -m "feat(g12): flake-detector.js — N-run TAP flake detection (npm run flakes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Registry + docs (completes G12)

**Files:**
- Modify: `harness-manifest.json`, `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`
- Test: `test/flake-detector.test.js` (append wiring assertion)

**Interfaces:**
- Consumes: `flake-detector.js` + the `flakes` npm script from Task 1.
- Produces: `flake-detection` sensor `active`, `cadence:"drift"`, `scope:"repo"`, `wired_at` resolves.

- [ ] **Step 1: Write the failing test (append to `test/flake-detector.test.js`)**

```javascript
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G12: flake-detection is scripted + registered active (drift cadence)', () => {
  assert.strictEqual(JSON.parse(rd('package.json')).scripts.flakes, 'node .claude/scripts/flake-detector.js');
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'flake-detection');
  assert.ok(s, 'flake-detection sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.cadence, 'drift');
  assert.strictEqual(s.scope, 'repo');
  assert.ok(s.wired_at && fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flake-detector.test.js`
Expected: FAIL — sensor not registered.

- [ ] **Step 3: Register the sensor in `harness-manifest.json`**

Add to the `sensors` array:

```json
    { "id": "flake-detection", "axis": "behaviour", "type": "computational", "cadence": "drift", "status": "active", "scope": "repo", "wired_at": ".claude/scripts/flake-detector.js", "gap_ref": "G12", "signal": "tests that pass and fail across repeated runs", "description": "Flake detection (gap G12): flake-detector.js runs a test command N times (npm run flakes), parses node:test TAP per run, and reports tests that both passed and failed across runs. Drift cadence — opt-in / /schedule, non-blocking (exit 1 on flakes for cron/CI signal); deliberately NOT a /gate or /auto gate, since a genuine flake should not block the change lifecycle. Errored/timed-out runs are excluded from aggregation." }
```

- [ ] **Step 4: Run validator + test**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`
Run: `node --test test/flake-detector.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Update `HARNESS.md`**

In the **Behaviour** *Sensors* cell, add `· ✅ **flake detection** (N× re-run, drift cadence, G12)`.

Replace the G12 holes line with a completion line:

```
- ~~**G12 (P2)**~~ ✅ **done** (all 4 slices) — API contract-drift (`oasdiff`), default-on axe/WCAG, approved-fixtures (snapshot-oracle lock), and flake detection (N× re-run). **G1–G12 are now all closed** (open follow-ons: the recorded approved-fixtures minors + a P3 flake-history trend).
```

- [ ] **Step 6: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, change the G12 row status to ✅ **DONE** (list all four slices: oasdiff, default-on axe/WCAG, approved-fixtures, flake detection). In the §5 roadmap, mark G12 complete and note the full G1–G12 roadmap is shipped.

- [ ] **Step 7: Run the new test + full suite**

Run: `node --test test/flake-detector.test.js`
Expected: PASS (5 tests).
Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|cancelled)"`
Expected: `fail 0`, `cancelled 0` (or only the known scaffold/skills open-handle cancellations — report explicitly; do not loop npm test).

- [ ] **Step 8: Commit**

```bash
git add harness-manifest.json HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/flake-detector.test.js
git commit -m "feat(g12): register flake-detection sensor active; G12 complete (G1-G12 closed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 detector (`parseTap`, `aggregateFlakes`, CLI runs/timeout/exit/errored-excluded) → Task 1 + tests. ✅
- §2 npm script + opt-in/non-blocking → Task 1 Step 5 (no /gate wiring — correct). ✅
- §3 registry (`flake-detection` drift/repo) + HARNESS + gap-doc (G12 done) → Task 2. ✅
- §4 tests (parseTap unit, aggregateFlakes unit, CLI flaky→exit1, CLI stable→exit0, wiring) → Tasks 1–2; hermetic via the counter-file fake. ✅
- Risks: errored runs excluded (runOnce returns null on timeout/no-TAP, perRun only gets parsed maps); fake never touches the real suite; exit 2 when all runs errored. ✅

**Placeholder scan:** No TBD/TODO; full code in every step; commands have expected output. ✅

**Type/name consistency:** `parseTap`/`aggregateFlakes` signatures identical in Task 1 impl, exports, and tests; report shape `{runs, completed_runs, errored_runs, flakes:[{name,passed,failed}], all_consistent}` consistent in impl + tests; `flake-detection` id + `cadence:"drift"` + `scope:"repo"` identical in Task 2 manifest + wiring test. ✅

**Test growth note:** `test/flake-detector.test.js` is created in Task 1 (4 tests) and appended in Task 2 (→5).
