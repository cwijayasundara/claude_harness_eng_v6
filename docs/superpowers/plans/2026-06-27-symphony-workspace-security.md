# Symphony Workspace-Manager Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two unattended-path bugs in `symphony_clone/src/orchestrator/workspace-manager.js` — the post-checkout hook env-leak and the error-swallow that silently triggers a destructive branch reset.

**Architecture:** A single `runGit` choke point prepends `-c core.hooksPath=/dev/null` to every git invocation (per-command hook disable); `runCommand` exposes the exit code on its rejected Error; `branchExists` uses `show-ref --verify --quiet` for a clean absent/error tri-state; `countCommitsAhead` propagates git failures instead of returning `0`.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test` + `node:assert/strict`. All changes under `symphony_clone/`.

## Global Constraints

- All changes are in `symphony_clone/src/orchestrator/workspace-manager.js` and its test `symphony_clone/test/workspace-manager.test.js`. CommonJS, `'use strict';`.
- Tests use `const test = require('node:test');` + `const assert = require('node:assert/strict');`. Run with `cd symphony_clone && node --test test/workspace-manager.test.js`; full suite `cd symphony_clone && npm test`.
- Hook disable is per-command: `runGit(runner, cwd, args)` calls `runner('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd })`. `/dev/null` is correct (symphony runs in a Linux Docker container).
- `branchExists` uses `git show-ref --verify --quiet refs/heads/<branch>`: exit `0` → `true`, exit `1` → `false`, any other code → re-throw.
- `countCommitsAhead` re-throws git errors (only a non-numeric stdout maps to `0`).
- `runCommand`'s rejected Error carries `error.code` (exit code) and `error.stderr`.
- The injectable test `runner` signature is `async (cmd, args, { cwd }) => ({ stdout, stderr })`; `recordingRunner(handlers)` dispatches by a `cmd subcommand` key and records `calls`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT edit `CLAUDE.md`. Work stays on branch `fix/symphony-workspace-security`.

---

### Task 1: `runCommand` exposes the exit code

**Files:**
- Modify: `symphony_clone/src/orchestrator/workspace-manager.js` (the `runCommand` `close` handler)
- Test: `symphony_clone/test/workspace-manager.test.js` (add one case; import `runCommand`)

**Interfaces:**
- Produces: `runCommand` rejects with an `Error` whose `.code` is the process exit code and `.stderr` is the captured stderr. Consumed by Task 3's `branchExists`.

- [ ] **Step 1: Write the failing test**

In `symphony_clone/test/workspace-manager.test.js`, add `runCommand` to the top import and append:

```js
test('runCommand rejects with the exit code on the error', async () => {
  await assert.rejects(
    () => runCommand('node', ['-e', 'process.exit(3)']),
    (err) => err.code === 3 && /failed with 3/.test(err.message),
  );
});
```

Update the import line to:

```js
const { WorkspaceManager, safeWorkspaceKey, runCommand } = require('../src/orchestrator/workspace-manager');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd symphony_clone && node --test test/workspace-manager.test.js`
Expected: FAIL — the rejected error has no `.code` (it is `undefined`, not `3`).

- [ ] **Step 3: Attach the code to the error**

In `workspace-manager.js`, replace the `close` handler's non-zero branch:

```js
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr || stdout}`);
        error.code = code;
        error.stderr = stderr;
        reject(error);
      }
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd symphony_clone && node --test test/workspace-manager.test.js`
Expected: PASS (all existing cases + the new one).

- [ ] **Step 5: Commit**

```bash
git add symphony_clone/src/orchestrator/workspace-manager.js symphony_clone/test/workspace-manager.test.js
git commit -m "fix(symphony): expose exit code on runCommand errors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `runGit` hook-disable choke point (Bug 1)

**Files:**
- Modify: `symphony_clone/src/orchestrator/workspace-manager.js` (add `runGit`; route the `prepare`/`pushBranch` method git calls through it)
- Test: `symphony_clone/test/workspace-manager.test.js` (fix `recordingRunner` dispatch + the prepare-test arg assertions; add a hook-disable test)

**Interfaces:**
- Produces: `runGit(runner, cwd, args)` — module-level helper prepending `['-c', 'core.hooksPath=/dev/null']`. Consumed by Task 3 for the two helper functions.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test + adapt the harness**

First adapt `recordingRunner` so its handler key skips the `-c core.hooksPath=…` prefix (otherwise every git command keys to `git -c`). Replace the key line inside `recordingRunner`:

```js
    const sub = args[0] === '-c' ? args[2] : args[0];
    const key = `${cmd} ${sub || ''}`;
```

