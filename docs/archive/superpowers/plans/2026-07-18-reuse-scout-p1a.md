# Reuse-Scout + Seam Metadata (P1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the deterministic *grounding layer* of the evolution loop — `reuse-scout` (ranks which existing seam a new story could extend, and whether to fire the reuse dialogue) plus the seam-metadata schema it reads — so P1b's intake dialogue has real evidence to interrogate.

**Architecture:** `reuse-scout` is a **non-gate feedforward tool** (lib + CLI + tests, like `seam-confidence`/`naming-clusters`). It reuses existing helpers — `scoreSeams()` (structural + goal-term seam ranking), `seamConfidence()` (0.5-threshold band), the P0 `cloneKeys`/`runJscpd` clone signal — and one net-new deterministic `## Invariants` parser. Seam metadata (C2) is optional fields on the existing `component-map`/`design-traces` artifacts, defined in the `/design` skill's authoring instructions; existing consumers are duck-typed and already tolerate them.

**Tech Stack:** Node.js (CommonJS), `node:test`, existing `.claude/skills/seam-finder/scripts/score_seams.js`, `.claude/hooks/lib/duplication-gate.js`.

## Global Constraints

- **Non-gate tool.** `reuse-scout` must NOT be added to `gate-registry.js` `GATE_CATALOG` — it is feedforward, invoked by a skill step (P1b) / directly, never blocks a commit. Register it only as a manifest entry (`kind: feedforward`-style).
- **Reuse, don't reinvent.** Rank seams via `scoreSeams(graph, goal)` from `.claude/skills/seam-finder/scripts/score_seams.js`; compute the band via the same logic as `.claude/scripts/seam-confidence.js` (threshold 0.5). Use the P0 clone signal (`.claude/hooks/lib/duplication-gate.js` `cloneKeys`) — never re-implement clone detection or seam scoring.
- **Degrade loud, never hard-fail.** Missing `code-graph.json`, missing constitution, or absent jscpd → announce + return a well-formed empty/low result with a reason, exit 0 (mirror `duplication-gate.js`'s loud-skip). reuse-scout never blocks anything.
- **C2 seam metadata is purely additive & optional.** Existing `component-map` consumer `ownership-check.js` `parseComponentMap` only harvests backtick tokens containing `/` or a source extension; **seam-metadata values must not be backtick-wrapped if they are file-path-like** (e.g. `instances`) or they'd be swept into the owned set. `trace-check.js` is duck-typed on `id`/`text`/`traces` and ignores extra keys — verify, don't assume.
- **Pure lib / CLI split + node:test**, importing lib functions directly (repo convention).
- **Run the full suite** (`node .claude/scripts/run-compact.js --kind test -- node --test test/*.test.js`) before the final commit; authoritative signal is `exit 0` / `fail 0`.

---

### Task 1: Constitution `## Invariants` parser

**Files:**
- Create: `.claude/hooks/lib/constitution-invariants.js`
- Test: `test/constitution-invariants.test.js`

**Interfaces:**
- Produces: `parseInvariants(text: string) -> string[]` — the `- ` bullet lines under a `## Invariants` heading, trimmed, HTML-comment and blank lines skipped, terminated at the next `## ` heading.

- [ ] **Step 1: Write the failing test**

```js
// test/constitution-invariants.test.js
'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { parseInvariants } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'constitution-invariants.js')
);

const SAMPLE = [
  '# Constitution', '',
  '## Invariants', '',
  '<!-- a comment to skip -->',
  '- All schema changes use expand-contract; no destructive migration in the same sprint.',
  '- Services communicate only through published API contracts.',
  '', '## Amendment History', '',
  '- 2026-07-01 added invariant X',
].join('\n');

test('parseInvariants returns only the bullets under ## Invariants', () => {
  const inv = parseInvariants(SAMPLE);
  assert.strictEqual(inv.length, 2);
  assert.match(inv[0], /expand-contract/);
  assert.match(inv[1], /published API contracts/);
  assert.ok(!inv.some((i) => /Amendment History|added invariant X/.test(i)), 'stops at next heading');
});

test('parseInvariants skips HTML comments and blanks', () => {
  assert.ok(!parseInvariants(SAMPLE).some((i) => /comment to skip/.test(i)));
});

test('parseInvariants tolerates a missing section', () => {
  assert.deepStrictEqual(parseInvariants('# Constitution\n\nno invariants here'), []);
  assert.deepStrictEqual(parseInvariants(''), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/constitution-invariants.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// .claude/hooks/lib/constitution-invariants.js
'use strict';

// Deterministic extractor for specs/design/constitution.md's `## Invariants`
// list. There is no other parser for it in the harness (it is otherwise
// LLM-read only). Returns the `- ` bullet lines under the `## Invariants`
// heading, stopping at the next `## ` heading. Tolerant: missing section -> [].

function parseInvariants(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) {
      inSection = /^##\s+invariants\b/i.test(line);
      continue;
    }
    if (!inSection) continue;
    if (!line || line.startsWith('<!--')) continue;
    const m = line.match(/^[-*]\s+(.*\S)\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

module.exports = { parseInvariants };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/constitution-invariants.test.js` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/constitution-invariants.js test/constitution-invariants.test.js
git commit -m "feat(reuse-scout): deterministic constitution ## Invariants parser"
```

---

### Task 2: reuse-scout core lib

**Files:**
- Create: `.claude/hooks/lib/reuse-scout.js`
- Test: `test/reuse-scout.test.js`

**Interfaces:**
- Consumes: `scoreSeams(graph, goal, opts)` from `../../skills/seam-finder/scripts/score_seams.js`; `parseInvariants` from `./constitution-invariants`.
- Produces: `scoutReuse({ graph, goal, invariantsText, batch }) -> { fire, band, target_seam, candidates, touched_invariants, intra_batch, reasons }` where `candidates` is the top-N scoreSeams results with `recommended_action` in `{extend,wrap,introduce-adapter}` surfaced first; `band` in `{high,medium,low}` (best score >= 0.7 high, >= 0.5 medium, else low); `fire` = `band !== 'low' || touched_invariants.length > 0`; `intra_batch` clusters stories in `batch` sharing >= 2 goal terms.
- `TOP_N = 5`, `BAND_HIGH = 0.7`, `BAND_MED = 0.5` (matches `seam-confidence.js`'s 0.5 seam cutoff).

- [ ] **Step 1: Write the failing test**

```js
// test/reuse-scout.test.js
'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { scoutReuse } = require(
  path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'reuse-scout.js')
);

// Minimal code-graph fixture: two service files, one clearly matching the goal.
const graph = {
  nodes: [
    { id: 'py:src/services/upload_service.py', kind: 'file', path: 'src/services/upload_service.py', symbols: ['UploadService', 'parse_upload'] },
    { id: 'py:src/services/report_service.py', kind: 'file', path: 'src/services/report_service.py', symbols: ['ReportService'] },
    { id: 'py:src/api/routes.py', kind: 'file', path: 'src/api/routes.py', symbols: ['router'] },
  ],
  edges: [
    { source: 'py:src/api/routes.py', target: 'py:src/services/upload_service.py', kind: 'imports' },
    { source: 'py:src/api/routes.py', target: 'py:src/services/report_service.py', kind: 'imports' },
  ],
  metrics: { files: 3, edges: 2, cycles: [], hubs: [
    { id: 'py:src/services/upload_service.py', fan_in: 1, fan_out: 0 },
    { id: 'py:src/services/report_service.py', fan_in: 1, fan_out: 0 },
  ] },
};

test('scoutReuse ranks the goal-matching seam first and fires on a real candidate', () => {
  const r = scoutReuse({ graph, goal: 'add a new upload source variant' });
  assert.ok(r.candidates.length >= 1);
  assert.match(r.candidates[0].path, /upload_service/, 'the upload seam ranks first for an upload goal');
  assert.ok(['high', 'medium', 'low'].includes(r.band));
  assert.strictEqual(typeof r.fire, 'boolean');
});

test('scoutReuse fires when an invariant is touched even on a weak seam match', () => {
  const invariantsText = '## Invariants\n\n- All uploads must go through the shared upload pipeline.\n';
  const r = scoutReuse({ graph, goal: 'upload pipeline change', invariantsText });
  assert.ok(r.touched_invariants.length >= 1, 'the upload invariant is flagged as touched');
  assert.strictEqual(r.fire, true);
});

test('scoutReuse degrades to a well-formed low result on an empty graph', () => {
  const r = scoutReuse({ graph: { nodes: [], edges: [], metrics: {} }, goal: 'anything' });
  assert.strictEqual(r.band, 'low');
  assert.strictEqual(r.target_seam, null);
  assert.ok(Array.isArray(r.candidates));
  assert.ok(r.reasons.length >= 1);
});

test('scoutReuse clusters intra-batch stories that share goal terms', () => {
  const r = scoutReuse({
    graph, goal: 'batch',
    batch: [
      { id: 'S1', goal: 'parse currency amount from invoice' },
      { id: 'S2', goal: 'parse currency amount from receipt' },
      { id: 'S3', goal: 'render dashboard chart' },
    ],
  });
  const cluster = r.intra_batch.find((c) => c.stories.includes('S1') && c.stories.includes('S2'));
  assert.ok(cluster, 'S1 and S2 (both currency-amount parsing) cluster together');
  assert.ok(!r.intra_batch.some((c) => c.stories.includes('S3') && c.stories.length > 1), 'S3 does not join');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/reuse-scout.test.js` → FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```js
// .claude/hooks/lib/reuse-scout.js
'use strict';

// Deterministic grounding for the reuse-or-justify loop (design spec C3).
// Ranks which existing seam a new story could EXTEND, decides whether to fire
// the reuse dialogue (confidence-gated), and flags touched constitution
// invariants + intra-batch story clusters. Non-gate: informs, never blocks.
// Reuses scoreSeams (structural + goal-term seam ranking); never reinvents it.

const { scoreSeams } = require('../../skills/seam-finder/scripts/score_seams');
const { parseInvariants } = require('./constitution-invariants');

const TOP_N = 5;
const BAND_HIGH = 0.7;
const BAND_MED = 0.5; // matches seam-confidence.js's seam cutoff

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'from', 'and', 'or', 'for', 'in', 'on', 'add', 'new', 'change', 'update', 'via']);
function terms(s) {
  return [...new Set(String(s || '').toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || [])].filter((t) => !STOP.has(t));
}

function bandFor(score) {
  if (score >= BAND_HIGH) return 'high';
  if (score >= BAND_MED) return 'medium';
  return 'low';
}

function touchedInvariants(goal, invariantsText) {
  const gt = new Set(terms(goal));
  return parseInvariants(invariantsText || '')
    .filter((inv) => terms(inv).some((t) => gt.has(t)));
}

function intraBatchClusters(batch) {
  const items = (batch || []).map((s) => ({ id: s.id, t: new Set(terms(s.goal || s.text)) }));
  const clusters = [];
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    if (seen.has(items[i].id)) continue;
    const group = [items[i].id];
    for (let j = i + 1; j < items.length; j++) {
      const shared = [...items[i].t].filter((t) => items[j].t.has(t));
      if (shared.length >= 2) { group.push(items[j].id); seen.add(items[j].id); }
    }
    if (group.length > 1) { seen.add(items[i].id); clusters.push({ stories: group }); }
  }
  return clusters;
}

function scoutReuse({ graph, goal, invariantsText, batch } = {}) {
  const reasons = [];
  let ranked = [];
  try {
    ranked = scoreSeams(graph || { nodes: [], edges: [], metrics: {} }, goal || '', {}) || [];
  } catch (e) {
    reasons.push(`seam scoring unavailable: ${e.message}`);
  }
  // Surface extend/wrap/adapter candidates (reuse-shaped) first, then by score.
  const reuseActions = new Set(['extend', 'wrap', 'introduce-adapter']);
  const candidates = ranked
    .slice()
    .sort((a, b) => (reuseActions.has(b.recommended_action) - reuseActions.has(a.recommended_action))
      || (b.total_score - a.total_score))
    .slice(0, TOP_N);
  const best = candidates[0];
  const band = best ? bandFor(best.total_score) : 'low';
  if (!best) reasons.push('no seam candidates for this goal');
  const touched = touchedInvariants(goal, invariantsText);
  const intra = intraBatchClusters(batch);
  return {
    fire: band !== 'low' || touched.length > 0 || intra.length > 0,
    band,
    target_seam: best ? best.path : null,
    candidates,
    touched_invariants: touched,
    intra_batch: intra,
    reasons,
  };
}

module.exports = { scoutReuse, touchedInvariants, intraBatchClusters, terms };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/reuse-scout.test.js` → PASS (4 tests). If `scoreSeams`'s scoring puts the non-upload file first for the upload goal, inspect `score_seams.js`'s goal-term weighting and adjust the fixture's symbols to make the intended seam unambiguously higher — do NOT weaken the assertion; the goal-match must genuinely win.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/lib/reuse-scout.js test/reuse-scout.test.js
git commit -m "feat(reuse-scout): core scout lib (seam ranking + fire gate + invariant/intra-batch)"
```

---

### Task 3: reuse-scout CLI

**Files:**
- Create: `.claude/scripts/reuse-scout.js`
- Modify: `package.json` (add `"reuse-scout": "node .claude/scripts/reuse-scout.js",` after an existing seam/nav script line)
- Test: `test/reuse-scout-cli.test.js`

**Interfaces:**
- Consumes: `scoutReuse` from `../hooks/lib/reuse-scout`.
- CLI: `--graph <path>` (default `specs/brownfield/code-graph.json`), `--goal <str>`, `--constitution <path>` (default `specs/design/constitution.md`), `--batch <path>` (optional JSON `[{id,goal}]`), `--out <path>` (optional). Prints JSON to stdout. Degrade-loud (announce + `{fire:false,band:'low',...}`, exit 0) when the graph is missing.

- [ ] **Step 1: Write the failing test**

```js
// test/reuse-scout-cli.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, '.claude/scripts/reuse-scout.js');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('CLI exists, reuses the lib, is require-safe', () => {
  assert.ok(fs.existsSync(CLI));
  const src = read('.claude/scripts/reuse-scout.js');
  assert.match(src, /require\('\.\.\/hooks\/lib\/reuse-scout'\)/);
  assert.match(src, /require\.main === module/);
});

test('package.json exposes the reuse-scout script', () => {
  assert.strictEqual(JSON.parse(read('package.json')).scripts['reuse-scout'], 'node .claude/scripts/reuse-scout.js');
});

test('CLI emits JSON with a fire decision for a real graph fixture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-'));
  const graph = path.join(dir, 'g.json');
  fs.writeFileSync(graph, JSON.stringify({
    nodes: [{ id: 'py:src/services/upload_service.py', kind: 'file', path: 'src/services/upload_service.py', symbols: ['UploadService'] }],
    edges: [], metrics: { files: 1, edges: 0, cycles: [], hubs: [{ id: 'py:src/services/upload_service.py', fan_in: 3, fan_out: 0 }] },
  }));
  const out = execFileSync('node', [CLI, '--graph', graph, '--goal', 'upload source variant'], { cwd: ROOT, encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.strictEqual(typeof r.fire, 'boolean');
  assert.ok(['high', 'medium', 'low'].includes(r.band));
});

