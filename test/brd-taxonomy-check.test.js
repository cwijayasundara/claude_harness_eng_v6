'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'brd-taxonomy-check.js');
const { checkTaxonomy, SLOTS } = require(SCRIPT);

// Every slot covered by at least one requirement — the shape a complete BRD has.
const full = () => SLOTS.map((slot, i) => ({
  id: `BR-${i + 1}`, text: `requirement for ${slot}`, taxonomy: [slot],
}));

test('the taxonomy is the fixed ten-slot floor, not an open list', () => {
  assert.deepStrictEqual(SLOTS, [
    'functional', 'data_lifecycle', 'integration', 'performance', 'security_authz',
    'privacy_retention', 'observability', 'operability_failure', 'ux_accessibility', 'constraints',
  ]);
});

test('passes when every slot has at least one requirement', () => {
  const v = checkTaxonomy(full(), []);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.uncovered, []);
  assert.strictEqual(v.slots.length, SLOTS.length);
});

test('one requirement may cover several slots', () => {
  const reqs = [{ id: 'BR-1', text: 'all of it', taxonomy: SLOTS.slice() }];
  const v = checkTaxonomy(reqs, []);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.slots.find((s) => s.slot === 'performance').requirement_ids, ['BR-1']);
});

test('an uncovered slot fails — silence is not a pass', () => {
  const reqs = full().filter((r) => !r.taxonomy.includes('observability'));
  const v = checkTaxonomy(reqs, []);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.uncovered, ['observability']);
});

test('an uncovered slot passes when justified with a substantive na_reason', () => {
  const reqs = full().filter((r) => !r.taxonomy.includes('privacy_retention'));
  const coverage = [{
    slot: 'privacy_retention',
    na_reason: 'the system stores no personal data; all records are anonymised aggregates',
  }];
  const v = checkTaxonomy(reqs, coverage);
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.slots.find((s) => s.slot === 'privacy_retention').na_reason.length > 0, true);
});

test('a placeholder na_reason does not count as a justification', () => {
  const reqs = full().filter((r) => !r.taxonomy.includes('performance'));
  for (const na_reason of ['n/a', 'N/A', 'none', 'not applicable', '', '   ', 'TBD']) {
    const v = checkTaxonomy(reqs, [{ slot: 'performance', na_reason }]);
    assert.strictEqual(v.pass, false, `"${na_reason}" must not satisfy the gate`);
    assert.deepStrictEqual(v.unjustified, ['performance']);
  }
});

test('a too-short na_reason does not count as a justification', () => {
  const reqs = full().filter((r) => !r.taxonomy.includes('integration'));
  const v = checkTaxonomy(reqs, [{ slot: 'integration', na_reason: 'no integrations' }]);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.unjustified, ['integration']);
});

test('an unknown taxonomy value fails rather than being silently ignored', () => {
  const reqs = full().concat([{ id: 'BR-99', text: 'typo', taxonomy: ['observabilty'] }]);
  const v = checkTaxonomy(reqs, []);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.invalid_slots, [{ id: 'BR-99', slot: 'observabilty' }]);
});

test('an unknown slot in the coverage file fails too', () => {
  const v = checkTaxonomy(full(), [{ slot: 'made_up', na_reason: 'a long enough sentence to look real' }]);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.invalid_slots, [{ id: 'taxonomy-coverage.json', slot: 'made_up' }]);
});

test('a requirement with no taxonomy at all is reported, not ignored', () => {
  const reqs = full().concat([{ id: 'BR-98', text: 'untagged' }]);
  const v = checkTaxonomy(reqs, []);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.untagged, ['BR-98']);
});

test('an empty requirement spine fails loudly instead of passing vacuously', () => {
  assert.throws(() => checkTaxonomy([], []), /no requirements/i);
});

test('a slot both covered and excused is flagged as contradictory but does not block', () => {
  const v = checkTaxonomy(full(), [{
    slot: 'performance', na_reason: 'this system has no performance requirements at all',
  }]);
  assert.strictEqual(v.pass, true);
  assert.ok(v.warnings.some((w) => /performance/.test(w) && /contradict/i.test(w)));
});

// --- CLI ----------------------------------------------------------------------

function workspace(reqs, coverage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brd-taxonomy-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brd'), { recursive: true });
  const reqPath = path.join(dir, 'specs', 'brd', 'brd-requirements.json');
  const covPath = path.join(dir, 'specs', 'brd', 'taxonomy-coverage.json');
  fs.writeFileSync(reqPath, JSON.stringify(reqs, null, 2));
  if (coverage) fs.writeFileSync(covPath, JSON.stringify(coverage, null, 2));
  return { dir, reqPath, covPath, outPath: path.join(dir, 'specs', 'reviews', 'brd-taxonomy.json') };
}

function run(ws) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, '--requirements', ws.reqPath, '--coverage', ws.covPath, '--out', ws.outPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('CLI exits 0 and writes the verdict on a complete BRD', () => {
  const ws = workspace(full(), []);
  const res = run(ws);
  assert.strictEqual(res.code, 0, res.stderr);
  assert.match(res.stdout, /brd-taxonomy: PASS/);
  assert.strictEqual(JSON.parse(fs.readFileSync(ws.outPath, 'utf8')).pass, true);
});

test('CLI exits 1 and names the uncovered slot', () => {
  const ws = workspace(full().filter((r) => !r.taxonomy.includes('operability_failure')), []);
  const res = run(ws);
  assert.strictEqual(res.code, 1);
  assert.match(res.stdout, /UNCOVERED\s+operability_failure/);
  assert.strictEqual(JSON.parse(fs.readFileSync(ws.outPath, 'utf8')).pass, false);
});

test('CLI treats a missing coverage file as "nothing excused", not as a skip', () => {
  const ws = workspace(full().filter((r) => !r.taxonomy.includes('performance')), null);
  const res = run(ws);
  assert.strictEqual(res.code, 1);
  assert.match(res.stdout, /UNCOVERED\s+performance/);
});

test('CLI exits 2 on a missing requirement spine', () => {
  const ws = workspace(full(), []);
  fs.rmSync(ws.reqPath);
  const res = run(ws);
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /cannot read|not found/i);
});
