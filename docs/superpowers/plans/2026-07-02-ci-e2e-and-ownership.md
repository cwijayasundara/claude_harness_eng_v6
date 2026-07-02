# E2E CI Template + Ownership Sensor Implementation Plan (Audit Fix #4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two session-only-enforcement gaps: (a) nothing re-runs the generated Playwright e2e suite outside a Claude session — ship a GitHub Actions template; (b) "every file traces to a story" is a stated rule with no sensor — ship `ownership-check.js` diffing changed files against `specs/design/component-map.md`, wired into `/gate` and pre-commit.

**Architecture:** `ownership-check.js` follows the repo's script conventions (pure core + injectable `run()` CLI, verdict JSON to `specs/reviews/`, exit 0/1). Parser is deliberately tolerant: the component map is planner-authored freeform markdown (story → files table, per `design/SKILL.md:113`), so ownership = any backtick-quoted path token; directory entries own their subtree. Pre-commit gets `checkOwnership` mirroring `checkLayers` (file-scope check, guarded on map existence, `HARNESS_OWNERSHIP_GATE=off` escape per the hook's existing `*_GATE=off` convention). `/gate` gets a sensor entry mirroring canvas-sync (BLOCK with sensor-waiver escape at orchestration level). The e2e workflow template is copied by `/test` Step 6.5 (where the playwright config template is already copied and the gating artifacts are guaranteed to exist).

**Recorded deviations from the spec (justified by discovery):** spec said `/deploy` copies the workflow — but `/deploy` runs before the Playwright artifacts exist and never touches `.github/workflows/`; `/test` owns the Playwright artifacts. Spec said pre-commit uses the sensor-waiver mechanism — no pre-commit gate reads waivers (waivers are applied at `/gate` orchestration level, verified: `canvas-sync-check.js` has zero waiver code); pre-commit uses the established `*_GATE=off` env escape instead.

**Tech Stack:** Node stdlib only. Tests: node:test.

**Branch:** `fix/ci-e2e-and-ownership` off `main`, PR when green.

## Global Constraints

- Node stdlib only; no new dependencies.
- Script convention: `module.exports = { parseComponentMap, checkOwnership, run }`, CLI behind `if (require.main === module)`; verdict written to `specs/reviews/ownership-check.json`.
- **No vacuous passes:** a map that exists but parses to zero entries while source files are being checked is a FAIL (`empty_map`), never a silent pass. A missing map is a skip (existence-gated), never a crash.
- Pre-commit hook: 300-line test-file cap applies — new hook tests go in a NEW file `test/pre-commit-git-hook-ownership.test.js` reusing `test/helpers/pre-commit-fixtures.js` and `test/helpers/hook-fixture.js` (no helper duplication — this repo has rejected that twice).
- Every new sensor registered in `harness-manifest.json` + `HARNESS.md` in the same branch; `node .claude/scripts/validate-harness-manifest.js` green.
- New script added to `CORE_SCRIPTS` in `.claude/scripts/scaffold-copy.js` (~line 41-71) or core/brownfield scaffolds silently omit it.
- Suite via `npm test` (iCloud gotcha: if hung, kill orphaned `node --test` procs, delete ` 2.`-suffixed dupes, re-run once).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `ownership-check.js` + unit tests

**Files:**
- Create: `.claude/scripts/ownership-check.js`
- Test: `test/ownership-check.test.js`

**Interfaces:**
- Produces (consumed by Task 2): `checkOwnership(files, mapText)` → `{ pass, map_entries, checked, unowned: [paths], reason?: 'empty_map' }`; `run(argv, root, deps?)` CLI with `--staged` | `--files <a> <b> …`, verdict to `specs/reviews/ownership-check.json`, exit 0 pass / 0 with `no-map` verdict when the map is absent / 1 fail.

- [ ] **Step 1: Write the failing tests**

Create `test/ownership-check.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'ownership-check.js');
const { parseComponentMap, checkOwnership, run } = require(SCRIPT);

const MAP = `# Component Map

