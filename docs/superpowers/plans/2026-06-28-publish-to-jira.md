# publish-to-jira.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `publish-to-jira.js` so `/tracker-publish --provider jira` creates groomed dependency-group issues on Jira (with an ADF body) and transitions each into the ready state — mirroring `publish-to-linear.js`.

**Architecture:** A `publishGroups(trackerMap, config, { request, readBody, dryRun })` core takes injectable `request` (network) and `readBody` (fs) so it unit-tests without either; the CLI wires the real `fetch`-based `request` + `fs`-based `readBody`, reads `tracker-map.json`/`tracker-config.json`, and writes the updated map. Ports `textToAdf`/`basicAuth`/`looksAlreadyPublished`.

**Tech Stack:** Node.js (CommonJS, `'use strict'`), `node:test` + `assert`, Jira Cloud REST v3, `fetch`.

## Global Constraints

- Self-contained CommonJS with `'use strict';` (symphony_clone/ is not copied to targets), mirroring `.claude/skills/tracker-publish/scripts/publish-to-linear.js`.
- `publishGroups(trackerMap, config, { request, readBody, dryRun })` does NO direct `fetch`/`fs` — all network via `request(method, path, body)`, all body reads via `readBody(group, groupId)`.
- `textToAdf`, `basicAuth`, `looksAlreadyPublished` are ported verbatim from `jira.js`/`http.js`/`publish-to-linear.js`.
- Create: `POST /rest/api/3/issue` with `{ fields: { project: { key }, summary, description: textToAdf(body), issuetype: { name }, labels } }`. Then transition to the ready state: `GET /rest/api/3/issue/<id>/transitions` → pick by name/target-name → `POST /rest/api/3/issue/<id>/transitions { transition: { id } }`. **No matching transition → push a warning, do NOT throw.**
- Issue browse URL = `${baseUrl}/browse/${key}` (trailing slash stripped).
- Config: env `JIRA_EMAIL` + `JIRA_API_TOKEN` (basic auth); `tracker.base_url` / `tracker.project_key` / `tracker.issue_type` (default `Task`) from `.claude/tracker-config.json`; `readyState` from `trackerMap.config_snapshot.ready_state || tracker.ready_state`.
- Tests use `const { test } = require('node:test');` + `const assert = require('assert');` in `test/*.test.js`; `require` the script via `path.join(__dirname, '..', '.claude/skills/tracker-publish/scripts/publish-to-jira.js')`. The script exports the testable functions.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do NOT edit `CLAUDE.md`. Work stays on branch `feat/publish-to-jira`.

---

### Task 1: `publish-to-jira.js` — the publisher

**Files:**
- Create: `.claude/skills/tracker-publish/scripts/publish-to-jira.js`
- Test: `test/publish-to-jira.test.js`

**Interfaces:**
- Produces: `publishGroups(trackerMap, config, { request, readBody, dryRun }) -> { created, skipped, warnings }`; `textToAdf(text)`; `basicAuth(user, token)`; `looksAlreadyPublished(group)`; `pickTransition(transitions, readyState)`.
- Consumes: nothing (foundation).

- [ ] **Step 1: Write the failing test**

Create `test/publish-to-jira.test.js`:

