# Duplication-Gate (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, ratcheting `duplication-gate` that blocks a commit which introduces a *new* code-clone occurrence above a grandfathered baseline — the P0 slice of the [evolution-loop mechanism spec](../specs/2026-07-17-evolution-loop-harness-mechanism-design.md).

**Architecture:** Mirror the existing `coupling-gate` exactly: a pure-logic lib (`.claude/hooks/lib/duplication-gate.js`) that turns a jscpd clone report into a sorted set of stable occurrence keys and reuses the canonical monotonic `gateDecision`, plus a CLI (`.claude/scripts/duplication-gate.js`) that spawns jscpd, reads/writes a plaintext baseline, and blocks/passes with exit codes. jscpd is a PATH-provisioned external tool (like semgrep/gitleaks/oasdiff) — the gate degrades **loudly** (exit 0 + warning) when it is absent, so CI stays green without it while the pure logic is fully unit-tested.

**Tech Stack:** Node.js (CommonJS), `node:test`, `child_process.spawnSync`, jscpd (clone detector, PATH binary).

## Global Constraints

- **Purely additive.** Do NOT modify or retire `duplicationCandidates()` in `.claude/hooks/lib/modularity-pack.js` or `modularity-reviewer` — that import-set heuristic is a separate planning-cadence/inferential sensor and is out of scope for P0.
- **Mirror `coupling-gate`, do not invent.** Every registration touchpoint has an existing `coupling-ratchet` sibling; copy its structure verbatim, substituting the duplication logic. Existing siblings: `.claude/scripts/coupling-gate.js`, `.claude/hooks/lib/coupling-gate.js`, `.claude/hooks/lib/gates-strict.js` (`checkCouplingRatchet`), `.claude/hooks/lib/gate-registry.js` (`GATE_CATALOG` entry `coupling-ratchet` at `order: 210`), `.claude/hooks/lib/sensor-tier.js` (`GATE_TIERS`), `harness-manifest.json` (`coupling-ratchet` sensor), `test/coupling-gate.test.js`, `test/coupling-gate-wiring-contract.test.js`.
- **Tier:** strict-only, matching cycle/coupling (`new Set(['strict'])`).
- **Ratchet contract:** first run with no baseline establishes it without blocking (`baselineRun`); a block never moves the baseline up; a clean run rewrites the baseline (ratchets down when clones are removed).
- **Reuse `gateDecision`:** `require('./cycle-gate').gateDecision` — never reimplement the ratchet math.
- **Loud degrade:** when jscpd is absent (`ENOENT`/status 127) or produces no report, announce and exit 0 — never a silent clean pass (harness convention, `security-scan.js:5-7`).
- **Run the full suite** with `node --test test/*.test.js` before the final commit.

---

### Task 1: Pure ratchet logic (`hooks/lib/duplication-gate.js`)

**Files:**
- Create: `.claude/hooks/lib/duplication-gate.js`
- Test: `test/duplication-gate.test.js`

**Interfaces:**
- Consumes: `require('./cycle-gate').gateDecision` — `gateDecision(keys: string[], baseline: number|undefined) -> { count, baseline, blocked, newBaseline, baselineRun }`.
- Produces: `cloneKeys(report: object) -> string[]` (sorted, deduped occurrence keys of form `"<fragmentHash8>:<filePath>"`); re-exports `gateDecision`.

- [ ] **Step 1: Write the failing test**

