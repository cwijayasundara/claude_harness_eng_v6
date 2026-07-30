# Sprint/Story Evolution Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the harness a design-delta lane — `/sprint` (PRD intake) and `/feature` (story intake) both feed a shared `/design --delta` stage that amends the living `specs/design/` baseline instead of regenerating it, gated on a human-reviewable diff before any code generation.

**Architecture:** Two new deterministic scripts (impact-classifier, amendment-provenance-check) modeled on existing `seam-confidence.js`/`ownership-check.js`; a `design-delta` phase added to `phase-eval-rubrics.json`; three new mode-branches added to existing skills (`brd --delta`, `spec` sprint addendum, `design --delta` / `--baseline-recovery`); one new conductor skill (`/sprint`); wiring edits to `/build`, `/feature`, the pre-commit hook, `pipeline-status`, `HARNESS.md`/`harness-manifest.json`, and `README.md`.

**Tech Stack:** Plain CommonJS Node scripts (no build step), `node:test` + `assert` for tests, Markdown skill prompts (Claude Code plugin convention).

**Grounded in:** `docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md` (approved design) and the existing repo conventions verified by direct reads of `design/SKILL.md`, `brd/SKILL.md`, `spec/SKILL.md`, `feature/SKILL.md`, `build/SKILL.md`, `phase-eval-rubrics.json`, `evaluator.md`, `trace-check.js`, `ownership-check.js` (+ test), `contract-drift-gate.js`, `seam-confidence.js`, `scaffold-apply.js`, `pre-commit`, `pipeline-snapshot.js`, `HARNESS.md`, `harness-manifest.json`, `README.md`.

## Global Constraints

- No new npm dependencies — every new script is plain CommonJS using only Node built-ins (`fs`, `path`, `child_process`), matching every existing `.claude/scripts/*.js`.
- Every new script exports a pure core function separately from its CLI (`module.exports = { ... }`, `if (require.main === module) main()`), matching `trace-check.js` / `ownership-check.js` / `seam-confidence.js`.
- Tests use `node:test` + `assert` only (no external test framework), run via `node --test test/<name>.test.js`, and must pass in the full suite `npm test`.
- Never hand-build a fixture that stands in for a real schema/validator — round-trip through the real script/validator, per this repo's CLAUDE.md principle #5.
- Any new gate/sensor must be registered in `HARNESS.md` + `harness-manifest.json` (Task 11) and pass `node .claude/scripts/validate-harness-manifest.js`.
- Skill-description convention: `/sprint` is a top-level entry point like `/build`/`/feature` — no `[Internal pipeline stage — ...]` prefix. Mode additions inside `brd`/`spec`/`design` SKILL.md keep those files' existing `[Internal pipeline stage ...]` prefix unchanged.
- Commit after every task (small, reviewable commits) — do not batch multiple tasks into one commit.

---

### Task 1: Constitution template + scaffold wiring

**Files:**
- Create: `.claude/templates/constitution-template.md`
- Modify: `.claude/scripts/scaffold-apply.js:167-179` (`copyStarterFiles` map + `report()` output line)
- Modify: `.claude/commands/scaffold.md` (insert a new subsection after line 519, before `## Step 4: Create Output Directories`)
- Test: `test/scaffold-copy.test.js` (new test block)

**Interfaces:**
- Produces: `specs/design/constitution.md` in every scaffolded project (unconditional, like the security starter files) — consumed by Task 5's `/design --delta` mode and Task 4's `design-delta` rubric.

- [ ] **Step 1: Write the constitution template**

Create `.claude/templates/constitution-template.md`:

```markdown
# Architecture Constitution

Cross-sprint invariants this system must never violate — the rules a design
amendment is checked against every sprint, not just the rules for right now.
Human-owned. Edit this file like code: a change to an invariant is itself an
architectural decision and should go through normal PR review.

First authored at sprint-1 design approval. Revisit at each sprint boundary —
`/design --delta`'s design-delta rubric checks every amendment against the
`## Invariants` list below as a hard criterion; violating one fails the
amendment regardless of its weighted score.

## Invariants

<!-- One line per invariant, each independently checkable against a diff or an
     amendment narrative. Delete this comment once populated. Examples: -->

- All schema changes use expand-contract; no destructive migration ships in the same sprint that removes the old column/field.
- Services communicate only through their published API contracts; no service reads another service's database directly.
- Public-facing APIs are REST/JSON only; no GraphQL or gRPC surface for external consumers.

## Amendment History

<!-- Append one line per sprint whenever an invariant is added, changed, or
     removed. Never delete a line — this is the audit trail for why the
     constitution looks the way it does. -->

- Sprint 1: initial invariants established at design approval.
```

- [ ] **Step 2: Wire the copy into `scaffold-apply.js`**

In `.claude/scripts/scaffold-apply.js`, edit the `copyStarterFiles` function (lines 167-179) to add one entry to the `map` array:

```javascript
function copyStarterFiles(target, src) {
  const map = [
    ['templates/mcp-config.template.json', '.mcp.json'],
    ['templates/claude-security-guidance.template.md', '.claude/claude-security-guidance.md'],
    ['templates/security-patterns.template.yaml', '.claude/security-patterns.yaml'],
    ['templates/gitignore.template', '.gitignore'],
    ['templates/constitution-template.md', 'specs/design/constitution.md'],
  ];
  for (const [from, to] of map) {
    const toPath = path.join(target, to);
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.copyFileSync(requireTemplate(src, from), toPath);
  }
}
```

(The loop's own `fs.mkdirSync(path.dirname(toPath), { recursive: true })` creates `specs/design/` on demand — no reordering relative to `makeDirs()` needed.)

Then update the `report()` function's fixed status line (around line 266) so headless output stays accurate:

```javascript
  process.stdout.write('  wrote .mcp.json, .gitignore, .claude/claude-security-guidance.md, .claude/security-patterns.yaml, specs/design/constitution.md\n');
```

- [ ] **Step 3: Document the copy in the interactive `/scaffold` command**

In `.claude/commands/scaffold.md`, insert a new subsection immediately after the existing "Generate Security Threat-Model Files" block (after line 519, before `## Step 4: Create Output Directories` at line 521):

```markdown
### Generate the Architecture Constitution

Copy the constitution starter file — the cross-sprint invariants `/sprint`'s
design-delta gate checks every amendment against:

```bash
cp $PLUGIN_SOURCE/templates/constitution-template.md specs/design/constitution.md
```

Tell the user this file starts empty (example invariants only) and should be
filled in once the sprint-1 design is approved — it is reviewed like code at
every sprint boundary.
```

- [ ] **Step 4: Write the failing test**

In `test/scaffold-copy.test.js`, add a new test block after the existing `for (const profile of ['core', 'brownfield', 'full'])` loop (after line 93):

```javascript
for (const profile of ['core', 'brownfield', 'full']) {
  test(`scaffold (${profile}) copies the architecture constitution template`, () => {
    const { workDir, target } = scaffoldInto(profile);
    try {
      const constPath = path.join(target, 'specs', 'design', 'constitution.md');
      assert.ok(fs.existsSync(constPath), 'specs/design/constitution.md must be copied by scaffold-apply');
      const body = fs.readFileSync(constPath, 'utf8');
      assert.ok(body.includes('## Invariants'), 'constitution.md must carry the Invariants section');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/scaffold-copy.test.js`
Expected: all tests PASS, including the new ones for `core`/`brownfield`/`full`.

- [ ] **Step 6: Commit**

```bash
git add .claude/templates/constitution-template.md .claude/scripts/scaffold-apply.js .claude/commands/scaffold.md test/scaffold-copy.test.js
git commit -m "feat: scaffold an architecture constitution template for cross-sprint invariants"
```

---

### Task 2: Impact-classifier script

**Files:**
- Create: `.claude/scripts/impact-classifier.js`
- Test: `test/impact-classifier.test.js`

