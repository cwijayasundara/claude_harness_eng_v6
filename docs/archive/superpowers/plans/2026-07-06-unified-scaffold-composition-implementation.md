# Unified Scaffold Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on:** `docs/superpowers/plans/2026-07-06-vertical-glossary-registry-implementation.md` (Plan A — must be merged first; this plan reads `.claude/config/vertical-glossary-packs.json` and reuses `vertical-glossary-pack.js`'s `isPluginEnabled`/`loadRegistry`) and `docs/superpowers/plans/2026-07-06-tech-stack-specialty-pack-implementation.md` (Plan B — must be merged first; this plan reads `.claude/config/framework-skill-packs.json`). Do not start this plan until both are merged to `main`.

**Goal:** Let one `/scaffold` run ask for both a tech-stack pack and a domain vertical together, record both choices in `project-manifest.json`, and print one combined pending-actions report covering both external-tech-pack installs (`npx skills add`) and domain-vertical-plugin installs (`claude plugin install`) — closing the "Python + FastAPI + LangChain/LangGraph/DeepAgents senior engineer with private-equity domain skills in one `/scaffold` run" scenario.

**Architecture:** `scaffold-render.js`'s `buildManifest` gains a second optional manifest field (`domain_vertical_packs`, from `profile.domainVerticalPacks`) mirroring the existing `framework_skill_packs`/`profile.frameworkPacks` pattern exactly. A new deterministic script, `.claude/scripts/scaffold-vertical-status.js`, reuses Plan A's `vertical-glossary-pack.js` exports (`loadRegistry`, `isPluginEnabled`) to report each registry entry's install status against `.claude/settings.json#enabledPlugins`, printing the exact `claude plugin marketplace add`/`claude plugin install` commands for anything not yet enabled — this lives in `/scaffold`'s own reporting, not merged into `install-framework-packs` (that skill's identity stays scoped to `npx skills add`-installed tech packs only, per the design's explicit decision). `.claude/commands/scaffold.md`'s existing "Optional Agent-Framework Skill Packs" section is extended (not replaced) to also ask about domain verticals and to print the combined report.

**Tech Stack:** Node.js (`node:test`, `fs`, `path`) for the new status script and manifest field; Markdown for the `/scaffold` command flow changes.

## Global Constraints

- The domain-vertical question and reporting is an **addition** to `/scaffold`'s existing tech-stack-pack flow, not a replacement — every existing behavior (the framework-pack question, its manual-install block, `framework_skill_packs` recording) must be unchanged.
- The combined pending-actions report covers two genuinely different command families and must keep them visually distinct: `npx skills add <repo>` for external tech packs vs. `claude plugin marketplace add <marketplace>` + `claude plugin install <install_id>` for domain verticals. Do not merge these into one generic "run this command" block that obscures which family a given line belongs to.
- Local tech-stack packs (`"source":"local"` in `framework-skill-packs.json`, i.e. `python-ai-agents`) need **no** entry in the pending-actions report — `scaffold-copy.js`'s `copyFrameworkPackSkills` (Plan B) already made them present with no further user action.
- `scaffold-vertical-status.js` must reuse Plan A's `vertical-glossary-pack.js` exports (`loadRegistry`, `isPluginEnabled`) rather than reimplementing prefix-matching or registry-parsing logic a third time.
- No changes to `CORE_AGENTS`, model tiers, or `generator.md` — this plan is scaffold-flow and manifest-schema only.

---

### Task 1: `project-manifest.json` gains `domain_vertical_packs`

**Files:**
- Modify: `.claude/scripts/scaffold-render.js:98-124` (`buildManifest`)
- Test: `test/scaffold-vertical-composition.test.js`

**Interfaces:**
- Consumes: `profile.domainVerticalPacks: string[] | undefined` (new optional input field, same shape/convention as the existing `profile.frameworkPacks`).
- Produces: `manifest.domain_vertical_packs: string[]` present in the built manifest object only when `profile.domainVerticalPacks` is a non-empty array — mirrors `manifest.framework_skill_packs`'s existing conditional-presence behavior exactly.