```js
// test/duplication-gate.test.js
'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { cloneKeys, gateDecision } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'duplication-gate.js')
);

// A minimal jscpd-report shape: { duplicates: [{ fragment, firstFile:{name}, secondFile:{name} }] }
const report = {
  duplicates: [
    { fragment: 'function parseAmount(x){ return x }', firstFile: { name: 'a.js' }, secondFile: { name: 'b.js' } },
  ],
};

test('cloneKeys yields one sorted occurrence key per participating file', () => {
  const keys = cloneKeys(report);
  assert.strictEqual(keys.length, 2);
  assert.ok(keys.every((k) => /^[0-9a-f]{8}:/.test(k)), 'each key is <hash8>:<file>');
  assert.ok(keys[0].endsWith(':a.js') && keys[1].endsWith(':b.js'));
  assert.deepStrictEqual(keys, [...keys].sort(), 'keys are sorted');
});

test('identical fragments in the same file collapse to one key', () => {
  const dup = { duplicates: [
    { fragment: 'X', firstFile: { name: 'a.js' }, secondFile: { name: 'a.js' } },
  ] };
  assert.strictEqual(cloneKeys(dup).length, 1);
});

test('whitespace-only differences hash to the same fragment', () => {
  const a = cloneKeys({ duplicates: [{ fragment: 'a  b\n c', firstFile: { name: 'f.js' }, secondFile: { name: 'g.js' } }] });
  const b = cloneKeys({ duplicates: [{ fragment: 'a b c',    firstFile: { name: 'f.js' }, secondFile: { name: 'g.js' } }] });
  assert.strictEqual(a[0].split(':')[0], b[0].split(':')[0], 'same fragment hash regardless of whitespace');
});

test('empty / missing duplicates yields no keys', () => {
  assert.deepStrictEqual(cloneKeys({}), []);
  assert.deepStrictEqual(cloneKeys({ duplicates: [] }), []);
});

test('gateDecision blocks when clone occurrences rise above baseline', () => {
  const d = gateDecision(['h:a.js', 'h:b.js', 'h:c.js'], 2);
  assert.strictEqual(d.count, 3);
  assert.strictEqual(d.blocked, true);
  assert.strictEqual(d.newBaseline, 2, 'baseline must not move up on a block');
});

test('first run establishes the baseline without blocking (grandfathering)', () => {
  const d = gateDecision(['h:a.js', 'h:b.js'], undefined);
  assert.strictEqual(d.blocked, false);
  assert.strictEqual(d.baselineRun, true);
  assert.strictEqual(d.newBaseline, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/duplication-gate.test.js`
Expected: FAIL — `Cannot find module '.../.claude/hooks/lib/duplication-gate.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// .claude/hooks/lib/duplication-gate.js
'use strict';

// Pure logic for the duplication ratchet. Turns a jscpd clone report into a
// sorted, deduped set of stable occurrence keys ("<fragmentHash8>:<file>"),
// then reuses the canonical monotonic gateDecision (same as cycle/coupling).
// A NEW clone occurrence (new file entering a clone relationship) raises the
// count and is blocked; pre-existing clones are grandfathered by the baseline.

const crypto = require('crypto');
const { gateDecision } = require('./cycle-gate');

function fragmentHash(fragment) {
  const norm = String(fragment || '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 8);
}

function cloneKeys(report) {
  const dups = (report && report.duplicates) || [];
  const keys = new Set();
  for (const d of dups) {
    const h = fragmentHash(d.fragment);
    for (const f of [d.firstFile, d.secondFile]) {
      if (f && f.name) keys.add(`${h}:${f.name}`);
    }
  }
  return [...keys].sort();
}

module.exports = { fragmentHash, cloneKeys, gateDecision };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/duplication-gate.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/duplication-gate.js test/duplication-gate.test.js
git commit -m "feat(duplication-gate): pure clone-ratchet logic (cloneKeys + gateDecision reuse)"
```

---

### Task 2: CLI script + npm script (`scripts/duplication-gate.js`)

**Files:**
- Create: `.claude/scripts/duplication-gate.js`
- Modify: `package.json` (scripts block, after the `coupling-gate` line)
- Test: `test/duplication-gate-wiring-contract.test.js` (create)

**Interfaces:**
- Consumes: `cloneKeys` from `../hooks/lib/duplication-gate`; `gateDecision` from `../hooks/lib/cycle-gate`.
- Produces (for reuse by the pre-commit wrapper in Task 3): `runJscpd(targets: string[]) -> { report } | { unavailable: true }`, `readBaseline() -> string[]|undefined`, `writeBaseline(keys: string[]) -> void`.
- Baseline file: `.claude/state/duplication-baseline.txt` (one key per line, mirrors `coupling-baseline.txt`).

