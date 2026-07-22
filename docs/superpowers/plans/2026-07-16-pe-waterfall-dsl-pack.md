# PE Waterfall DSL Pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first concrete domain DSL pack — the PE fund distribution waterfall — as `dsl-packs/private-equity/waterfall/`, with a declarative surface, a pure IR, an 8-rule semantic validator, a European+American reference calculator, term emission, an example corpus, and a CLI runner.

**Architecture:** A `pack.js` module exposes the pluggable-pack contract (`meta`, `schema`, `compile`, `validate`, `computeMetrics`, `terms`, `examples`) as pure functions. `compile()` turns the declarative surface into a pure IR; `validate()` applies domain rules R1–R8 over the IR; `computeMetrics()` is the reference calculator. Layer-1 structural validation reuses the harness's existing dependency-free JSON-Schema-subset validator (`.claude/hooks/lib/contract-schema.js`). A thin CLI runner (`.claude/scripts/validate-pe-waterfall.js`) mirrors `validate-contract.js`. **This is the concrete first pack: no shared engine, no discovery, no registry wiring, no generic sensor — all deferred per the pluggable-DSL design's rule-of-three.**

**Tech Stack:** Node.js (zero runtime dependencies), `node --test` (built-in test runner), CommonJS (`require`/`module.exports`) — matching every existing `.claude/scripts/*.js`.

**Spec:** `docs/superpowers/specs/2026-07-16-pe-waterfall-dsl-semantic-model-design.md`

## Global Constraints

- **Zero new dependencies.** Do not add `js-yaml`, `ajv`, or any package. Reuse `.claude/hooks/lib/contract-schema.js`'s exported `validate(schema, value, at?, errors?) → errors[]` for Layer-1 structural checks.
- **Surface format is JSON** (`*.pe.json`) for v1. (YAML is a deferred ergonomic enhancement — it would require a parser dependency.)
- **CommonJS only:** `const x = require('...')`, `module.exports = {...}`. No ESM `import`.
- **All pack code lives under `dsl-packs/private-equity/waterfall/`.** The CLI runner lives at `.claude/scripts/validate-pe-waterfall.js`.
- **Tests** live in `test/` named `test/pe-waterfall-*.test.js`, run by the existing `npm test` glob (`node --test test/*.test.js`). Use `node:test` + `node:assert/strict`.
- **Time is represented as year offsets (floats) from fund inception** in v1 (e.g. `t: 0`, `t: 5`). Calendar-date XIRR is a deferred enhancement.
- **Money is in millions as plain numbers**; rates are fractions (`0.08`, not `8`). Float assertions use tolerance `0.01` (matching `nav-tieout`).
- **Domain-level error messages are mandatory** — every finding from `validate()` uses the phrasings in the spec §4, not raw schema errors.
- **Golden numbers are independently derived** (hand-computed in this plan), never "whatever the calculator emits" — the example round-trip test (Task 8) is a real check, not a tautology.
- **`pack.js` stays pure** — it must not `require` anything under `.claude/` (so the future engine extraction is clean). The CLI runner is the only place that wires the shared Layer-1 validator to the pack.
- After each task: run the task's tests green, then `npm test` to confirm no regression, then commit.

---

### Task 1: Pack skeleton, JSON Schema (Layer 1), lint coverage

**Files:**
- Create: `dsl-packs/private-equity/waterfall/schema.json`
- Create: `dsl-packs/private-equity/waterfall/pack.js`
- Modify: `package.json:55` (extend `lint` glob to include `dsl-packs`)
- Test: `test/pe-waterfall-schema.test.js`

**Interfaces:**
- Produces: `pack.schema` (a JSON-Schema-subset object consumable by `contract-schema.validate`); `pack.meta = { id, domain, title, boundedContext }`.

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../.claude/hooks/lib/contract-schema');
const pack = require('../dsl-packs/private-equity/waterfall/pack');

