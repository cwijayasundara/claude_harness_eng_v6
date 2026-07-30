# G12 Approved-Fixtures Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock snapshot/golden test oracles: a baseline registry + a deterministic `/gate` check that blocks unreviewed snapshot changes/additions, with an `approve-fixtures` CLI to bless them.

**Architecture:** A pure `lib/fixtures.js` (snapshot detection, sha256 checksums, classify) backs two CLIs: `approved-fixtures-gate.js` (BLOCKs on modified/unapproved snapshots) and `approve-fixtures.js` (writes the baseline). Dormant when no snapshot files exist. Boundary-gated in `/gate`.

**Tech Stack:** Node.js (`node:test`, `crypto`); the sprint test-artefacts; the harness registry.

## Global Constraints

- **Snapshot file =** path contains `__snapshots__/` OR ends with `.snap` / `.ambr` / `.approved.txt` / `.approved.json`. Override via `project-manifest.json#approved_fixtures.patterns` (REPLACES the default list). Always exclude `node_modules/` and `.git/`.
- **Checksum = `sha256:<hex>`** of file bytes; paths are repo-root-relative, forward-slashed.
- **Classification:** in-found+baseline-match → ok; in-found+checksum-differs → modified (BLOCK); in-found+no-baseline → unapproved (BLOCK); in-baseline+missing → removed (WARN).
- **Gate exit:** `1` when any modified/unapproved; `0` for pass (incl. removed-only) and **`no-snapshots` (dormant — the harness's own repo must pass)**.
- **Baseline:** `specs/test_artefacts/approved-snapshots.json` — `[{path, checksum, approved_by, date}]`. `date`/`approved_by` are metadata the gate ignores.
- **No auto-update escape valve, no semantic diffing, no new skill, no multi-level workflow.**
- **Manifest:** `approved-fixtures-gate` sensor `scope: "repo"` (validator-accepted; NOT "test-artefacts").
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `.claude/hooks/lib/fixtures.js` — pure detection/checksum/classify (Task 1).
- **Create** `.claude/scripts/approved-fixtures-gate.js` + `test/approved-fixtures-gate.test.js` (Task 1).
- **Create** `.claude/scripts/approve-fixtures.js` + `test/approve-fixtures.test.js` (Task 2).
- **Modify** `package.json` — `approved-fixtures` + `approve-fixtures` scripts (Tasks 1–2).
- **Modify** `.claude/skills/gate/SKILL.md`, `harness-manifest.json`, `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` (Task 3).

---

### Task 1: `lib/fixtures.js` + gate script + tests

**Files:**
- Create: `.claude/hooks/lib/fixtures.js`, `.claude/scripts/approved-fixtures-gate.js`, `test/approved-fixtures-gate.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `lib/fixtures.js` exporting `DEFAULT_PATTERNS`, `findSnapshots(root, patterns)→string[]`, `checksumOf(root, rel)→"sha256:.."`, `readBaseline(path)→[]`, `classify(found, baseline, checksumFn)→{ok,modified,unapproved,removed}`, `resolvePatterns(manifest)→string[]`. Gate CLI exits 0/1.

- [ ] **Step 1: Write the failing test**

Create `test/approved-fixtures-gate.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'approved-fixtures-gate.js');
const lib = require('../.claude/hooks/lib/fixtures.js');

test('classify buckets ok/modified/unapproved/removed', () => {
  const found = ['a.snap', 'b.snap', 'c.snap'];
  const baseline = [
    { path: 'a.snap', checksum: 'sha256:AA' },
    { path: 'b.snap', checksum: 'sha256:OLD' },
    { path: 'd.snap', checksum: 'sha256:DD' },
  ];
  const sums = { 'a.snap': 'sha256:AA', 'b.snap': 'sha256:NEW', 'c.snap': 'sha256:CC' };
  const r = lib.classify(found, baseline, (rel) => sums[rel]);
  assert.deepStrictEqual(r.ok, ['a.snap']);
  assert.deepStrictEqual(r.modified, ['b.snap']);
  assert.deepStrictEqual(r.unapproved, ['c.snap']);
  assert.deepStrictEqual(r.removed, ['d.snap']);
});

// CLI helpers
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'af-')); }
function runGate(dir) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'approved-fixtures-verdict.json'), 'utf8'));
  return { code, v };
}
function sha(dir, rel) { return lib.checksumOf(dir, rel); }
function baseline(dir, entries) {
  const p = path.join(dir, 'specs', 'test_artefacts', 'approved-snapshots.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2));
}

test('no snapshot files -> no-snapshots, exit 0 (dormant)', () => {
  const dir = tmp();
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'no-snapshots');
});