```js
'use strict';

const assert = require('assert');
const path = require('path');
const { test } = require('node:test');

const {
  publishGroups, textToAdf, basicAuth, looksAlreadyPublished, pickTransition,
} = require(path.join(__dirname, '..', '.claude/skills/tracker-publish/scripts/publish-to-jira.js'));

const CONFIG = { projectKey: 'PROJ', issueType: 'Task', readyState: 'Ready for Agent', baseUrl: 'https://acme.atlassian.net' };

function recordingRequest(transitions = [{ id: '31', name: 'Ready for Agent' }]) {
  const calls = [];
  const request = async (method, p, body) => {
    calls.push({ method, p, body });
    if (method === 'POST' && p === '/rest/api/3/issue') return { id: '10001', key: 'PROJ-1' };
    if (method === 'GET' && /\/transitions$/.test(p)) return { transitions };
    return {};
  };
  return { calls, request };
}

test('textToAdf produces a doc with one paragraph per line (empty line → empty content)', () => {
  const adf = textToAdf('hello\n\nworld');
  assert.strictEqual(adf.type, 'doc');
  assert.strictEqual(adf.version, 1);
  assert.deepStrictEqual(adf.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] });
  assert.deepStrictEqual(adf.content[1], { type: 'paragraph', content: [] });
});

test('basicAuth is base64 of email:token', () => {
  assert.strictEqual(basicAuth('a@b.com', 'tok'), Buffer.from('a@b.com:tok').toString('base64'));
});

test('looksAlreadyPublished: real key true, pending/local false, none false', () => {
  assert.strictEqual(looksAlreadyPublished({ tracker_key: 'PROJ-9' }), true);
  assert.strictEqual(looksAlreadyPublished({ tracker_key: 'PROJ-LOCAL-1' }), false);
  assert.strictEqual(looksAlreadyPublished({}), false);
});

test('pickTransition matches by name or target name, case-insensitive', () => {
  const ts = [{ id: '11', name: 'Start' }, { id: '31', to: { name: 'Ready For Agent' } }];
  assert.strictEqual(pickTransition(ts, 'ready for agent').id, '31');
  assert.strictEqual(pickTransition(ts, 'nope'), null);
});

test('publishGroups creates an issue then transitions it to ready', async () => {
  const map = { groups: { A: { title: 'Group A', labels: ['x'], stories: ['E1-S1'] } }, stories: { 'E1-S1': { group: 'A' } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'body text' });

  const create = calls.find((c) => c.method === 'POST' && c.p === '/rest/api/3/issue');
  assert.deepStrictEqual(create.body.fields.project, { key: 'PROJ' });
  assert.strictEqual(create.body.fields.summary, 'Group A');
  assert.strictEqual(create.body.fields.issuetype.name, 'Task');
  assert.deepStrictEqual(create.body.fields.labels, ['x']);
  assert.strictEqual(create.body.fields.description.type, 'doc');

  assert.ok(calls.find((c) => c.method === 'GET' && /\/transitions$/.test(c.p)));
  const move = calls.find((c) => c.method === 'POST' && /\/transitions$/.test(c.p));
  assert.deepStrictEqual(move.body, { transition: { id: '31' } });

  assert.strictEqual(map.groups.A.tracker_key, 'PROJ-1');
  assert.strictEqual(map.groups.A.url, 'https://acme.atlassian.net/browse/PROJ-1');
  assert.strictEqual(map.stories['E1-S1'].tracker_key, 'PROJ-1');
  assert.strictEqual(res.created.length, 1);
  assert.strictEqual(res.warnings.length, 0);
});

test('publishGroups warns (no throw) when no transition matches the ready state', async () => {
  const map = { groups: { A: { title: 'A', stories: [] } } };
  const { calls, request } = recordingRequest([{ id: '11', name: 'Start' }]);
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'b' });
  assert.strictEqual(res.created.length, 1);
  assert.strictEqual(res.warnings.length, 1);
  assert.match(res.warnings[0], /no transition/i);
  assert.ok(!calls.find((c) => c.method === 'POST' && /\/transitions$/.test(c.p)), 'no transition POST');
});

test('publishGroups skips an already-published group (no create)', async () => {
  const map = { groups: { A: { title: 'A', stories: [], tracker_key: 'PROJ-7' } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'b' });
  assert.strictEqual(res.skipped.length, 1);
  assert.strictEqual(res.created.length, 0);
  assert.strictEqual(calls.length, 0);
});

test('publishGroups dry-run makes no requests', async () => {
  const map = { groups: { A: { title: 'A', stories: [] } } };
  const { calls, request } = recordingRequest();
  const res = await publishGroups(map, CONFIG, { request, readBody: () => 'b', dryRun: true });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(res.created[0].dryRun, true);
  assert.strictEqual(map.groups.A.tracker_key, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/publish-to-jira.test.js`
