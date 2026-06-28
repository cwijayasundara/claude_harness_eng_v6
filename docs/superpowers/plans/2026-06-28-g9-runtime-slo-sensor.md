# G9 Runtime-SLO Sensor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime-SLO sensor that scrapes a generated app's RED `/metrics` endpoint and flags 5xx error-rate over budget (FAIL) and p95 latency over an absolute budget (WARN), closing the G9 sensor-half.

**Architecture:** A pure `lib/prom-parse.js` parses Prometheus exposition text (error-rate %, p95 ms via histogram-quantile). A `scripts/slo-check.js` CLI resolves the target + budgets from `project-manifest.json#observability`, scrapes `/metrics` (or reads a `--fixture` file), compares to `observability.slo`, writes `specs/reviews/slo-verdict.json`, and exits 0/1/2. `/evaluate` folds the verdict in (app already booted); `npm run slo -- --url <live>` runs it standalone for the drift cadence.

**Tech Stack:** Node.js (`node:test`, native `fetch`); the harness registry (`harness-manifest.json` + `validate-harness-manifest.js`).

## Global Constraints

- **Error-rate counts only 5xx** (`status` label matches `/^5/`), expressed as a **percent (0–100)**; `null` when total requests == 0 (no traffic → not a breach).
- **p95 is reported in milliseconds**; the sensor checks it against an **absolute budget** only — p95 *regression* stays owned by `perf-baseline.js` (do not snapshot/diff p95).
- **Exit codes mirror `perf-baseline.js`:** `0` pass/disabled, `1` error-rate breach (FAIL), `2` p95-only / no-traffic / unreachable (WARN).
- **Budgets come from `project-manifest.json#observability.slo`** = `{ error_rate_pct, p95_ms }`; default `{ error_rate_pct: 1.0, p95_ms: 500 }` when absent.
- **Disabled when `observability.enabled === false`** → exit 0, verdict `disabled`.
- **`--fixture <file>`** makes `slo-check.js` read exposition text from a file instead of HTTP — the contract test MUST use it so no socket is opened (avoids the open-handle hang class).
- **`failure_layer: "slo"`** is the evaluator's name for an error-rate breach; FAIL in Full mode, WARN in Lean.
- **Manifest honesty:** every `active` manifest entry points at a real `wired_at` file; `node .claude/scripts/validate-harness-manifest.js` must pass.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `.claude/hooks/lib/prom-parse.js` — pure parser + error-rate + p95 (Task 1).
- **Create** `test/prom-parse.test.js` — unit tests for the lib (Task 1).
- **Create** `.claude/scripts/slo-check.js` — the CLI sensor (Task 2).
- **Create** `test/slo-check.test.js` — hermetic contract test via `--fixture` + temp manifest (Task 2).
- **Modify** `package.json` — add the `slo` script (Task 2).
- **Modify** `.claude/skills/evaluate/SKILL.md` — Performance Checks Step P4 (Task 3).
- **Modify** `.claude/agents/evaluator.md` — KEY RULES note for `failure_layer: "slo"` (Task 3).
- **Modify** `harness-manifest.json` — `runtime-slo` sensor active; update `drift_sensors_planned` (Task 4).
- **Modify** `HARNESS.md` — Behaviour sensors row + holes line (Task 4).
- **Modify** `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` — G9 row + roadmap (Task 4).

---

### Task 1: `prom-parse.js` pure lib + unit tests

**Files:**
- Create: `.claude/hooks/lib/prom-parse.js`
- Test: `test/prom-parse.test.js`

**Interfaces:**
- Produces: `parseProm(text) -> {name, labels:{}, value}[]`; `errorRate(series) -> number|null` (percent); `histogramP95(series) -> number|null` (ms). Exported via `module.exports`.

- [ ] **Step 1: Write the failing test**

Create `test/prom-parse.test.js`:

