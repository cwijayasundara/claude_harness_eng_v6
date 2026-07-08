# Sprint Dedup Pre-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `modularity-reviewer` agent into `/design --delta` (Delta Mode) as a scoped, non-blocking duplication pre-check on every sprint/feature design amendment, instead of it running only as a periodic `/brownfield --full` pass.

**Architecture:** A new Step D3.5 in `.claude/skills/design/SKILL.md` Delta Mode refreshes `modularity-pack.js` (unchanged), then spawns `modularity-reviewer` scoped to the amendment's own new/changed components, writing its verdict to an amendment-specific output path (enabled by a one-line override added to the agent). GATE 2 (Step D7) is extended to display that verdict. No new scripts or runtime code — this is entirely documentation/prompt wiring plus registry bookkeeping, tested the same way the rest of the harness's skill/agent wiring is tested: regex assertions against the markdown files in `test/modularity-wiring-contract.test.js`.

**Tech Stack:** Node.js `node:test` (hermetic, no external deps), markdown skill/agent files, `harness-manifest.json`.

## Global Constraints

- **Surfaced, not blocking:** a `CONCERNS` verdict from the pre-check must never fail-close GATE 2 — it is displayed for human adjudication, exactly like the existing contract-drift verdict (per the approved spec, `docs/superpowers/specs/2026-07-08-sprint-dedup-precheck-design.md`, Scope section).
- **Scoped, not whole-repo:** the reviewer judges only pack entries overlapping the amendment's own new/changed components — never a full-repo re-scan.
- **Degrade loudly:** no `code-graph.json` → skip with an explicit `skipped-no-graph` marker shown at GATE 2, never a silent implicit PASS. A malformed/missing verdict after the spawn → `inconclusive`, also shown, never silently treated as PASS.
- **No new sensor ID:** this reuses the existing `modularity-review` sensor (`harness-manifest.json`) at a second call site — do not create a new sensor entry.
- **Test style:** match the existing `test/modularity-wiring-contract.test.js` pattern exactly — read the real file with `fs.readFileSync`, assert with `assert.match`/`assert.strictEqual` against the actual repo files, no mocks.

---

### Task 1: `modularity-reviewer.md` output-path override

