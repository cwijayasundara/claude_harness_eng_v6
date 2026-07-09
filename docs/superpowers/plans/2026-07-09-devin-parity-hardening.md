# Devin/Anthropic/Thoughtworks Parity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 concrete gaps identified in the 2026-07-09 deep-research comparison against Devin/Anthropic/Thoughtworks practice: propagate the existing `learned-rules.md` mechanism to lanes that lack it, document (and, if needed, fix) the harness's stance against Anthropic's named generator-verifier failure modes, and add a bounded 3-instance majority-vote re-verification pass to `/gate` for security-boundary changes.

**Architecture:** All three items are additive, prose-level changes to existing skill/agent Markdown files (`.claude/skills/*/SKILL.md`, `HARNESS.md`) — no new scripts, no new agent types, no schema changes to existing JSON contracts. Item 1 adds one new audit-trail JSON file (`specs/reviews/reverify-votes.json`) that no existing code reads. Tests are wiring-contract style (assert the skill text contains the required instructions), matching the existing pattern in `test/modularity-wiring-contract.test.js` and `test/skills-consistency.test.js` — these are prose-orchestrated agent skills, not deterministic scripts, so "test" means "the instruction is present and unambiguous," the same convention the harness already uses for prompt-only changes (see `HARNESS.md` gap G27).

**Tech Stack:** Node.js `node:test` + `node:assert` (existing test runner, no new dependencies).

## Global Constraints

