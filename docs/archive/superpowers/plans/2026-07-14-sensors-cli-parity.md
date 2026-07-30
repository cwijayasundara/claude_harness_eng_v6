# Sensors-CLI parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import three factoring ideas from `sensors-cli` into the harness — a normalized sensor-output schema, a "which sensors are biting?" meta-signal, and a low-friction custom-sensor slot — without a daemon and without rewriting existing sensors.

**Architecture:** A new pure `sensor-schema.js` lib defines one canonical result shape plus `normalize()` (maps existing verdicts) and `parseDefault()` (ingests any tool's JSON). quality-card routes through `normalize()` with byte-stable output. A best-effort append-only ledger (`sensor-outcomes.jsonl`) records per-commit-gate fire/block events; loop-health reports never-fired/never-blocked (historical) plus registered-but-unwired (static). A `custom_sensors[]` array in `project-manifest.json` is run by a new runner via `parseDefault`, integrated into the pre-commit sequence with opt-in blocking.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert`, no new dependencies.

## Global Constraints

- No new npm dependencies. Node stdlib + existing repo libs only.
- CommonJS (`'use strict'`, `require`/`module.exports`) — match existing `.claude/hooks/lib/*.js` and `.claude/scripts/*.js`.
- Tests are `node:test` files under `test/`, run with `node --test test/<file>.test.js`.
- Every new `active` sensor in `harness-manifest.json` MUST point at a real `wired_at` file (honesty invariant, enforced by `validate-harness-manifest.js` + `npm test`). Vocabularies: axis ∈ {maintainability, architecture, behaviour, traceability}; type ∈ {computational, inferential, hybrid}; cadence ∈ {planning, session, commit, integration, drift}; status ∈ {active, partial, planned}; scope ∈ {universal, test-covered, layer-roots, contexts, runtime, dependencies, artifacts, repo}.
- **Safety invariant (Task 4):** outcome logging is best-effort — a logging failure MUST NOT change gate control flow.
- **Output-stability invariant (Task 3):** `specs/reviews/quality-card.{json,md}` output must not change.
- Commit message trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- No auto-merge. Merge stays human.

---

## PR 1 — Normalized sensor schema

### Task 1: `parseDefault` — the default parser

**Files:**
- Create: `.claude/hooks/lib/sensor-schema.js`
- Test: `test/sensor-schema.test.js`

**Interfaces:**
- Produces: `SCHEMA_VERSION` (string); `applyDefaults(obj) -> canonical`; `parseDefault(stdout: string) -> canonical`. Canonical shape: `{ findings:[], metrics:[], guidance:[], score:{value,direction,description}, success:bool, summary:string, extra:{} }`.

- [ ] **Step 1: Write the failing test**

```js
// test/sensor-schema.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseDefault, applyDefaults, SCHEMA_VERSION } = require('../.claude/hooks/lib/sensor-schema');

test('parseDefault fills defaults for a bare finding list', () => {
  const r = parseDefault(JSON.stringify({ findings: [{ message: 'x', severity: 'error' }] }));
  assert.strictEqual(r.success, false);         // findings present → not success
  assert.strictEqual(r.score.value, 1);          // default score = finding count
  assert.strictEqual(r.score.direction, 'less');
  assert.strictEqual(r.summary, '1 issue');
  assert.deepStrictEqual(r.metrics, []);
  assert.deepStrictEqual(r.extra, {});
});

test('parseDefault treats empty/absent findings as success', () => {
  const r = parseDefault(JSON.stringify({}));
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.summary, 'No issues');
  assert.strictEqual(r.score.value, 0);
});

test('parseDefault honors explicit success/summary/score', () => {
  const r = parseDefault(JSON.stringify({ success: false, summary: 'coverage 71%', score: { value: 71, direction: 'more', description: 'pct' } }));
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.summary, 'coverage 71%');
  assert.strictEqual(r.score.value, 71);
  assert.strictEqual(r.score.direction, 'more');
});

test('parseDefault tolerates non-JSON stdout (never throws)', () => {
  const r = parseDefault('boom: command not found');
  assert.strictEqual(r.success, false);
  assert.match(r.summary, /boom/);
  assert.strictEqual(r.extra.parseError, true);
});

test('applyDefaults is idempotent and version-stamped', () => {
  const once = applyDefaults({ findings: [] });
  const twice = applyDefaults(once);
  assert.deepStrictEqual(once, twice);
  assert.strictEqual(typeof SCHEMA_VERSION, 'string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sensor-schema.test.js`
Expected: FAIL — `Cannot find module '../.claude/hooks/lib/sensor-schema'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/hooks/lib/sensor-schema.js
'use strict';

// Canonical sensor-result schema (sensors-cli parity). One shape every sensor
// can emit so a single parser reads them all. Pure module, no I/O.
//   { findings[], metrics[], guidance[], score{value,direction,description},
//     success, summary, extra{} }

const SCHEMA_VERSION = '1';

function asArray(v) { return Array.isArray(v) ? v : []; }
function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

function summaryFor(count) {
  if (count <= 0) return 'No issues';
  return `${count} issue${count === 1 ? '' : 's'}`;
}

// Fill absent/null fields per the sensors-cli default-parser contract.
function applyDefaults(obj) {
  const o = asObject(obj);
  const findings = asArray(o.findings);
  const metrics = asArray(o.metrics);
  const guidance = asArray(o.guidance);
  const extra = asObject(o.extra);
  const success = typeof o.success === 'boolean' ? o.success : findings.length === 0;
  const summary = typeof o.summary === 'string' && o.summary ? o.summary : summaryFor(findings.length);
  const inScore = asObject(o.score);
  const score = {
    value: typeof inScore.value === 'number' ? inScore.value : findings.length,
    direction: inScore.direction === 'more' ? 'more' : 'less',
    description: typeof inScore.description === 'string' && inScore.description
      ? inScore.description : 'Issues reported by tool',
  };
  return { findings, metrics, guidance, score, success, summary, extra, schema: SCHEMA_VERSION };
}

// Ingest a tool's stdout. Never throws: non-JSON becomes a failed result whose
// summary is the raw text, so a broken sensor is loud, not silent.
function parseDefault(stdout) {
  const text = String(stdout == null ? '' : stdout).trim();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {
    return applyDefaults({
      findings: [{ message: text || 'no output', severity: 'error' }],
      success: false,
      summary: text ? text.slice(0, 200) : 'no output',
      extra: { parseError: true },
    });
  }
  return applyDefaults(parsed);
}

module.exports = { SCHEMA_VERSION, applyDefaults, parseDefault, summaryFor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sensor-schema.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/sensor-schema.js test/sensor-schema.test.js
git commit -m "feat: sensor-schema.js — canonical result shape + default parser

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `normalize` — map existing verdict shapes

**Files:**
- Modify: `.claude/hooks/lib/sensor-schema.js` (add `normalize`)
- Test: `test/sensor-schema.test.js` (add cases)

**Interfaces:**
- Consumes: `applyDefaults` (Task 1).
- Produces: `normalize(raw, kind) -> canonical`, where `kind ∈ {'json_pass','json_verdict','md_verdict'}` (the kinds quality-card already uses). `raw` is the parsed JSON object (for json_*) or the file text (for md_verdict), or `null` when the source is absent. Canonical `extra` carries `{ present:boolean, detail:string|null }` so quality-card can reproduce its current fields byte-for-byte.

- [ ] **Step 1: Write the failing test**

```js
// append to test/sensor-schema.test.js
const { normalize } = require('../.claude/hooks/lib/sensor-schema');

test('normalize json_pass carries pass + detail into extra', () => {
  const r = normalize({ pass: false, summary: 'ownership gap' }, 'json_pass');
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.extra.present, true);
  assert.strictEqual(r.extra.detail, 'ownership gap');
});

