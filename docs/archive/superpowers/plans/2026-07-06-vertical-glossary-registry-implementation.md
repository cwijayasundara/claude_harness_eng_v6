# Vertical-Glossary Registry Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the private-equity-only `pe-glossary-pack.js` with a generic, registry-driven `vertical-glossary-pack.js` engine, so adding a new domain vertical to the ubiquitous-language glossary mechanism is a config entry, not a new script.

**Architecture:** A new declarative registry `.claude/config/vertical-glossary-packs.json` holds one entry per vertical (plugin id, `enabledPlugins` match prefix, marketplace/cache skills subpaths, bounded-context table, and install metadata). A new `.claude/scripts/vertical-glossary-pack.js` reads the registry and, for every entry whose plugin key is enabled, writes `specs/brd/<plugin>-glossary-pack.json` — same pure-core/CLI-wrapper shape as today's `pe-glossary-pack.js`, generalized to loop over registry entries instead of hardcoding one plugin's constants. BRD Step 2.7 is reworded to describe "any enabled vertical with a registered pack config" instead of "private-equity projects only." The private-equity entry migrates into the registry verbatim — no behavior change for existing private-equity projects.

**Tech Stack:** Node.js (`node:test`, `node:assert`, `fs`, `path`, `os`), matching the existing `.claude/scripts/*.js` deterministic-sensor pattern.

## Global Constraints

- No new runtime dependencies — plain Node.js `fs`/`path`/`os`, matching every existing `.claude/scripts/*.js` sensor.
- The private-equity registry entry's values (`enabled_plugin_prefix`, both skills subpaths, the 3-entry bounded-context table) must migrate **verbatim** from today's `pe-glossary-pack.js` constants — no behavior change for existing private-equity projects.
- Every entry must degrade loudly: exit 2 (not silent no-op, not a false "OK") when its plugin is enabled but its skills directory is missing OR exists-but-empty (zero skill descriptions found) — this is the fail-loud behavior `pe-glossary-pack.js` already has and must be preserved per-entry in the generic engine.
- A broken/empty entry must not prevent OTHER, successfully-resolved entries from writing their packs — the script processes every matched registry entry independently.
- `vocabulary-check.js`, `design/SKILL.md`, `implement/SKILL.md`, `generator.md`, and `pe-ic-memo/SKILL.md` require **no changes** — they already treat `CONTEXT.md` as the single glossary source regardless of a term's origin file.
- Output filename changes from `pe-glossary-pack.json` to `private-equity-glossary-pack.json` (one-time, deliberate rename — no external consumers of the old filename exist to break).

---

### Task 1: Registry file + pure functions — multi-entry plugin detection, skills lookup, pack building

**Files:**
- Create: `.claude/config/vertical-glossary-packs.json`
- Create: `.claude/scripts/vertical-glossary-pack.js`
- Test: `test/vertical-glossary-pack.test.js`

**Interfaces:**
- Consumes: `parseSkillFrontmatter(raw: string): { name?: string, description?: string, ... }` from `.claude/scripts/telemetry-skill-helpers.js` (existing, exported, unchanged).
- Produces (for Task 2 and the test suite):
  - `loadRegistry(registryPath: string): { packs: Array<RegistryEntry> }` — `RegistryEntry = { plugin: string, enabled_plugin_prefix: string, marketplace: string, install_id: string, marketplace_skills_subpath: string, cache_skills_subpath: string, bounded_contexts: Array<{ name: string, skills: string[] }> }`
  - `isPluginEnabled(enabledPlugins: object|undefined, prefix: string): boolean`
  - `findSkillsDir(homeDir: string, entry: RegistryEntry): string|null`
  - `readSkillDescriptions(skillsDir: string): Array<{ skill: string, description: string }>`
  - `buildPack(skillDescriptions: Array<{ skill: string, description: string }>, entry: RegistryEntry): { contexts: Array<{ name: string, skills: Array<{ skill: string, description: string }> }> }`

- [ ] **Step 1: Write the failing test**