- [ ] **Step 1: Write the failing wiring-contract test**

```js
// test/duplication-gate-wiring-contract.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('duplication-gate CLI exists and reuses the tested lib', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/duplication-gate.js')));
  const cli = read('.claude/scripts/duplication-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/duplication-gate'\)/, 'CLI must use the tested lib');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/cycle-gate'\)/, 'CLI must reuse gateDecision');
  assert.match(cli, /require\.main === module/, 'CLI must be require-safe');
});

test('package.json exposes the duplication-gate script', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['duplication-gate'], 'node .claude/scripts/duplication-gate.js');
});

test('CLI degrades loudly (exit 0) when jscpd is unavailable', () => {
  // Force jscpd absent by running with an empty PATH; the gate must exit 0 and announce.
  const { execFileSync } = require('child_process');
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', ['.claude/scripts/duplication-gate.js', '.'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: '' } });
  } catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
  assert.strictEqual(code, 0, 'must not block when the tool is missing');
  assert.match(out, /jscpd.*(not installed|unprovisioned|unavailable)/i, 'must announce the skip loudly');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/duplication-gate-wiring-contract.test.js`
Expected: FAIL — CLI file missing / `pkg.scripts['duplication-gate']` undefined.

- [ ] **Step 3: Write the CLI**

```js
// .claude/scripts/duplication-gate.js
#!/usr/bin/env node
'use strict';

// Duplication ratchet — blocks a commit that adds a NEW code-clone occurrence
// above a grandfathered baseline. Mirrors coupling-gate.js's shape exactly
// (set-of-keys baseline, count-based block decision, names the new offenders).
// Wraps jscpd (a PATH binary); degrades LOUDLY (exit 0 + warning) when jscpd is
// absent. Invoked by: /gate, /auto Gate 4, and `npm run duplication-gate`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { cloneKeys } = require('../hooks/lib/duplication-gate');
const { gateDecision } = require('../hooks/lib/cycle-gate');

const REPO = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(REPO, '.claude', 'state', 'duplication-baseline.txt');
const IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**',
  '**/test/**', '**/tests/**', '**/*.test.js', '**/specs/**', '**/.claude/state/**',
];

function readBaseline() {
  try {
    return fs.readFileSync(BASELINE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) { return undefined; }
}

function writeBaseline(keys) {
  try {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, keys.length ? `${keys.join('\n')}\n` : '');
  } catch (_) { /* best effort */ }
}

function runJscpd(targets) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-'));
  const argv = ['jscpd', '--silent', '--reporters', 'json', '--output', out,
    ...IGNORE.flatMap((g) => ['--ignore', g]), ...targets];
  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: REPO, timeout: 120000 });
  if ((res.error && res.error.code === 'ENOENT') || res.status === 127) return { unavailable: true };
  try {
    return { report: JSON.parse(fs.readFileSync(path.join(out, 'jscpd-report.json'), 'utf8')) };
  } catch (_) {
    return { unavailable: true }; // ran but produced no parseable report — loud skip
  }
}

function blockMessage(d, added) {
  const lines = added.map((k) => `  - new clone occurrence in ${k.split(':').slice(1).join(':') || k}`);
  return [
    `duplication-gate: BLOCK — clone occurrences rose ${d.baseline} -> ${d.count}.`,
    'A change introduced new code duplication above the ratchet baseline.',
    ...lines,
    'Fix: extend the existing implementation or extract a shared function instead of copy-pasting.',
    'The baseline was NOT moved up. To grandfather intentional duplication, edit',
    '.claude/state/duplication-baseline.txt in a reviewed commit.',
    '',
  ].join('\n');
}

function main() {
  const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const { report, unavailable } = runJscpd(targets.length ? targets : ['.']);
  if (unavailable) {
    process.stdout.write('duplication-gate: jscpd not installed or unprovisioned — skipped (LOUD). Install jscpd to enable the clone ratchet.\n');
    process.exit(0);
  }
  const keys = cloneKeys(report);
  const baseline = readBaseline();
  const d = gateDecision(keys, baseline ? baseline.length : undefined);
  if (d.blocked) {
    const prev = new Set(baseline || []);
    process.stderr.write(blockMessage(d, keys.filter((k) => !prev.has(k))));
    process.exit(1);
  }
  writeBaseline(keys);
  process.stdout.write(`duplication-gate: PASS (${d.count} clone occurrences${d.baselineRun ? ', baseline established' : ''}).\n`);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { runJscpd, readBaseline, writeBaseline };
```