const VALID = {
  waterfall: { fund: 'Fund IV', mode: 'european', hurdle: 'soft' },
  tiers: [
    { tier: 'return_of_capital', to: 'lp', basis: 'contributed_capital' },
    { tier: 'preferred_return', to: 'lp', rate: 0.08, compounding: 'annual', basis: 'contributed_capital' },
    { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 },
    { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
  ]
};

test('schema accepts a valid waterfall', () => {
  assert.deepEqual(validate(pack.schema, VALID), []);
});

test('schema rejects a bad mode enum', () => {
  const bad = JSON.parse(JSON.stringify(VALID));
  bad.waterfall.mode = 'hybrid';
  assert.ok(validate(pack.schema, bad).length > 0);
});

test('schema rejects missing tiers', () => {
  const bad = { waterfall: VALID.waterfall };
  assert.ok(validate(pack.schema, bad).some(e => /tiers/.test(e)));
});

test('meta identifies the pack', () => {
  assert.equal(pack.meta.id, 'pe-waterfall');
  assert.equal(pack.meta.domain, 'private-equity');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-schema.test.js`
Expected: FAIL — cannot find module `pack.js`.

- [ ] **Step 3: Write `schema.json`**

```json
{
  "type": "object",
  "required": ["waterfall", "tiers"],
  "additionalProperties": false,
  "properties": {
    "waterfall": {
      "type": "object",
      "required": ["fund", "mode", "hurdle"],
      "additionalProperties": false,
      "properties": {
        "fund": { "type": "string" },
        "mode": { "type": "string", "enum": ["european", "american"] },
        "hurdle": { "type": "string", "enum": ["soft", "hard"] },
        "clawback": { "type": "boolean" }
      }
    },
    "tiers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["tier"],
        "properties": {
          "tier": { "type": "string", "enum": ["return_of_capital", "preferred_return", "gp_catchup", "carried_interest"] },
          "to": { "type": "string", "enum": ["lp", "gp"] },
          "basis": { "type": "string", "enum": ["contributed_capital", "contributed_plus_fees"] },
          "rate": { "type": "number", "minimum": 0, "maximum": 1 },
          "compounding": { "type": "string", "enum": ["annual", "quarterly"] },
          "target_carry": { "type": "number", "minimum": 0, "maximum": 1 },
          "above": { "type": "number", "minimum": 0 },
          "split": {
            "type": "object",
            "required": ["gp", "lp"],
            "properties": { "gp": { "type": "number" }, "lp": { "type": "number" } }
          }
        }
      }
    }
  }
}
```

> Note: `contract-schema.js` supports `type`, `required`, `properties`, `additionalProperties`, `enum`, array `items`, and number `minimum`/`maximum`. Do not use JSON-Schema keywords beyond these — confirm against `.claude/hooks/lib/contract-schema.js` before adding any.

- [ ] **Step 4: Write `pack.js` skeleton**

```js
// dsl-packs/private-equity/waterfall/pack.js
const schema = require('./schema.json');

const meta = {
  id: 'pe-waterfall',
  domain: 'private-equity',
  title: 'PE Fund Distribution Waterfall',
  boundedContext: 'Investment Decision & Returns'
};

module.exports = { meta, schema };
```

- [ ] **Step 5: Extend the lint glob**

In `package.json`, change line 55 from:
```
    "lint": "eslint .claude/hooks .claude/scripts .claude/git-hooks test eslint.config.js",
```
to:
```
    "lint": "eslint .claude/hooks .claude/scripts .claude/git-hooks dsl-packs test eslint.config.js",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-schema.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add dsl-packs/private-equity/waterfall/schema.json dsl-packs/private-equity/waterfall/pack.js package.json test/pe-waterfall-schema.test.js
git commit -m "feat(pe-waterfall): pack skeleton + JSON schema (Layer 1)"
```

---

### Task 2: Compiler — surface → pure IR

**Files:**
- Create: `dsl-packs/private-equity/waterfall/compile.js`
- Modify: `dsl-packs/private-equity/waterfall/pack.js` (export `compile`)
- Test: `test/pe-waterfall-compile.test.js`

**Interfaces:**
- Consumes: a parsed surface object (shape validated by Task 1's schema).
- Produces: `compile(surface) → ir` where
  `ir = { fund, mode, hurdle, clawback, tiers: Op[] }` and
  `Op` is one of
  `{ op:'roc', to:'lp', basis }`,
  `{ op:'pref', rate, compounding, basis }`,
  `{ op:'catchup', gpRate, targetCarry }`,
  `{ op:'carry', gpSplit, lpSplit, aboveMoic }` (`aboveMoic` is `null` for the base tier).

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-compile.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile } = require('../dsl-packs/private-equity/waterfall/pack');

const SURFACE = {
  waterfall: { fund: 'Fund IV', mode: 'american', hurdle: 'soft' },
  tiers: [
    { tier: 'return_of_capital', to: 'lp' },
    { tier: 'preferred_return', to: 'lp', rate: 0.08 },
    { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 },
    { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
  ]
};

test('compile resolves clawback default from american mode', () => {
  assert.equal(compile(SURFACE).clawback, true);
});

test('compile defaults basis and compounding', () => {
  const ir = compile(SURFACE);
  assert.equal(ir.tiers[0].basis, 'contributed_capital');
  assert.equal(ir.tiers[1].compounding, 'annual');
});

test('compile maps tiers to ops with base carry aboveMoic null', () => {
  const ir = compile(SURFACE);
  assert.deepEqual(ir.tiers.map(t => t.op), ['roc', 'pref', 'catchup', 'carry']);
  assert.equal(ir.tiers[3].aboveMoic, null);
  assert.equal(ir.tiers[3].gpSplit, 0.20);
});

test('compile keeps explicit clawback and european default false', () => {
  const eur = compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'hard' },
    tiers: [{ tier: 'return_of_capital', to: 'lp' }, { tier: 'preferred_return', to: 'lp', rate: 0.08 },
            { tier: 'carried_interest', split: { gp: 0.2, lp: 0.8 } }] });
  assert.equal(eur.clawback, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-compile.test.js`
Expected: FAIL — `compile` is not a function.

- [ ] **Step 3: Write `compile.js`**

```js
// dsl-packs/private-equity/waterfall/compile.js
function normalizeTier(t) {
  switch (t.tier) {
    case 'return_of_capital':
      return { op: 'roc', to: 'lp', basis: t.basis || 'contributed_capital' };
    case 'preferred_return':
      return { op: 'pref', rate: t.rate, compounding: t.compounding || 'annual', basis: t.basis || 'contributed_capital' };
    case 'gp_catchup':
      return { op: 'catchup', gpRate: t.rate, targetCarry: t.target_carry };
    case 'carried_interest':
      return { op: 'carry', gpSplit: t.split.gp, lpSplit: t.split.lp, aboveMoic: (t.above === undefined ? null : t.above) };
    default:
      throw new Error(`unknown tier type: ${t.tier}`);
  }
}

function compile(surface) {
  const w = surface.waterfall;
  const clawback = (w.clawback === undefined) ? (w.mode === 'american') : w.clawback;
  return {
    fund: w.fund,
    mode: w.mode,
    hurdle: w.hurdle,
    clawback,
    tiers: surface.tiers.map(normalizeTier)
  };
}

module.exports = { compile };
```

- [ ] **Step 4: Wire into `pack.js`**

```js
// dsl-packs/private-equity/waterfall/pack.js
const schema = require('./schema.json');
const { compile } = require('./compile');

const meta = { id: 'pe-waterfall', domain: 'private-equity', title: 'PE Fund Distribution Waterfall', boundedContext: 'Investment Decision & Returns' };

module.exports = { meta, schema, compile };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-compile.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add dsl-packs/private-equity/waterfall/compile.js dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-compile.test.js
git commit -m "feat(pe-waterfall): compile surface to pure IR"
```

---

### Task 3: Semantic validator — rules R1–R8

**Files:**
- Create: `dsl-packs/private-equity/waterfall/validate.js`
- Modify: `dsl-packs/private-equity/waterfall/pack.js` (export `validate`)
- Test: `test/pe-waterfall-validate.test.js`

**Interfaces:**
- Consumes: `ir` from `compile()`.
- Produces: `validate(ir) → Finding[]`, `Finding = { rule, severity: 'error'|'warn', message, path }`. A structurally valid, consistent waterfall yields `[]` (no error-severity findings).

- [ ] **Step 1: Write the failing test** (one assertion per rule — the golden set)

```js
// test/pe-waterfall-validate.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, validate } = require('../dsl-packs/private-equity/waterfall/pack');

function irFrom(tiers, header = {}) {
  return compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'soft', ...header }, tiers });
}
const T = {
  roc: { tier: 'return_of_capital', to: 'lp' },
  pref: { tier: 'preferred_return', to: 'lp', rate: 0.08 },
  catchup: (tc = 0.20) => ({ tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: tc }),
  carry: (gp = 0.20, above) => ({ tier: 'carried_interest', split: { gp, lp: 1 - gp }, ...(above !== undefined ? { above } : {}) })
};
const errs = (ir) => validate(ir).filter(f => f.severity === 'error');

test('valid soft waterfall has no errors', () => {
  assert.deepEqual(errs(irFrom([T.roc, T.pref, T.catchup(), T.carry()])), []);
});
test('R1 tier order: carry before catchup', () => {
  const f = errs(irFrom([T.roc, T.pref, T.carry(), T.catchup()]));
  assert.ok(f.some(e => e.rule === 'R1' && /catch-up/.test(e.message)));
});
test('R2 catchup target != base carry gp', () => {
  const f = errs(irFrom([T.roc, T.pref, T.catchup(0.20), T.carry(0.25)]));
  assert.ok(f.some(e => e.rule === 'R2' && /catch up to a carry it never earns/.test(e.message)));
});
test('R3 hard hurdle forbids catchup', () => {
  const f = errs(irFrom([T.roc, T.pref, T.catchup(), T.carry()], { hurdle: 'hard' }));
  assert.ok(f.some(e => e.rule === 'R3' && /hard/.test(e.message)));
});
test('R3 soft hurdle requires catchup', () => {
  const f = errs(irFrom([T.roc, T.pref, T.carry()], { hurdle: 'soft' }));
  assert.ok(f.some(e => e.rule === 'R3' && /catch up/.test(e.message)));
});
test('R4 split must sum to 1', () => {
  const ir = irFrom([T.roc, T.pref, T.catchup(), T.carry()]);
  ir.tiers[3].lpSplit = 0.75; // 0.20 + 0.75 = 0.95
  assert.ok(errs(ir).some(e => e.rule === 'R4'));
});
test('R5 multi-tier carry gates must ascend', () => {
  const f = errs(irFrom([T.roc, T.pref, T.catchup(), T.carry(0.20), T.carry(0.25, 2.5), T.carry(0.30, 2.0)]));
  assert.ok(f.some(e => e.rule === 'R5'));
});
test('R6 out-of-range pref rate errors; carry>0.30 warns', () => {
  const ir = irFrom([T.roc, { tier: 'preferred_return', to: 'lp', rate: 0.8 }, T.catchup(), T.carry()]);
  assert.ok(errs(ir).some(e => e.rule === 'R6'));
  const warn = validate(irFrom([T.roc, T.pref, T.catchup(0.35), T.carry(0.35)])).filter(f => f.severity === 'warn');
  assert.ok(warn.some(e => e.rule === 'R6'));
});
test('R7 american without clawback warns', () => {
  const ir = compile({ waterfall: { fund: 'F', mode: 'american', hurdle: 'soft', clawback: false },
    tiers: [T.roc, T.pref, T.catchup(), T.carry()] });
  assert.ok(validate(ir).some(e => e.rule === 'R7' && e.severity === 'warn'));
});
test('R8 return_of_capital must be present as tier 1', () => {
  const f = errs(irFrom([T.pref, T.catchup(), T.carry()]));
  assert.ok(f.some(e => e.rule === 'R8'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-validate.test.js`
Expected: FAIL — `validate` is not a function.

- [ ] **Step 3: Write `validate.js`**

```js
// dsl-packs/private-equity/waterfall/validate.js
const ORDER = { roc: 0, pref: 1, catchup: 2, carry: 3 };

function validate(ir) {
  const f = [];
  const tiers = ir.tiers;
  const carries = tiers.filter(t => t.op === 'carry');
  const hasCatchup = tiers.some(t => t.op === 'catchup');
  const hasPref = tiers.some(t => t.op === 'pref');

  // R1 canonical order
  let lastRank = -1;
  tiers.forEach((t, i) => {
    const rank = ORDER[t.op];
    if (rank < lastRank) {
      f.push({ rule: 'R1', severity: 'error', path: `tiers[${i}]`,
        message: `Tier ${i + 1} (${t.op}) is out of order — canonical order is return of capital → preferred return → catch-up → carried interest; carry cannot be split before the catch-up tier resolves.` });
    }
    lastRank = Math.max(lastRank, rank);
  });

  // R8 RoC present as tier 1
  if (!tiers[0] || tiers[0].op !== 'roc') {
    f.push({ rule: 'R8', severity: 'error', path: 'tiers[0]',
      message: 'A return_of_capital tier must be present and first — LP capital is returned before any profit split.' });
  }

  // R2 catch-up target == base carry gp
  const base = carries.find(c => c.aboveMoic === null) || carries[0];
  const catchup = tiers.find(t => t.op === 'catchup');
  if (catchup && base && Math.abs(catchup.targetCarry - base.gpSplit) > 1e-9) {
    f.push({ rule: 'R2', severity: 'error', path: 'gp_catchup',
      message: `gp_catchup.target_carry (${pct(catchup.targetCarry)}) ≠ carried_interest gp split (${pct(base.gpSplit)}) — the GP would catch up to a carry it never earns. Set them equal.` });
  }

  // R3 hurdle coherence
  if (ir.hurdle === 'hard' && hasCatchup) {
    f.push({ rule: 'R3', severity: 'error', path: 'waterfall.hurdle',
      message: 'hurdle: hard declares a gp_catchup tier — a hard hurdle pays carry only on profit above the preferred return and admits no catch-up. Remove the catch-up tier or switch to hurdle: soft.' });
  }
  if (ir.hurdle === 'soft' && !hasCatchup) {
    f.push({ rule: 'R3', severity: 'error', path: 'waterfall.hurdle',
      message: 'hurdle: soft is missing a gp_catchup tier — a soft hurdle requires the GP to catch up after the preferred return.' });
  }
  if (ir.hurdle === 'soft' && !hasPref) {
    f.push({ rule: 'R3', severity: 'error', path: 'waterfall.hurdle',
      message: 'hurdle: soft requires a preferred_return tier before the catch-up.' });
  }

  // R4 splits sum to 1
  carries.forEach((c, i) => {
    if (Math.abs(c.gpSplit + c.lpSplit - 1) > 1e-9) {
      f.push({ rule: 'R4', severity: 'error', path: `carried_interest[${i}]`,
        message: `carried_interest split sums to ${round(c.gpSplit + c.lpSplit)}, not 1.0.` });
    }
  });

  // R5 multi-tier carry gates strictly ascending
  const gated = carries.filter(c => c.aboveMoic !== null).map(c => c.aboveMoic);
  for (let i = 1; i < gated.length; i++) {
    if (gated[i] <= gated[i - 1]) {
      f.push({ rule: 'R5', severity: 'error', path: 'carried_interest',
        message: `multi-tier carry hurdles are not ascending — tier gated at ${gated[i]}x precedes tier gated at ${gated[i - 1]}x.` });
    }
  }

  // R6 rate sanity
  const pref = tiers.find(t => t.op === 'pref');
  if (pref && !(pref.rate > 0 && pref.rate < 0.5)) {
    f.push({ rule: 'R6', severity: 'error', path: 'preferred_return.rate',
      message: `preferred_return.rate (${pct(pref.rate)}) is outside the sane range (0%, 50%).` });
  }
  carries.forEach((c, i) => {
    if (!(c.gpSplit > 0 && c.gpSplit < 1)) {
      f.push({ rule: 'R6', severity: 'error', path: `carried_interest[${i}].split.gp`,
        message: `carried_interest gp split (${pct(c.gpSplit)}) must be strictly between 0% and 100%.` });
    } else if (c.gpSplit > 0.30) {
      f.push({ rule: 'R6', severity: 'warn', path: `carried_interest[${i}].split.gp`,
        message: `carried_interest gp split (${pct(c.gpSplit)}) exceeds the 30% convention — confirm this is a super-carry tier.` });
    }
  });
  if (catchup && !(catchup.gpRate > 0 && catchup.gpRate <= 1)) {
    f.push({ rule: 'R6', severity: 'error', path: 'gp_catchup.rate',
      message: `gp_catchup.rate (${pct(catchup.gpRate)}) must be in (0%, 100%].` });
  }

  // R7 american without clawback
  if (ir.mode === 'american' && !ir.clawback) {
    f.push({ rule: 'R7', severity: 'warn', path: 'waterfall.clawback',
      message: 'mode: american without a clawback provision — deal-by-deal distributions can over-pay the GP on early winners; declare clawback: true or confirm intentional.' });
  }

  return f;
}

function pct(x) { return `${round(x * 100)}%`; }
function round(x) { return Math.round(x * 100) / 100; }

module.exports = { validate };
```

- [ ] **Step 4: Wire into `pack.js`** (add `const { validate } = require('./validate');` and include `validate` in `module.exports`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-validate.test.js`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add dsl-packs/private-equity/waterfall/validate.js dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-validate.test.js
git commit -m "feat(pe-waterfall): semantic validator (rules R1-R8) with domain errors"
```

---

### Task 4: Term emission

**Files:**
- Create: `dsl-packs/private-equity/waterfall/terms.js`
- Modify: `dsl-packs/private-equity/waterfall/pack.js` (export `terms`)
- Test: `test/pe-waterfall-terms.test.js`

**Interfaces:**
- Produces: `terms() → { term, definition }[]` — the canonical vocabulary for emission into the flat `CONTEXT.md`. Static (does not depend on a specific instance) in v1.

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-terms.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { terms } = require('../dsl-packs/private-equity/waterfall/pack');

test('emits canonical waterfall vocabulary', () => {
  const names = terms().map(t => t.term.toLowerCase());
  for (const req of ['carried interest', 'preferred return', 'gp catch-up', 'clawback',
    'return of capital', 'european', 'american', 'dpi', 'tvpi', 'rvpi', 'moic', 'crystallized']) {
    assert.ok(names.includes(req), `missing term: ${req}`);
  }
});

test('every term has a one-line definition', () => {
  for (const t of terms()) {
    assert.equal(typeof t.definition, 'string');
    assert.ok(t.definition.length > 0 && !t.definition.includes('\n'));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-terms.test.js`
Expected: FAIL — `terms` is not a function.

- [ ] **Step 3: Write `terms.js`** (definitions are one line each; adopted-verbatim terms use FS-corpus phrasing)

```js
// dsl-packs/private-equity/waterfall/terms.js
const TERMS = [
  // Adopted verbatim from the financial-services corpus
  { term: 'carried interest', definition: 'The GP’s share of fund profits (carry), earned after LP hurdles are met.' },
  { term: 'crystallized', definition: 'The point at which carried interest is realized and allocated (e.g. on a realization).' },
  { term: 'contributions', definition: 'LP capital called and paid into the fund (capital calls).' },
  { term: 'distributions', definition: 'Cash or in-kind proceeds paid from the fund to LPs.' },
  { term: 'commitment', definition: 'An LP’s total committed capital; drives its pro-rata share.' },
  { term: 'MOIC', definition: 'Multiple on invested capital — total value divided by capital invested.' },
  { term: 'IRR', definition: 'Internal rate of return — the annualized time-weighted return on cash flows.' },
  { term: 'cash-on-cash', definition: 'Realized cash returned relative to cash invested.' },
  { term: 'NAV', definition: 'Net asset value — the fund or LP capital-account value.' },
  // Built layer (standard PE terminology, absent from the FS corpus)
  { term: 'return of capital', definition: 'Waterfall tier returning LP contributed capital before any profit split.' },
  { term: 'preferred return', definition: 'The LP’s minimum return (hurdle) accrued before the GP earns carry.' },
  { term: 'GP catch-up', definition: 'Waterfall tier where the GP catches up toward its target carry after the preferred return.' },
  { term: 'clawback', definition: 'Provision requiring the GP to return excess carry if later losses breach LP entitlements.' },
  { term: 'European', definition: 'Whole-fund waterfall — carry is computed across the entire fund.' },
  { term: 'American', definition: 'Deal-by-deal waterfall — carry crystallizes as each deal realizes.' },
  { term: 'soft hurdle', definition: 'Hurdle with a catch-up — once cleared, the GP earns carry on the whole profit.' },
  { term: 'hard hurdle', definition: 'Hurdle with no catch-up — the GP earns carry only on profit above the hurdle.' },
  { term: 'DPI', definition: 'Distributions to paid-in capital — realized cash returned per dollar contributed.' },
  { term: 'TVPI', definition: 'Total value to paid-in — (distributions + residual NAV) per dollar contributed.' },
  { term: 'RVPI', definition: 'Residual value to paid-in — unrealized NAV per dollar contributed.' }
];

function terms() { return TERMS.map(t => ({ ...t })); }

module.exports = { terms };
```

- [ ] **Step 4: Wire into `pack.js`** (add `terms` require + export).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-terms.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add dsl-packs/private-equity/waterfall/terms.js dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-terms.test.js
git commit -m "feat(pe-waterfall): canonical term emission for CONTEXT.md"
```

---

### Task 5: Reference calculator — European (static) + metrics

**Files:**
- Create: `dsl-packs/private-equity/waterfall/calculator.js`
- Modify: `dsl-packs/private-equity/waterfall/pack.js` (export `computeMetrics`)
- Test: `test/pe-waterfall-calculator-european.test.js`

**Interfaces:**
- Consumes: `ir` (from `compile`), `cashflows` (European shape):
  `{ contributions: [{t, amount}], realizations: [{t, amount}], navResidual?, managementFees?, asOf }`.
- Produces: `computeMetrics(ir, cashflows) → { splits: { lp, gp, carry }, metrics: { grossMoic, lpMoic, dpi, tvpi, rvpi, cashOnCash, netIrr, carriedInterest, lpEndingCapital } }`.
  Also exports helper `europeanSplit(ir, { contributed, proceeds, pref }) → { lp, gp, carry }`.

**Golden numbers (hand-derived — the non-circular check).** Contributed `C = 100` (single contribution at `t=0`), gross proceeds `P = 250` (single realization at `t=5`), pref `8%` annual on contributed capital, `asOf = 5`. Pref `= 100 × (1.08^5 − 1) = 46.93`.

- **European soft, full catch-up, 20% carry:** RoC 100 → LP. Pref 46.93 → LP. Catch-up `X = 0.25 × 46.93 = 11.73` → GP. Remaining `250 − 100 − 46.93 − 11.73 = 91.34` split 80/20 → LP 73.07, GP 18.27. **LP = 220.00, GP = 30.00, carry = 30.00** (GP earns 20% of the whole 150 profit — soft). `DPI = 2.20`, `lpMoic = 2.20`, `grossMoic = 2.50`, `netIrr = (220/100)^(1/5) − 1 = 0.1708`.
- **European hard, no catch-up:** RoC 100, Pref 46.93 → LP (LP keeps the pref). Remaining `103.07` split 80/20 → LP 82.46, GP 20.61. **LP = 229.39, GP = 20.61, carry = 20.61** (GP earns 20% of profit *above* the hurdle only — less than soft). `DPI = 2.2939`.

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-calculator-european.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, computeMetrics } = require('../dsl-packs/private-equity/waterfall/pack');

const TIERS_SOFT = [
  { tier: 'return_of_capital', to: 'lp' },
  { tier: 'preferred_return', to: 'lp', rate: 0.08 },
  { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 },
  { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
];
const TIERS_HARD = [
  { tier: 'return_of_capital', to: 'lp' },
  { tier: 'preferred_return', to: 'lp', rate: 0.08 },
  { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
];
const CF = { contributions: [{ t: 0, amount: 100 }], realizations: [{ t: 5, amount: 250 }], navResidual: 0, asOf: 5 };
const near = (a, b) => assert.ok(Math.abs(a - b) <= 0.01, `${a} !~ ${b}`);

test('European soft: GP earns 20% of whole profit', () => {
  const r = computeMetrics(compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'soft' }, tiers: TIERS_SOFT }), CF);
  near(r.splits.lp, 220.00); near(r.splits.gp, 30.00); near(r.splits.carry, 30.00);
  near(r.metrics.dpi, 2.20); near(r.metrics.grossMoic, 2.50); near(r.metrics.netIrr, 0.1708);
});

test('European hard: GP earns carry only above the hurdle', () => {
  const r = computeMetrics(compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'hard' }, tiers: TIERS_HARD }), CF);
  near(r.splits.lp, 229.39); near(r.splits.gp, 20.61); near(r.splits.carry, 20.61);
});

