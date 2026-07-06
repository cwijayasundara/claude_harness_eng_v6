# PE-Vocabulary Ubiquitous-Language Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed `CONTEXT.md` from the installed `private-equity` vertical plugin's skill vocabulary whenever that plugin is enabled, grouped under three bounded-context headings, and wire `pe-ic-memo` to read the same glossary — closing the loop between the 2026-07-05 ubiquitous-language and pe-ic-memo work.

**Architecture:** One new deterministic script, `.claude/scripts/pe-glossary-pack.js`, extracts `name`/`description` frontmatter from the installed plugin's `skills/*/SKILL.md` files (found under the user's home directory, not the project repo — plugins installed via `claude plugin install` live at `~/.claude/plugins/{marketplaces,cache}/...`, distinct from this project's own `.claude/`) and writes `specs/brd/pe-glossary-pack.json`. A new BRD sub-step (2.7) reads that pack, if present, and distills real domain nouns into `CONTEXT.md` under fixed bounded-context section headings, before the existing Step 2.8 layers in project-specific `domain_concepts` terms. `pe-ic-memo/SKILL.md` gains one line telling it to reuse `CONTEXT.md` terms. `vocabulary-check.js` and the rest of the pipeline (`spec`, `design`, `implement`, `generator.md`) need no changes — they already treat `CONTEXT.md` as the single glossary source regardless of how a term got there.

**Tech Stack:** Node.js (`node:test`, `node:assert`, `fs`, `path`, `os`), matching the existing `.claude/scripts/*.js` deterministic-sensor pattern (see `vocabulary-check.js`, `modularity-pack.js`).

## Global Constraints

- No new runtime dependencies — plain Node.js `fs`/`path`/`os`, matching every existing `.claude/scripts/*.js` sensor.
- Reuse `parseSkillFrontmatter` from `.claude/scripts/telemetry-skill-helpers.js` rather than writing a second frontmatter parser (DRY).
- `.claude/scripts/pe-glossary-pack.js` must degrade loudly (exit 2, non-zero stderr) when the plugin is enabled but its skills directory cannot be found — never silently produce an empty pack in that case.
- When the `private-equity` plugin is **not** enabled, the script must be a complete no-op: exit 0, no output file written, no `specs/brd/` directory side effects beyond what already exists.
- `vocabulary-check.js`, `design/SKILL.md`, `implement/SKILL.md`, `generator.md`, and the `harness-manifest.json` `vocabulary-check` sensor entry's `id`/`wired_at` fields must NOT change — only its `description` text gets one clause appended.
- All new/edited `.claude/skills/*/SKILL.md` prose must match the file's existing voice and formatting conventions exactly (bold lead-in phrase + explanation, matching `/spec`'s and `/brd`'s existing glossary instructions).

---

### Task 1: `pe-glossary-pack.js` pure functions — plugin detection, skills lookup, pack building

**Files:**
- Create: `.claude/scripts/pe-glossary-pack.js`
- Test: `test/pe-glossary-pack.test.js`

**Interfaces:**
- Consumes: `parseSkillFrontmatter(raw: string): { name?: string, description?: string, ... }` from `.claude/scripts/telemetry-skill-helpers.js` (existing, exported).
- Produces (for Task 2 and the test suite):
  - `isPrivateEquityEnabled(enabledPlugins: object|undefined): boolean`
  - `findSkillsDir(homeDir: string): string|null`
  - `readSkillDescriptions(skillsDir: string): Array<{ skill: string, description: string }>`
  - `buildPack(skillDescriptions: Array<{ skill: string, description: string }>): { contexts: Array<{ name: string, skills: Array<{ skill: string, description: string }> }> }`
  - `BOUNDED_CONTEXTS: Array<{ name: string, skills: string[] }>` (the fixed assignment table)
  - `MARKETPLACE_SKILLS_SUBPATH: string`, `CACHE_SKILLS_SUBPATH: string` (relative subpaths under a home directory)

- [ ] **Step 1: Write the failing test**

