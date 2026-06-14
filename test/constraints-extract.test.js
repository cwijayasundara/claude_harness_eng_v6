'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'constraints-extract.js');
const { extractObligations, obligationIndex } = require(SCRIPT);

// constraints-extract mines machine-readable validation rules out of the design
// schemas (data-models.schema.json + api-contracts.schema.json) and turns each
// one into a negative-test *obligation* — a thing the test suite must prove gets
// rejected. The obligations become a `required` index for trace-check.js, so an
// un-covered constraint fails the same hard gate as an un-covered AC.

const dataModels = {
  $defs: {
    User: {
      type: 'object',
      required: ['email', 'username'],
      properties: {
        email: { type: 'string', format: 'email' },
        username: { type: 'string', minLength: 3, maxLength: 20, pattern: '^[a-z0-9_]+$' },
        age: { type: 'integer', minimum: 18, maximum: 120 },
        role: { type: 'string', enum: ['admin', 'member', 'guest'] },
      },
    },
  },
};

function byRule(obs, field, rule) {
  return obs.find((o) => o.field === field && o.rule === rule);
}

test('extracts a required obligation for each required property', () => {
  const { obligations } = extractObligations([{ label: 'data-models.schema.json', schema: dataModels }]);
  assert.ok(byRule(obligations, 'User.email', 'required'), 'email required obligation');
  assert.ok(byRule(obligations, 'User.username', 'required'), 'username required obligation');
});

test('extracts length, pattern, range, enum and format obligations', () => {
  const { obligations } = extractObligations([{ label: 'data-models.schema.json', schema: dataModels }]);
  assert.strictEqual(byRule(obligations, 'User.username', 'minLength').value, 3);
  assert.strictEqual(byRule(obligations, 'User.username', 'maxLength').value, 20);
  assert.strictEqual(byRule(obligations, 'User.username', 'pattern').value, '^[a-z0-9_]+$');
  assert.strictEqual(byRule(obligations, 'User.age', 'minimum').value, 18);
  assert.strictEqual(byRule(obligations, 'User.age', 'maximum').value, 120);
  assert.deepStrictEqual(byRule(obligations, 'User.role', 'enum').value, ['admin', 'member', 'guest']);
  assert.strictEqual(byRule(obligations, 'User.email', 'format').value, 'email');
});

test('every obligation has a stable OBL- id, a field, and at least one suggested case', () => {
  const { obligations } = extractObligations([{ label: 'data-models.schema.json', schema: dataModels }]);
  for (const o of obligations) {
    assert.match(o.id, /^OBL-/, `id format for ${JSON.stringify(o)}`);
    assert.ok(o.field, 'field present');
    assert.ok(Array.isArray(o.suggested_cases) && o.suggested_cases.length >= 1, 'suggested_cases present');
  }
  // id encodes field + rule deterministically
  assert.strictEqual(byRule(obligations, 'User.age', 'minimum').id, 'OBL-User.age-minimum');
});

test('obligations are sorted by id and deduplicated', () => {
  const { obligations } = extractObligations([{ label: 'a', schema: dataModels }, { label: 'b', schema: dataModels }]);
  const ids = obligations.map((o) => o.id);
  assert.deepStrictEqual(ids, [...ids].sort(), 'sorted by id');
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids across schemas');
});

test('extracts from an OpenAPI document via components.schemas', () => {
  const openapi = {
    openapi: '3.0.0',
    paths: { '/orders': { post: { parameters: [{ name: 'idempotencyKey', in: 'header', required: true }] } } },
    components: {
      schemas: {
        Order: {
          type: 'object',
          required: ['amount'],
          properties: {
            amount: { type: 'number', minimum: 0.01, maximum: 100000 },
            currency: { type: 'string', enum: ['USD', 'EUR'] },
          },
        },
      },
    },
  };
  const { obligations } = extractObligations([{ label: 'api-contracts.schema.json', schema: openapi }]);
  assert.ok(byRule(obligations, 'Order.amount', 'required'));
  assert.strictEqual(byRule(obligations, 'Order.amount', 'minimum').value, 0.01);
  assert.deepStrictEqual(byRule(obligations, 'Order.currency', 'enum').value, ['USD', 'EUR']);
  // a boolean `required` on a parameter must NOT be mistaken for a schema-level required array
  assert.ok(!obligations.some((o) => o.field.includes('parameters')), 'no obligations from OpenAPI parameters');
});