- [ ] **Step 1: Write the failing test**

Create `test/scaffold-vertical-composition.test.js`:

```javascript
'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const { buildManifest } = require(path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-render.js'));

test('buildManifest includes domain_vertical_packs when profile.domainVerticalPacks is a non-empty array', () => {
  const manifest = buildManifest({ name: 'test-project', domainVerticalPacks: ['private-equity'] });
  assert.deepStrictEqual(manifest.domain_vertical_packs, ['private-equity']);
});

test('buildManifest omits domain_vertical_packs when profile.domainVerticalPacks is absent or empty', () => {
  const withoutField = buildManifest({ name: 'test-project' });
  assert.strictEqual('domain_vertical_packs' in withoutField, false);
  const withEmptyArray = buildManifest({ name: 'test-project', domainVerticalPacks: [] });
  assert.strictEqual('domain_vertical_packs' in withEmptyArray, false);
});

test('buildManifest still includes framework_skill_packs unaffected by the new field (regression check)', () => {
  const manifest = buildManifest({
    name: 'test-project',
    frameworkPacks: ['python-ai-agents'],
    domainVerticalPacks: ['private-equity'],
  });
  assert.deepStrictEqual(manifest.framework_skill_packs, ['python-ai-agents']);
  assert.deepStrictEqual(manifest.domain_vertical_packs, ['private-equity']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: FAIL — `manifest.domain_vertical_packs` is `undefined` (the field doesn't exist yet)

- [ ] **Step 3: Write the implementation**

In `.claude/scripts/scaffold-render.js`, find this existing block inside `buildManifest` (currently around line 119-121):

```javascript
  if (Array.isArray(profile.frameworkPacks) && profile.frameworkPacks.length) {
    manifest.framework_skill_packs = profile.frameworkPacks;
  }
```

Add immediately after it:

```javascript
  if (Array.isArray(profile.domainVerticalPacks) && profile.domainVerticalPacks.length) {
    manifest.domain_vertical_packs = profile.domainVerticalPacks;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/scaffold-render.js test/scaffold-vertical-composition.test.js
git commit -m "feat: add domain_vertical_packs to project-manifest.json rendering"
```

---

### Task 2: `scaffold-vertical-status.js` — deterministic install-status report for domain verticals

**Files:**
- Create: `.claude/scripts/scaffold-vertical-status.js`
- Test: `test/scaffold-vertical-composition.test.js` (append)

**Interfaces:**
- Consumes: `loadRegistry(registryPath): { packs: RegistryEntry[] }` and `isPluginEnabled(enabledPlugins, prefix): boolean` from `.claude/scripts/vertical-glossary-pack.js` (Plan A, existing, unchanged).
- Produces: `checkVerticalStatus(enabledPlugins: object, entries: RegistryEntry[]): Array<{ plugin: string, installed: boolean, marketplace: string, install_id: string }>` — exported for testing, plus a CLI that prints a human-readable report.

- [ ] **Step 1: Write the failing test**

Append to `test/scaffold-vertical-composition.test.js`:

```javascript
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const STATUS_SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'scaffold-vertical-status.js');
const { checkVerticalStatus } = require(STATUS_SCRIPT);

function testRegistryEntry(plugin) {
  return {
    plugin,
    enabled_plugin_prefix: `${plugin}@`,
    marketplace: 'claude-for-financial-services',
    install_id: `${plugin}@claude-for-financial-services`,
  };
}

test('checkVerticalStatus reports installed:true when the plugin is enabled', () => {
  const result = checkVerticalStatus(
    { 'private-equity@claude-for-financial-services': true },
    [testRegistryEntry('private-equity')]
  );
  assert.deepStrictEqual(result, [{
    plugin: 'private-equity', installed: true,
    marketplace: 'claude-for-financial-services', install_id: 'private-equity@claude-for-financial-services',
  }]);
});