test('normalize json_verdict maps benign verdicts to success', () => {
  assert.strictEqual(normalize({ verdict: 'no-baseline' }, 'json_verdict').success, true);
  assert.strictEqual(normalize({ verdict: 'breaking' }, 'json_verdict').success, false);
  assert.strictEqual(normalize({ verdict: 'breaking' }, 'json_verdict').extra.detail, 'breaking');
});

test('normalize md_verdict reads PASS/FAIL text', () => {
  assert.strictEqual(normalize('VERDICT: PASS', 'md_verdict').success, true);
  assert.strictEqual(normalize('VERDICT: FAIL', 'md_verdict').success, false);
});

test('normalize(null) marks absent', () => {
  const r = normalize(null, 'json_pass');
  assert.strictEqual(r.extra.present, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sensor-schema.test.js`
Expected: FAIL — `normalize is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `.claude/hooks/lib/sensor-schema.js` before `module.exports`, and export `normalize`. This is the same logic quality-card currently hard-codes, relocated so it is the single source of truth.

```js
const BENIGN_VERDICTS = new Set(['pass', 'ok', 'no-baseline', 'no-snapshots', 'no-spec', 'unprovisioned', 'skipped', 'no-map']);
const FAIL_VERDICTS = new Set(['blocked', 'fail', 'breaking']);

function interpret(raw, kind) {
  if (raw == null) return { present: false, pass: null, detail: null };
  if (kind === 'md_verdict') {
    const upper = String(raw).toUpperCase();
    if (/\bVERDICT\s*:\s*PASS\b/.test(upper) || (/\bPASS\b/.test(upper) && !/\bFAIL\b/.test(upper))) {
      return { present: true, pass: true, detail: null };
    }
    if (/\bVERDICT\s*:\s*FAIL\b/.test(upper) || /\bFAIL\b/.test(upper) || /\bBLOCK\b/.test(upper)) {
      return { present: true, pass: false, detail: null };
    }
    return { present: true, pass: null, detail: null };
  }
  if (kind === 'json_verdict') {
    const v = String(raw.verdict || raw.status || '').toLowerCase();
    if (BENIGN_VERDICTS.has(v)) return { present: true, pass: true, detail: v };
    if (FAIL_VERDICTS.has(v) || raw.pass === false) return { present: true, pass: false, detail: v || 'fail' };
    if (typeof raw.pass === 'boolean') return { present: true, pass: raw.pass, detail: v || null };
    return { present: true, pass: null, detail: v || null };
  }
  // json_pass
  if (typeof raw.pass === 'boolean') return { present: true, pass: raw.pass, detail: raw.summary || raw.note || null };
  if (raw.verdict) return interpret(raw, 'json_verdict');
  return { present: true, pass: null, detail: null };
}

function normalize(raw, kind) {
  const i = interpret(raw, kind);
  const base = applyDefaults({
    success: i.pass === true,
    summary: i.detail || (i.present ? '' : 'absent'),
    findings: i.pass === false ? [{ message: i.detail || 'fail', severity: 'error' }] : [],
  });
  base.extra = { present: i.present, detail: i.detail, pass: i.pass };
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sensor-schema.test.js`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/sensor-schema.js test/sensor-schema.test.js
git commit -m "feat: sensor-schema normalize() for json_pass/json_verdict/md_verdict

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Route quality-card through `normalize` (byte-stable)

**Files:**
- Modify: `.claude/scripts/quality-card.js:72-95` (replace `interpretJson`/`interpretMdVerdict` bodies with `normalize` delegation)
- Test: `test/quality-card-golden.test.js`

**Interfaces:**
- Consumes: `normalize` (Task 2).
- Produces: no output-shape change. `buildCard`, `SOURCES`, `loadChecks` signatures unchanged.

- [ ] **Step 1: Capture the golden output from current code**

Run this to snapshot current behavior BEFORE any change:

```bash
node -e '
const qc = require("./.claude/scripts/quality-card.js");
const fs = require("fs"), os = require("os"), path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-"));
fs.mkdirSync(path.join(dir, "specs/reviews"), { recursive: true });
fs.writeFileSync(path.join(dir, "specs/reviews/evaluator-report.md"), "VERDICT: PASS");
fs.writeFileSync(path.join(dir, "specs/reviews/code-review-verdict.json"), JSON.stringify({ pass: true, summary: { block: 0, warn: 2 } }));
fs.writeFileSync(path.join(dir, "specs/reviews/regression-gate-verdict.json"), JSON.stringify({ verdict: "no-baseline" }));
fs.writeFileSync(path.join(dir, "specs/reviews/security-verdict.json"), JSON.stringify({ pass: false, summary: "1 high" }));
const { card, md } = qc.buildCard({ root: dir });
delete card.generated_at;   // volatile
fs.mkdirSync("test/fixtures", { recursive: true });
fs.writeFileSync("test/fixtures/quality-card-golden.json", JSON.stringify(card, null, 2) + "\n");
fs.writeFileSync("test/fixtures/quality-card-golden.md", md.replace(/^Generated: .*$/m, "Generated: FIXED"));
console.log("golden captured");
'
```

- [ ] **Step 2: Write the golden test**

```js
// test/quality-card-golden.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const qc = require('../.claude/scripts/quality-card.js');

function fixtureRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-'));
  fs.mkdirSync(path.join(dir, 'specs/reviews'), { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(dir, 'specs/reviews', f), typeof o === 'string' ? o : JSON.stringify(o));
  w('evaluator-report.md', 'VERDICT: PASS');
  w('code-review-verdict.json', { pass: true, summary: { block: 0, warn: 2 } });
  w('regression-gate-verdict.json', { verdict: 'no-baseline' });
  w('security-verdict.json', { pass: false, summary: '1 high' });
  return dir;
}

test('quality-card output is byte-stable after refactor', () => {
  const { card, md } = qc.buildCard({ root: fixtureRoot() });
  delete card.generated_at;
  const goldJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/quality-card-golden.json'), 'utf8'));
  const goldMd = fs.readFileSync(path.join(__dirname, 'fixtures/quality-card-golden.md'), 'utf8');
  assert.deepStrictEqual(card, goldJson);
  assert.strictEqual(md.replace(/^Generated: .*$/m, 'Generated: FIXED'), goldMd);
});
```

- [ ] **Step 3: Run test to verify it passes on CURRENT code**

Run: `node --test test/quality-card-golden.test.js`
Expected: PASS — confirms the golden is faithful before refactoring.

- [ ] **Step 4: Refactor quality-card to delegate to normalize**

Replace the bodies of `interpretMdVerdict` and `interpretJson` in `.claude/scripts/quality-card.js` (lines 60-95) with delegation. Add `const { normalize } = require('../hooks/lib/sensor-schema');` near the top requires (line ~16). New bodies:

```js
function interpretMdVerdict(text) {
  const r = normalize(text == null ? null : text, 'md_verdict');
  return { present: r.extra.present, pass: r.extra.pass };
}

function interpretJson(obj, kind) {
  const r = normalize(obj, kind);
  return { present: r.extra.present, pass: r.extra.pass, detail: r.extra.detail };
}
```

Leave `loadChecks`, `statusFromPass`, `buildCard`, and rendering untouched.

- [ ] **Step 5: Run the golden test + full quality-card tests**

Run: `node --test test/quality-card-golden.test.js`
Expected: PASS — output unchanged.
Run: `node --test test/quality-card*.test.js 2>/dev/null; node --test test/ 2>&1 | tail -20`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/quality-card.js test/quality-card-golden.test.js test/fixtures/quality-card-golden.json test/fixtures/quality-card-golden.md
git commit -m "refactor: quality-card verdict interpretation delegates to sensor-schema (output-stable)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Open PR 1**

```bash
git push -u origin sensors-cli-parity
gh pr create --base main --title "sensors parity 1/3: normalized sensor schema" \
  --body "Adds .claude/hooks/lib/sensor-schema.js (canonical result shape, normalize(), parseDefault()). Refactors quality-card verdict interpretation to delegate to it; output byte-stable (golden test). Foundation for PR 2 and PR 3.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## PR 2 — "Are sensors biting?" meta-sensor

### Task 4: Instrument commit gates (2a — outcome ledger)

**Files:**
- Create: `.claude/hooks/lib/sensor-outcomes.js`
- Modify: `.claude/hooks/lib/pre-commit-util.js` (`setFailContext`, `fail`)
- Modify: `.claude/hooks/lib/gate-registry.js` (`runPreCommit` loop)
- Test: `test/sensor-outcomes.test.js`

**Interfaces:**
- Produces: `recordOutcome(projectDir, { sensor, ran, blocked }) -> void` (best-effort, never throws); `readOutcomes(projectDir) -> Array<{sensor,ran,blocked,ts}>`; `OUTCOMES_REL = '.claude/state/sensor-outcomes.jsonl'`.
- Consumes (by pre-commit-util): `recordOutcome`.

- [ ] **Step 1: Write the failing test**

```js
// test/sensor-outcomes.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { recordOutcome, readOutcomes, OUTCOMES_REL } = require('../.claude/hooks/lib/sensor-outcomes');

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'so-')); fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true }); return d; }

