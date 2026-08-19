'use strict';

// Mechanical proof the SSDD join sensors live in GATE_CATALOG: skipping
// /auto SECTION 5 still fails at runSensorCatalog / pre-commit.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GATE_CATALOG } = require('../.claude/hooks/lib/gate-registry');
const { GATE_TIERS, isGateEnabled } = require('../.claude/hooks/lib/sensor-tier');
const { setFailContext } = require('../.claude/hooks/lib/pre-commit-util');
const {
  checkGenerationContract,
  checkCanvasSyncGate,
} = require('../.claude/hooks/lib/gates-ssdd');
const { runSpddSync } = require('../.claude/hooks/lib/spdd-sync');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const JOIN_IDS = ['generation-contract', 'story-bundle-check', 'canvas-sync-check'];

function story(operations = '- pending') {
  return `# E1-S1 — Create a short link

## Metadata
- Readiness: ready

## Generation Contract

### Requirements
- **E1-S1-AC1** — Given a signed-in member and \`https://example.com/a\`, when creating a link, then the response is 201.

### Entities
- Link — new — no code-graph

### Operations
${operations}

### Safeguards
- none — this slice does not touch auth or retention rules
`;
}

const CANVAS = `# Canvas

## Requirements
Mint a link.

## Entities
Link.

## Approach
HTTP API.

## Structure
One service.

## Operations
- create in \`backend/ok.py\`

## Norms
None extra.

## Safeguards
None.

## Governs
- \`backend/ok.py\`
`;

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ssdd-join-'));
}

test('GATE_CATALOG and GATE_TIERS include the SSDD join sensors and G16', () => {
  const ids = GATE_CATALOG.map((g) => g.id);
  for (const id of [...JOIN_IDS, 'impact-scoped-regression']) {
    assert.ok(ids.includes(id), `catalog missing ${id}`);
    assert.ok(GATE_TIERS[id], `GATE_TIERS missing ${id}`);
    assert.strictEqual(isGateEnabled('standard', id), true, `${id} must run on standard`);
  }
});

test('pending Operations BLOCK generation-contract when production source is staged', () => {
  const dir = tmp();
  const stories = path.join(dir, 'specs', 'stories');
  fs.mkdirSync(stories, { recursive: true });
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(stories, 'E1-S1.md'), story());
  fs.writeFileSync(path.join(dir, 'backend', 'app.py'), 'def ping():\n    return 1\n');
  setFailContext({ tier: 'standard', currentSensor: 'generation-contract', projectDir: dir, collect: true });
  assert.throws(
    () => checkGenerationContract({
      projectDir: dir,
      stagedSource: ['backend/app.py'],
      staged: ['backend/app.py'],
    }),
    (err) => err && err.gateBlocked,
  );
  setFailContext({});
});

test('canvas-sync-check BLOCKs a production file missing from Governs', () => {
  const dir = tmp();
  const canvasPath = path.join(dir, 'specs', 'design', 'reasons-canvas.md');
  fs.mkdirSync(path.dirname(canvasPath), { recursive: true });
  fs.writeFileSync(canvasPath, CANVAS);
  setFailContext({ tier: 'standard', currentSensor: 'canvas-sync-check', projectDir: dir, collect: true });
  assert.throws(
    () => checkCanvasSyncGate({
      projectDir: dir,
      stagedSource: ['backend/new.py'],
      staged: ['backend/new.py'],
    }),
    (err) => err && err.gateBlocked,
  );
  setFailContext({});
});

test('spdd-sync --write applies Canvas Governs so the gate then passes', () => {
  const dir = tmp();
  const canvasPath = path.join(dir, 'specs', 'design', 'reasons-canvas.md');
  fs.mkdirSync(path.dirname(canvasPath), { recursive: true });
  fs.writeFileSync(canvasPath, CANVAS);
  const files = ['backend/new.py'];
  const before = runSpddSync({ root: dir, write: false, changedFiles: files });
  assert.ok(before.canvas.issues > 0);
  const applied = runSpddSync({ root: dir, write: true, changedFiles: files });
  assert.strictEqual(applied.canvas.issues, 0, JSON.stringify(applied.canvas));
  setFailContext({ tier: 'standard', currentSensor: 'canvas-sync-check', projectDir: dir, collect: true });
  assert.doesNotThrow(() => checkCanvasSyncGate({
    projectDir: dir,
    stagedSource: files,
    staged: files,
  }));
  setFailContext({});
});

test('/auto --once Success runs G15 and the evaluator', () => {
  const auto = readSkillCorpus('auto');
  assert.match(auto, /this wave \*\*is Success\*\*/);
  assert.match(auto, /regression-gate\.js --replay/);
  assert.match(auto, /spawn the evaluator once/);
  assert.match(auto, /impact-scoped-regression/);
  assert.match(auto, /spdd-sync\.js --write/);
});