test('recurses into nested objects and array items', () => {
  const schema = {
    $defs: {
      Invoice: {
        type: 'object',
        properties: {
          customer: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
          lines: { type: 'array', items: { type: 'object', properties: { qty: { type: 'integer', minimum: 1 } } } },
        },
      },
    },
  };
  const { obligations } = extractObligations([{ label: 'd', schema }]);
  assert.ok(byRule(obligations, 'Invoice.customer.id', 'required'));
  assert.ok(byRule(obligations, 'Invoice.customer.id', 'minLength'));
  assert.ok(byRule(obligations, 'Invoice.lines[].qty', 'minimum'));
});

test('a schema with no constraints yields zero obligations (valid, not an error)', () => {
  const schema = { $defs: { Ping: { type: 'object', properties: { ok: { type: 'boolean' } } } } };
  const { obligations } = extractObligations([{ label: 'd', schema }]);
  assert.deepStrictEqual(obligations, []);
});

test('obligationIndex maps obligations to trace-check {id,text} required items', () => {
  const result = extractObligations([{ label: 'd', schema: dataModels }]);
  const index = obligationIndex(result);
  assert.ok(index.length > 0);
  for (const item of index) {
    assert.ok(item.id && typeof item.text === 'string');
  }
  // ids match the obligation ids one-for-one
  assert.deepStrictEqual(index.map((i) => i.id).sort(), result.obligations.map((o) => o.id).sort());
});

// --- CLI ----------------------------------------------------------------------

function writeJson(dir, name, data) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

test('CLI: writes obligations + index, exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obl-'));
  const out = path.join(dir, 'constraint-obligations.json');
  const idx = path.join(dir, 'obligation-index.json');
  execFileSync(process.execPath, [SCRIPT,
    '--schemas', writeJson(dir, 'data-models.schema.json', dataModels),
    '--out', out, '--index-out', idx]);
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(result.obligations.length > 0);
  assert.deepStrictEqual(result.generated_from, [writeJson(dir, 'data-models.schema.json', dataModels)]);
  const index = JSON.parse(fs.readFileSync(idx, 'utf8'));
  assert.strictEqual(index.length, result.obligations.length);
});

test('CLI: a missing schema path is skipped softly (exit 0, empty obligations)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obl-'));
  const out = path.join(dir, 'constraint-obligations.json');
  execFileSync(process.execPath, [SCRIPT,
    '--schemas', path.join(dir, 'does-not-exist.json'),
    '--out', out], { stdio: 'pipe' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).obligations, []);
});

test('CLI: no --schemas is a usage error (exit 2)', () => {
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--out', '/tmp/x.json'], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});

test('CLI: a malformed schema file fails loudly (exit 2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obl-'));
  const bad = path.join(dir, 'data-models.schema.json');
  fs.writeFileSync(bad, '{ not valid json');
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--schemas', bad, '--out', path.join(dir, 'o.json')], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 2);
});

// --- wiring consistency: /test threads the constraint-obligation gate ----------

const ROOT = path.join(__dirname, '..');

test('/test SKILL reads test-design.md and runs the constraint-obligation gate', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'test', 'SKILL.md'), 'utf8');
  assert.match(skill, /test-design\.md/, 'reads the technique reference');
  assert.match(skill, /constraints-extract\.js/, 'invokes the extractor');
  assert.match(skill, /constraint-obligations\.json/, 'names the obligations artifact');
  assert.match(skill, /obligation-index\.json/, 'folds the obligation index into the grounding gate');
});

test('test-design.md exists and covers the core techniques', () => {
  const p = path.join(ROOT, '.claude', 'skills', 'test', 'references', 'test-design.md');
  assert.ok(fs.existsSync(p), 'test-design.md present');
  const doc = fs.readFileSync(p, 'utf8').toLowerCase();
  for (const technique of ['equivalence partition', 'boundary-value', 'state-transition', 'error-path', 'idempotency']) {
    assert.ok(doc.includes(technique), `covers ${technique}`);
  }
});