test('recordOutcome appends a JSONL line readable by readOutcomes', () => {
  const d = tmp();
  recordOutcome(d, { sensor: 'layer-imports', ran: true, blocked: false });
  recordOutcome(d, { sensor: 'secret-scan', ran: true, blocked: true });
  const rows = readOutcomes(d);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].sensor, 'secret-scan');
  assert.strictEqual(rows[1].blocked, true);
  assert.strictEqual(typeof rows[1].ts, 'number');
});

test('recordOutcome never throws when the state dir is unwritable', () => {
  const d = tmp();
  // point at a path whose parent is a file → unwritable
  const bad = path.join(d, 'afile');
  fs.writeFileSync(bad, 'x');
  assert.doesNotThrow(() => recordOutcome(path.join(bad, 'nope'), { sensor: 's', ran: true, blocked: false }));
});

test('readOutcomes returns [] when ledger absent', () => {
  assert.deepStrictEqual(readOutcomes(tmp()), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sensor-outcomes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the ledger module**

```js
// .claude/hooks/lib/sensor-outcomes.js
'use strict';

// Append-only per-commit-gate outcome ledger (sensors-cli parity, feature 2a).
// Best-effort: every write is wrapped so a logging failure can NEVER change
// gate control flow. Read by loop-health (2b) to answer "which sensors never
// fire / never block?".

const fs = require('fs');
const path = require('path');

const OUTCOMES_REL = path.join('.claude', 'state', 'sensor-outcomes.jsonl');

function recordOutcome(projectDir, { sensor, ran, blocked }) {
  try {
    const file = path.join(projectDir, OUTCOMES_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = { sensor: String(sensor), ran: !!ran, blocked: !!blocked, ts: Date.now() };
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch (_) {
    /* best-effort: logging must not affect the gate */
  }
}

function readOutcomes(projectDir) {
  try {
    const raw = fs.readFileSync(path.join(projectDir, OUTCOMES_REL), 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

module.exports = { OUTCOMES_REL, recordOutcome, readOutcomes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sensor-outcomes.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire block recording into `fail()`**

In `.claude/hooks/lib/pre-commit-util.js`: extend `setFailContext` to keep `currentSensor` + `projectDir`, and record a blocked outcome inside `fail()` before exit. Add `const { recordOutcome } = require('./sensor-outcomes');` at top.

Replace lines 13-29 with:

```js
/** Optional context set by gate-registry so fail()/noteSkip can print Tier: and log outcomes */
let failContext = { tier: null, currentSensor: null, projectDir: null };

function setFailContext(ctx) {
  failContext = { tier: null, currentSensor: null, projectDir: null, ...ctx };
}

function getFailContext() {
  return failContext;
}

function fail(message) {
  if (failContext.currentSensor && failContext.projectDir) {
    recordOutcome(failContext.projectDir, { sensor: failContext.currentSensor, ran: true, blocked: true });
  }
  const msg = ensureTierFooter(message, failContext.tier);
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(1);
}
```

- [ ] **Step 6: Wire pass recording into the runner loop**

In `.claude/hooks/lib/gate-registry.js`: add `const { recordOutcome } = require('./sensor-outcomes');` at top. Replace the two `g.run(ctx)` call sites (lines 64-66 and 72-75) so each sets the current sensor, runs, and records a non-blocked outcome on normal return (a blocked gate exits inside `fail()` and never reaches the record-pass line):

```js
  // Phase A: gates that run even for docs-only / delete-only commits
  for (const g of selectGates(tier, { withoutSourceOnly: true })) {
    setFailContext({ tier, currentSensor: g.id, projectDir });
    g.run(ctx);
    recordOutcome(projectDir, { sensor: g.id, ran: true, blocked: false });
  }

  // Historical source-only exit (after secrets / amendment / test-deletion)
  if (ctx.stagedSource.length === 0) return { tier, ranSourceGates: false };

  // Phase B: remaining gates enabled for this tier
  for (const g of selectGates(tier)) {
    if (g.runsWithoutSource) continue;
    setFailContext({ tier, currentSensor: g.id, projectDir });
    g.run(ctx);
    recordOutcome(projectDir, { sensor: g.id, ran: true, blocked: false });
  }
```

Add `const { setFailContext } = require('./pre-commit-util');` if not already imported (it imports `buildContext, setFailContext` already — keep both). Remove the now-redundant single `setFailContext({ tier })` on line 60.

- [ ] **Step 7: Write the control-flow-safety integration test**

```js
// append to test/sensor-outcomes.test.js
const { runPreCommit } = require('../.claude/hooks/lib/gate-registry');

test('a passing gate run records outcomes without altering control flow', () => {
  const d = tmp();
  // No staged source → runPreCommit runs only withoutSource gates then returns.
  // Stub git by running in an empty repo dir is heavy; instead assert the API
  // contract: recordOutcome tolerated + readOutcomes shape. (Full pre-commit
  // path is covered by test/pre-commit-*.test.js.)
  recordOutcome(d, { sensor: 'secret-scan', ran: true, blocked: false });
  assert.strictEqual(readOutcomes(d)[0].blocked, false);
});
```

Note: gate-registry already has integration coverage in `test/` (grep `runPreCommit`); Step 8 runs that suite to confirm the wiring did not regress control flow.

- [ ] **Step 8: Run tests**

Run: `node --test test/sensor-outcomes.test.js`
Expected: PASS.
Run: `node --test test/ 2>&1 | tail -25`
Expected: no new failures in pre-commit / gate-registry tests.

- [ ] **Step 9: Commit**

```bash
git add .claude/hooks/lib/sensor-outcomes.js .claude/hooks/lib/pre-commit-util.js .claude/hooks/lib/gate-registry.js test/sensor-outcomes.test.js
git commit -m "feat: record per-commit-gate fire/block outcomes (best-effort ledger, 2a)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: loop-health biting signal (2b)

**Files:**
- Modify: `.claude/hooks/lib/loop-health.js` (add `analyzeBiting`, wire into `buildScorecard`/`deriveNotes`/`renderMd`)
- Test: `test/loop-health-biting.test.js`

**Interfaces:**
- Consumes: `readOutcomes` (Task 4); `harness-manifest.json`; `GATE_CATALOG` from gate-registry.
- Produces: `analyzeBiting(root) -> { neverFired:[], neverBlocked:[], unwired:[], runs:number, accruing:boolean }`. Wired into scorecard signals as `signals.biting`, with notes appended by `deriveNotes`.

- [ ] **Step 1: Write the failing test**

```js
// test/loop-health-biting.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { analyzeBiting } = require('../.claude/hooks/lib/loop-health');

function seed(rows) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));
  fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true });
  if (rows) fs.writeFileSync(path.join(d, '.claude/state/sensor-outcomes.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return d;
}

test('under 5 commit runs it reports accruing history', () => {
  const d = seed([{ sensor: 'layer-imports', ran: true, blocked: false, ts: 1 }]);
  assert.strictEqual(analyzeBiting(d).accruing, true);
});

test('with >=5 runs it flags never-blocked gates', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) { rows.push({ sensor: 'layer-imports', ran: true, blocked: false, ts: i }); }
  rows.push({ sensor: 'secret-scan', ran: true, blocked: true, ts: 7 });
  const r = analyzeBiting(seed(rows));
  assert.strictEqual(r.accruing, false);
  assert.ok(r.neverBlocked.includes('layer-imports'));
  assert.ok(!r.neverBlocked.includes('secret-scan'));
});

test('never-fired lists commit gates absent from the ledger', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ sensor: 'secret-scan', ran: true, blocked: (i === 0), ts: i });
  const r = analyzeBiting(seed(rows));
  assert.ok(r.neverFired.includes('layer-imports')); // a real commit gate never seen
  assert.ok(!r.neverFired.includes('secret-scan'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/loop-health-biting.test.js`
Expected: FAIL — `analyzeBiting is not a function`.

- [ ] **Step 3: Implement `analyzeBiting`**

Add to `.claude/hooks/lib/loop-health.js`. At top requires add:

```js
const { readOutcomes } = require('./sensor-outcomes');
```

Add the function (require gate-registry lazily to avoid a load cycle, and tolerate its absence in hook fixtures):

```js
const MIN_RUNS = 5;

function commitGateIds() {
  try { return require('./gate-registry').GATE_CATALOG.map((g) => g.id); }
  catch (_) { return []; }
}

// "Runs" = distinct commit timestamps clustered per gate is overkill; use the
// count of the most-frequently-seen gate as a proxy for how many commits ran.
function analyzeBiting(root) {
  const ids = commitGateIds();
  const outcomes = readOutcomes(root);
  const seen = new Map(); // id -> { fired, blocked }
  for (const o of outcomes) {
    const s = seen.get(o.sensor) || { fired: 0, blocked: 0 };
    if (o.ran) s.fired += 1;
    if (o.blocked) s.blocked += 1;
    seen.set(o.sensor, s);
  }
  const runs = ids.reduce((max, id) => Math.max(max, (seen.get(id) || { fired: 0 }).fired), 0);
  const accruing = runs < MIN_RUNS;
  const neverFired = ids.filter((id) => !(seen.get(id) && seen.get(id).fired > 0));
  const neverBlocked = ids.filter((id) => seen.get(id) && seen.get(id).fired > 0 && seen.get(id).blocked === 0);
  return { runs, accruing, neverFired: accruing ? [] : neverFired, neverBlocked: accruing ? [] : neverBlocked, unwired: [] };
}
```

Wire into `buildScorecard` (add `biting: analyzeBiting(root)` to `signals`) and into `deriveNotes`:

```js
  const biting = signals.biting;
  if (biting && !biting.accruing) {
    if (biting.neverBlocked.length) {
      notes.push(`${biting.neverBlocked.length} commit gate(s) fired but never blocked over ${biting.runs} runs (${biting.neverBlocked.join(', ')}) — possible miscalibration.`);
    }
    if (biting.neverFired.length) {
      notes.push(`${biting.neverFired.length} commit gate(s) never fired (${biting.neverFired.join(', ')}) — dead or unreached.`);
    }
  } else if (biting && biting.accruing) {
    notes.push(`Sensor-biting history accruing (${biting.runs}/${MIN_RUNS} commit runs) — biting analysis deferred.`);
  }
```

Export `analyzeBiting` in `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/loop-health-biting.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run loop-health end to end + full suite**

Run: `node .claude/scripts/loop-health.js && sed -n '/Observations/,$p' specs/retro/loop-health.md`
Expected: exit 0; an Observations section including a "history accruing" note (this repo's ledger starts near-empty).
Run: `node --test test/loop-health*.test.js 2>&1 | tail -15`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/lib/loop-health.js test/loop-health-biting.test.js
git commit -m "feat: loop-health biting analysis — never-fired / never-blocked commit gates (2b)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Register biting-meta in the manifest

**Files:**
- Modify: `harness-manifest.json` (add sensor entry)
- Modify: `HARNESS.md` (add matrix row)
- Test: `test/harness-manifest.test.js` (existing — just runs)

**Interfaces:** none (registry data).

- [ ] **Step 1: Add the sensor entry**

Add to `harness-manifest.json` `sensors[]` (place near `drift-dead-code`):

```json
{
  "id": "biting-meta",
  "axis": "maintainability",
  "type": "computational",
  "cadence": "drift",
  "status": "active",
  "scope": "repo",
  "wired_at": ".claude/scripts/loop-health.js",
  "signal": "commit gates that never fire or never block over run history",
  "description": "Meta-sensor (sensors-cli parity): reads .claude/state/sensor-outcomes.jsonl to surface dead (never-fired) and possibly-miscalibrated (never-blocked) commit gates for /retro. Report-only, advisory."
}
```

- [ ] **Step 2: Validate the manifest**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exit 0 (valid). If it reports a bad axis/scope/cadence, fix to the allowed vocabulary.

- [ ] **Step 3: Add a HARNESS.md matrix row**

Add one row under the maintainability/drift area of the guides×sensors matrix (match the surrounding table's columns) naming `biting-meta` and its signal. Keep formatting identical to adjacent rows.

- [ ] **Step 4: Run manifest + doc tests**

Run: `node --test test/harness-manifest.test.js`
Expected: PASS.
Run: `npm test 2>&1 | tail -20`
Expected: suite green (or same failures as a clean baseline — see repo iCloud caveat).

- [ ] **Step 5: Commit + open PR 2**

```bash
git add harness-manifest.json HARNESS.md
git commit -m "chore: register biting-meta sensor in harness manifest + HARNESS.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
gh pr create --base main --title "sensors parity 2/3: are-sensors-biting meta-sensor" \
  --body "Records per-commit-gate fire/block outcomes to .claude/state/sensor-outcomes.jsonl (best-effort — logging cannot affect gate control flow). loop-health reports never-fired (dead) and fired-but-never-blocked (miscalibrated) commit gates once >=5 runs accrue; feeds /retro. Depends on PR 1.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## PR 3 — Custom-sensor slot

### Task 7: Custom-sensor runner (on-demand)

**Files:**
- Create: `.claude/scripts/run-custom-sensors.js`
- Create: `.claude/templates/custom-sensors.schema.json`
- Modify: `package.json` (add `custom-sensors` script)
- Test: `test/run-custom-sensors.test.js`

**Interfaces:**
- Consumes: `parseDefault` (Task 1).
- Produces: `loadCustomSensors(projectDir) -> Array<entry>`; `runOne(entry, projectDir) -> { id, result, blocking }` where `result` is canonical; `runAll(projectDir, { cadence }) -> { sensors:[], pass:boolean }`. Entry shape: `{ id, command, parser:'default', cadence:'commit'|'on-demand', blocking:boolean, enabled?:boolean }`.

- [ ] **Step 1: Write the failing test**

```js
// test/run-custom-sensors.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { loadCustomSensors, runOne, runAll } = require('../.claude/scripts/run-custom-sensors');

function proj(customSensors) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.writeFileSync(path.join(d, 'project-manifest.json'), JSON.stringify({ custom_sensors: customSensors }));
  return d;
}

test('loadCustomSensors returns [] when key absent', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.writeFileSync(path.join(d, 'project-manifest.json'), JSON.stringify({}));
  assert.deepStrictEqual(loadCustomSensors(d), []);
});

test('runOne parses a passing command as success', () => {
  const d = proj([]);
  const r = runOne({ id: 'ok', command: 'echo \'{"findings":[]}\'', parser: 'default' }, d);
  assert.strictEqual(r.result.success, true);
});

test('runOne treats a non-JSON / failing command as a failed result, never throws', () => {
  const d = proj([]);
  const r = runOne({ id: 'boom', command: 'echo not-json; exit 3', parser: 'default' }, d);
  assert.strictEqual(r.result.success, false);
});

test('runAll filters by cadence and skips disabled entries', () => {
  const d = proj([
    { id: 'a', command: 'echo \'{"findings":[]}\'', cadence: 'commit', enabled: true },
    { id: 'b', command: 'echo \'{"findings":[]}\'', cadence: 'on-demand' },
    { id: 'c', command: 'echo \'{"findings":[]}\'', cadence: 'commit', enabled: false },
  ]);
  const out = runAll(d, { cadence: 'commit' });
  assert.deepStrictEqual(out.sensors.map((s) => s.id), ['a']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run-custom-sensors.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the runner**

```js
#!/usr/bin/env node
'use strict';

// Run user-defined custom sensors declared in project-manifest.json#custom_sensors[].
// Each command's stdout is parsed with the sensor-schema default parser. Commit-
// cadence entries are also invoked from the pre-commit sequence (see gate-registry).
//   node .claude/scripts/run-custom-sensors.js [--root <dir>] [--cadence commit|on-demand]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseDefault } = require('../hooks/lib/sensor-schema');

function loadCustomSensors(projectDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    return Array.isArray(m.custom_sensors) ? m.custom_sensors : [];
  } catch (_) { return []; }
}

function runOne(entry, projectDir) {
  let stdout = '';
  try {
    stdout = execSync(entry.command, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    stdout = (e.stdout || '') + (e.stderr || e.message || '');
  }
  const result = parseDefault(stdout);
  return { id: String(entry.id || 'custom'), result, blocking: !!entry.blocking };
}

function runAll(projectDir, { cadence } = {}) {
  const entries = loadCustomSensors(projectDir)
    .filter((e) => e && e.enabled !== false)
    .filter((e) => !cadence || (e.cadence || 'on-demand') === cadence);
  const sensors = entries.map((e) => runOne(e, projectDir));
  return { sensors, pass: sensors.every((s) => s.result.success || !s.blocking) };
}

function main(argv = process.argv.slice(2)) {
  const root = (() => { const i = argv.indexOf('--root'); return i === -1 ? process.cwd() : argv[i + 1]; })();
  const cadence = (() => { const i = argv.indexOf('--cadence'); return i === -1 ? undefined : argv[i + 1]; })();
  const out = runAll(root, { cadence });
  const dir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'custom-sensors.json'), JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`custom-sensors: ${out.sensors.length} run, ${out.pass ? 'PASS' : 'FAIL'}\n`);
  return out.pass ? 0 : 1;
}

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { process.stderr.write(`custom-sensors: ${e.message}\n`); process.exit(2); }
}