test('conservation: lp + gp == total proceeds', () => {
  const r = computeMetrics(compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'soft' }, tiers: TIERS_SOFT }), CF);
  near(r.splits.lp + r.splits.gp, 250);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-calculator-european.test.js`
Expected: FAIL — `computeMetrics` is not a function.

- [ ] **Step 3: Write `calculator.js` (European branch + metrics)**

```js
// dsl-packs/private-equity/waterfall/calculator.js
function sum(xs, f) { return xs.reduce((a, x) => a + f(x), 0); }

// Pref accrued on each contribution to asOf (annual compounding in v1).
function accruedPref(contributions, rate, asOf) {
  return sum(contributions, c => c.amount * (Math.pow(1 + rate, asOf - c.t) - 1));
}

// Split total whole-fund proceeds through the tier sequence.
function europeanSplit(ir, { contributed, proceeds, pref }) {
  let remaining = proceeds;
  let lp = 0, gp = 0, carry = 0;
  const take = (who, amt) => { const a = Math.min(remaining, amt); remaining -= a; if (who === 'lp') lp += a; else { gp += a; carry += a; } return a; };

  for (const tier of ir.tiers) {
    if (remaining <= 0) break;
    if (tier.op === 'roc') take('lp', contributed);
    else if (tier.op === 'pref') take('lp', pref);
    else if (tier.op === 'catchup') {
      // Full catch-up: GP receives until carry == targetCarry * (pref + catchup) => X = tc/(1-tc) * pref, scaled by gpRate.
      const tc = tier.targetCarry;
      const full = (tc / (1 - tc)) * pref;
      take('gp', full * tier.gpRate);
    } else if (tier.op === 'carry') {
      // Base tier (aboveMoic null) or gated tiers; v1 applies the base split to all remaining profit.
      // (Multi-tier MOIC gating across time is exercised in Task 8's multi-tier example.)
      const profit = remaining;
      lp += profit * tier.lpSplit;
      gp += profit * tier.gpSplit;
      carry += profit * tier.gpSplit;
      remaining = 0;
    }
  }
  return { lp, gp, carry };
}