| Story | Files |
|---|---|
| S1 | \`src/api/users.py\` (Produces: user schema) |
| S2 | \`src/ui/\` — owns the whole directory. Consumes: \`src/api/users.py\` |
| S3 | \`src/services/orders.ts\` |
`;

test('parseComponentMap extracts backticked file and directory paths', () => {
  const owned = parseComponentMap(MAP);
  assert.ok(owned.has('src/api/users.py'));
  assert.ok(owned.has('src/ui'));
  assert.ok(owned.has('src/services/orders.ts'));
});

test('parseComponentMap ignores backticked non-path tokens', () => {
  const owned = parseComponentMap('| S1 | `Produces: schema` and `some phrase` and `GET /users` |');
  assert.strictEqual(owned.size, 0);
});

test('an exactly-owned file and a file under an owned directory pass', () => {
  const v = checkOwnership(['src/api/users.py', 'src/ui/App.tsx'], MAP);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.unowned, []);
});

test('an unowned source file fails with its path listed', () => {
  const v = checkOwnership(['src/api/users.py', 'src/rogue/backdoor.py'], MAP);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.unowned, ['src/rogue/backdoor.py']);
});

test('allowlisted prefixes and non-source files are never checked', () => {
  const v = checkOwnership(
    ['specs/design/x.md', 'docs/a.md', '.claude/scripts/y.js', 'test/z.test.js', 'e2e/flow.spec.ts', 'README.md', '.env.example'],
    MAP
  );
  assert.strictEqual(v.checked, 0);
  assert.strictEqual(v.pass, true);
});

test('a map with zero parseable entries fails loudly when source files are checked (no vacuous pass)', () => {
  const v = checkOwnership(['src/api/users.py'], '# Component Map\n\nTBD\n');
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.reason, 'empty_map');
});

test('a map with zero entries and zero checked files passes (docs-only change)', () => {
  const v = checkOwnership(['docs/a.md'], '# Component Map\n\nTBD\n');
  assert.strictEqual(v.pass, true);
});

// --- run() CLI (injected root, no subprocess) ---------------------------------

function makeProject(mapText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-'));
  if (mapText !== null) {
    const p = path.join(dir, 'specs', 'design', 'component-map.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, mapText);
  }
  return dir;
}

test('run --files writes the verdict and exits 1 on an unowned file', () => {
  const dir = makeProject(MAP);
  const code = run(['--files', 'src/rogue/backdoor.py'], dir);
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'ownership-check.json'), 'utf8'));
  assert.strictEqual(verdict.pass, false);
  assert.deepStrictEqual(verdict.unowned, ['src/rogue/backdoor.py']);
});

test('run exits 0 with a no-map verdict when component-map.md is absent', () => {
  const dir = makeProject(null);
  const code = run(['--files', 'src/anything.py'], dir);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'ownership-check.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-map');
});