test('checkVerticalStatus reports installed:false when the plugin is not enabled', () => {
  const result = checkVerticalStatus({}, [testRegistryEntry('private-equity')]);
  assert.strictEqual(result[0].installed, false);
});

test('checkVerticalStatus reports every registry entry independently', () => {
  const result = checkVerticalStatus(
    { 'private-equity@claude-for-financial-services': true },
    [testRegistryEntry('private-equity'), testRegistryEntry('wealth-management')]
  );
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result.find((r) => r.plugin === 'private-equity').installed, true);
  assert.strictEqual(result.find((r) => r.plugin === 'wealth-management').installed, false);
});

test('CLI: prints INSTALLED for an enabled vertical and a manual-install block for a pending one', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-vertical-status-'));
  fs.mkdirSync(path.join(repo, '.claude', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.claude', 'config', 'vertical-glossary-packs.json'),
    JSON.stringify({ packs: [testRegistryEntry('private-equity'), testRegistryEntry('wealth-management')] }, null, 2)
  );
  fs.writeFileSync(
    path.join(repo, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'private-equity@claude-for-financial-services': true } }, null, 2)
  );
  const stdout = execFileSync(process.execPath, [STATUS_SCRIPT], { cwd: repo, encoding: 'utf8' });
  assert.match(stdout, /private-equity: INSTALLED/);
  assert.match(stdout, /wealth-management: PENDING MANUAL INSTALL/);
  assert.match(stdout, /claude plugin marketplace add claude-for-financial-services/);
  assert.match(stdout, /claude plugin install wealth-management@claude-for-financial-services/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: FAIL — `.claude/scripts/scaffold-vertical-status.js` does not exist

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/scaffold-vertical-status.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Deterministic install-status report for domain-vertical plugins, read by
// /scaffold's own Step 10 reporting (docs/superpowers/specs/2026-07-06-
// expert-generalist-scaffold-composition-design.md, Part 3). Deliberately
// separate from install-framework-packs — that skill's identity is scoped to
// npx-skills-add-installed tech packs; verticals are Claude Code marketplace
// plugins, installed via a different command family (claude plugin install).

const fs = require('fs');
const path = require('path');
const { loadRegistry, isPluginEnabled } = require('./vertical-glossary-pack');

function checkVerticalStatus(enabledPlugins, entries) {
  return entries.map((entry) => ({
    plugin: entry.plugin,
    installed: isPluginEnabled(enabledPlugins, entry.enabled_plugin_prefix),
    marketplace: entry.marketplace,
    install_id: entry.install_id,
  }));
}

function printReport(statuses) {
  for (const s of statuses) {
    if (s.installed) {
      process.stdout.write(`${s.plugin}: INSTALLED\n`);
      continue;
    }
    process.stdout.write(
      `${s.plugin}: PENDING MANUAL INSTALL\n` +
      `  claude plugin marketplace add ${s.marketplace}\n` +
      `  claude plugin install ${s.install_id}\n`
    );
  }
}

function main() {
  const repoRoot = process.cwd();
  const registryPath = path.join(repoRoot, '.claude', 'config', 'vertical-glossary-packs.json');
  if (!fs.existsSync(registryPath)) {
    process.stdout.write('scaffold-vertical-status: no vertical-glossary-packs.json registry found — nothing to report.\n');
    process.exit(0);
  }
  let settings = { enabledPlugins: {} };
  try {
    settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'));
  } catch (err) {
    // no settings.json yet — every entry reports as not-installed, which is correct.
  }
  const registry = loadRegistry(registryPath);
  printReport(checkVerticalStatus(settings.enabledPlugins, registry.packs));
  process.exit(0);
}

module.exports = { checkVerticalStatus };

if (require.main === module) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/scaffold-vertical-status.js test/scaffold-vertical-composition.test.js
git commit -m "feat: add scaffold-vertical-status deterministic install report for domain verticals"
```

---

### Task 3: `/scaffold` — unified tech-stack + domain-vertical question and combined report

**Files:**
- Modify: `.claude/commands/scaffold.md` (the `### Optional Agent-Framework Skill Packs` section)
- Test: `test/scaffold-vertical-composition.test.js` (append wiring assertions)

**Interfaces:**
- Consumes: `.claude/config/vertical-glossary-packs.json` (Plan A) for the list of known verticals to offer; `.claude/scripts/scaffold-vertical-status.js` (Task 2) for the Step 10 report.
- Produces: `profile.domainVerticalPacks` recorded alongside the existing `profile.frameworkPacks`, both flowing into `project-manifest.json` per Task 1.

- [ ] **Step 1: Write the failing test**

Append to `test/scaffold-vertical-composition.test.js`:

```javascript
test('scaffold.md documents the combined tech-stack + domain-vertical question and both report families', () => {
  const scaffoldMd = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'commands', 'scaffold.md'), 'utf8'
  );
  assert.match(scaffoldMd, /domainVerticalPacks/);
  assert.match(scaffoldMd, /vertical-glossary-packs\.json/);
  assert.match(scaffoldMd, /scaffold-vertical-status\.js/);
  assert.match(scaffoldMd, /claude plugin marketplace add/);
  assert.match(scaffoldMd, /claude plugin install/);
  // The existing framework-pack flow must still be present, unchanged in spirit:
  assert.match(scaffoldMd, /npx --yes skills add cwijayasundara\/agent_cli_langchain/);
  assert.match(scaffoldMd, /framework_skill_packs/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: FAIL — `scaffold.md` doesn't mention `domainVerticalPacks`, `vertical-glossary-packs.json`, or `scaffold-vertical-status.js` yet

- [ ] **Step 3: Write the implementation**

In `.claude/commands/scaffold.md`, find the section starting at `### Optional Agent-Framework Skill Packs` and ending right before `## Step 5: Generate CLAUDE.md` (the section that currently covers: the intro paragraph about recording the user's pack selection; the "Do not run `npx skills add`..." explanation; options A/LangChain and B/Google-ADK; the manual install block; and the "Record selected packs in project-manifest.json" closing sub-section with its `"framework_skill_packs": ["langchain", "google-adk"]` example). Replace that entire section with:

```markdown
### Optional Agent-Framework Skill Packs & Domain Vertical Plugins

If the user selected one or more tech-stack skill packs (LangChain/LangGraph/DeepAgents, or Google ADK) and/or one or more domain vertical plugins (e.g. private equity) at the confirmation card or wizard, record both selections in `project-manifest.json` and print the manual install commands in the Step 10 report. These are two independent choices asked together in one step — a user may pick a tech-stack pack, a domain vertical, both, or neither.

#### Tech-Stack Packs

**A) Local — Python AI Agents (LangGraph, LangChain, DeepAgents) — bundled, no install needed**

This pack (`python-ai-agents`) is authored and bundled directly in this harness. If selected, its three skills (`langgraph-code`, `langchain-code`, `deepagents-code`) are copied automatically by `scaffold-apply.js`'s `copyFrameworkPackSkills` when the scaffold is applied — no manual step, no entry in the Step 10 manual-install block.

**B) External — LangChain / LangGraph / DeepAgents (community pack) — 9 skills**

Do not run `npx skills add` from `/scaffold`. Claude Code auto-mode commonly blocks external `npx` installs even when command permissions are allowlisted, so attempting it during scaffold creates a noisy denial and a misleading partial-success report. The reliable path is: (1) scaffold writes the harness files and records selected packs; (2) the user runs the listed `npx --yes skills add ...` command in a normal terminal; (3) the user returns to Claude Code and runs `/install-framework-packs --list` to verify.

**Important:** manual commands must be run inside the target project directory. Do NOT use `-g`/`--global`. **CLI syntax:** the package source goes FIRST as a positional argument — flags before it fail with `ERROR Missing required argument: source`.

```bash
npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y
```

Expected: 9 skills under `.claude/skills/langchain-agents-*`. Source: <https://github.com/cwijayasundara/agent_cli_langchain>. Two skills (`deepagents-code`, `deploy`) carry a "Med Risk" Snyk flag — surface this in the install report. Note this is a separate, external, unaudited alternative to option A above — prefer A unless the user specifically wants the community pack.

**C) Google ADK — 7 skills**

```bash
npx --yes skills add google/agents-cli -a claude-code -s '*' -y
```

Expected: 7 skills under `.claude/skills/google-agents-cli-*`.

Verify manual installs with:

```bash
ls .claude/skills/ | grep -E '^(langchain-agents|google-agents-cli)-' | wc -l
```

#### Domain Vertical Plugins

Read `.claude/config/vertical-glossary-packs.json` for the list of known verticals to offer (currently: `private-equity`). A selected vertical is a Claude Code marketplace plugin, installed via `claude plugin install` — a different command family from the tech-stack packs above, kept separate in the report below on purpose.

Once selected, the vertical's `enabled_plugin_prefix` becoming truthy in `.claude/settings.json#enabledPlugins` (via the manual install below) is what makes `/brd` Step 2.7 (`vertical-glossary-pack.js`) start seeding `CONTEXT.md` from that vertical's skill vocabulary automatically — no further scaffold-side action needed once installed.

#### Combined Manual-Install Report (Step 10)

If one or more external tech-stack packs or domain verticals were selected, run `node .claude/scripts/scaffold-vertical-status.js` for the vertical half of the report, and print this combined block verbatim, adding it to the Step 10 report under a "Manual follow-ups" heading:

```text
[!] Some selections require a manual terminal install.
    Claude Code auto-mode blocks these installs during /scaffold.

  Tech-stack packs (npx):
  cd <project-root>
  npx --yes skills add cwijayasundara/agent_cli_langchain -a claude-code -s '*' -y   # if external LangChain pack selected
  npx --yes skills add google/agents-cli -a claude-code -s '*' -y                     # if Google ADK selected

  Domain vertical plugins (claude plugin):
  <output of `node .claude/scripts/scaffold-vertical-status.js`, verbatim, for each selected vertical not yet installed>

After running, verify:
  ls .claude/skills/ | grep -E '^(langchain-agents|google-agents-cli)-'
  /install-framework-packs --list
  node .claude/scripts/scaffold-vertical-status.js
```

The local `python-ai-agents` pack, if selected, needs no line in this block — it's already been copied.

#### Record selections in project-manifest.json

```json
"framework_skill_packs": ["python-ai-agents", "langchain", "google-adk"],
"domain_vertical_packs": ["private-equity"]
```

Omit either field if the user picked None for that question.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scaffold-vertical-composition.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/scaffold.md test/scaffold-vertical-composition.test.js
git commit -m "feat: unify /scaffold tech-stack pack and domain-vertical composition"
```

---

### Task 4: Full-suite verification

**Files:** none created or modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-3

- [ ] **Step 2: Manual smoke check — combined report on this repo's real state**

Run: `node .claude/scripts/scaffold-vertical-status.js`
Expected: since this project's own `.claude/settings.json#enabledPlugins` has no vertical plugin keys enabled, output lists every registered vertical (currently just `private-equity`) as `PENDING MANUAL INSTALL` with the correct `claude plugin marketplace add`/`claude plugin install` commands.

- [ ] **Step 3: Commit any final cleanup (only if Step 1 or 2 surfaced something to fix)**

If all tests passed and the manual check matched expectations, there is nothing to commit here — Tasks 1-3 already committed everything.