Expected: FAIL — `Cannot find module '.../publish-to-jira.js'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/tracker-publish/scripts/publish-to-jira.js`:

```js
'use strict';

// publish-to-jira.js — create groomed dependency-group issues on Jira from
// tracker-map.json, then transition each into the ready state. Self-contained
// (symphony_clone/ is not copied into target projects), mirroring
// publish-to-linear.js. publishGroups takes injectable request + readBody so the
// core unit-tests without network or fs.

const fs = require('node:fs');
const path = require('node:path');

function textToAdf(text) {
  const content = String(text == null ? '' : text).split('\n').map((line) => ({
    type: 'paragraph',
    content: line.length ? [{ type: 'text', text: line }] : [],
  }));
  return { type: 'doc', version: 1, content };
}

function basicAuth(user, token) {
  return Buffer.from(`${user}:${token}`).toString('base64');
}

function looksAlreadyPublished(group) {
  if (!group.tracker_key) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.tracker_id)) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.url)) return false;
  if (/^[A-Z]+-LOCAL-/.test(group.tracker_key)) return false;
  return true;
}

function pickTransition(transitions, readyState) {
  const want = String(readyState || '').trim().toLowerCase();
  return (transitions || []).find((t) =>
    String(t.name || '').toLowerCase() === want
    || String((t.to && t.to.name) || '').toLowerCase() === want) || null;
}

async function publishGroups(trackerMap, config, deps) {
  const { request, readBody, dryRun = false } = deps;
  const created = [];
  const skipped = [];
  const warnings = [];
  for (const [groupId, group] of Object.entries(trackerMap.groups || {})) {
    if (looksAlreadyPublished(group)) { skipped.push({ groupId, key: group.tracker_key }); continue; }
    if (dryRun) { created.push({ groupId, dryRun: true }); continue; }

    const issue = await request('POST', '/rest/api/3/issue', {
      fields: {
        project: { key: config.projectKey },
        summary: group.title || `Group ${groupId}`,
        description: textToAdf(readBody(group, groupId)),
        issuetype: { name: config.issueType || 'Task' },
        labels: group.labels || [],
      },
    });

    const tdata = await request('GET', `/rest/api/3/issue/${issue.id}/transitions`);
    const transition = pickTransition(tdata && tdata.transitions, config.readyState);
    if (transition) {
      await request('POST', `/rest/api/3/issue/${issue.id}/transitions`, { transition: { id: transition.id } });
    } else {
      warnings.push(`group ${groupId} (${issue.key}): no transition to "${config.readyState}" — move it manually`);
    }

    const url = `${String(config.baseUrl).replace(/\/$/, '')}/browse/${issue.key}`;
    group.tracker_key = issue.key;
    group.tracker_id = issue.id;
    group.url = url;
    for (const sid of group.stories || []) {
      if (trackerMap.stories && trackerMap.stories[sid]) trackerMap.stories[sid].tracker_key = issue.key;
    }
    created.push({ groupId, key: issue.key, url });
  }
  return { created, skipped, warnings };
}

// ---- CLI ----

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
  }
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function makeJiraRequest({ baseUrl, email, token }) {
  const auth = basicAuth(email, token);
  const base = String(baseUrl).replace(/\/$/, '');
  return async function request(method, p, body) {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jira ${method} ${p} → ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.projectRoot || process.cwd();
  const trackerMap = readJson(path.join(projectRoot, '.claude/state/tracker-map.json'));
  const trackerConfig = readJson(path.join(projectRoot, '.claude/tracker-config.json'));
  const t = trackerConfig.tracker || {};
  const config = {
    baseUrl: process.env.JIRA_BASE_URL || t.base_url,
    projectKey: t.project_key,
    issueType: t.issue_type || 'Task',
    readyState: (trackerMap.config_snapshot && trackerMap.config_snapshot.ready_state) || t.ready_state || 'To Do',
  };
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error('JIRA_EMAIL and JIRA_API_TOKEN must be set in the environment.');
  if (!config.baseUrl || !config.projectKey || /^replace-with-/.test(String(config.projectKey))) {
    throw new Error('tracker.base_url and tracker.project_key must be set in .claude/tracker-config.json.');
  }

  const request = makeJiraRequest({ baseUrl: config.baseUrl, email, token });
  const readBody = (group, groupId) => fs.readFileSync(
    path.join(projectRoot, group.body_file || `.claude/state/tracker-runs/group-${groupId}.md`), 'utf8');

  const { created, skipped, warnings } = await publishGroups(trackerMap, config, { request, readBody, dryRun: args.dryRun });

  if (created.length && !args.dryRun) trackerMap.status = 'published';
  trackerMap.published_at = new Date().toISOString();
  if (!args.dryRun) {
    fs.writeFileSync(path.join(projectRoot, '.claude/state/tracker-map.json'), JSON.stringify(trackerMap, null, 2) + '\n');
  }
  console.log(`Summary: created=${created.length} skipped=${skipped.length}`);
  for (const c of created) console.log(`  + ${c.groupId}: ${c.dryRun ? '(dry-run)' : `${c.key} ${c.url}`}`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { publishGroups, textToAdf, basicAuth, looksAlreadyPublished, pickTransition };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/publish-to-jira.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/tracker-publish/scripts/publish-to-jira.js test/publish-to-jira.test.js
git commit -m "feat(tracker-publish): publish-to-jira.js (create issue + transition to ready)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `tracker-config.template.json` — Jira fields

**Files:**
- Modify: `.claude/templates/tracker-config.template.json`
- Test: `test/publish-to-jira-config-contract.test.js`

**Interfaces:**
- Produces: the optional `tracker.base_url` / `project_key` / `issue_type` config keys `publish-to-jira.js` reads.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `test/publish-to-jira-config-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const tpl = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'templates', 'tracker-config.template.json'), 'utf8',
);