test('run --staged uses the injected exec to list staged files', () => {
  const dir = makeProject(MAP);
  const fakeExec = () => 'src/api/users.py\nsrc/rogue/backdoor.py\n';
  const code = run(['--staged'], dir, { exec: fakeExec });
  assert.strictEqual(code, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/ownership-check.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `.claude/scripts/ownership-check.js`**

```js
#!/usr/bin/env node

'use strict';

// Ownership sensor (2026-07-02 audit fix #4). "Every file produced must trace
// to a story" (implement/SKILL.md) was a stated rule with no sensor: nothing
// diffed changed files against specs/design/component-map.md. This closes it
// deterministically. The map is planner-authored freeform markdown (a story ->
// files table), so parsing is deliberately tolerant: ownership is any
// backtick-quoted path token; a directory entry owns its subtree.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAP_REL = path.join('specs', 'design', 'component-map.md');
const VERDICT_REL = path.join('specs', 'reviews', 'ownership-check.json');
const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// Never need a story owner: planning artifacts, docs, harness internals, CI
// config, and test suites (tests trace via test-traces, not the map).
const ALLOW_PREFIXES = ['specs/', 'docs/', '.claude/', '.github/', 'test/', 'tests/', 'e2e/'];

function isSource(file) {
  return SOURCE_EXTS.has(path.extname(file).toLowerCase());
}

function isAllowed(file) {
  if (path.basename(file).startsWith('.')) return true;
  return ALLOW_PREFIXES.some((p) => file.startsWith(p));
}

function parseComponentMap(text) {
  const owned = new Set();
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    const token = m[1].trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (!token || /\s/.test(token)) continue;
    if (token.includes('/') && token.startsWith('/')) continue; // URL-ish/route tokens like /users
    if (token.includes('/') || isSource(token)) owned.add(token);
  }
  return owned;
}

function isOwned(file, owned) {
  if (owned.has(file)) return true;
  for (const entry of owned) {
    if (!isSource(entry) && file.startsWith(entry + '/')) return true;
  }
  return false;
}

// Pure core: files are repo-relative POSIX paths.
function checkOwnership(files, mapText) {
  const owned = parseComponentMap(mapText);
  let checked = 0;
  const unowned = [];
  for (const raw of files) {
    const file = String(raw).replace(/\\/g, '/');
    if (!isSource(file) || isAllowed(file)) continue;
    checked += 1;
    if (!isOwned(file, owned)) unowned.push(file);
  }
  const result = { pass: unowned.length === 0, map_entries: owned.size, checked, unowned };
  // A parse-empty map with real source changes is a broken control, not a pass.
  if (owned.size === 0 && checked > 0) {
    result.pass = false;
    result.reason = 'empty_map';
  }
  return result;
}

function stagedFiles(exec) {
  const out = exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return String(out).split('\n').filter(Boolean);
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  const mapPath = path.join(root, MAP_REL);

  if (!fs.existsSync(mapPath)) {
    writeVerdict(root, { verdict: 'no-map', pass: true, note: `${MAP_REL} not found — ownership not checked` });
    process.stdout.write('ownership: SKIP (no component-map.md)\n');
    return 0;
  }

  let files;
  if (argv[0] === '--staged') {
    files = stagedFiles(exec);
  } else if (argv[0] === '--files') {
    files = argv.slice(1);
  } else {
    process.stderr.write('usage: ownership-check.js --staged | --files <path> [...]\n');
    return 2;
  }

  const verdict = checkOwnership(files, fs.readFileSync(mapPath, 'utf8'));
  writeVerdict(root, verdict);
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`ownership: ${label} — ${verdict.checked} checked, ${verdict.unowned.length} unowned${verdict.reason ? ` (${verdict.reason})` : ''}\n`);
  for (const f of verdict.unowned) process.stdout.write(`  UNOWNED  ${f}\n`);
  return verdict.pass ? 0 : 1;
}

module.exports = { parseComponentMap, checkOwnership, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/ownership-check.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/ownership-check.js test/ownership-check.test.js
git commit -m "feat: ownership-check sensor — changed files vs component-map

'Every file traces to a story' was prompt-discipline only (2026-07-02
audit fix #4). Deterministic sensor: backtick-tolerant map parser,
directory ownership, allowlisted non-product prefixes, and a loud
empty_map failure instead of a vacuous pass.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire ownership-check into pre-commit, /gate, registry, scaffold

**Files:**
- Modify: `.claude/git-hooks/pre-commit` (new `checkOwnership` after `checkContexts`, called at ~line 367)
- Modify: `.claude/skills/gate/SKILL.md` (sensor entry + Output Files table row)
- Modify: `harness-manifest.json` (new sensor entry), `HARNESS.md` (traceability sensors row)
- Modify: `.claude/scripts/scaffold-copy.js` (`CORE_SCRIPTS` += `'ownership-check.js'`)
- Test: `test/pre-commit-git-hook-ownership.test.js` (new file; reuse `test/helpers/hook-fixture.js` + `test/helpers/pre-commit-fixtures.js`), extend `test/scaffold-copy.test.js` (script-presence assertion alongside the existing `verification-matrix-gate.js` one at ~lines 70-78)

**Interfaces:**
- Consumes: Task 1's `checkOwnership(files, mapText)` export and CLI semantics.
- Produces: hook gate + `/gate` sensor text Task 3 does not depend on.

- [ ] **Step 1: Write the failing hook tests**

Create `test/pre-commit-git-hook-ownership.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { makeGitProject, runGitHook } = require('./helpers/hook-fixture');
const { stage } = require('./helpers/pre-commit-fixtures');

const HOOK = 'pre-commit';

function installOwnershipScript(projectDir) {
  const dir = path.join(projectDir, '.claude', 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', '.claude', 'scripts', 'ownership-check.js'),
    path.join(dir, 'ownership-check.js')
  );
}

function writeMap(projectDir, text) {
  const p = path.join(projectDir, 'specs', 'design', 'component-map.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

test('ownership: silent no-op when no component-map.md exists', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes('ownership'), result.stdout);
});

test('ownership: passes when every staged source file is owned', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
});

test('ownership: blocks an unowned staged source file, naming it', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  stage(projectDir, 'src/rogue/extra.py', 'Y = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stdout.includes('src/rogue/extra.py'), result.stdout);
  assert.ok(result.stdout.includes('component-map'), result.stdout);
});

test('ownership: HARNESS_OWNERSHIP_GATE=off skips loudly', async () => {
  const projectDir = makeGitProject();
  installOwnershipScript(projectDir);
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/rogue/extra.py', 'Y = 2\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off', HARNESS_OWNERSHIP_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED'), result.stdout);
  assert.ok(result.stdout.includes('ownership'), result.stdout);
});

