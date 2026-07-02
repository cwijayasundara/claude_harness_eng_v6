# Interview-Mode BRD Grounding Implementation Plan (Audit Fix #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the first-hop grounding hole: greenfield-from-interview BRDs get the same deterministic net-new/dropped hard block FRD-mode BRDs already have, by giving the interview a machine-readable requirement spine (`specs/brd/interview-requirements.json`, `INT-n` entries written at human-confirmation time) and running the existing `grounding-check.js` against it.

**Architecture:** Zero engine changes — `grounding-check.js`/`trace-check.js` are already source-agnostic (`required`/`optional`/`downstream`). The interview spine is passed as the `--frd` (required) set; `C-n` clarifications remain the optional set. Changes are prompt/config wiring: `/brd` SKILL.md (emit spine at Step 2 confirmation, run Step 4.4 in both modes), evaluator agent + phase rubric (interview mode becomes hard-gated instead of "score 10"), HARNESS.md + harness-manifest registry, and tests that round-trip the real script.

**Tech Stack:** Markdown/JSON edits + node:test (extend `test/grounding-check.test.js`).

**Branch:** `fix/interview-grounding` off `main`, PR when green.

## Global Constraints

- Zero changes to `grounding-check.js` and `trace-check.js` — the engine stays untouched; if a step seems to need an engine change, stop and report BLOCKED.
- Verdict field names stay `frd_total`/`frd_covered` in interview mode (generic wrapper naming; renaming would churn every consumer for cosmetics).
- Existing wiring tests assert these strings and must stay green: `/brd` SKILL matches `/--frd/`, `/source-frd\.md/`, `/HARD BLOCK/`, `/net_new/`, `/dropped/`; evaluator.md matches `/FRD mode/` and `/interview-from-scratch/i`; rubric `hard_gate` matches `/brd-grounding\.json/` (test/grounding-check.test.js:163-188).
- Surgical edits; suite via `npm test` (iCloud gotcha: if it hangs, kill orphaned `node --test` procs, delete ` 2.`-suffixed dupes, re-run once).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `/brd` SKILL wiring + grounding tests

**Files:**
- Modify: `.claude/skills/brd/SKILL.md` (Step 2 ~line 83, trace rule ~line 226, Step 4.4 ~lines 230-246, Step 4.5 upstream ~lines 257-258, artifacts table ~lines 283-288, notes ~line 294)
- Test: `test/grounding-check.test.js` (append CLI round-trip + extend the `/brd`-skill wiring test)

**Interfaces:**
- Consumes: `grounding-check.js` CLI (`--frd <required> --clarifications <optional> --brd <downstream> --out <verdict>`, exit 0/1, writes `{pass, frd_total, frd_covered, net_new[], dropped[]}`).
- Produces: the artifact contract Task 2's evaluator/rubric edits refer to — `specs/brd/interview-requirements.json` = `[{ "id": "INT-<n>", "text": "<confirmed requirement>", "section": "<dimension>" }]`, and Step 4.4 running in BOTH modes writing `specs/reviews/brd-grounding.json`.

- [ ] **Step 1: Write the failing tests**