```javascript
'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { parseProm, errorRate, histogramP95 } = require('../.claude/hooks/lib/prom-parse.js');

const SAMPLE = `# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/items",status="200"} 90
http_requests_total{method="GET",route="/items",status="404"} 6
http_requests_total{method="POST",route="/items",status="500"} 4
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/items",le="0.1"} 50
http_request_duration_seconds_bucket{method="GET",route="/items",le="0.5"} 95
http_request_duration_seconds_bucket{method="GET",route="/items",le="1.0"} 100
http_request_duration_seconds_bucket{method="GET",route="/items",le="+Inf"} 100
http_request_duration_seconds_count{method="GET",route="/items"} 100`;

test('parseProm extracts name, labels, value and skips comments', () => {
  const s = parseProm(SAMPLE);
  const reqs = s.filter((x) => x.name === 'http_requests_total');
  assert.strictEqual(reqs.length, 3);
  assert.strictEqual(reqs[0].labels.status, '200');
  assert.strictEqual(reqs[0].value, 90);
});

test('errorRate counts only 5xx, as a percent', () => {
  // 4 of 100 are 5xx (the 404 must NOT count) -> 4%
  assert.strictEqual(errorRate(parseProm(SAMPLE)), 4);
});

test('errorRate returns null when there is no traffic', () => {
  assert.strictEqual(errorRate([]), null);
});

test('histogramP95 returns ms via bucket quantile', () => {
  // 0.95*100=95 crosses at le=0.5 bucket (cum 95); interpolates within (0.1,0.5]
  const p95 = histogramP95(parseProm(SAMPLE));
  assert.ok(p95 > 100 && p95 <= 500, `p95 ${p95} should be in (100,500] ms`);
});

test('histogramP95 returns null with no buckets', () => {
  assert.strictEqual(histogramP95([]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/prom-parse.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/lib/prom-parse.js`:

```javascript
'use strict';

// Pure Prometheus text-exposition parser for the runtime-SLO sensor (gap G9
// sensor-half). No I/O — fed raw text so it is unit-testable without a running
// app. Computes the two RED signals the product /metrics exposes: 5xx
// error-rate (percent) and p95 request latency (ms) via histogram-quantile.

function parseLabels(block) {
  const labels = {};
  if (!block) return labels;
  const inner = block.slice(1, -1); // strip { }
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

// Parse `name{labels} value` lines; skip blanks and # comments.
function parseProm(text) {
  const series = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(.+)$/);
    if (!m) continue;
    const value = Number(m[3]);
    if (!Number.isFinite(value)) continue;
    series.push({ name: m[1], labels: parseLabels(m[2]), value });
  }
  return series;
}

// 5xx error-rate as a percent (0-100). null when there is no traffic.
function errorRate(series) {
  let total = 0;
  let errors = 0;
  for (const s of series) {
    if (s.name !== 'http_requests_total') continue;
    total += s.value;
    if (/^5/.test(String(s.labels.status || ''))) errors += s.value;
  }
  if (total === 0) return null;
  return (errors / total) * 100;
}

// p95 latency in ms via Prometheus histogram-quantile over the cumulative
// *_bucket series (the `le` label). null when no buckets / no observations.
function histogramP95(series) {
  const buckets = [];
  let count = 0;
  for (const s of series) {
    if (s.name === 'http_request_duration_seconds_bucket' && s.labels.le != null) {
      buckets.push({ le: s.labels.le === '+Inf' ? Infinity : Number(s.labels.le), c: s.value });
    } else if (s.name === 'http_request_duration_seconds_count') {
      count += s.value;
    }
  }
  if (buckets.length === 0 || count === 0) return null;
  buckets.sort((a, b) => a.le - b.le);
  const rank = 0.95 * count;
  let prevLe = 0;
  let prevC = 0;
  for (const b of buckets) {
    if (b.c >= rank) {
      const upper = b.le === Infinity ? prevLe : b.le; // can't interpolate to +Inf
      const span = upper - prevLe;
      const frac = b.c > prevC ? (rank - prevC) / (b.c - prevC) : 0;
      return (prevLe + span * frac) * 1000; // seconds -> ms
    }
    if (b.le !== Infinity) { prevLe = b.le; }
    prevC = b.c;
  }
  return prevLe * 1000;
}

module.exports = { parseProm, parseLabels, errorRate, histogramP95 };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/prom-parse.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/prom-parse.js test/prom-parse.test.js
git commit -m "feat(g9): prom-parse lib — 5xx error-rate + p95 from /metrics text

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `slo-check.js` CLI + hermetic contract test

**Files:**
- Create: `.claude/scripts/slo-check.js`
- Create: `test/slo-check.test.js`
- Modify: `package.json` (add `slo` script)

**Interfaces:**
- Consumes: `../hooks/lib/prom-parse.js` (`parseProm`, `errorRate`, `histogramP95`) from Task 1.
- Produces: a CLI that writes `specs/reviews/slo-verdict.json` (`{verdict, error_rate_pct, p95_ms, budgets, breaches, scraped}`) and exits 0/1/2. Flags: `--url`, `--metrics-path`, `--fixture <file>`, `--root <dir>`.

- [ ] **Step 1: Write the failing test**

Create `test/slo-check.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'slo-check.js');

