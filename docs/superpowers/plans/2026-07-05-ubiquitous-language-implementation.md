# Ubiquitous Language / Domain Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the harness carry one consistent domain vocabulary from BRD through spec, design, and generated code — closing the gap where traceability sensors check ID-linkage but never term consistency.

**Architecture:** `CONTEXT.md` (existing template, unchanged format) is promoted from an optional brownfield artifact to a first-class glossary seeded at BRD time. Every downstream skill (`/spec`, `/design`, `/implement`, `generator.md`) gets a required read/write instruction pointing at it. A new deterministic sensor, `vocabulary-check.js` (same pure-core-plus-CLI shape as `trace-check.js`), cross-checks entity/field names against the glossary. Brownfield's glossary extraction step is fed by a new deterministic naming-cluster helper instead of open-ended LLM judgment.

**Tech Stack:** Node.js (`node:test`, `node:assert`), no new npm dependencies. Follows this repo's existing pure-core-plus-CLI script convention (`trace-check.js`, `modularity-pack.js`).

## Global Constraints

- No new file formats — `CONTEXT.md` keeps the exact template at `.claude/templates/context.template.md` (`## Terms` / `### <Term>` / `## Invariants` / `## Out of Scope Terms`).
- Every new script exports a pure core function separately from its CLI (`module.exports`), matching `.claude/scripts/trace-check.js`.
- Every new/modified sensor in `harness-manifest.json` must pass `node .claude/scripts/validate-harness-manifest.js` (axis, type, cadence, status, scope from the controlled vocabularies in that script).
- Matching in `vocabulary-check.js` is exact-after-normalization only — no fuzzy or embedding-based matching (spec: `docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md`, "Out of Scope").
- Approved spec: `docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md` (commit `d1c1608`). Every task below implements one section of it.

---

### Task 1: `vocabulary-check.js` sensor — pure core + CLI

**Files:**
- Create: `.claude/scripts/vocabulary-check.js`
- Test: `test/vocabulary-check.test.js`

**Interfaces:**
- Produces: `checkVocabulary({ glossaryTerms: string[], candidates: {name, source}[] }) -> { pass, glossary_total, candidate_total, undocumented: {name, source}[], unused: string[] }`, `parseGlossaryTerms(markdown: string) -> string[]`, `normalizeTerm(name: string) -> string`, `candidatesFromDomainConcepts(json, source) -> {name, source}[]`, `candidatesFromDataModels(json, source) -> {name, source}[]`, `candidatesFromApiContracts(json, source) -> {name, source}[]`. All exported from `.claude/scripts/vocabulary-check.js`. Later tasks (2, 5, 6) invoke the CLI only — they do not import these functions directly.

- [ ] **Step 1: Write the failing tests**

Create `test/vocabulary-check.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'vocabulary-check.js');
const {
  checkVocabulary, parseGlossaryTerms, normalizeTerm,
  candidatesFromDomainConcepts, candidatesFromDataModels, candidatesFromApiContracts,
} = require(SCRIPT);

test('normalizeTerm lowercases, strips punctuation, and naive-singularizes', () => {
  assert.strictEqual(normalizeTerm('Account'), 'account');
  assert.strictEqual(normalizeTerm('Accounts'), 'account');
  assert.strictEqual(normalizeTerm('Sub-Scription Plan'), 'subscriptionplan');
  assert.strictEqual(normalizeTerm('Address'), 'address'); // ends in "ss" after strip -> not singularized past "address"
});

test('parseGlossaryTerms extracts ### headings under ## Terms only', () => {
  const md = [
    '# Context', '', '## Terms', '', '### Account', 'Definition.', '',
    '### User', 'Definition.', '', '## Invariants', '', '### Not a term',
  ].join('\n');
  assert.deepStrictEqual(parseGlossaryTerms(md), ['Account', 'User']);
});

test('parseGlossaryTerms returns empty array when no Terms section exists', () => {
  assert.deepStrictEqual(parseGlossaryTerms('# Context\n\nNothing here.'), []);
});

test('checkVocabulary passes when every candidate resolves to a glossary term', () => {
  const v = checkVocabulary({
    glossaryTerms: ['Account', 'User'],
    candidates: [{ name: 'Account', source: 'a.json' }, { name: 'User', source: 'b.json' }],
  });
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.undocumented, []);
});

test('checkVocabulary matches Accounts (candidate) against Account (glossary) via singularization', () => {
  const v = checkVocabulary({ glossaryTerms: ['Account'], candidates: [{ name: 'Accounts', source: 'a.json' }] });
  assert.strictEqual(v.pass, true);
});

test('checkVocabulary flags a candidate with no matching glossary term as undocumented', () => {
  const v = checkVocabulary({ glossaryTerms: ['Account'], candidates: [{ name: 'User', source: 'api-contracts.schema.json' }] });
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.undocumented, [{ name: 'User', source: 'api-contracts.schema.json' }]);
});

test('checkVocabulary reports unused glossary terms but does not fail the gate', () => {
  const v = checkVocabulary({ glossaryTerms: ['Account', 'Invoice'], candidates: [{ name: 'Account', source: 'a.json' }] });
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.unused, ['Invoice']);
});

test('candidatesFromDomainConcepts extracts domain_concepts[].name', () => {
  const c = candidatesFromDomainConcepts({ domain_concepts: [{ name: 'Account', status: 'new' }] }, 'brd-analysis.json');
  assert.deepStrictEqual(c, [{ name: 'Account', source: 'brd-analysis.json' }]);
});

test('candidatesFromDataModels extracts $defs keys', () => {
  const c = candidatesFromDataModels({ $defs: { Account: {}, User: {} } }, 'data-models.schema.json');
  assert.deepStrictEqual(c.map((x) => x.name).sort(), ['Account', 'User']);
});

test('candidatesFromApiContracts extracts components.schemas keys', () => {
  const c = candidatesFromApiContracts({ components: { schemas: { Account: {} } } }, 'api-contracts.schema.json');
  assert.deepStrictEqual(c, [{ name: 'Account', source: 'api-contracts.schema.json' }]);
});

// --- CLI ----------------------------------------------------------------------

function writeFile(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('CLI: passes when all candidates resolve, writes verdict, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  const glossary = writeFile(dir, 'CONTEXT.md', '# Context\n\n## Terms\n\n### Account\nDef.\n');
  const domainConcepts = writeFile(dir, 'brd-analysis.json', JSON.stringify({ domain_concepts: [{ name: 'Account' }] }));
  const out = path.join(dir, 'verdict.json');
  execFileSync(process.execPath, [SCRIPT, '--glossary', glossary, '--domain-concepts', domainConcepts, '--out', out]);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(v.pass, true);
});

test('CLI: exits 1 when a schema entity has no glossary term', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  const glossary = writeFile(dir, 'CONTEXT.md', '# Context\n\n## Terms\n\n### Account\nDef.\n');
  const dataModels = writeFile(dir, 'data-models.schema.json', JSON.stringify({ $defs: { Invoice: {} } }));
  const out = path.join(dir, 'verdict.json');
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--glossary', glossary, '--data-models', dataModels, '--out', out], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pass, false);
});

test('CLI: exits 2 when --glossary path does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--glossary', path.join(dir, 'nope.md')], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});

test('CLI: combines domain-concepts, data-models, and api-contracts candidates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-'));
  const glossary = writeFile(dir, 'CONTEXT.md', '# Context\n\n## Terms\n\n### Account\nDef.\n\n### User\nDef.\n');
  const domainConcepts = writeFile(dir, 'brd-analysis.json', JSON.stringify({ domain_concepts: [{ name: 'Account' }] }));
  const apiContracts = writeFile(dir, 'api-contracts.schema.json', JSON.stringify({ components: { schemas: { User: {} } } }));
  const out = path.join(dir, 'verdict.json');
  execFileSync(process.execPath, [SCRIPT, '--glossary', glossary, '--domain-concepts', domainConcepts, '--api-contracts', apiContracts, '--out', out]);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.candidate_total, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/vocabulary-check.test.js`
