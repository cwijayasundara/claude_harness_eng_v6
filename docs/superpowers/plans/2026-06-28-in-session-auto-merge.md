# In-session AUTO_MERGE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `gh pr merge --auto` into `/build` Phase 11 so a fully-local `/build --auto --auto-merge` (or `AUTO_MERGE=true`) run reaches *merged* (gated on green CI), via a scaffold-local `auto-merge.js` ported from symphony.

**Architecture:** A self-gating `.claude/scripts/auto-merge.js` (pure `isAutoMergeEnabled`/`resolveMethod`/slug helpers + an injectable-runner `enableAutoMerge`, ported from `symphony_clone/pr.js`) does the merge. `build-lane.js` parses `--auto-merge`; `build-chain.js` forwards it to the FINALIZE link; `/build` Phase 11 calls `auto-merge.js <prUrl> --auto-merge` after `gh pr create`.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test` + `assert`, `gh`/`git` CLIs, Markdown skill.

## Global Constraints

- Node scripts are CommonJS with `'use strict';`; pure helpers take parsed inputs (no I/O) so they unit-test without `gh`/`git` — mirror `.claude/scripts/build-lane.js` and `.claude/scripts/wave-pr.js`.
- Tests use `const { test } = require('node:test');` + `const assert = require('assert');` in `test/*.test.js` (run by `npm test`).
- Activation: the `--auto-merge` flag **or** `AUTO_MERGE=true` env. Merge method from `MERGE_METHOD` env, validated against `['merge','squash','rebase']`, default `merge`.
- `auto-merge.js` is **self-gating**: a no-op (exit 0, printed notice) unless enabled. It exits `0` regardless of outcome — a disabled/failed/refused auto-merge is never a build failure (the PR stays open for a human).
- The merge command is exactly `gh pr merge --auto --<method> -- <prUrl>`.
- Repo-slug pin: the PR URL's host/owner/repo must match `git remote get-url origin`; on mismatch, refuse (don't merge a PR pointing elsewhere).
- `--auto-merge` is forwarded only to the **FINALIZE** link in `build-chain.js` (Phase 11 runs there).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT edit `CLAUDE.md`. Work stays on branch `feat/in-session-auto-merge`.

---

### Task 1: `auto-merge.js` — the merge logic (ported from symphony)

**Files:**
- Create: `.claude/scripts/auto-merge.js`
- Test: `test/auto-merge.test.js`

**Interfaces:**
- Produces: `isAutoMergeEnabled(flags, env) -> boolean`; `resolveMethod(env) -> 'merge'|'squash'|'rebase'` (throws on invalid); `enableAutoMerge(prUrl, { runner?, expectedSlug?, method? }) -> { enabled: boolean, reason?: string }` (never throws); plus `isRealPrUrl`, `repoSlugFromGitUrl`, `repoSlugFromPrUrl`.
- Consumes: nothing (foundation).

- [ ] **Step 1: Write the failing test**

Create `test/auto-merge.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const {
  isAutoMergeEnabled, resolveMethod, enableAutoMerge,
  isRealPrUrl, repoSlugFromGitUrl, repoSlugFromPrUrl,
} = require('../.claude/scripts/auto-merge.js');

test('isAutoMergeEnabled: flag, env, neither, both', () => {
  assert.strictEqual(isAutoMergeEnabled(['--auto-merge'], {}), true);
  assert.strictEqual(isAutoMergeEnabled([], { AUTO_MERGE: 'true' }), true);
  assert.strictEqual(isAutoMergeEnabled(['--auto-merge'], { AUTO_MERGE: 'true' }), true);
  assert.strictEqual(isAutoMergeEnabled([], {}), false);
  assert.strictEqual(isAutoMergeEnabled([], { AUTO_MERGE: 'false' }), false);
});

test('resolveMethod: default merge, valid values, invalid throws', () => {
  assert.strictEqual(resolveMethod({}), 'merge');
  assert.strictEqual(resolveMethod({ MERGE_METHOD: 'squash' }), 'squash');
  assert.strictEqual(resolveMethod({ MERGE_METHOD: 'REBASE' }), 'rebase');
  assert.throws(() => resolveMethod({ MERGE_METHOD: 'fast-forward' }), /merge, squash, rebase/);
});

test('repo slug helpers (scp + https)', () => {
  assert.strictEqual(repoSlugFromGitUrl('git@github.com:Owner/Repo.git'), 'github.com/owner/repo');
  assert.strictEqual(repoSlugFromGitUrl('https://github.com/Owner/Repo'), 'github.com/owner/repo');
  assert.strictEqual(repoSlugFromPrUrl('https://github.com/owner/repo/pull/7'), 'github.com/owner/repo');
});

test('enableAutoMerge: non-PR url is not enabled and makes no gh call', () => {
  const calls = [];
  const r = enableAutoMerge('not-a-pr', { runner: (c, a) => { calls.push(a); } });
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(calls.length, 0);
});

test('enableAutoMerge: slug mismatch refuses, no gh call', () => {
  const calls = [];
  const r = enableAutoMerge('https://github.com/owner/other/pull/3', {
    runner: (c, a) => { calls.push(a); }, expectedSlug: 'github.com/owner/repo',
  });
  assert.strictEqual(r.enabled, false);
  assert.match(r.reason, /does not match/);
  assert.strictEqual(calls.length, 0);
});

test('enableAutoMerge: happy path calls gh pr merge --auto --<method>', () => {
  const calls = [];
  const r = enableAutoMerge('https://github.com/owner/repo/pull/9', {
    runner: (c, a) => { calls.push([c, a]); return ''; },
    expectedSlug: 'github.com/owner/repo', method: 'squash',
  });
  assert.strictEqual(r.enabled, true);
  assert.deepStrictEqual(calls[0], ['gh', ['pr', 'merge', '--auto', '--squash', '--', 'https://github.com/owner/repo/pull/9']]);
});

test('enableAutoMerge: runner error falls back to not-enabled (no throw)', () => {
  const r = enableAutoMerge('https://github.com/owner/repo/pull/9', {
    runner: () => { throw new Error('auto-merge not allowed on this repo'); },
    expectedSlug: 'github.com/owner/repo',
  });
  assert.strictEqual(r.enabled, false);
  assert.match(r.reason, /not allowed/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auto-merge.test.js`
Expected: FAIL — `Cannot find module '../.claude/scripts/auto-merge.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/scripts/auto-merge.js`:

```js
'use strict';

// In-session AUTO_MERGE: wire `gh pr merge --auto` into /build Phase 11. Ported
// from symphony_clone/src/orchestrator/pr.js#enableAutoMerge (which is not copied
// into target projects). Self-gating: a no-op unless --auto-merge / AUTO_MERGE=true.

const { execFileSync } = require('child_process');

const VALID_MERGE_METHODS = ['merge', 'squash', 'rebase'];

function isAutoMergeEnabled(flags, env = process.env) {
  const hasFlag = Array.isArray(flags) ? flags.includes('--auto-merge') : Boolean(flags);
  return hasFlag || env.AUTO_MERGE === 'true';
}

function resolveMethod(env = process.env) {
  const method = String(env.MERGE_METHOD || 'merge').trim().toLowerCase();
  if (!VALID_MERGE_METHODS.includes(method)) {
    throw new Error(`MERGE_METHOD must be one of: ${VALID_MERGE_METHODS.join(', ')}`);
  }
  return method;
}

function isRealPrUrl(prUrl) {
  return typeof prUrl === 'string'
    && /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+(?:[/?#].*)?$/.test(prUrl.trim());
}

function repoSlugFromGitUrl(url) {
  const s = String(url || '').trim().replace(/\.git\/?$/, '');
  const m = s.match(/^[^@\s/]+@([^:/\s]+):(.+)$/)
    || s.match(/^[a-z][\w+.-]*:\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/i);
  if (!m) return null;
  const segs = m[2].split('/').filter(Boolean);
  if (segs.length < 2) return null;
  return `${m[1]}/${segs[segs.length - 2]}/${segs[segs.length - 1]}`.toLowerCase();
}

function repoSlugFromPrUrl(prUrl) {
  const m = String(prUrl || '').match(/^https?:\/\/([^/:\s]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/);
  return m ? `${m[1]}/${m[2]}/${m[3]}`.toLowerCase() : null;
}

function defaultRunner(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function enableAutoMerge(prUrl, opts = {}) {
  const { runner = defaultRunner, expectedSlug = null, method = 'merge' } = opts;
  if (!isRealPrUrl(prUrl)) return { enabled: false, reason: 'no PR to merge' };
  const prSlug = repoSlugFromPrUrl(prUrl);
  if (expectedSlug && prSlug && prSlug !== expectedSlug) {
    return { enabled: false, reason: `PR repo ${prSlug} does not match ${expectedSlug}` };
  }
  try {
    runner('gh', ['pr', 'merge', '--auto', `--${method}`, '--', prUrl]);
    return { enabled: true };
  } catch (error) {
    return { enabled: false, reason: error.message };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const prUrl = args.find((a) => !a.startsWith('--')) || '';
  if (!isAutoMergeEnabled(args, process.env)) {
    process.stdout.write('auto-merge not enabled (pass --auto-merge or set AUTO_MERGE=true)\n');
    process.exit(0);
  }
  let method = 'merge';
  try { method = resolveMethod(process.env); }
  catch (e) { process.stderr.write(`${e.message}\n`); process.exit(0); }
  let expectedSlug = null;
  try { expectedSlug = repoSlugFromGitUrl(defaultRunner('git', ['remote', 'get-url', 'origin']).trim()); }
  catch (_) { expectedSlug = null; }
  const result = enableAutoMerge(prUrl, { expectedSlug, method });
  process.stdout.write(result.enabled
    ? `auto-merge enabled for ${prUrl} (--${method})\n`
    : `auto-merge not applied: ${result.reason}\n`);
  process.exit(0);
}

module.exports = {
  isAutoMergeEnabled, resolveMethod, enableAutoMerge,
  isRealPrUrl, repoSlugFromGitUrl, repoSlugFromPrUrl,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auto-merge.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/auto-merge.js test/auto-merge.test.js
git commit -m "feat(build): scaffold-local auto-merge.js (ports symphony enableAutoMerge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `build-lane.js` surfaces `--auto-merge`

**Files:**
- Modify: `.claude/scripts/build-lane.js` (the `parseBuildInvocation` wrapper)
- Test: `test/build-lane.test.js` (append cases)

**Interfaces:**
- Produces: `parseBuildInvocation(input).autoMerge: boolean` on every valid lane result. Forwarded by Task 3.
- Consumes: existing `tokenize`, `resolveLane` (already in the file).

- [ ] **Step 1: Write the failing test**

Append to `test/build-lane.test.js`:

```js
test('--auto-merge is surfaced without changing lane or prd', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto --auto-merge');
  assert.strictEqual(r.lane, 'auto');
  assert.strictEqual(r.prdPath, 'docs/prd.md');
  assert.strictEqual(r.autoMerge, true);
});

test('autoMerge defaults to false', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto');
  assert.strictEqual(r.autoMerge, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-lane.test.js`
Expected: FAIL — `r.autoMerge` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `.claude/scripts/build-lane.js`, in the `parseBuildInvocation` wrapper, add the `autoMerge` line next to the existing `singlePr` line:

```js
function parseBuildInvocation(input) {
  const result = resolveLane(input);
  if (result && result.valid !== false) {
    result.singlePr = tokenize(input).includes('--single-pr');
    result.autoMerge = tokenize(input).includes('--auto-merge');
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-lane.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/build-lane.js test/build-lane.test.js
git commit -m "feat(build): surface --auto-merge in lane parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `build-chain.js` forwards `--auto-merge` to FINALIZE

**Files:**
- Modify: `.claude/scripts/build-chain.js` (`promptFor`, `realSpawnLink`, CLI block)
- Test: `test/build-chain-single-pr.test.js` (append; it already imports `promptFor`)

**Interfaces:**
- Consumes: `promptFor(kind, prd, opts)` (existing export). Adds `opts.autoMerge` support.
- Produces: the FINALIZE link prompt carries `--auto-merge` when active.

- [ ] **Step 1: Write the failing test**

Append to `test/build-chain-single-pr.test.js`:

```js
test('promptFor forwards --auto-merge to FINALIZE only', () => {
  assert.ok(promptFor('FINALIZE', 'prd.md', { autoMerge: true }).includes('--auto-merge'));
  assert.ok(!promptFor('PLAN', 'prd.md', { autoMerge: true }).includes('--auto-merge'));
  assert.ok(!promptFor('BUILD', 'prd.md', { autoMerge: true }).includes('--auto-merge'));
});

test('promptFor omits --auto-merge by default', () => {
  assert.ok(!promptFor('FINALIZE', 'prd.md', {}).includes('--auto-merge'));
});

test('FINALIZE can carry both --single-pr and --auto-merge', () => {
  const p = promptFor('FINALIZE', 'prd.md', { singlePr: true, autoMerge: true });
  assert.ok(p.includes('--single-pr') && p.includes('--auto-merge'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-chain-single-pr.test.js`
Expected: FAIL — `--auto-merge` not present in the FINALIZE prompt.

- [ ] **Step 3: Write minimal implementation**

In `.claude/scripts/build-chain.js`, update `promptFor` so the FINALIZE link carries `--auto-merge` when set (auto-merge only matters at Phase 11 = FINALIZE):

```js
function promptFor(kind, prd, opts = {}) {
  const single = opts.singlePr ? ' --single-pr' : '';
  const autoMerge = opts.autoMerge ? ' --auto-merge' : '';
  if (kind === S.STATES.PLAN) return `/build --auto --plan-only ${prd}${single}`;
  if (kind === S.STATES.FINALIZE) return `/build --auto --finalize${single}${autoMerge}`;
  return `/auto --once${opts.sequential ? ' --sequential' : ''}${single}`; // BUILD
}
```

Thread it through the closure — in `realSpawnLink`, update the `promptFor` call:

```js
      input: promptFor(kind, prd, { ...opts, singlePr: runOpts.singlePr, autoMerge: runOpts.autoMerge }),
```

And in the CLI block, parse and pass it:

```js
  const singlePr = process.argv.includes('--single-pr');
  const autoMerge = process.argv.includes('--auto-merge');
  runChain({ spawnLink: realSpawnLink(cwd, prd, { singlePr, autoMerge }), loadState: realLoadState(cwd), checkBudget: realCheckBudget(cwd), log: (m) => process.stdout.write(`${m}\n`) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-chain-single-pr.test.js`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/build-chain.js test/build-chain-single-pr.test.js
git commit -m "feat(build-chain): forward --auto-merge to the FINALIZE link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/build` Phase 11 wires auto-merge + docs

**Files:**
- Modify: `.claude/skills/build/SKILL.md` (Phase 11 step 3; Usage; the `--auto` Approval-model line)
- Modify: `.claude/skills/build/references/autonomous-lane.md` (note local `--auto-merge`)
- Modify: `design.md` (the "humans own merge" note)
- Test: `test/build-auto-merge-contract.test.js`

**Interfaces:**
- Consumes: `auto-merge.js` (Task 1), the `--auto-merge` flag (Task 2).
- Produces: prose contract consumed by the runtime agent.

- [ ] **Step 1: Write the failing test**

Create `test/build-auto-merge-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const BUILD = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'build', 'SKILL.md'), 'utf8',
);

test('/build documents the --auto-merge flag and AUTO_MERGE env', () => {
  assert.match(BUILD, /--auto-merge/);
  assert.match(BUILD, /AUTO_MERGE/);
});

test('/build Phase 11 calls auto-merge.js after gh pr create', () => {
  assert.match(BUILD, /auto-merge\.js/);
});

test('Phase 11 no longer flatly forbids merge (AUTO_MERGE is the documented opt-out)', () => {
  // the old "Do not merge." absolute is replaced; "merge stays human unless" survives
  assert.match(BUILD, /unless.*AUTO_MERGE|AUTO_MERGE.*unless|merge stays human/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-auto-merge-contract.test.js`
Expected: FAIL — SKILL.md doesn't mention `--auto-merge`/`auto-merge.js` yet.

- [ ] **Step 3a: Rewrite Phase 11 step 3**

In `.claude/skills/build/SKILL.md`, replace the Phase 11 step 3 (currently begins `3. **Do not merge.** Raising the PR is the autonomous boundary; merge is a separate decision …`) with:

```markdown
3. **Merge.** Raising the PR is the autonomous boundary, and merge stays human
   **unless** AUTO_MERGE is active — the `--auto-merge` flag or `AUTO_MERGE=true`
   env (method from `MERGE_METHOD`, default `merge`). When active, run
   `node .claude/scripts/auto-merge.js <prUrl> --auto-merge`: it pins the PR to
   the current repo (`git remote get-url origin`) and runs `gh pr merge --auto
   --<method>`, so **GitHub merges only once the repo's required status checks
   pass** — never a red build. If auto-merge can't be enabled (the repo lacks
   "Allow auto-merge", a `gh` error, or a repo-slug mismatch), it leaves the PR
   open and surfaces the reason; the run never fails over auto-merge. **Caveat:**
   on a repo with no required status checks, `gh pr merge --auto` merges
   immediately, so AUTO_MERGE there merges right after the harness gates — assume
   "Allow auto-merge" + branch protection with required checks.
```

- [ ] **Step 3b: Update Usage + the `--auto` Approval-model line**

In the Usage block, add an example:

```text
/build path/to/prd.md --auto --auto-merge        # full-auto, and auto-merge the PR when CI is green
```

In the `--auto` Approval-model bullet, change the parenthetical "(the `AUTO_MERGE`
activation key removes even that, see the autonomous-engineer roadmap)" to note it
now works locally: "(the `--auto-merge` flag or `AUTO_MERGE=true` env removes even
that — GitHub merges once required checks pass; see Phase 11)".

- [ ] **Step 3c: Docs**

In `.claude/skills/build/references/autonomous-lane.md`, where `AUTO_MERGE` is
mentioned, note that the local path now activates it via the `--auto-merge` flag
or `AUTO_MERGE=true` env (via `.claude/scripts/auto-merge.js`), not only symphony.

In `design.md`, update the line that says humans always own merge (e.g. "Humans
always own merge and 'Done.'") to note the `AUTO_MERGE` opt-out now exists on
**both** runtimes (local `/build --auto --auto-merge` and the symphony key),
gated on green required checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-auto-merge-contract.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: PASS (all suites, including the new auto-merge files).

```bash
git add .claude/skills/build/SKILL.md .claude/skills/build/references/autonomous-lane.md design.md test/build-auto-merge-contract.test.js
git commit -m "feat(build): wire AUTO_MERGE into Phase 11 (--auto-merge flag / AUTO_MERGE env)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `auto-merge.js` (self-gating, slug-pin, `gh pr merge --auto`, never-throws fallback) → Task 1. ✓
- Activation flag+env, method from MERGE_METHOD → Task 1 (`isAutoMergeEnabled`/`resolveMethod`) + Task 2 (flag) + Task 4 (Phase 11 prose). ✓
- `build-lane.js` `--auto-merge` → Task 2. ✓
- `build-chain.js` forwards `--auto-merge` to FINALIZE → Task 3. ✓
- Phase 11 rewrite + Usage + Approval-model + autonomous-lane + design.md → Task 4. ✓
- Double-gating + unprotected-repo caveat documented → Task 4 Phase 11 prose. ✓
- Tests (helpers, lane, chain, contract) → Tasks 1–4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step has assertions + the exact run command and expected result.

**Type consistency:** `isAutoMergeEnabled(flags, env)`, `resolveMethod(env)`, `enableAutoMerge(prUrl, {runner, expectedSlug, method})→{enabled, reason}` (Task 1) are used consistently; `parseBuildInvocation(...).autoMerge` (Task 2) is forwarded as `opts.autoMerge`/`runOpts.autoMerge` (Task 3); the gh args `['pr','merge','--auto','--<method>','--',prUrl]` match between Task 1's code and its test.

**Out of scope (unchanged):** pod-mode per-cluster auto-merge; the other fix-#4 items; `publish-to-jira.js`.