test('ownership: announces the skip when the map exists but the sensor script is missing', async () => {
  const projectDir = makeGitProject();
  writeMap(projectDir, '| S1 | `src/types/models.py` |');
  stage(projectDir, 'src/types/models.py', 'X = 1\n');
  const result = await runGitHook(projectDir, HOOK, { HARNESS_COVERAGE_GATE: 'off' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('GATE SKIPPED'), result.stdout);
  assert.ok(result.stdout.includes('ownership'), result.stdout);
});
```

Note: if `stage` is not exported from `test/helpers/pre-commit-fixtures.js`, export it there (it currently may live only in the fixtures module or the main test file — reuse, never duplicate).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/pre-commit-git-hook-ownership.test.js`
Expected: block/skip tests FAIL (hook has no ownership gate yet).

- [ ] **Step 3: Implement `checkOwnership` in the hook**

In `.claude/git-hooks/pre-commit`, after `checkContexts` (function definition area) add:

```js
// Ownership gate (2026-07-02 audit fix #4): every staged source file must be
// owned in specs/design/component-map.md. File-scope, like checkLayers. Lazy
// require: the sensor ships in .claude/scripts; absence degrades to a loud skip.
function checkOwnership(projectDir, stagedSource) {
  if (process.env.HARNESS_OWNERSHIP_GATE === 'off') {
    noteSkip('ownership', 'HARNESS_OWNERSHIP_GATE=off');
    return;
  }
  const mapPath = path.join(projectDir, 'specs', 'design', 'component-map.md');
  if (!fs.existsSync(mapPath)) return; // pre-map project or lane: nothing to check
  let checkFn;
  try {
    ({ checkOwnership: checkFn } = require(path.join(__dirname, '..', 'scripts', 'ownership-check')));
  } catch (_) {
    noteSkip('ownership', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const verdict = checkFn(stagedSource, fs.readFileSync(mapPath, 'utf8'));
  if (!verdict.pass) {
    const lines = verdict.unowned.map((f) => `  UNOWNED  ${f}`);
    const reason = verdict.reason === 'empty_map'
      ? 'component-map.md parsed to zero owned paths — the map is stale or malformed.\n'
      : '';
    fail(
      `BLOCKED: staged source files are not owned by any story in specs/design/component-map.md:\n` +
      lines.join('\n') + (lines.length ? '\n' : '') + reason +
      `Fix: add the file(s) to the owning story's row in component-map.md (or set HARNESS_OWNERSHIP_GATE=off to acknowledge the skip).\n`
    );
  }
}
```

Call it in the main `try` block between `checkContexts` and `checkSprintContract`:

```js
  checkContexts(projectDir, stagedSource);
  checkOwnership(projectDir, stagedSource);
  checkSprintContract(projectDir);