Create `test/vertical-glossary-pack.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'vertical-glossary-pack.js');
const {
  loadRegistry, isPluginEnabled, findSkillsDir, readSkillDescriptions, buildPack,
} = require(SCRIPT);

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'config', 'vertical-glossary-packs.json');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertical-glossary-'));
}

function writeSkill(skillsDir, dirName, frontmatterName, description) {
  const dir = path.join(skillsDir, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\n# ${frontmatterName}\n`
  );
}

test('loadRegistry reads the real committed registry and finds the private-equity entry', () => {
  const registry = loadRegistry(REGISTRY_PATH);
  assert.ok(Array.isArray(registry.packs));
  const pe = registry.packs.find((p) => p.plugin === 'private-equity');
  assert.ok(pe, 'expected a private-equity entry in the registry');
  assert.strictEqual(pe.enabled_plugin_prefix, 'private-equity@');
  assert.strictEqual(pe.marketplace, 'claude-for-financial-services');
  assert.strictEqual(pe.install_id, 'private-equity@claude-for-financial-services');
  assert.strictEqual(pe.bounded_contexts.length, 3);
  const allSkills = pe.bounded_contexts.flatMap((c) => c.skills);
  assert.deepStrictEqual(allSkills.sort(), [
    'ai-readiness', 'dd-checklist', 'dd-meeting-prep', 'deal-screening', 'deal-sourcing',
    'ic-memo', 'portfolio-monitoring', 'returns-analysis', 'unit-economics', 'value-creation-plan',
  ].sort());
});

test('isPluginEnabled matches a prefixed key with a truthy value', () => {
  assert.strictEqual(isPluginEnabled({ 'private-equity@claude-for-financial-services': true }, 'private-equity@'), true);
  assert.strictEqual(isPluginEnabled({ 'private-equity@claude-for-financial-services': false }, 'private-equity@'), false);
  assert.strictEqual(isPluginEnabled({ 'wealth-management@claude-for-financial-services': true }, 'private-equity@'), false);
  assert.strictEqual(isPluginEnabled(undefined, 'private-equity@'), false);
  assert.strictEqual(isPluginEnabled({}, 'private-equity@'), false);
});

test('findSkillsDir prefers the marketplace path over the cache path when both exist', () => {
  const home = mkTmpDir();
  const entry = {
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-mp', 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-mp', 'skills'),
  };
  fs.mkdirSync(path.join(home, entry.marketplace_skills_subpath), { recursive: true });
  fs.mkdirSync(path.join(home, entry.cache_skills_subpath), { recursive: true });
  assert.strictEqual(findSkillsDir(home, entry), path.join(home, entry.marketplace_skills_subpath));
});

test('findSkillsDir falls back to the cache path when only it exists', () => {
  const home = mkTmpDir();
  const entry = {
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-mp', 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-mp', 'skills'),
  };
  fs.mkdirSync(path.join(home, entry.cache_skills_subpath), { recursive: true });
  assert.strictEqual(findSkillsDir(home, entry), path.join(home, entry.cache_skills_subpath));
});

test('findSkillsDir returns null when neither candidate path exists', () => {
  const home = mkTmpDir();
  const entry = {
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-mp', 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-mp', 'skills'),
  };
  assert.strictEqual(findSkillsDir(home, entry), null);
});

test('readSkillDescriptions extracts name/description frontmatter from each skill directory', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, 'skills');
  writeSkill(skillsDir, 'deal-screening', 'deal-screening', 'Quickly screen inbound deal flow.');
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft a structured investment committee memo.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result.sort((a, b) => a.skill.localeCompare(b.skill)), [
    { skill: 'deal-screening', description: 'Quickly screen inbound deal flow.' },
    { skill: 'ic-memo', description: 'Draft a structured investment committee memo.' },
  ]);
});

test('readSkillDescriptions skips directories without a SKILL.md', () => {
  const home = mkTmpDir();
  const skillsDir = path.join(home, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'empty-dir'), { recursive: true });
  writeSkill(skillsDir, 'ic-memo', 'ic-memo', 'Draft an IC memo.');
  const result = readSkillDescriptions(skillsDir);
  assert.deepStrictEqual(result, [{ skill: 'ic-memo', description: 'Draft an IC memo.' }]);
});