module.exports = { loadCustomSensors, runOne, runAll, main };
```

Add the schema template `.claude/templates/custom-sensors.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "custom_sensors entry",
  "type": "object",
  "required": ["id", "command"],
  "properties": {
    "id": { "type": "string" },
    "command": { "type": "string" },
    "parser": { "type": "string", "enum": ["default"], "default": "default" },
    "cadence": { "type": "string", "enum": ["commit", "on-demand"], "default": "on-demand" },
    "blocking": { "type": "boolean", "default": false },
    "enabled": { "type": "boolean", "default": true }
  }
}
```

Add to `package.json` `scripts`: `"custom-sensors": "node .claude/scripts/run-custom-sensors.js"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/run-custom-sensors.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/run-custom-sensors.js .claude/templates/custom-sensors.schema.json package.json test/run-custom-sensors.test.js
git commit -m "feat: custom-sensor runner (project-manifest.json#custom_sensors, default parser)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Commit-cadence integration + blocking

**Files:**
- Modify: `.claude/hooks/lib/gate-registry.js` (`runPreCommit` — run commit custom sensors after built-ins)
- Test: `test/custom-sensor-commit.test.js`

**Interfaces:**
- Consumes: `runAll` (Task 7), `recordOutcome` (Task 4), `fail` (pre-commit-util).