test('tracker-config template carries optional Jira fields and stays valid JSON', () => {
  assert.match(tpl, /base_url/);
  assert.match(tpl, /project_key/);
  assert.match(tpl, /issue_type/);
  const parsed = JSON.parse(tpl); // must remain valid JSON
  assert.ok(parsed.tracker, 'has a tracker block');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/publish-to-jira-config-contract.test.js`
Expected: FAIL — the template lacks `base_url`/`project_key`/`issue_type`.

- [ ] **Step 3: Add the Jira fields**

In `.claude/templates/tracker-config.template.json`, inside the `tracker` object (beside the existing `ready_label`/`feature_label` keys), add the optional Jira fields. Keep the file valid JSON (match its formatting):

```json
    "base_url": "replace-with-https://your-domain.atlassian.net",
    "project_key": "replace-with-jira-project-key",
    "issue_type": "Task"
```

(These are only consumed when `provider` is `jira`; `provider` stays `linear` by default. Auth — `JIRA_EMAIL`/`JIRA_API_TOKEN` — lives in env, not this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/publish-to-jira-config-contract.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add .claude/templates/tracker-config.template.json test/publish-to-jira-config-contract.test.js
git commit -m "feat(tracker-publish): optional Jira fields in tracker-config template

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Docs — SKILL.md routing + README correction

**Files:**
- Modify: `.claude/skills/tracker-publish/SKILL.md`
- Modify: `symphony_clone/README.md`
- Test: `test/publish-to-jira-docs-contract.test.js`

**Interfaces:**
- Consumes: `publish-to-jira.js` (Task 1) + the Jira config (Task 2).
- Produces: operator-facing docs; a contract test pinning the `--provider jira` route.

- [ ] **Step 1: Write the failing test**

Create `test/publish-to-jira-docs-contract.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tracker-publish SKILL documents the --provider jira route to publish-to-jira.js', () => {
  const skill = read('.claude/skills/tracker-publish/SKILL.md');
  assert.match(skill, /publish-to-jira\.js/);
  assert.match(skill, /JIRA_EMAIL/);
  assert.match(skill, /JIRA_API_TOKEN/);
});