**Files:**
- Modify: `.claude/agents/modularity-reviewer.md` (Output section, end of file)
- Test: `test/modularity-wiring-contract.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: a documented convention — "if the invoking prompt specifies explicit output paths, write there instead of the defaults" — that Task 2's Step D3.5 prompt relies on by name (the exact override sentence, or a paraphrase containing "explicit output paths" and "instead of the defaults", must exist in this file for Task 2's design to be honored by any agent reading it).

- [ ] **Step 1: Write the failing test**

Add this test to `test/modularity-wiring-contract.test.js` (append after the existing four `test(...)` blocks, before the final closing of the file):

```js
test('modularity-reviewer.md documents an output-path override for scoped callers', () => {
  const agent = read('.claude/agents/modularity-reviewer.md');
  assert.match(
    agent,
    /explicit output paths.*instead of the defaults/is,
    'agent must document that a scoped caller (e.g. design --delta Step D3.5) can override the default output paths'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/modularity-wiring-contract.test.js`
Expected: FAIL — the new test reports no match for the override pattern; the other 4 existing tests still PASS.

- [ ] **Step 3: Add the override sentence to the agent file**

In `.claude/agents/modularity-reviewer.md`, the current `## Output` section ends with:

```
`CONCERNS` when any high-severity finding stands; otherwise `PASS`. This is a maintainability sensor, not a merge gate — it informs and prioritizes refactoring, it does not block a build. Report only what you verified against source; do not pad the list to look thorough.
```

Append one new paragraph immediately after that sentence (same section, no new heading):

```
If the invoking prompt specifies explicit output paths, write there instead of the defaults above — this lets a scoped caller (e.g. `/design --delta` Step D3.5) avoid overwriting the periodic `/brownfield --full` review.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/modularity-wiring-contract.test.js`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/modularity-reviewer.md test/modularity-wiring-contract.test.js
git commit -m "feat: modularity-reviewer honors caller-specified output paths"
```

---

### Task 2: Step D3.5 in `design/SKILL.md` Delta Mode + GATE 2 display update

**Files:**
- Modify: `.claude/skills/design/SKILL.md` (Delta Mode section — insert new Step D3.5 between Step D3 and Step D4; extend Step D7's display list)
- Test: `test/modularity-wiring-contract.test.js`

**Interfaces:**
- Consumes: the output-path override documented in Task 1 (referenced by name in the new prompt text this task writes).
- Produces: the `design-delta-duplication-<amendment-id>.md`/`.json` file convention and the `skipped-no-graph` / `inconclusive` markers — these exact strings are what Task 2's own test asserts, and what a human reviewer at GATE 2 will see.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `test/modularity-wiring-contract.test.js`:

```js
test('design --delta Step D3.5 scopes the modularity pre-check to the amendment', () => {
  const skill = read('.claude/skills/design/SKILL.md');
  const deltaSection = skill.slice(skill.indexOf('## Delta Mode'), skill.indexOf('## Baseline Recovery Mode'));
  assert.match(deltaSection, /Step D3\.5/, 'must add a Step D3.5');
  assert.match(deltaSection, /modularity-pack\.js/, 'must refresh the pack');
  assert.match(deltaSection, /modularity-reviewer/, 'must spawn the scoped reviewer');
  assert.match(deltaSection, /skipped-no-graph/, 'must document the no-graph skip marker');
  assert.match(deltaSection, /inconclusive/, 'must document the malformed-verdict marker');
});

test('GATE 2 (Step D7) displays the duplication pre-check result', () => {
  const skill = read('.claude/skills/design/SKILL.md');
  const deltaSection = skill.slice(skill.indexOf('## Delta Mode'), skill.indexOf('## Baseline Recovery Mode'));
  const d7Section = deltaSection.slice(deltaSection.indexOf('Step D7'));
  assert.match(d7Section, /duplication pre-check/i, 'GATE 2 display list must include the duplication pre-check result');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/modularity-wiring-contract.test.js`
Expected: FAIL on both new tests (Step D3.5 doesn't exist yet, D7 doesn't mention duplication); the 5 tests from Task 1 still PASS.

- [ ] **Step 3: Insert Step D3.5**

In `.claude/skills/design/SKILL.md`, find this exact text (the end of Step D3 / start of Step D4):

```
> If `specs/design/constitution.md` exists, treat every line under its
> `## Invariants` heading as a hard constraint. Before writing, check each
> proposed change against every invariant; if a change would violate one, do
> not make it — find another approach or flag the conflict in the amendment's
> Breaking Changes section for human resolution at GATE 2.

### Step D4 — Emit the trace spine + Grounding Gate [HARD BLOCK]
```

Replace it with (inserting the new step before Step D4):

```
> If `specs/design/constitution.md` exists, treat every line under its
> `## Invariants` heading as a hard constraint. Before writing, check each
> proposed change against every invariant; if a change would violate one, do
> not make it — find another approach or flag the conflict in the amendment's
> Breaking Changes section for human resolution at GATE 2.

### Step D3.5 — Duplication pre-check (scoped, non-blocking)

1. Check whether `specs/brownfield/code-graph.json` exists.
   - Missing (a pure-greenfield sprint that never ran `/brownfield`) — skip
     the rest of this step entirely. Record
     `"duplication_precheck": "skipped-no-graph"` to carry into Step D7.
     Do not run the pack script or spawn a reviewer.
2. If it exists, refresh the pack: `node .claude/scripts/modularity-pack.js`.
3. From the amendment just written in Step D3, collect the touched scope:
   the new/changed `component-map.md` rows and the paths just added to
   `reasons-canvas.md`'s `Governs` list for this amendment.
4. Spawn Agent with `subagent_type="modularity-reviewer"`:

   > You are being invoked as part of `/design --delta` Step D3.5, not a
   > full `/brownfield --full` pass. Read `specs/brownfield/modularity-pack.md`/`.json`
   > as usual, but restrict your duplication/responsibility/argument-clump
   > judgment to entries that overlap these paths (this amendment's
   > new/changed components): `<touched-scope path list>`. Ignore
   > pre-existing candidates unrelated to this sprint's changes. Write your
   > output to `specs/reviews/design-delta-duplication-<amendment-id>.md`
   > and `specs/reviews/design-delta-duplication-<amendment-id>.json`
   > instead of the default `specs/reviews/modularity-review.md`/`-verdict.json`
   > — do not touch those default files.
5. If the agent errors, or the JSON file is absent/unparseable afterward,
   record `"duplication_precheck": "inconclusive"` — never silently treated
   as `PASS`.

### Step D4 — Emit the trace spine + Grounding Gate [HARD BLOCK]
```

- [ ] **Step 4: Extend the GATE 2 (Step D7) display list**

In the same file, find this exact text:

```
### Step D7 — Present for Human Approval (GATE 2 — never collapsible)

Display:
1. The amendment narrative (`specs/design/amendments/<amendment-id>.md`)
2. `git diff -- specs/design/ ':!specs/design/amendments'` so the human
   reviews exactly what changed in the living design, excluding the
   amendment file itself
3. The contract-drift verdict and the amendment's Breaking Changes section side by side
4. The design-delta evaluator verdict

Ask: "Does this design amendment correctly evolve the existing architecture?
```

Replace it with:

```
### Step D7 — Present for Human Approval (GATE 2 — never collapsible)

Display:
1. The amendment narrative (`specs/design/amendments/<amendment-id>.md`)
2. `git diff -- specs/design/ ':!specs/design/amendments'` so the human
   reviews exactly what changed in the living design, excluding the
   amendment file itself
3. The contract-drift verdict and the amendment's Breaking Changes section side by side
4. The design-delta evaluator verdict
5. The duplication pre-check result from Step D3.5 — the verdict and
   findings from `specs/reviews/design-delta-duplication-<amendment-id>.json`,
   or the `skipped-no-graph` / `inconclusive` marker if it didn't run to
   completion

Ask: "Does this design amendment correctly evolve the existing architecture?
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/modularity-wiring-contract.test.js`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/design/SKILL.md test/modularity-wiring-contract.test.js
git commit -m "feat: scoped duplication pre-check in design --delta (Step D3.5)"
```

---

### Task 3: Registry + docs bookkeeping

**Files:**
- Modify: `harness-manifest.json` (the `modularity-review` sensor's `description` field)
- Modify: `HARNESS.md` (the G6 "done" line, ~line 96)
- Test: `test/modularity-wiring-contract.test.js`

**Interfaces:**
- Consumes: nothing new (pure documentation update reflecting Tasks 1–2).
- Produces: nothing consumed by later tasks — this is the terminal bookkeeping task.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `test/modularity-wiring-contract.test.js`:

```js
test('manifest description mentions the design-delta invocation site', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const review = m.sensors.find((s) => s.id === 'modularity-review');
  assert.match(review.description, /design --delta/, 'description must mention the new call site');
  assert.strictEqual(review.status, 'active');
  assert.strictEqual(review.type, 'inferential');
});

test('HARNESS.md G6 line mentions the design-delta invocation site', () => {
  const doc = read('HARNESS.md');
  assert.match(doc, /G6 \(P1\)[\s\S]*?design --delta/, 'G6 done-line must mention the new invocation site');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/modularity-wiring-contract.test.js`
Expected: FAIL on both new tests; the 7 tests from Tasks 1–2 still PASS.

- [ ] **Step 3: Update `harness-manifest.json`**

Find the `modularity-review` sensor entry:

```json
  "description": "Khononov-style inferential modularity review (gap G6) grounded in the modularity-pack. Run in /brownfield --full; judges duplication/responsibility/clumps/cycles against source, confirms legit hubs. A maintainability sensor, not a gate."
```

Replace its value with:

```json
  "description": "Khononov-style inferential modularity review (gap G6) grounded in the modularity-pack. Run in /brownfield --full; judges duplication/responsibility/clumps/cycles against source, confirms legit hubs. A maintainability sensor, not a gate. Also invoked scoped-to-amendment from /design --delta Step D3.5 (sprint/feature design-delta lanes)."
```

- [ ] **Step 4: Update `HARNESS.md`**

Find this exact line (~line 96):

```
- ~~**G6 (P1)** — no inferential modularity review on top of the coupling report.~~ ✅ **done** — `modularity-pack.js` grounds a `modularity-reviewer` agent (pre-classifying legit hubs so it doesn't flag factories/schemas); runs in `/brownfield --full`.
```

Replace it with:

```
- ~~**G6 (P1)** — no inferential modularity review on top of the coupling report.~~ ✅ **done** — `modularity-pack.js` grounds a `modularity-reviewer` agent (pre-classifying legit hubs so it doesn't flag factories/schemas); runs in `/brownfield --full` and, scoped to the touched components, in `/design --delta` Step D3.5.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/modularity-wiring-contract.test.js`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions elsewhere (in particular `test/scaffold-vertical-composition.test.js` and any `harness-manifest.json` schema-validation test, since Task 3 edits that file).
Also run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add harness-manifest.json HARNESS.md test/modularity-wiring-contract.test.js
git commit -m "docs: register design-delta duplication pre-check invocation site"
```

---

## Post-plan verification

- [ ] Read through the full `## Delta Mode` section of `.claude/skills/design/SKILL.md` end-to-end once all three tasks land, to confirm Step D3.5 reads coherently in sequence with D3/D4/D7 (no dangling references, no orphaned "as described above" pointing at nothing).
- [ ] `npm test` green from a clean `git status` (no stray edits outside the 5 files this plan touches: `.claude/agents/modularity-reviewer.md`, `.claude/skills/design/SKILL.md`, `harness-manifest.json`, `HARNESS.md`, `test/modularity-wiring-contract.test.js`).