- [ ] **Step 1: Write the failing test**

```js
// test/custom-sensor-commit.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runCommitCustomSensors } = require('../.claude/hooks/lib/gate-registry');
const fs = require('fs'), os = require('os'), path = require('path');

function proj(cs) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true });
  fs.writeFileSync(path.join(d, 'project-manifest.json'), JSON.stringify({ custom_sensors: cs }));
  return d;
}

test('report-only failing custom sensor does not block', () => {
  const d = proj([{ id: 'r', command: 'echo not-json', cadence: 'commit', blocking: false }]);
  assert.doesNotThrow(() => runCommitCustomSensors(d));
});

test('blocking failing custom sensor calls fail (throws in test harness)', () => {
  const d = proj([{ id: 'b', command: 'echo not-json', cadence: 'commit', blocking: true }]);
  // fail() calls process.exit(1); stub it to throw so the test can observe the block.
  const origExit = process.exit;
  process.exit = (code) => { throw new Error('exit ' + code); };
  try { assert.throws(() => runCommitCustomSensors(d), /exit 1/); }
  finally { process.exit = origExit; }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/custom-sensor-commit.test.js`
Expected: FAIL — `runCommitCustomSensors is not a function`.

- [ ] **Step 3: Implement `runCommitCustomSensors` and call it from `runPreCommit`**