- [ ] **Step 4: Add the npm script**

In `package.json`, immediately after the line `"coupling-gate": "node .claude/scripts/coupling-gate.js",` add:

```json
    "duplication-gate": "node .claude/scripts/duplication-gate.js",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/duplication-gate-wiring-contract.test.js`
Expected: PASS (3 tests). The loud-degrade test exercises the real CLI with an empty `PATH`, proving it exits 0 and announces.

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/duplication-gate.js package.json test/duplication-gate-wiring-contract.test.js
git commit -m "feat(duplication-gate): CLI with jscpd spawn, baseline ratchet, loud degrade"
```

---

### Task 3: Pre-commit registration (strict tier)

**Files:**
- Modify: `.claude/hooks/lib/gates-strict.js` (add `checkDuplicationRatchet`, mirror `checkCouplingRatchet`)
- Modify: `.claude/hooks/lib/gate-registry.js` (`GATE_CATALOG`, add entry at `order: 220`)
- Modify: `.claude/hooks/lib/sensor-tier.js` (`GATE_TIERS`, add `'duplication-ratchet'`)
- Test: `test/gate-registry.test.js` (add assertion for the new catalog id)

**Interfaces:**
- Consumes: `runJscpd`, `readBaseline`, `writeBaseline` from `../../scripts/duplication-gate`; `cloneKeys` from `./duplication-gate`; `gateDecision` from `./cycle-gate`; the existing `ctx.failBlock({ id, title, detail, fix, minTier })` used by `checkCouplingRatchet`.
- Produces: `checkDuplicationRatchet(ctx)` exported from `gates-strict.js`; `GATE_CATALOG` id `'duplication-ratchet'` reachable via `strictRun('checkDuplicationRatchet')`.

- [ ] **Step 1: Read the sibling to copy its exact ctx API**

Read `.claude/hooks/lib/gates-strict.js` `checkCouplingRatchet` (approx lines 48-96). Note the exact `ctx.failBlock({...})` field names and the baseline read/write it performs — the new function must use the identical `ctx` API.

- [ ] **Step 2: Write the failing test**

In `test/gate-registry.test.js`, add:

```js
test('duplication-ratchet is registered in the GATE_CATALOG at strict tier', () => {
  const { GATE_CATALOG } = require(path.resolve(__dirname, '..', '.claude/hooks/lib/gate-registry.js'));
  const entry = GATE_CATALOG.find((g) => g.id === 'duplication-ratchet');
  assert.ok(entry, 'duplication-ratchet must be in the catalog');
  assert.strictEqual(entry.runsWithoutSource, false);
  assert.strictEqual(typeof entry.run, 'function');
  const { GATE_TIERS } = require(path.resolve(__dirname, '..', '.claude/hooks/lib/sensor-tier.js'));
  assert.ok(GATE_TIERS['duplication-ratchet'].has('strict'));
});
```

(Match the existing require style already used in `test/gate-registry.test.js`; if it imports these differently, follow that file's convention.)

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/gate-registry.test.js`
Expected: FAIL — no `duplication-ratchet` entry.

- [ ] **Step 4: Add `checkDuplicationRatchet` to `gates-strict.js`**

Add this function, mirroring `checkCouplingRatchet`'s structure (substitute the `ctx.failBlock` call with your sibling's exact field names if they differ):

