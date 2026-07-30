# G12 oasdiff Contract-Drift Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the long-referenced oasdiff API contract-drift gate: a deterministic check that runs `oasdiff breaking` between the git-base OpenAPI spec and the working tree, BLOCKing on breaking changes, surfaced in `/gate` and `npm run contract-drift`.

**Architecture:** `contract-drift-gate.js` detects an OpenAPI spec, extracts the base version via `git show`, runs `oasdiff breaking`, and gates on its exit code (version-robust). It degrades loudly (exit 0) when oasdiff or a spec is absent. `/gate` runs it boundary-gated when the spec changes; the `api-contract-drift` manifest sensor flips planned→active.

**Tech Stack:** Node.js (`node:test`, `child_process`); git; the external `oasdiff` CLI (optional); the harness registry.

## Global Constraints

- **Exit-code gating only:** rely on `oasdiff breaking`'s exit code (0 = no breaking, non-zero = breaking); capture its text verbatim into the verdict but never parse it for the gate decision.
- **Exit codes:** `0` = `pass` / `no-spec` / `new-spec` / `unprovisioned`; `1` = `breaking` (BLOCK).
- **Degrade loudly:** oasdiff not on PATH → `unprovisioned`, exit 0, with a message naming oasdiff. No OpenAPI spec → `no-spec`, exit 0.
- **Git-base comparison:** "before" = the spec at the base ref (resolve first of `origin/main`, `main`, `HEAD`); "after" = working tree. Spec absent at base → `new-spec`, exit 0.
- **`--oasdiff <bin>` injection** exists so tests supply a fake binary; the real oasdiff is NEVER required by the suite.
- **Hermetic tests:** use a local `git init` temp repo + a fake oasdiff script; no network, no real oasdiff.
- **Manifest honesty:** flipping `api-contract-drift` to active requires a `scope` (G11) — use `scope: "runtime"`. `validate-harness-manifest.js` must pass.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `.claude/scripts/contract-drift-gate.js` — the gate CLI (Task 1).
- **Create** `test/contract-drift-gate.test.js` — hermetic tests (Task 1).
- **Modify** `package.json` — `contract-drift` script (Task 1).
- **Modify** `.claude/skills/gate/SKILL.md`, `.claude/skills/keeping-refactors-pure/SKILL.md`, `harness-manifest.json`, `HARNESS.md`, `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md` — wiring + registry + docs (Task 2).

---

### Task 1: `contract-drift-gate.js` + hermetic test

**Files:**
- Create: `.claude/scripts/contract-drift-gate.js`
- Create: `test/contract-drift-gate.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: a CLI writing `specs/reviews/contract-drift-verdict.json` (`{verdict, spec?, base?, breaking_output?, message?}`); exit 0/1 per the constraints. Flags `--root`, `--base`, `--spec`, `--oasdiff`. Exposes `verdictFromExit(code)` for unit testing via `module.exports`.

- [ ] **Step 1: Write the failing test**

Create `test/contract-drift-gate.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'contract-drift-gate.js');
const { verdictFromExit } = require('../.claude/scripts/contract-drift-gate.js');

// A temp git repo with `openapi.yaml` committed at HEAD, then modified in the
// working tree, so `git show HEAD:openapi.yaml` (base) differs from the file.
function repoWithSpec() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), 'openapi: 3.0.0\npaths: {}\n');
  g(['add', '.']); g(['commit', '-qm', 'base']);
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), 'openapi: 3.0.0\npaths:\n  /x: {}\n'); // working change
  return dir;
}

function runGate(dir, extra) {
  let code = 0;
  try { execFileSync('node', [SCRIPT, '--root', dir, ...extra], { stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'contract-drift-verdict.json'), 'utf8'));
  return { code, v };
}

