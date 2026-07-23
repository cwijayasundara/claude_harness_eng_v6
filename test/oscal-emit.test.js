'use strict';

// C3: emit the control inventory as an OSCAL component-definition.
//
// standard-map.json mapped controls to four INVENTED clause ids
// (SDL-/AUD-/ARC-/MNT-) with an empty by_id — it resolved to nothing an auditor
// recognises. OSCAL is the machine-readable format for exactly this.
//
// The blocking question was "which standard are the customer's auditors on?". That turns
// out to gate only the CATALOG, not the mechanism: OSCAL identifies controls by
// (source catalog, control-id). So the emitter is catalog-agnostic and the answer
// becomes a data file, not a code change. Until a catalog is supplied, controls are
// emitted as UNMAPPED rather than mapped to invented ids — an honest gap an auditor can
// see beats a confident-looking fiction.

const { test } = require('node:test');
const assert = require('node:assert');
const { emitComponentDefinition, mapControl } = require('../.claude/scripts/oscal-emit');

const MANIFEST = {
  guides: [{ id: 'code-gen', axis: 'maintainability' }],
  sensors: [
    { id: 'secret-scan', axis: 'behaviour', cadence: 'commit', status: 'active' },
    { id: 'trace-check', axis: 'traceability', cadence: 'planning', status: 'active' },
  ],
};

const CATALOG = {
  catalog: { id: 'soc2', title: 'SOC 2 Trust Services Criteria', href: 'https://example.com/soc2' },
  by_id: { 'secret-scan': ['CC6.1'] },
  by_axis: { traceability: ['CC7.2'] },
};

test('the document is an OSCAL component-definition with a uuid and metadata', () => {
  const doc = emitComponentDefinition({ manifest: MANIFEST, catalog: CATALOG, harnessVersion: '3.0.0' });
  assert.ok(doc['component-definition']);
  assert.match(doc['component-definition'].uuid, /^[0-9a-f-]{36}$/);
  assert.ok(doc['component-definition'].metadata.title);
  assert.strictEqual(doc['component-definition'].metadata.version, '3.0.0');
});

test('every control in the manifest becomes an implemented-requirement', () => {
  const doc = emitComponentDefinition({ manifest: MANIFEST, catalog: CATALOG, harnessVersion: '3.0.0' });
  const impls = doc['component-definition'].components[0]['control-implementations'];
  const reqs = impls.flatMap((i) => i['implemented-requirements']);
  assert.strictEqual(reqs.length, 3, 'guides and sensors are both controls');
});

test('a per-id mapping wins over the per-axis fallback', () => {
  assert.deepStrictEqual(mapControl({ id: 'secret-scan', axis: 'behaviour' }, CATALOG), ['CC6.1']);
});

test('a per-axis mapping applies when there is no per-id entry', () => {
  assert.deepStrictEqual(mapControl({ id: 'trace-check', axis: 'traceability' }, CATALOG), ['CC7.2']);
});

test('an unmapped control is emitted as UNMAPPED, not invented', () => {
  assert.deepStrictEqual(mapControl({ id: 'code-gen', axis: 'maintainability' }, CATALOG), []);
});

test('with no catalog configured, nothing is mapped and the gap is explicit', () => {
  const doc = emitComponentDefinition({ manifest: MANIFEST, catalog: null, harnessVersion: '3.0.0' });
  const cd = doc['component-definition'];
  assert.strictEqual(cd['control-implementations'], undefined);
  const impls = cd.components[0]['control-implementations'];
  assert.strictEqual(impls.length, 1);
  assert.match(impls[0].source, /unmapped/i,
    'an absent catalog must read as "no standard bound yet", never as a satisfied one');
  assert.ok(impls[0].description.match(/no catalog/i));
});

test('the source href identifies the catalog the ids belong to', () => {
  const doc = emitComponentDefinition({ manifest: MANIFEST, catalog: CATALOG, harnessVersion: '3.0.0' });
  const impls = doc['component-definition'].components[0]['control-implementations'];
  assert.strictEqual(impls[0].source, 'https://example.com/soc2');
});

test('a control mapped to several catalog ids emits one requirement per id', () => {
  const multi = { ...CATALOG, by_id: { 'secret-scan': ['CC6.1', 'CC6.6'] } };
  const doc = emitComponentDefinition({ manifest: MANIFEST, catalog: multi, harnessVersion: '3.0.0' });
  const reqs = doc['component-definition'].components[0]['control-implementations']
    .flatMap((i) => i['implemented-requirements']);
  const ids = reqs.filter((r) => r.description.includes('secret-scan')).map((r) => r['control-id']);
  assert.deepStrictEqual(ids.sort(), ['CC6.1', 'CC6.6']);
});

test('output is deterministic for the same inputs', () => {
  const a = emitComponentDefinition({ manifest: MANIFEST, catalog: CATALOG, harnessVersion: '3.0.0', uuid: 'fixed', now: 'T' });
  const b = emitComponentDefinition({ manifest: MANIFEST, catalog: CATALOG, harnessVersion: '3.0.0', uuid: 'fixed', now: 'T' });
  assert.deepStrictEqual(a, b);
});

test('an empty manifest is refused rather than emitting a component that claims nothing', () => {
  assert.throws(() => emitComponentDefinition({ manifest: { guides: [], sensors: [] }, catalog: CATALOG, harnessVersion: '3.0.0' }),
    /no controls/i, 'an empty component-definition would read as a clean bill of health');
});