Expected: FAIL — `Cannot find module '.../.claude/scripts/vocabulary-check.js'`

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/vocabulary-check.js`:

```js
#!/usr/bin/env node

'use strict';

// Deterministic vocabulary-consistency sensor (traceability axis): extends
// trace-check.js's ID-linkage discipline to term-linkage. Checks that every
// entity/field name surfaced in domain_concepts, data-models.schema.json, and
// api-contracts.schema.json resolves to a term already defined in CONTEXT.md,
// so "Account" in the BRD and "User" in the API contract can no longer trace
// cleanly just because their IDs line up.
//
//   undocumented — a candidate name with no matching glossary term. Hard
//                  block: an entity nobody defined in CONTEXT.md.
//   unused       — a glossary term no candidate currently references. Report
//                  only: expected mid-pipeline noise (BRD named a concept
//                  design/implementation hasn't reached yet), not a defect.
//
// pass = undocumented is empty. unused never fails the gate.

const fs = require('fs');
const path = require('path');

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeTerm(name) {
  let s = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (s.length > 2 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

function parseGlossaryTerms(markdown) {
  const lines = String(markdown == null ? '' : markdown).split(/\r?\n/);
  const terms = [];
  let inTerms = false;
  for (const line of lines) {
    if (/^##\s+Terms\s*$/i.test(line)) { inTerms = true; continue; }
    if (inTerms && /^##\s+/.test(line)) break;
    if (inTerms) {
      const m = line.match(/^###\s+(.+?)\s*$/);
      if (m) terms.push(m[1].trim());
    }
  }
  return terms;
}

function candidatesFromDomainConcepts(json, source) {
  return asArray(json && json.domain_concepts).filter((c) => c && c.name).map((c) => ({ name: c.name, source }));
}

function candidatesFromDataModels(json, source) {
  const defs = (json && (json.$defs || json.definitions)) || {};
  return Object.keys(defs).map((name) => ({ name, source }));
}

function candidatesFromApiContracts(json, source) {
  const schemas = (json && json.components && json.components.schemas) || {};
  return Object.keys(schemas).map((name) => ({ name, source }));
}

// Pure core. glossaryTerms: string[]. candidates: { name, source }[].
function checkVocabulary({ glossaryTerms, candidates }) {
  const terms = asArray(glossaryTerms);
  const cands = asArray(candidates);
  const glossarySet = new Set(terms.map(normalizeTerm));
  const undocumented = cands
    .filter((c) => !glossarySet.has(normalizeTerm(c.name)))
    .map((c) => ({ name: c.name, source: c.source || null }));
  const candidateSet = new Set(cands.map((c) => normalizeTerm(c.name)));
  const unused = terms.filter((t) => !candidateSet.has(normalizeTerm(t)));
  return {
    pass: undocumented.length === 0,
    glossary_total: terms.length,
    candidate_total: cands.length,
    undocumented,
    unused,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { candidateFiles: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--glossary') { args.glossary = argv[++i]; continue; }
    if (key === '--domain-concepts') { args.candidateFiles.push({ file: argv[++i], kind: 'domain-concepts' }); continue; }
    if (key === '--data-models') { args.candidateFiles.push({ file: argv[++i], kind: 'data-models' }); continue; }
    if (key === '--api-contracts') { args.candidateFiles.push({ file: argv[++i], kind: 'api-contracts' }); continue; }
    if (key === '--out') { args.out = argv[++i]; continue; }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCandidates(candidateFiles) {
  const extractors = {
    'domain-concepts': candidatesFromDomainConcepts,
    'data-models': candidatesFromDataModels,
    'api-contracts': candidatesFromApiContracts,
  };
  let all = [];
  for (const { file, kind } of candidateFiles) {
    if (!file || !fs.existsSync(file)) continue;
    all = all.concat(extractors[kind](readJson(file), file));
  }
  return all;
}

function printVerdict(v) {
  process.stdout.write(
    `vocabulary-check: ${v.pass ? 'PASS' : 'FAIL'} — ` +
    `${v.glossary_total} glossary term(s), ${v.candidate_total} candidate(s), ` +
    `${v.undocumented.length} undocumented, ${v.unused.length} unused\n`
  );
  for (const u of v.undocumented) process.stdout.write(`  UNDOCUMENTED  ${u.name} (from ${u.source})\n`);
  for (const t of v.unused) process.stdout.write(`  UNUSED        ${t}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.glossary) {
    process.stderr.write('vocabulary-check: --glossary <CONTEXT.md> is required\n');
    process.exit(2);
  }
  if (!fs.existsSync(args.glossary)) {
    process.stderr.write(`vocabulary-check: no glossary at ${args.glossary} — run /brd or /brownfield first.\n`);
    process.exit(2);
  }
  const glossaryTerms = parseGlossaryTerms(fs.readFileSync(args.glossary, 'utf8'));
  const candidates = loadCandidates(args.candidateFiles);
  const verdict = checkVocabulary({ glossaryTerms, candidates });
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n');
  }
  printVerdict(verdict);
  process.exit(verdict.pass ? 0 : 1);
}

module.exports = {
  checkVocabulary, parseGlossaryTerms, normalizeTerm,
  candidatesFromDomainConcepts, candidatesFromDataModels, candidatesFromApiContracts,
};

if (require.main === module) main();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/vocabulary-check.test.js`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/vocabulary-check.js test/vocabulary-check.test.js
git commit -m "feat: add vocabulary-check deterministic sensor"
```

---

### Task 2: Register `vocabulary-check` in the harness manifest

**Files:**
- Modify: `harness-manifest.json:84` (insert after the `trace-check` sensor entry)
- Modify: `HARNESS.md:75`
- Modify: `test/harness-manifest.test.js` (append a sensor-specific test)

**Interfaces:**
- Consumes: `.claude/scripts/vocabulary-check.js` (Task 1) must exist on disk — `validate-harness-manifest.js`'s `checkWiring` resolves `wired_at` against the filesystem.
- Produces: nothing new consumed by later tasks; this task only makes the sensor discoverable/valid.

- [ ] **Step 1: Write the failing test**

Append to `test/harness-manifest.test.js` (after the existing `verification-matrix-gate sensor is active and wired` test):

```js
test('vocabulary-check sensor is active and wired', () => {
  const sensor = manifest.sensors.find((s) => s.id === 'vocabulary-check');
  assert.ok(sensor, 'expected vocabulary-check sensor');
  assert.strictEqual(sensor.axis, 'traceability');
  assert.strictEqual(sensor.type, 'computational');
  assert.strictEqual(sensor.cadence, 'planning');
  assert.strictEqual(sensor.status, 'active');
  assert.strictEqual(sensor.scope, 'artifacts');
  assert.strictEqual(sensor.wired_at, '.claude/scripts/vocabulary-check.js');
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, sensor.wired_at)),
    'vocabulary-check wired_at file must exist'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/harness-manifest.test.js`
Expected: FAIL — `expected vocabulary-check sensor` (assert.ok received undefined)

- [ ] **Step 3: Register the sensor and update the doc**

In `harness-manifest.json`, find the `trace-check` sensor entry (the line reading `{ "id": "trace-check", ...`) and insert this new entry immediately after it (before the `verification-matrix-gate` entry), keeping valid JSON (add a comma after the `trace-check` entry's closing `}`):

```json
{ "id": "vocabulary-check", "axis": "traceability", "type": "computational", "cadence": "planning", "status": "active", "scope": "artifacts", "wired_at": ".claude/scripts/vocabulary-check.js", "signal": "entity/field names in domain_concepts, data-models.schema.json, or api-contracts.schema.json that do not resolve to a CONTEXT.md term", "description": "Deterministic vocabulary-consistency sensor: extends the traceability axis from ID-linkage (trace-check) to term-linkage. Catches 'Account in the BRD, User in the API contract' before code is written." },
```

In `HARNESS.md`, in the Traceability section's Sensors cell (the line starting `| | FRD/PRD as immutable baseline ... | ✅ \`grounding-check\` ...`), insert `· ✅ \`vocabulary-check\` (entity/field names vs CONTEXT.md glossary terms)` immediately after the existing `✅ \`trace-check\` (spec vs BRD; test vs AC+obligation)` clause:

Old:
```
✅ `trace-check` (spec vs BRD; test vs AC+obligation) · ✅ `verification-matrix-gate`
```

New:
```
✅ `trace-check` (spec vs BRD; test vs AC+obligation) · ✅ `vocabulary-check` (entity/field names vs CONTEXT.md glossary terms) · ✅ `verification-matrix-gate`
```

- [ ] **Step 4: Run the test to verify it passes, and validate the whole manifest**

Run: `node --test test/harness-manifest.test.js`
Expected: PASS

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: N guides, M sensors, all wired_at paths resolve.` (exit 0)

- [ ] **Step 5: Commit**

```bash
git add harness-manifest.json HARNESS.md test/harness-manifest.test.js
git commit -m "feat: register vocabulary-check as a traceability sensor"
```

---

### Task 3: `naming-clusters.js` — deterministic evidence for brownfield glossary extraction

**Files:**
- Create: `.claude/hooks/lib/naming-clusters.js`
- Create: `.claude/scripts/naming-clusters.js`
- Test: `test/naming-clusters.test.js`

**Interfaces:**
- Produces: `clusterNamingEvidence(graph, {minCount}) -> {term, count, evidence: {symbol, path}[]}[]`, `renderCandidates(clusters) -> string`, `stripRoleSuffix(symbol) -> string`, `isCandidateRoot(root) -> boolean` from `.claude/hooks/lib/naming-clusters.js`. The CLI at `.claude/scripts/naming-clusters.js` reads `specs/brownfield/code-graph.json` and writes `specs/brownfield/naming-clusters.md` — Task 7 invokes this CLI from `brownfield/SKILL.md`, it does not import the lib directly.

- [ ] **Step 1: Write the failing tests**

Create `test/naming-clusters.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const LIB = path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'naming-clusters.js');
const { stripRoleSuffix, isCandidateRoot, clusterNamingEvidence, renderCandidates } = require(LIB);

test('stripRoleSuffix removes known technical-role suffixes', () => {
  assert.strictEqual(stripRoleSuffix('AccountController'), 'Account');
  assert.strictEqual(stripRoleSuffix('AccountRepository'), 'Account');
  assert.strictEqual(stripRoleSuffix('AccountService'), 'Account');
  assert.strictEqual(stripRoleSuffix('verify_token'), 'verify_token');
});

test('isCandidateRoot requires a PascalCase-looking root of length > 1', () => {
  assert.strictEqual(isCandidateRoot('Account'), true);
  assert.strictEqual(isCandidateRoot('verify_token'), false);
  assert.strictEqual(isCandidateRoot('A'), false);
  assert.strictEqual(isCandidateRoot(''), false);
});

test('clusterNamingEvidence groups symbols by stripped root noun and sorts by count desc', () => {
  const graph = {
    nodes: [
      { id: 'py:a.py', path: 'a.py', symbols: ['AccountController', 'verify_token'] },
      { id: 'py:b.py', path: 'b.py', symbols: ['AccountRepository', 'AccountService'] },
      { id: 'py:c.py', path: 'c.py', symbols: ['UserService'] },
    ],
  };
  const clusters = clusterNamingEvidence(graph, { minCount: 2 });
  assert.deepStrictEqual(clusters.map((c) => c.term), ['Account']);
  assert.strictEqual(clusters[0].count, 3);
  assert.strictEqual(clusters[0].evidence.length, 3);
});

test('clusterNamingEvidence excludes clusters below minCount', () => {
  const graph = { nodes: [{ id: 'py:c.py', path: 'c.py', symbols: ['UserService'] }] };
  assert.deepStrictEqual(clusterNamingEvidence(graph, { minCount: 2 }), []);
});

test('clusterNamingEvidence handles an empty or malformed graph', () => {
  assert.deepStrictEqual(clusterNamingEvidence({}), []);
  assert.deepStrictEqual(clusterNamingEvidence({ nodes: [{ path: 'x.py' }] }), []);
});

test('renderCandidates lists each cluster with evidence, or a no-clusters message', () => {
  const rendered = renderCandidates([{ term: 'Account', count: 2, evidence: [{ symbol: 'AccountController', path: 'a.py' }, { symbol: 'AccountService', path: 'b.py' }] }]);
  assert.match(rendered, /Account/);
  assert.match(rendered, /AccountController/);
  assert.strictEqual(renderCandidates([]), 'No recurring domain-term clusters found (each root noun appears in fewer than 2 symbols).');
});

// --- CLI ----------------------------------------------------------------------

test('CLI: writes specs/brownfield/naming-clusters.md from code-graph.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-clusters-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  const graph = { nodes: [
    { id: 'py:a.py', path: 'a.py', symbols: ['AccountController', 'AccountService'] },
  ] };
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), JSON.stringify(graph));
  const script = path.join(__dirname, '..', '.claude', 'scripts', 'naming-clusters.js');
  execFileSync(process.execPath, [script], { cwd: dir });
  const out = fs.readFileSync(path.join(dir, 'specs', 'brownfield', 'naming-clusters.md'), 'utf8');
  assert.match(out, /Account/);
});

test('CLI: exits 2 when no code-graph.json exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-clusters-'));
  const script = path.join(__dirname, '..', '.claude', 'scripts', 'naming-clusters.js');
  let code = 0;
  try {
    execFileSync(process.execPath, [script], { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/naming-clusters.test.js`
Expected: FAIL — `Cannot find module '.../.claude/hooks/lib/naming-clusters.js'`

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/lib/naming-clusters.js`:

```js
'use strict';

// Deterministic evidence for brownfield's Step 6 domain glossary: clusters
// recurring root nouns across symbol names so the LLM confirms candidate
// domain terms into CONTEXT.md instead of inventing them from an open-ended
// source read. Mirrors modularity-pack.js's split: this module extracts
// evidence, the brownfield skill's LLM pass judges it against the source.

const ROLE_SUFFIX_RE = /(Controller|Service|Repository|Repo|Handler|Manager|Provider|Factory|Client|Adapter|Dto|DTO|Model|Entity|Schema|Serializer|Validator|Resolver|Middleware)$/;

function stripRoleSuffix(symbol) {
  return String(symbol).replace(ROLE_SUFFIX_RE, '');
}

function isCandidateRoot(root) {
  return typeof root === 'string' && root.length > 1 && /^[A-Z][a-zA-Z0-9]*$/.test(root);
}

// Returns [{ term, count, evidence: [{ symbol, path }] }], sorted by count desc.
function clusterNamingEvidence(graph, { minCount = 2 } = {}) {
  const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
  const clusters = new Map();
  for (const node of nodes) {
    const symbols = Array.isArray(node.symbols) ? node.symbols : [];
    for (const symbol of symbols) {
      const root = stripRoleSuffix(symbol);
      if (!isCandidateRoot(root)) continue;
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push({ symbol, path: node.path || node.id });
    }
  }
  return [...clusters.entries()]
    .map(([term, evidence]) => ({ term, count: evidence.length, evidence }))
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count);
}

function renderCandidates(clusters) {
  if (!clusters.length) return 'No recurring domain-term clusters found (each root noun appears in fewer than 2 symbols).';
  const lines = ['Candidate domain terms (root noun appears across multiple symbols):', ''];
  for (const c of clusters) {
    const examples = c.evidence.slice(0, 5).map((e) => `\`${e.symbol}\` (${e.path})`).join(', ');
    lines.push(`- **${c.term}** — ${c.count} symbol(s): ${examples}`);
  }
  return lines.join('\n');
}

module.exports = { stripRoleSuffix, isCandidateRoot, clusterNamingEvidence, renderCandidates };
```

Create `.claude/scripts/naming-clusters.js`:

```js
#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/naming-clusters.js
// Deterministic evidence for brownfield Step 6 (domain glossary): clusters
// recurring root nouns from specs/brownfield/code-graph.json's symbol lists
// and writes specs/brownfield/naming-clusters.md for the brownfield skill's
// LLM pass to confirm into CONTEXT.md. Exit 0 = written, 2 = no graph.

const fs = require('fs');
const path = require('path');
const { clusterNamingEvidence, renderCandidates } = require('../hooks/lib/naming-clusters');

const REPO = process.cwd();
const GRAPH = path.join(REPO, 'specs', 'brownfield', 'code-graph.json');
const OUT = path.join(REPO, 'specs', 'brownfield', 'naming-clusters.md');

function main() {
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  } catch (err) {
    process.stderr.write(`naming-clusters: no code-graph at ${GRAPH} — run /code-map or /brownfield first.\n`);
    process.exit(2);
  }
  const clusters = clusterNamingEvidence(graph);
  fs.writeFileSync(OUT, renderCandidates(clusters) + '\n');
  process.stdout.write(`naming-clusters OK: ${clusters.length} candidate term(s) → specs/brownfield/naming-clusters.md\n`);
  process.exit(0);
}

if (require.main === module) main();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/naming-clusters.test.js`
Expected: PASS

- [ ] **Step 5: Register `naming-clusters` in the harness manifest**

This repo's own convention (`modularity-pack.js`, a deterministic evidence-extraction script) is to register every such script as its own manifest sensor, not just the inferential review it feeds. Follow that precedent so `naming-clusters.js` isn't an orphaned script outside the registry `HARNESS.md` renders.

Append to `test/harness-manifest.test.js` (after the `vocabulary-check sensor is active and wired` test added in Task 2):

```js
test('naming-clusters sensor is active and wired', () => {
  const sensor = manifest.sensors.find((s) => s.id === 'naming-clusters');
  assert.ok(sensor, 'expected naming-clusters sensor');
  assert.strictEqual(sensor.axis, 'traceability');
  assert.strictEqual(sensor.type, 'computational');
  assert.strictEqual(sensor.cadence, 'planning');
  assert.strictEqual(sensor.status, 'active');
  assert.strictEqual(sensor.scope, 'repo');
  assert.strictEqual(sensor.wired_at, '.claude/scripts/naming-clusters.js');
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, sensor.wired_at)),
    'naming-clusters wired_at file must exist'
  );
});
```

Run: `node --test test/harness-manifest.test.js` — expect this new test to FAIL (`expected naming-clusters sensor`).

In `harness-manifest.json`, find the `coupling-report` sensor entry (`{ "id": "coupling-report", "axis": "maintainability", ...`) and insert this new entry immediately after it:

```json
{ "id": "naming-clusters", "axis": "traceability", "type": "computational", "cadence": "planning", "status": "active", "scope": "repo", "wired_at": ".claude/scripts/naming-clusters.js", "signal": "root nouns recurring across 2+ symbols in code-graph.json", "description": "Deterministic evidence extraction (mirrors modularity-pack.js's split) for brownfield Step 6: surfaces candidate domain terms with file:line evidence for the LLM to confirm into CONTEXT.md, instead of open-ended judgment on a full source read." },
```

Run: `node --test test/harness-manifest.test.js` — expect PASS. Run `node .claude/scripts/validate-harness-manifest.js` — expect `harness-manifest OK: ...` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/lib/naming-clusters.js .claude/scripts/naming-clusters.js test/naming-clusters.test.js harness-manifest.json test/harness-manifest.test.js
git commit -m "feat: add deterministic naming-cluster evidence for brownfield glossary extraction"
```

---

### Task 4: Seed the glossary at BRD time

**Files:**
- Modify: `.claude/skills/brd/SKILL.md:262-264` (Step 2.8 Rules block)
- Test: `test/vocabulary-wiring.test.js` (new file — created here, extended by later tasks)

**Interfaces:**
- Consumes: nothing from earlier tasks (prompt-text-only change).
- Produces: the wiring-test convention (`REPO_ROOT`, file-read helper) that Tasks 5, 6, 7 append to in the same file.

- [ ] **Step 1: Write the failing test**

Create `test/vocabulary-wiring.test.js`:

```js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

test('/brd seeds CONTEXT.md from domain_concepts', () => {
  const brd = read('.claude/skills/brd/SKILL.md');
  assert.match(brd, /Seed the domain glossary/);
  assert.match(brd, /CONTEXT\.md/);
  assert.match(brd, /domain_concepts/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: FAIL — `Seed the domain glossary` not found in `brd/SKILL.md`

- [ ] **Step 3: Edit `brd/SKILL.md`**

Find this text in `.claude/skills/brd/SKILL.md` (the end of the Step 2.8 Rules list):

```
- **Risk & Gap Table** records risks and missing inputs without turning them into hidden implementation scope.

If this pack exposes a dropped requirement, unresolved high-risk ambiguity, or uncovered acceptance criterion, fix the interview/clarification log before proceeding. Do not paper over it in the BRD.
```

Replace it with:

```
- **Risk & Gap Table** records risks and missing inputs without turning them into hidden implementation scope.

**Seed the domain glossary.** After writing `domain_concepts`, create or update `CONTEXT.md` at the repo root from it: for each entry, add or update a `### <name>` heading under `## Terms` using `notes` as the definition (use the template at `.claude/templates/context.template.md` if `CONTEXT.md` does not exist yet). Do this for greenfield BRDs too — `CONTEXT.md` must exist after this step whenever `domain_concepts` is non-empty, which it always is. If `/brownfield` already created `CONTEXT.md`, merge into it rather than overwriting existing terms.

If this pack exposes a dropped requirement, unresolved high-risk ambiguity, or uncovered acceptance criterion, fix the interview/clarification log before proceeding. Do not paper over it in the BRD.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/brd/SKILL.md test/vocabulary-wiring.test.js
git commit -m "feat: seed CONTEXT.md glossary from BRD domain_concepts"
```

---

### Task 5: Required glossary read/write in `/spec` and `/design`

**Files:**
- Modify: `.claude/skills/spec/SKILL.md:42` (end of Step 1)
- Modify: `.claude/skills/design/SKILL.md:298` (Step 0.5), `:399` (after the Canvas structure gate, Step 1.9), `:487` (Gotchas)
- Modify: `.claude/skills/design/references/reasons-canvas-template.md:15` (Entities section)
- Modify: `test/vocabulary-wiring.test.js` (append)

**Interfaces:**
- Consumes: `.claude/scripts/vocabulary-check.js` (Task 1) — its CLI invocation is added to `design/SKILL.md`'s Step 1.9 gate.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `test/vocabulary-wiring.test.js`:

```js
test('/spec requires reading CONTEXT.md and reusing its terms before writing stories', () => {
  const spec = read('.claude/skills/spec/SKILL.md');
  assert.match(spec, /Read the domain glossary/);
  assert.match(spec, /CONTEXT\.md/);
});

test('/design requires a glossary read before naming entities, and runs the vocabulary-check gate', () => {
  const design = read('.claude/skills/design/SKILL.md');
  assert.match(design, /Required glossary read/);
  assert.match(design, /vocabulary-check\.js/);
  assert.match(design, /vocabulary-consistency gate/);
});

test('REASONS Canvas Entities section requires CONTEXT.md term reuse', () => {
  const canvas = read('.claude/skills/design/references/reasons-canvas-template.md');
  assert.match(canvas, /CONTEXT\.md/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: 3 new FAILs (spec/design/canvas text not yet present), 1 PASS (Task 4's test)

- [ ] **Step 3: Edit `spec/SKILL.md`**

Find this text in `.claude/skills/spec/SKILL.md` (end of Step 1):

```
Use the analysis pack this way:
- Use `ambiguity_table` to avoid converting unresolved ambiguity into implementation scope. A high-risk deferred ambiguity should become `needs_breakdown` or an explicit Open Question, not a guessed story.
- Use `edge_case_table` to create acceptance criteria for failure, empty, limit, concurrency, and security/privacy paths.
- Use `ac_coverage_matrix` to preserve every source requirement's observable acceptance criterion.
- Use `risk_gap_table` to tag stories that need human review, explicit non-goals, or later release deferral.
```

Replace it with:

```
Use the analysis pack this way:
- Use `ambiguity_table` to avoid converting unresolved ambiguity into implementation scope. A high-risk deferred ambiguity should become `needs_breakdown` or an explicit Open Question, not a guessed story.
- Use `edge_case_table` to create acceptance criteria for failure, empty, limit, concurrency, and security/privacy paths.
- Use `ac_coverage_matrix` to preserve every source requirement's observable acceptance criterion.
- Use `risk_gap_table` to tag stories that need human review, explicit non-goals, or later release deferral.

**Read the domain glossary.** If `CONTEXT.md` exists, read it before writing story titles, descriptions, or acceptance criteria. Reuse its terms verbatim — do not introduce a new name for a concept `CONTEXT.md` already defines. If a story needs a domain concept not yet in `CONTEXT.md`, add a `### <term>` entry there before finalizing the story.
```

- [ ] **Step 4: Edit `design/SKILL.md` — Step 0.5 required read**

Find this text (end of Step 0.5):

```
Use the clarification budget:
- Ask at most 10 questions by default.
- Continue to 15 only if the user explicitly asks.
- Prefer existing code, `CONTEXT.md`, ADRs, stories, and manifest data over asking.
- Record assumptions in `architecture.md` or `api-contracts.md` when risk is low.

## Step 0.7 — Pre-Code Modularity Assessment
```

Replace it with:

```
Use the clarification budget:
- Ask at most 10 questions by default.
- Continue to 15 only if the user explicitly asks.
- Prefer existing code, `CONTEXT.md`, ADRs, stories, and manifest data over asking.
- Record assumptions in `architecture.md` or `api-contracts.md` when risk is low.

**Required glossary read.** Before the planner names any entity, read `CONTEXT.md` if present. Every entity in `data-models.schema.json`, `api-contracts.schema.json`, and the REASONS Canvas `Entities` section must use `CONTEXT.md`'s term for that concept. A new domain concept goes into `CONTEXT.md` first (add a `### <term>` entry), then into the schema — never invent a name in the schema alone.

## Step 0.7 — Pre-Code Modularity Assessment
```

- [ ] **Step 5: Edit `design/SKILL.md` — Step 1.9 vocabulary-consistency gate**

Find this text (the Canvas structure gate block):

```
Also run the **Canvas structure gate** (deterministic, always — the Canvas ships in every design):

```bash
node .claude/scripts/validate-canvas.js specs/design/reasons-canvas.md
```

A non-zero exit (a missing REASONS section, or a `Governs` list with no source paths) **BLOCKS** — fix the Canvas before Step 2. The `Governs` list must be non-empty so the drift monitor can detect Canvas↔code drift later.

> **Living artifact — fix the prompt first (gap G4).**
```

Replace it with:

```
Also run the **Canvas structure gate** (deterministic, always — the Canvas ships in every design):

```bash
node .claude/scripts/validate-canvas.js specs/design/reasons-canvas.md
```

A non-zero exit (a missing REASONS section, or a `Governs` list with no source paths) **BLOCKS** — fix the Canvas before Step 2. The `Governs` list must be non-empty so the drift monitor can detect Canvas↔code drift later.

Also run the **vocabulary-consistency gate** (deterministic; skip only when `CONTEXT.md` does not exist yet):

```bash
node .claude/scripts/vocabulary-check.js \
  --glossary CONTEXT.md \
  --domain-concepts specs/brd/brd-analysis.json \
  --data-models specs/design/data-models.schema.json \
  --api-contracts specs/design/api-contracts.schema.json \
  --out specs/reviews/vocabulary-check.json
```

A non-zero exit means an entity or field name in `domain_concepts`, `data-models.schema.json`, or `api-contracts.schema.json` has no matching term in `CONTEXT.md` — add the missing term to `CONTEXT.md` (or fix the name to match an existing one) before Step 2. This is the deterministic backstop for the API-shape-divergence gotcha below.

> **Living artifact — fix the prompt first (gap G4).**
```

- [ ] **Step 6: Edit `design/SKILL.md` — Gotchas**

Find this text in the Gotchas section:

```
- **API shape divergence.** The planner and generator run concurrently and may independently invent field names. The evaluator (artifact mode) gate exists specifically to catch this. Never skip it.
```

Replace it with:

```
- **API shape divergence.** The planner and generator run concurrently and may independently invent field names. Both must read `CONTEXT.md` before naming entities — that is the primary defense. `vocabulary-check.js` (Step 1.9) and the evaluator (artifact mode) gate are the deterministic and inferential backstops that catch what slips through — never skip either.
```

- [ ] **Step 7: Edit `reasons-canvas-template.md` — Entities section**

Find this text in `.claude/skills/design/references/reasons-canvas-template.md`:

```
## Entities
The domain entities, their relationships, and business rules — a Mermaid `classDiagram` plus prose. **In brownfield** (when `specs/brownfield/code-graph.json` exists), mark each entity **existing** (cite the code-graph node) or **new**, so the design extends real code instead of re-inventing it.
```

Replace it with:

```
## Entities
The domain entities, their relationships, and business rules — a Mermaid `classDiagram` plus prose. Entity names must match `CONTEXT.md` terms exactly; a new domain concept is added to `CONTEXT.md` first, then reflected here and in the schemas — never invented in the Canvas or schema alone. **In brownfield** (when `specs/brownfield/code-graph.json` exists), mark each entity **existing** (cite the code-graph node) or **new**, so the design extends real code instead of re-inventing it.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/spec/SKILL.md .claude/skills/design/SKILL.md .claude/skills/design/references/reasons-canvas-template.md test/vocabulary-wiring.test.js
git commit -m "feat: require CONTEXT.md glossary reads and add vocabulary-check gate to /spec and /design"
```

---

### Task 6: Required glossary read/write in `/implement` and `generator.md`

**Files:**
- Modify: `.claude/skills/implement/SKILL.md` (Step 4 — Load Learned Rules)
- Modify: `.claude/agents/generator.md` (Inputs, Step 1, Step 3 teammate-prompt list)
- Modify: `test/vocabulary-wiring.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `test/vocabulary-wiring.test.js`:

```js
test('/implement requires reading CONTEXT.md alongside learned rules', () => {
  const implement = read('.claude/skills/implement/SKILL.md');
  assert.match(implement, /CONTEXT\.md/);
});

test('generator.md lists CONTEXT.md as an input, reads it in Step 1, and passes it to teammates', () => {
  const generator = read('.claude/agents/generator.md');
  const contextMentions = generator.match(/CONTEXT\.md/g) || [];
  assert.ok(contextMentions.length >= 3, `expected >=3 CONTEXT.md mentions (Inputs, Step 1, teammate prompt), got ${contextMentions.length}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: 2 new FAILs, 4 PASS (from Tasks 4-5)

- [ ] **Step 3: Edit `implement/SKILL.md` — Step 4**

Find this text:

```
### Step 4 — Load Learned Rules

Read `.claude/state/learned-rules.md`. Inject ALL rules verbatim into every teammate spawn prompt. Learned rules include anti-pattern code examples and better approach code — teammates must study these before writing code, not just read the rule text. Rules represent project-specific decisions made during previous sprints (naming conventions, library choices, API patterns). Skipping this step causes regressions.
```

Replace it with:

```
### Step 4 — Load Learned Rules

Read `.claude/state/learned-rules.md`. Inject ALL rules verbatim into every teammate spawn prompt. Learned rules include anti-pattern code examples and better approach code — teammates must study these before writing code, not just read the rule text. Rules represent project-specific decisions made during previous sprints (naming conventions, library choices, API patterns). Skipping this step causes regressions.

Also read `CONTEXT.md` when present and inject it into every teammate spawn prompt alongside learned rules. Schema field names are already authoritative for API/data fields; `CONTEXT.md` is authoritative for naming everything else — services, aggregates, business rules. If a teammate's story requires a domain concept not yet in `CONTEXT.md`, add a `### <term>` entry there before Step 6's validation gate.
```

- [ ] **Step 4: Edit `generator.md` — Inputs**

Find this text:

```
## Inputs

- Ready stories from `specs/stories/E{n}-S{n}.md`
- Component map from `specs/design/component-map.md`
- API contracts from `specs/design/api-contracts.schema.json`
- Data models from `specs/design/data-models.schema.json`
- Architecture from `specs/design/architecture.md`
```

Replace it with:

```
## Inputs

- Ready stories from `specs/stories/E{n}-S{n}.md`
- Component map from `specs/design/component-map.md`
- API contracts from `specs/design/api-contracts.schema.json`
- Data models from `specs/design/data-models.schema.json`
- Domain glossary from `CONTEXT.md` when present — authoritative for naming domain concepts (services, aggregates, business rules) not yet represented as a schema field
- Architecture from `specs/design/architecture.md`
```

- [ ] **Step 5: Edit `generator.md` — Step 1**

Find this text:

```
### Step 1: Read Learned Rules
- Read `.claude/state/learned-rules.md`
- Read `.claude/skills/code-gen/SKILL.md`
- Invoke `superpowers:test-driven-development` — follow the red-green-refactor cycle for every function
- Note any rules relevant to the current sprint group
```

Replace it with:

```
### Step 1: Read Learned Rules
- Read `.claude/state/learned-rules.md`
- Read `.claude/skills/code-gen/SKILL.md`
- Read `CONTEXT.md` when present. Schema field names (`data-models.schema.json`, `api-contracts.schema.json`) are already authoritative for API/data fields; `CONTEXT.md` is authoritative for everything else — services, aggregates, business rules. Name new classes/variables/services after its terms, not a freely invented synonym.
- Invoke `superpowers:test-driven-development` — follow the red-green-refactor cycle for every function
- Note any rules relevant to the current sprint group

If a story requires a domain concept not yet in `CONTEXT.md`, add a `### <term>` entry there (with a one-line definition) before marking the story's teammate work complete.
```

- [ ] **Step 6: Edit `generator.md` — Step 3 teammate prompt list**

Find this text:

```
**Teammate prompt must include:**
- Story acceptance criteria
- File ownership (which files this teammate may edit)
- Learned rules (from `.claude/state/learned-rules.md`)
```

Replace it with:

```
**Teammate prompt must include:**
- Story acceptance criteria
- File ownership (which files this teammate may edit)
- Learned rules (from `.claude/state/learned-rules.md`)
- Domain glossary (`CONTEXT.md`) when present — teammates must name new domain concepts after its terms, not invent synonyms
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/implement/SKILL.md .claude/agents/generator.md test/vocabulary-wiring.test.js
git commit -m "feat: require CONTEXT.md glossary reads in /implement and generator.md"
```

---

### Task 7: Brownfield Step 6 fed by deterministic naming-cluster evidence

**Files:**
- Modify: `.claude/skills/brownfield/SKILL.md:54` (artifact table), `:201-219` (Step 6)
- Modify: `test/vocabulary-wiring.test.js` (append)

**Interfaces:**
- Consumes: `.claude/scripts/naming-clusters.js` (Task 3) — invoked from `brownfield/SKILL.md` Step 6.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `test/vocabulary-wiring.test.js`:

```js
test('/brownfield Step 6 runs naming-clusters.js before writing CONTEXT.md', () => {
  const brownfield = read('.claude/skills/brownfield/SKILL.md');
  assert.match(brownfield, /naming-clusters\.js/);
  assert.match(brownfield, /naming-clusters\.md/);
  assert.doesNotMatch(brownfield, /Optional domain glossary, created only when meaningful domain terms are discovered/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: FAIL — `naming-clusters.js` not found in `brownfield/SKILL.md`

- [ ] **Step 3: Edit the artifact table**

Find this text in `.claude/skills/brownfield/SKILL.md`:

```
| `specs/brownfield/seams-<goal>.md` | Optional ranked seam candidates produced by `/seam-finder "<goal>"` |
| `CONTEXT.md` | Optional domain glossary, created only when meaningful domain terms are discovered |
```

Replace it with:

```
| `specs/brownfield/seams-<goal>.md` | Optional ranked seam candidates produced by `/seam-finder "<goal>"` |
| `specs/brownfield/naming-clusters.md` | Deterministic root-noun clusters from `code-graph.json` symbols — candidate domain terms for Step 6 |
| `CONTEXT.md` | Domain glossary, seeded from naming-cluster evidence and confirmed against source — no longer purely optional; see Step 6 |
```

- [ ] **Step 4: Edit Step 6**

Find this text (all of Step 6):

```
## Step 6 — Domain Glossary

If recurring domain terms are discovered, create or update `CONTEXT.md`.

Keep it domain-level:

```markdown
# Context

## Terms

### Account
Definition meaningful to users/domain experts.

### User
Definition and how it differs from Account.
```

Do not fill `CONTEXT.md` with implementation details.
```

Replace it with:

```
## Step 6 — Domain Glossary

Run the deterministic naming-cluster extraction before writing anything:

```bash
node .claude/scripts/naming-clusters.js
```

This writes `specs/brownfield/naming-clusters.md` — root nouns that recur across 2+ symbols in `code-graph.json` (e.g. `Account` appearing in `AccountController`, `AccountRepository`, `AccountService`), each with file evidence. Treat this as candidate terms to confirm, not a final glossary — judge each against the source before writing a definition. It only catches suffix-stripped symbol names, not terms embedded purely in prose or comments, so also add any other recurring domain terms you find in the source.

Create or update `CONTEXT.md` from the confirmed candidates:

```markdown
# Context

## Terms

### Account
Definition meaningful to users/domain experts.

### User
Definition and how it differs from Account.
```

Do not fill `CONTEXT.md` with implementation details. Every codebase produces at least the naming-clusters evidence file, so create `CONTEXT.md` even if only 1-2 terms are confirmed — it is no longer purely optional.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/vocabulary-wiring.test.js`
Expected: PASS (all 7 tests)

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/brownfield/SKILL.md test/vocabulary-wiring.test.js
git commit -m "feat: feed brownfield glossary extraction from deterministic naming-cluster evidence"
```

---

### Task 8: Full verification sweep

**Files:** None created or modified — this task only runs verification across everything Tasks 1-7 touched.

**Interfaces:** None.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including `test/vocabulary-check.test.js`, `test/naming-clusters.test.js`, `test/vocabulary-wiring.test.js`, and `test/harness-manifest.test.js`.

If the working tree contains stray iCloud-sync duplicate files (` 2.` suffix) that hang `scaffold-copy`/`skills-consistency` tests, per this repo's own CLAUDE.md guidance: kill orphaned `node --test` processes and delete the duplicates, then re-run.

- [ ] **Step 2: Validate the harness manifest standalone**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: `harness-manifest OK: N guides, M sensors, all wired_at paths resolve.` (exit 0)

- [ ] **Step 3: Spot-check the sensor against a real fixture**

Run against this repo's own (if any) `CONTEXT.md`/`specs/brd/brd-analysis.json`, or a scratch fixture, to confirm the CLI's stdout summary reads sensibly:

```bash
node .claude/scripts/vocabulary-check.js --glossary CONTEXT.md --domain-concepts specs/brd/brd-analysis.json --data-models specs/design/data-models.schema.json --api-contracts specs/design/api-contracts.schema.json --out /tmp/vocab-check-spotcheck.json 2>&1 || true
```

Expected: either exit 2 with a clear "no glossary" message (this repo is the harness itself, not a generated project, so it has no `CONTEXT.md`/`specs/`) — confirming the loud-degrade behavior from the spec's Risks section — or a verdict if those paths happen to exist.

- [ ] **Step 4: Final review against the spec**

Re-read `docs/superpowers/specs/2026-07-05-ubiquitous-language-design.md` section by section and confirm each is implemented:
- Artifact Contract → Task 4 (no template change needed, confirmed unchanged)
- Generation Flow `/brd` → Task 4
- Generation Flow `/spec` → Task 5
- Generation Flow `/design` → Task 5
- Generation Flow `/implement` and `generator.md` → Task 6
- New Sensor `vocabulary-check.js` → Task 1
- Harness Manifest → Task 2
- Brownfield Determinism → Task 3, Task 7
- Tests → Tasks 1, 2, 3, 4, 5, 6, 7

No step in this task modifies files — it is a checklist confirmation. If any spec section lacks a corresponding completed task, stop and add a task before considering this plan done.
