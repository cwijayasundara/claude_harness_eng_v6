# Autonomous Brownfield Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/feature` `--autonomous` (1 gate) and `--auto` (0 gates) lanes that converge on `/auto`/`/change`, with a deterministic seam-confidence gate plus a reused judged adherence critic replacing the human design-adherence gate.

**Architecture:** A pure `feature-lane.js` parses the lane (mirrors `build-lane.js`). A pure `seam-confidence.js` reuses `seam-finder`'s `scoreSeams()` to band whether a clean seam exists (deterministic layer). The existing **evaluator** (artifact mode) and **diff-reviewer** agents gain a brownfield-adherence rubric/lens (judged layer). `/feature` SKILL.md documents the lanes and wires the autonomous spine; low seam-confidence in `--auto` stops and surfaces a report.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test` + `assert`, Markdown skills/agents.

## Global Constraints

- Node scripts are CommonJS with `'use strict';`; pure logic takes parsed inputs (no file/network I/O) so it is unit-testable — mirror `.claude/scripts/build-lane.js` and `.claude/scripts/build-chain-state.js`.
- Tests use `const { test } = require('node:test');` + `const assert = require('assert');` in `test/*.test.js` (run by `npm test`).
- Lanes: `gated` → `humanGates: 3`; `autonomous` → `humanGates: 1`; `auto` → `humanGates: 0`. `--auto` implies the autonomous tail (gates 0). All lanes stop at the open PR; merge stays human.
- Seam-confidence threshold is `0.5` — matches the existing `sprouting-instead-of-editing` seam cutoff.
- `code-graph.json` shape: `{ nodes: [{id, path, symbols}], edges: [{source, target, evidence, import_kind?}], metrics: {cycles: [...]} }`.
- `scoreSeams(graph, goal, opts)` returns candidate objects with at least `{ id, path, total_score, recommended_action }`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT edit `CLAUDE.md`. Work stays on branch `feat/autonomous-brownfield-lane`.

---

### Task 1: Make `score_seams.js` requireable (export `scoreSeams`)

**Files:**
- Modify: `.claude/skills/seam-finder/scripts/score_seams.js` (bottom: the `main();` call + add exports)
- Test: `test/score-seams-export.test.js`

**Interfaces:**
- Produces: `module.exports = { scoreSeams }` where `scoreSeams(graph, goal, opts={}) -> Array<{ id, path, total_score, recommended_action, ... }>`. Consumed by Task 2's `seam-confidence.js`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `test/score-seams-export.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { scoreSeams } = require('../.claude/skills/seam-finder/scripts/score_seams.js');

const GRAPH = {
  nodes: [
    { id: 'n1', path: 'src/api/routes.js', symbols: ['handleRequest'] },
    { id: 'n2', path: 'src/utils/helper.js', symbols: ['fmt'] },
  ],
  edges: [{ source: 'n2', target: 'n1', evidence: 'import' }],
  metrics: { cycles: [] },
};

test('scoreSeams is exported and returns scored candidates', () => {
  const candidates = scoreSeams(GRAPH, 'request handling', {});
  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.length >= 1);
  for (const c of candidates) {
    assert.strictEqual(typeof c.path, 'string');
    assert.strictEqual(typeof c.total_score, 'number');
    assert.strictEqual(typeof c.recommended_action, 'string');
  }
});