```

Update the hook's header-comment gate list to mention ownership.

- [ ] **Step 4: /gate + registry + scaffold wiring**

- `gate/SKILL.md`: add a sensor bullet after the canvas-sync entry, mirroring its shape: *"**Ownership:** when changed source files exist and `specs/design/component-map.md` exists, run `node .claude/scripts/ownership-check.js --files <changed files>` (or `--staged` pre-commit-side). It writes `specs/reviews/ownership-check.json`; a non-zero exit means changed source files are owned by no story in the component map (or the map parsed to zero entries — `empty_map`); that is a **BLOCK** unless a valid `specs/reviews/sensor-waivers.json` entry (`sensor_id: "ownership-check"`) explicitly covers the file. Fix by assigning the file to its owning story in component-map.md first, then rerun."* Add `ownership-check.json` to the Output Files table.
- `harness-manifest.json`, after the `canvas-sync-check` sensor entry, add:
```json
{ "id": "ownership-check", "axis": "traceability", "type": "computational", "cadence": "commit", "status": "active", "scope": "artifacts", "wired_at": ".claude/scripts/ownership-check.js", "signal": "changed source files owned by no story in component-map.md", "description": "Deterministic file-ownership sensor: staged/changed source files must be owned by a story in specs/design/component-map.md ('no story, no code'). Enforced at pre-commit (checkOwnership, HARNESS_OWNERSHIP_GATE=off escape) and at /gate (sensor-waiver escape); a map that parses to zero entries fails loudly (empty_map) instead of passing vacuously." }
```
(match the file's actual one-line-per-sensor formatting), then `node .claude/scripts/validate-harness-manifest.js` → exit 0.
- `HARNESS.md` traceability sensors row: append `· ✅ \`ownership-check\` (changed files vs component-map story ownership)`.
- `scaffold-copy.js`: add `'ownership-check.js'` to `CORE_SCRIPTS` (alphabetical-ish placement near `canvas-sync-check.js`).
- `test/scaffold-copy.test.js`: in the "copies scripts required by copied prompt wiring" test (~lines 70-78), add an existence assertion for `ownership-check.js` alongside `verification-matrix-gate.js`.

- [ ] **Step 5: Run hook tests + scaffold tests + validator**

Run: `node --test test/pre-commit-git-hook-ownership.test.js test/scaffold-copy.test.js` and `node .claude/scripts/validate-harness-manifest.js`
Expected: all PASS; validator exit 0.

- [ ] **Step 6: Commit**

```bash
git add .claude/git-hooks/pre-commit .claude/skills/gate/SKILL.md harness-manifest.json HARNESS.md .claude/scripts/scaffold-copy.js test/pre-commit-git-hook-ownership.test.js test/scaffold-copy.test.js
git commit -m "feat: enforce story ownership at pre-commit and /gate

Wires the ownership-check sensor: pre-commit blocks unowned staged
source files (HARNESS_OWNERSHIP_GATE=off escape), /gate blocks with
the sensor-waiver escape, registry + scaffold copy-list updated.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: E2E workflow template + browser re-install step

**Files:**
- Create: `.claude/templates/github-workflows/e2e.yml`
- Modify: `.claude/skills/test/SKILL.md` (new Step 6.5, after the config-template copy in Step 6)
- Modify: `.claude/skills/build/SKILL.md` (Phase 9.5: browser install before the Playwright step)
- Modify: `README.md` (Optional Power-Ups table row)
- Test: `test/e2e-workflow-template.test.js` (new)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 (independent).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Create `test/e2e-workflow-template.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, '.claude', 'templates', 'github-workflows', 'e2e.yml');