test('symphony README no longer calls Jira issue-creation a stub', () => {
  const readme = read('symphony_clone/README.md');
  assert.match(readme, /publish-to-jira/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/publish-to-jira-docs-contract.test.js`
Expected: FAIL — SKILL.md/README don't mention `publish-to-jira` yet.

- [ ] **Step 3a: SKILL.md**

In `.claude/skills/tracker-publish/SKILL.md`, where the publisher is described (the note about `publish-to-linear.js` consuming the map, ~line 46, and the transport order), add a provider-aware paragraph: when `provider` is `jira`, the skill runs `node .claude/skills/tracker-publish/scripts/publish-to-jira.js` instead of the Linear publisher — same `tracker-map.json` shape and `--granularity` semantics (one Jira issue per `groups` entry), creating each issue with an ADF body and transitioning it into the ready state. Auth via env `JIRA_EMAIL` + `JIRA_API_TOKEN`; `tracker.base_url` + `tracker.project_key` (+ `issue_type`, default `Task`) in `.claude/tracker-config.json`. A group whose ready-state transition isn't found is created but left in its default status (the summary flags it).

- [ ] **Step 3b: README correction**

In `symphony_clone/README.md`, find the line stating Jira is a stub (e.g. "Linear is implemented; Jira is a stub.") and correct it: the Jira runtime adapter is fully implemented, and Jira **issue-creation** now exists via `.claude/skills/tracker-publish/scripts/publish-to-jira.js` (the prior "stub" referred only to the missing publisher). Keep the surrounding text intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/publish-to-jira-docs-contract.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test`
Expected: PASS (all suites, including the three new publish-to-jira test files).

```bash
git add .claude/skills/tracker-publish/SKILL.md symphony_clone/README.md test/publish-to-jira-docs-contract.test.js
git commit -m "docs(tracker-publish): document --provider jira; correct symphony README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `publish-to-jira.js` self-contained, `publishGroups` injectable `request`+`readBody` → Task 1. ✓
- Ported `textToAdf`/`basicAuth`/`looksAlreadyPublished` → Task 1. ✓
- Create (ADF body) + transition-to-ready (warn-not-throw on no match) → Task 1 (`publishGroups`) + tests. ✓
- Browse URL, tracker-map mutation (key/id/url + stories), idempotency, dry-run → Task 1 + tests. ✓
- CLI: env auth, config guard, file read/write → Task 1 `main`. ✓
- Jira tracker-config fields → Task 2. ✓
- SKILL.md `--provider jira` routing + README correction → Task 3. ✓
- Error handling (missing env/config → abort; create fail → throw; no transition → warn) → Task 1 (`main` guards + `publishGroups`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step has assertions + the exact `node --test …` command and expected result.

**Type consistency:** `publishGroups(trackerMap, config, { request, readBody, dryRun }) -> { created, skipped, warnings }`, `textToAdf`, `basicAuth`, `looksAlreadyPublished`, `pickTransition` are defined in Task 1 and asserted by its test with matching signatures. `config` keys (`projectKey`, `issueType`, `readyState`, `baseUrl`) are consistent between `main`'s construction and `publishGroups`'s use. The `request(method, path, body)` and `readBody(group, groupId)` shapes match between the CLI wiring and the test stubs.

**Out of scope (unchanged):** the runtime Jira adapter; the brownfield tracker path; Azure publish; blocker relations.