```js
function checkDuplicationRatchet(ctx) {
  const { runJscpd, readBaseline, writeBaseline } = require('../../scripts/duplication-gate');
  const { cloneKeys } = require('./duplication-gate');
  const { gateDecision } = require('./cycle-gate');
  const { report, unavailable } = runJscpd(['.']);
  if (unavailable) {
    if (typeof ctx.note === 'function') ctx.note('duplication-gate: jscpd unprovisioned — skipped (loud)');
    return;
  }
  const keys = cloneKeys(report);
  const baseline = readBaseline();
  const d = gateDecision(keys, baseline ? baseline.length : undefined);
  if (d.blocked) {
    const prev = new Set(baseline || []);
    const added = keys.filter((k) => !prev.has(k)).map((k) => k.split(':').slice(1).join(':'));
    ctx.failBlock({
      id: 'duplication-ratchet',
      title: `Clone occurrences rose ${d.baseline} -> ${d.count}`,
      detail: added.join(', '),
      fix: 'Extend existing code or extract a shared function instead of copy-pasting.',
      minTier: 'strict',
    });
    return;
  }
  writeBaseline(keys);
}
```

Add `checkDuplicationRatchet` to the `module.exports` of `gates-strict.js` alongside `checkCouplingRatchet`.

- [ ] **Step 5: Register in `GATE_CATALOG` (`gate-registry.js`)**

Immediately after the `coupling-ratchet` entry (`order: 210`), add:

```js
  { id: 'duplication-ratchet', order: 220, runsWithoutSource: false, run: strictRun('checkDuplicationRatchet') },
```

- [ ] **Step 6: Register the tier (`sensor-tier.js`)**

In `GATE_TIERS`, after the `'coupling-ratchet'` line, add:

```js
  'duplication-ratchet': new Set(['strict']),
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/gate-registry.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .claude/hooks/lib/gates-strict.js .claude/hooks/lib/gate-registry.js .claude/hooks/lib/sensor-tier.js test/gate-registry.test.js
git commit -m "feat(duplication-gate): register strict-tier pre-commit gate"
```

---

### Task 4: Wire into /auto Gate 4 and /gate

**Files:**
- Modify: the `/auto` skill corpus file that invokes the Gate-4 ratchets (where `cycle-gate.js` / `npm run cycles` appears — likely `.claude/skills/auto/references/section-5-5-ratchet-gate-step-5.md`)
- Modify: the `/gate` skill file that invokes the ratchets (where `coupling-gate` appears — likely `.claude/skills/gate/SKILL.md`)
- Test: extend `test/duplication-gate-wiring-contract.test.js`

**Interfaces:**
- Consumes: the existing `readSkillCorpus('auto')` / `readSkillCorpus('gate')` test helper used by `test/cycle-gate-wiring-contract.test.js`.

- [ ] **Step 1: Write the failing wiring assertions**

Append to `test/duplication-gate-wiring-contract.test.js` (import `readSkillCorpus` the same way `test/cycle-gate-wiring-contract.test.js` does):

```js
const { readSkillCorpus } = require('./helpers/skill-corpus'); // match cycle-gate-wiring-contract's import path

test('/auto Gate 4 runs the duplication ratchet', () => {
  assert.match(readSkillCorpus('auto'), /duplication-gate\.js/, 'Gate 4 must run the duplication ratchet');
});
test('/gate runs the duplication ratchet', () => {
  assert.match(readSkillCorpus('gate'), /duplication-gate\.js/, '/gate must run the duplication ratchet');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/duplication-gate-wiring-contract.test.js`
Expected: FAIL — corpus does not mention `duplication-gate.js`.

- [ ] **Step 3: Add the invocation to /auto Gate 4**

In the `/auto` Gate-4 reference file, wherever `cycles` / `coupling-gate` are listed as the commands the gate runs, add a sibling line:

```
node .claude/scripts/duplication-gate.js   # duplication ratchet — blocks new code clones
```

Follow the exact list/format the file already uses for `cycle-gate.js` and `coupling-gate.js` (bullet, table row, or fenced command — match the surrounding style).

- [ ] **Step 4: Add the invocation to /gate**