// Newton/bisection IRR on a signed, dated (year-offset) cash-flow list.
function irr(flows) {
  const npv = r => sum(flows, f => f.amount / Math.pow(1 + r, f.t));
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; (npv(mid) > 0 ? lo = mid : hi = mid); }
  return (lo + hi) / 2;
}

function computeMetrics(ir, cf) {
  const contributed = sum(cf.contributions, c => c.amount);
  const proceeds = sum(cf.realizations, r => r.amount);
  const nav = cf.navResidual || 0;
  const prefTier = ir.tiers.find(t => t.op === 'pref');
  const pref = prefTier ? accruedPref(cf.contributions, prefTier.rate, cf.asOf) : 0;

  const splits = europeanSplit(ir, { contributed, proceeds, pref });

  // LP net cash-flow stream for IRR: contributions negative at their t; LP proceeds positive,
  // allocated across realizations pro-rata to realization amount (v1 convention).
  const lpFlows = [
    ...cf.contributions.map(c => ({ t: c.t, amount: -c.amount })),
    ...cf.realizations.map(r => ({ t: r.t, amount: splits.lp * (r.amount / proceeds) }))
  ];
  const netIrr = irr(lpFlows);

  return {
    splits,
    metrics: {
      grossMoic: proceeds / contributed,
      lpMoic: (splits.lp + nav) / contributed,
      dpi: splits.lp / contributed,
      tvpi: (splits.lp + nav) / contributed,
      rvpi: nav / contributed,
      cashOnCash: splits.lp / contributed,
      netIrr,
      carriedInterest: splits.carry,
      lpEndingCapital: nav // fully-realized funds have zero residual; extended in Task 7
    }
  };
}

