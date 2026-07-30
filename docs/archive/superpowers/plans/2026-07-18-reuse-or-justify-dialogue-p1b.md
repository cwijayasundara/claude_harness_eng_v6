# Reuse-or-Justify Intake Dialogue (P1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the P1a grounding layer *do something* — an interactive, confidence-gated **`reuse-or-justify`** intake dialogue skill (C1) that runs `reuse-scout`, and when it fires, conducts a one-question-at-a-time human decision (reuse-vs-new / invariant-impact / budget) and records the outcome via a deterministic recorder (C4), wired into `/change` (and `/feature`, `/sprint`) intake.

**Architecture:** Two shipped pieces + wiring. (1) `record-reuse-decision.js` — deterministic append-only JSONL recorder mirroring `record-at-red.js`, writing to `specs/reviews/reuse-decisions.jsonl`. (2) `reuse-or-justify` SKILL.md — an internal-discipline dialogue skill mirroring `/clarify`, invoked as a `REQUIRED SUB-SKILL` from `/change` Step S2 (and `/feature`/`/sprint` intake), gated on `reuse-scout`'s `fire`. Registered in CORE_SKILLS/CORE_SCRIPTS + manifest.

**Tech Stack:** Node.js (CommonJS), `node:test`, markdown skill authoring per `docs/prompting-standards.md`.

## Global Constraints