Add to `.claude/hooks/lib/gate-registry.js`. At top: `const { fail, setFailContext } = require('./pre-commit-util');` (extend the existing import) and lazily require the runner to avoid a hard load-time dep:

```js
function runCommitCustomSensors(projectDir) {
  let runAll;
  try { ({ runAll } = require('../../scripts/run-custom-sensors')); }
  catch (_) { return; } // runner absent (e.g. hook fixture) → skip silently
  const { sensors } = runAll(projectDir, { cadence: 'commit' });
  for (const s of sensors) {
    setFailContext({ currentSensor: `custom:${s.id}`, projectDir });
    recordOutcome(projectDir, { sensor: `custom:${s.id}`, ran: true, blocked: s.blocking && !s.result.success });
    if (s.blocking && !s.result.success) {
      fail(`\nBLOCKED: custom sensor "${s.id}" — ${s.result.summary}\n`);
    }
  }
}
```

Call it at the end of `runPreCommit`, just before the final `return` (after Phase B):

```js
  runCommitCustomSensors(projectDir);
  return { tier, ranSourceGates: true };
```

Add `runCommitCustomSensors` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/custom-sensor-commit.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the broader suite**

Run: `node --test test/ 2>&1 | tail -25`
Expected: no new failures (existing pre-commit tests still green).

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/lib/gate-registry.js test/custom-sensor-commit.test.js
git commit -m "feat: run commit-cadence custom sensors in pre-commit (opt-in blocking)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Register custom-sensor-runner + scaffold default