test('requiring the module does not run the CLI (no exit)', () => {
  // If require() invoked main(), the missing --graph/--out would have exited the
  // process before this point; reaching here proves main() is guarded.
  assert.ok(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/score-seams-export.test.js`
Expected: FAIL — either the process exits non-zero from `main()` running on require (usage error), or `scoreSeams` is `undefined` (not exported).

- [ ] **Step 3: Make the change**

In `.claude/skills/seam-finder/scripts/score_seams.js`, replace the final `main();` line with a guarded call and add an export immediately after the `main` function:

```js
if (require.main === module) {
  main();
}

module.exports = { scoreSeams };
```

(Leave `scoreSeams`, `main`, and all other functions unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/score-seams-export.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/seam-finder/scripts/score_seams.js test/score-seams-export.test.js
git commit -m "refactor(seam-finder): export scoreSeams, guard CLI behind require.main

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `seam-confidence.js` — deterministic seam-confidence gate

**Files:**
- Create: `.claude/scripts/seam-confidence.js`
- Test: `test/seam-confidence.test.js`

**Interfaces:**
- Consumes: Task 1's `scoreSeams(graph, goal, opts)` (CLI path only).
- Produces: `seamConfidence(candidates) -> { band: 'high'|'low', target_seam: string|null, total_score: number, reasons: string[] }`; also exports `THRESHOLD` (`0.5`).

- [ ] **Step 1: Write the failing test**

Create `test/seam-confidence.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { seamConfidence, THRESHOLD } = require('../.claude/scripts/seam-confidence.js');

test('THRESHOLD matches the sprouting cutoff', () => {
  assert.strictEqual(THRESHOLD, 0.5);
});

test('a clean seam (score >= 0.5, extendable) bands high and names the target', () => {
  const r = seamConfidence([
    { path: 'src/api/routes.js', total_score: 0.82, recommended_action: 'extend' },
    { path: 'src/utils/helper.js', total_score: 0.21, recommended_action: 'avoid' },
  ]);
  assert.strictEqual(r.band, 'high');
  assert.strictEqual(r.target_seam, 'src/api/routes.js');
  assert.strictEqual(r.total_score, 0.82);
});

test('best score below threshold bands low', () => {
  const r = seamConfidence([
    { path: 'src/utils/a.js', total_score: 0.3, recommended_action: 'wrap' },
  ]);
  assert.strictEqual(r.band, 'low');
  assert.ok(r.reasons.some((x) => /0\.3/.test(x) && /0\.5/.test(x)));
});

test("best candidate recommending 'avoid' bands low even at a high score", () => {
  const r = seamConfidence([
    { path: 'src/legacy/god.js', total_score: 0.9, recommended_action: 'avoid' },
  ]);
  assert.strictEqual(r.band, 'low');
  assert.ok(r.reasons.some((x) => /avoid/.test(x)));
});

test('no candidates bands low with a no-seam reason', () => {
  const r = seamConfidence([]);
  assert.strictEqual(r.band, 'low');
  assert.strictEqual(r.target_seam, null);
  assert.ok(r.reasons.some((x) => /no seam/i.test(x)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/seam-confidence.test.js`
Expected: FAIL — `Cannot find module '../.claude/scripts/seam-confidence.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/scripts/seam-confidence.js`:

```js
'use strict';

// Deterministic seam-confidence gate — the first layer of autonomous-brownfield
// adherence enforcement. Pure band logic takes the scored candidates so it is
// unit-testable; the CLI reads code-graph.json, runs the seam scorer, and prints
// the band. "Is there a clean seam to extend?" — not "did the plan use it?"
// (that is the judged adherence critic).

const THRESHOLD = 0.5; // matches sprouting-instead-of-editing's seam cutoff

function seamConfidence(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { band: 'low', target_seam: null, total_score: 0, reasons: ['no seam candidates for this goal'] };
  }
  const best = candidates.reduce((a, b) => (b.total_score > a.total_score ? b : a));
  const reasons = [];
  let band = 'high';
  if (best.total_score < THRESHOLD) {
    band = 'low';
    reasons.push(`best seam score ${best.total_score} < ${THRESHOLD}`);
  }
  if (best.recommended_action === 'avoid') {
    band = 'low';
    reasons.push("best candidate recommends 'avoid' (no clean boundary to extend)");
  }
  if (band === 'high') {
    reasons.push(`clean seam to extend: ${best.path} (score ${best.total_score}, ${best.recommended_action})`);
  }
  return { band, target_seam: best.path, total_score: best.total_score, reasons };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

if (require.main === module) {
  const fs = require('fs');
  const { scoreSeams } = require('../skills/seam-finder/scripts/score_seams.js');
  const args = process.argv.slice(2);
  const graphPath = argValue(args, '--graph') || 'specs/brownfield/code-graph.json';
  const goal = argValue(args, '--goal') || '';
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`seam-confidence: cannot read ${graphPath}: ${e.message}\n`);
    process.exit(2);
  }
  const candidates = scoreSeams(graph, goal, {});
  process.stdout.write(`${JSON.stringify(seamConfidence(candidates), null, 2)}\n`);
}

module.exports = { seamConfidence, THRESHOLD };
```

Note: the CLI `require('../skills/seam-finder/scripts/score_seams.js')` resolves from `.claude/scripts/` to `.claude/skills/seam-finder/scripts/score_seams.js`. It depends on Task 1's guard so requiring it does not run the CLI.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/seam-confidence.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/seam-confidence.js test/seam-confidence.test.js
git commit -m "feat(brownfield): deterministic seam-confidence gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `feature-lane.js` — deterministic lane parser

**Files:**
- Create: `.claude/scripts/feature-lane.js`
- Test: `test/feature-lane.test.js`

**Interfaces:**
- Produces: `parseFeatureInvocation(input) -> { valid: true, lane: 'gated'|'autonomous'|'auto', humanGates: 3|1|0, request: string, auto: boolean, autonomous: boolean }` or `{ valid: false, error: string }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `test/feature-lane.test.js`:

```js
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { parseFeatureInvocation } = require('../.claude/scripts/feature-lane.js');

test('default lane has the three interactive gates', () => {
  const r = parseFeatureInvocation('/feature "add confidence scores"');
  assert.strictEqual(r.lane, 'gated');
  assert.strictEqual(r.humanGates, 3);
  assert.strictEqual(r.request, 'add confidence scores');
});

test('--autonomous is one gate', () => {
  const r = parseFeatureInvocation('/feature "split billing" --autonomous');
  assert.strictEqual(r.lane, 'autonomous');
  assert.strictEqual(r.humanGates, 1);
  assert.strictEqual(r.autonomous, true);
});

test('--auto is zero gates and implies the autonomous tail', () => {
  const r = parseFeatureInvocation('/feature --auto "add a health endpoint"');
  assert.strictEqual(r.lane, 'auto');
  assert.strictEqual(r.humanGates, 0);
  assert.strictEqual(r.auto, true);
  assert.strictEqual(r.autonomous, true);
  assert.strictEqual(r.request, 'add a health endpoint');
});

test('flags are order-independent and stripped from the request', () => {
  const a = parseFeatureInvocation('/feature --auto "do the thing"');
  const b = parseFeatureInvocation('/feature "do the thing" --auto');
  assert.deepStrictEqual(b, a);
  assert.strictEqual(a.request, 'do the thing');
});

test('a missing request is invalid', () => {
  const r = parseFeatureInvocation('/feature --auto');
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /request/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/feature-lane.test.js`
Expected: FAIL — `Cannot find module '../.claude/scripts/feature-lane.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/scripts/feature-lane.js`:

```js
'use strict';

// Deterministic /feature lane normalization. Mirrors build-lane.js: the skill
// prose still explains how to execute each lane; this makes flag meaning
// testable and order-free. /feature has no value-consuming flags, so every
// `--x` token is a boolean flag and everything else is the request text.

function tokenize(input) {
  const text = String(input || '').trim();
  if (!text) return [];
  return text.match(/"[^"]*"|'[^']*'|\S+/g).map((t) => t.replace(/^['"]|['"]$/g, ''));
}

function parseFeatureInvocation(input) {
  const tokens = tokenize(input).filter((t) => t !== '/feature');
  const flags = new Set();
  const request = [];
  for (const token of tokens) {
    if (token.startsWith('--')) flags.add(token);
    else request.push(token);
  }
  const requestText = request.join(' ').trim();
  if (!requestText) return { valid: false, error: 'A feature request is required.' };

  const auto = flags.has('--auto');
  const autonomous = auto || flags.has('--autonomous');
  if (auto) return laneResult({ lane: 'auto', auto: true, autonomous: true, humanGates: 0, request: requestText });
  if (autonomous) return laneResult({ lane: 'autonomous', auto: false, autonomous: true, humanGates: 1, request: requestText });
  return laneResult({ lane: 'gated', auto: false, autonomous: false, humanGates: 3, request: requestText });
}

function laneResult(result) {
  return { valid: true, ...result };
}

module.exports = { parseFeatureInvocation };

if (require.main === module) {
  const result = parseFeatureInvocation(process.argv.slice(2).join(' '));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.valid === false ? 2 : 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/feature-lane.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/feature-lane.js test/feature-lane.test.js
git commit -m "feat(feature): deterministic lane parser (gated/autonomous/auto)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Adherence critic (reuse evaluator + diff-reviewer)

**Files:**
- Modify: `.claude/agents/evaluator.md` (add a brownfield-adherence rubric to the artifact-mode section)
- Modify: `.claude/agents/diff-reviewer.md` (add a brownfield design-adherence lens)
- Test: `test/adherence-critic-contract.test.js`

**Interfaces:**
- Produces: the documented machine-adherence checks `/feature`'s autonomous lanes invoke (Task 5 references them by name: "brownfield-adherence rubric" in the evaluator, "design-adherence lens" in the diff-reviewer).
- Consumes: nothing (prose + contract test).

- [ ] **Step 1: Write the failing test**

Create `test/adherence-critic-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const EVAL = read('.claude/agents/evaluator.md');
const DIFF = read('.claude/agents/diff-reviewer.md');

test('evaluator documents the brownfield-adherence rubric', () => {
  assert.match(EVAL, /brownfield-adherence/i);
  assert.match(EVAL, /DeepWiki/);
  assert.match(EVAL, /parallel structure/i);
  assert.match(EVAL, /seam/i);
});

test('diff-reviewer documents the design-adherence lens', () => {
  assert.match(DIFF, /adherence/i);
  assert.match(DIFF, /seam/i);
  assert.match(DIFF, /parallel structure/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/adherence-critic-contract.test.js`
Expected: FAIL — neither agent file mentions the adherence rubric/lens yet.

- [ ] **Step 3a: Add the rubric to the evaluator**

In `.claude/agents/evaluator.md`, find the artifact-mode section (the part describing how the evaluator scores planning documents against a rubric) and add this subsection within it:

```markdown
### Brownfield-adherence rubric (artifact mode)

When scoring a brownfield plan/design for an autonomous `/feature` run, score it
against design-adherence — this is the machine replacement for the human GATE 2:

1. **Cites the wiki.** Every planned edit cites a specific committed DeepWiki
   page/symbol for the code it touches.
2. **Extends a seam.** Each edit names the existing module/seam/layer it extends,
   consistent with `specs/brownfield/code-graph.json`.
3. **No parallel structure.** Reject any plan that introduces a new parallel
   structure where an existing seam already fits.

Verdict: PASS only if all three hold; otherwise FAIL with the offending edits and
the seam each should have extended. A FAIL sends the plan back for a re-plan.
```

- [ ] **Step 3b: Add the lens to the diff-reviewer**

In `.claude/agents/diff-reviewer.md`, add this subsection (after the existing review-focus description):

```markdown
### Brownfield design-adherence lens

When invoked for an autonomous `/feature` run with an adherence context (the cited
seam + the committed DeepWiki), additionally verify the **diff** honored the plan:
the change extended the cited seam/module and did **not** drift into a new parallel
structure during implementation. Flag any file that introduces a parallel
structure where the plan said it would extend an existing seam — this blocks the
PR until corrected.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/adherence-critic-contract.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/evaluator.md .claude/agents/diff-reviewer.md test/adherence-critic-contract.test.js
git commit -m "feat(brownfield): adherence rubric (evaluator) + lens (diff-reviewer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `/feature` SKILL.md — document the lanes + autonomous spine

**Files:**
- Modify: `.claude/skills/feature/SKILL.md` (Usage, plus a new Lanes + Autonomous-spine section)
- Test: `test/feature-autonomous-contract.test.js`

**Interfaces:**
- Consumes: `feature-lane.js` (Task 3), `seam-confidence.js` (Task 2), the evaluator brownfield-adherence rubric + diff-reviewer adherence lens (Task 4).
- Produces: prose contract consumed by the runtime agent.

- [ ] **Step 1: Write the failing test**

Create `test/feature-autonomous-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const FEATURE = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'feature', 'SKILL.md'), 'utf8',
);

test('/feature documents the --autonomous and --auto lanes via feature-lane.js', () => {
  assert.match(FEATURE, /--autonomous/);
  assert.match(FEATURE, /--auto\b/);
  assert.match(FEATURE, /feature-lane\.js/);
});

test('autonomous lanes use the deterministic seam-confidence gate', () => {
  assert.match(FEATURE, /seam-confidence\.js/);
});

test('machine adherence replaces the human GATE 2 in autonomous lanes', () => {
  assert.match(FEATURE, /brownfield-adherence|adherence rubric/i);
  assert.match(FEATURE, /replaces?.*GATE 2|GATE 2.*machine|machine.*adherence/i);
});

test('low seam-confidence in --auto stops and surfaces a report', () => {
  assert.match(FEATURE, /adherence-report\.md/);
  assert.match(FEATURE, /stop|surface/i);
});

test('every lane still stops at the open PR (human merges)', () => {
  assert.match(FEATURE, /stop at .*PR|merge stays human|human (owns|merges)/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/feature-autonomous-contract.test.js`
Expected: FAIL — SKILL.md doesn't yet document the lanes/scripts.

- [ ] **Step 3a: Update Usage**

In `.claude/skills/feature/SKILL.md`, replace the Usage block (currently lines ~25–30) with:

```markdown
## Usage

```text
/feature "add confidence scores to the extraction endpoint"              # 3 gates
/feature "split billing into usage-based and seat-based plans"           # 3 gates (likely an epic)
/feature "add a /health endpoint" --autonomous                           # 1 gate (seam-cited plan)
/feature "add a /health endpoint" --auto                                 # 0 gates: request -> PR(s)
```

Lane resolution is deterministic — `node .claude/scripts/feature-lane.js "<args>"`
returns `{ lane, humanGates, request }` (`gated`=3, `autonomous`=1, `auto`=0;
`--auto` implies the autonomous tail). All lanes stop at the open PR; merge stays
human.
```

- [ ] **Step 3b: Add the Lanes + Autonomous-spine section**

In `.claude/skills/feature/SKILL.md`, immediately after the "## The spine" section, add:

```markdown
## Lanes (autonomous surface)

`/feature` mirrors `/build`'s lane model. Resolve the lane first with
`node .claude/scripts/feature-lane.js "<args>"`.

- **`gated` (default, 3 gates):** the interactive route below — GATE 1
  decomposition, GATE 2 design-adherence, GATE 3 PR review.
- **`--autonomous` (1 gate):** one consolidated **seam-cited plan** gate (folds
  decomposition + design-adherence + the seam-confidence band), then autonomous
  through to the PR.
- **`--auto` (0 gates):** request → PR(s) with no human stops; machine
  enforcement replaces the human GATE 2.

### Autonomous adherence enforcement (replaces the human GATE 2)

Two layers, run in the `--autonomous` and `--auto` lanes:

1. **Deterministic seam-confidence gate.** After the DeepWiki is fresh, run
   `seam-finder --goal "<request>"`, then
   `node .claude/scripts/seam-confidence.js --graph specs/brownfield/code-graph.json --goal "<request>"`.
   - `band: low` (no clean seam, best score < 0.5, or `recommended_action: avoid`):
     in **`--auto`**, write `specs/brownfield/adherence-report.md` (the goal, the
     best candidate seams + scores, why it's low) and **STOP & surface** — never
     edit a high-risk seam blind. In **`--autonomous`**, surface the low band at
     the single plan gate instead of stopping.
   - `band: high`: proceed, carrying `target_seam` into the plan.
2. **Judged adherence critic.** The **evaluator**'s brownfield-adherence rubric
   (artifact mode) checks the *plan* cites the DeepWiki and extends the seam — the
   machine GATE 2; the **diff-reviewer**'s design-adherence lens checks the *diff*
   actually extended it before the PR. A FAIL self-heals up to the loop's attempt
   cap, else STOP & surface.

### Autonomous scope routing

Classify scope automatically (reuse the single-vs-epic size thresholds + the
`specs/brownfield/risk-map.md`): single bounded story → `/change`; epic/cluster →
`/spec` → `/design` → `/auto`. When the size is ambiguous, take the larger
(`/auto`) lane — it carries more verification. The human no longer confirms this
classification in autonomous lanes.

Every lane stops at the open PR(s); the human owns merge.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/feature-autonomous-contract.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: PASS (all suites, including the five new test files).

```bash
git add .claude/skills/feature/SKILL.md test/feature-autonomous-contract.test.js
git commit -m "feat(feature): document --autonomous/--auto lanes + autonomous adherence spine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `feature-lane.js` lane parser (3/1/0) → Task 3. ✓
- `seam-confidence.js` deterministic gate (threshold 0.5, god-file/avoid, no-candidate) → Task 2 (+ Task 1 enabling reuse). ✓
- Adherence critic = reuse evaluator artifact rubric + diff-reviewer lens → Task 4. ✓
- `/feature` SKILL.md lanes + autonomous spine + stop-and-surface + stop-at-PR → Task 5. ✓
- Layered enforcement (deterministic seam-confidence + judged critic) → Tasks 2+4, wired in Task 5. ✓
- `--auto` low-confidence → `specs/brownfield/adherence-report.md` stop-and-surface → Task 5 prose + Task 5 contract test. ✓
- Scope routing (single→/change, epic→/spec→/design→/auto, ambiguous→larger) → Task 5 prose. ✓
- No `context: fork` (stays main-session) → unchanged; not a code change, documented in spec. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions + the exact run command and expected result.

**Type consistency:** `parseFeatureInvocation(...)→{lane,humanGates,request,auto,autonomous}` (Task 3), `seamConfidence(candidates)→{band,target_seam,total_score,reasons}` + `THRESHOLD` (Task 2), `scoreSeams(graph,goal,opts)→candidates[]` (Task 1, consumed by Task 2). Candidate fields (`path`, `total_score`, `recommended_action`) are used consistently. Lane strings `gated|autonomous|auto` and gate counts `3|1|0` match the Global Constraints everywhere.

**Out of scope (unchanged here):** tracker-driven brownfield (fix #3); `context:fork` gate cleanup (fix #4); auto-routing low-confidence to sprouting (deferred follow-up).