- **Authoring standards.** Task 2 edits a `.claude/skills/*/SKILL.md` prompt surface — the implementer MUST read `docs/prompting-standards.md` in full first and follow it (trigger conditions in the description; `Use X when …` not `CRITICAL/MUST`; no "reason as text"; XML-tagged blocks; effort floor noted). The `author-prompt-surface` skill mandates this.
- **Description marker (enforced).** `skills-consistency.test.js`'s `INTERNAL_DISCIPLINE_SKILLS` list enforces that a listed skill's `description` matches `^Use when` AND ends with `[Internal discipline — … power-user path.]` (regex `/\[Internal discipline — .+power-user path\.\]$/`). `reuse-or-justify` is added to that list, so its description MUST match exactly.
- **Recorder mirrors `record-at-red.js`:** pure `run(argv, root, deps)` exported for tests, `deps.now` injection, append-only JSONL, non-zero exit + loud stdout on the "nothing to record" branch, `if (require.main === module) process.exit(run(...))`.
- **The skill is a non-gate sub-skill** (like `clarify` / the discipline skills) — minimal frontmatter (`name` + `description` only; NO `context: fork`, it's invoked as a sub-step, not a top-level `/` command).
- **`fire=false` is silent-proceed:** when `reuse-scout` returns `fire:false`, the dialogue does not interrogate — it records the net-new assumption and proceeds (Devin-style; no dialogue fatigue).
- **Register honestly** (CORE_SKILLS, CORE_SCRIPTS, INTERNAL_DISCIPLINE_SKILLS, manifest); `validate-harness-manifest.js` must pass; control-budget ratchets only with a genuine justification.
- **Run the full suite** (`node .claude/scripts/run-compact.js --kind test -- node --test test/*.test.js`, trust `exit 0`/`fail 0`) before the final commit. NOTE: the working tree has unrelated OpenWiki changes — stage every commit by explicit filename, never `git add -A`.

---

### Task 1: `record-reuse-decision.js` (C4 recorder)

**Files:**
- Create: `.claude/scripts/record-reuse-decision.js`
- Test: `test/record-reuse-decision.test.js`

**Interfaces:**
- Produces: `run(argv: string[], root: string, deps?: {now?}) -> number` (exit code); appends one JSON line per call to `specs/reviews/reuse-decisions.jsonl`. Record: `{ storyId, decision, seam, action, options_considered, justification, invariant_impact, budget, recordedAt }`. Also exports `appendRecord`, `resolveOutPath`.
- Required args: `--story`, `--decision` (`extend|new-seam|net-new`), `--justification`. `--seam` required when decision is `extend`/`new-seam`.

- [ ] **Step 1: Write the failing test**

```js
// test/record-reuse-decision.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { run } = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'record-reuse-decision.js'));

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-')); }
const OUT = path.join('specs', 'reviews', 'reuse-decisions.jsonl');

test('appends a well-formed decision record and returns 0', () => {
  const root = tmpRoot();
  const code = run(
    ['--story', 'E1-S2', '--decision', 'extend', '--seam', 'src/services/upload_service.py',
     '--action', 'extend', '--justification', 'reuse the upload pipeline node',
     '--invariant-impact', 'I-3 upload-goes-through-pipeline', '--budget', '{"latency_ms_p95":800}',
     '--options', 'considered new module; rejected as clone'],
    root, { now: () => '2026-07-18T00:00:00.000Z' });
  assert.strictEqual(code, 0);
  const lines = fs.readFileSync(path.join(root, OUT), 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.strictEqual(rec.storyId, 'E1-S2');
  assert.strictEqual(rec.decision, 'extend');
  assert.strictEqual(rec.seam, 'src/services/upload_service.py');
  assert.strictEqual(rec.action, 'extend');
  assert.strictEqual(rec.justification, 'reuse the upload pipeline node');
  assert.strictEqual(rec.invariant_impact, 'I-3 upload-goes-through-pipeline');
  assert.deepStrictEqual(rec.budget, { latency_ms_p95: 800 });
  assert.strictEqual(rec.recordedAt, '2026-07-18T00:00:00.000Z');
});

test('is append-only (second call adds a second line)', () => {
  const root = tmpRoot();
  const args = ['--story', 'S1', '--decision', 'net-new', '--justification', 'genuinely new capability'];
  run(args, root, { now: () => 't1' });
  run(['--story', 'S2', '--decision', 'net-new', '--justification', 'also new'], root, { now: () => 't2' });
  assert.strictEqual(fs.readFileSync(path.join(root, OUT), 'utf8').trim().split('\n').length, 2);
});

test('missing required args → usage, exit 2, nothing written', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['--story', 'S1'], root, {}), 2); // no --decision/--justification
  assert.ok(!fs.existsSync(path.join(root, OUT)));
});

test('extend/new-seam without --seam → exit 2', () => {
  assert.strictEqual(run(['--story', 'S1', '--decision', 'extend', '--justification', 'x'], tmpRoot(), {}), 2);
});

test('malformed --budget JSON is stored as null, not thrown', () => {
  const root = tmpRoot();
  const code = run(['--story', 'S1', '--decision', 'net-new', '--justification', 'x', '--budget', 'not json'], root, { now: () => 't' });
  assert.strictEqual(code, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, OUT), 'utf8').trim()).budget, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/record-reuse-decision.test.js` → FAIL (module not found).

- [ ] **Step 3: Write the implementation** (mirror `record-at-red.js`)

```js
// .claude/scripts/record-reuse-decision.js
#!/usr/bin/env node
'use strict';

// C4 decision recorder for the reuse-or-justify loop. Appends one JSON line per
// resolved intake fork to specs/reviews/reuse-decisions.jsonl (append-only,
// gitignored under **/specs/reviews/ — same convention as at-red-receipts.jsonl).
// Immutable: a correction is a NEW line, never an edit. Called by the
// reuse-or-justify skill after the human resolves the decision.
//
// CLI: node .claude/scripts/record-reuse-decision.js --story <id>
//        --decision <extend|new-seam|net-new> [--seam <path>] [--action <a>]
//        --justification "<why>" [--invariant-impact "<txt>"] [--budget '<json>']
//        [--options "<considered>"] [--root DIR] [--out <path>]

const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.join('specs', 'reviews', 'reuse-decisions.jsonl');
const DECISIONS = new Set(['extend', 'new-seam', 'net-new']);

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function resolveOutPath(root, argv) {
  const out = arg(argv, '--out', DEFAULT_OUT);
  return path.isAbsolute(out) ? out : path.join(root, out);
}

function appendRecord(outPath, record) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
}

function usage() {
  process.stderr.write('usage: record-reuse-decision.js --story <id> --decision <extend|new-seam|net-new> --justification "<why>" [--seam <path>] [--action <a>] [--invariant-impact <t>] [--budget <json>] [--options <t>]\n');
}

function run(argv, root, deps) {
  const story = arg(argv, '--story', null);
  const decision = arg(argv, '--decision', null);
  const justification = arg(argv, '--justification', null);
  const seam = arg(argv, '--seam', null);
  if (!story || !DECISIONS.has(decision) || !justification) { usage(); return 2; }
  if ((decision === 'extend' || decision === 'new-seam') && !seam) { usage(); return 2; }
  let budget = null;
  const budgetRaw = arg(argv, '--budget', null);
  if (budgetRaw) { try { budget = JSON.parse(budgetRaw); } catch (_) { budget = null; } }
  const now = (deps && deps.now) || (() => new Date().toISOString());
  appendRecord(resolveOutPath(root, argv), {
    storyId: story,
    decision,
    seam: seam || null,
    action: arg(argv, '--action', null),
    options_considered: arg(argv, '--options', null),
    justification,
    invariant_impact: arg(argv, '--invariant-impact', null),
    budget,
    recordedAt: now(),
  });
  process.stdout.write(`record-reuse-decision: recorded ${decision} for story ${story}.\n`);
  return 0;
}

module.exports = { run, resolveOutPath, appendRecord };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/record-reuse-decision.test.js` → PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/record-reuse-decision.js test/record-reuse-decision.test.js
git commit -m "feat(reuse-or-justify): C4 decision recorder (append-only reuse-decisions.jsonl)"
```

---

### Task 2: `reuse-or-justify` dialogue skill (C1)

**Files:**
- Create: `.claude/skills/reuse-or-justify/SKILL.md`
- Test: `test/reuse-or-justify-wiring.test.js`

**Interfaces:**
- The skill invokes `node .claude/scripts/reuse-scout.js` (P1a) for grounding and `node .claude/scripts/record-reuse-decision.js` (Task 1) to record. It reads `reuse-scout`'s JSON (`fire`, `band`, `target_seam`, `target_action`, `candidates`, `touched_invariants`, `intra_batch`).

- [ ] **Step 1: Read the authoring standards + the analog skill**

Read `docs/prompting-standards.md` in full and `.claude/skills/clarify/SKILL.md` (the structural analog). The SKILL.md you write must satisfy the prompting-standards checklist and mirror clarify's shape (fire-vs-skip, one-question-at-a-time, recommendation-first question format, outputs).

- [ ] **Step 2: Write the failing wiring-contract test**

```js
// test/reuse-or-justify-wiring.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, '.claude/skills/reuse-or-justify/SKILL.md');
const read = (p) => fs.readFileSync(p, 'utf8');

test('reuse-or-justify skill exists with valid frontmatter + internal-discipline marker', () => {
  assert.ok(fs.existsSync(SKILL));
  const text = read(SKILL);
  assert.match(text, /^---\n[\s\S]*?\nname:\s*reuse-or-justify\b/m, 'has name');
  const desc = (text.match(/^description:\s*(.+)$/m) || [])[1] || '';
  assert.match(desc, /^Use when/, 'description starts with "Use when"');
  assert.match(desc, /\[Internal discipline — .+power-user path\.\]$/, 'carries the internal-discipline marker');
});

test('skill invokes reuse-scout for grounding and records via record-reuse-decision', () => {
  const text = read(SKILL);
  assert.match(text, /reuse-scout\.js/, 'runs reuse-scout for the fire decision');
  assert.match(text, /record-reuse-decision\.js/, 'records the resolved decision');
  assert.match(text, /fire/, 'branches on the fire signal');
});

test('skill is not a tombstone', () => {
  assert.ok(!/\[Reference, not a command\]|do not invoke this skill/i.test(read(SKILL)));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/reuse-or-justify-wiring.test.js` → FAIL (skill missing).

- [ ] **Step 4: Write the SKILL.md**

Create `.claude/skills/reuse-or-justify/SKILL.md` with this content (frontmatter description crafted to satisfy the enforced marker; body mirrors clarify, follows prompting-standards):

````markdown
---
name: reuse-or-justify
description: "Use when reuse-scout fires at intake (band ≥ medium, a touched constitution invariant, or a same-release clone cluster) — run the confidence-gated reuse-vs-new dialogue and record the decision + performance budget before code. [Internal discipline — invoked by /change, /feature, and /sprint intake; direct use is a power-user path.]"
---

# Reuse-or-Justify Intake Dialogue

Resolve one question before a change is built: **does this increment extend an existing seam, or justify a new structure?** This is the forcing function that keeps sprint-by-sprint work from accreting parallel clones. It runs at intake, before the failing test.

## Step 1 — Ground (deterministic)

Run reuse-scout for the change's goal:

```bash
node .claude/scripts/reuse-scout.js --graph specs/brownfield/code-graph.json --goal "<the change's one-line goal>" [--constitution specs/design/constitution.md] [--batch <stories.json>]
```

Read its JSON: `fire`, `band`, `target_seam`, `target_action`, `candidates[]` (each with `path`, `total_score`, `recommended_action`, `matched_terms`), `touched_invariants[]`, `intra_batch[]`.

## Step 2 — Decide whether to interrogate

- **`fire: false`** → do not interrogate. Record the net-new assumption and proceed:
  `node .claude/scripts/record-reuse-decision.js --story <id> --decision net-new --justification "reuse-scout found no goal-relevant seam, invariant, or same-release clone"`. Continue the caller's flow.
- **`fire: true`** → interrogate at the genuine fork points only (below). One question at a time.

## Step 3 — The dialogue (only the questions the grounding raises)

Ask each question with the decision, your recommendation, and why it matters (mirrors the clarify format). Ask one at a time.

<question type="reuse-vs-new">
Fires when `target_seam` is set. Present the ranked reuse candidate(s) and its `target_action`:
- If `target_action` is `extend`/`wrap`/`introduce-adapter`: recommend extending `target_seam`.
- If `target_action` is `split`/`avoid`: surface it honestly — the closest existing code is `target_seam` but it is classified `<action>`; ask whether to extend anyway, refactor first, or justify a new structure.
Options: (a) extend the named seam, (b) add a pluggable strategy to it, (c) justify a new structure. A new structure requires a one-line justification naming why no existing seam fits.
</question>

<question type="invariant-impact">
Fires when `touched_invariants` is non-empty. For each, ask the human to confirm the change stays within the invariant, or to explicitly propose amending it (itself a reviewed decision).
</question>

<question type="intra-batch">
Fires when `intra_batch` clusters exist (feature/release scope). Present each cluster of stories that share a seam and ask whether to consolidate them onto one seam before building, rather than implementing each separately.
</question>

<question type="budget">
When the decision creates or extends a seam, ask for its performance budget (latency/memory/throughput/tokens/cost as applicable), recommending the inherited budget when extending an existing seam.
</question>

## Step 4 — Record (deterministic)

Once resolved, record each fork:

```bash
node .claude/scripts/record-reuse-decision.js --story <id> --decision <extend|new-seam|net-new> \
  [--seam <path-or-name>] [--action <extend|wrap|introduce-adapter|split|new>] \
  --justification "<one line>" [--invariant-impact "<txt>"] [--budget '<json>'] [--options "<considered>"]
```

Then reflect the outcome in the design artifacts (per the /design authoring instructions): set the extended component's `seam`/`extension_mechanism`/`instances`/`budget` in `component-map.md`, and `extends_seam`/`budget_inherited_from` in `design-traces.json`. These are optional fields the ownership/trace sensors already tolerate — do not backtick non-path values.

## Gotchas

- Do not interrogate on `fire: false` — that trains the team to dismiss the dialogue. The gate is deliberately confidence-gated.
- A `split`/`avoid` `target_action` is information, not a blocker — surface it so the human isn't told to extend something that should be split.
- The decision is a constraint the stage-4 enforcement (duplication ratchet, and P2's seam-conformance) verifies later; record the seam you actually committed to.
````

Effort: run this dialogue's authoring/edits at `high` (intelligence-sensitive prompt surface).

- [ ] **Step 5: Run to verify the wiring test + prompt-surface tests pass**

Run: `node --test test/reuse-or-justify-wiring.test.js test/skills-consistency.test.js test/skill-length-budget.test.js`
Expected: the wiring test passes; skills-consistency currently still passes because `reuse-or-justify` is not yet in its enforced lists (Task 4 adds it). If skills-consistency FAILS now (e.g. an unresolved skill-path reference), fix the reference.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/reuse-or-justify/SKILL.md test/reuse-or-justify-wiring.test.js
git commit -m "feat(reuse-or-justify): confidence-gated intake dialogue skill (C1)"
```

---

### Task 3: Wire into /change (+ /feature, /sprint) intake

**Files:**
- Modify: `.claude/skills/change/SKILL.md` (Step S2, after the Seam plan bullet ~line 73)
- Modify: `.claude/skills/feature/SKILL.md` (intake/scope step) and `.claude/skills/sprint/SKILL.md` (intake step) — same bullet
- Test: extend `test/reuse-or-justify-wiring.test.js`

- [ ] **Step 1: Read each caller's intake step** to find the exact insertion point (in `/change` it's right after the Seam plan bullet; in `/feature`/`/sprint` find the analogous scope/impact step). Match each file's existing bullet style.

- [ ] **Step 2: Write the failing wiring assertions**

Append to `test/reuse-or-justify-wiring.test.js` (use the same `readSkillCorpus` helper the other wiring tests use — `require('./helpers/skill-corpus')`):

```js
const { readSkillCorpus } = require('./helpers/skill-corpus');
for (const skill of ['change', 'feature', 'sprint']) {
  test(`/${skill} intake invokes reuse-or-justify (gated on reuse-scout fire)`, () => {
    const corpus = readSkillCorpus(skill);
    assert.match(corpus, /reuse-or-justify/, `/${skill} must invoke the reuse-or-justify dialogue`);
    assert.match(corpus, /reuse-scout\.js/, `/${skill} must run reuse-scout for the fire decision`);
  });
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/reuse-or-justify-wiring.test.js` → the 3 new assertions FAIL.

- [ ] **Step 4: Add the intake bullet to each caller**

In `/change` Step S2, immediately after the Seam plan bullet, add (match the surrounding bullet style):

```
- **Reuse-or-justify — REQUIRED SUB-SKILL: `reuse-or-justify`** when this change adds or materially extends behavior. Run `node .claude/scripts/reuse-scout.js --graph specs/brownfield/code-graph.json --goal "<story goal>"`; if it reports `fire: true`, invoke `reuse-or-justify` to settle reuse-vs-new (and any touched invariant / budget) and record the decision before Step S4. If `fire: false`, note the net-new assumption and proceed.
```

Add the equivalent bullet at `/feature`'s scope/impact step and `/sprint`'s intake step, adjusting the goal source (feature description / sprint PRD) and, for `/sprint`/`/feature` epic scope, passing `--batch` so intra-batch clusters are surfaced. Match each file's style; do not alter existing bullets.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/reuse-or-justify-wiring.test.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add test/reuse-or-justify-wiring.test.js .claude/skills/change/SKILL.md .claude/skills/feature/SKILL.md .claude/skills/sprint/SKILL.md
git commit -m "feat(reuse-or-justify): wire the intake dialogue into /change, /feature, /sprint"
```

---

### Task 4: Register + full suite

**Files:**
- Modify: `.claude/scripts/scaffold-copy.js` (`CORE_SKILLS` += `'reuse-or-justify'`; `CORE_SCRIPTS` += `'record-reuse-decision.js'`)
- Modify: `test/skills-consistency.test.js` (`INTERNAL_DISCIPLINE_SKILLS` += `'reuse-or-justify'`)
- Modify: `harness-manifest.json` (guide/behaviour entries for the dialogue + recorder)

- [ ] **Step 1: Register the skill + script for scaffold-copy**

In `.claude/scripts/scaffold-copy.js`, add `'reuse-or-justify'` to the `CORE_SKILLS` product section (flat string entry, per the G22 array-literal comment), and `'record-reuse-decision.js'` to `CORE_SCRIPTS`.

- [ ] **Step 2: Declare the skill internal-discipline in the consistency test**

In `test/skills-consistency.test.js`, add `'reuse-or-justify'` to the `INTERNAL_DISCIPLINE_SKILLS` array. Run `node --test test/skills-consistency.test.js` — it now enforces the description marker on the skill; it must pass because Task 2's description matches `^Use when … [Internal discipline — … power-user path.]$`.

- [ ] **Step 3: Manifest entries**

Add manifest entries mirroring a sibling: `reuse-or-justify` (a `guides[]` feedforward entry, `axis: architecture`, `wired_at: .claude/skills/reuse-or-justify/SKILL.md`) and `record-reuse-decision` (a `guides[]`/behaviour entry, `wired_at: .claude/scripts/record-reuse-decision.js`, describing the immutable decision provenance). Run `node .claude/scripts/validate-harness-manifest.js` → exit 0. If the control-budget meta-ratchet trips, add a genuine `net_add_justification` to each and re-run `node .claude/scripts/control-budget-gate.js` to ratchet the baseline. Do NOT loosen any gate or weaken a test.

- [ ] **Step 4: Full suite**

Run: `node .claude/scripts/run-compact.js --kind test -- node --test test/*.test.js` → `exit: 0` / `fail 0` (ignore the compact "N failures" count of intentional FAIL fixtures). iCloud-hang: kill orphaned `node --test`, delete ` 2.`-suffixed dupes, re-run.

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/scaffold-copy.js test/skills-consistency.test.js harness-manifest.json .claude/state/control-budget-baseline.json 2>/dev/null || true
git commit -m "feat(reuse-or-justify): register skill + recorder (scaffold-copy, consistency, manifest)"
```

---

## Self-Review

- **Spec coverage:** Implements C1 (dialogue) + C4 (decision recorder) and wires them into the three intake lanes per spec §4. C2 seam-metadata fields were defined in P1a; the skill *writes* them (prose instruction) — their enforcement is P2 (seam-conformance) / P3 (budgets).
- **Placeholder scan:** complete code (Task 1), a complete SKILL.md (Task 2), complete bullets (Task 3); Tasks 3-4 reference sibling files/conventions with the exact additions spelled out.
- **Type consistency:** the recorder record shape is identical across the CLI, the test, and the skill's `record-reuse-decision.js` invocation; `reuse-or-justify` skill name is consistent across the skill file, wiring tests, CORE_SKILLS, INTERNAL_DISCIPLINE_SKILLS, and manifest `wired_at`.
- **Marker compliance:** the SKILL.md description is authored to match the enforced `INTERNAL_DISCIPLINE_SKILLS` regex before it is added to that list.
- **Follow-ups:** P2 (seam-conformance gate reads `reuse-decisions.jsonl` to verify the code extended the promised seam), P3 (performance-budget fitness functions consume the recorded budgets).
