# Per-cluster Stacked PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "a PR per independent user-story cluster" a real, deterministic capability — a pure wave/branch/base planner plus a thin PR opener replace the LLM prose that today hand-rolls git and stalls full-auto by waiting for human merges.

**Architecture:** A new pure script `wave-plan.js` reads a machine-readable `dependency-graph.json` (newly emitted by `/spec`) plus `features.json`, and emits topological waves with each group's `branch`/`base`/`mergeIn` and a top-level `pr_mode`. A thin idempotent `wave-pr.js` wraps `gh pr create --draft`. The `/auto` Section 4B pod prose stops doing git by hand: it calls these scripts and never waits for a predecessor merge (dependent clusters stack on the predecessor's *branch*).

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test` + `assert`, `gh` CLI, Markdown skills.

## Global Constraints

- Node scripts are CommonJS with `'use strict';` at the top; pure logic takes parsed inputs (no file/network I/O) so it is unit-testable — mirror `.claude/scripts/build-chain-state.js`.
- Tests use `const { test } = require('node:test');` + `const assert = require('assert');` and live in `test/*.test.js` (run by `npm test` → `node --test test/*.test.js test/e2e/helpers/*.test.js`).
- Branch naming for clusters is exactly `auto/group-{id}` (matches existing `/auto` Section 4B).
- The default integration base branch is `main`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT edit `CLAUDE.md` (prompt-cache prefix rule).
- Work stays on branch `feat/per-cluster-stacked-prs`.

---

### Task 1: `wave-plan.js` — pure deterministic planner

**Files:**
- Create: `.claude/scripts/wave-plan.js`
- Test: `test/wave-plan.test.js`

**Interfaces:**
- Produces: `planWaves(graph, features, options) -> { pr_mode: 'integrated'|'per-cluster', waves: Array<Array<{ id: string, branch: string, base: string, mergeIn: string[] }>> }` where `graph = { groups: [{ id, stories, blockedBy }] }`, `features = [{ group, passes }]`, `options = { singlePr?: boolean }`. Also exports `unfinishedGroupIds(graph, features) -> string[]`.
- Consumes: nothing (foundation task).

- [ ] **Step 1: Write the failing test**

Create `test/wave-plan.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { planWaves } = require('../.claude/scripts/wave-plan.js');

// helpers: every group has at least one failing feature unless noted
const g = (groups) => ({ groups });
const failing = (...ids) => ids.map((group) => ({ group, passes: false }));

test('single unfinished group => integrated pr_mode', () => {
  const plan = planWaves(g([{ id: 'A', stories: ['S1'], blockedBy: [] }]), failing('A'));
  assert.strictEqual(plan.pr_mode, 'integrated');
  assert.strictEqual(plan.waves.length, 1);
  assert.deepStrictEqual(plan.waves[0][0], { id: 'A', branch: 'auto/group-A', base: 'main', mergeIn: [] });
});

test('two independent clusters => per-cluster, both based on main, one wave', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: [] }]),
    failing('A', 'B'),
  );
  assert.strictEqual(plan.pr_mode, 'per-cluster');
  assert.strictEqual(plan.waves.length, 1);
  assert.deepStrictEqual(plan.waves[0].map((x) => x.base), ['main', 'main']);
});

test('chain A->B => B stacks on auto/group-A in a later wave', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: ['A'] }]),
    failing('A', 'B'),
  );
  assert.strictEqual(plan.waves.length, 2);
  assert.deepStrictEqual(plan.waves[1][0], { id: 'B', branch: 'auto/group-B', base: 'auto/group-A', mergeIn: [] });
});

test('diamond A->{B,C}->D => D bases on main and merges in B and C', () => {
  const plan = planWaves(
    g([
      { id: 'A', stories: ['S1'], blockedBy: [] },
      { id: 'B', stories: ['S2'], blockedBy: ['A'] },
      { id: 'C', stories: ['S3'], blockedBy: ['A'] },
      { id: 'D', stories: ['S4'], blockedBy: ['B', 'C'] },
    ]),
    failing('A', 'B', 'C', 'D'),
  );
  const d = plan.waves[plan.waves.length - 1][0];
  assert.deepStrictEqual(d, { id: 'D', branch: 'auto/group-D', base: 'main', mergeIn: ['auto/group-B', 'auto/group-C'] });
});

test('--single-pr forces integrated regardless of count', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: [] }]),
    failing('A', 'B'),
    { singlePr: true },
  );
  assert.strictEqual(plan.pr_mode, 'integrated');
});

test('fully-passing groups are excluded from the waves', () => {
  const plan = planWaves(
    g([{ id: 'A', stories: ['S1'], blockedBy: [] }, { id: 'B', stories: ['S2'], blockedBy: [] }]),
    [{ group: 'A', passes: true }, { group: 'B', passes: false }],
  );
  const ids = plan.waves.flat().map((x) => x.id);
  assert.deepStrictEqual(ids, ['B']);
  assert.strictEqual(plan.pr_mode, 'integrated'); // only one group left to build
});

test('a dependency cycle throws', () => {
  assert.throws(() => planWaves(
    g([{ id: 'A', stories: [], blockedBy: ['B'] }, { id: 'B', stories: [], blockedBy: ['A'] }]),
    failing('A', 'B'),
  ), /cycle/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wave-plan.test.js`
Expected: FAIL — `Cannot find module '../.claude/scripts/wave-plan.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/scripts/wave-plan.js`:

```js
'use strict';

// Pure, deterministic wave/branch/base planner for per-cluster stacked PRs.
// No git, no network, no file I/O in planWaves — callers pass parsed inputs so
// the topology logic is unit-testable (mirrors build-chain-state.js). The CLI
// entrypoint reads the canonical spec files and prints the plan as JSON.

const fs = require('fs');

function unfinishedGroupIds(graph, features) {
  const failing = new Set(
    (features || [])
      .filter((f) => f && f.passes === false && f.group != null)
      .map((f) => String(f.group)),
  );
  return graph.groups.map((g) => String(g.id)).filter((id) => failing.has(id));
}

function gitPlanFor(id, preds) {
  const branch = `auto/group-${id}`;
  if (preds.length === 0) return { id, branch, base: 'main', mergeIn: [] };
  if (preds.length === 1) return { id, branch, base: `auto/group-${preds[0]}`, mergeIn: [] };
  return { id, branch, base: 'main', mergeIn: preds.map((p) => `auto/group-${p}`) };
}

function planWaves(graph, features, options = {}) {
  if (!graph || !Array.isArray(graph.groups)) {
    throw new Error('wave-plan: graph.groups must be an array');
  }
  const todo = unfinishedGroupIds(graph, features);
  const todoSet = new Set(todo);
  const byId = new Map(graph.groups.map((g) => [String(g.id), g]));

  // active predecessors = blockedBy edges that are themselves still unfinished
  const activePreds = new Map();
  for (const id of todo) {
    const group = byId.get(id);
    const preds = (group.blockedBy || []).map(String).filter((p) => todoSet.has(p)).sort();
    activePreds.set(id, preds);
  }

  // topological layering over the unfinished subgraph
  const waves = [];
  const placed = new Set();
  while (placed.size < todo.length) {
    const layer = todo
      .filter((id) => !placed.has(id))
      .filter((id) => activePreds.get(id).every((p) => placed.has(p)))
      .sort();
    if (layer.length === 0) throw new Error('wave-plan: dependency cycle among unfinished groups');
    waves.push(layer.map((id) => gitPlanFor(id, activePreds.get(id))));
    layer.forEach((id) => placed.add(id));
  }

  const prMode = (todo.length <= 1 || options.singlePr) ? 'integrated' : 'per-cluster';
  return { pr_mode: prMode, waves };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const singlePr = args.includes('--single-pr');
  const graphPath = argValue(args, '--graph') || 'specs/stories/dependency-graph.json';
  const featuresPath = argValue(args, '--features') || 'features.json';
  let graph;
  try {
    graph = readJson(graphPath);
  } catch (e) {
    process.stderr.write(`wave-plan: cannot read ${graphPath}: ${e.message}\n`);
    process.exit(2);
  }
  let features = [];
  try { features = readJson(featuresPath); } catch (_) { features = []; }
  try {
    process.stdout.write(`${JSON.stringify(planWaves(graph, features, { singlePr }), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { planWaves, unfinishedGroupIds };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/wave-plan.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/wave-plan.js test/wave-plan.test.js
git commit -m "feat(auto): deterministic wave/branch/base planner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `wave-pr.js` — thin idempotent PR opener

**Files:**
- Create: `.claude/scripts/wave-pr.js`
- Test: `test/wave-pr.test.js`

**Interfaces:**
- Produces: `openPr({ branch, base, title?, body? }, runner?) -> string` (PR URL); `existingPrUrl(branch, runner) -> string|null`. `runner(cmd, args) -> string` defaults to a real `execFileSync`; tests inject a stub.
- Consumes: nothing (parallel to Task 1).

- [ ] **Step 1: Write the failing test**

Create `test/wave-pr.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { openPr } = require('../.claude/scripts/wave-pr.js');

test('openPr is idempotent: returns the existing PR and never creates', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push(args);
    if (args[1] === 'list') return 'https://github.com/o/r/pull/7\n';
    throw new Error('should not have called gh pr create');
  };
  const url = openPr({ branch: 'auto/group-A', base: 'main' }, runner);
  assert.strictEqual(url, 'https://github.com/o/r/pull/7');
  assert.strictEqual(calls.length, 1);
});

test('openPr creates a draft PR with the computed base when none exists', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push(args);
    if (args[1] === 'list') return '\n';
    return 'https://github.com/o/r/pull/8\n';
  };
  const url = openPr({ branch: 'auto/group-B', base: 'auto/group-A', title: 'B', body: 'x' }, runner);
  assert.strictEqual(url, 'https://github.com/o/r/pull/8');
  const create = calls.find((a) => a[1] === 'create');
  assert.ok(create.includes('--draft'));
  assert.strictEqual(create[create.indexOf('--base') + 1], 'auto/group-A');
  assert.strictEqual(create[create.indexOf('--head') + 1], 'auto/group-B');
});

test('openPr requires branch and base', () => {
  assert.throws(() => openPr({ branch: 'auto/group-A' }, () => ''), /base/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/wave-pr.test.js`
Expected: FAIL — `Cannot find module '../.claude/scripts/wave-pr.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/scripts/wave-pr.js`:

```js
'use strict';

// Thin, idempotent wrapper around `gh` to open one stacked draft PR for a
// cluster. branch/base come from wave-plan.js; this script only opens (or finds)
// the PR so the agent never hand-rolls `gh pr create` flags.

const { execFileSync } = require('child_process');

function defaultRunner(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function existingPrUrl(branch, runner) {
  try {
    const out = runner('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url']);
    const url = String(out).trim();
    return url || null;
  } catch (_) {
    return null;
  }
}

function openPr(opts, runner = defaultRunner) {
  const { branch, base, title, body } = opts || {};
  if (!branch || !base) throw new Error('wave-pr: branch and base are required');
  const existing = existingPrUrl(branch, runner);
  if (existing) return existing;
  const out = runner('gh', [
    'pr', 'create', '--draft',
    '--base', base, '--head', branch,
    '--title', title || branch, '--body', body || '',
  ]);
  return String(out).trim();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
  try {
    process.stdout.write(`${openPr({ branch: get('--branch'), base: get('--base'), title: get('--title'), body: get('--body') })}\n`);
  } catch (e) {
    process.stderr.write(`wave-pr: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { openPr, existingPrUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/wave-pr.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/wave-pr.js test/wave-pr.test.js
git commit -m "feat(auto): idempotent stacked draft-PR opener

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/spec` emits `dependency-graph.json`

**Files:**
- Modify: `.claude/skills/spec/SKILL.md` (Step 4, after the Mermaid block following line ~88)
- Create: `test/e2e/fixtures/stories/dependency-graph.json`
- Test: `test/spec-graph-json-contract.test.js`

**Interfaces:**
- Produces: the `specs/stories/dependency-graph.json` contract `{ groups: [{ id, stories, blockedBy }] }` that Task 1's `wave-plan.js` consumes at runtime. The fixture is the canonical example wave-plan tests could load (kept in sync with `test/e2e/fixtures/stories/dependency-graph.md`).
- Consumes: Task 1's schema (`id`, `stories`, `blockedBy`).

- [ ] **Step 1: Write the failing test**

Create `test/spec-graph-json-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const SPEC_SKILL = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'spec', 'SKILL.md'), 'utf8',
);

test('/spec documents the machine-readable dependency-graph.json', () => {
  assert.ok(SPEC_SKILL.includes('dependency-graph.json'), 'SKILL.md must instruct writing dependency-graph.json');
  assert.ok(/blockedBy/.test(SPEC_SKILL), 'SKILL.md must document the blockedBy field');
});

test('the dependency-graph.json fixture matches the wave-plan schema', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'e2e', 'fixtures', 'stories', 'dependency-graph.json'), 'utf8',
  ));
  assert.ok(Array.isArray(graph.groups));
  for (const grp of graph.groups) {
    assert.strictEqual(typeof grp.id, 'string');
    assert.ok(Array.isArray(grp.stories));
    assert.ok(Array.isArray(grp.blockedBy));
  }
});

test('the json fixture covers the same groups as the md fixture', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'e2e', 'fixtures', 'stories', 'dependency-graph.json'), 'utf8',
  ));
  assert.deepStrictEqual(graph.groups.map((g) => g.id).sort(), ['A', 'B']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spec-graph-json-contract.test.js`
Expected: FAIL — fixture file missing (`ENOENT … dependency-graph.json`) and/or SKILL.md assertions fail.

- [ ] **Step 3a: Create the fixture**

Create `test/e2e/fixtures/stories/dependency-graph.json`:

```json
{
  "groups": [
    { "id": "A", "stories": ["E1-S1", "E1-S2"], "blockedBy": [] },
    { "id": "B", "stories": ["E1-S3", "E1-S4"], "blockedBy": ["A"] }
  ]
}
```

- [ ] **Step 3b: Add the emission instruction to `/spec`**

In `.claude/skills/spec/SKILL.md`, immediately after the Mermaid example block in Step 4 (the closing ```` ``` ```` of the `flowchart TD` example, around line 96), insert:

```markdown

Then write a machine-readable sibling `specs/stories/dependency-graph.json` with the
exact same groups, for deterministic downstream wave planning (`.claude/scripts/wave-plan.js`):

```json
{
  "groups": [
    { "id": "A", "stories": ["E1-S1", "E1-S2"], "blockedBy": [] },
    { "id": "B", "stories": ["E1-S3"], "blockedBy": ["A"] }
  ]
}
```

`id` is the group letter, `stories` lists its story IDs, and `blockedBy` lists the
group IDs it depends on (empty for roots). The `.md` is the human artifact; the
`.json` is the contract code reads — keep them in sync.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/spec-graph-json-contract.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/spec/SKILL.md test/e2e/fixtures/stories/dependency-graph.json test/spec-graph-json-contract.test.js
git commit -m "feat(spec): emit machine-readable dependency-graph.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `build-lane.js` surfaces `--single-pr`

**Files:**
- Modify: `.claude/scripts/build-lane.js:14` (wrap `parseBuildInvocation`)
- Test: `test/build-lane.test.js` (append cases)

**Interfaces:**
- Produces: `parseBuildInvocation(input).singlePr: boolean` on every valid lane result. Forwarded by Task 6.
- Consumes: existing `tokenize` (already in the file).

- [ ] **Step 1: Write the failing test**

Append to `test/build-lane.test.js`:

```js
test('--single-pr is surfaced without changing lane or prd', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto --single-pr');
  assert.strictEqual(r.lane, 'auto');
  assert.strictEqual(r.prdPath, 'docs/prd.md');
  assert.strictEqual(r.singlePr, true);
});

test('singlePr defaults to false', () => {
  const r = parseBuildInvocation('/build docs/prd.md --auto');
  assert.strictEqual(r.singlePr, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-lane.test.js`
Expected: FAIL — `r.singlePr` is `undefined`, not `true`/`false`.

- [ ] **Step 3: Write minimal implementation**

In `.claude/scripts/build-lane.js`, rename the existing `function parseBuildInvocation(input) {` (line 14) to `function resolveLane(input) {`, then add this wrapper directly above the `function laneResult(result)` definition:

```js
function parseBuildInvocation(input) {
  const result = resolveLane(input);
  if (result && result.valid !== false) {
    result.singlePr = tokenize(input).includes('--single-pr');
  }
  return result;
}
```

Leave `module.exports = { parseBuildInvocation };` unchanged. (`--single-pr` is a boolean flag — it is not in `FLAG_VALUE`, so `resolveLane` already ignores it for lane selection and never consumes the PRD arg.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-lane.test.js`
Expected: PASS (existing cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/build-lane.js test/build-lane.test.js
git commit -m "feat(build): surface --single-pr in lane parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `/auto` Section 4B — wire the planner, drop the merge-wait

**Files:**
- Modify: `.claude/skills/auto/SKILL.md:36` (the `--pod N` bullet) and `.claude/skills/auto/SKILL.md:355` (pod terminal step)
- Test: `test/auto-per-cluster-contract.test.js`

**Interfaces:**
- Consumes: the `wave-plan.js` CLI (`node .claude/scripts/wave-plan.js [--single-pr]` → JSON with `pr_mode`/`waves`/`branch`/`base`/`mergeIn`) from Task 1 and `wave-pr.js` (`node .claude/scripts/wave-pr.js --branch <b> --base <base> --title <t> --body <body>`) from Task 2.
- Produces: prose contract (no code symbols) consumed only by the runtime agent.

- [ ] **Step 1: Write the failing test**

Create `test/auto-per-cluster-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const AUTO = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'auto', 'SKILL.md'), 'utf8',
);

test('pod mode wires the deterministic planner and PR opener', () => {
  assert.ok(AUTO.includes('wave-plan.js'), 'must call wave-plan.js');
  assert.ok(AUTO.includes('wave-pr.js'), 'must call wave-pr.js');
});

test('pod mode no longer waits for predecessor PRs to merge', () => {
  assert.ok(!/wait for .*PRs to merge/i.test(AUTO), 'merge-wait language must be gone');
});

test('pod mode documents stacked bases (no merge wait)', () => {
  assert.ok(/stack/i.test(AUTO), 'must describe stacked branches/PRs');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auto-per-cluster-contract.test.js`
Expected: FAIL — `wave-plan.js`/`wave-pr.js` absent and the `wait for ... PRs to merge` phrase still present (line 36 and line 355).

- [ ] **Step 3a: Rewrite the `--pod N` bullet**

In `.claude/skills/auto/SKILL.md`, replace the entire line 36 bullet (`- \`--pod N\` — **pod mode**: …surfaced by \`/build --autonomous --pod N\`.`) with:

```markdown
- `--pod N` — **pod mode**: cross-group concurrency (implies `--parallel-groups N`, default `3`). PR granularity is decided automatically by `.claude/scripts/wave-plan.js` (`pr_mode`): when more than one cluster is unfinished, each cluster raises its **own stacked draft PR** instead of rolling its branch up to the trunk; a single remaining cluster (or `--single-pr`) yields one integrated PR. Each cluster is verified per-cluster (the Phase 9.5 deploy→API→E2E→fix ladder, scoped to that cluster). Dependent clusters **stack on their predecessor's branch** — they do **not** wait for any PR to merge. See Section 4B → *Pod mode*. Surfaced by `/build --autonomous --pod N`; `--single-pr` forces one integrated PR.
```

- [ ] **Step 3b: Rewrite the pod terminal step (line ~347–370, "Pod mode" subsection)**

In the `### Pod mode (\`--pod N\`) — per-cluster PRs` subsection, replace item 3 (the `**The parent does NOT merge branches.**` paragraph at line 355) and the branch/base mechanics so the terminal step reads:

```markdown
3. **The parent does NOT merge branches and does NOT wait for merges.** Run
   `node .claude/scripts/wave-plan.js` (add `--single-pr` to force integrated) to get
   the deterministic plan: `pr_mode` and, per group, its `branch`, `base`, and
   `mergeIn`. For each cluster `G` in the wave:
   - create `branch` (`auto/group-{G}`) from its computed `base` — `main` for a
     root or single-parent **stacked** PR (`base` = the predecessor's branch), and
     for a diamond-join group, from `main` then merge each `mergeIn` branch in
     locally so it builds against all upstream code;
   - on green, open the stacked PR with
     `node .claude/scripts/wave-pr.js --branch auto/group-{G} --base <base> --title "<cluster title>" --body "<stories + Phase 9.5 proof + Forbidden-Actions check; for a mergeIn group, list the predecessor PRs as dependencies>"`.
   Then roll up per-group *state* as usual and **compute the next wave immediately** —
   dependent clusters build on their predecessor's *branch*, never on a merged trunk.
   Humans merge the stack bottom-up; GitHub auto-retargets each child PR to `main`
   as its parent merges. If `pr_mode` is `integrated`, skip per-cluster PRs and roll
   the wave up to the trunk exactly as non-pod mode does.
```

Ensure no remaining sentence in this subsection contains "wait for … PRs to merge" or references `WAVE_BASE` as the PR base (the base now comes from `wave-plan.js`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auto-per-cluster-contract.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/auto/SKILL.md test/auto-per-cluster-contract.test.js
git commit -m "feat(auto): stacked per-cluster PRs via wave-plan/wave-pr, no merge wait

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `build-chain.js` forwards `--single-pr`

**Files:**
- Modify: `.claude/scripts/build-chain.js:63` (`promptFor`), `:78` (`realSpawnLink`), `:124` (CLI block)
- Test: `test/build-chain-single-pr.test.js`

**Interfaces:**
- Consumes: `promptFor(kind, prd, opts)` (existing export). Adds `opts.singlePr` support so the cross-process runtime honors `--single-pr` on every link.
- Produces: nothing new exported (behavior change only).

- [ ] **Step 1: Write the failing test**

Create `test/build-chain-single-pr.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { promptFor } = require('../.claude/scripts/build-chain.js');

test('promptFor forwards --single-pr to every link kind', () => {
  assert.ok(promptFor('PLAN', 'prd.md', { singlePr: true }).includes('--single-pr'));
  assert.ok(promptFor('FINALIZE', 'prd.md', { singlePr: true }).includes('--single-pr'));
  assert.ok(promptFor('BUILD', 'prd.md', { singlePr: true }).includes('--single-pr'));
});

test('promptFor omits --single-pr by default', () => {
  assert.ok(!promptFor('BUILD', 'prd.md', {}).includes('--single-pr'));
  assert.ok(!promptFor('PLAN', 'prd.md', {}).includes('--single-pr'));
});

test('promptFor still appends --sequential for BUILD links', () => {
  const p = promptFor('BUILD', 'prd.md', { sequential: true, singlePr: true });
  assert.ok(p.includes('--sequential') && p.includes('--single-pr'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build-chain-single-pr.test.js`
Expected: FAIL — `--single-pr` not present in any prompt.

- [ ] **Step 3: Write minimal implementation**

In `.claude/scripts/build-chain.js`, replace `promptFor` (lines 63–67) with:

```js
function promptFor(kind, prd, opts = {}) {
  const single = opts.singlePr ? ' --single-pr' : '';
  if (kind === S.STATES.PLAN) return `/build --auto --plan-only ${prd}${single}`;
  if (kind === S.STATES.FINALIZE) return `/build --auto --finalize${single}`;
  return `/auto --once${opts.sequential ? ' --sequential' : ''}${single}`; // BUILD
}
```

Change `realSpawnLink` (line 78) to thread the flag — replace its signature and the `promptFor` call inside:

```js
function realSpawnLink(cwd, prd, runOpts = {}) {
```

and inside the returned closure replace `input: promptFor(kind, prd, opts),` with:

```js
      input: promptFor(kind, prd, { ...opts, singlePr: runOpts.singlePr }),
```

In the CLI block (line 124), parse the flag and pass it through — replace the `runChain({ spawnLink: realSpawnLink(cwd, prd), …})` call with:

```js
  const singlePr = process.argv.includes('--single-pr');
  runChain({ spawnLink: realSpawnLink(cwd, prd, { singlePr }), loadState: realLoadState(cwd), checkBudget: realCheckBudget(cwd), log: (m) => process.stdout.write(`${m}\n`) })
```

(`prd` is `process.argv[2]`; a trailing `--single-pr` does not affect it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build-chain-single-pr.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: PASS (all suites, including the five new files).

```bash
git add .claude/scripts/build-chain.js test/build-chain-single-pr.test.js
git commit -m "feat(build-chain): forward --single-pr to cross-process links

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `dependency-graph.json` emitted by `/spec` → Task 3. ✓
- `wave-plan.js` (waves + branch/base/mergeIn + pr_mode, pure) → Task 1. ✓
- `wave-pr.js` (thin idempotent gh wrapper) → Task 2. ✓
- `/auto` Section 4B rewrite (no merge wait, stacked bases) → Task 5. ✓
- `build-chain.js` per-cluster honoring (`--single-pr` forward) → Task 6. ✓
- `--single-pr` flag → Task 4 (parser) + Task 6 (forward) + Task 1/5 (consume). ✓
- Diamond-join (`base: main` + `mergeIn`) → Task 1 test + Task 5 prose. ✓
- Error handling: malformed graph exits non-zero (Task 1 CLI); `gh` failure surfaced, not swallowed (Task 2 returns/throws, CLI exits 2). ✓
- Readiness = predecessor built not merged → encoded as topological layering over the unfinished subgraph (Task 1). ✓
- Test matrix (1 cluster, 2 independent, chain, diamond, --single-pr, unfinished filter, ordering/cycle) → Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions and the exact run command + expected result.

**Type consistency:** `planWaves`/`unfinishedGroupIds` (Task 1), `openPr`/`existingPrUrl` (Task 2), `parseBuildInvocation(...).singlePr` (Task 4), `promptFor(kind, prd, {singlePr, sequential})` (Task 6) are referenced consistently across tasks. Group objects use `{ id, stories, blockedBy }` everywhere; plan entries use `{ id, branch, base, mergeIn }` everywhere; `pr_mode` is `'integrated'|'per-cluster'` everywhere.

**Out of scope (unchanged here):** tracker-path PR stacking and brownfield routing (fixes #2–#3).