// Build a temp project root with a manifest + a /metrics fixture, run the CLI
// against it with --fixture (no socket), and return {code, verdict}.
function runSlo(manifestObs, metricsText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'),
    JSON.stringify({ observability: manifestObs }));
  const fixture = path.join(dir, 'metrics.txt');
  fs.writeFileSync(fixture, metricsText);
  let code = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', dir, '--fixture', fixture], { stdio: 'pipe' });
  } catch (e) { code = e.status; }
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'slo-verdict.json'), 'utf8'));
  return { code, verdict };
}

const OK = 'http_requests_total{status="200"} 100\n';
const ERRORS = 'http_requests_total{status="200"} 90\nhttp_requests_total{status="500"} 10\n';

test('disabled observability -> exit 0, verdict disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slo-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'),
    JSON.stringify({ observability: { enabled: false } }));
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'slo-verdict.json'), 'utf8'));
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'disabled');
});

test('error-rate over budget -> exit 1 (FAIL)', () => {
  const { code, verdict } = runSlo({ enabled: true, slo: { error_rate_pct: 1.0, p95_ms: 500 } }, ERRORS);
  assert.strictEqual(code, 1);
  assert.strictEqual(verdict.verdict, 'fail');
  assert.ok(verdict.breaches.includes('error_rate'));
  assert.strictEqual(verdict.error_rate_pct, 10);
});

test('within budget -> exit 0 (pass)', () => {
  const { code, verdict } = runSlo({ enabled: true, slo: { error_rate_pct: 1.0, p95_ms: 500 } }, OK);
  assert.strictEqual(code, 0);
  assert.strictEqual(verdict.verdict, 'pass');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/slo-check.test.js`
Expected: FAIL — `slo-check.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/slo-check.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Runtime-SLO sensor (gap G9 sensor-half). Scrapes a generated app's RED
// /metrics endpoint and checks two budgets from project-manifest.json#observability.slo:
//   - 5xx error-rate (%)  -> exit 1 (FAIL) when over budget
//   - p95 latency (ms)    -> exit 2 (WARN) when over budget (regression is the perf ratchet's job)
// Reusable: /evaluate folds in specs/reviews/slo-verdict.json (app already booted);
// `npm run slo -- --url <live>` runs it standalone for the scheduled/drift cadence.
//
// CLI:
//   node .claude/scripts/slo-check.js [--url URL] [--metrics-path /metrics]
//        [--fixture FILE] [--root DIR]
// --fixture reads exposition text from a file instead of HTTP (hermetic tests).
// Exit: 0 pass/disabled, 1 error-rate breach, 2 p95-only / no-traffic / unreachable.

const fs = require('fs');
const path = require('path');
const { parseProm, errorRate, histogramP95 } = require('../hooks/lib/prom-parse.js');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function loadManifest(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); }
  catch { return {}; }
}