test('buildPack groups skill descriptions under the entry bounded contexts, in order', () => {
  const entry = {
    bounded_contexts: [
      { name: 'Context A', skills: ['skill-1'] },
      { name: 'Context B', skills: ['skill-2'] },
    ],
  };
  const pack = buildPack([
    { skill: 'skill-2', description: 'Second.' },
    { skill: 'skill-1', description: 'First.' },
  ], entry);
  assert.strictEqual(pack.contexts.length, 2);
  assert.strictEqual(pack.contexts[0].name, 'Context A');
  assert.deepStrictEqual(pack.contexts[0].skills, [{ skill: 'skill-1', description: 'First.' }]);
  assert.strictEqual(pack.contexts[1].name, 'Context B');
  assert.deepStrictEqual(pack.contexts[1].skills, [{ skill: 'skill-2', description: 'Second.' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/vertical-glossary-pack.test.js`
Expected: FAIL — `Cannot find module '.../.claude/scripts/vertical-glossary-pack.js'` (and the registry file doesn't exist yet either)

- [ ] **Step 3: Create the registry file**

Create `.claude/config/vertical-glossary-packs.json`:

```json
{
  "packs": [
    {
      "plugin": "private-equity",
      "enabled_plugin_prefix": "private-equity@",
      "marketplace": "claude-for-financial-services",
      "install_id": "private-equity@claude-for-financial-services",
      "marketplace_skills_subpath": ".claude/plugins/marketplaces/claude-for-financial-services/plugins/vertical-plugins/private-equity/skills",
      "cache_skills_subpath": ".claude/plugins/cache/claude-for-financial-services/private-equity/skills",
      "bounded_contexts": [
        {
          "name": "Deal Lifecycle (Sourcing, Screening & Diligence)",
          "skills": ["deal-sourcing", "deal-screening", "dd-checklist", "dd-meeting-prep"]
        },
        {
          "name": "Investment Decision & Returns",
          "skills": ["ic-memo", "returns-analysis"]
        },
        {
          "name": "Portfolio Operations & Value Creation",
          "skills": ["portfolio-monitoring", "value-creation-plan", "unit-economics", "ai-readiness"]
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Write the implementation**

Create `.claude/scripts/vertical-glossary-pack.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Deterministic evidence extraction for the ubiquitous-language glossary
// (docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md), generalized
// from the private-equity-only pe-glossary-pack.js (2026-07-06) into a
// registry-driven engine: any vertical plugin registered in
// .claude/config/vertical-glossary-packs.json is a config entry, not a new
// script. No NLP, no invented terms — just what each plugin already says
// about itself in its skill descriptions, grouped under that entry's fixed
// bounded-context table.
//
// Plugins installed via `claude plugin install` live under the user's home
// directory, not this project's own .claude/ — hence the os.homedir() lookup
// rather than a project-relative path.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSkillFrontmatter } = require('./telemetry-skill-helpers');

function loadRegistry(registryPath) {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function isPluginEnabled(enabledPlugins, prefix) {
  return Object.keys(enabledPlugins || {}).some(
    (key) => key.startsWith(prefix) && enabledPlugins[key]
  );
}

function findSkillsDir(homeDir, entry) {
  const candidates = [entry.marketplace_skills_subpath, entry.cache_skills_subpath].map((p) => path.join(homeDir, p));
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readSkillDescriptions(skillsDir) {
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((dirEntry) => dirEntry.isDirectory())
    .map((dirEntry) => {
      const skillPath = path.join(skillsDir, dirEntry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return null;
      const fm = parseSkillFrontmatter(fs.readFileSync(skillPath, 'utf8'));
      return { skill: fm.name || dirEntry.name, description: fm.description || '' };
    })
    .filter(Boolean);
}

function buildPack(skillDescriptions, entry) {
  const bySkill = new Map(skillDescriptions.map((s) => [s.skill, s]));
  return {
    contexts: entry.bounded_contexts.map((ctx) => ({
      name: ctx.name,
      skills: ctx.skills.map((id) => bySkill.get(id)).filter(Boolean),
    })),
  };
}

module.exports = { loadRegistry, isPluginEnabled, findSkillsDir, readSkillDescriptions, buildPack };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/vertical-glossary-pack.test.js`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add .claude/config/vertical-glossary-packs.json .claude/scripts/vertical-glossary-pack.js test/vertical-glossary-pack.test.js
git commit -m "feat: add vertical-glossary-pack registry and pure functions"
```

---

### Task 2: CLI wrapper — process every matched registry entry, per-entry fail-loud exit codes

**Files:**
- Modify: `.claude/scripts/vertical-glossary-pack.js` (append CLI section)
- Test: `test/vertical-glossary-pack.test.js` (append CLI integration tests)

**Interfaces:**
- Consumes: `loadRegistry`, `isPluginEnabled`, `findSkillsDir`, `readSkillDescriptions`, `buildPack` from Task 1 (same file).
- Produces: CLI behavior — reads `<cwd>/.claude/settings.json` and `<cwd>/.claude/config/vertical-glossary-packs.json`, resolves `os.homedir()`, writes `<cwd>/specs/brd/<plugin>-glossary-pack.json` per matched, non-empty entry. Exit codes: `0` if every matched entry resolved successfully (or nothing matched at all), `2` if ANY matched entry's skills directory is missing or empty (after still writing packs for every OTHER entry that resolved fine).

- [ ] **Step 1: Write the failing test**

Append to `test/vertical-glossary-pack.test.js`:

```javascript
const { execFileSync } = require('child_process');

function mkTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vertical-glossary-repo-'));
}

function writeSettings(repoDir, enabledPlugins) {
  fs.mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins }, null, 2)
  );
}

function writeRepoRegistry(repoDir, packs) {
  fs.mkdirSync(path.join(repoDir, '.claude', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'config', 'vertical-glossary-packs.json'),
    JSON.stringify({ packs }, null, 2)
  );
}

function runScript(repoDir, homeDir) {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: repoDir,
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

function testEntry(name) {
  return {
    plugin: name,
    enabled_plugin_prefix: `${name}@`,
    marketplace: 'test-marketplace',
    install_id: `${name}@test-marketplace`,
    marketplace_skills_subpath: path.join('.claude', 'plugins', 'marketplaces', 'test-marketplace', 'plugins', name, 'skills'),
    cache_skills_subpath: path.join('.claude', 'plugins', 'cache', 'test-marketplace', name, 'skills'),
    bounded_contexts: [{ name: 'Everything', skills: ['a-skill'] }],
  };
}

test('CLI: no-ops with no output files when no registry entry is enabled', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'wealth-management@claude-for-financial-services': true });
  writeRepoRegistry(repo, [testEntry('vertical-a')]);
  const stdout = runScript(repo, home);
  assert.match(stdout, /no vertical glossary packs enabled/);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'vertical-a-glossary-pack.json')), false);
});

test('CLI: exits 2 when an enabled entry has no skills directory', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  writeSettings(repo, { 'vertical-a@test-marketplace': true });
  writeRepoRegistry(repo, [testEntry('vertical-a')]);
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2
  );
});