Then update the three existing `prepare` tests' argument assertions from `c.args[0] === '<sub>'` to `c.args.includes('<sub>')`, because `args[0]` is now `-c`:
- `prepare on fresh clone…`: `calls.find((c) => c.args.includes('clone'))` and `calls.find((c) => c.args.includes('checkout') && c.args.includes('-B'))`.
- `prepare on retry preserves…`: the `tag` find → `c.cmd === 'git' && c.args.includes('tag')`; the destructive find → `c.args.includes('checkout') && c.args.includes('-B')`; the clone find → `c.args.includes('clone')`.
- `prepare on retry with no local commits…`: the checkout find → `c.args.includes('checkout') && c.args.includes('-B')`; the tag find → `c.args.includes('tag')`.

Now append the new hook-disable test:

```js
test('every symphony git command disables hooks via -c core.hooksPath=/dev/null', async () => {
  const workspaceRoot = makeTempRoot();
  const { calls, runner } = recordingRunner();
  const wm = new WorkspaceManager({
    workspaceRoot,
    repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  await wm.prepare({ key: 'ENG-1' }, { id: 'A' }, { attempt: 1 });

  const gitCalls = calls.filter((c) => c.cmd === 'git');
  assert.ok(gitCalls.length > 0, 'expected git calls');
  for (const c of gitCalls) {
    assert.deepEqual(
      c.args.slice(0, 2), ['-c', 'core.hooksPath=/dev/null'],
      `git call missing hook-disable prefix: ${c.args.join(' ')}`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd symphony_clone && node --test test/workspace-manager.test.js`
Expected: FAIL — only the new hook-disable test fails (git calls have no `-c core.hooksPath` prefix yet). The adapted existing assertions still pass (`args.includes('clone')` is true with or without the prefix; the `recordingRunner` key change is backward-compatible because `args[0]` is `'clone'`, not `'-c'`, until Step 3).

- [ ] **Step 3: Add `runGit` and route the method calls**

In `workspace-manager.js`, add the helper near the other module functions:

```js
function runGit(runner, cwd, args) {
  return runner('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd });
}
```

Then route every git call inside the `WorkspaceManager` methods through it. In `prepare`:

```js
    const isFreshClone = !(await exists(path.join(workspacePath, '.git')));
    if (isFreshClone) {
      await runGit(this.runner, this.config.workspaceRoot, ['clone', this.config.repoUrl, workspacePath]);
    }

    await runGit(this.runner, workspacePath, ['fetch', 'origin', this.config.github.baseBranch]);

    const localBranchExists = !isFreshClone && await branchExists(this.runner, workspacePath, branchName);
    if (localBranchExists) {
      const commitsAhead = await countCommitsAhead(this.runner, workspacePath, branchName, baseRef);
      if (commitsAhead > 0) {
        const backupRef = buildRecoveryTag(branchName, runMeta);
        await runGit(this.runner, workspacePath, ['checkout', branchName]);
        await runGit(this.runner, workspacePath, ['tag', backupRef, branchName]);
        return { workspacePath, branchName, workspaceKey, resumed: true, commitsAhead, backupRef };
      }
    }

    await runGit(this.runner, workspacePath, ['checkout', '-B', branchName, baseRef]);
    return { workspacePath, branchName, workspaceKey, resumed: false };
```

And in `pushBranch`:

```js
  async pushBranch(workspacePath, branchName) {
    await runGit(this.runner, workspacePath, ['push', '-u', 'origin', branchName, '--force-with-lease']);
  }
```