Append to `test/grounding-check.test.js` (reuse the file's existing `writeJson`, `SCRIPT`, `execFileSync` — no redefinitions):

```js
// --- interview-mode grounding (2026-07-02 audit fix #3) -----------------------
// The engine is source-agnostic: the confirmed interview spine (INT-n) rides in
// as the required set exactly like an FRD. Round-trips the REAL script.

const interview = [
  { id: 'INT-1', text: 'Admins invite users by email', section: 'users-and-permissions' },
  { id: 'INT-2', text: 'Weekly usage digest email', section: 'reporting' },
];

test('interview mode: CLI passes when every BR traces to INT-n/C-n and every INT-n is covered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'specs/brd/interview-requirements.json', interview);
  writeJson(dir, 'specs/brd/clarification-log.json', [{ id: 'C1', question: 'digest day?', answer: 'Monday' }]);
  writeJson(dir, 'specs/brd/brd-requirements.json', [
    { id: 'BR-1', text: 'Email invitations', traces: ['INT-1'] },
    { id: 'BR-2', text: 'Monday usage digest', traces: ['INT-2', 'C1'] },
  ]);
  const out = path.join(dir, 'specs/reviews/brd-grounding.json');
  execFileSync(process.execPath, [SCRIPT,
    '--frd', path.join(dir, 'specs/brd/interview-requirements.json'),
    '--clarifications', path.join(dir, 'specs/brd/clarification-log.json'),
    '--brd', path.join(dir, 'specs/brd/brd-requirements.json'),
    '--out', out]);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, true);
});

test('interview mode: CLI blocks an invented BR and a dropped INT-n together', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  writeJson(dir, 'int.json', interview);
  writeJson(dir, 'brd.json', [
    { id: 'BR-1', text: 'Email invitations', traces: ['INT-1'] },
    { id: 'BR-2', text: 'Invented SSO federation', traces: [] },
  ]);
  const out = path.join(dir, 'out.json');
  let exitCode = 0;
  try {
    execFileSync(process.execPath, [SCRIPT,
      '--frd', path.join(dir, 'int.json'),
      '--brd', path.join(dir, 'brd.json'),
      '--out', out], { stdio: 'pipe' });
  } catch (e) {
    exitCode = e.status;
  }
  assert.strictEqual(exitCode, 1);
  const verdict = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual(verdict.net_new.map((r) => r.id), ['BR-2']);
  assert.deepStrictEqual(verdict.dropped.map((r) => r.id), ['INT-2']);
});
```

And extend the existing `'/brd skill documents the --frd flow and runs the grounding gate'` test (test/grounding-check.test.js:163-173) by adding these assertions to its body:

```js
  assert.match(brd, /interview-requirements\.json/);
  assert.match(brd, /INT-\d|INT-<n>|INT-n/);
  assert.match(brd, /HARD BLOCK — all modes|HARD BLOCK — FRD & interview/);
```

- [ ] **Step 2: Run to verify the wiring assertions fail (CLI tests should already pass — the engine needs no change; that is the point)**

Run: `node --test --test-name-pattern "interview mode|/brd skill" test/grounding-check.test.js`
Expected: the two new CLI tests PASS as-is (they prove the engine is ready); the extended `/brd skill` wiring test FAILS on `interview-requirements.json`.

- [ ] **Step 3: Edit `.claude/skills/brd/SKILL.md`**

Six surgical edits:

**3a — Step 2 spine emission.** After the Step 2 intro paragraph (the one ending "…document the assumption and move on.", ~line 83), add:

```markdown
**As each dimension is confirmed, append the confirmed requirement statements to `specs/brd/interview-requirements.json`** — one entry per discrete requirement the human signed off:

```json
[{ "id": "INT-1", "text": "Admins invite users by email", "section": "users-and-permissions" }]
```

Write entries **at confirmation time, not after synthesis** — this file is the grounding baseline the BRD is mechanically checked against (Step 4.4), so it must capture what the human confirmed before BRD prose can drift. Q&A detail that is context rather than a requirement stays in `clarification-log.json` (`C-n`); a statement the human confirmed as something the system must do is an `INT-n`.
```

**3b — trace rule (~line 226).** Replace the sentence `In interview-from-scratch mode (no FRD), trace BR entries to C-n clarifications only.` with:

```
In interview-from-scratch mode (no FRD), trace BR entries to `INT-n` interview requirements and/or `C-n` clarifications; every `INT-n` must be covered by at least one BR entry.
```

**3c — Step 4.4 heading (~line 230).** Replace `### Step 4.4 — Grounding Gate [HARD BLOCK — FRD mode]` with `### Step 4.4 — Grounding Gate [HARD BLOCK — all modes]`, and replace its intro sentence `When an FRD was provided, run the deterministic grounding check before the rubric evaluation.` with `Run the deterministic grounding check before the rubric evaluation — in FRD mode against the FRD spine, in interview mode against the confirmed interview spine.` After the existing FRD-mode command block, add:

```markdown
In interview-from-scratch mode, run the same gate with the interview spine as the required set (the verdict keeps the generic `frd_total`/`frd_covered` field names):

```bash
node .claude/skills/brd/scripts/grounding-check.js \
  --frd specs/brd/interview-requirements.json \
  --clarifications specs/brd/clarification-log.json \
  --brd specs/brd/brd-requirements.json \
  --out specs/reviews/brd-grounding.json
```
```

**3d — the skip parenthetical (~line 246).** Replace `(Skip this step entirely in interview-from-scratch mode — there is no FRD to ground against.)` with `(Skip only when neither `frd-requirements.json` nor `interview-requirements.json` exists — a pre-spine legacy project — and note the skipped gate in the BRD summary.)`

**3e — Step 4.5 upstream lines (~257-258).** Replace `- Upstream: in FRD mode, ...; otherwise none` with `- Upstream: in FRD mode, `specs/brd/source-frd.md` + `specs/brd/frd-requirements.json` + `specs/brd/clarification-log.json`; in interview mode, `specs/brd/interview-requirements.json` + `specs/brd/clarification-log.json``. In the next line, change `Grounding verdict: in FRD mode, ...` to `Grounding verdict: `specs/reviews/brd-grounding.json` in both modes (already PASS from Step 4.4 — the evaluator confirms the rubric's traceability criterion against it)`.

**3f — artifacts table + notes (~283-296).** Add a table row `| `specs/brd/interview-requirements.json` | (interview mode) confirmed `INT-n` requirement spine — the grounding baseline |`; remove the `(FRD mode)` qualifier from the `specs/reviews/brd-grounding.json` row; update the note `**Grounding gate (FRD mode) — hard block.**` to `**Grounding gate — hard block (both modes).**` and extend its sentence to mention the interview spine.

- [ ] **Step 4: Run the test file**

Run: `node --test test/grounding-check.test.js`
Expected: all tests PASS (including the pre-existing wiring assertions — 3c keeps the literal `HARD BLOCK` string).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/brd/SKILL.md test/grounding-check.test.js
git commit -m "feat: ground interview-mode BRDs against a confirmed INT-n spine

The first grounding hop was FRD-only: greenfield-from-interview BRDs had
no deterministic net-new/dropped check (2026-07-02 audit fix #3). /brd now
persists confirmed requirement statements to interview-requirements.json
at dimension-confirmation time and runs the unchanged grounding-check.js
against them in Step 4.4.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Grader surfaces + registry truth-up

**Files:**
- Modify: `.claude/agents/evaluator.md` (~lines 199 and 266)
- Modify: `.claude/templates/phase-eval-rubrics.json` (`phases.brd`: `upstream`, `hard_gate`, `criteria.completeness`, `criteria.traceability`)
- Modify: `HARNESS.md` (traceability sensors row, ~line 75)
- Modify: `harness-manifest.json` (sensor `grounding-check`: `signal`, `description`)
- Test: `test/grounding-check.test.js` (extend the rubric + evaluator wiring tests)

**Interfaces:**
- Consumes: Task 1's artifact contract (`interview-requirements.json`, both-modes Step 4.4, same verdict path).
- Produces: nothing downstream.

- [ ] **Step 1: Extend the wiring tests (failing first)**

In `test/grounding-check.test.js`, add to the `'rubric brd phase...'` test body:

```js
  assert.match(brd.hard_gate, /interview-requirements\.json/);
  assert.match(brd.criteria.traceability, /INT-n|interview-requirements/);
  assert.ok(!/score as 10/.test(brd.criteria.traceability), 'interview mode must no longer auto-score 10');
```

And to the `'evaluator artifact mode...'` test body:

```js
  assert.match(ev, /interview-requirements\.json/);
```

Run: `node --test --test-name-pattern "rubric brd|evaluator artifact" test/grounding-check.test.js`
Expected: both FAIL.

- [ ] **Step 2: Edit `.claude/agents/evaluator.md`**

After the `- **FRD mode** …` bullet (~line 199), add a sibling bullet:

```markdown
- **Interview mode** (no FRD; upstream is `specs/brd/interview-requirements.json` + `clarification-log.json`, with the same `specs/reviews/brd-grounding.json` verdict): identical hard-gate semantics — the required set is the confirmed interview spine instead of the FRD. A BRD requirement with no `INT-n`/`C-n` trace is invented; an uncovered `INT-n` is dropped. Treat a missing verdict file the same as a FAIL unless neither requirements spine exists (pre-spine legacy project).
```

At ~line 266, replace `interview-from-scratch mode scores 10` with `interview-from-scratch mode is hard-gated the same way against interview-requirements.json` (keep the rest of the sentence intact so `/interview-from-scratch/i` still matches).

- [ ] **Step 3: Edit `.claude/templates/phase-eval-rubrics.json` (`phases.brd`)**

- `upstream`: replace with `"specs/brd/source-frd.md (FRD mode) or specs/brd/interview-requirements.json (interview mode); null only for pre-spine legacy projects"`.
- `hard_gate`: append: `" Interview-from-scratch mode: the same gate runs against specs/brd/interview-requirements.json (the confirmed INT-n interview spine) — identical net_new/dropped semantics and the same verdict file; the gate is skipped only when neither requirements spine exists."`
- `criteria.completeness`: after the `FRD mode:` sentence, append: `" Interview mode: every INT-n in interview-requirements.json is covered by >= 1 BRD requirement (zero dropped)."`
- `criteria.traceability`: replace `"Interview-from-scratch mode: N/A (score as 10 — no upstream artifact)"` with `"Interview-from-scratch mode: every BRD requirement traces to an INT-n interview requirement or a C-n clarification — anchored to the same specs/reviews/brd-grounding.json verdict"`.

- [ ] **Step 4: Registry edits**

- `HARNESS.md` traceability sensors row: change `` `grounding-check` (BRD vs FRD, hard block) `` to `` `grounding-check` (BRD vs FRD or confirmed interview spine, hard block) ``.
- `harness-manifest.json` sensor `grounding-check`: `signal` → `"net-new or dropped requirements vs FRD or confirmed interview spine"`; `description` → `"Deterministic hard block: the BRD may only contain content traced to the FRD or interview requirements spine, or the clarification log."`
- Run: `node .claude/scripts/validate-harness-manifest.js` — exit 0.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS, 0 fail (iCloud gotcha per Global Constraints if it hangs).

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/evaluator.md .claude/templates/phase-eval-rubrics.json HARNESS.md harness-manifest.json test/grounding-check.test.js
git commit -m "docs: hard-gate interview-mode BRD grounding across grader surfaces

Evaluator, phase rubric, and registry said FRD-mode-only (interview
traceability auto-scored 10); all now anchor to the brd-grounding.json
verdict in both modes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan (workflow, not tasks)

Per-task fresh reviews, whole-branch review on the strongest model (probe: can an interview BRD still pass with an empty `interview-requirements.json`? does any surface still say interview mode is ungated?), PR titled "feat: interview-mode BRD grounding (audit fix #3)". Human owns merge. Known cross-branch note: HARNESS.md is also touched by PR #48 (different row) and PR #49 (new section) — merge order may need a trivial conflict resolution.
