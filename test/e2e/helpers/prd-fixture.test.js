'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { resolvePrd, prdLabels, spineGap, PRDS } = require('./prd-fixture');

function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const prev = process.env[name];
  if (value === null) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally {
    if (had) process.env[name] = prev; else delete process.env[name];
  }
}

test('every declared PRD default exists in fixtures', () => {
  for (const kind of Object.keys(PRDS)) {
    const file = withEnv(PRDS[kind].env, null, () => resolvePrd(kind));
    assert.ok(fs.existsSync(file), `default PRD for "${kind}" is missing: ${file}`);
    assert.ok(fs.readFileSync(file, 'utf8').trim().length > 0, `default PRD for "${kind}" is empty`);
  }
});

test('the sprint pair is the shortlink PRDs, sprint 2 declaring its own delta', () => {
  const one = fs.readFileSync(withEnv('HARNESS_E2E_PRD', null, () => resolvePrd('sprint1')), 'utf8');
  const two = fs.readFileSync(withEnv('HARNESS_E2E_PRD_SPRINT2', null, () => resolvePrd('sprint2')), 'utf8');
  assert.match(one, /sprint 1/i);
  assert.match(two, /sprint 2/i);
  // The classification table is the oracle the delta route asserts against.
  assert.match(two, /Nothing from sprint 1 is dropped/i);
  for (const label of ['FR-9', 'FR-10']) {
    assert.match(two, new RegExp(`\\*\\*${label}\\*\\*`), `sprint-2 PRD must introduce ${label}`);
    assert.doesNotMatch(one, new RegExp(`\\*\\*${label}\\*\\*`), `sprint-1 PRD must not already have ${label}`);
  }
});

test('an env override replaces the default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-prd-'));
  const custom = path.join(dir, 'my-prd.md');
  fs.writeFileSync(custom, '# mine\n');
  assert.strictEqual(withEnv('HARNESS_E2E_PRD', custom, () => resolvePrd('sprint1')), custom);
});

test('a relative override resolves against the cwd', () => {
  const rel = path.relative(process.cwd(), path.join(__dirname, '..', 'fixtures', 'counter-prd.md'));
  assert.strictEqual(
    withEnv('HARNESS_E2E_PRD', rel, () => resolvePrd('sprint1')),
    path.resolve(rel),
  );
});

test('an override pointing at nothing fails loudly, naming the variable', () => {
  assert.throws(
    () => withEnv('HARNESS_E2E_PRD', '/no/such/prd.md', () => resolvePrd('sprint1')),
    /HARNESS_E2E_PRD=\/no\/such\/prd\.md does not exist/,
  );
});

test('an unknown PRD kind is a programming error, not a silent default', () => {
  assert.throws(() => resolvePrd('nope'), /unknown PRD "nope"/);
});

test('reads the requirement labels a PRD declares, in order and deduplicated', () => {
  const one = withEnv('HARNESS_E2E_PRD', null, () => resolvePrd('sprint1'));
  // The real sprint-1 PRD: eight functional, six non-functional.
  assert.deepStrictEqual(prdLabels(one), [
    'FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5', 'FR-6', 'FR-7', 'FR-8',
    'NFR-1', 'NFR-2', 'NFR-3', 'NFR-4', 'NFR-5', 'NFR-6',
  ]);
  // Each label is bolded again in the Acceptance section — once is enough.
  assert.strictEqual(new Set(prdLabels(one)).size, prdLabels(one).length);
});

test('sprint 2 declares the two new requirements on top of sprint 1', () => {
  const two = withEnv('HARNESS_E2E_PRD_SPRINT2', null, () => resolvePrd('sprint2'));
  const labels = prdLabels(two);
  for (const l of ['FR-9', 'FR-10', 'NFR-7']) assert.ok(labels.includes(l), `sprint 2 declares ${l}`);
});

test('spineGap names what a phase dropped and what it invented', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-prd-gap-'));
  const prd = path.join(dir, 'prd.md');
  fs.writeFileSync(prd, 'Some prose.\n- **FR-1** a\n- **FR-2** b\n- **NFR-1** c\n');

  const clean = spineGap(prd, [{ label: 'FR-1' }, { label: 'FR-2' }, { label: 'NFR-1' }]);
  assert.deepStrictEqual(clean.missing, []);
  assert.deepStrictEqual(clean.invented, []);

  const lossy = spineGap(prd, [{ label: 'FR-1' }, { label: 'FR-99' }]);
  assert.deepStrictEqual(lossy.missing, ['FR-2', 'NFR-1'], 'a dropped requirement must be named');
  assert.deepStrictEqual(lossy.invented, ['FR-99'], 'an invented requirement must be named');
});

test('an empty spine reads as everything missing, not as a clean gap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-prd-empty-'));
  const prd = path.join(dir, 'prd.md');
  fs.writeFileSync(prd, '- **FR-1** a\n');
  // The vacuity trap: comparing against nothing must not look like agreement.
  assert.deepStrictEqual(spineGap(prd, []).missing, ['FR-1']);
  assert.deepStrictEqual(spineGap(prd, null).missing, ['FR-1']);
});