Create `test/pe-glossary-pack.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'pe-glossary-pack.js');
const {
  isPrivateEquityEnabled, findSkillsDir, readSkillDescriptions, buildPack,
  BOUNDED_CONTEXTS, MARKETPLACE_SKILLS_SUBPATH, CACHE_SKILLS_SUBPATH,
} = require(SCRIPT);

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pe-glossary-'));
}

function writeSkill(skillsDir, dirName, frontmatterName, description) {
  const dir = path.join(skillsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\n# ${frontmatterName}\n`
  );
}

test('isPrivateEquityEnabled matches a private-equity@ key with a truthy value', () => {
  assert.strictEqual(isPrivateEquityEnabled({ 'private-equity@claude-for-financial-services': true }), true);
  assert.strictEqual(isPrivateEquityEnabled({ 'private-equity@claude-for-financial-services': false }), false);
  assert.strictEqual(isPrivateEquityEnabled({ 'wealth-management@claude-for-financial-services': true }), false);
  assert.strictEqual(isPrivateEquityEnabled(undefined), false);
  assert.strictEqual(isPrivateEquityEnabled({}), false);
});

test('findSkillsDir prefers the marketplace path over the cache path when both exist', () => {
  const home = mkTmpDir();
  fs.mkdirSync(path.join(home, MARKETPLACE_SKILLS_SUBPATH), { recursive: true });
  fs.mkdirSync(path.join(home, CACHE_SKILLS_SUBPATH), { recursive: true });
  assert.strictEqual(findSkillsDir(home), path.join(home, MARKETPLACE_SKILLS_SUBPATH));
});

test('findSkillsDir falls back to the cache path when only it exists', () => {
  const home = mkTmpDir();
  fs.mkdirSync(path.join(home, CACHE_SKILLS_SUBPATH), { recursive: true });
  assert.strictEqual(findSkillsDir(home), path.join(home, CACHE_SKILLS_SUBPATH));
});

test('findSkillsDir returns null when neither candidate path exists', () => {
  const home = mkTmpDir();
  assert.strictEqual(findSkillsDir(home), null);
});

test('readSkillDescriptions extracts name/description frontmatter from each skill directory', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, MARKETPLACE_SKILLS_SUBPATH);
  writeSkill(skillsDir, 'deal-screening', 'deal-screening', 'Quickly screen inbound deal flow — CIMs, teasers, and broker materials.');
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft a structured investment committee memo for PE deal approval.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result.sort((a, b) => a.skill.localeCompare(b.skill)), [
    { skill: 'deal-screening', description: 'Quickly screen inbound deal flow — CIMs, teasers, and broker materials.' },
    { skill: 'ic-memo', description: 'Draft a structured investment committee memo for PE deal approval.' },
  ]);
});

test('readSkillDescriptions skips directories without a SKILL.md', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, MARKETPLACE_SKILLS_SUBPATH);
  fs.mkdirSync(path.join(skillsDir, 'empty-dir'), { recursive: true });
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft an IC memo.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result, [{ skill: 'ic-memo', description: 'Draft an IC memo.' }]);
});

test('BOUNDED_CONTEXTS assigns all 10 known private-equity skills across exactly 3 contexts', () => {
  assert.strictEqual(BOUNDED_CONTEXTS.length, 3);
  const allSkills = BOUNDED_CONTEXTS.flatMap((c) => c.skills);
  assert.deepStrictEqual(allSkills.sort(), [
    'ai-readiness', 'dd-checklist', 'dd-meeting-prep', 'deal-screening', 'deal-sourcing',
    'ic-memo', 'portfolio-monitoring', 'returns-analysis', 'unit-economics', 'value-creation-plan',
  ].sort());
});