test('CLI: exits 2 when an enabled entry has an empty skills directory', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  const entry = testEntry('vertical-a');
  writeSettings(repo, { 'vertical-a@test-marketplace': true });
  writeRepoRegistry(repo, [entry]);
  fs.mkdirSync(path.join(home, entry.marketplace_skills_subpath), { recursive: true });
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2 && /no skill descriptions were found/.test(err.stderr.toString())
  );
});

test('CLI: writes a pack per enabled entry and still writes the healthy one when another entry is broken', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  const healthy = testEntry('vertical-a');
  const broken = testEntry('vertical-b');
  writeSettings(repo, { 'vertical-a@test-marketplace': true, 'vertical-b@test-marketplace': true });
  writeRepoRegistry(repo, [healthy, broken]);
  const skillsDir = path.join(home, healthy.marketplace_skills_subpath);
  writeSkill(skillsDir, 'a-skill', 'a-skill', 'Does a thing.');
  // broken entry's skills dir intentionally left absent
  assert.throws(
    () => runScript(repo, home),
    (err) => err.status === 2
  );
  const healthyOut = path.join(repo, 'specs', 'brd', 'vertical-a-glossary-pack.json');
  assert.strictEqual(fs.existsSync(healthyOut), true, 'the healthy entry must still write its pack');
  const pack = JSON.parse(fs.readFileSync(healthyOut, 'utf8'));
  assert.strictEqual(pack.contexts[0].skills[0].skill, 'a-skill');
});