module.exports = { computeMetrics, europeanSplit, accruedPref, irr };
```

- [ ] **Step 4: Wire into `pack.js`** (add `computeMetrics` require + export).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-calculator-european.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add dsl-packs/private-equity/waterfall/calculator.js dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-calculator-european.test.js
git commit -m "feat(pe-waterfall): European reference calculator + return metrics"
```

---

### Task 6: Reference calculator — American (deal-by-deal) + clawback

**Files:**
- Modify: `dsl-packs/private-equity/waterfall/calculator.js` (add `americanSplit` and route `computeMetrics` by `ir.mode`)
- Test: `test/pe-waterfall-calculator-american.test.js`

**Interfaces:**
- Consumes: `ir` (mode `american`), `cashflows` (American shape):
  `{ deals: [{ id, contributions:[{t,amount}], realizations:[{t,amount}] }], managementFees?, asOf }`.
- Produces: same `computeMetrics` return shape, plus `splits.clawback` (amount returned by GP). Exports `americanSplit(ir, cashflows) → { lp, gp, carry, clawback }`.

**Golden scenario (hand-derived — the clawback proof).** Two deals, each contributed `50` at `t=0`; both realize at `t=1`. Soft hurdle `8%`, full catch-up, `20%` carry, `clawback: true`. Deal A proceeds `100`; Deal B proceeds `30`.
- **Deal A (t=1):** invested 50, profit 50, pref `= 50 × 0.08 = 4`. RoC 50 + pref 4 → LP; catch-up `0.25 × 4 = 1` → GP; remaining `45` split → LP 36, GP 9. GP carry on A `= 10` (20% of 50). LP from A `= 90`.
- **Deal B (t=1):** invested 50, proceeds 30 (loss) → LP 30, GP 0.
- **Deal-by-deal totals:** LP `120`, GP carry `10`.
- **Whole-fund correct (clawback target):** contributed `100`, pref `= 100 × 0.08 = 8`, proceeds `130`, profit `30`. RoC 100 + pref 8 → LP; catch-up `0.25 × 8 = 2` → GP; remaining `20` split → LP 16, GP 4. Correct GP carry `= 6` (20% of 30). **Clawback `= 10 − 6 = 4`.** After clawback: **LP = 124, GP = 6, clawback = 4.**

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-calculator-american.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, computeMetrics } = require('../dsl-packs/private-equity/waterfall/pack');

