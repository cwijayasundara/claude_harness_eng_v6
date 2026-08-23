'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { snapshotDesign, missingFrom, anyMissing, isEmpty, headings } = require('./design-baseline');

function designRoot({ traces, componentMap, architecture }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-design-baseline-'));
  const dir = path.join(root, 'specs', 'design');
  fs.mkdirSync(dir, { recursive: true });
  if (traces !== undefined) fs.writeFileSync(path.join(dir, 'design-traces.json'), JSON.stringify(traces));
  if (componentMap !== undefined) fs.writeFileSync(path.join(dir, 'component-map.md'), componentMap);
  if (architecture !== undefined) fs.writeFileSync(path.join(dir, 'architecture.md'), architecture);
  return root;
}

const BASELINE = {
  traces: [{ id: 'core-platform', traces: ['E0-S1'] }, { id: 'compose-stack', traces: ['E0-S1'] }],
  componentMap: '# Component Map — M1\n\n## E0-S1 — Walking skeleton\n\nOwns:\n- `a.py`\n\n## E1-S1 — Member identity\n',
  architecture: '# Architecture\n\n## Runtime topology\n\n## Data model\n',
};

test('snapshots trace ids and section headings from the living design', () => {
  const snap = snapshotDesign(designRoot(BASELINE));
  assert.deepStrictEqual(snap.traceIds, ['core-platform', 'compose-stack']);
  assert.deepStrictEqual(snap.componentHeadings, ['E0-S1 — Walking skeleton', 'E1-S1 — Member identity']);
  assert.deepStrictEqual(snap.architectureHeadings, ['Runtime topology', 'Data model']);
  assert.ok(!isEmpty(snap));
});

test('an additive amendment preserves everything the baseline named', () => {
  const before = snapshotDesign(designRoot(BASELINE));
  const after = snapshotDesign(designRoot({
    traces: [...BASELINE.traces, { id: 'click-events', traces: ['E4-S1'] }],
    componentMap: `${BASELINE.componentMap}\n## E4-S1 — Click events\n`,
    architecture: `${BASELINE.architecture}\n## Click aggregation\n`,
  }));
  assert.ok(!anyMissing(missingFrom(before, after)), 'purely additive changes must not read as regeneration');
});

test('a regenerated design is caught by what it stopped naming', () => {
  const before = snapshotDesign(designRoot(BASELINE));
  // The regeneration failure mode: a complete, plausible design set that has
  // simply forgotten the prior sprint.
  const after = snapshotDesign(designRoot({
    traces: [{ id: 'click-events', traces: ['E4-S1'] }],
    componentMap: '# Component Map — Sprint 2\n\n## E4-S1 — Click events\n',
    architecture: '# Architecture\n\n## Click aggregation\n',
  }));
  const diff = missingFrom(before, after);
  assert.ok(anyMissing(diff));
  assert.deepStrictEqual(diff.traceIds, ['core-platform', 'compose-stack']);
  assert.deepStrictEqual(diff.componentHeadings, ['E0-S1 — Walking skeleton', 'E1-S1 — Member identity']);
  assert.deepStrictEqual(diff.architectureHeadings, ['Runtime topology', 'Data model']);
});

test('a dropped section is caught even when the rest survives', () => {
  const before = snapshotDesign(designRoot(BASELINE));
  const after = snapshotDesign(designRoot({
    ...BASELINE,
    componentMap: '# Component Map — M1\n\n## E0-S1 — Walking skeleton\n',
  }));
  const diff = missingFrom(before, after);
  assert.deepStrictEqual(diff.componentHeadings, ['E1-S1 — Member identity']);
  assert.deepStrictEqual(diff.traceIds, [], 'unrelated signals must stay clean');
});

test('a missing design set snapshots empty, and says so', () => {
  const snap = snapshotDesign(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-empty-')));
  assert.ok(isEmpty(snap), 'an absent baseline must be detectable, not silently comparable');
  // The vacuity trap: empty-vs-empty shows no regression at all.
  assert.ok(!anyMissing(missingFrom(snap, snap)));
});

test('unparseable design-traces.json degrades to empty rather than throwing', () => {
  const root = designRoot(BASELINE);
  fs.writeFileSync(path.join(root, 'specs', 'design', 'design-traces.json'), '{ truncated');
  assert.deepStrictEqual(snapshotDesign(root).traceIds, []);
});

test('headings ignores the title and deeper levels', () => {
  assert.deepStrictEqual(headings('# Title\n## Real\n### Deeper\n#### Deepest\n## Also real\n'), ['Real', 'Also real']);
});