In the `/gate` skill file, in the same step that runs the cycle/coupling ratchets (Step 2 per the spec), add the identical `node .claude/scripts/duplication-gate.js` line in the file's existing style.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/duplication-gate-wiring-contract.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/duplication-gate-wiring-contract.test.js .claude/skills/auto .claude/skills/gate
git commit -m "feat(duplication-gate): wire into /auto Gate 4 and /gate"
```

---

### Task 5: Manifest registration, baseline, full suite

**Files:**
- Modify: `harness-manifest.json` (add `duplication-ratchet` to `sensors[]`)
- Create: `.claude/state/duplication-baseline.txt` (establish this repo's baseline)
- Modify: `.claude/hooks/lib/sensor-tier.js` doc comment / `harness-manifest.json:33` tier description (append `duplication-ratchet` to the strict-tier list text)

**Interfaces:**
- Validated by: `.claude/scripts/validate-harness-manifest.js` (`node .claude/scripts/validate-harness-manifest.js`).

- [ ] **Step 1: Add the manifest sensor entry**

In `harness-manifest.json`, immediately after the `coupling-ratchet` sensor entry, add (matching field order of the sibling):

```json
{ "id": "duplication-ratchet", "axis": "architecture", "type": "computational", "cadence": "commit", "status": "active", "scope": "repo", "wired_at": ".claude/scripts/duplication-gate.js", "signal": "a change added a code clone above the grandfathered baseline", "description": "jscpd-backed clone ratchet; blocks new duplicate code, grandfathers existing. Degrades loudly when jscpd is unprovisioned." }
```

Update the strict-tier description text (`harness-manifest.json:33`, which reads "...architecture ratchets at commit (cycle-detection, coupling-ratchet)") to include `duplication-ratchet`.

- [ ] **Step 2: Validate the manifest**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exit 0, no errors (all required fields present; `wired_at` exists on disk).

- [ ] **Step 3: Establish this repo's baseline (loud-skip tolerant)**

Run: `npm run duplication-gate`
Expected outcome:
- If jscpd is on PATH: prints `duplication-gate: PASS (N clone occurrences, baseline established).` and writes `.claude/state/duplication-baseline.txt`. Add that file.
- If jscpd is absent: prints the loud-skip message and exits 0 (no baseline file yet). This is acceptable — the gate is registered and will establish the baseline on the first run in a jscpd-provisioned environment. Note the tool as a follow-up provisioning step (like semgrep/gitleaks) in the project's `init.sh`; do NOT add jscpd as an npm devDependency.

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: PASS (existing suite green + the new duplication-gate tests). If the iCloud-sync ` 2.`-dup-file hang occurs (see root `CLAUDE.md`), kill orphaned `node --test` processes, delete the ` 2.`-suffixed dupes, and re-run.

- [ ] **Step 5: Commit**

```bash
git add harness-manifest.json .claude/hooks/lib/sensor-tier.js
git add .claude/state/duplication-baseline.txt 2>/dev/null || true
git commit -m "feat(duplication-gate): register sensor in harness manifest + establish baseline"
```

---

## Self-Review

- **Spec coverage:** Implements spec §3-C5 (`duplication-gate` half — the `seam-conformance-gate` half is P2, out of scope here) and §7 phase P0. The spec's "retire the import-set heuristic" (§3-C5/§10) is deliberately **deferred** per the Global Constraints (explorer confirmed it's a distinct sensor); flagged for a later decision, not a gap in P0.
- **Placeholder scan:** No TBD/TODO; every code step shows complete code. Tasks 3-4 registration steps reference sibling files to copy `ctx`/corpus-format conventions verbatim — the substituted logic is given in full; this is pattern-following, not a placeholder.
- **Type consistency:** `cloneKeys` returns `string[]` everywhere; `gateDecision(keys, baseline)` used identically in lib, CLI, and `gates-strict`; baseline is always the plaintext key set whose `.length` is the ratchet count. Gate id `'duplication-ratchet'` is consistent across catalog, tier, manifest, and tests; the script/CLI basename `duplication-gate.js` is consistent across package.json, corpus wiring, and `wired_at`.
- **Follow-ups (not P0):** provision jscpd on PATH in `init.sh`; decide whether to retire/keep `duplicationCandidates()`; P1 dialogue + P2 seam-conformance + P3 performance axis per the spec.
