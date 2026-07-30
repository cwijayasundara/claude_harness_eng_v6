# `/feature` Brownfield Change Route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/feature` conductor command that takes existing-code work from a feature request to a reviewed PR, scaling from a single `/change` up to an epic via `/spec`→`/design`→`tracker-publish`→`/auto`, backed by a committed, incrementally-maintained DeepWiki.

**Architecture:** `/feature` is a thin orchestrating **skill** (`.claude/skills/feature/SKILL.md`, auto-registered as a command, auto-copied to scaffolded projects). It delegates all heavy lifting to existing skills and adds four small new pieces: a single-story Linear publish path, the committed-wiki lifecycle, a design-adherence gate, and PR↔Linear linkage. The only new executable code is one pure, network-free helper that shapes a one-issue tracker-map for the existing `publish-to-linear.js`.

**Tech Stack:** Markdown skills (prompt logic), Node.js stdlib (no new npm deps), `node --test` contract tests asserting SKILL.md content (the repo's established skill-testing convention).

## Global Constraints

- Skills live at `.claude/skills/<name>/SKILL.md`; the directory is copied wholesale to target projects by `.claude/scripts/scaffold-apply.js` (line 90) — **no enumeration step needed** for `/feature` to ship.
- No new runtime or dev dependencies. Pure Node stdlib only (`devDependencies` stays `{ playwright }`).
- Tests run via `node --test test/<file>.test.js`. Skill behavior is verified by **contract tests** (`test/*-contract.test.js`) using `assert.match(read('<skill>'), /regex/)`.
- `/feature` is a **thin conductor**: it must delegate to `/brownfield`, `/code-map`, `/spec`, `/design`, `tracker-publish`, `/change`, `/auto`, `/gate` — never reimplement them.
- Conductor frontmatter matches `/build` and `/gate`: `context: fork`.
- The DeepWiki lives at `specs/brownfield/wiki/` and is **committed** (it is not in `.gitignore` or `gitignore.template` — only `specs/reviews/` is ignored). Do not add it to any ignore file.
- Linear safety rules from `tracker-publish` hold: never auto-mark issues `Done`; keep API keys in `.env`, not repo files.
- Reuse `publish-to-linear.js` **unchanged** — it already iterates `trackerMap.groups`, reads `group.body_file`/`title`/`labels`/`stories`, and resolves `config_snapshot.project_slug`/`ready_state`. The single-story path just feeds it a one-entry map.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|-----------|
| `.claude/skills/tracker-publish/scripts/single-story-map.js` | Pure function building a one-issue tracker-map in the shape `publish-to-linear.js` consumes | Create |
| `test/tracker-single-story-map.test.js` | Unit tests for the helper (network-free) | Create |
| `.claude/skills/tracker-publish/SKILL.md` | Document `--granularity single` | Modify |
| `.claude/skills/feature/SKILL.md` | The `/feature` conductor | Create |
| `test/feature-route-contract.test.js` | Contract test for the conductor's required behaviors | Create |
| `test/feature-wiki-committed-contract.test.js` | Guard: wiki is committed, not ignored; brownfield/code-map cross-reference present | Create |
| `.claude/skills/code-map/SKILL.md` | Note that `/feature` commits + maintains the wiki | Modify |
| `README.md` | Add `/feature` to the command reference table | Modify |
| `CLAUDE.md` | One line under "Brownfield Discovery" pointing to `/feature` | Modify |

---

## Task 1: Single-story Linear publish path

**Files:**
- Create: `.claude/skills/tracker-publish/scripts/single-story-map.js`
- Test: `test/tracker-single-story-map.test.js`
- Modify: `.claude/skills/tracker-publish/SKILL.md`

**Interfaces:**
- Produces: `buildSingleStoryMap({ storyId, title, acBody, labels, provider, config }) -> trackerMap object`. The returned object has `granularity: 'single'`, a single `groups[storyId]` entry (`title`, `body_file`, `labels`, `stories: [storyId]`, `tracker_key: null`), a matching `stories[storyId]`, and `config_snapshot: config`. The caller writes the AC body to the returned `groups[storyId].body_file` path and `tracker-map.json`, then runs the existing `publish-to-linear.js`.

- [ ] **Step 1: Write the failing unit test**

Create `test/tracker-single-story-map.test.js`:

```js
'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildSingleStoryMap } = require(
  path.join(__dirname, '..', '.claude/skills/tracker-publish/scripts/single-story-map.js')
);

test('builds one group keyed by storyId in the publisher-consumed shape', () => {
  const m = buildSingleStoryMap({
    storyId: 'F-001',
    title: 'Add confidence scores to extraction',
    acBody: '- AC1: ...',
    labels: ['feature'],
    config: { project_slug: 'demo', ready_state: 'Ready for Agent' }
  });
  assert.equal(m.granularity, 'single');
  assert.equal(m.provider, 'linear');
  assert.deepEqual(Object.keys(m.groups), ['F-001']);
  const g = m.groups['F-001'];
  assert.equal(g.body_file, '.claude/state/tracker-runs/group-F-001.md');
  assert.deepEqual(g.stories, ['F-001']);
  assert.equal(g.tracker_key, null); // so looksAlreadyPublished() returns false → it publishes
  assert.ok(g.labels.includes('agent-ready'));
  assert.ok(g.labels.includes('feature'));
  assert.deepEqual(m.stories['F-001'], { group: 'F-001', tracker_key: null });
  assert.equal(m.config_snapshot.project_slug, 'demo');
});

test('throws when storyId or title is missing', () => {
  assert.throws(() => buildSingleStoryMap({ title: 'x' }), /storyId required/);
  assert.throws(() => buildSingleStoryMap({ storyId: 'F-002' }), /title required/);
});

test('deduplicates labels and always includes agent-ready', () => {
  const m = buildSingleStoryMap({ storyId: 'F-003', title: 't', labels: ['agent-ready', 'agent-ready', 'x'] });
  const labels = m.groups['F-003'].labels;
  assert.equal(labels.filter((l) => l === 'agent-ready').length, 1);
  assert.deepEqual(labels.sort(), ['agent-ready', 'x']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/tracker-single-story-map.test.js`
Expected: FAIL — `Cannot find module '.../single-story-map.js'`.

- [ ] **Step 3: Write the helper**

Create `.claude/skills/tracker-publish/scripts/single-story-map.js`:

```js
'use strict';

// Builds a one-issue tracker-map for a single brownfield story. The shape is
// exactly what publish-to-linear.js already consumes (it iterates
// trackerMap.groups and reads title / body_file / labels / stories), so the
// publisher needs no changes — `--granularity single` is just a one-entry map.
function buildSingleStoryMap({ storyId, title, acBody = '', labels = [], provider = 'linear', config = {} }) {
  if (!storyId) throw new Error('storyId required');
  if (!title) throw new Error('title required');
  const bodyFile = `.claude/state/tracker-runs/group-${storyId}.md`;
  const allLabels = Array.from(new Set(['agent-ready', ...labels]));
  return {
    provider,
    granularity: 'single',
    status: 'pending',
    groups: {
      [storyId]: {
        title,
        body_file: bodyFile,
        labels: allLabels,
        stories: [storyId],
        depends_on_groups: [],
        tracker_key: null
      }
    },
    stories: {
      [storyId]: { group: storyId, tracker_key: null }
    },
    config_snapshot: config
  };
}

module.exports = { buildSingleStoryMap };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/tracker-single-story-map.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Document `--granularity single` in the tracker-publish skill**

In `.claude/skills/tracker-publish/SKILL.md`, in the `## Granularity` section table (after the `story` row), add a `single` row:

```markdown
| `single` | One tracker issue for a single brownfield story (no epic/dependency-graph prerequisites). Built by `scripts/single-story-map.js` into the same map shape `publish-to-linear.js` consumes, then published with the unchanged publisher. | Used by `/feature`'s single-story lane, where the change is one bounded story and the full `/build` artifact set (epics, dependency-graph, component-map, features.json) does not exist. |
```

And under `## Prerequisites`, add a line:

```markdown
- **`--granularity single` exception:** the single-story lane needs only `.claude/tracker-config.json` and the story's acceptance criteria — none of `epics.md`, `dependency-graph.md`, `component-map.md`, or `features.json` is required. `/feature` builds the one-entry map via `scripts/single-story-map.js`.
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/tracker-publish/scripts/single-story-map.js \
        test/tracker-single-story-map.test.js \
        .claude/skills/tracker-publish/SKILL.md
git commit -m "feat(tracker): single-story Linear publish path for /feature

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DeepWiki committed-wiki wiring + guard

**Files:**
- Create: `test/feature-wiki-committed-contract.test.js`
- Modify: `.claude/skills/code-map/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a guarantee (asserted by test) that the wiki path stays committable and that `/code-map`'s SKILL documents the `/feature`-owned commit lifecycle. No new code.

- [ ] **Step 1: Write the failing guard test**

Create `test/feature-wiki-committed-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('wiki path is NOT excluded by .gitignore or gitignore.template', () => {
  for (const rel of ['.gitignore', '.claude/templates/gitignore.template']) {
    const ig = read(rel);
    assert.doesNotMatch(ig, /specs\/brownfield\/wiki/, `${rel} must not ignore the committed wiki`);
    assert.doesNotMatch(ig, /^\s*specs\/brownfield\/?\s*$/m, `${rel} must not ignore specs/brownfield wholesale`);
  }
});

test('code-map SKILL documents the /feature-owned committed-wiki lifecycle', () => {
  const cm = read('.claude/skills/code-map/SKILL.md');
  assert.match(cm, /committed/i);
  assert.match(cm, /\/feature/);
  assert.match(cm, /incrementally|--files/);
});
```

- [ ] **Step 2: Run the test to verify the second case fails**

Run: `node --test test/feature-wiki-committed-contract.test.js`
Expected: the first test PASSES (gitignore already excludes only `specs/reviews/`); the second test FAILS (code-map SKILL has no `/feature` committed-wiki note yet).

- [ ] **Step 3: Add the committed-wiki note to the code-map skill**

In `.claude/skills/code-map/SKILL.md`, in the `## Gotchas` section, add a bullet:

```markdown
- **The wiki is a committed, living artifact under `/feature`.** When `/feature` runs the change route, `specs/brownfield/wiki/` is committed to the repo (it is not gitignored) and refreshed incrementally per change via `--files` patching + the `graph-refresh` hook — never fully rebuilt except on first run or after a massive refactor. The updated wiki ships in the same PR as the code, so the doc and code move together.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/feature-wiki-committed-contract.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add test/feature-wiki-committed-contract.test.js .claude/skills/code-map/SKILL.md
git commit -m "feat(wiki): document committed, /feature-maintained DeepWiki lifecycle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The `/feature` conductor skill

**Files:**
- Create: `.claude/skills/feature/SKILL.md`
- Test: `test/feature-route-contract.test.js`

**Interfaces:**
- Consumes: `buildSingleStoryMap` (Task 1) for the single-story lane; the committed-wiki lifecycle (Task 2).
- Produces: the `/feature` command. Delegates to `/brownfield`, `/code-map`, `/spec`, `/design`, `tracker-publish`, `/change`, `/auto`, `/gate`.

Build this task as three TDD cycles against one growing SKILL.md: (A) spine + scope classifier + three gates, (B) DeepWiki lifecycle, (C) Linear publish + PR↔Linear linkage. Write the contract block, run it red, write the matching SKILL section, run it green, commit.

- [ ] **Step 1: Write the failing contract test (all three cycles' assertions)**

Create `test/feature-route-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SKILL = '.claude/skills/feature/SKILL.md';

test('skill exists with correct frontmatter (name, fork context)', () => {
  const s = read(SKILL);
  assert.match(s, /^name:\s*feature\s*$/m);
  assert.match(s, /^context:\s*fork\s*$/m);
});

test('A: documents the scope-adaptive lanes (single -> /change, cluster -> spec/design/auto)', () => {
  const s = read(SKILL);
  assert.match(s, /single[- ]story/i);
  assert.match(s, /\/change/);
  assert.match(s, /\/spec/);
  assert.match(s, /\/design/);
  assert.match(s, /\/auto/);
  // routing rule: the ≤3 files / no auth-data-API threshold (shared with /change Step 0)
  assert.match(s, /≤\s*3 files|3 files/);
  assert.match(s, /auth|persistence|public[- ]API/i);
});

test('A: defines exactly the three human gates', () => {
  const s = read(SKILL);
  assert.match(s, /GATE 1[^\n]*decompos/i);
  assert.match(s, /GATE 2[^\n]*(plan|design)/i);
  assert.match(s, /GATE 3[^\n]*PR/i);
});

test('A: is a thin conductor that delegates and does not reimplement', () => {
  const s = read(SKILL);
  assert.match(s, /thin conductor|delegate/i);
  assert.match(s, /\/brownfield/);
  assert.match(s, /\/gate/);
});

test('B: DeepWiki lifecycle — build once, patch incrementally, ship with PR', () => {
  const s = read(SKILL);
  assert.match(s, /first run/i);
  assert.match(s, /--files|incremental/i);
  assert.match(s, /graph-refresh/);
  assert.match(s, /STALE/);
  assert.match(s, /same PR|ships? (in|with)/i);
  // GATE 2 reads the committed pre-change wiki to enforce design-adherence
  assert.match(s, /cite[^\n]*wiki|wiki[^\n]*cite/i);
  assert.match(s, /design[- ]adherence|adhere to/i);
});

test('B: full-rebuild fallback when graph warnings spike', () => {
  const s = read(SKILL);
  assert.match(s, /fallback|spike|massive refactor/i);
});

test('C: single-story lane publishes via single-story-map + publish-to-linear', () => {
  const s = read(SKILL);
  assert.match(s, /single-story-map\.js|--granularity single/);
  assert.match(s, /publish-to-linear\.js/);
});

test('C: cluster lane publishes via tracker-publish --granularity group', () => {
  const s = read(SKILL);
  assert.match(s, /--granularity group|tracker-publish/);
});

test('C: PR links back to the Linear issue; issue left in Human Review, never auto-Done', () => {
  const s = read(SKILL);
  assert.match(s, /link[^\n]*Linear|Linear[^\n]*link/i);
  assert.match(s, /Human Review/);
  assert.match(s, /never[^\n]*Done|not[^\n]*auto.*Done/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/feature-route-contract.test.js`
Expected: FAIL — `Cannot find module`/`ENOENT` for `.claude/skills/feature/SKILL.md`.

- [ ] **Step 3: Write the `/feature` SKILL.md**

Create `.claude/skills/feature/SKILL.md` with this exact content:

````markdown
---
name: feature
description: Brownfield change route — take an existing-code feature request from intent to a reviewed PR, scaling from a single /change to an epic via /spec→/design→/auto. Linear-tracked, backed by a committed DeepWiki.
argument-hint: "[\"<feature request>\"]"
context: fork
---

# Feature Skill — Brownfield Change Route

`/feature` is a **thin conductor** for working with existing code: adding a new
feature or altering an existing one. It sequences existing skills behind three
human gates and keeps a committed DeepWiki current. It does **not** reimplement
`/brownfield`, `/code-map`, `/spec`, `/design`, `tracker-publish`, `/change`,
`/auto`, or `/gate` — it delegates to them.

For greenfield builds use `/build`. For a discovery-only pass use `/brownfield`.

## Usage

```text
/feature "add confidence scores to the extraction endpoint"
/feature "split billing into usage-based and seat-based plans"   # likely an epic
```

## The spine

The same backbone runs at every scale; only the engine in steps 5–8 differs.

1. **Discover** — ensure the DeepWiki is fresh and committed (see *DeepWiki lifecycle*).
2. **Decompose** — turn the request into a story, or (epic scope) into epics +
   stories + dependency-graph. Cite the DeepWiki. → **GATE 1**.
3. **Plan / design for adherence** — choose the seam/layer each change extends. → **GATE 2**.
4. **Publish to Linear** — single issue, or one issue per dependency group.
5. **Implement** test-first, in place.
6–7. **Unit + integration tests**, full suite green.
8. **Verify** against acceptance criteria + clean-code/security review.
9. **Open PR(s)** linked to the Linear issue(s). → **GATE 3**.

## Scope classification (the one routing decision)

After GATE 1 you hold the decomposition. Classify it, reusing `/change`
Step 0's thresholds and `specs/brownfield/risk-map.md`:

- **Single-story lane** — 1 bounded story, ≤ 3 files, no auth/authz/payments/
  persistence/public-API-contract change → delegate to **`/change`**.
- **Epic / cluster lane** — multiple stories, an epic, or any dependency graph →
  run **`/spec` → `/design` → `tracker-publish --granularity group` → `/auto`**
  for parallel agent-team execution.

State the chosen lane in one line before proceeding.

## DeepWiki lifecycle — build once, maintain incrementally

The wiki at `specs/brownfield/wiki/` is **committed** repo docs, maintained as a
living artifact, never fully rebuilt per request.

1. **First run only — full build.** If no committed wiki exists, run full
   `/brownfield` to produce `code-graph.json` + the wiki; `git add` and commit it.
2. **Subsequent requests — freshness check, not rebuild.** If the wiki carries a
   `> STALE since…` banner (stamped by the `graph-refresh` hook on graph drift),
   incrementally patch only the touched files with `/code-map`'s `--files` mode,
   then re-render. If current, just read it.
3. **During implementation — self-heals.** The `graph-refresh` Stop/SubagentStop
   hook patches `code-graph.json` (`--files`) and re-renders the wiki per turn.
4. **At PR time — ships with the change.** Re-render from the final graph and
   commit the updated wiki **in the same PR** as the code.
5. **Fallback.** If incremental graph warnings spike (e.g. after a massive
   refactor), fall back to a full `/brownfield` rebuild rather than trust a
   degraded patch.

**GATE 2 design-adherence (enforced, not advisory):** the plan/design must cite
specific DeepWiki pages/symbols and state, for each edit, which existing
module/seam/layer it extends. Reject any plan that invents a parallel structure
instead of extending an existing seam. GATE 2 reads the **committed (pre-change)**
wiki; the post-change re-render is part of the implementation output.

## Linear publishing

- **Single-story lane:** build a one-issue map with
  `node .claude/skills/tracker-publish/scripts/single-story-map.js`'s
  `buildSingleStoryMap(...)` (or `tracker-publish --granularity single`), write
  the AC to `.claude/state/tracker-runs/group-<storyId>.md` and the map to
  `.claude/state/tracker-map.json`, then publish with the unchanged
  `node .claude/skills/tracker-publish/scripts/publish-to-linear.js`.
- **Epic / cluster lane:** run `tracker-publish --granularity group` as-is.
- Transport order is the existing one: Linear MCP → `publish-to-linear.js` →
  manual CLI.

## PR ↔ Linear linkage

- Every opened PR body includes the Linear issue identifier/URL.
- After the PR is open, move the Linear issue to **Human Review** (via MCP if
  available, else note it for the human). **Never auto-mark an issue `Done`** —
  merge stays a human gate, per `tracker-publish` safety rules.

## The three gates

- **GATE 1 — approve decomposition.** Present the story (or epics + stories +
  dependency-graph) with acceptance criteria before publishing to Linear.
- **GATE 2 — approve plan/design.** Present the DeepWiki-cited plan (single lane)
  or `/design` output (cluster lane). Enforce design-adherence here.
- **GATE 3 — review PR(s).** Stop at the opened PR(s); the human reviews and merges.

## Gotchas

- **Do not reimplement delegated skills.** If `/change` or `/auto` behavior is
  wrong, fix it there, not here.
- **Do not skip the wiki commit.** The PR must contain the updated wiki alongside
  the code — a stale committed wiki is worse than none.
- **Do not auto-merge or auto-close Linear issues.** Merge is a human gate.
- **Do not run the full epic path for a one-line change.** Classify scope first;
  the single-story lane exists to avoid `/spec`/`/design` overhead.
````

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/feature-route-contract.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/feature/SKILL.md test/feature-route-contract.test.js
git commit -m "feat(feature): add /feature brownfield change route conductor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Register the command in docs

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Test: `test/feature-route-contract.test.js` (extend with a registration block)

**Interfaces:**
- Consumes: the `/feature` skill (Task 3).
- Produces: discoverability — `/feature` appears in the README command reference and the CLAUDE.md brownfield guidance.

> **Cache note:** `CLAUDE.md` is part of the cached prompt prefix; this one-line edit is fine between sessions but must not happen mid-`/auto`-run. Make it as part of this plan's execution, not during a separate build.

- [ ] **Step 1: Extend the contract test (red)**

Append to `test/feature-route-contract.test.js`:

```js
test('registration: README and CLAUDE.md reference /feature', () => {
  const readme = read('README.md');
  assert.match(readme, /\|\s*`\/feature`\s*\|/);
  const claude = read('CLAUDE.md');
  assert.match(claude, /\/feature/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/feature-route-contract.test.js`
Expected: the new `registration` test FAILS (README/CLAUDE.md have no `/feature` yet); the other 10 still pass.

- [ ] **Step 3: Add `/feature` to the README command reference table**

In `README.md`, in the command reference table (around line 175, near the
`/brownfield`, `/vibe`, `/change` rows), add a row immediately after the
`/brownfield` row:

```markdown
| `/feature` | Brownfield change route: feature request → reviewed PR, scaling single `/change` to epic `/spec`→`/design`→`/auto`; Linear-tracked, committed DeepWiki |
```

- [ ] **Step 4: Add a `/feature` pointer to CLAUDE.md**

In `CLAUDE.md`, under the `### Brownfield Discovery` subsection, append one
sentence at the end of that paragraph:

```markdown
For end-to-end existing-code work (request → reviewed PR), use `/feature`, which runs `/brownfield` discovery, keeps the committed DeepWiki current, and routes to `/change` (single story) or `/spec`→`/design`→`/auto` (epic) behind three human gates.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/feature-route-contract.test.js`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md test/feature-route-contract.test.js
git commit -m "docs: register /feature in README command reference and CLAUDE.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full suite green + finish

**Files:** none (verification only)

- [ ] **Step 1: Run the new tests together**

Run: `node --test test/tracker-single-story-map.test.js test/feature-wiki-committed-contract.test.js test/feature-route-contract.test.js`
Expected: all PASS (3 + 2 + 11 = 16 tests).

- [ ] **Step 2: Run the full unit suite to confirm no regressions**

Run: `npm test`
Expected: existing suite still green; the three new files included.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/feature-brownfield-change-route
gh pr create --title "feat: /feature brownfield change route" --body "$(cat <<'EOF'
Adds `/feature`, a scope-adaptive conductor for existing-code work: request →
reviewed PR, scaling a single `/change` up to an epic via
`/spec`→`/design`→`tracker-publish`→`/auto`, behind three human gates
(decomposition, plan/design, PR), backed by a committed, incrementally-
maintained DeepWiki.

Thin conductor — composes existing skills. New code is one pure helper
(`single-story-map.js`) plus skill/doc wiring. Design spec:
`docs/superpowers/specs/2026-06-25-feature-brownfield-change-route-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Scope-adaptive command (`/feature`, single vs epic lanes) → Task 3 (scope classification section + contract). ✓
- Three gates → Task 3 (gates section + contract). ✓
- DeepWiki: committed, build-once/patch-incrementally, ships with PR, GATE 2 cites it → Task 2 (guard + code-map note) + Task 3 (lifecycle section + contract). ✓
- Design-adherence enforcement → Task 3 (GATE 2 section + contract assertion). ✓
- Linear: group reused, `--granularity single` new, PR linkage → Task 1 (helper + doc) + Task 3 (publishing + linkage sections + contract). ✓
- New-vs-reused / thin conductor → Task 3 (delegation contract assertion). ✓
- Auto-ships to scaffolded projects → Global Constraints (scaffold-apply copies skills wholesale; no task needed). ✓
- Registration/discoverability → Task 4. ✓

**Placeholder scan:** No TBD/TODO. Every code and test step carries full content. ✓

**Type consistency:** `buildSingleStoryMap` signature and returned shape are identical in Task 1's interface block, test, and implementation, and referenced consistently in Task 3's SKILL.md. The map shape matches the fields `publish-to-linear.js` reads (`groups[].title/body_file/labels/stories`, `config_snapshot.project_slug/ready_state`). ✓

**Note:** the conductor SKILL.md is prose; its "tests" are content-contract assertions (the repo's established convention), not behavioral unit tests. End-to-end behavior (a real `/feature` run landing a PR + Linear issue) is validated manually per the spec's testing strategy, not in CI, because it requires a live repo, Linear creds, and GitHub.