test('CLI: writes private-equity-glossary-pack.json (not pe-glossary-pack.json) for the private-equity entry', () => {
  const repo = mkTmpRepo();
  const home = mkTmpDir();
  const entry = testEntry('private-equity');
  entry.enabled_plugin_prefix = 'private-equity@';
  writeSettings(repo, { 'private-equity@test-marketplace': true });
  writeRepoRegistry(repo, [entry]);
  const skillsDir = path.join(home, entry.marketplace_skills_subpath);
  writeSkill(skillsDir, 'a-skill', 'a-skill', 'Does a thing.');
  runScript(repo, home);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'private-equity-glossary-pack.json')), true);
  assert.strictEqual(fs.existsSync(path.join(repo, 'specs', 'brd', 'pe-glossary-pack.json')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/vertical-glossary-pack.test.js`
Expected: FAIL — the 5 new CLI tests fail (no CLI entry point exists yet)

- [ ] **Step 3: Write the implementation**

Append to `.claude/scripts/vertical-glossary-pack.js` (insert `main()` and its helpers directly above the existing `module.exports` line — leave that `module.exports` block exactly as Task 1 wrote it):

```javascript
// --- CLI ----------------------------------------------------------------------

function loadSettings(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'));
  } catch (err) {
    return { enabledPlugins: {} };
  }
}

function loadRepoRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, '.claude', 'config', 'vertical-glossary-packs.json');
  if (!fs.existsSync(registryPath)) return { packs: [] };
  return loadRegistry(registryPath);
}