test('CLI degrades loud (exit 0 + low result) when the graph is missing', () => {
  let code = 0; let out = '';
  try { out = execFileSync('node', [CLI, '--graph', '/no/such/graph.json', '--goal', 'x'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { code = e.status; out = `${e.stdout || ''}${e.stderr || ''}`; }
  assert.strictEqual(code, 0);
  assert.match(out, /"band":\s*"low"|graph .*not found|unavailable/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/reuse-scout-cli.test.js` → FAIL (CLI missing).

- [ ] **Step 3: Write the CLI**

```js
// .claude/scripts/reuse-scout.js
#!/usr/bin/env node
'use strict';

// CLI for reuse-scout (design spec C3). Non-gate feedforward tool: ranks the
// existing seam a new story could extend and whether to fire the reuse dialogue.
// Degrades loud (announce + low result, exit 0) when inputs are missing.

const fs = require('fs');
const path = require('path');
const { scoutReuse } = require('../hooks/lib/reuse-scout');

const REPO = path.resolve(__dirname, '..', '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function readMaybe(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return undefined; } }

function main() {
  const graphPath = path.resolve(REPO, arg('--graph', 'specs/brownfield/code-graph.json'));
  const goal = arg('--goal', '');
  const constitutionText = readMaybe(path.resolve(REPO, arg('--constitution', 'specs/design/constitution.md')));
  const batchRaw = readMaybe(path.resolve(REPO, arg('--batch', '')));
  const outPath = arg('--out', '');

  const graphText = readMaybe(graphPath);
  let result;
  if (!graphText) {
    result = { fire: false, band: 'low', target_seam: null, candidates: [], touched_invariants: [], intra_batch: [], reasons: [`code-graph not found at ${graphPath} — run /code-map first (loud skip)`] };
  } else {
    let graph = {};
    try { graph = JSON.parse(graphText); } catch (_) { graph = { nodes: [], edges: [], metrics: {} }; }
    let batch;
    try { batch = batchRaw ? JSON.parse(batchRaw) : undefined; } catch (_) { batch = undefined; }
    result = scoutReuse({ graph, goal, invariantsText: constitutionText, batch });
  }

  const json = JSON.stringify(result, null, 2);
  if (outPath) { try { fs.writeFileSync(path.resolve(REPO, outPath), json + '\n'); } catch (_) { /* best effort */ } }
  process.stdout.write(json + '\n');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { main };
```

- [ ] **Step 4: Add the npm script**

In `package.json` scripts, after an existing seam/nav line (e.g. `"seam-confidence"` if present, else near `"coupling-gate"`), add:
```json
    "reuse-scout": "node .claude/scripts/reuse-scout.js",
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/reuse-scout-cli.test.js` → PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/reuse-scout.js package.json test/reuse-scout-cli.test.js
git commit -m "feat(reuse-scout): CLI (reads code-graph + goal + constitution, degrades loud)"
```

---

### Task 4: Seam-metadata schema (C2) — authoring instructions + tolerance test

**Files:**
- Modify: `.claude/skills/design/references/mode-10-step-1-spawn-two-agents-concurrently.md` (component-map + design-traces authoring instructions)
- Modify: `.claude/skills/design/references/mode-03-delta-mode-delta.md` (delta authoring — same optional fields)
- Test: `test/seam-metadata-tolerance.test.js` (create)

**Interfaces:**
- Consumes (verifies tolerance of): `parseComponentMap` from `../.claude/scripts/ownership-check.js`; `classify`/`idSet` from `../.claude/scripts/trace-check.js` (whichever it exports) — round-trip real fixtures through the REAL parsers.

- [ ] **Step 1: Write the failing tolerance test**

```js
// test/seam-metadata-tolerance.test.js
'use strict';
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ownership = require(path.resolve(__dirname, '..', '.claude', 'scripts', 'ownership-check.js'));

test('ownership parseComponentMap ignores non-path seam metadata, keeps real paths', () => {
  // seam metadata values are NOT backtick-wrapped as paths; the file path IS.
  const map = [
    '| Story | Files | Seam | Mechanism |',
    '|---|---|---|---|',
    '| E1-S1 | `src/services/upload_service.py` | seam: true | extension_mechanism: config |',
  ].join('\n');
  const owned = ownership.parseComponentMap(map);
  assert.ok(owned.has('src/services/upload_service.py'), 'the real source path is still owned');
  assert.ok(![...owned].some((t) => /true|config|seam|mechanism/i.test(t)), 'seam metadata words are not swept into ownership');
});
```

(If `ownership-check.js` does not export `parseComponentMap`, this task's Step 1 first adds it to that file's `module.exports` — a one-line, purely-additive export — then the test above. Confirm by reading the file's current exports.)

- [ ] **Step 2: Run to verify it fails** (or fails to import the export)

Run: `node --test test/seam-metadata-tolerance.test.js`
Expected: FAIL — `parseComponentMap` not exported, or (once exported) the assertion pins the tolerance contract.

- [ ] **Step 3: Make it pass**

Export `parseComponentMap` from `ownership-check.js` if not already exported (additive). The parser itself already ignores non-path tokens (verified: it only harvests backtick tokens with `/` or a source extension), so no logic change is needed — the test documents and locks the tolerance contract.

- [ ] **Step 4: Extend the design skill's authoring instructions**

In `mode-10-step-1-spawn-two-agents-concurrently.md`, in the `component-map.md` instruction (item 7), append a paragraph:

```
> **Seam metadata (optional, for the reuse-or-justify loop):** a component that is a designed extension point may also carry `seam: true`, an `extension_mechanism` of `config | strategy | node | subclass`, an `instances:` note listing the story ids that already extend it, and a `budget:` note (e.g. latency/memory/cost). Write these as plain table cells or prose — do NOT wrap non-path values (mechanism, instances, budget numbers) in backticks, because the ownership sensor treats backticked tokens as owned file paths.
```

In `design-traces.json`'s instruction (the JSON example), add a comment line noting a component entry may also carry optional `"extends_seam": "<seam-id>"` and `"budget_inherited_from": "<seam-id>"` keys (the validator `trace-check.js` reads only `id`/`text`/`traces` and passes extra keys through untouched).

Mirror the same optional-field note in `mode-03-delta-mode-delta.md`'s Step D4 (delta appends to the same artifacts).

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/seam-metadata-tolerance.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add test/seam-metadata-tolerance.test.js .claude/scripts/ownership-check.js .claude/skills/design/references/mode-10-step-1-spawn-two-agents-concurrently.md .claude/skills/design/references/mode-03-delta-mode-delta.md
git commit -m "feat(reuse-scout): define optional seam metadata + lock ownership tolerance"
```

---

### Task 5: Register reuse-scout as a feedforward tool + full suite

**Files:**
- Modify: `harness-manifest.json` (add `reuse-scout` as a `guides[]`/feedforward entry — NOT a sensor/gate)
- Modify: `.claude/scripts/scaffold-copy.js` (add `'reuse-scout.js'` to `CORE_SCRIPTS` so it ships to scaffolded projects)

- [ ] **Step 1: Read how feedforward tools are registered**

Read `harness-manifest.json`'s `guides[]` array and a sibling feedforward entry (e.g. how `seam-finder`/`score-seams` or another non-gate helper is listed, if at all). Determine whether reuse-scout belongs in `guides[]` (feedforward) with `axis: architecture`. Match the required fields `validate-harness-manifest.js` enforces (`id`, `axis`, `status`, `wired_at`, and for guides whatever the schema requires).

- [ ] **Step 2: Add the manifest entry + scaffold-copy entry**

Add a `guides[]` entry for `reuse-scout` (`axis: architecture`, `status: active`, `wired_at: .claude/scripts/reuse-scout.js`, a `signal`/`description` naming its feedforward role: "ranks the existing seam a new story could extend; feeds the reuse-or-justify intake dialogue"). Add `'reuse-scout.js'` to `CORE_SCRIPTS` in `.claude/scripts/scaffold-copy.js`.

- [ ] **Step 3: Validate + full suite**

Run: `node .claude/scripts/validate-harness-manifest.js` → exit 0.
If the new guide trips the control-budget meta-ratchet, add a `net_add_justification` (genuine new feedforward coverage) and re-run `node .claude/scripts/control-budget-gate.js` to ratchet the baseline (same honest-registration path as P0's duplication-ratchet). Do NOT loosen any gate or weaken any test.
Run the full suite: `node .claude/scripts/run-compact.js --kind test -- node --test test/*.test.js` → `exit 0` / `fail 0`. (iCloud-hang: kill orphaned `node --test`, delete ` 2.`-suffixed dupes, re-run.)

- [ ] **Step 4: Commit**

```bash
git add harness-manifest.json .claude/scripts/scaffold-copy.js .claude/state/control-budget-baseline.json 2>/dev/null || true
git commit -m "feat(reuse-scout): register feedforward tool in manifest + scaffold-copy"
```

---

## Self-Review

- **Spec coverage:** Implements spec C3 (`reuse-scout`) fully and C2 (seam metadata) as schema + tolerance + authoring instructions. The C1 intake dialogue is P1b (out of scope). Performance-budget fields in seam metadata are *defined* here (so reuse-scout/C1 can read them) but *enforced* in P3.
- **Placeholder scan:** Every code step has complete code; Tasks 4-5 reference sibling files to match conventions (manifest guide shape, ownership exports) — the substitutions are spelled out.
- **Type consistency:** `scoutReuse` returns the same shape in lib and CLI; `parseInvariants(text)->string[]` used identically in Task 1 and Task 2; the CLI reuses the lib; `reuse-scout.js` basename consistent across package.json, scaffold-copy, and `wired_at`.
- **Degrade-loud** is asserted in both the lib (empty-graph test) and CLI (missing-graph test).
- **Follow-ups (P1b):** the intake dialogue skill (C1) invoking `reuse-scout` at `/change` Step S2's existing "Seam plan" bullet, recording the decision + budget into the component-map/design-traces seam fields defined here.