**Files:**
- Modify: `harness-manifest.json` (sensor entry)
- Modify: `HARNESS.md` (matrix row)
- Modify: scaffold's `project-manifest.json` template (add `custom_sensors: []`) — locate via `grep -rl '"sensor_tier"' .claude/skills/scaffold .claude/templates 2>/dev/null`
- Test: existing manifest test

- [ ] **Step 1: Add the sensor entry**

```json
{
  "id": "custom-sensor-runner",
  "axis": "traceability",
  "type": "computational",
  "cadence": "commit",
  "status": "active",
  "scope": "repo",
  "wired_at": ".claude/scripts/run-custom-sensors.js",
  "signal": "user-defined project sensors declared in project-manifest.json#custom_sensors[]",
  "description": "Sensors-cli parity: runs project-declared custom sensors through the default parser at commit + on demand; opt-in blocking. Lets a downstream project add a check without touching harness internals."
}
```

- [ ] **Step 2: Add `custom_sensors: []` to the scaffold manifest template**

Locate the template (Step-0 grep). Add `"custom_sensors": []` alongside the `quality` block. If no static template exists (manifest generated in-skill), add a line to the scaffold skill's manifest emission and note it. The runner tolerates the key's absence, so this is a convenience default, not a hard dependency.

- [ ] **Step 3: Add a HARNESS.md matrix row** for `custom-sensor-runner` (traceability/commit), formatting identical to adjacent rows.