**Interfaces:**
- Produces: `classifyImpact({ storyText, files, graph }) -> { classification: 'design-touching'|'invisible', touched_files, risk_categories, new_modules, reasons }` — consumed by Task 10 (`/feature`'s scope routing).

- [ ] **Step 1: Write the failing test**

Create `test/impact-classifier.test.js`:

```javascript
'use strict';

const assert = require('assert');
const { test } = require('node:test');

const SCRIPT = require.resolve('../.claude/scripts/impact-classifier');
const { classifyImpact, extractFilePaths, riskHits, FILE_THRESHOLD } = require(SCRIPT);

test('extractFilePaths pulls backticked file-like tokens from story text', () => {
  const text = 'Touches `src/api/users.py` and `src/ui/App.tsx`, not `some phrase`.';
  const files = extractFilePaths(text);
  assert.deepStrictEqual(files.sort(), ['src/api/users.py', 'src/ui/App.tsx']);
});

test('riskHits flags an auth-related story', () => {
  assert.deepStrictEqual(riskHits('Add a password reset flow with session tokens'), ['auth']);
});

test('riskHits returns empty for an unrelated story', () => {
  assert.deepStrictEqual(riskHits('Add a footer link to the about page'), []);
});

test('a story touching more than FILE_THRESHOLD files classifies as design-touching', () => {
  const files = ['a.py', 'b.py', 'c.py', 'd.py'];
  assert.ok(files.length > FILE_THRESHOLD);
  const v = classifyImpact({ storyText: 'trivial change', files, graph: null });
  assert.strictEqual(v.classification, 'design-touching');
  assert.match(v.reasons.join(' '), /touches 4 files/);
});

test('a small, risk-free, existing-module story classifies as invisible', () => {
  const graph = { nodes: [{ path: 'src/ui/Footer.tsx' }] };
  const v = classifyImpact({ storyText: 'Add a footer link', files: ['src/ui/Footer.tsx'], graph });
  assert.strictEqual(v.classification, 'invisible');
});

test('a payments-related story classifies as design-touching regardless of file count', () => {
  const v = classifyImpact({ storyText: 'Add a new billing charge endpoint', files: ['src/api/billing.py'], graph: null });
  assert.strictEqual(v.classification, 'design-touching');
  assert.match(v.reasons.join(' '), /payments/);
});

test('a file with no sibling in the code graph is flagged as a new module', () => {
  const graph = { nodes: [{ path: 'src/api/users.py' }] };
  const v = classifyImpact({ storyText: 'Add a notifications worker', files: ['src/workers/notify.py'], graph });
  assert.strictEqual(v.classification, 'design-touching');
  assert.deepStrictEqual(v.new_modules, ['src/workers/notify.py']);
});

test('classifyImpact with no graph never crashes on new-module detection', () => {
  const v = classifyImpact({ storyText: 'trivial', files: ['x.py'], graph: null });
  assert.strictEqual(v.classification, 'invisible');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/impact-classifier.test.js`
Expected: FAIL with `Cannot find module '../.claude/scripts/impact-classifier'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/impact-classifier.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Impact classifier for /feature (design spec 2026-07-04-sprint-delta-lane-design.md,
// §1). Decides whether a story is architecturally invisible (-> /change, no design
// amendment) or design-touching (-> /design --delta, amendment + GATE 2). Modeled on
// seam-confidence.js: a pure scoring function + thin CLI wrapper. Advisory only —
// always exits 0; it routes work, it does not block a build.

const fs = require('fs');
const path = require('path');

const RISK_PATTERNS = [
  { name: 'auth', re: /\b(auth|authn|authz|login|session|token|password)\b/i },
  { name: 'payments', re: /\b(payment|billing|invoice|charge|stripe|subscription)\b/i },
  { name: 'persistence', re: /\b(migration|schema change|persist|database|db\.|repository)\b/i },
  { name: 'public-api-contract', re: /\b(api contract|public api|breaking change|endpoint (added|removed|changed))\b/i },
];

const FILE_THRESHOLD = 3;

function extractFilePaths(text) {
  const re = /`([^`\n]+\.[a-z]{1,4})`/gi;
  const files = new Set();
  let m;
  while ((m = re.exec(String(text))) !== null) files.add(m[1]);
  return [...files];
}

function riskHits(text) {
  return RISK_PATTERNS.filter((p) => p.re.test(String(text))).map((p) => p.name);
}

function isNewModule(file, graph) {
  if (!graph || !Array.isArray(graph.nodes)) return false;
  const dir = path.dirname(file);
  return !graph.nodes.some((n) => n.path && path.dirname(n.path) === dir);
}

// Pure core. storyText is the story markdown (or request text); files is an
// explicit override list; graph is a parsed code-graph.json (or null).
function classifyImpact({ storyText, files, graph }) {
  const touchedFiles = files && files.length ? files : extractFilePaths(storyText);
  const risks = riskHits(storyText);
  const newModules = touchedFiles.filter((f) => isNewModule(f, graph));
  const reasons = [];
  let designTouching = false;

  if (touchedFiles.length > FILE_THRESHOLD) {
    designTouching = true;
    reasons.push(`touches ${touchedFiles.length} files (> ${FILE_THRESHOLD})`);
  }
  if (risks.length) {
    designTouching = true;
    reasons.push(`risk category: ${risks.join(', ')}`);
  }
  if (newModules.length) {
    designTouching = true;
    reasons.push(`introduces new module(s): ${newModules.join(', ')}`);
  }
  if (!designTouching) reasons.push('no file-count, risk, or new-module signal — architecturally invisible');

  return {
    classification: designTouching ? 'design-touching' : 'invisible',
    touched_files: touchedFiles,
    risk_categories: risks,
    new_modules: newModules,
    reasons,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--story') args.story = argv[++i];
    else if (key === '--graph') args.graph = argv[++i];
    else if (key === '--file') args.files.push(argv[++i]);
    else if (key === '--out') args.out = argv[++i];
  }
  return args;
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.story && args.files.length === 0) {
    process.stderr.write('impact-classifier: --story <file> or --file <path> (repeatable) is required\n');
    process.exit(2);
  }
  const storyText = args.story && fs.existsSync(args.story) ? fs.readFileSync(args.story, 'utf8') : '';
  const graph = readJson(args.graph);
  const verdict = classifyImpact({ storyText, files: args.files, graph });

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n');
  }
  process.stdout.write(`impact-classifier: ${verdict.classification} — ${verdict.reasons.join('; ')}\n`);
  process.exit(0);
}

module.exports = { classifyImpact, extractFilePaths, riskHits, FILE_THRESHOLD };

if (require.main === module) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/impact-classifier.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/scripts/impact-classifier.js test/impact-classifier.test.js
git commit -m "feat: add impact-classifier script for /feature story routing"
```

---

### Task 3: Amendment-provenance-check script + pre-commit wiring

**Files:**
- Create: `.claude/scripts/amendment-provenance-check.js`
- Test: `test/amendment-provenance-check.test.js`
- Modify: `.claude/git-hooks/pre-commit` (new `checkAmendmentProvenance` gate)

**Interfaces:**
- Produces: `checkProvenance(files, baselineExists) -> { pass, verdict, design_changes, reason? }` and `run(argv, root, deps) -> exitCode` — consumed by the pre-commit hook and directly invokable at `/sprint`/`/feature` GATE 2 commit time.

- [ ] **Step 1: Write the failing test**

Create `test/amendment-provenance-check.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'amendment-provenance-check.js');
const { checkProvenance, run } = require(SCRIPT);

test('a commit touching non-design files is not-applicable', () => {
  const v = checkProvenance(['src/api/users.py', 'docs/a.md'], true);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'not-applicable');
});

test('a design change with no prior baseline is the initial-design commit (exempt)', () => {
  const v = checkProvenance(['specs/design/architecture.md', 'specs/design/api-contracts.schema.json'], false);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'initial-design');
});

test('a design change over an existing baseline with no amendment file fails loudly', () => {
  const v = checkProvenance(['specs/design/architecture.md'], true);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.verdict, 'missing_amendment');
  assert.match(v.reason, /no matching file under specs\/design\/amendments\//);
});

test('a design change paired with a new amendment file in the same commit passes', () => {
  const v = checkProvenance(
    ['specs/design/architecture.md', 'specs/design/amendments/sprint-2.md'],
    true
  );
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'amended');
  assert.deepStrictEqual(v.amendments, ['specs/design/amendments/sprint-2.md']);
});

test('a change only inside specs/design/amendments/ (no other design file touched) is not-applicable', () => {
  const v = checkProvenance(['specs/design/amendments/sprint-2.md'], true);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.verdict, 'not-applicable');
});

// --- run() CLI (injected deps, no subprocess) ---------------------------------

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amendment-provenance-'));
}

test('run --files writes the verdict and exits 1 on a missing amendment', () => {
  const dir = makeProject();
  const code = run(['--files', 'specs/design/architecture.md'], dir, { baselineExists: true });
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'amendment-provenance.json'), 'utf8'));
  assert.strictEqual(verdict.pass, false);
});

test('run --staged uses the injected exec to list staged files', () => {
  const dir = makeProject();
  const fakeExec = () => 'specs/design/architecture.md\nspecs/design/amendments/sprint-2.md\n';
  const code = run(['--staged'], dir, { exec: fakeExec, baselineExists: true });
  assert.strictEqual(code, 0);
});

