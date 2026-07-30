# Docs Polish Implementation Plan (Audit Fix #5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three doc gaps from the 2026-07-02 audit: no "if your run dies" recovery doc, budget-cap defaults invisible outside `budget-state.js`, and five internal discipline skills that read like user commands.

**Architecture:** Docs + one test. Markers go in the five skills' frontmatter `description` as a bracketed suffix AFTER the "Use when…" trigger phrase (trigger text drives auto-invocation and must stay first; `seam-finder`-style leading prefixes are for stage-skills a human might type). A new skills-consistency test pins the markers so future skills of this class can't ship unmarked.

**Tech Stack:** Markdown + node:test (extend `test/skills-consistency.test.js`).

**Branch:** `fix/docs-polish` off `main`, PR when green.

## Global Constraints

- Surgical edits: every altered line traces to this plan; no adjacent tidying.
- **Marker wording must NOT match the tombstone detector** in `test/skills-consistency.test.js:33` (`/\[Reference, not a command\]|Do not invoke|do not invoke this skill/i`). Never use the words "do not invoke" in the marker.
- All stated numbers must match `.claude/scripts/budget-state.js:42-44` exactly: `cost` = 30 min / 80 agents / ~$8 est; `balanced` (default) = 90 min / 200 agents / ~$25 est; `max-quality` = 180 min / 400 agents / ~$60 est.
- Run the suite with `npm test`. iCloud gotcha (CLAUDE.md): if it hangs, kill orphaned `node --test` processes, delete ` 2.`-suffixed dup files, re-run once.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Internal-discipline markers + pinning test

**Files:**
- Modify: `.claude/skills/checking-coverage-before-change/SKILL.md` (frontmatter `description` only)
- Modify: `.claude/skills/checking-migration-safety/SKILL.md` (same)
- Modify: `.claude/skills/keeping-refactors-pure/SKILL.md` (same)
- Modify: `.claude/skills/pinning-down-behavior/SKILL.md` (same)
- Modify: `.claude/skills/sprouting-instead-of-editing/SKILL.md` (same)
- Test: `test/skills-consistency.test.js` (append one test)

**Interfaces:**
- Consumes: `listSkills()`/`SKILLS_DIR` already defined in the test file — reuse, do not redefine.
- Produces: the exact marker string ` [Internal discipline — applied automatically by pipeline agents mid-task; direct use is a power-user path.]` that Task 2's HARNESS.md note references.

- [ ] **Step 1: Write the failing test**

Append to `test/skills-consistency.test.js`:

```js
// The five discipline micro-skills are auto-invoked by agents mid-pipeline,
// not typed by humans; without a marker they read as user commands when a
// team browses .claude/skills/ (2026-07-02 audit fix #5). The marker is a
// SUFFIX: the leading "Use when…" trigger phrase drives auto-invocation and
// must stay first (unlike seam-finder-style stage skills, which prefix).
const INTERNAL_DISCIPLINE_SKILLS = [
  'checking-coverage-before-change',
  'checking-migration-safety',
  'keeping-refactors-pure',
  'pinning-down-behavior',
  'sprouting-instead-of-editing',
];

test('internal discipline skills carry the marker after their trigger phrase', () => {
  const offenders = [];
  for (const skill of INTERNAL_DISCIPLINE_SKILLS) {
    const text = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    const match = text.match(/^description:\s*(.+)$/m);
    const desc = match ? match[1] : '';
    const ok = /^Use when/.test(desc) && /\[Internal discipline — .+power-user path\.\]$/.test(desc);
    if (!ok) offenders.push(skill);
  }
  assert.deepStrictEqual(offenders, [], `missing/misplaced internal marker: ${offenders.join(', ')}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "internal discipline" test/skills-consistency.test.js`
Expected: FAIL listing all five skills as offenders.

- [ ] **Step 3: Add the marker to each of the five descriptions**

In each SKILL.md frontmatter, append to the end of the existing `description:` line (single space before the bracket, nothing after the closing bracket):

```
 [Internal discipline — applied automatically by pipeline agents mid-task; direct use is a power-user path.]