function resolveBase(manifest, argv) {
  const cli = arg(argv, '--url', null);
  if (cli) return cli;
  const v = manifest.verification || {};
  if (v.mode === 'local' && v.local && v.local.backend_url) return v.local.backend_url;
  return (manifest.evaluation && manifest.evaluation.api_base_url) || 'http://localhost:8000';
}

async function fetchMetrics(url, retries) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

function finish(outPath, verdict, code) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2));
  } catch { /* best effort */ }
  process.stdout.write(JSON.stringify({ ...verdict, exit: code }) + '\n');
  process.exit(code);
}

async function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const manifest = loadManifest(root);
  const obs = manifest.observability || {};
  const outPath = path.join(root, 'specs', 'reviews', 'slo-verdict.json');

  if (obs.enabled === false) return finish(outPath, { verdict: 'disabled', breaches: [] }, 0);

  const slo = obs.slo || { error_rate_pct: 1.0, p95_ms: 500 };
  const metricsPath = arg(argv, '--metrics-path', obs.metrics_path || '/metrics');

  let text;
  let scraped;
  const fixture = arg(argv, '--fixture', null);
  if (fixture) {
    text = fs.readFileSync(fixture, 'utf8');
    scraped = fixture;
  } else {
    const base = resolveBase(manifest, argv).replace(/\/$/, '');
    scraped = base + metricsPath;
    text = await fetchMetrics(scraped, 3);
    if (text == null) return finish(outPath, { verdict: 'unreachable', scraped, breaches: [] }, 2);
  }

  const series = parseProm(text);
  const er = errorRate(series);
  const p95 = histogramP95(series);
  const breaches = [];
  if (er != null && er > slo.error_rate_pct) breaches.push('error_rate');
  if (p95 != null && p95 > slo.p95_ms) breaches.push('p95');

  let code = 0;
  let verdict = 'pass';
  if (breaches.includes('error_rate')) { code = 1; verdict = 'fail'; }
  else if (breaches.includes('p95') || er == null) { code = 2; verdict = 'warn'; }

  return finish(outPath, {
    verdict, error_rate_pct: er, p95_ms: p95,
    budgets: { error_rate_pct: slo.error_rate_pct, p95_ms: slo.p95_ms },
    breaches, scraped,
  }, code);
}

main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/slo-check.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `slo` npm script**

In `package.json`, add to `scripts` (next to `"drift"`):

```json
    "slo": "node .claude/scripts/slo-check.js",
```

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/slo-check.js test/slo-check.test.js package.json
git commit -m "feat(g9): slo-check.js runtime-SLO sensor (scrape /metrics, 0/1/2 exit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/evaluate` + evaluator integration

**Files:**
- Modify: `.claude/skills/evaluate/SKILL.md` (Performance Checks section)
- Modify: `.claude/agents/evaluator.md` (KEY RULES)
- Test: `test/slo-check.test.js` (append wiring assertions)

**Interfaces:**
- Consumes: `slo-check.js` + `specs/reviews/slo-verdict.json` from Task 2.
- Produces: documented Step P4 + `failure_layer: "slo"` rule.

- [ ] **Step 1: Write the failing test (append to `test/slo-check.test.js`)**

```javascript
const fsr = require('fs');
const p = require('path');
const R = path.join(__dirname, '..');
const rd = (rel) => fsr.readFileSync(p.join(R, rel), 'utf8');

test('G9: evaluate documents the SLO step P4 and slo failure_layer', () => {
  const e = rd('.claude/skills/evaluate/SKILL.md');
  assert.ok(/slo-check\.js/.test(e), 'evaluate must invoke slo-check.js');
  assert.ok(/failure_layer:\s*"?slo"?/.test(e), 'evaluate must define the slo failure layer');
  const ev = rd('.claude/agents/evaluator.md');
  assert.ok(/slo/i.test(ev) && /error-rate|error_rate/i.test(ev),
    'evaluator KEY RULES must mention the SLO error-rate gate');
});

test('G9: slo npm script is wired', () => {
  const pkg = JSON.parse(rd('package.json'));
  assert.strictEqual(pkg.scripts.slo, 'node .claude/scripts/slo-check.js');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/slo-check.test.js`