// A fake oasdiff: an executable script that exits with a fixed code.
function fakeOasdiff(dir, exitCode) {
  const p = path.join(dir, 'fake-oasdiff.sh');
  fs.writeFileSync(p, `#!/bin/sh\nexit ${exitCode}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

test('verdictFromExit: 0 -> pass, non-zero -> breaking', () => {
  assert.strictEqual(verdictFromExit(0), 'pass');
  assert.strictEqual(verdictFromExit(1), 'breaking');
});

test('no OpenAPI spec -> exit 0, verdict no-spec', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-'));
  const { code, v } = runGate(dir, []);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'no-spec');
});

test('oasdiff missing -> exit 0, verdict unprovisioned', () => {
  const dir = repoWithSpec();
  const { code, v } = runGate(dir, ['--oasdiff', '/no/such/oasdiff-bin']);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'unprovisioned');
  assert.ok(/oasdiff/i.test(v.message));
});

test('breaking changes (fake oasdiff exit 1) -> exit 1, verdict breaking', () => {
  const dir = repoWithSpec();
  const { code, v } = runGate(dir, ['--oasdiff', fakeOasdiff(dir, 1)]);
  assert.strictEqual(code, 1);
  assert.strictEqual(v.verdict, 'breaking');
});

test('no breaking (fake oasdiff exit 0) -> exit 0, verdict pass', () => {
  const dir = repoWithSpec();
  const { code, v } = runGate(dir, ['--oasdiff', fakeOasdiff(dir, 0)]);
  assert.strictEqual(code, 0);
  assert.strictEqual(v.verdict, 'pass');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contract-drift-gate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/contract-drift-gate.js`:

```javascript
#!/usr/bin/env node

'use strict';

// API contract-drift gate (gap G12, slice 1). Runs `oasdiff breaking` between
// the OpenAPI spec as committed at the base ref (the "before") and the
// working-tree spec (the "after"), and BLOCKs on breaking changes. Conditional:
// only acts when an OpenAPI spec exists. Degrades loudly (exit 0) when oasdiff
// is not installed — like security-scan with a missing semgrep/gitleaks.
//
// CLI: node .claude/scripts/contract-drift-gate.js [--root DIR] [--base REF]
//        [--spec PATH] [--oasdiff BIN]
// Exit 0 = pass / no-spec / new-spec / unprovisioned; 1 = breaking changes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SPEC_CANDIDATES = [
  'openapi.yaml', 'openapi.yml', 'openapi.json',
  'specs/design/openapi.yaml', 'specs/design/openapi.yml', 'specs/design/openapi.json',
];

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

function resolveSpecPath(root, manifest) {
  const declared = manifest && manifest.api && manifest.api.openapi_spec;
  if (declared && fs.existsSync(path.join(root, declared))) return declared;
  for (const c of SPEC_CANDIDATES) if (fs.existsSync(path.join(root, c))) return c;
  return null;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function resolveBase(root, explicit) {
  if (explicit) return explicit;
  for (const ref of ['origin/main', 'main', 'HEAD']) {
    try { git(root, ['rev-parse', '--verify', '--quiet', ref]); return ref; } catch (_) { /* next */ }
  }
  return null;
}

function extractBaseSpec(root, base, relPath) {
  try {
    const content = git(root, ['show', `${base}:${relPath}`]);
    const tmp = path.join(os.tmpdir(), `contract-base-${process.pid}-${path.basename(relPath)}`);
    fs.writeFileSync(tmp, content);
    return tmp;
  } catch (_) { return null; } // spec absent at base
}

function verdictFromExit(code) { return code === 0 ? 'pass' : 'breaking'; }

function runOasdiff(bin, baseSpec, current) {
  const res = spawnSync(bin, ['breaking', baseSpec, current, '--fail-on', 'ERR'], { encoding: 'utf8' });
  if (res.error && res.error.code === 'ENOENT') return { enoent: true };
  return { code: res.status == null ? 1 : res.status, output: (res.stdout || '') + (res.stderr || '') };
}

function finish(root, verdict, code) {
  try {
    const outDir = path.join(root, 'specs', 'reviews');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'contract-drift-verdict.json'), JSON.stringify(verdict, null, 2));
  } catch (e) { process.stderr.write(`contract-drift: could not write verdict: ${e.message}\n`); }
  process.stdout.write(`contract-drift: ${verdict.verdict}${verdict.message ? ' — ' + verdict.message : ''}\n`);
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); } catch (_) { /* none */ }
  const spec = arg(argv, '--spec', resolveSpecPath(root, manifest));
  if (!spec) return finish(root, { verdict: 'no-spec', message: 'no OpenAPI spec found — skipping' }, 0);
  const base = resolveBase(root, arg(argv, '--base', null));
  if (!base) return finish(root, { verdict: 'new-spec', spec, message: 'no base ref to diff against' }, 0);
  const baseSpec = extractBaseSpec(root, base, spec);
  if (!baseSpec) return finish(root, { verdict: 'new-spec', spec, base, message: 'spec absent at base — nothing to diff' }, 0);
  const r = runOasdiff(arg(argv, '--oasdiff', 'oasdiff'), baseSpec, path.join(root, spec));
  if (r.enoent) return finish(root, { verdict: 'unprovisioned', spec, base, message: 'oasdiff not on PATH — contract-drift skipped; install oasdiff to enforce' }, 0);
  const verdict = verdictFromExit(r.code);
  return finish(root, { verdict, spec, base, breaking_output: r.output }, verdict === 'breaking' ? 1 : 0);
}

module.exports = { verdictFromExit, resolveSpecPath };

if (require.main === module) main();
```

(If the pre-write 30-line cap trips `main`, extract a small helper; keep behavior/exit codes identical. Note `module.exports` is set BEFORE the `require.main` guard so the test can import `verdictFromExit` without running `main`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/contract-drift-gate.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the npm script**

In `package.json`, add to `scripts` (next to `"cycles"`):

```json
    "contract-drift": "node .claude/scripts/contract-drift-gate.js",
```

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/contract-drift-gate.js test/contract-drift-gate.test.js package.json
git commit -m "feat(g12): contract-drift-gate.js — oasdiff breaking-change gate (git-base)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire into /gate + keeping-refactors-pure + registry + docs

**Files:**
- Modify: `.claude/skills/gate/SKILL.md`
- Modify: `.claude/skills/keeping-refactors-pure/SKILL.md`
- Modify: `harness-manifest.json`
- Modify: `HARNESS.md`
- Modify: `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`
- Test: `test/contract-drift-gate.test.js` (append wiring assertions)

**Interfaces:**
- Consumes: `contract-drift-gate.js` + the `contract-drift` script from Task 1.
- Produces: `api-contract-drift` sensor `active`, `scope: "runtime"`, `wired_at` resolves.

- [ ] **Step 1: Write the failing test (append to `test/contract-drift-gate.test.js`)**

```javascript
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G12: contract-drift is wired + scripted + registered active', () => {
  assert.strictEqual(JSON.parse(rd('package.json')).scripts['contract-drift'], 'node .claude/scripts/contract-drift-gate.js');
  assert.ok(/contract-drift-gate\.js|contract-drift/.test(rd('.claude/skills/gate/SKILL.md')), '/gate must run contract-drift');
  assert.ok(/contract-drift/.test(rd('.claude/skills/keeping-refactors-pure/SKILL.md')), 'keeping-refactors-pure must point at the gate');
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'api-contract-drift');
  assert.ok(s, 'api-contract-drift sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'runtime');
  assert.ok(s.wired_at && fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contract-drift-gate.test.js`
Expected: FAIL — sensor still planned; docs not wired.

- [ ] **Step 3: Flip the manifest sensor to active**

In `harness-manifest.json`, replace the `api-contract-drift` entry (currently `"status": "planned", "wired_at": null, "gap_ref": "G12"`) with:

```json
    { "id": "api-contract-drift", "axis": "architecture", "type": "computational", "cadence": "commit", "status": "active", "scope": "runtime", "wired_at": ".claude/scripts/contract-drift-gate.js", "gap_ref": "G12", "signal": "breaking changes to an existing API's OpenAPI contract", "description": "Contract-drift gate (gap G12): contract-drift-gate.js runs `oasdiff breaking` between the OpenAPI spec at the git base and the working tree, BLOCKing on breaking changes. Boundary-gated in /gate (fires when the OpenAPI spec changes) + `npm run contract-drift`. Conditional on an OpenAPI spec existing; degrades loudly (exit 0) when oasdiff is unprovisioned. Exit-code gating only (version-robust)." }
```

- [ ] **Step 4: Run validator + the new test's manifest assertions**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: ... all wired_at paths resolve.`

- [ ] **Step 5: Wire `/gate`**

In `.claude/skills/gate/SKILL.md`, in the deterministic-checks / boundary section (near the `security-scan.js` boundary step, ~line 48), add:

```
- **Contract-drift (G12):** when the changed files include the project's OpenAPI spec (the same changed-files boundary used for security-scan), run `node .claude/scripts/contract-drift-gate.js`. It runs `oasdiff breaking` between the spec at the git base and the working tree; a `breaking` verdict (exit 1) is a **BLOCK** (writes `specs/reviews/contract-drift-verdict.json`). `no-spec` / `new-spec` / `unprovisioned` (oasdiff not installed) are non-blocking notes. When the diff does not touch an OpenAPI spec, skip it.
```

- [ ] **Step 6: Update `keeping-refactors-pure`**

In `.claude/skills/keeping-refactors-pure/SKILL.md`, change the oasdiff line (the "If an OpenAPI spec exists: `oasdiff` between the before/after specs must report zero breaking changes." requirement) to point at the wired gate:

```
- If an OpenAPI spec exists: run `npm run contract-drift` (it also fires automatically in `/gate` when the OpenAPI spec changes). It runs `oasdiff breaking` against the git-base spec and must report zero breaking changes; a breaking verdict blocks.
```

- [ ] **Step 7: Update `HARNESS.md`**

In the **Architecture** matrix *Sensors* cell, change `⛔ API contract-drift `oasdiff` gate (G12)` to `✅ **API contract-drift** (`oasdiff` breaking-change gate, /gate when the OpenAPI spec changes, G12)`.

In the holes line, change the G12 entry to note partial completion:

```
- **G12 (P2, partial)** — ✅ API contract-drift (`oasdiff`) gate shipped; remaining G12 slices: default-on axe/WCAG, approved-fixtures, flake detection.
```

- [ ] **Step 8: Update the gap analysis doc**

In `docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md`, update the G12 row status to note the oasdiff slice is done and the other three remain:

```
| 🟡 **PARTIAL** — ✅ API contract-drift (`oasdiff` breaking gate, `contract-drift-gate.js`, wired in `/gate` + `npm run contract-drift`). Remaining: default-on axe/WCAG, approved-fixtures, flake detection (separate slices; flake deferred per `TESTING_AGENT_PROPOSAL.md`). | **P2** |
```

In the §5 roadmap, note the oasdiff slice shipped.

- [ ] **Step 9: Run the new test + full suite**

Run: `node --test test/contract-drift-gate.test.js`
Expected: PASS (6 tests).
Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|cancelled)"`
Expected: `fail 0`, `cancelled 0` (or only the known scaffold/skills open-handle cancellations — report explicitly; do not loop npm test).

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/gate/SKILL.md .claude/skills/keeping-refactors-pure/SKILL.md harness-manifest.json HARNESS.md docs/internal/HARNESS_ENGINEERING_GAP_ANALYSIS.md test/contract-drift-gate.test.js
git commit -m "feat(g12): wire contract-drift into /gate + keeping-refactors-pure; activate sensor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 spec detection (manifest field + candidates + null) → Task 1 `resolveSpecPath` + no-spec test. ✅
- §2 gate (base resolution, git-show extraction, oasdiff exit-code gating, ENOENT degrade, verdict json, exit codes, pure `verdictFromExit`) → Task 1 + tests. ✅
- §3 /gate boundary integration → Task 2 Step 5 + wiring test. ✅
- §4 npm script + keeping-refactors-pure → Task 1 (script) + Task 2 Step 6. ✅
- §5 registry flip + scope:runtime + HARNESS/gap-doc → Task 2. ✅
- §6 hermetic tests (verdictFromExit, no-spec, unprovisioned, breaking/pass via fake oasdiff, wiring) → Tasks 1–2; `--oasdiff` injection keeps it CI-safe. ✅
- Risks: exit-code-only (Global Constraints + runOasdiff); repo-relative spec path (resolveSpecPath returns root-relative, git run with cwd=root); fake-oasdiff for hermetic test; base fallback chain (resolveBase). ✅

**Placeholder scan:** No TBD/TODO; full code in every step; commands have expected output. ✅

**Type/name consistency:** `verdictFromExit`/`resolveSpecPath` exported in Task 1 and imported in the test; verdict JSON shape (`{verdict, spec, base, breaking_output, message}`) consistent in `finish` calls and tests; flags `--root`/`--base`/`--spec`/`--oasdiff` consistent; `scope: "runtime"` identical in Task 2 manifest entry and the wiring test. ✅

**Test growth note:** `test/contract-drift-gate.test.js` is created in Task 1 (5 tests) and appended in Task 2 (→6).