test('buildPack groups skill descriptions under their bounded context in BOUNDED_CONTEXTS order', () => {
  const pack = buildPack([
    { skill: 'returns-analysis', description: 'IRR/MOIC sensitivity tables.' },
    { skill: 'deal-screening', description: 'Screen inbound deal flow.' },
  ]);
  assert.strictEqual(pack.contexts.length, 3);
  assert.strictEqual(pack.contexts[0].name, 'Deal Lifecycle (Sourcing, Screening & Diligence)');
  assert.deepStrictEqual(pack.contexts[0].skills, [{ skill: 'deal-screening', description: 'Screen inbound deal flow.' }]);
  assert.strictEqual(pack.contexts[1].name, 'Investment Decision & Returns');
  assert.deepStrictEqual(pack.contexts[1].skills, [{ skill: 'returns-analysis', description: 'IRR/MOIC sensitivity tables.' }]);
  assert.deepStrictEqual(pack.contexts[2].skills, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-glossary-pack.test.js`
Expected: FAIL — `Cannot find module '.../.claude/scripts/pe-glossary-pack.js'`

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/pe-glossary-pack.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Deterministic evidence extraction for the ubiquitous-language glossary
// (docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md), seeding
// CONTEXT.md with the vocabulary already encoded in the installed
// private-equity vertical plugin's skill descriptions. No NLP, no invented
// terms — just what the plugin already says about itself, grouped under a
// fixed bounded-context table (Fowler's BoundedContext: vocabulary is grouped
// where it actually shifts, not flattened into one enterprise glossary).
//
// Plugins installed via `claude plugin install` live under the user's home
// directory, not this project's own .claude/ — hence the os.homedir() lookup
// rather than a project-relative path.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSkillFrontmatter } = require('./telemetry-skill-helpers');

const ENABLED_PLUGIN_RE = /^private-equity@/;

const MARKETPLACE_SKILLS_SUBPATH = path.join(
  '.claude', 'plugins', 'marketplaces', 'claude-for-financial-services',
  'plugins', 'vertical-plugins', 'private-equity', 'skills'
);
const CACHE_SKILLS_SUBPATH = path.join(
  '.claude', 'plugins', 'cache', 'claude-for-financial-services', 'private-equity', 'skills'
);

const BOUNDED_CONTEXTS = [
  {
    name: 'Deal Lifecycle (Sourcing, Screening & Diligence)',
    skills: ['deal-sourcing', 'deal-screening', 'dd-checklist', 'dd-meeting-prep'],
  },
  {
    name: 'Investment Decision & Returns',
    skills: ['ic-memo', 'returns-analysis'],
  },
  {
    name: 'Portfolio Operations & Value Creation',
    skills: ['portfolio-monitoring', 'value-creation-plan', 'unit-economics', 'ai-readiness'],
  },
];

function isPrivateEquityEnabled(enabledPlugins) {
  return Object.keys(enabledPlugins || {}).some(
    (key) => ENABLED_PLUGIN_RE.test(key) && enabledPlugins[key]
  );
}

function findSkillsDir(homeDir) {
  const candidates = [MARKETPLACE_SKILLS_SUBPATH, CACHE_SKILLS_SUBPATH].map((p) => path.join(homeDir, p));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readSkillDescriptions(skillsDir) {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return null;
      const fm = parseSkillFrontmatter(fs.readFileSync(skillPath, 'utf8'));
      return { skill: fm.name || entry.name, description: fm.description || '' };
    })
    .filter(Boolean);
}

function buildPack(skillDescriptions) {
  const bySkill = new Map(skillDescriptions.map((s) => [s.skill, s]));
  return {
    contexts: BOUNDED_CONTEXTS.map((ctx) => ({
      name: ctx.name,
      skills: ctx.skills.map((id) => bySkill.get(id)).filter(Boolean),
    })),
  };
}

module.exports = {
  isPrivateEquityEnabled, findSkillsDir, readSkillDescriptions, buildPack,
  BOUNDED_CONTEXTS, MARKETPLACE_SKILLS_SUBPATH, CACHE_SKILLS_SUBPATH,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pe-glossary-pack.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/pe-glossary-pack.js test/pe-glossary-pack.test.js
git commit -m "feat: add pe-glossary-pack pure functions for PE vocabulary extraction"
```

---

### Task 2: `pe-glossary-pack.js` CLI wrapper — settings detection, pack write, exit codes

**Files:**
- Modify: `.claude/scripts/pe-glossary-pack.js` (append CLI section below the Task 1 functions)
- Test: `test/pe-glossary-pack.test.js` (append CLI integration tests)

**Interfaces:**
- Consumes: `isPrivateEquityEnabled`, `findSkillsDir`, `readSkillDescriptions`, `buildPack` from Task 1 (same file).
- Produces: CLI behavior — reads `<cwd>/.claude/settings.json`, resolves `os.homedir()`, writes `<cwd>/specs/brd/pe-glossary-pack.json` when applicable. Exit codes: `0` (pack written, or no-op because the plugin isn't enabled), `2` (plugin enabled but no skills directory found).

- [ ] **Step 1: Write the failing test**

Append to `test/pe-glossary-pack.test.js`:

```javascript
const { execFileSync } = require('child_process');

function mkTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pe-glossary-repo-'));
}

function writeSettings(repoDir, enabledPlugins) {
  fs.mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins }, null, 2)
  );
}

function runScript(repoDir, homeDir) {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: repoDir,
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

test('CLI: no-ops with no output file when private-equity is not enabled', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'wealth-management@claude-for-financial-services': true });
  const stdout = runScript(repo, home);
  assert.match(stdout, /not enabled/);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'pe-glossary-pack.json')), false);
});

test('CLI: exits 2 when private-equity is enabled but no skills directory is found', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'private-equity@claude-for-financial-services': true });
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2
  );
});

test('CLI: writes pe-glossary-pack.json when private-equity is enabled and skills exist', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'private-equity@claude-for-financial-services': true });
  const skillsDir = path.join(home, MARKETPLACE_SKILLS_SUBPATH);
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft an IC memo.');
  const stdout = runScript(repo, home);
  assert.match(stdout, /OK/);
  const outPath = path.join(repo, 'specs', 'brd', 'pe-glossary-pack.json');
  assert.strictEqual(fs.existsSync(outPath), true);
  const pack = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(pack.contexts[1].skills[0].skill, 'ic-memo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-glossary-pack.test.js`
Expected: FAIL — the three new CLI tests fail (script has no CLI entry point yet, `main` is never invoked, no such behavior exists)

- [ ] **Step 3: Write the implementation**

In `.claude/scripts/pe-glossary-pack.js`, insert the `main()` function below, placed directly above the existing `module.exports = { ... };` block (i.e. between `buildPack`'s closing `}` and `module.exports`). Leave the existing `module.exports = { ... };` block exactly as Task 1 wrote it — do not add anything to it. Then add one line, `if (require.main === module) main();`, as the very last line of the file, after `module.exports = { ... };`:

```javascript
// --- CLI ----------------------------------------------------------------------

function main() {
  const repoRoot = process.cwd();
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'));
  } catch (err) {
    process.stdout.write('pe-glossary-pack: no .claude/settings.json found — nothing to do.\n');
    process.exit(0);
  }

  if (!isPrivateEquityEnabled(settings.enabledPlugins)) {
    process.stdout.write('pe-glossary-pack: private-equity plugin not enabled — nothing to do.\n');
    process.exit(0);
  }

  const skillsDir = findSkillsDir(os.homedir());
  if (!skillsDir) {
    process.stderr.write(
      'pe-glossary-pack: private-equity plugin is enabled but no skills directory was found ' +
      `under ${os.homedir()}/.claude/plugins — check the plugin install.\n`
    );
    process.exit(2);
  }

  const pack = buildPack(readSkillDescriptions(skillsDir));
  const outDir = path.join(repoRoot, 'specs', 'brd');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'pe-glossary-pack.json');
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');

  const skillCount = pack.contexts.reduce((n, c) => n + c.skills.length, 0);
  process.stdout.write(
    `pe-glossary-pack OK: ${pack.contexts.length} context(s), ${skillCount} skill(s) -> ${outPath}\n`
  );
  process.exit(0);
}
```

Confirm the file ends with, in this order: `module.exports = { ... };` (unchanged from Task 1) followed by `if (require.main === module) main();` as the final line.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pe-glossary-pack.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/pe-glossary-pack.js test/pe-glossary-pack.test.js
git commit -m "feat: add pe-glossary-pack CLI with enabledPlugins gating and exit codes"
```

---

### Task 3: BRD Step 2.7 — seed `CONTEXT.md` from the PE glossary pack

**Files:**
- Modify: `.claude/skills/brd/SKILL.md:227` (insert new step immediately before the existing `### Step 2.8 — Write the BRD Analysis Pack` heading)
- Test: `test/pe-glossary-pack.test.js` (append one wiring assertion test)

**Interfaces:**
- Consumes: `pe-glossary-pack.json` shape from Task 2 (`{ contexts: [{ name, skills: [{ skill, description }] }] }`).
- Produces: no code interface — this is a prose instruction read by the BRD-authoring agent/skill. Downstream consumers (`vocabulary-check.js`, `/spec`, `/design`, `/implement`) already treat `CONTEXT.md`'s `## Terms` `### <Term>` headings as the contract; nothing new to produce there.

- [ ] **Step 1: Write the failing test**

Append to `test/pe-glossary-pack.test.js`:

```javascript
test('brd/SKILL.md documents Step 2.7 seeding CONTEXT.md from pe-glossary-pack.json before Step 2.8', () => {
  const brdSkill = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8'
  );
  const step27Index = brdSkill.indexOf('Step 2.7');
  const step28Index = brdSkill.indexOf('Step 2.8');
  assert.ok(step27Index > -1, 'expected Step 2.7 in brd/SKILL.md');
  assert.ok(step28Index > -1, 'expected Step 2.8 in brd/SKILL.md');
  assert.ok(step27Index < step28Index, 'Step 2.7 must precede Step 2.8');
  assert.match(brdSkill, /pe-glossary-pack\.js/);
  assert.match(brdSkill, /pe-glossary-pack\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-glossary-pack.test.js`
Expected: FAIL — `brd/SKILL.md` has no `Step 2.7` yet

- [ ] **Step 3: Write the implementation**

In `.claude/skills/brd/SKILL.md`, insert this new section immediately before the `### Step 2.8 — Write the BRD Analysis Pack` heading (the line currently reading `Confirm: "Here is the UI context I have captured: [summary]. Is this complete?"` followed by `---` stays as-is; insert after that `---` and before the `### Step 2.8` line):

```markdown
### Step 2.7 — Seed PE Domain Vocabulary (private-equity projects only)

Run `node .claude/scripts/pe-glossary-pack.js`. This is a no-op (nothing written, nothing to do here) unless the `private-equity` vertical plugin is enabled in `.claude/settings.json#enabledPlugins`.

- If `specs/brd/pe-glossary-pack.json` now exists, read it. For each context entry, distill the real domain nouns implied by each skill's description (e.g. `deal-screening` → CIM, teaser, IOI; `returns-analysis` → IRR, MOIC; `value-creation-plan` → EBITDA bridge, 100-day plan) into `CONTEXT.md`'s `## Terms` section (create `CONTEXT.md` from `.claude/templates/context.template.md` first if it does not exist yet). Use the context's `name` as a `### <Bounded Context Name>` grouping heading, with individual `### <Term>` entries and a one-line definition beneath each.
- If the script exited 2 (plugin enabled but no skills directory found), note the broken plugin install in the progress log and continue — do not block the BRD on it.
- If `specs/brd/pe-glossary-pack.json` does not exist and the script did not report an error, the plugin simply isn't enabled for this project — do nothing further.

Step 2.8 below still runs afterward for every project and merges `domain_concepts`-derived terms into the same `CONTEXT.md`, layering project-specific concepts on top of this PE baseline rather than overwriting it.

---

```

(The heading `### Step 2.8 — Write the BRD Analysis Pack` follows immediately after this new block, unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pe-glossary-pack.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/brd/SKILL.md test/pe-glossary-pack.test.js
git commit -m "feat: seed CONTEXT.md with PE vocabulary at BRD Step 2.7"
```

---

### Task 4: `pe-ic-memo` reads `CONTEXT.md`

**Files:**
- Modify: `.claude/skills/pe-ic-memo/SKILL.md:22` (end of the Step 1 "Gather Inputs" bullet list, before the blank line and `### Step 2` heading)
- Modify: `test/pe-ic-memo-skill.test.js` (append one assertion)

**Interfaces:**
- Consumes: `CONTEXT.md`'s `## Terms` / `### <Term>` structure (already defined; no schema change).
- Produces: no code interface — prose instruction only, mirroring `.claude/skills/spec/SKILL.md:44`'s existing wording.

- [ ] **Step 1: Write the failing test**

Append to `test/pe-ic-memo-skill.test.js`:

```javascript
test('pe-ic-memo SKILL.md reads CONTEXT.md and reuses its terms verbatim', () => {
  const skill = read('.claude/skills/pe-ic-memo/SKILL.md');
  assert.match(skill, /Read `CONTEXT\.md`/);
  assert.match(skill, /verbatim/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-ic-memo-skill.test.js`
Expected: FAIL — no `CONTEXT.md` mention in `pe-ic-memo/SKILL.md` yet

- [ ] **Step 3: Write the implementation**

In `.claude/skills/pe-ic-memo/SKILL.md`, add this line as the last bullet under `### Step 1: Gather Inputs` (after `- Returns analysis (base, upside, downside)`, before the blank line that precedes `### Step 2: Structure the Memo`):

```markdown
- Read `CONTEXT.md` if present. Use its terms verbatim in section headings and bullets below — do not introduce a new name for a concept `CONTEXT.md` already defines.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pe-ic-memo-skill.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/pe-ic-memo/SKILL.md test/pe-ic-memo-skill.test.js
git commit -m "feat: wire pe-ic-memo to reuse CONTEXT.md glossary terms"
```

---

### Task 5: Harness manifest and HARNESS.md — document the PE-seeded origin

**Files:**
- Modify: `harness-manifest.json` (the `vocabulary-check` sensor entry's `description` field)
- Modify: `HARNESS.md:75` (traceability row)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — documentation-only edit to an existing entry. `id`, `wired_at`, `axis`, `type`, `cadence`, `status`, `scope`, and `signal` fields are unchanged.

- [ ] **Step 1: Confirm the existing manifest test still passes before editing (baseline)**

Run: `node --test test/harness-manifest.test.js`
Expected: PASS (baseline, before this task's edit)

- [ ] **Step 2: Edit the manifest description**

In `harness-manifest.json`, find the `vocabulary-check` entry and change its `description` field from:

```
"Deterministic vocabulary-consistency sensor: extends the traceability axis from ID-linkage (trace-check) to term-linkage. Catches 'Account in the BRD, User in the API contract' before code is written."
```

to:

```
"Deterministic vocabulary-consistency sensor: extends the traceability axis from ID-linkage (trace-check) to term-linkage. Catches 'Account in the BRD, User in the API contract' before code is written. CONTEXT.md terms may originate from domain_concepts (Step 2.8) or, for private-equity projects, from pe-glossary-pack.js (Step 2.7) — vocabulary-check.js validates either origin identically."
```

- [ ] **Step 3: Edit `HARNESS.md`'s traceability row**

In `HARNESS.md`, in the traceability row (the line containing `✅ \`vocabulary-check\` (entity/model names vs CONTEXT.md glossary terms)`), change that clause from:

```
✅ `vocabulary-check` (entity/model names vs CONTEXT.md glossary terms)
```

to:

```
✅ `vocabulary-check` (entity/model names vs CONTEXT.md glossary terms, PE-seeded via pe-glossary-pack.js for private-equity projects)
```

- [ ] **Step 4: Validate the manifest and run the full suite**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exits 0, no schema errors

Run: `node --test test/harness-manifest.test.js`
Expected: PASS (description text is not asserted verbatim by this test, only `id`/`wired_at`/presence — confirms the edit didn't break it)

- [ ] **Step 5: Commit**

```bash
git add harness-manifest.json HARNESS.md
git commit -m "docs: note PE-seeded CONTEXT.md origin in vocabulary-check manifest entry"
```

---

### Task 6: Full-suite verification

**Files:** none created or modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-5

- [ ] **Step 2: Run the new script directly against this machine's real installed plugin (manual smoke check)**

Run: `node .claude/scripts/pe-glossary-pack.js`
Expected: since this project's own `.claude/settings.json#enabledPlugins` has no `private-equity@...` key, output is `pe-glossary-pack: private-equity plugin not enabled — nothing to do.` and no `specs/brd/pe-glossary-pack.json` is written — confirms the no-op path is safe to run in this repo as-is.

- [ ] **Step 3: Commit any final cleanup (only if Step 1 or 2 surfaced something to fix)**

If all tests passed and the manual check matched expectations, there is nothing to commit here — Tasks 1-5 already committed everything.