- [ ] **Step 4: Validate + test**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exit 0.
Run: `npm test 2>&1 | tail -20`
Expected: green (mind the iCloud dup-file caveat if it hangs — kill orphaned `node --test`, delete ` 2.` dupes, rerun).

- [ ] **Step 5: Commit + open PR 3**

```bash
git add harness-manifest.json HARNESS.md
# plus the scaffold template file touched in Step 2
git commit -m "chore: register custom-sensor-runner + scaffold custom_sensors default

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push
gh pr create --base main --title "sensors parity 3/3: custom-sensor slot" \
  --body "project-manifest.json#custom_sensors[] lets a project add its own sensor via a command whose stdout flows through the sensor-schema default parser. Runs on demand (npm run custom-sensors) and at commit (opt-in blocking). Depends on PR 1.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes (author)

- **Spec coverage:** #1 → Tasks 1-3; #2a → Task 4; #2b → Task 5; #2 registration → Task 6; #3 config+runner → Task 7; #3 commit integration → Task 8; #3 registration+scaffold → Task 9. Byte-stability (Task 3 golden), safety invariant (Task 4 unwritable-ledger test), accruing-history (Task 5). All spec sections mapped.
- **Decline the daemon:** honored — no watch/daemon anywhere.
- **Type consistency:** canonical shape identical across `applyDefaults`/`parseDefault`/`normalize`; `recordOutcome`/`readOutcomes` row shape `{sensor,ran,blocked,ts}` consistent Tasks 4/5; `runAll`→`{sensors:[{id,result,blocking}],pass}` consistent Tasks 7/8.
- **Known repo caveat:** `npm test` can hang under iCloud sync — see CLAUDE.md "Working-tree hygiene".