function processEntry(entry, repoRoot) {
  const skillsDir = findSkillsDir(os.homedir(), entry);
  if (!skillsDir) {
    process.stderr.write(
      `vertical-glossary-pack: ${entry.plugin} is enabled but no skills directory was found ` +
      `under ${os.homedir()}/.claude/plugins — check the plugin install.\n`
    );
    return { ok: false };
  }
  const pack = buildPack(readSkillDescriptions(skillsDir), entry);
  const skillCount = pack.contexts.reduce((n, c) => n + c.skills.length, 0);
  if (skillCount === 0) {
    process.stderr.write(
      `vertical-glossary-pack: ${entry.plugin} is enabled and a skills directory exists, ` +
      'but no skill descriptions were found — check the plugin install.\n'
    );
    return { ok: false };
  }
  const outDir = path.join(repoRoot, 'specs', 'brd');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${entry.plugin}-glossary-pack.json`);
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');
  process.stdout.write(
    `vertical-glossary-pack: ${entry.plugin} OK: ${pack.contexts.length} context(s), ${skillCount} skill(s) -> ${outPath}\n`
  );
  return { ok: true };
}

function main() {
  const repoRoot = process.cwd();
  const settings = loadSettings(repoRoot);
  const registry = loadRepoRegistry(repoRoot);
  const matched = registry.packs.filter((entry) => isPluginEnabled(settings.enabledPlugins, entry.enabled_plugin_prefix));
  if (matched.length === 0) {
    process.stdout.write('vertical-glossary-pack: no vertical glossary packs enabled — nothing to do.\n');
    process.exit(0);
  }
  const results = matched.map((entry) => processEntry(entry, repoRoot));
  process.exit(results.every((r) => r.ok) ? 0 : 2);
}
```

Then confirm the file ends, in this order: the existing `module.exports = { ... };` block (unchanged from Task 1), followed by `if (require.main === module) main();` as the final line.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/vertical-glossary-pack.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/vertical-glossary-pack.js test/vertical-glossary-pack.test.js
git commit -m "feat: add vertical-glossary-pack CLI processing every matched registry entry"
```

---

### Task 3: BRD Step 2.7 — generalize wording from private-equity-only to any registered vertical

**Files:**
- Modify: `.claude/skills/brd/SKILL.md` (the existing `### Step 2.7` section, currently reading "Seed PE Domain Vocabulary (private-equity projects only)")
- Test: `test/vertical-glossary-pack.test.js` (append one wiring assertion; remove the now-stale pe-glossary-pack-specific wiring assertion from `test/pe-glossary-pack.test.js` in Task 5)

**Interfaces:**
- Consumes: `<plugin>-glossary-pack.json` shape from Task 2 (`{ contexts: [{ name, skills: [{ skill, description }] }] }`), for any registry entry, not just private-equity.
- Produces: no code interface — prose instruction read by the BRD-authoring flow.

- [ ] **Step 1: Write the failing test**

Append to `test/vertical-glossary-pack.test.js`:

```javascript
test('brd/SKILL.md Step 2.7 is generalized to any registered vertical, not private-equity-only', () => {
  const brdSkill = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'brd', 'SKILL.md'), 'utf8'
  );
  const step27Index = brdSkill.indexOf('### Step 2.7');
  const step28Index = brdSkill.indexOf('### Step 2.8');
  assert.ok(step27Index > -1, 'expected Step 2.7 in brd/SKILL.md');
  assert.ok(step28Index > -1, 'expected Step 2.8 in brd/SKILL.md');
  assert.ok(step27Index < step28Index, 'Step 2.7 must precede Step 2.8');
  assert.match(brdSkill, /vertical-glossary-pack\.js/);
  assert.match(brdSkill, /vertical-glossary-packs\.json/);
  assert.doesNotMatch(brdSkill, /private-equity projects only/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/vertical-glossary-pack.test.js`
Expected: FAIL — `brd/SKILL.md` still names `pe-glossary-pack.js` and says "private-equity projects only"

- [ ] **Step 3: Write the implementation**

In `.claude/skills/brd/SKILL.md`, replace the entire existing `### Step 2.7` section (from the `### Step 2.7 — Seed PE Domain Vocabulary (private-equity projects only)` heading through the `**Layering with Step 2.8.**` paragraph that precedes the `### Step 2.8` heading) with:

```markdown
### Step 2.7 — Seed Domain Vocabulary from Enabled Vertical Plugins

**Run the vertical glossary pack script.** Run `node .claude/scripts/vertical-glossary-pack.js`. This is a no-op (nothing written, nothing to do here) unless `.claude/config/vertical-glossary-packs.json` has at least one entry whose `enabled_plugin_prefix` matches a truthy key in `.claude/settings.json#enabledPlugins`.

- **Pack(s) written.** For each `specs/brd/<plugin>-glossary-pack.json` the script wrote, read it. For each context entry, distill the real domain nouns implied by each skill's description into `CONTEXT.md`'s `## Terms` section (create `CONTEXT.md` from `.claude/templates/context.template.md` first if it does not exist yet). Use the context's `name` as a **`<Bounded Context Name>`** bold grouping line (not a `###` heading — `vocabulary-check.js` parses every `###` under `## Terms` as a glossary term, so only actual terms may use that heading level), with individual `### <Term>` entries and a one-line definition beneath each.
- **Broken plugin install.** If the script exited 2, at least one enabled vertical's skills directory was missing or empty. Note the broken plugin install(s) in the progress log and continue — packs from any OTHER, successfully-resolved vertical were still written and should still be distilled per the bullet above. Do not block the BRD on a broken install.
- **No verticals enabled.** If the script reported nothing enabled and wrote no pack files, no registered vertical plugin is active for this project — do nothing further.

**Layering with Step 2.8.** Step 2.8 below still runs afterward for every project and merges `domain_concepts`-derived terms into the same `CONTEXT.md`, layering project-specific concepts on top of any vertical baseline(s) rather than overwriting them.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/vertical-glossary-pack.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/brd/SKILL.md test/vertical-glossary-pack.test.js
git commit -m "feat: generalize BRD Step 2.7 to any registered vertical plugin"
```

---

### Task 4: Harness manifest and HARNESS.md — update vocabulary-check description to name the generalized script

**Files:**
- Modify: `harness-manifest.json` (the `vocabulary-check` sensor entry's `description` field)
- Modify: `HARNESS.md` (traceability row)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — documentation-only edit to an existing entry. `id`, `wired_at`, `axis`, `type`, `cadence`, `status`, `scope`, `signal` fields are unchanged.

- [ ] **Step 1: Confirm the existing manifest test still passes before editing (baseline)**

Run: `node --test test/harness-manifest.test.js`
Expected: PASS (baseline, before this task's edit)

- [ ] **Step 2: Edit the manifest description**

In `harness-manifest.json`, find the `vocabulary-check` entry (currently: `"description": "Deterministic vocabulary-consistency sensor: extends the traceability axis from ID-linkage (trace-check) to term-linkage. Catches 'Account in the BRD, User in the API contract' before code is written. CONTEXT.md terms may originate from domain_concepts (Step 2.8) or, for private-equity projects, from pe-glossary-pack.js (Step 2.7) — vocabulary-check.js validates either origin identically."`) and change the last sentence from:

```
CONTEXT.md terms may originate from domain_concepts (Step 2.8) or, for private-equity projects, from pe-glossary-pack.js (Step 2.7) — vocabulary-check.js validates either origin identically.
```

to:

```
CONTEXT.md terms may originate from domain_concepts (Step 2.8) or, for any enabled vertical plugin registered in vertical-glossary-packs.json, from vertical-glossary-pack.js (Step 2.7) — vocabulary-check.js validates either origin identically.
```

- [ ] **Step 3: Edit `HARNESS.md`'s traceability row**

In `HARNESS.md`, change the `vocabulary-check` clause from:

```
✅ `vocabulary-check` (entity/model names vs CONTEXT.md glossary terms, PE-seeded via pe-glossary-pack.js for private-equity projects)
```

to:

```
✅ `vocabulary-check` (entity/model names vs CONTEXT.md glossary terms, vertical-seeded via vertical-glossary-pack.js for any registered vertical plugin)
```

- [ ] **Step 4: Validate the manifest and run the full suite**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exits 0, no schema errors

Run: `node --test test/harness-manifest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add harness-manifest.json HARNESS.md
git commit -m "docs: generalize vocabulary-check manifest description to vertical-glossary-pack.js"
```

---

### Task 5: Retire `pe-glossary-pack.js` and its test file

**Files:**
- Delete: `.claude/scripts/pe-glossary-pack.js`
- Delete: `test/pe-glossary-pack.test.js`

**Interfaces:**
- Consumes: confirmation from Tasks 1-4 that `vertical-glossary-pack.js` covers every behavior `pe-glossary-pack.js` had (bounded-context grouping, exit codes, no-op path, fail-loud-on-empty-pack, BRD wiring) — do not delete until that's true.
- Produces: nothing — this task only removes now-superseded files.

- [ ] **Step 1: Confirm no remaining references to the old script or test file**

Run: `grep -rn "pe-glossary-pack" --include="*.js" --include="*.md" --include="*.json" . | grep -v node_modules`
Expected: no matches (Task 3 already removed the `brd/SKILL.md` reference; Task 4 already removed the `harness-manifest.json`/`HARNESS.md` references)

If this command finds any remaining reference, stop and update that file before proceeding — do not delete the old script while something still points at it.

- [ ] **Step 2: Delete the superseded files**

```bash
git rm .claude/scripts/pe-glossary-pack.js test/pe-glossary-pack.test.js
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass (no references to the deleted files remain in any other test)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove pe-glossary-pack.js, superseded by vertical-glossary-pack.js"
```

---

### Task 6: Full-suite verification

**Files:** none created or modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-4 and the removals in Task 5

- [ ] **Step 2: Manual smoke check against this repo's real state**

Run: `node .claude/scripts/vertical-glossary-pack.js`
Expected: since this project's own `.claude/settings.json#enabledPlugins` has no `private-equity@...` key, output is `vertical-glossary-pack: no vertical glossary packs enabled — nothing to do.` and no `specs/brd/*-glossary-pack.json` is written.

- [ ] **Step 3: Commit any final cleanup (only if Step 1 or 2 surfaced something to fix)**

If all tests passed and the manual check matched expectations, there is nothing to commit here — Tasks 1-5 already committed everything.