```

Change nothing else in the files — no body edits, no trigger-phrase rewording.

- [ ] **Step 4: Run the test file to verify pass + no tombstone regression**

Run: `node --test test/skills-consistency.test.js`
Expected: all tests PASS (the marker must not trip the tombstone test — it contains none of its patterns).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/checking-coverage-before-change/SKILL.md .claude/skills/checking-migration-safety/SKILL.md .claude/skills/keeping-refactors-pure/SKILL.md .claude/skills/pinning-down-behavior/SKILL.md .claude/skills/sprouting-instead-of-editing/SKILL.md test/skills-consistency.test.js
git commit -m "docs: mark the five discipline micro-skills as internal

They are auto-invoked by agents mid-pipeline; unmarked they read as user
commands when a team browses .claude/skills/ (2026-07-02 audit fix #5).
Suffix placement keeps the auto-trigger phrase first; a consistency test
pins the marker.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: README recovery + budget sections, HARNESS.md marker note

**Files:**
- Modify: `README.md` (one new section after `## Approval Modes`, i.e. between the end of that section and `## Existing-Code Flow`)
- Modify: `HARNESS.md` (one sentence wherever skill-description conventions are discussed, or appended to the doc's conventions/notes area — locate with `grep -n "seam-finder\|Internal pipeline stage" HARNESS.md`; if no conventions text exists, add the note as a short paragraph at the end of the document's introductory section)

**Interfaces:**
- Consumes: the marker string from Task 1; budget numbers from `budget-state.js:42-44`; resume mechanics from `.claude/skills/auto/SKILL.md:96-106` and `:842` (verified claims — do not restate beyond what's below).
- Produces: nothing downstream.

- [ ] **Step 1: Add the README section**

Insert immediately before the `## Existing-Code Flow` heading:

```markdown
## If Your Run Dies (and What It Costs First)

`/auto` runs are resumable by design — a killed session, closed laptop, or budget stop loses nothing that was committed:

- **Just re-invoke `/auto`.** It resumes from `claude-progress.txt` (the append-only progress log every iteration writes), re-reads `features.json` and git state, and runs a startup smoke check before building on prior work. Nothing needs exporting from the dead session.
- **See where it stopped** with `/status` (or `node .claude/scripts/pipeline-status.js status`), which reads the same state files.
- **Budget stops are clean stops.** Every run is metered (wall-clock, agent spawns, estimated cost via `node .claude/scripts/budget-state.js`) and stops at an iteration boundary when a cap is hit, setting `next_action: "BUDGET — …"` in `claude-progress.txt`. Raise the cap (`--budget …`) or pass `--budget off`, then re-invoke `/auto` to resume.
- **For long unattended PRD-to-PR runs**, prefer `node .claude/scripts/build-chain.js docs/prd.md` — it drives fresh `claude -p` processes wave by wave through the same progress file, so a killed process resumes at the next wave.

Default budget caps by model tier (`.claude/scripts/budget-state.js`):

| Tier | Wall-clock | Agent spawns | Est. cost |
|------|-----------|--------------|-----------|
| `cost` | 30 min | 80 | ~$8 |
| `balanced` (default) | 90 min | 200 | ~$25 |
| `max-quality` | 180 min | 400 | ~$60 |

Cost figures are surfaced estimates (Σ per-spawn receipts × tier rate), not billing data. A first `--auto` run on `balanced` that stops after ~90 minutes with `BUDGET` in `next_action` is behaving as designed — resume it or merge what's done.
```

- [ ] **Step 2: Verify the README claims against source (read-only check)**

Confirm `budget-state.js:42-44` still carries the table's numbers and `auto/SKILL.md` still documents resume-from-`claude-progress.txt` and the `BUDGET —` `next_action` convention. Adjust the section only if a number/name diverges (and say so in your report).

- [ ] **Step 3: Add the HARNESS.md convention note**

One sentence, placed per the Files note above:

```
Skill-description markers: pipeline *stage* skills carry a leading `[Internal pipeline stage — …]` prefix; discipline micro-skills carry a trailing `[Internal discipline — …]` suffix instead, because their leading "Use when…" phrase is the auto-invocation trigger and must stay first (pinned by `test/skills-consistency.test.js`).
```

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS (~1069 on main-based branch; count may differ from the other open branch — anything 0-fail is green).

- [ ] **Step 5: Commit**

```bash
git add README.md HARNESS.md
git commit -m "docs: run-death recovery section, budget-cap disclosure, marker convention

2026-07-02 audit fix #5: the resume mechanics existed but were
undiscoverable outside auto/SKILL.md internals, and default budget caps
were invisible until a run hit one.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-plan (workflow, not tasks)

Fresh-context task reviews per task, whole-branch review on the strongest model, PR titled "docs: recovery, budget disclosure, internal-skill markers (audit fix #5)" referencing `docs/superpowers/specs/2026-07-02-audit-fixes-design.md`. Human owns merge.