(Leave `branchExists`/`countCommitsAhead` as they are for now — Task 3 rewrites them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd symphony_clone && node --test test/workspace-manager.test.js`
Expected: PASS — the hook-disable test passes (clone/fetch/checkout all carry the prefix), and the adapted existing assertions pass.

- [ ] **Step 5: Commit**

```bash
git add symphony_clone/src/orchestrator/workspace-manager.js symphony_clone/test/workspace-manager.test.js
git commit -m "fix(symphony): disable hooks on symphony git ops (post-checkout env-leak)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `branchExists` tri-state + `countCommitsAhead` propagation (Bug 2)

**Files:**
- Modify: `symphony_clone/src/orchestrator/workspace-manager.js` (`branchExists`, `countCommitsAhead`)
- Test: `symphony_clone/test/workspace-manager.test.js` (retry-test handler keys + new error-handling tests)

**Interfaces:**
- Consumes: Task 1's `error.code`; Task 2's `runGit`.
- Produces: `branchExists` returns `true`/`false` only on a clean exit-0/exit-1 signal and re-throws other errors; `countCommitsAhead` re-throws git errors.

- [ ] **Step 1: Write the failing tests + fix the retry handler keys**

In the two existing retry tests (`prepare on retry preserves…` and `prepare on retry with no local commits…`), change the `'git rev-parse'` handler key to `'git show-ref'` (branchExists now uses `show-ref`), keeping its resolve value:

```js
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),   // ref exists (exit 0)
    'git rev-list': async () => ({ stdout: '3\n', stderr: '' })
  });
```

(and `'3\n'` → `'0\n'` in the no-commits test, as it already is.)

Append the new error-handling tests (black-box, through `prepare`):

```js
function gitError(code, message) {
  const e = new Error(message || `git failed with ${code}`);
  e.code = code;
  return e;
}

test('prepare treats branch-absent (show-ref exit 1) as a fresh reset', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-7');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => { throw gitError(1, 'absent'); },
  });
  const wm = new WorkspaceManager({
    workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  const result = await wm.prepare({ key: 'ENG-7' }, { id: 'A' }, { attempt: 2 });
  assert.equal(result.resumed, false);
  assert.ok(calls.find((c) => c.args.includes('checkout') && c.args.includes('-B')), 'absent branch resets to base');
});

test('prepare propagates a real branchExists failure instead of resetting', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-8');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => { throw gitError(128, 'fatal: not a git repository'); },
  });
  const wm = new WorkspaceManager({
    workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  await assert.rejects(() => wm.prepare({ key: 'ENG-8' }, { id: 'A' }, { attempt: 2 }), /128|not a git/);
  assert.equal(calls.find((c) => c.args.includes('checkout') && c.args.includes('-B')), undefined, 'must NOT reset on a real error');
});

test('prepare propagates a countCommitsAhead failure instead of resetting', async () => {
  const workspaceRoot = makeTempRoot();
  const workspacePath = path.join(workspaceRoot, 'ENG-9');
  fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });
  const { calls, runner } = recordingRunner({
    'git show-ref': async () => ({ stdout: '', stderr: '' }),     // branch exists
    'git rev-list': async () => { throw gitError(128, 'fatal: bad revision'); },
  });
  const wm = new WorkspaceManager({
    workspaceRoot, repoUrl: 'git@example.com:org/repo.git',
    github: { branchPrefix: 'agent', baseBranch: 'main' }
  }, runner);

  await assert.rejects(() => wm.prepare({ key: 'ENG-9' }, { id: 'A' }, { attempt: 2 }), /128|bad revision/);
  assert.equal(calls.find((c) => c.args.includes('checkout') && c.args.includes('-B')), undefined, 'must NOT reset on a real error');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd symphony_clone && node --test test/workspace-manager.test.js`
Expected: FAIL — `branchExists` still uses `rev-parse` (so the `git show-ref` stubs miss → default-resolve makes the error tests not reject) and `countCommitsAhead` swallows to `0` (so its failure test does not reject).

- [ ] **Step 3: Rewrite the two helpers**

In `workspace-manager.js`, replace `branchExists` and `countCommitsAhead`:

```js
async function branchExists(runner, cwd, branchName) {
  try {
    await runGit(runner, cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;                       // exit 0 → exists
  } catch (error) {
    if (error && error.code === 1) return false;   // exit 1 → genuinely absent
    throw error;                       // any other code → real failure, propagate
  }
}

async function countCommitsAhead(runner, cwd, branch, base) {
  const { stdout } = await runGit(runner, cwd, ['rev-list', '--count', '--end-of-options', `${base}..${branch}`]);
  const n = Number.parseInt((stdout || '').trim(), 10);
  return Number.isFinite(n) ? n : 0;   // only a non-numeric stdout maps to 0; a thrown error propagates
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd symphony_clone && node --test test/workspace-manager.test.js`
Expected: PASS (all cases — the retry tests with updated `show-ref` keys, and the three new error-handling tests).

- [ ] **Step 5: Run the full symphony suite + commit**

Run: `cd symphony_clone && npm test`
Expected: PASS (all suites).

```bash
git add symphony_clone/src/orchestrator/workspace-manager.js symphony_clone/test/workspace-manager.test.js
git commit -m "fix(symphony): branchExists tri-state + countCommitsAhead propagation (no silent reset)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `runGit` per-command hook disable, all method git calls routed → Task 2 (+ Task 3 routes the helpers). ✓
- `runCommand` exposes `error.code`/`error.stderr` → Task 1. ✓
- `branchExists` → `show-ref --verify --quiet` tri-state (0/1/throw) → Task 3. ✓
- `countCommitsAhead` propagates errors → Task 3. ✓
- Destructive `checkout -B` only on a confident "absent" signal → asserted by Task 3's two "must NOT reset on a real error" tests. ✓
- Hook disable verified on every symphony git call → Task 2's hook-disable test. ✓
- Existing prepare/recovery happy paths still pass (assertions + handler keys updated) → Tasks 2 & 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions + the exact `cd symphony_clone && node --test …` command and expected result.

**Type consistency:** `runGit(runner, cwd, args)` (Task 2) used by Task 3's helpers; `error.code` (Task 1) read by Task 3's `branchExists`; the test `runner` signature and `recordingRunner` key adaptation are consistent across Tasks 2 & 3. Git subcommands (`show-ref`, `rev-list`, `clone`, `checkout`, `tag`) referenced consistently.

**Out of scope (unchanged):** the other fix-#4 items (in-session AUTO_MERGE, context:fork gate cleanup, concurrency caps, publish-to-jira.js).