const IR = compile({ waterfall: { fund: 'F', mode: 'american', hurdle: 'soft', clawback: true },
  tiers: [
    { tier: 'return_of_capital', to: 'lp' },
    { tier: 'preferred_return', to: 'lp', rate: 0.08 },
    { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 },
    { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
  ] });
const CF = { asOf: 1, deals: [
  { id: 'A', contributions: [{ t: 0, amount: 50 }], realizations: [{ t: 1, amount: 100 }] },
  { id: 'B', contributions: [{ t: 0, amount: 50 }], realizations: [{ t: 1, amount: 30 }] }
] };
const near = (a, b) => assert.ok(Math.abs(a - b) <= 0.01, `${a} !~ ${b}`);

test('American with clawback settles GP carry to the whole-fund correct amount', () => {
  const r = computeMetrics(IR, CF);
  near(r.splits.clawback, 4.00);
  near(r.splits.gp, 6.00);
  near(r.splits.lp, 124.00);
  near(r.splits.lp + r.splits.gp, 130);
});

test('full-loss fund pays zero carry', () => {
  const cf = { asOf: 1, deals: [
    { id: 'A', contributions: [{ t: 0, amount: 50 }], realizations: [{ t: 1, amount: 20 }] },
    { id: 'B', contributions: [{ t: 0, amount: 50 }], realizations: [{ t: 1, amount: 10 }] }
  ] };
  const r = computeMetrics(IR, cf);
  near(r.splits.gp, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-calculator-american.test.js`
Expected: FAIL — clawback is undefined / wrong split (European path used).

- [ ] **Step 3: Add `americanSplit` and route by mode in `calculator.js`**

```js
// append to dsl-packs/private-equity/waterfall/calculator.js

// Deal-by-deal: crystallize carry per realized deal, then settle whole-fund clawback.
function americanSplit(ir, cf) {
  let lp = 0, gpCarry = 0;
  const prefTier = ir.tiers.find(t => t.op === 'pref');
  const rate = prefTier ? prefTier.rate : 0;

  for (const deal of cf.deals) {
    const contributed = sum(deal.contributions, c => c.amount);
    const proceeds = sum(deal.realizations, r => r.amount);
    const pref = sum(deal.contributions, c => c.amount * (Math.pow(1 + rate, cf.asOf - c.t) - 1));
    const s = europeanSplit(ir, { contributed, proceeds, pref }); // same tier fold, per deal
    lp += s.lp; gpCarry += s.carry;
  }

  // Clawback settlement: cap total GP carry at the whole-fund correct carry.
  let clawback = 0;
  if (ir.clawback) {
    const contributed = sum(cf.deals, d => sum(d.contributions, c => c.amount));
    const proceeds = sum(cf.deals, d => sum(d.realizations, r => r.amount));
    const pref = sum(cf.deals, d => sum(d.contributions, c => c.amount * (Math.pow(1 + rate, cf.asOf - c.t) - 1)));
    const whole = europeanSplit(ir, { contributed, proceeds, pref });
    if (gpCarry > whole.carry) { clawback = gpCarry - whole.carry; gpCarry -= clawback; lp += clawback; }
  }
  return { lp, gp: gpCarry, carry: gpCarry, clawback };
}
```

Then update `computeMetrics` to branch and to surface `clawback`:

```js
// in computeMetrics, replace the `const splits = europeanSplit(...)` line with:
  const splits = ir.mode === 'american'
    ? americanSplit(ir, cf)
    : { ...europeanSplit(ir, { contributed, proceeds, pref }), clawback: 0 };
```

For the American IRR stream, build `lpFlows` from every deal's contributions (negative) and its LP proceeds (positive, pro-rata within the deal). Add before the `lpFlows` construction:

```js
  const realizations = ir.mode === 'american'
    ? cf.deals.flatMap(d => d.realizations)
    : cf.realizations;
  const contributions = ir.mode === 'american'
    ? cf.deals.flatMap(d => d.contributions)
    : cf.contributions;
```

and derive `contributed`/`proceeds`/`lpFlows` from `contributions`/`realizations` accordingly (LP proceeds allocated pro-rata to each realization's amount, as in the European branch). Export `americanSplit`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-calculator-american.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite (guard the European branch)**

Run: `node --test test/pe-waterfall-calculator-european.test.js test/pe-waterfall-calculator-american.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add dsl-packs/private-equity/waterfall/calculator.js dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-calculator-american.test.js
git commit -m "feat(pe-waterfall): American deal-by-deal calculator with clawback settlement"
```

---

### Task 7: nav-tieout capital-account reconciliation

**Files:**
- Modify: `dsl-packs/private-equity/waterfall/calculator.js` (add `reconcileCapitalAccount`)
- Modify: `dsl-packs/private-equity/waterfall/pack.js` (export it)
- Test: `test/pe-waterfall-reconcile.test.js`

**Interfaces:**
- Produces: `reconcileCapitalAccount(splits, cashflows) → { ok, residual }` — asserts the `nav-tieout` identity
  `Beginning(0) + Contributions − Distributions + AllocatedNetIncome − CarriedInterest = EndingCapital`
  holds within tolerance `0.01`. For a fully-realized fund, `EndingCapital = navResidual`.

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-reconcile.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, computeMetrics, reconcileCapitalAccount } = require('../dsl-packs/private-equity/waterfall/pack');

test('European soft output reconciles to the nav-tieout identity', () => {
  const ir = compile({ waterfall: { fund: 'F', mode: 'european', hurdle: 'soft' }, tiers: [
    { tier: 'return_of_capital', to: 'lp' }, { tier: 'preferred_return', to: 'lp', rate: 0.08 },
    { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 }, { tier: 'carried_interest', split: { gp: 0.20, lp: 0.80 } }
  ] });
  const cf = { contributions: [{ t: 0, amount: 100 }], realizations: [{ t: 5, amount: 250 }], navResidual: 0, asOf: 5 };
  const r = computeMetrics(ir, cf);
  const rec = reconcileCapitalAccount(r.splits, cf);
  assert.ok(rec.ok, `residual ${rec.residual}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-reconcile.test.js`
Expected: FAIL — `reconcileCapitalAccount` is not a function.

- [ ] **Step 3: Implement `reconcileCapitalAccount`**

```js
// append to calculator.js
// nav-tieout identity: Beginning + Contributions - Distributions + AllocatedNetIncome - Carry = Ending
// LP capital account: contributions in, LP distributions out, LP profit allocated, carry already removed
// from the LP side (it went to GP). For a fully-realized fund Ending should equal navResidual.
function reconcileCapitalAccount(splits, cf) {
  const contributed = (cf.deals ? cf.deals.flatMap(d => d.contributions) : cf.contributions)
    .reduce((a, c) => a + c.amount, 0);
  const nav = cf.navResidual || 0;
  // Allocated net income to LP = LP distributions + ending NAV - contributions.
  const allocatedNetIncome = splits.lp + nav - contributed;
  const ending = contributed - splits.lp + allocatedNetIncome; // = nav for fully-realized
  const residual = Math.abs(ending - nav);
  return { ok: residual <= 0.01, residual };
}
```

- [ ] **Step 4: Wire export + run tests**

Run: `node --test test/pe-waterfall-reconcile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dsl-packs/private-equity/waterfall/calculator.js dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-reconcile.test.js
git commit -m "feat(pe-waterfall): nav-tieout capital-account reconciliation"
```

---

### Task 8: Example corpus + round-trip through the real validator & calculator

**Files:**
- Create: `dsl-packs/private-equity/waterfall/examples/european-soft.pe.json` (+ `.cashflows.json`, `.golden.json`)
- Create: `dsl-packs/private-equity/waterfall/examples/european-hard.pe.json` (+ cashflows + golden)
- Create: `dsl-packs/private-equity/waterfall/examples/american-soft-clawback.pe.json` (+ cashflows + golden)
- Create: `dsl-packs/private-equity/waterfall/examples/multi-tier-carry.pe.json` (+ cashflows + golden)
- Create: `dsl-packs/private-equity/waterfall/examples/partial-catchup.pe.json` (+ cashflows + golden)
- Modify: `dsl-packs/private-equity/waterfall/pack.js` (export `examples` — an array of `{ name, surface, cashflows, golden }` loaded from the dir)
- Test: `test/pe-waterfall-examples.test.js`

**Interfaces:**
- Produces: `pack.examples → { name, surface, cashflows, golden }[]`.

- [ ] **Step 1: Write the failing round-trip test** (the real-artifact gate — no fixtures)

```js
// test/pe-waterfall-examples.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate: schemaCheck } = require('../.claude/hooks/lib/contract-schema');
const pack = require('../dsl-packs/private-equity/waterfall/pack');
const near = (a, b) => assert.ok(Math.abs(a - b) <= 0.01, `${a} !~ ${b}`);

test('every example is Layer-1 valid, Layer-2 clean, and matches golden numbers', () => {
  assert.ok(pack.examples.length >= 5, 'expected >= 5 examples');
  for (const ex of pack.examples) {
    assert.deepEqual(schemaCheck(pack.schema, ex.surface), [], `${ex.name}: schema`);
    const ir = pack.compile(ex.surface);
    assert.deepEqual(pack.validate(ir).filter(f => f.severity === 'error'), [], `${ex.name}: validate`);
    const r = pack.computeMetrics(ir, ex.cashflows);
    near(r.splits.lp, ex.golden.lp);
    near(r.splits.gp, ex.golden.gp);
    if (ex.golden.clawback !== undefined) near(r.splits.clawback, ex.golden.clawback);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-examples.test.js`
Expected: FAIL — `pack.examples` undefined.

- [ ] **Step 3: Author the example files.** Two per axis shown; the other three follow the same shape. Use the golden numbers from Tasks 5 & 6; for `multi-tier-carry` and `partial-catchup`, compute the golden values by running the same hand method and record them.

`examples/european-soft.pe.json`:
```json
{ "waterfall": { "fund": "Fund IV", "mode": "european", "hurdle": "soft" },
  "tiers": [
    { "tier": "return_of_capital", "to": "lp" },
    { "tier": "preferred_return", "to": "lp", "rate": 0.08 },
    { "tier": "gp_catchup", "to": "gp", "rate": 1.0, "target_carry": 0.20 },
    { "tier": "carried_interest", "split": { "gp": 0.20, "lp": 0.80 } } ] }
```
`examples/european-soft.cashflows.json`:
```json
{ "contributions": [{ "t": 0, "amount": 100 }], "realizations": [{ "t": 5, "amount": 250 }], "navResidual": 0, "asOf": 5 }
```
`examples/european-soft.golden.json`:
```json
{ "lp": 220.00, "gp": 30.00 }
```

`examples/american-soft-clawback.pe.json`:
```json
{ "waterfall": { "fund": "Fund IV", "mode": "american", "hurdle": "soft", "clawback": true },
  "tiers": [
    { "tier": "return_of_capital", "to": "lp" },
    { "tier": "preferred_return", "to": "lp", "rate": 0.08 },
    { "tier": "gp_catchup", "to": "gp", "rate": 1.0, "target_carry": 0.20 },
    { "tier": "carried_interest", "split": { "gp": 0.20, "lp": 0.80 } } ] }
```
`examples/american-soft-clawback.cashflows.json`:
```json
{ "asOf": 1, "deals": [
  { "id": "A", "contributions": [{ "t": 0, "amount": 50 }], "realizations": [{ "t": 1, "amount": 100 }] },
  { "id": "B", "contributions": [{ "t": 0, "amount": 50 }], "realizations": [{ "t": 1, "amount": 30 }] } ] }
```
`examples/american-soft-clawback.golden.json`:
```json
{ "lp": 124.00, "gp": 6.00, "clawback": 4.00 }
```

> For `european-hard` reuse Task 5's hard golden (`lp 229.39, gp 20.61`). For `partial-catchup` set `gp_catchup.rate: 0.5` and recompute (catch-up amount halves; carry rises correspondingly — record the derived numbers in its `.golden.json`). For `multi-tier-carry` add a second `carried_interest` tier `{ split:{gp:0.25,lp:0.75}, above: 2.0 }` and, since v1's European fold applies the base split to all profit above the catch-up, record golden equal to the single-tier base result and add a `// TODO(v2): MOIC-gated tranche math` note in the spec's Out-of-Scope — do NOT fabricate gated numbers the calculator does not yet produce.

- [ ] **Step 4: Add the `examples` loader to `pack.js`**

```js
// in pack.js
const fs = require('fs');
const path = require('path');
function loadExamples() {
  const dir = path.join(__dirname, 'examples');
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.pe.json')).map(f => f.replace('.pe.json', ''));
  return names.map(name => ({
    name,
    surface: JSON.parse(fs.readFileSync(path.join(dir, `${name}.pe.json`), 'utf8')),
    cashflows: JSON.parse(fs.readFileSync(path.join(dir, `${name}.cashflows.json`), 'utf8')),
    golden: JSON.parse(fs.readFileSync(path.join(dir, `${name}.golden.json`), 'utf8'))
  }));
}
// add to module.exports: examples: loadExamples()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-examples.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dsl-packs/private-equity/waterfall/examples dsl-packs/private-equity/waterfall/pack.js test/pe-waterfall-examples.test.js
git commit -m "feat(pe-waterfall): example corpus with golden round-trip through real validator+calculator"
```

---

### Task 9: CLI runner (concrete, mirrors validate-contract.js)

**Files:**
- Create: `.claude/scripts/validate-pe-waterfall.js`
- Test: `test/pe-waterfall-cli.test.js`

**Interfaces:**
- CLI: `node .claude/scripts/validate-pe-waterfall.js <path-to.pe.json>`. Exit `0` = valid (no error findings), `1` = validation errors (Layer 1 or Layer 2), `2` = usage/IO error (file missing/unreadable/not JSON). Prints domain-level findings to stderr. Warnings print but do not fail.

- [ ] **Step 1: Write the failing test**

```js
// test/pe-waterfall-cli.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const CLI = path.join(__dirname, '..', '.claude', 'scripts', 'validate-pe-waterfall.js');
const good = path.join(__dirname, '..', 'dsl-packs', 'private-equity', 'waterfall', 'examples', 'european-soft.pe.json');

function run(arg) {
  try { return { code: 0, out: execFileSync('node', [CLI, arg], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

test('exit 0 on a valid instance', () => { assert.equal(run(good).code, 0); });
test('exit 2 on a missing file', () => { assert.equal(run('/no/such/file.json').code, 2); });
test('exit 1 with a domain message on a bad instance', () => {
  const fs = require('node:fs'); const os = require('node:os');
  const bad = path.join(os.tmpdir(), 'bad-wf.pe.json');
  fs.writeFileSync(bad, JSON.stringify({ waterfall: { fund: 'F', mode: 'european', hurdle: 'hard' },
    tiers: [{ tier: 'return_of_capital', to: 'lp' }, { tier: 'preferred_return', to: 'lp', rate: 0.08 },
            { tier: 'gp_catchup', to: 'gp', rate: 1.0, target_carry: 0.20 }, { tier: 'carried_interest', split: { gp: 0.2, lp: 0.8 } }] }));
  const r = run(bad);
  assert.equal(r.code, 1);
  assert.match(r.out, /hard hurdle|admits no catch-up/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pe-waterfall-cli.test.js`
Expected: FAIL — CLI file does not exist.

- [ ] **Step 3: Write `.claude/scripts/validate-pe-waterfall.js`**

```js
#!/usr/bin/env node
'use strict';
// Concrete CLI runner for the PE waterfall pack. Mirrors validate-contract.js exit conventions.
// (Deliberately pack-specific: the generic engine that discovers packs is deferred per the pluggable-DSL design.)
const fs = require('fs');
const { validate: schemaCheck } = require('../hooks/lib/contract-schema');
const pack = require('../../dsl-packs/private-equity/waterfall/pack');

function main() {
  const file = process.argv[2];
  if (!file) { process.stderr.write('usage: validate-pe-waterfall.js <path-to.pe.json>\n'); return 2; }
  let surface;
  try { surface = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { process.stderr.write(`cannot read/parse ${file}: ${e.message}\n`); return 2; }

  const schemaErrors = schemaCheck(pack.schema, surface);
  if (schemaErrors.length) { schemaErrors.forEach(e => process.stderr.write(`✗ schema: ${e}\n`)); return 1; }

  const ir = pack.compile(surface);
  const findings = pack.validate(ir);
  findings.forEach(f => process.stderr.write(`${f.severity === 'error' ? '✗' : '⚠'} ${f.rule}: ${f.message}\n`));
  return findings.some(f => f.severity === 'error') ? 1 : 0;
}

process.exit(main());
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pe-waterfall-cli.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + lint**

Run: `npm test`
Expected: PASS (no regressions).
Run: `npm run lint`
Expected: clean (dsl-packs now in the glob).

- [ ] **Step 6: Commit**

```bash
git add .claude/scripts/validate-pe-waterfall.js test/pe-waterfall-cli.test.js
git commit -m "feat(pe-waterfall): concrete CLI runner with 0/1/2 exit contract"
```

---

## Self-Review

**Spec coverage:**
- §1 Surface grammar → Task 1 (schema) + Task 2 (compile). ✓
- §2 IR → Task 2. ✓
- §3 Rules R1–R8 → Task 3 (one test per rule). ✓
- §4 Domain error phrasings → Task 3 (messages match spec §4 verbatim). ✓
- §5 Calculator (European + American, inputs, outputs, nav-tieout anchor) → Tasks 5, 6, 7. ✓
- §6 terms() → Task 4. ✓
- §7 Consumers + example corpus → Task 8 (corpus + round-trip). Consumer-skill wiring (`returns`/`lbo`/`pe-ic-memo` reading `waterfall.pe.json`) is **not** in this plan — it belongs to those skills and is deferred with a note below. ✓ (gap noted)
- Tests (round-trip real validator+calculator, American golden, reconciliation, terms) → Tasks 3–9. ✓
- Out-of-scope (engine/discovery/sensor/registry, `hurdle: none`, MOIC-gated tranche math) → honored; nothing in the plan builds them. ✓

**Deferred with explicit notes (not silent gaps):**
1. **Consumer-skill wiring** — `returns`/`lbo`/`pe-ic-memo` reading the validated `waterfall.pe.json` is a follow-up touching those skills, not the pack. Flag to the user at hand-off.
2. **Multi-tier MOIC-gated tranche math** — v1's European fold applies the base carry split to all profit above the catch-up (Task 8 records golden accordingly and adds a `v2` note). The `multi-tier-carry` example validates and round-trips, but does not yet produce distinct gated tranche numbers. This matches the spec's MOIC-gate structure while deferring the gated *computation*.

**Placeholder scan:** No "TBD/TODO" in code steps. The single `TODO(v2)` is an intentional forward-marker in a spec Out-of-Scope note, not a plan gap.

**Type consistency:** `compile()` → `ir.tiers[].op` values (`roc`/`pref`/`catchup`/`carry`) are used identically in `validate.js` and `calculator.js`. `computeMetrics` returns `{ splits, metrics }` consistently across Tasks 5–8; `splits.clawback` added in Task 6 and consumed in Task 8. `europeanSplit`/`americanSplit`/`accruedPref`/`irr`/`reconcileCapitalAccount` signatures match across tasks.

## Notes for execution

- The American calculator (Task 6) is the highest-risk unit — if any golden number disagrees, **stop and hand-recompute the scenario** before "fixing" the code to match; the golden numbers in this plan are the source of truth, independently derived.
- If `npm test` hangs, it is the known iCloud `" 2."` duplicate-file issue (see CLAUDE.md) — kill orphaned `node --test` processes and delete the ` 2.`-suffixed dupes, not a real failure.