test('run exits 0 for the initial-design commit', () => {
  const dir = makeProject();
  const code = run(['--files', 'specs/design/architecture.md'], dir, { baselineExists: false });
  assert.strictEqual(code, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/amendment-provenance-check.test.js`
Expected: FAIL with `Cannot find module '.../amendment-provenance-check.js'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/scripts/amendment-provenance-check.js`:

```javascript
#!/usr/bin/env node

'use strict';

// Amendment-provenance sensor (sprint-delta lane, design spec 2026-07-04 §4).
// specs/design/ is living truth; once a baseline design exists, any commit
// touching it must carry a matching record under specs/design/amendments/ —
// otherwise the evolution is invisible to the next sprint's human gate.
// Modeled on ownership-check.js: pure core + git-diff CLI wrapper, fail-loud
// on a broken control (a design change with no amendment is not a vacuous pass).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DESIGN_PREFIX = 'specs/design/';
const AMENDMENTS_PREFIX = 'specs/design/amendments/';
const BASELINE_FILE = 'specs/design/architecture.md';
const VERDICT_REL = path.join('specs', 'reviews', 'amendment-provenance.json');

function normalize(file) {
  return String(file).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

// Pure core. files = staged/changed repo-relative paths. baselineExists = true
// when BASELINE_FILE was already tracked at the commit's parent (HEAD).
function checkProvenance(files, baselineExists) {
  const normalized = files.map(normalize);
  const designChanges = normalized.filter(
    (f) => f.startsWith(DESIGN_PREFIX) && !f.startsWith(AMENDMENTS_PREFIX)
  );
  if (designChanges.length === 0) {
    return { pass: true, verdict: 'not-applicable', design_changes: [] };
  }
  if (!baselineExists) {
    return { pass: true, verdict: 'initial-design', design_changes: designChanges };
  }
  const newAmendments = normalized.filter((f) => f.startsWith(AMENDMENTS_PREFIX));
  if (newAmendments.length === 0) {
    return {
      pass: false,
      verdict: 'missing_amendment',
      design_changes: designChanges,
      reason: `${designChanges.length} file(s) under ${DESIGN_PREFIX} changed with no matching file under ${AMENDMENTS_PREFIX} in the same commit`,
    };
  }
  return { pass: true, verdict: 'amended', design_changes: designChanges, amendments: newAmendments };
}

function stagedFiles(exec) {
  const out = exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return String(out).split('\n').filter(Boolean);
}

function baselineExistsAtHead(exec) {
  try {
    exec('git', ['show', `HEAD:${BASELINE_FILE}`]);
    return true;
  } catch (_) {
    return false;
  }
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));

  let files;
  if (argv[0] === '--staged') {
    files = stagedFiles(exec);
  } else if (argv[0] === '--files') {
    files = argv.slice(1);
  } else {
    process.stderr.write('usage: amendment-provenance-check.js --staged | --files <path> [...]\n');
    return 2;
  }

  const baselineExists = (deps && 'baselineExists' in deps) ? deps.baselineExists : baselineExistsAtHead(exec);
  const verdict = checkProvenance(files, baselineExists);
  writeVerdict(root, verdict);
  const label = verdict.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`amendment-provenance: ${label} — ${verdict.verdict}${verdict.reason ? ` (${verdict.reason})` : ''}\n`);
  return verdict.pass ? 0 : 1;
}

module.exports = { checkProvenance, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/amendment-provenance-check.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Wire the gate into the pre-commit hook**

In `.claude/git-hooks/pre-commit`, add a new function after `checkOwnership` (after line 149, before the `checkRefactorPurity` comment block):

```javascript
// Amendment-provenance gate (sprint-delta lane, design spec 2026-07-04): once a
// design baseline exists, any commit touching specs/design/ must carry a
// matching record under specs/design/amendments/. Runs on ALL staged files
// (not just source) because design docs are markdown/json, not source
// extensions — same reasoning as checkSecrets. Lazy require, like checkOwnership.
function checkAmendmentProvenance(projectDir, staged) {
  if (process.env.HARNESS_AMENDMENT_GATE === 'off') {
    noteSkip('amendment-provenance', 'HARNESS_AMENDMENT_GATE=off');
    return;
  }
  let checkFn;
  try {
    ({ checkProvenance: checkFn } = require(path.join(__dirname, '..', 'scripts', 'amendment-provenance-check')));
  } catch (_) {
    noteSkip('amendment-provenance', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  let baselineExists = false;
  try {
    execFileSync('git', ['show', 'HEAD:specs/design/architecture.md'], { cwd: projectDir, encoding: 'utf8' });
    baselineExists = true;
  } catch (_) {
    baselineExists = false;
  }
  const verdict = checkFn(staged, baselineExists);
  if (!verdict.pass) {
    fail(
      `BLOCKED: ${verdict.reason}\n` +
      `Fix: write a design amendment under specs/design/amendments/ (see docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md) ` +
      `in the same commit as the specs/design/ change, or set HARNESS_AMENDMENT_GATE=off to acknowledge the skip.\n`
    );
  }
}
```

Then, in the `try` block at the bottom of the file (around line 424-446), call it **before** the `stagedSource`-only early exit — design files are markdown/json, not `SOURCE_EXTS`, so it must run on the full `staged` list like `checkSecrets`:

```javascript
try {
  const projectDir = process.cwd();
  const staged = stagedFiles();
  checkSecrets(projectDir, staged); // before the source-only exit: secrets hide in config/yaml too
  checkAmendmentProvenance(projectDir, staged); // same reason: design docs are markdown/json, not SOURCE_EXTS
  const stagedSource = staged.filter((f) => SOURCE_EXTS.has(path.extname(f).toLowerCase()));
  if (stagedSource.length === 0) process.exit(0); // docs-only commit: nothing else to gate
  ...
```

(Only these two lines change in that block — everything below `stagedSource` stays exactly as it is today.)

- [ ] **Step 6: Verify the hook still parses and existing hook tests pass**

Run: `node -c .claude/git-hooks/pre-commit` (syntax check)
Expected: no output (valid syntax).

Run: `node --test test/*.test.js test/e2e/helpers/*.test.js 2>&1 | grep -i "pre-commit\|amendment"`
Expected: no failures mentioning pre-commit or amendment-provenance.

- [ ] **Step 7: Commit**

```bash
git add .claude/scripts/amendment-provenance-check.js test/amendment-provenance-check.test.js .claude/git-hooks/pre-commit
git commit -m "feat: add amendment-provenance gate for specs/design/ changes"
```

---

### Task 4: Design-delta evaluator rubric

**Files:**
- Modify: `.claude/templates/phase-eval-rubrics.json` (new `"design-delta"` key)
- Modify: `.claude/agents/evaluator.md` (phase enum + Phase-Specific Guidance line)
- Test: `test/trace-check.test.js`-style wiring-consistency check — new test in `test/phase-eval-rubrics.test.js` if that file exists, else a new file (see Step 4)

**Interfaces:**
- Produces: `phase-eval-rubrics.json#phases.design-delta` — consumed by Task 5's `/design --delta` Step D6 (`Rubric: Read .claude/templates/phase-eval-rubrics.json, key "design-delta"`).

- [ ] **Step 1: Add the `design-delta` phase to `phase-eval-rubrics.json`**

In `.claude/templates/phase-eval-rubrics.json`, add a new key inside `"phases"` (after the closing `}` of `"design"` at line 53, before `"brownfield"`):

```json
    "design-delta": {
      "max_iterations": 3,
      "upstream": "specs/design/ (the living baseline prior to this amendment) + specs/design/constitution.md + specs/brownfield/wiki/ (committed DeepWiki) + specs/brownfield/code-graph.json",
      "hard_gate": "specs/reviews/design-grounding.json (trace-check.js over this sprint's design-traces.json vs its story-traces.json) must have pass=true — any net_new or dropped component is an automatic FAIL. specs/reviews/contract-drift-verdict.json (contract-drift-gate.js over api-contracts.schema.json) must not be verdict=breaking unless the amendment's Breaking Changes section names and justifies every broken endpoint. Any invariant in specs/design/constitution.md under '## Invariants' that this amendment violates is an automatic FAIL regardless of the weighted average — quote the violated invariant verbatim in the finding.",
      "criteria": {
        "completeness": "The amendment narrative (specs/design/amendments/<amendment-id>.md) covers every story in this sprint/change: what it changes in the existing architecture, options considered, the recommendation, and per-component impact. Every changed specs/design/ file has a corresponding narrative section.",
        "traceability": "Every design change traces to a story/BR-n (anchored to specs/reviews/design-grounding.json when present). Every edit cites a specific committed DeepWiki page/symbol or code-graph node for the code it touches — an edit with no such citation is an orphan change.",
        "specificity": "Each edit names the existing module/seam/layer it extends, consistent with specs/brownfield/code-graph.json. Breaking changes are enumerated with the exact endpoint/field and a concrete justification, not a general note.",
        "consistency": "No edit introduces a new parallel structure where an existing seam already fits (reject and name the seam it should have extended instead). The amendment does not contradict any specs/design/constitution.md invariant.",
        "actionability": "The living specs/design/ artifacts (architecture.md, schemas, component-map.md) are updated non-destructively and are immediately buildable by /auto — no dangling references to the pre-amendment shape remain."
      }
    },
```

- [ ] **Step 2: Update the evaluator agent's artifact-mode documentation**

In `.claude/agents/evaluator.md`, update line 176 (the `phase` input row) to add the new value:

```markdown
| `phase` | Name of the phase being evaluated: `brd`, `spec`, `design`, `design-delta`, `brownfield`, `seam-finder`, `deploy` |
```

Then add a new Phase-Specific Guidance line right after the existing **Design** line (after line 272, before **Brownfield**):

```markdown
**Design-Delta** — Check for: an amendment narrative under `specs/design/amendments/` plus a non-destructively updated living `specs/design/` set. Every edit must cite a committed DeepWiki page/symbol or code-graph node and name the existing seam it extends — reject any edit that introduces a parallel structure. Treat `specs/design/constitution.md`'s `## Invariants` as hard constraints: quote the violated line verbatim in any finding. Cross-reference `specs/reviews/contract-drift-verdict.json` against the amendment's Breaking Changes section — every reported breaking change needs a matching justification.
```

- [ ] **Step 3: Write the failing wiring-consistency test**

Check whether `test/phase-eval-rubrics.test.js` already exists:

Run: `ls test/ | grep -i rubric`

If it exists, add a new test to it; if not, create `test/phase-eval-rubrics.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const RUBRICS_PATH = path.join(__dirname, '..', '.claude', 'templates', 'phase-eval-rubrics.json');
const EVALUATOR_PATH = path.join(__dirname, '..', '.claude', 'agents', 'evaluator.md');

test('phase-eval-rubrics.json has a design-delta phase with the standard 5 criteria', () => {
  const rubrics = JSON.parse(fs.readFileSync(RUBRICS_PATH, 'utf8'));
  const phase = rubrics.phases['design-delta'];
  assert.ok(phase, 'design-delta phase must exist in phase-eval-rubrics.json');
  assert.ok(phase.hard_gate, 'design-delta must define a hard_gate');
  assert.match(phase.hard_gate, /constitution\.md/);
  for (const c of ['completeness', 'traceability', 'specificity', 'consistency', 'actionability']) {
    assert.ok(phase.criteria[c], `design-delta must score ${c}`);
  }
});

test('evaluator.md documents design-delta in the phase enum and phase-specific guidance', () => {
  const text = fs.readFileSync(EVALUATOR_PATH, 'utf8');
  assert.match(text, /`design-delta`/);
  assert.match(text, /\*\*Design-Delta\*\*/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/phase-eval-rubrics.test.js`
Expected: FAIL — `design-delta` phase not found (before Step 1) or the evaluator.md assertion fails (before Step 2).

- [ ] **Step 5: Run test to verify it passes** (after Steps 1-2 above)

Run: `node --test test/phase-eval-rubrics.test.js`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add .claude/templates/phase-eval-rubrics.json .claude/agents/evaluator.md test/phase-eval-rubrics.test.js
git commit -m "feat: add design-delta evaluator rubric for the sprint-delta lane"
```

---

### Task 5: `/design` — Delta Mode + Baseline Recovery Mode

**Files:**
- Modify: `.claude/skills/design/SKILL.md`

**Interfaces:**
- Consumes: Task 4's `phase-eval-rubrics.json#design-delta`, Task 3's amendment-provenance gate (implicitly, via the commit step).
- Produces: `specs/design/amendments/<amendment-id>.md`, non-destructively updated `specs/design/*` — consumed by Task 8 (`/sprint` Phase 3/GATE 2) and Task 10 (`/feature`'s design-touching story routing).

- [ ] **Step 1: Add front-matter `argument-hint` and update Usage**

In `.claude/skills/design/SKILL.md`, add an `argument-hint` field to the front matter (lines 1-5):

```yaml
---
name: design
description: "[Internal pipeline stage — run by /build (use --doc-only standalone for an ARB narrative); invoke directly only as a power user.] Generate system architecture, machine-readable schemas, and UI mockups. Spawns planner + generator concurrently."
argument-hint: "[--doc-only [path] | --delta --stories <dir> | --story <file> --amendment-id <id> | --baseline-recovery]"
context: fork
---
```

Update the `## Usage` block (lines 11-17) to list the new modes:

```
/design               # full pipeline mode (default)
/design --doc-only    # lightweight architecture narrative, no pipeline
/design --doc-only [path]   # write the doc to [path] instead of the default
/design --delta --stories specs/stories/sprint-N/ --amendment-id sprint-N   # sprint delta
/design --delta --story specs/stories/E{n}-S{n}.md --amendment-id story-E{n}-S{n}   # single-story delta
/design --baseline-recovery   # one-time: derive a living design from an existing codebase
```

Add one line after the existing paragraph about `--doc-only` (after line 21, before `---`):

```
`--delta` and `--baseline-recovery` are a third lane: amending or bootstrapping the **living** `specs/design/` baseline for a system already past sprint 1. See **Delta Mode** and **Baseline Recovery Mode** below. Unlike `--doc-only`, both write into `specs/design/` — they are SDLC gates, not disposable artifacts.
```

- [ ] **Step 2: Insert the Delta Mode section**

Insert a new `## Delta Mode (--delta)` section immediately after the `---` that closes the Doc-Only Mode section (after line 43, before `## Overview (full mode)` at line 46):

```markdown
## Delta Mode (`--delta`)

> Invoked by `/sprint` (many stories) or `/feature`'s impact classifier (one
> design-touching story) when `specs/design/` already holds an approved
> baseline. **Never regenerates `specs/design/` from scratch** — it reads the
> living design as the baseline and writes a non-destructive amendment. See
> `docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md`.

### Prerequisites (delta mode only)

`specs/design/architecture.md` must already exist — delta mode amends a
baseline, it does not create one. If it does not exist, halt and tell the
human to run `/sprint` (which bootstraps a baseline via `--baseline-recovery`
first) or full `/design` for a true sprint-1 build.

The caller passes either `--stories specs/stories/sprint-N/` (many stories,
from `/sprint`) or `--story specs/stories/E{n}-S{n}.md` (one story, from
`/feature`'s impact classifier) plus `--amendment-id <sprint-N|story-E{n}-S{n}>`
— the id used for the amendment filename.

### Step D1 — Read the living baseline

Read every file in `specs/design/` (architecture.md, api-contracts.md +
`.schema.json`, data-models.md + `.schema.json`, component-map.md,
reasons-canvas.md, folder-structure.md, deployment.md) plus
`specs/design/constitution.md` if present. This is the baseline every change
must extend, not replace.

### Step D2 — Read the delta input

Read the story file(s) passed in (`--stories`/`--story`), the committed
DeepWiki (`specs/brownfield/wiki/`), and `specs/brownfield/code-graph.json`
when present. If `specs/brd/sprint-N/requirements-delta.json` exists for this
sprint (from `/brd --delta`), read it too — it names which requirements are
new, changed, carried, or dropped.

### Step D3 — Spawn the planner (single agent, not concurrent with a generator)

Delta mode never spawns the mockup generator — an amendment is a narrative +
schema diff, not a fresh UI pass. Spawn one `planner` agent:

**Prompt:**

> Read every file in specs/design/ (the living baseline) plus
> specs/design/constitution.md if it exists. Read the story file(s) at
> `<stories path>`, the committed DeepWiki at specs/brownfield/wiki/, and
> specs/brownfield/code-graph.json.
>
> For each story, decide what it changes in the existing architecture. Do not
> regenerate any file from scratch — every change must be additive or a
> targeted edit to the existing content. Write:
>
> 1. **specs/design/amendments/<amendment-id>.md** — the amendment narrative:
>    - One subsection per story: what it changes, options considered, the
>      recommendation, and the per-component impact.
>    - A citation to a specific DeepWiki page/symbol or code-graph node for
>      every edit — an edit with no citation is not allowed.
>    - For every edit, name the existing module/seam/layer it extends. If no
>      existing seam fits, say so explicitly and justify introducing a new one
>      — do not silently create a parallel structure.
>    - A **Breaking Changes** section listing every API/schema change that
>      breaks an existing consumer, each with a concrete justification. Empty
>      section (`None.`) if there are none.
>
> 2. **Updated specs/design/architecture.md, api-contracts.md,
>    api-contracts.schema.json, data-models.md, data-models.schema.json,
>    component-map.md** — edited in place, additively. Preserve every existing
>    entry that this sprint's stories do not change. Add new component-map
>    rows for the new stories; do not remove existing rows unless a story
>    explicitly retires that component (state this in the amendment).
>
> 3. **specs/design/reasons-canvas.md** — append to (do not replace) the
>    Entities and Governs sections: mark new entities `new`, cite existing
>    graph nodes for touched entities, and add newly governed paths to
>    `Governs` without removing paths this sprint didn't touch.
>
> If `specs/design/constitution.md` exists, treat every line under its
> `## Invariants` heading as a hard constraint. Before writing, check each
> proposed change against every invariant; if a change would violate one, do
> not make it — find another approach or flag the conflict in the amendment's
> Breaking Changes section for human resolution at GATE 2.

### Step D4 — Emit the trace spine + Grounding Gate [HARD BLOCK]

Same mechanism as full mode Step 1.9, scoped to this sprint's stories. Append
new entries to the existing `specs/design/design-traces.json` (do not drop
prior sprints' entries), then check only this sprint's set:

```bash
node .claude/scripts/trace-check.js \
  --required <stories-path>/story-traces.json \
  --downstream specs/design/design-traces.json \
  --layer design-delta \
  --out specs/reviews/design-grounding.json
```

Any `net_new` or `dropped` for this sprint's stories blocks Step D5.

### Step D5 — Contract-drift check

```bash
node .claude/scripts/contract-drift-gate.js --spec specs/design/api-contracts.schema.json
```

A `breaking` verdict is not automatically a hard stop in delta mode — cross-
reference `specs/reviews/contract-drift-verdict.json` against the amendment's
Breaking Changes section. Every breaking endpoint the tool reports must have a
matching justification entry; if any does not, revise the amendment or the
change before Step D6.

### Step D6 — Design-delta Evaluation Gate

Spawn Agent with subagent_type="evaluator" and prompt:
- Phase: design-delta
- Artifacts: specs/design/amendments/<amendment-id>.md, specs/design/architecture.md, specs/design/api-contracts.md, specs/design/api-contracts.schema.json, specs/design/data-models.md, specs/design/data-models.schema.json, specs/design/component-map.md, specs/design/reasons-canvas.md
- Upstream: the story file(s) passed in, specs/design/constitution.md, specs/brownfield/wiki/, specs/brownfield/code-graph.json
- Grounding verdict: specs/reviews/design-grounding.json (already checked in Step D4)
- Rubric: Read .claude/templates/phase-eval-rubrics.json, key "design-delta"
- Iteration: 1 (increment on retry)
- Previous score: null (or previous iteration's weighted_average)
- Write result to specs/reviews/phase-design-delta-eval.json

**Ratchet loop (max 3 iterations):**

1. If verdict is **PASS** — proceed to Step D7 with the eval summary.
2. If verdict is **FAIL** — revise the amendment/living design and re-run.
3. **Ratchet rule:** weighted_average must be >= previous iteration. Revert on regression.
4. After 3 iterations — present best version with findings.

### Step D7 — Present for Human Approval (GATE 2 — never collapsible)

Display:
1. The amendment narrative (`specs/design/amendments/<amendment-id>.md`)
2. `git diff -- specs/design/ ':!specs/design/amendments'` so the human
   reviews exactly what changed in the living design, excluding the
   amendment file itself
3. The contract-drift verdict and the amendment's Breaking Changes section side by side
4. The design-delta evaluator verdict

Ask: "Does this design amendment correctly evolve the existing architecture?
Approve to commit the amendment and proceed, or provide corrections."

Do not auto-advance — this gate is never skipped by `--autonomous` in
`/sprint` or `/feature` (there is no `--auto` zero-gate mode for the design
amendment). On approval, commit the amendment together with the updated
living-design files in one commit:

```bash
git add specs/design/
git commit -m "design: <amendment-id> amendment"
```

(The amendment-provenance pre-commit gate requires exactly this — a new file
under `specs/design/amendments/` in the same commit as any other
`specs/design/` change.)
```

- [ ] **Step 3: Insert the Baseline Recovery Mode section**

Insert a new `## Baseline Recovery Mode (--baseline-recovery)` section immediately after the Delta Mode section, still before `## Overview (full mode)`:

```markdown
## Baseline Recovery Mode (`--baseline-recovery`)

> A one-time bootstrap for a true brownfield app the harness did not build —
> invoked by `/sprint` Phase 0 when `specs/design/architecture.md` is missing
> but source code exists. After this runs once, the app evolves through
> Delta Mode exactly like a harness-built system.

### Step BR1 — Ensure discovery exists

If `specs/brownfield/code-graph.json` does not exist, run full `/brownfield`
discovery first (it produces the code graph and the committed DeepWiki).

### Step BR2 — Derive the living design from the graph

Spawn one `planner` agent:

**Prompt:**

> Read specs/brownfield/code-graph.json and the committed DeepWiki at
> specs/brownfield/wiki/. Derive the full living design set this codebase
> already implements — do not invent improvements, describe what exists:
>
> 1. **specs/design/architecture.md** — components, data flows, and key
>    design decisions as observed in the graph and wiki.
> 2. **specs/design/api-contracts.md** + **api-contracts.schema.json** —
>    every endpoint the graph/wiki surfaces, in OpenAPI 3.0 shape.
> 3. **specs/design/data-models.md** + **data-models.schema.json** — every
>    entity observed.
> 4. **specs/design/component-map.md** — map every existing top-level module
>    to a synthetic story id (`LEGACY-1`, `LEGACY-2`, ...) so the ownership
>    sensor has something to check changes against going forward.
> 5. **specs/design/reasons-canvas.md** — mark every entity `existing`, citing
>    its code-graph node; the `Governs` list is every source path the graph
>    contains.
> 6. **specs/design/folder-structure.md** and **specs/design/deployment.md** —
>    as observed, or "not determinable from static analysis — fill in
>    manually" where the graph has no signal.
>
> Stamp every file's frontmatter or opening line with
> `<!-- provenance: derived-from-code, low-confidence areas flagged below -->`.
> For any section built on a weak signal (e.g. a low seam-confidence area, or
> an endpoint inferred rather than directly observed), add an inline
> `<!-- LOW CONFIDENCE: ... -->` marker so the human reviewer knows exactly
> where to look harder.

### Step BR3 — One-time human approval

This is a separate gate from Delta Mode's GATE 2 — it approves the recovered
baseline itself, not an amendment to it. Display the derived artifacts and
every `LOW CONFIDENCE` marker found, and ask: "Does this recovered baseline
accurately describe the existing system? Correct any inaccuracies now — this
becomes the baseline every future sprint amends."

On approval, commit as the initial baseline (the amendment-provenance gate's
`initial-design` exemption applies — there is no prior baseline to amend):

```bash
git add specs/design/
git commit -m "design: recovered baseline from existing codebase"
```
```

- [ ] **Step 4: Update the Output, Gate, and Gotchas sections**

In the `## Output` table (around line 217-230), add three rows after the `mockups/E{n}-S{n}.html` row:

```markdown
| `specs/design/constitution.md` | (when present) cross-sprint invariants delta mode and the design-delta rubric check every amendment against |
| `specs/design/amendments/<id>.md` | (delta mode) the amendment narrative: per-story impact, seam citations, breaking changes |
| `specs/reviews/phase-design-delta-eval.json` | (delta mode) design-delta rubric verdict |
```

In `## Gate` (around line 234-247), add a paragraph after the existing human-approval line:

```markdown
**Delta mode's GATE 2 is never collapsed** by `--autonomous` in `/sprint` or
`/feature` — there is no zero-gate mode for a design amendment, unlike the
autonomous scope-routing gates elsewhere in the harness.
```

In `## Gotchas` (around line 251-260), add:

```markdown
- **Delta mode must never regenerate `specs/design/` from scratch.** If the planner's output looks like a fresh design rather than an amendment (missing prior component-map rows, a rewritten architecture.md with no trace to the prior version), stop and re-invoke Step D3 with a stronger instruction to read the baseline first.
- **Baseline recovery is a one-time event, not a re-run.** Once `specs/design/architecture.md` exists, always use Delta Mode — recovery mode is only for the very first bootstrap of a true brownfield app.
```

- [ ] **Step 5: Verify referenced paths resolve and rubric wiring is consistent**

Run: `node --test test/skills-consistency.test.js`
Expected: PASS — no broken `.claude/skills/...` references were introduced (this task adds no new cross-skill path references beyond existing conventions).

Run: `node --test test/phase-eval-rubrics.test.js`
Expected: still PASS (from Task 4).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/design/SKILL.md
git commit -m "feat: add /design --delta and --baseline-recovery modes"
```

---

### Task 6: `/brd` — Delta Mode

**Files:**
- Modify: `.claude/skills/brd/SKILL.md`

**Interfaces:**
- Produces: `specs/brd/sprint-N/brd.md`, `specs/brd/sprint-N/brd-requirements.json`, `specs/brd/sprint-N/requirements-delta.json` — consumed by Task 7 (`/spec` sprint mode) and Task 8 (`/sprint` Phase 1/GATE 1).

- [ ] **Step 1: Update Usage**

In `.claude/skills/brd/SKILL.md`, add a line to the `## Usage` code block (after line 16):

```
/brd --delta path/to/prd-sprintN.md    # ground sprint N's PRD against the prior sprint's requirement spine
```

- [ ] **Step 2: Insert the Delta Mode section**

Insert a new `## Delta Mode (--delta)` section after the `## Overview` section (after line 28, before `## Steps` at line 30):

```markdown
## Delta Mode (`--delta`)

> Invoked by `/sprint` for sprint N (N >= 2). Grounds a new PRD against the
> **prior sprint's approved requirement spine**, not against nothing — this is
> what proves the new PRD's requirements are new/changed/carried, and flags
> anything it silently drops. See
> `docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md`.

### Step Δ0 — Locate the prior spine and resolve N

List `specs/brd/sprint-*/` directories; let `prev` be the highest number found.
If none exist, the prior spine is the flat legacy `specs/brd/brd-requirements.json`
(sprint 1 predates sprint-numbered directories) and `N = 2`. If sprint
directories exist, `N = prev + 1`. If neither the flat file nor any sprint
directory exists, halt — `--delta` requires a prior sprint; use `--frd`/`--prd`
for the very first sprint.

### Step Δ1 — Run Steps 0.0 through 4 unchanged, writing to `specs/brd/sprint-N/`

Run the FRD-grounded flow (Steps 0.0, 0, 0.5, 1, 2, 2.8, 3, 4) exactly as
written above, with one change: every output path becomes
`specs/brd/sprint-N/` (e.g. `specs/brd/sprint-N/brd.md`,
`specs/brd/sprint-N/brd-requirements.json`, `specs/brd/sprint-N/clarification-log.json`).

### Step Δ2 — Requirements-delta classification [HARD BLOCK]

Step 4.4's grounding gate still runs unchanged (this sprint's BRD vs this
sprint's own FRD/PRD spine). In addition, classify this sprint's spine against
the **prior sprint's** spine — the same `trace-check.js` engine, reused with
the prior spine as `required`, this sprint's spine also as a valid trace
target (`optional`), and this sprint's spine as `downstream`:

```bash
node .claude/scripts/trace-check.js \
  --required specs/brd/sprint-{prev}/brd-requirements.json \
  --optional specs/brd/sprint-N/brd-requirements.json \
  --downstream specs/brd/sprint-N/brd-requirements.json \
  --layer requirements-delta \
  --out specs/brd/sprint-N/requirements-delta.json
```

(When `prev` refers to the flat legacy layout, use `--required specs/brd/brd-requirements.json`.)

Read the resulting `requirements-delta.json`:
- `net_new` entries are genuinely new requirements this sprint introduces — expected, not a failure.
- `dropped` entries are prior-sprint requirements this sprint's spine does not cover — **each one needs an explicit human decision**: still active (add a BR entry carrying it forward) or intentionally retired (record why in this sprint's BRD Open Questions). A `dropped` entry with no such resolution is a silent regression — halt and ask before proceeding to Step 4.5.

**Empty-spine guard:** a `required_total: 0` here means the prior sprint's
spine is empty — a pre-spine legacy project. Skip this step in that case and
note it in the BRD summary (Step 4.4's own grounding gate still runs
normally against this sprint's spine).

### Step Δ3 — Present for Human Approval (delta mode)

Same as Step 5, plus display the requirements-delta classification (new /
changed / carried / dropped, with the human's resolution for each dropped
item) before asking for approval.
```

- [ ] **Step 3: Update the `## Output` table**

Add two rows after the existing `brd-analysis.json` row (around line 308):

```markdown
| `specs/brd/sprint-N/*` | (delta mode) sprint-N's BRD artifact set, same shape as the flat sprint-1 layout |
| `specs/brd/sprint-N/requirements-delta.json` | (delta mode) new/changed/carried/dropped classification vs the prior sprint's spine |
```

- [ ] **Step 4: Verify referenced paths and skill consistency**

Run: `node --test test/skills-consistency.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/brd/SKILL.md
git commit -m "feat: add /brd --delta mode for sprint-over-sprint requirement grounding"
```

---

### Task 7: `/spec` — sprint addendum

**Files:**
- Modify: `.claude/skills/spec/SKILL.md`

**Interfaces:**
- Consumes: Task 6's `specs/brd/sprint-N/brd.md`.
- Produces: `specs/stories/sprint-N/*` — consumed by Task 5's `/design --delta --stories` and Task 8 (`/sprint` Phase 2/GATE 1).

- [ ] **Step 1: Update Usage**

In `.claude/skills/spec/SKILL.md`, add a line to `## Usage` (after line 16):

```
/spec specs/brd/sprint-N/brd.md --sprint N   # sprint N: write to specs/stories/sprint-N/ instead of the flat path
```

- [ ] **Step 2: Add the sprint addendum note to Step 1**

In `### Step 1 — Read the BRD` (after line 41, before `### Step 1.5`), add:

```markdown
**Sprint addendum.** When the BRD path is under `specs/brd/sprint-N/` (or
`--sprint N` is passed explicitly), write every output of this skill to
`specs/stories/sprint-N/` instead of the flat `specs/stories/` path, and
suffix every `--out` argument in the grounding-gate commands below with
`-sprint-N` (e.g. `specs/reviews/spec-grounding-sprint-N.json`). For every
story whose scope overlaps existing code, require a citation to the specific
DeepWiki page/symbol or code-graph node it extends (the same design-adherence
discipline `/feature` already applies) — do not decompose a story that
silently re-implements existing functionality.
```

- [ ] **Step 3: Update the grounding-gate command in Step 6.45 with the sprint path pattern**

In `### Step 6.45 — Grounding Gate` (around line 272-288), add a note immediately after the existing bash block:

```markdown
**Sprint addendum.** In sprint mode, point `--required` at
`specs/brd/sprint-N/brd-requirements.json`, `--downstream` at
`specs/stories/sprint-N/story-traces.json`, and `--out` at
`specs/reviews/spec-grounding-sprint-N.json`.
```

- [ ] **Step 4: Update the `## Output` table**

Add one row after `specs/reviews/spec-grounding.json` (around line 340):

```markdown
| `specs/stories/sprint-N/*` | (sprint mode) same artifact set as the flat layout, scoped to sprint N |
```

- [ ] **Step 5: Verify skill consistency**

Run: `node --test test/skills-consistency.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/spec/SKILL.md
git commit -m "feat: add sprint-scoped output paths to /spec"
```

---

### Task 8: `/sprint` — new conductor skill

**Files:**
- Create: `.claude/skills/sprint/SKILL.md`

**Interfaces:**
- Consumes: Task 5 (`/design --delta`, `/design --baseline-recovery`), Task 6 (`/brd --delta`), Task 7 (`/spec ... --sprint N`).
- Produces: the `/sprint` command, referenced by Task 9 (`/build`'s redirect) and Task 13 (README).

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/sprint/SKILL.md`:

```markdown
---
name: sprint
description: PRD-per-sprint evolution route for an existing harness-built (or brownfield) system — grounds a new PRD against the prior requirement spine, produces a human-approved design amendment against the living specs/design/ baseline, then runs /auto. Companion to /build (sprint 1) and /feature (single-story changes).
argument-hint: "<prd-file> [--autonomous]"
---

# Sprint Skill — PRD-per-Sprint Evolution

`/sprint` is a **thin conductor**, like `/feature`, for evolving a system PRD
by PRD without regenerating its architecture from scratch each time. It
grounds the new PRD against the prior sprint's requirement spine, amends the
living `specs/design/` baseline instead of replacing it, and gates code
generation on a human-reviewable diff of the design amendment — never a
regenerated document. See
`docs/superpowers/specs/2026-07-04-sprint-delta-lane-design.md` for the full
design rationale.

Use `/build` for sprint 1 (no existing code or specs). Use `/feature` for a
single story or small cluster that doesn't need a full PRD. `/sprint` is for
"here is the next PRD" — many stories, evolving an existing architecture.

**Runs in the main session — do not add `context: fork`.** Like `/feature`,
this conductor owns interactive human gates (GATE 1, GATE 2) and delegates the
actual work to forked sub-skills.

## Usage

```text
/sprint prd-sprint2.md                  # 2 gates (default)
/sprint prd-sprint2.md --autonomous     # 1 consolidated gate (folds GATE 1 into GATE 2)
```

There is no `--auto` (zero-gate) mode — GATE 2 (design-delta approval) is
never collapsible, by design.

## Wrong-door protection

Before anything else, check `specs/design/architecture.md`:
- If it does not exist **and** the repo has no source code (a fresh, empty
  project) — this is sprint 1, not sprint N. Stop and tell the human to run
  `/build <prd>` instead.
- If it does not exist **but** source code exists (a true brownfield app the
  harness did not build) — proceed to Phase 0's baseline recovery.
- If it exists — proceed normally.

`/build`'s own Step 0 carries the mirror check: if `specs/design/architecture.md`
already exists when `/build` is invoked, `/build` stops and redirects here.

## Phase 0 — Preflight & Baseline (fully automatic, no flags)

1. **Baseline recovery.** If `specs/design/architecture.md` is missing (true
   brownfield): run `/design --baseline-recovery` (see `design/SKILL.md`'s
   Baseline Recovery Mode). This runs `/brownfield` discovery first if
   `specs/brownfield/code-graph.json` does not exist, then derives a living
   design set from the graph, stamped `provenance: derived-from-code`, with
   a one-time human approval before proceeding. After this, treat the repo
   as if it already had an approved baseline.
2. **DeepWiki freshness.** If `specs/brownfield/wiki/` exists, check for a
   `> STALE since…` banner; if present, patch it incrementally via
   `/code-map --files` on the flagged files, the same mechanism `/feature`
   already uses.
3. **Sprint number.** List `specs/brd/sprint-*/` directories; the sprint
   number for this run is one greater than the highest found, or `2` if only
   the flat legacy `specs/brd/brd.md` exists (sprint 1 was built before
   sprint-numbered directories existed). State the resolved sprint number
   before proceeding.

## Phase 1 — Requirements Delta

Run `/brd --delta <prd-file>` (see `brd/SKILL.md`'s Delta Mode). This writes
`specs/brd/sprint-N/` and, critically,
`specs/brd/sprint-N/requirements-delta.json` classifying every requirement as
new/changed/carried against the prior sprint's spine. Any unresolved
`dropped` entry halts here per that skill's Step Δ2 — do not proceed with a
silent requirement regression.

## Phase 2 — Story Decomposition

Run `/spec specs/brd/sprint-N/brd.md --sprint N` (see `spec/SKILL.md`'s
sprint addendum). Writes `specs/stories/sprint-N/`.

## GATE 1 — Approve Requirement Delta + Decomposition

Present, on one screen:
- The requirements-delta classification (new / changed / carried / dropped,
  with resolution for each dropped item)
- The story decomposition summary (epic table, dependency graph, story-point
  total) from `/spec`'s own Step 7 output

Ask: "Does this requirement delta and story decomposition look correct?
Approve to proceed to the design amendment, or provide corrections."

With `--autonomous`, skip this as a separate stop — fold its summary into the
single GATE 2 presentation instead (do not skip the underlying `/brd --delta`
and `/spec` grounding gates themselves, only the human stop).

## Phase 3 — Design Delta

Run `/design --delta --stories specs/stories/sprint-N/ --amendment-id sprint-N`
(see `design/SKILL.md`'s Delta Mode, Steps D1–D6): read the living baseline,
spawn one planner agent to write the amendment and amend the living design
non-destructively, emit the grounding gate, run the contract-drift check, and
run the design-delta evaluator rubric.

## GATE 2 — Approve Design Amendment (never collapsible)

This is `design/SKILL.md` Delta Mode's Step D7, run from here. Never skipped,
never folded away in any autonomy mode. On approval, the amendment and
updated living-design files are committed together in one commit.

## Phase 4 — Tracker Publish (optional)

If a tracker is configured (`.claude/tracker-config.json`), run
`tracker-publish --granularity group` exactly as `/feature`'s epic lane does.

## Phase 5 — Delta Test Plan

Run `/test` (the normal flow, not `--from-cr` — that lane is for a single
change-request bug fix with no stories directory) scoped to
`specs/stories/sprint-N/`, so every new story gets a proper test plan and
grounded verification-matrix entries exactly as a fresh spec/design pass
would produce. Any existing area the amendment's Breaking Changes section
names is covered by that area's own existing tests, which `/auto`'s normal
test gate re-runs — no separate regression-pin pass is needed since sprint-N
stories already carry proper `story-traces.json`.

## Phase 6 — Build

Run `/auto`. The merged `specs/design/component-map.md` (already updated by
Phase 3) means the existing ownership, canvas-sync, layer, and context
sensors now enforce the evolved design automatically — no `/auto` changes
needed.

## Phase 7 — Gate and PR

Run `/gate`, then open the PR(s) exactly as `/build`/`/feature` do. Merge
stays human.

## State markers

At the start of Phase 0, write `.claude/state/current-sprint` (the resolved
sprint number, e.g. `2`) and update `.claude/state/sprint-phase` at the start
of every phase (`preflight`, `requirements-delta`, `story-decomposition`,
`design-delta`, `tracker-publish`, `test-plan`, `build`, `gate`) so `/status`
can show sprint progress:

```bash
mkdir -p .claude/state
printf '%s' "N" > .claude/state/current-sprint
printf '%s' "<phase-name>" > .claude/state/sprint-phase
```

## Gotchas

- **Never let Phase 3 regenerate `specs/design/` from scratch.** If the
  planner agent's output looks like a fresh design rather than an amendment
  (missing prior component-map rows, a rewritten architecture.md with no
  trace to the prior version), stop and re-invoke Delta Mode Step D3 with a
  stronger instruction to read the baseline first.
- **GATE 2 here is not `/feature`'s GATE 2.** They serve different lanes
  (PRD-scale vs single-story) but share the same underlying
  `design/SKILL.md` Delta Mode machinery — do not conflate the two
  conductors.
- **Do not skip the requirements-delta dropped-item resolution.** An
  unresolved `dropped` entry is exactly the silent regression this lane
  exists to prevent.
- **`--autonomous` folds human stops, never machine gates.** The grounding
  gates, contract-drift check, and design-delta evaluator all still run.
```

- [ ] **Step 2: Verify skill discovery and consistency**

Run: `node --test test/skills-consistency.test.js`
Expected: PASS — the new skill is not a reference-only tombstone (it has substantial unique content) and does not reference a removed skill directory.

Run: `ls .claude/skills/sprint/SKILL.md`
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sprint/SKILL.md
git commit -m "feat: add /sprint conductor for PRD-per-sprint evolution"
```

---

### Task 9: `/build` — wrong-door redirect to `/sprint`

**Files:**
- Modify: `.claude/skills/build/SKILL.md`

**Interfaces:**
- Consumes: nothing new (a check against `specs/design/architecture.md`).

- [ ] **Step 1: Add the boundary check to Phase 0**

In `.claude/skills/build/SKILL.md`, insert a new paragraph immediately before
`### Phase 0 — Brownfield Discovery [EXISTING CODEBASES]` (before line 93),
mirroring the existing "Boundary with `/feature`" note that already lives
inside that section:

```markdown
**Boundary with `/sprint`.** If `specs/design/architecture.md` already
exists, this project has already been through sprint 1 (or a recovered
baseline) — `/build` is not the right entry point for further work. Stop and
tell the human to run `/sprint <prd-file>` instead, which grounds the new PRD
against the prior sprint and amends the living design rather than
regenerating it. Only continue past this check when `specs/design/` does not
yet have an approved baseline.

```

(This is a new paragraph; the existing "### Phase 0 — Brownfield Discovery" heading and its "Boundary with `/feature`" paragraph immediately follow, unchanged.)

- [ ] **Step 2: Verify skill consistency**

Run: `node --test test/skills-consistency.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/build/SKILL.md
git commit -m "feat: redirect /build to /sprint when a design baseline already exists"
```

---

### Task 10: `/feature` — impact-classifier wiring

**Files:**
- Modify: `.claude/skills/feature/SKILL.md`

**Interfaces:**
- Consumes: Task 2 (`impact-classifier.js`), Task 5 (`/design --delta --story`).

- [ ] **Step 1: Replace the scope-classification section**

In `.claude/skills/feature/SKILL.md`, replace the `## Scope classification (the one routing decision)` section (lines 127-138) with an expanded version that adds the impact-classifier sub-step:

```markdown
## Scope classification (two routing decisions)

After GATE 1 you hold the decomposition. First classify size, reusing
`/change` Step 0's thresholds and `specs/brownfield/risk-map.md`:

- **Single-story lane** — 1 bounded story, ≤ 3 files, no auth/authz/payments/
  persistence/public-API-contract change → delegate to **`/change`**.
- **Epic / cluster lane** — multiple stories, an epic, or any dependency graph →
  run **`/spec` → `/design --delta`** (not full `/design` — see below) →
  **`tracker-publish --granularity group`** → **`/auto`** for parallel
  agent-team execution.

State the chosen lane in one line before proceeding.

### Impact classification (single-story lane only)

A bounded single story can still be architecturally invisible or
design-touching. Run:

```bash
node .claude/scripts/impact-classifier.js --story <story-file> --graph specs/brownfield/code-graph.json
```

- **`invisible`** — delegate to `/change` exactly as today. No design
  amendment, no GATE 2.
- **`design-touching`** — before `/change` implements it, run
  `/design --delta --story <story-file> --amendment-id story-<id>` (see
  `design/SKILL.md`'s Delta Mode) to produce
  `specs/design/amendments/story-<id>.md` and amend the living design. GATE 2
  (Delta Mode's Step D7) runs here — approve the amendment before `/change`
  implements the story.

### Epic / cluster lane uses `/design --delta`, not full `/design`

When this project already has an approved `specs/design/` baseline (the
normal case for `/feature`, since it targets existing code), the epic/cluster
lane's `/design` call **must** be `/design --delta --stories
specs/stories/<epic-dir>/ --amendment-id <epic-id>` — never the full
regenerate-from-scratch mode. This closes the gap where the epic lane
previously regenerated `specs/design/` from the epic's stories alone,
discarding everything the rest of the system's design already established.
```

- [ ] **Step 2: Update GATE 2's description to reference Delta Mode**

In the `## The three gates` section, update the GATE 2 bullet (around line 188-189):

```markdown
- **GATE 2 — approve plan/design.** Single-story design-touching lane: the
  `/design --delta` amendment (Delta Mode Step D7). Cluster lane: the same
  `/design --delta` amendment, scoped to the epic's stories. Enforce
  design-adherence here — both share the design-delta rubric and grounding
  gate.
```

- [ ] **Step 3: Update the autonomous adherence enforcement section**

In `### Autonomous adherence enforcement (replaces the human GATE 2)` (around
lines 77-95), add a note after the existing "Judged adherence critic" bullet:

```markdown
3. **Design-delta rubric.** When the lane runs `/design --delta` (either
   routing above), its own Delta Mode Step D6 (the `design-delta` evaluator
   rubric) is the machine check for that amendment — in `--autonomous` and
   `--auto`, this still runs and still blocks; only the human stop at Step D7
   is skipped or folded, matching this skill's existing gate-collapse model.
```

- [ ] **Step 4: Verify skill consistency**

Run: `node --test test/skills-consistency.test.js`
Expected: PASS — the `.claude/scripts/impact-classifier.js` reference is a
script path, not a `skills/` path, so it is not checked by that test's regex;
confirm manually the file exists:

Run: `ls .claude/scripts/impact-classifier.js`
Expected: file exists (created in Task 2).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/feature/SKILL.md
git commit -m "feat: wire impact-classifier and /design --delta into /feature"
```

---

### Task 11: HARNESS.md + harness-manifest.json registration

**Files:**
- Modify: `harness-manifest.json`
- Modify: `HARNESS.md`

**Interfaces:**
- Consumes: Task 1's constitution template, Task 2's impact-classifier, Task 3's amendment-provenance-check.

- [ ] **Step 1: Add three entries to `harness-manifest.json`**

In `harness-manifest.json`, add one new guide to the `"guides"` array (after
the `token-governor` entry, before `context-pack`, keeping the traceability
guides grouped, or simply append at the end of `"guides"` — order is not
semantically checked):

```json
    { "id": "architecture-constitution", "axis": "architecture", "kind": "feedforward", "wired_at": ".claude/templates/constitution-template.md", "status": "active", "description": "Cross-sprint architecture invariants (sprint-delta lane): a human-owned, PR-reviewed file scaffolded into every project at specs/design/constitution.md. /design --delta's design-delta rubric treats every '## Invariants' line as a hard constraint on every future sprint's design amendment." },
```

Add two new sensors to the `"sensors"` array (after the `ownership-check` entry, keeping the traceability sensors grouped):

```json
    { "id": "amendment-provenance-check", "axis": "traceability", "type": "computational", "cadence": "commit", "status": "active", "scope": "artifacts", "wired_at": ".claude/scripts/amendment-provenance-check.js", "signal": "a commit changes specs/design/ with no matching record under specs/design/amendments/", "description": "Sprint-delta lane sensor: once a design baseline exists (specs/design/architecture.md tracked at HEAD), any commit touching specs/design/ (excluding the amendments/ dir itself) must carry a new file under specs/design/amendments/ in the same commit — otherwise a sprint's design evolution is invisible to the next sprint's human gate. Enforced at pre-commit (HARNESS_AMENDMENT_GATE=off escape); the very first design-authoring commit is exempt (verdict initial-design)." },
    { "id": "impact-classifier", "axis": "traceability", "type": "computational", "cadence": "planning", "status": "active", "scope": "artifacts", "wired_at": ".claude/scripts/impact-classifier.js", "signal": "a /feature story touches >3 files, a risk category (auth/payments/persistence/public-API), or introduces a new module", "description": "Sprint-delta lane routing sensor: classifies a single /feature story as architecturally invisible (-> /change, no design amendment) or design-touching (-> /design --delta, amendment + GATE 2), so small stories don't pay full design-gate overhead and design-relevant ones don't skip it. Advisory — always exits 0, it routes work rather than blocking it." },
```

- [ ] **Step 2: Validate the manifest**

Run: `node .claude/scripts/validate-harness-manifest.js`
Expected: exit 0, no errors (unique ids, valid axis/status/cadence/scope values, `wired_at` paths resolve on disk since Tasks 1-3 already created those files).

- [ ] **Step 3: Update the `HARNESS.md` matrix**

In `HARNESS.md`, append to the **Architecture** guides cell (line 63, inside
the `| | \`architecture.md\` · ...` row) — add before the closing of the
guides column (i.e., in the first `|` cell, after the last guide listed and
before the `|` separating guides from sensors):

```
· ✅ **architecture constitution** (cross-sprint invariants, sprint-delta lane)
```

Append to the **Traceability** sensors cell (line 75, the row ending in
`... · ✅ \`ownership-check\` ...`) — add at the end of that cell:

```
· ✅ **amendment-provenance-check** (specs/design/ change requires a matching amendment, sprint-delta lane) · ✅ **impact-classifier** (routes /feature stories to /change vs /design --delta)
```

- [ ] **Step 4: Run the full harness-manifest test**

Run: `node --test test/harness-manifest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add harness-manifest.json HARNESS.md
git commit -m "docs: register the sprint-delta lane's new guide and sensors"
```

---

### Task 12: `/status` sprint-awareness

**Files:**
- Modify: `.claude/scripts/pipeline-snapshot.js`
- Modify: `.claude/scripts/pipeline-status.js` (render only — `renderStatus`)
- Test: `test/pipeline-status.test.js`

**Interfaces:**
- Consumes: `.claude/state/current-sprint`, `.claude/state/sprint-phase` (written by Task 8's `/sprint`).
- Produces: `snapshot.sprint = { number, phase } | null` — an additive field on the existing snapshot object.

- [ ] **Step 1: Write the failing test**

In `test/pipeline-status.test.js`, add a new test after the existing fixtures
(the exact insertion point is after any existing `test(...)` blocks — append
at the end of the file):

```javascript
test('buildSnapshot surfaces sprint number and phase when /sprint has written state markers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-status-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude-progress.txt'), PROGRESS_TWO_SESSIONS);
    fs.writeFileSync(path.join(dir, 'features.json'), FEATURES_FOUR);
    const stateDir = path.join(dir, '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'current-sprint'), '2');
    fs.writeFileSync(path.join(stateDir, 'sprint-phase'), 'design-delta');
    const snapshot = buildSnapshot(dir, { now: NOW });
    assert.deepStrictEqual(snapshot.sprint, { number: 2, phase: 'design-delta' });
    const rendered = renderStatus(snapshot);
    assert.match(rendered, /Sprint:\s+2 \(design-delta\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSnapshot omits sprint when no /sprint state markers exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-sprint-status-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude-progress.txt'), PROGRESS_TWO_SESSIONS);
    fs.writeFileSync(path.join(dir, 'features.json'), FEATURES_FOUR);
    const snapshot = buildSnapshot(dir, { now: NOW });
    assert.strictEqual(snapshot.sprint, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pipeline-status.test.js`
Expected: FAIL — `snapshot.sprint` is `undefined`, not the expected object, and `renderStatus` output has no `Sprint:` line.

- [ ] **Step 3: Add `buildSprint` to `pipeline-snapshot.js`**

In `.claude/scripts/pipeline-snapshot.js`, add a new function after `buildLastStep` (after line 85):

```javascript
function buildSprint(stateDir) {
  const num = readMarker(stateDir, 'current-sprint');
  if (!num) return null;
  return { number: parseInt(num, 10), phase: readMarker(stateDir, 'sprint-phase') || 'unknown' };
}
```

Then wire it into `buildSnapshot` (around line 115): add `sprint: buildSprint(stateDir),` as a new key in the returned object, right after `run: buildRun(stateDir, progress, last),`:

```javascript
  return {
    schema_version: 1,
    generated_at: now || new Date().toISOString(),
    run: buildRun(stateDir, progress, last),
    sprint: buildSprint(stateDir),
    confidence: readPlanConfidence(projectDir),
    ...
```

- [ ] **Step 4: Add the render line to `pipeline-status.js`**

In `.claude/scripts/pipeline-status.js`, in `renderStatus` (around line 52-72), add a line right after the `Run:` line:

```javascript
function renderStatus(s) {
  const lines = [
    `Pipeline status — ${s.phase}  [${s.health}]`,
    `Run:       lane=${s.run.lane || '-'}  mode=${s.run.mode || '-'}  session=${s.run.session_id || '-'}`,
  ];
  if (s.sprint) lines.push(`Sprint:    ${s.sprint.number} (${s.sprint.phase})`);
  if (s.confidence) lines.push(fmtConfidence(s.confidence));
  ...
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/pipeline-status.test.js`
Expected: PASS (all existing tests plus the 2 new ones).

- [ ] **Step 6: Run the full status-related suite**

Run: `node --test test/pipeline-status.test.js test/pipeline-status-budget.test.js test/status-route-contract.test.js test/pipeline-progress-dashboard.test.js`
Expected: all PASS (the additive `sprint` field must not break any existing snapshot-shape assertions in these files).

- [ ] **Step 7: Commit**

```bash
git add .claude/scripts/pipeline-snapshot.js .claude/scripts/pipeline-status.js test/pipeline-status.test.js
git commit -m "feat: surface sprint number and phase in /status"
```

---

### Task 13: README.md updates

**Files:**
- Modify: `README.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add `/sprint` to the Command Cards quick-start**

In `README.md`, update the `## Command Cards` code block (lines 61-65):

```
New product          → /build
Existing product     → /feature "<request>"
Sprint N of an existing product → /sprint <prd-file>
Verify/review        → /gate
```

- [ ] **Step 2: Add `/sprint` to the command table**

In the `| Command | Use when | What happens |` table (lines 69-84), insert a
new row immediately after the `/build <prd> --auto` row (after line 75,
before the `/feature` row at line 76):

```markdown
| `/sprint <prd-file>` | Next PRD for an existing (harness-built or brownfield) product | Grounds the PRD against the prior sprint's requirements, amends the living design with a human-reviewed diff (never regenerates it), then `/auto` |
```

- [ ] **Step 3: Add `/sprint` to the Approval Modes table**

In the `## Approval Modes` table (lines 88-92), insert a new row after the
`Full-auto` row:

```markdown
| Sprint (gated) | `/sprint <prd-file>` | Approve requirement delta + decomposition, approve design amendment |
| Sprint (semi-auto) | `/sprint <prd-file> --autonomous` | One consolidated gate before the design amendment; the amendment approval itself is never skipped |
```

- [ ] **Step 4: Update the Existing-Code Flow section**

In `## Existing-Code Flow` (lines 117-123), add a sentence after the first
paragraph (after line 121, before the `/brownfield` guidance):

```markdown
When the next unit of work is a full PRD rather than a single request, use
`/sprint <prd-file>` instead — it grounds the PRD against the prior sprint's
requirements and produces a human-reviewed design amendment before any code
generation, so the system evolves sprint by sprint instead of being
regenerated each time.
```

- [ ] **Step 5: Verify no broken links or stale references**

Run: `grep -n "sprint" README.md`
Expected: the 5 new mentions above, no others accidentally altered.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document /sprint in the command reference and approval modes"
```

---

### Task 14: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit/integration test suite**

Run: `npm test`
Expected: all tests pass, including every new/modified test file from Tasks 1-12.

- [ ] **Step 2: Run the harness-manifest and skills-consistency checks explicitly**

Run: `node .claude/scripts/validate-harness-manifest.js && node --test test/skills-consistency.test.js`
Expected: manifest exits 0; skills-consistency test passes.

- [ ] **Step 3: Syntax-check the modified pre-commit hook**

Run: `node -c .claude/git-hooks/pre-commit`
Expected: no output (valid syntax).

- [ ] **Step 4: Run the force-exit full suite (matches CI)**

Run: `npm run test:all`
Expected: all tests pass with forced process exit (no hung handles).

- [ ] **Step 5: Request an independent whole-branch review**

Per this repo's CLAUDE.md principle #5, run an independent review of the
whole branch (not per-task) before merging — invoke the `/gate` skill or the
`diff-reviewer`/`security-reviewer` agents over the full diff range, since
per-task review tends to inherit the builder's own mental model. Confirm in
particular:
- The pre-commit `checkAmendmentProvenance` gate fires on the design-only
  commit shape it's meant to catch (not just source-file commits).
- `/design --delta`'s Step D3 prompt is unambiguous that it must never
  regenerate `specs/design/` from scratch.
- No task left a placeholder, TODO, or inconsistent field name across the
  `/sprint` → `/brd --delta` → `/spec` → `/design --delta` → evaluator chain
  (e.g. `--amendment-id` used consistently, `sprint-N` paths consistent).

- [ ] **Step 6: No commit for this task** — it is verification-only. If Step 5
surfaces findings, fix them as new commits and re-run Steps 1-4.