Expected: FAIL — evaluate/evaluator not yet updated.

- [ ] **Step 3: Add Step P4 to `evaluate/SKILL.md`**

In `.claude/skills/evaluate/SKILL.md`, in the "Performance Checks" section, after Step P3, add:

```
#### Step P4 — SLO check (when observability.enabled)

After the app is booted (no new boot), run the runtime-SLO sensor:

`node .claude/scripts/slo-check.js`

It scrapes `{api_base_url}{observability.metrics_path}` and compares against `observability.slo`, writing `specs/reviews/slo-verdict.json`. Fold the verdict:
- `verdict: "fail"` (5xx error-rate over `slo.error_rate_pct`, counting only 5xx) → **FAIL** with `failure_layer: "slo"` in Full mode; **WARN** in Lean.
- `verdict: "warn"` (p95 over `slo.p95_ms`, or no traffic, or `/metrics` unreachable) → WARN, never FAIL. p95 *regression* is owned by the perf ratchet (Step P2), not this check.
- `verdict: "disabled"` (observability off) → skip silently.
```

- [ ] **Step 4: Add the KEY RULES note to `evaluator.md`**

In `.claude/agents/evaluator.md`, in the "KEY RULES (runtime mode)" list, after the performance-ratchet bullet, add:

```
- **SLO error-rate:** when `observability.enabled`, the SLO sensor (`slo-check.js`, evaluate Step P4) scrapes `/metrics` and FAILs the evaluation in Full mode (`failure_layer: "slo"`) if the 5xx error-rate exceeds `observability.slo.error_rate_pct`. It counts only 5xx (server errors), never 4xx, so deliberate negative tests do not trip it. A p95 over `slo.p95_ms` is a WARN, not a FAIL (regression is the perf ratchet's job).
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/slo-check.test.js`
Expected: PASS (5 tests total).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/evaluate/SKILL.md .claude/agents/evaluator.md test/slo-check.test.js
git commit -m "feat(g9): wire SLO sensor into /evaluate as Step P4 (failure_layer slo)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Registry + docs flip + validate

**Files:**
- Modify: `harness-manifest.json` (`sensors[]` + `drift_sensors_planned`)
- Modify: `HARNESS.md` (Behaviour sensors row + holes line)
- Modify: `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` (G9 row + roadmap)
- Test: `test/slo-check.test.js` (append manifest assertion)