- Every skill-file edit must be additive — do not restructure or reformat surrounding prose (per this repo's CLAUDE.md "Surgical Changes" principle).
- Match existing terminology exactly: "security trigger," "fresh context," "majority vote," etc., must read identically to how the spec (`docs/superpowers/specs/2026-07-09-devin-parity-hardening-design.md`) phrases them, since the tests assert on this exact phrasing.
- No change to any existing JSON contract shape (`security-verdict.json`, `features.json`, evaluator's report format) — Item 1's new file is additive-only.
- Commit after each task; do not batch multiple tasks into one commit.

---

### Task 1: Propagate `learned-rules.md` injection to `/change`

**Files:**
- Modify: `.claude/skills/change/SKILL.md` (Step S2 — Impact Assessment)
- Test: `test/learned-rules-propagation.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: `test/learned-rules-propagation.test.js` — later tasks (2, 3) append `test(...)` blocks to this same file.

- [ ] **Step 1: Write the failing test**

Create `test/learned-rules-propagation.test.js`:

```js
'use strict';

// Locks the propagation half of the 2026-07-09 Devin/Anthropic/Thoughtworks
// parity-hardening pass (docs/superpowers/specs/2026-07-09-devin-parity-hardening-design.md,
// §1): .claude/state/learned-rules.md was already injected into /auto,
// /implement, and /refactor, but not into /change, /vibe, or /feature.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/change reads learned-rules.md before editing', () => {
  const skill = read('.claude/skills/change/SKILL.md');
  assert.match(skill, /\.claude\/state\/learned-rules\.md/, 'must reference learned-rules.md');
  assert.match(skill, /inject its contents verbatim/i, "must inject verbatim, matching /auto's convention");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/learned-rules-propagation.test.js`
Expected: FAIL — `/change reads learned-rules.md before editing` fails both `assert.match` calls (the string is not yet present in `change/SKILL.md`).

- [ ] **Step 3: Add the injection instruction to `/change`**

In `.claude/skills/change/SKILL.md`, find this exact text (inside `### Step S2 — Impact Assessment`):

```
Read the current codebase to understand what is affected:

- **Brownfield map:** if `specs/brownfield/` exists, read `codebase-map.md`, `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md` before assessing impact. If this is a non-trivial existing codebase and the brownfield map is missing, recommend `/brownfield` first.
```

Replace it with:

```
Read the current codebase to understand what is affected:

- **Learned rules:** read `.claude/state/learned-rules.md`. If it exists and is non-empty, inject its contents verbatim into your working context before making any edits — the same convention `/auto` already uses for every spawned agent.
- **Brownfield map:** if `specs/brownfield/` exists, read `codebase-map.md`, `architecture-map.md`, `test-map.md`, `risk-map.md`, and `change-strategy.md` before assessing impact. If this is a non-trivial existing codebase and the brownfield map is missing, recommend `/brownfield` first.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/learned-rules-propagation.test.js`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/change/SKILL.md test/learned-rules-propagation.test.js
git commit -m "feat: inject learned-rules.md into /change (Devin-parity item 2)"
```

---

### Task 2: Propagate `learned-rules.md` injection to `/vibe`

**Files:**
- Modify: `.claude/skills/vibe/SKILL.md` (between Step 1 — Classify and Step 2 — Write a Micro-Contract)
- Test: `test/learned-rules-propagation.test.js` (append)

**Interfaces:**
- Consumes: `test/learned-rules-propagation.test.js` from Task 1 (append a new `test(...)` block; do not modify the existing one).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `test/learned-rules-propagation.test.js` (after the existing `test(...)` block, before end of file):

```js

test('/vibe reads learned-rules.md before finalizing the micro-contract', () => {
  const skill = read('.claude/skills/vibe/SKILL.md');
  assert.match(skill, /\.claude\/state\/learned-rules\.md/, 'must reference learned-rules.md');
  const beforeMicroContract = skill.slice(0, skill.indexOf('### Step 2 — Write a Micro-Contract'));
  assert.match(beforeMicroContract, /learned-rules\.md/, 'must be read before Step 2 (micro-contract), not after');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/learned-rules-propagation.test.js`
Expected: FAIL — `/vibe reads learned-rules.md before finalizing the micro-contract` fails (string not present); the Task 1 test still passes (1 pass, 1 fail).

- [ ] **Step 3: Add the injection instruction to `/vibe`**

In `.claude/skills/vibe/SKILL.md`, find this exact text:

```
If classification is uncertain, use the `clarify` gate (`.claude/skills/clarify/SKILL.md`) — ask at most 3 questions, prefer recording assumptions over interrogating. If still uncertain, escalate.

### Step 2 — Write a Micro-Contract
```

Replace it with:

```
If classification is uncertain, use the `clarify` gate (`.claude/skills/clarify/SKILL.md`) — ask at most 3 questions, prefer recording assumptions over interrogating. If still uncertain, escalate.

**Learned rules:** before writing the micro-contract, read `.claude/state/learned-rules.md`. If it exists and is non-empty, inject its contents verbatim into your working context — a learned rule can affect scope (Step 1) as well as implementation, so read it before the contract is finalized.

### Step 2 — Write a Micro-Contract
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/learned-rules-propagation.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/vibe/SKILL.md test/learned-rules-propagation.test.js
git commit -m "feat: inject learned-rules.md into /vibe (Devin-parity item 2)"
```

---

### Task 3: Propagate `learned-rules.md` injection to `/feature`, confirm `/sprint` needs no change

**Files:**
- Modify: `.claude/skills/feature/SKILL.md` (new `## Learned rules` section, between `## The spine` and `## Lanes (autonomous surface)`)
- Test: `test/learned-rules-propagation.test.js` (append)

**Interfaces:**
- Consumes: `test/learned-rules-propagation.test.js` from Tasks 1-2 (append two new `test(...)` blocks).
- Produces: nothing new consumed by later tasks. This closes out Item 2 (learned-rules propagation) entirely.

- [ ] **Step 1: Write the failing tests**

Append to `test/learned-rules-propagation.test.js`:

```js

test('/feature reads learned-rules.md for its own routing/decomposition reasoning', () => {
  const skill = read('.claude/skills/feature/SKILL.md');
  assert.match(skill, /\.claude\/state\/learned-rules\.md/, 'must reference learned-rules.md');
});

test('/sprint delegates building to /auto rather than duplicating the injection', () => {
  const skill = read('.claude/skills/sprint/SKILL.md');
  assert.match(skill, /Run `\/auto`/, '/sprint must hand off to /auto, which already injects learned-rules.md');
  assert.doesNotMatch(
    skill,
    /\.claude\/state\/learned-rules\.md/,
    '/sprint should not duplicate the injection /auto already performs'
  );
});
```

- [ ] **Step 2: Run test to verify the new failure**

Run: `node --test test/learned-rules-propagation.test.js`
Expected: 4 tests total — the `/feature` test FAILS (string not present yet); the `/sprint` test PASSES already (this confirms the spec's §1 claim that `/sprint` needs no change, without requiring any edit); the two Task 1/2 tests continue to PASS. (3 pass, 1 fail)

- [ ] **Step 3: Add the injection instruction to `/feature`**

In `.claude/skills/feature/SKILL.md`, find this exact text:

```
9. **Open PR(s)** linked to the Linear issue(s). If `--respond` was passed
   (default off), invoke `/pr-respond <pr#> --watch` on each PR just opened —
   one bounded response pass; merge remains human-owned. → **GATE 3**.

## Lanes (autonomous surface)
```

Replace it with:

```
9. **Open PR(s)** linked to the Linear issue(s). If `--respond` was passed
   (default off), invoke `/pr-respond <pr#> --watch` on each PR just opened —
   one bounded response pass; merge remains human-owned. → **GATE 3**.

## Learned rules

Before Step 2 (Decompose), read `.claude/state/learned-rules.md`. If it exists
and is non-empty, inject its contents verbatim into your working context —
this informs `/feature`'s own decomposition and lane-routing reasoning.
Downstream lanes it routes to (`/vibe`, `/change`, `/refactor`, `/build`)
perform their own injection once invoked (per this plan's Tasks 1-2, and
`/build`/`/refactor` already did before this plan), so this step is for the
conductor's own reasoning, not a pass-through.

## Lanes (autonomous surface)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/learned-rules-propagation.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/feature/SKILL.md test/learned-rules-propagation.test.js
git commit -m "feat: inject learned-rules.md into /feature (Devin-parity item 2, closes propagation gap)"
```

---

### Task 4: Generator-verifier failure-mode self-audit in `HARNESS.md`

**Files:**
- Modify: `HARNESS.md` (new subsection under "Steering loop (the human layer)")

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks. Documentation-only — no test file, per spec §5 ("no test — documentation only, same convention as other doc-only gaps in this harness, e.g. G24").

- [ ] **Step 1: Add the self-audit subsection**

In `HARNESS.md`, find this exact text:

```
## Steering loop (the human layer)

The harness improves itself between runs: `.claude/program.md` (the steering input that biases `/auto`), `.claude/state/learned-rules.md` (failure-derived rules, injected into future prompts, never deleted), and `review-on-stop.js` (surfaces session learnings as suggested `CLAUDE.md` edits — applied *between* sessions, never mid-run, to preserve the prompt cache).

## Skill-description conventions
```

Replace it with:

```
## Steering loop (the human layer)

The harness improves itself between runs: `.claude/program.md` (the steering input that biases `/auto`), `.claude/state/learned-rules.md` (failure-derived rules, injected into future prompts, never deleted), and `review-on-stop.js` (surfaces session learnings as suggested `CLAUDE.md` edits — applied *between* sessions, never mid-run, to preserve the prompt cache).

### Self-audit against Anthropic's named generator-verifier failure modes

Anthropic's engineering writing on the generator-verifier pattern names two specific
failure modes. This harness's rubric agents and `/auto`'s convergence loop were
checked against both, 2026-07-09:

- **Rubber-stamping** ("a verifier told only to check whether output is good, with
  no further criteria, will rubber-stamp"): `evaluator.md`'s artifact mode uses a
  weighted 5-criteria rubric with a hard `>= 7.0` average and `>= 5` per-criterion
  floor; runtime mode requires all three verification layers plus the security gate
  plus the perf ratchet to independently pass — never a bare accept/reject.
  `security-reviewer.md` requires a mandatory find-then-refute adversarial pass
  before any BLOCK finding survives. `design-critic.md` scores 4 named criteria on
  a defined 1-10 rubric with worked calibration examples. None of the three ever
  emits an unstructured "looks good."
- **Oscillation without convergence** ("if the generator can't address the
  verifier's feedback, the system oscillates without converging"): `/auto` has
  three independent backstops — a 50-total-iteration hard stop, a 3-consecutive-
  failed-self-heal per-story escalation (marks BLOCKED, logs to `failures.md`,
  extracts a learned rule, moves on rather than looping forever), and a wall-clock/
  agent-spawn/est-cost budget cap checked every iteration. `/change` and `/vibe`
  contain risk by **scope** instead of iteration count — escalate out of the lane
  the moment a fix would expand past its micro-contract — a deliberate,
  blast-radius-appropriate alternative to iteration capping, not a gap.

No fix was required by this audit; it documents and cites existing coverage.

## Skill-description conventions
```

- [ ] **Step 2: Sanity-check the file still parses as valid Markdown**

Run: `node -e "require('fs').readFileSync('HARNESS.md', 'utf8')"`
Expected: no output, exit code 0 (confirms the file is still readable; `HARNESS.md` has no automated Markdown linter in this repo today, so this is a minimal smoke check, not a real parse validation).

- [ ] **Step 3: Commit**

```bash
git add HARNESS.md
git commit -m "docs: self-audit HARNESS.md against Anthropic's generator-verifier failure modes (Devin-parity item 3)"
```

---

### Task 5: Bounded 3-instance majority-vote re-verification at `/gate`

**Files:**
- Modify: `.claude/skills/gate/SKILL.md` (Step 2 — Spawn the Minimal Review Set Concurrently; Output Files section)
- Test: `test/gate-reverify-wiring.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks (Item 1 is independent of Items 2-3).
- Produces: nothing consumed by later tasks (last task in this plan).

- [ ] **Step 1: Write the failing test**

Create `test/gate-reverify-wiring.test.js`:

```js
'use strict';

// Locks Item 1 of the 2026-07-09 Devin/Anthropic/Thoughtworks parity-hardening
// pass (docs/superpowers/specs/2026-07-09-devin-parity-hardening-design.md,
// §3): when /gate's security trigger fires, evaluator and security-reviewer
// each get 2 additional independent instances (3 total per axis), majority
// voted, fail-safe to BLOCK/FAIL on a non-clean vote. Scoped to /gate only,
// not /auto's per-group Gate 7.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/gate spawns 3 independent instances of evaluator and security-reviewer on the security trigger', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /2 additional independent instances/, 'must describe the additional spawns');
  assert.match(skill, /fresh context per instance/, 'instances must not share conversation context');
  assert.match(skill, /majority vote \(2-of-3\)/, 'must majority-vote each axis');
});

test('/gate fails safe to BLOCK/FAIL on a non-clean vote', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(
    skill,
    /fail safe to the stricter outcome \(BLOCK\/FAIL\)/,
    'must fail safe, not escalate to human (per spec\'s rejected-alternative decision)'
  );
});

test('/gate writes reverify-votes.json without changing existing verdict-file consumers', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /reverify-votes\.json/, 'must document the new audit-trail file');
  assert.match(skill, /written exactly as before/, 'existing verdict files must stay unchanged in shape/source');
  assert.match(
    skill,
    /`specs\/reviews\/reverify-votes\.json` — 3-instance majority-vote audit trail; only when a security trigger fired/,
    'Output Files section must list the new file'
  );
});

test('re-verification is scoped to /gate only, not /auto Gate 7', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(
    skill,
    /`\/auto`'s per-group Gate 7 keeps its existing single-pass security review unchanged/,
    'must explicitly scope the change away from /auto\'s recurring per-group gate'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gate-reverify-wiring.test.js`
Expected: FAIL — all 4 tests fail (none of the asserted strings exist in `gate/SKILL.md` yet).

- [ ] **Step 3: Add the re-verification step to `/gate`'s Step 2**

In `.claude/skills/gate/SKILL.md`, find this exact text:

```
- **security-reviewer** — only when the changed files touch auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns. Writes `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json`.

- **Approved-fixtures (G12):** when the changed files include any snapshot file (path contains `__snapshots__/` or ends with `.snap`/`.ambr`/`.approved.*`), run `node .claude/scripts/approved-fixtures-gate.js`. It checksums every snapshot against the approved baseline (`specs/test_artefacts/approved-snapshots.json`); a `blocked` verdict (a modified approved snapshot or a new unapproved one, exit 1) is a **BLOCK** (writes `specs/reviews/approved-fixtures-verdict.json`). After reviewing the change, re-bless with `npm run approve-fixtures -- --all` (or `-- --snapshots <files>`). `no-snapshots` / `pass` (removed-only WARN) are non-blocking. When the diff touches no snapshot files, skip.
```

Replace it with:

```
- **security-reviewer** — only when the changed files touch auth/authz, secrets, user input handling, uploads/downloads, network fetch/redirect/proxy code, payments/billing, persistence/schema/migrations, API routes/controllers/middleware, or configured security patterns. Writes `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json`.

- **Bounded re-verification when the security trigger fires (Devin-parity hardening, 2026-07-09).** When the security trigger above fires, spawn **2 additional independent instances** each of `evaluator` and `security-reviewer` (3 total per axis, including the always-on evaluator spawn and the triggered security-reviewer spawn above) — fresh context per instance via the `Agent` tool, no shared conversation between instances. Each instance runs its full existing process unmodified. Resolve each axis independently by majority vote (2-of-3): security PASS/BLOCK and functional PASS/FAIL can legitimately disagree. If an instance errors or times out instead of returning a verdict, fail safe to the stricter outcome (BLOCK/FAIL) for that axis. The existing `specs/reviews/security-verdict.json` and the evaluator's own verdict output are written exactly as before, sourced from the first-spawned instance of each — every existing consumer is unaffected. Additionally write `specs/reviews/reverify-votes.json`:
  ```json
  {
    "gate": "gate-reverify",
    "trigger": "security-boundary",
    "security": { "votes": ["pass", "pass", "fail"], "majority": "pass", "fail_safe_triggered": false },
    "functional": { "votes": ["pass", "pass", "pass"], "majority": "pass", "fail_safe_triggered": false },
    "timestamp": "<ISO 8601>"
  }
  ```
  This file is an audit trail only — no existing gate logic reads it. Scoped to `/gate` only; `/auto`'s per-group Gate 7 keeps its existing single-pass security review unchanged.

- **Approved-fixtures (G12):** when the changed files include any snapshot file (path contains `__snapshots__/` or ends with `.snap`/`.ambr`/`.approved.*`), run `node .claude/scripts/approved-fixtures-gate.js`. It checksums every snapshot against the approved baseline (`specs/test_artefacts/approved-snapshots.json`); a `blocked` verdict (a modified approved snapshot or a new unapproved one, exit 1) is a **BLOCK** (writes `specs/reviews/approved-fixtures-verdict.json`). After reviewing the change, re-bless with `npm run approve-fixtures -- --all` (or `-- --snapshots <files>`). `no-snapshots` / `pass` (removed-only WARN) are non-blocking. When the diff touches no snapshot files, skip.
```

- [ ] **Step 4: Add the new output file to the Output Files section**

In `.claude/skills/gate/SKILL.md`, find this exact text:

```
- `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json` — only when a security trigger fired
- `specs/reviews/security-scan.json` — computational security scan (secrets/SAST/deps) result; only when a security trigger fired
```

Replace it with:

```
- `specs/reviews/security-review.md` and `specs/reviews/security-verdict.json` — only when a security trigger fired
- `specs/reviews/security-scan.json` — computational security scan (secrets/SAST/deps) result; only when a security trigger fired
- `specs/reviews/reverify-votes.json` — 3-instance majority-vote audit trail; only when a security trigger fired
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/gate-reverify-wiring.test.js`
Expected: PASS (4/4)

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: all pre-existing tests continue to pass; the 2 new test files (`test/learned-rules-propagation.test.js` from Tasks 1-3, `test/gate-reverify-wiring.test.js` from this task) are picked up automatically by the existing test runner glob and pass.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/gate/SKILL.md test/gate-reverify-wiring.test.js
git commit -m "feat: bounded 3-instance majority-vote re-verification at /gate (Devin-parity item 1)"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (learned-rules propagation to `/change`, `/vibe`, `/feature`; `/sprint` needs no change) → Tasks 1, 2, 3.
- Spec §2 (self-audit subsection in `HARNESS.md`) → Task 4.
- Spec §3 (bounded N-way re-verification at `/gate`) → Task 5.
- Spec §4 (registry + docs — no manifest/README change needed) → confirmed no task required; Tasks 1-5 touch only the files the spec named.
- Spec §5 (tests) → Task 1-3's `test/learned-rules-propagation.test.js`, Task 5's `test/gate-reverify-wiring.test.js`, Task 4 explicitly has no test per spec.
- Spec's Known Limitations (diversify-the-rubric out of scope; one-way rule propagation) → no task needed, these are explicitly out of scope in the spec.

**Placeholder scan:** no TBD/TODO; every step shows the exact text to find and the exact text to replace it with; every test file shows complete, runnable code.

**Type/name consistency:** `reverify-votes.json`'s shape (`gate`, `trigger`, `security.votes`/`majority`/`fail_safe_triggered`, `functional.votes`/`majority`/`fail_safe_triggered`, `timestamp`) is identical between Task 5's SKILL.md edit and its test assertions. The phrase "fresh context per instance," "majority vote (2-of-3)," "fail safe to the stricter outcome (BLOCK/FAIL)," and "written exactly as before" are used identically in both the skill text and the test regexes across Task 5's steps.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-devin-parity-hardening.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