test('approved + matching baseline -> pass, exit 0', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, [{ path: 'a.snap', checksum: sha(dir, 'a.snap'), approved_by: 'h', date: '2026-06-29' }]);
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'pass');
});

test('modified approved snapshot -> blocked, exit 1', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, [{ path: 'a.snap', checksum: sha(dir, 'a.snap') }]);
  fs.writeFileSync(path.join(dir, 'a.snap'), 'CHANGED');
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 1);
  assert.strictEqual(v.verdict, 'blocked');
  assert.ok(v.modified.includes('a.snap'));
});

test('new unapproved snapshot -> blocked, exit 1', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, []); // empty baseline
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 1);
  assert.ok(v.unapproved.includes('a.snap'));
});

test('removed approved snapshot -> WARN, exit 0', () => {
  const dir = tmp();
  baseline(dir, [{ path: 'gone.snap', checksum: 'sha256:ZZ' }]);
  // a snapshot must exist or the gate short-circuits to no-snapshots; add an approved one
  fs.writeFileSync(path.join(dir, 'a.snap'), 'X');
  baseline(dir, [
    { path: 'a.snap', checksum: sha(dir, 'a.snap') },
    { path: 'gone.snap', checksum: 'sha256:ZZ' },
  ]);
  const { code, v } = runGate(dir);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'pass');
  assert.ok(v.removed.includes('gone.snap'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/approved-fixtures-gate.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `lib/fixtures.js`**

Create `.claude/hooks/lib/fixtures.js`:

```javascript
'use strict';

// Pure helpers for the approved-fixtures gate (gap G12). Snapshot/golden files
// are oracles; this lib detects them, checksums them, and classifies them
// against an approved baseline. No process control — unit-testable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PATTERNS = ['__snapshots__/', '.snap', '.ambr', '.approved.txt', '.approved.json'];
const IGNORE = new Set(['node_modules', '.git']);

// A pattern ending in '/' is a path substring (e.g. __snapshots__/); otherwise a suffix.
function matches(rel, patterns) {
  const p = rel.replace(/\\/g, '/');
  return patterns.some((pat) => (pat.endsWith('/') ? p.includes(pat) : p.endsWith(pat)));
}

function walk(root, rel, patterns, acc) {
  let names;
  try { names = fs.readdirSync(path.join(root, rel)); } catch (_) { return acc; }
  for (const name of names) {
    if (IGNORE.has(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    let st;
    try { st = fs.statSync(path.join(root, r)); } catch (_) { continue; }
    if (st.isDirectory()) walk(root, r, patterns, acc);
    else if (matches(r, patterns)) acc.push(r);
  }
  return acc;
}

function findSnapshots(root, patterns) {
  return walk(root, '', patterns || DEFAULT_PATTERNS, []).sort();
}

function checksumOf(root, rel) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

function readBaseline(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; }
}

function classify(found, baseline, checksum) {
  const base = new Map(baseline.map((e) => [e.path, e.checksum]));
  const foundSet = new Set(found);
  const ok = [];
  const modified = [];
  const unapproved = [];
  const removed = [];
  for (const rel of found) {
    if (!base.has(rel)) unapproved.push(rel);
    else if (base.get(rel) !== checksum(rel)) modified.push(rel);
    else ok.push(rel);
  }
  for (const e of baseline) if (!foundSet.has(e.path)) removed.push(e.path);
  return { ok, modified, unapproved, removed };
}

function resolvePatterns(manifest) {
  const cfg = manifest && manifest.approved_fixtures && manifest.approved_fixtures.patterns;
  return Array.isArray(cfg) && cfg.length ? cfg : DEFAULT_PATTERNS;
}

module.exports = { DEFAULT_PATTERNS, findSnapshots, checksumOf, readBaseline, classify, resolvePatterns };
```

- [ ] **Step 4: Write `approved-fixtures-gate.js`**

Create `.claude/scripts/approved-fixtures-gate.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Approved-fixtures gate (gap G12, slice 3). Treats snapshot/golden files as
// locked oracles: BLOCKs when an approved snapshot's checksum changed (drift)
// or a new unapproved snapshot appears. Dormant (no-snapshots, exit 0) when a
// project has no snapshot files, so the harness's own repo is unaffected.
// Re-bless with approve-fixtures.js. Boundary-gated in /gate.
//
// CLI: node .claude/scripts/approved-fixtures-gate.js [--root DIR] [--baseline P] [--out P]
// Exit 0 = pass / no-snapshots; 1 = blocked (modified or unapproved).

const fs = require('fs');
const path = require('path');
const lib = require('../hooks/lib/fixtures.js');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

function finish(outPath, verdict, code, blocked) {
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2));
  } catch (e) { process.stderr.write(`approved-fixtures: could not write verdict: ${e.message}\n`); }
  process.stdout.write(`approved-fixtures: ${verdict.verdict} (modified ${verdict.modified.length}, unapproved ${verdict.unapproved.length}, removed ${verdict.removed.length})\n`);
  if (blocked) process.stdout.write('approved-fixtures: review then run `npm run approve-fixtures -- --all` to bless the current snapshot set.\n');
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const baselinePath = arg(argv, '--baseline', path.join(root, 'specs', 'test_artefacts', 'approved-snapshots.json'));
  const outPath = arg(argv, '--out', path.join(root, 'specs', 'reviews', 'approved-fixtures-verdict.json'));
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); } catch (_) { /* none */ }
  const found = lib.findSnapshots(root, lib.resolvePatterns(manifest));
  if (found.length === 0) return finish(outPath, { verdict: 'no-snapshots', modified: [], unapproved: [], removed: [], ok_count: 0 }, 0, false);
  const r = lib.classify(found, lib.readBaseline(baselinePath), (rel) => lib.checksumOf(root, rel));
  const blocked = r.modified.length > 0 || r.unapproved.length > 0;
  const verdict = { verdict: blocked ? 'blocked' : 'pass', modified: r.modified, unapproved: r.unapproved, removed: r.removed, ok_count: r.ok.length };
  return finish(outPath, verdict, blocked ? 1 : 0, blocked);
}

module.exports = {};

if (require.main === module) main();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/approved-fixtures-gate.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Add the gate npm script**

In `package.json` `scripts`, add (next to `"cycles"`):

```json
    "approved-fixtures": "node .claude/scripts/approved-fixtures-gate.js",
```

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/lib/fixtures.js .claude/scripts/approved-fixtures-gate.js test/approved-fixtures-gate.test.js package.json
git commit -m "feat(g12): approved-fixtures gate — lock snapshot oracles by checksum

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `approve-fixtures.js` CLI + round-trip test

**Files:**
- Create: `.claude/scripts/approve-fixtures.js`, `test/approve-fixtures.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `lib/fixtures.js` from Task 1.
- Produces: a CLI that writes/updates the baseline; `npm run approve-fixtures`.

- [ ] **Step 1: Write the failing test**

Create `test/approve-fixtures.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, '.claude', 'scripts', 'approved-fixtures-gate.js');
const APPROVE = path.join(ROOT, '.claude', 'scripts', 'approve-fixtures.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'af2-')); }
function gateCode(dir) {
  try { execFileSync('node', [GATE, '--root', dir], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; }
}

test('round-trip: gate blocks an unapproved snapshot, approve --all unblocks it', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'HELLO');
  assert.strictEqual(gateCode(dir), 1); // unapproved -> blocked
  execFileSync('node', [APPROVE, '--root', dir, '--all', '--approver', 'tester', '--date', '2026-06-29'], { stdio: 'pipe' });
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'test_artefacts', 'approved-snapshots.json'), 'utf8'));
  assert.strictEqual(base.length, 1);
  assert.strictEqual(base[0].path, 'a.snap');
  assert.ok(base[0].checksum.startsWith('sha256:'));
  assert.strictEqual(base[0].approved_by, 'tester');
  assert.strictEqual(gateCode(dir), 0); // now approved -> pass
});

test('approve --snapshots upserts only the named file, preserving others', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.snap'), 'A');
  fs.writeFileSync(path.join(dir, 'b.snap'), 'B');
  const p = path.join(dir, 'specs', 'test_artefacts', 'approved-snapshots.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify([{ path: 'a.snap', checksum: 'sha256:STALE', approved_by: 'old', date: '2026-01-01' }]));
  execFileSync('node', [APPROVE, '--root', dir, '--snapshots', 'b.snap', '--date', '2026-06-29'], { stdio: 'pipe' });
  const base = JSON.parse(fs.readFileSync(p, 'utf8'));
  const byPath = Object.fromEntries(base.map((e) => [e.path, e]));
  assert.ok(byPath['b.snap'], 'b.snap added');
  assert.strictEqual(byPath['a.snap'].checksum, 'sha256:STALE', 'a.snap entry preserved untouched');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/approve-fixtures.test.js`
Expected: FAIL — `approve-fixtures.js` not found.

- [ ] **Step 3: Write `approve-fixtures.js`**

Create `.claude/scripts/approve-fixtures.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Re-bless approved fixtures (gap G12, slice 3). Writes/updates the baseline
// specs/test_artefacts/approved-snapshots.json with current snapshot checksums.
// The unblock for approved-fixtures-gate.js after a reviewed snapshot change.
//
// CLI: node .claude/scripts/approve-fixtures.js [--root DIR] [--baseline P]
//        [--approver NAME] [--date YYYY-MM-DD] (--all | --snapshots f1 f2 ...)

const fs = require('fs');
const path = require('path');
const lib = require('../hooks/lib/fixtures.js');

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

function selected(argv) {
  const i = argv.indexOf('--snapshots');
  if (i === -1) return null;
  const out = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
  return out;
}

function entriesFor(root, baselinePath, argv, meta) {
  const patterns = (() => {
    try { return lib.resolvePatterns(JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8'))); }
    catch (_) { return lib.DEFAULT_PATTERNS; }
  })();
  const mk = (rel) => ({ path: rel, checksum: lib.checksumOf(root, rel), approved_by: meta.approver, date: meta.date });
  if (argv.includes('--all')) return lib.findSnapshots(root, patterns).map(mk);
  const map = new Map(lib.readBaseline(baselinePath).map((e) => [e.path, e]));
  for (const rel of selected(argv) || []) map.set(rel, mk(rel));
  return [...map.values()];
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const baselinePath = arg(argv, '--baseline', path.join(root, 'specs', 'test_artefacts', 'approved-snapshots.json'));
  const meta = { approver: arg(argv, '--approver', 'human'), date: arg(argv, '--date', new Date().toISOString().slice(0, 10)) };
  const entries = entriesFor(root, baselinePath, argv, meta).sort((a, b) => (a.path < b.path ? -1 : 1));
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(entries, null, 2) + '\n');
  process.stdout.write(`approve-fixtures: baseline now has ${entries.length} approved snapshot(s)\n`);
  process.exit(0);
}

module.exports = {};

if (require.main === module) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/approve-fixtures.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the approve npm script**

In `package.json` `scripts`, add (next to `"approved-fixtures"`):

```json
    "approve-fixtures": "node .claude/scripts/approve-fixtures.js",
```

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/approve-fixtures.js test/approve-fixtures.test.js package.json
git commit -m "feat(g12): approve-fixtures CLI — bless snapshots into the baseline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire into /gate + registry + docs + dormancy check

**Files:**
- Modify: `.claude/skills/gate/SKILL.md`, `harness-manifest.json`, `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`
- Test: `test/approved-fixtures-gate.test.js` (append wiring + dormancy assertions)

**Interfaces:**
- Consumes: the gate script + lib from Task 1.
- Produces: `approved-fixtures-gate` sensor `active`, `scope:"repo"`, `wired_at` resolves.

- [ ] **Step 1: Write the failing test (append to `test/approved-fixtures-gate.test.js`)**

```javascript
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G12: approved-fixtures is wired + registered active', () => {
  assert.ok(/approved-fixtures-gate\.js|approved-fixtures/.test(rd('.claude/skills/gate/SKILL.md')), '/gate must run the gate');
  assert.strictEqual(JSON.parse(rd('package.json')).scripts['approved-fixtures'], 'node .claude/scripts/approved-fixtures-gate.js');
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'approved-fixtures-gate');
  assert.ok(s, 'approved-fixtures-gate sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'repo');
  assert.ok(s.wired_at && fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
});

test('G12: gate is dormant on the harness repo (no snapshot files -> exit 0)', () => {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', ROOT, '--out', path.join(os.tmpdir(), `af-harness-${process.pid}.json`)], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  assert.strictEqual(code, 0); // the harness uses node:test assertions, not snapshot files
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/approved-fixtures-gate.test.js`
Expected: FAIL — sensor not registered; /gate not wired. (The dormancy test should already pass if the harness has no snapshot files — if it FAILS, the harness contains a matching file; report it so we can scope the patterns.)

- [ ] **Step 3: Register the sensor in `harness-manifest.json`**

Add to the `sensors` array:

```json
    { "id": "approved-fixtures-gate", "axis": "behaviour", "type": "computational", "cadence": "commit", "status": "active", "scope": "repo", "wired_at": ".claude/scripts/approved-fixtures-gate.js", "gap_ref": "G12", "signal": "snapshot oracle modified or added without re-approval", "description": "Approved-fixtures gate (gap G12): tracks a baseline of approved snapshot files (path+sha256 in specs/test_artefacts/approved-snapshots.json) and BLOCKs in /gate when an approved snapshot's checksum changed or a new unapproved snapshot appears; approve-fixtures.js (npm run approve-fixtures) re-blesses. Dormant (exit 0) when a project has no snapshot files. Stops agents silently regenerating oracles to pass tests." }
```

- [ ] **Step 4: Run validator**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`

- [ ] **Step 5: Wire `/gate`**

In `.claude/skills/gate/SKILL.md`, near the security-scan/contract-drift boundary steps, add:

```
- **Approved-fixtures (G12):** when the changed files include any snapshot file (path contains `__snapshots__/` or ends with `.snap`/`.ambr`/`.approved.*`), run `node .claude/scripts/approved-fixtures-gate.js`. It checksums every snapshot against the approved baseline (`specs/test_artefacts/approved-snapshots.json`); a `blocked` verdict (a modified approved snapshot or a new unapproved one, exit 1) is a **BLOCK** (writes `specs/reviews/approved-fixtures-verdict.json`). After reviewing the change, re-bless with `npm run approve-fixtures -- --all` (or `-- --snapshots <files>`). `no-snapshots` / `pass` (removed-only WARN) are non-blocking. When the diff touches no snapshot files, skip.
```

- [ ] **Step 6: Update `HARNESS.md`**

In the **Behaviour** *Sensors* cell, add `· ✅ **approved-fixtures** (snapshot-oracle lock, /gate, G12)`.

In the holes line, update the G12 entry:

```
- **G12 (P2, partial)** — ✅ API contract-drift (`oasdiff`) + ✅ default-on axe/WCAG + ✅ approved-fixtures (snapshot-oracle lock) shipped; remaining G12 slice: flake detection.
```

- [ ] **Step 7: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, add ✅ approved-fixtures to the G12 row's done list (3 of 4 slices) and the §5 roadmap; note flake detection is the only remaining G12 slice (deferred per `TESTING_AGENT_PROPOSAL.md`).

- [ ] **Step 8: Run the new tests + full suite**

Run: `node --test test/approved-fixtures-gate.test.js test/approve-fixtures.test.js`
Expected: PASS (8 + 2).
Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|cancelled)"`
Expected: `fail 0`, `cancelled 0` (or only the known scaffold/skills open-handle cancellations — report explicitly; do not loop npm test).

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/gate/SKILL.md harness-manifest.json HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/approved-fixtures-gate.test.js
git commit -m "feat(g12): wire approved-fixtures into /gate; register sensor active

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 detection + baseline → Task 1 (`lib/fixtures.js` patterns/checksum/classify). ✅
- §2 gate (glob, classify, verdict, exit, no-snapshots dormancy) → Task 1 gate + tests. ✅
- §3 approve CLI (`--all` / `--snapshots`, metadata, date default + `--date`) → Task 2 + round-trip test. ✅
- §4 /gate boundary wiring + npm scripts → Task 3 Step 5 + Tasks 1–2 scripts. ✅
- §5 registry (`scope:"repo"`) + HARNESS + gap-doc → Task 3. ✅
- §6 tests (classify unit, pass/modified/unapproved/removed/no-snapshots, round-trip, upsert, wiring, harness dormancy) → Tasks 1–3. ✅
- Risks: harness-repo dormancy (Task 3 dormancy test); Date available in node CLI (Task 2 uses `new Date()` with `--date` override); pattern over/under-match (default + manifest override). ✅

**Placeholder scan:** No TBD/TODO; full code in every step; commands have expected output. ✅

**Type/name consistency:** `lib/fixtures.js` exports (`findSnapshots`, `checksumOf`, `readBaseline`, `classify`, `resolvePatterns`, `DEFAULT_PATTERNS`) used identically in the gate (Task 1) and approve CLI (Task 2); verdict shape `{verdict, modified, unapproved, removed, ok_count}` consistent in gate impl + tests; baseline entry `{path, checksum, approved_by, date}` consistent across gate/approve/tests; `scope:"repo"` identical in Task 3 manifest + wiring test. ✅

**Test growth note:** `test/approved-fixtures-gate.test.js` is created in Task 1 (6 tests) and appended in Task 3 (→8). `test/approve-fixtures.test.js` is Task 2 (2 tests).
```