**Interfaces:**
- Consumes: `slo-check.js` from Task 2 (the sensor's `wired_at` target).
- Produces: `runtime-slo` sensor entry, `status: active`.

- [ ] **Step 1: Write the failing test (append to `test/slo-check.test.js`)**

```javascript
test('G9: runtime-slo sensor is registered active and wired', () => {
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'runtime-slo');
  assert.ok(s, 'runtime-slo sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.gap_ref, 'G9');
  assert.ok(s.wired_at && fsr.existsSync(p.join(R, s.wired_at)), 'wired_at must resolve');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/slo-check.test.js`
Expected: FAIL — no `runtime-slo` sensor yet.

- [ ] **Step 3: Add the sensor to `harness-manifest.json`**

In `harness-manifest.json`, add to the `sensors` array (after the last behaviour sensor entry, before the closing `]`):

```json
    { "id": "runtime-slo", "axis": "behaviour", "type": "computational", "cadence": "integration", "status": "active", "wired_at": ".claude/scripts/slo-check.js", "gap_ref": "G9", "signal": "5xx error-rate over SLO; p95 over absolute budget", "description": "Runtime-SLO sensor (gap G9 sensor-half): scrapes the generated app's RED /metrics (the guide-half's http_requests_total + http_request_duration_seconds) and compares to project-manifest.json#observability.slo. 5xx error-rate over error_rate_pct FAILs /evaluate in Full mode (failure_layer:slo); p95 over p95_ms is a WARN (regression stays with the perf ratchet). Wired into /evaluate Step P4 (app already booted) and runnable standalone (npm run slo -- --url <live>) for the drift cadence." }
```

Then update `drift_sensors_planned`: set `still_planned` to `[]` and add a note that the runtime-SLO signal shipped via the `runtime-slo` integration sensor (so it is now covered, even if not on the literal drift cadence in greenfield flow).

- [ ] **Step 4: Run validator + test**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`
Run: `node --test test/slo-check.test.js`
Expected: PASS (6 tests total).

- [ ] **Step 5: Update `HARNESS.md`**

In `HARNESS.md`, in the **Behaviour** matrix row Sensors cell, add `· ✅ **runtime-SLO** (5xx error-rate vs SLO, scrapes product /metrics, G9)`.

In the holes list, change the `G9 sensor-half, G10–G12` line to:

```
- ~~**G9**~~ ✅ **done** (both halves) — the guide scaffolds /metrics into generated apps; the `runtime-slo` sensor reads it and FAILs on 5xx error-rate over SLO. Remaining: **G10–G12 (P2)** — harness templates per topology, a harness-coverage metric, behaviour extras.
```

- [ ] **Step 6: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, change the G9 row status (the `✅ DONE (guide-half)` cell) to `✅ **DONE** (guide-half + sensor-half: `slo-check.js` scrapes /metrics, FAILs on 5xx error-rate over SLO in /evaluate)`. In the §5 roadmap Phase 3 list, mark G9 fully complete.

- [ ] **Step 7: Run the full suite**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|cancelled)"`
Expected: `fail 0`, `cancelled 0`, count up by the new tests.

- [ ] **Step 8: Commit**

```bash
git add harness-manifest.json HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/slo-check.test.js
git commit -m "feat(g9): register runtime-slo sensor active; docs + registry (G9 complete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 prom-parse lib (parseProm/errorRate/histogramP95, units, null cases) → Task 1 + tests. ✅
- §2 slo-check.js (resolve base/path/budgets, disabled, fixture, fetch+retry, verdict JSON, 0/1/2) → Task 2 + tests. ✅
- §3 /evaluate Step P4 + evaluator failure_layer slo → Task 3. ✅
- §4 standalone/drift (`npm run slo`, `--url`) → Task 2 (script) + Task 3 (wiring test). ✅
- §5 registry/HARNESS/gap-doc → Task 4. ✅
- §6 tests (prom-parse units incl 4xx-not-counted + 0-traffic; slo-check contract via --fixture; wiring; validator) → Tasks 1–4. ✅
- Risks: hermetic test via `--fixture` (Task 2 test uses it, no socket); 5xx-only (Task 1 test asserts 404 excluded); self-scrape harmless (dilutes denominator) — no code needed. ✅

**Placeholder scan:** No TBD/TODO; all code complete; commands have expected output. ✅

**Type/name consistency:** `parseProm`/`errorRate`/`histogramP95` signatures identical across Task 1 def, Task 2 require, and tests. `slo-verdict.json` shape (`verdict, error_rate_pct, p95_ms, budgets, breaches, scraped`) identical in Task 2 impl and the Task 2/3/4 tests. `failure_layer: "slo"`, `runtime-slo` id, `--fixture`/`--root` flags consistent throughout. ✅

**Test growth note:** `test/slo-check.test.js` is created in Task 2 (3 tests) and appended in Tasks 3–4 (→5→6). `test/prom-parse.test.js` is Task 1 only (5 tests).