test('e2e workflow template exists and runs the real Playwright suite on PRs', () => {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(text, /pull_request/);
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /npx playwright install --with-deps chromium/);
  assert.match(text, /npx playwright test/);
  assert.match(text, /actions\/checkout@v5/);
  assert.match(text, /actions\/setup-node@v5/);
});

test('/test copies the e2e workflow into target projects alongside the playwright config', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'test', 'SKILL.md'), 'utf8');
  assert.match(skill, /github-workflows\/e2e\.yml/);
  assert.match(skill, /\.github\/workflows\/e2e\.yml/);
});

test('/build Phase 9.5 re-installs the Playwright browser before the suite (chained sessions)', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'build', 'SKILL.md'), 'utf8');
  assert.match(skill, /npx playwright install --with-deps chromium/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/e2e-workflow-template.test.js`
Expected: all 3 FAIL.

- [ ] **Step 3: Create the template**

`.claude/templates/github-workflows/e2e.yml` (style per harness-drift.yml — checkout@v5/setup-node@v5/node 20):

```yaml
# Copied into target projects by /test (Step 6.5) once e2e/ and
# playwright.config.ts exist. The generated playwright.config.ts webServer
# block starts the docker compose stack itself; CI=true (always set on
# Actions) forces a fresh build instead of reusing a running server.
name: E2E

on:
  pull_request:
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 20
      - name: Install dependencies
        run: npm install
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Run E2E suite
        run: npx playwright test
```

- [ ] **Step 4: /test Step 6.5 + Phase 9.5 + README**

- `test/SKILL.md`: after Step 6 (playwright config template copy), add:

```markdown
### Step 6.5 — Ship the CI workflow

Copy `.claude/templates/github-workflows/e2e.yml` to `.github/workflows/e2e.yml` (skip if the target file already exists — never overwrite a team's edited workflow). This makes every future PR re-run the generated suite in CI instead of only inside harness sessions; the config's `webServer` block self-starts the compose stack on the runner. Requires Docker on the runner (true for `ubuntu-latest`).
```

- `build/SKILL.md` Phase 9.5: immediately before the "Only after the API is green, run the Phase 9 Playwright suite against the deployed UI" sentence, insert: `If the deliverable has a UI, first run \`npx playwright install --with-deps chromium\` — idempotent, and chained sessions can span long enough for browser binaries to be missing.`
- `README.md` Optional Power-Ups table: add row `| PR-time E2E re-runs | Copied automatically by /test as .github/workflows/e2e.yml | Re-runs the generated Playwright suite on every PR |`.

- [ ] **Step 5: Run tests, then full suite**

Run: `node --test test/e2e-workflow-template.test.js` → 3 PASS. Then `npm test` → 0 fail.

- [ ] **Step 6: Commit**

```bash
git add .claude/templates/github-workflows/e2e.yml .claude/skills/test/SKILL.md .claude/skills/build/SKILL.md README.md test/e2e-workflow-template.test.js
git commit -m "feat: ship PR-time e2e workflow; re-install browser pre-suite

Closes the 'no CI ever re-runs the generated e2e suite' gap: /test now
copies a workflow template (webServer self-starts the stack; never
overwrites an existing file), and Phase 9.5 re-installs the chromium
binary so chained sessions can't lose it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan (workflow, not tasks)

Per-task fresh reviews; whole-branch review on the strongest model (probe: parser false-positives on real-world component maps — e.g. route tokens like `/users`, `Produces:` phrases; allowlist over-breadth — could product code under `e2e/` or `tests/` evade ownership?; workflow template on projects without docker/package.json). PR titled "feat: e2e CI template + ownership sensor (audit fix #4)". Human owns merge.
