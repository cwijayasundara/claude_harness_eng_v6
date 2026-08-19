'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');

const {
  listStoryFiles,
  buildBundle,
  checkProject,
  checkTestBrdTraces,
} = require('../.claude/hooks/lib/story-bundle');

const ROOT = path.resolve(__dirname, '..');
const WRITE = path.join(ROOT, '.claude', 'scripts', 'bundle-write.js');
const CHECK = path.join(ROOT, '.claude', 'scripts', 'bundle-check.js');

function storyMd(overrides = {}) {
  return `# E1-S1 — Create a short link

## Metadata
- Readiness: ${overrides.readiness || 'ready'}
- Layer: Service
- Depends On: none

## Scope
**Out:** must not alter the session cookie format.

## Generation Contract

### Requirements
- **E1-S1-AC1** — Given a signed-in member and \`https://example.com/a\`, when creating a link, then the response is 201 with a code of at least 7 characters.

### Entities
- Link — unknown — no code-graph

### Operations
${overrides.operations || '- 1. Add create_link in `src/links/service.py`'}

### Safeguards
- none — this slice does not touch auth or retention rules
`;
}

function writeJson(dir, rel, data) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

function writeText(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function fullProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-bundle-'));
  writeText(dir, 'specs/stories/E1-S1.md', storyMd());
  writeJson(dir, 'specs/stories/story-traces.json', [
    { id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC1'] },
  ]);
  writeText(dir, 'specs/design/component-map.md', '| E1-S1 | `src/links/service.py` |\n');
  writeText(dir, 'specs/design/program-design.md', '# Program design\n');
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', {
    version: 1,
    requirements: [{
      id: 'VM-001',
      brd_id: 'BR-1',
      story_id: 'E1-S1',
      ac_id: 'E1-S1-AC1',
      required_layers: ['unit', 'api'],
    }],
  });
  writeJson(dir, 'specs/test_artefacts/test-traces.json', [
    { id: 'TC-1', text: 'create returns 201', traces: ['E1-S1-AC1', 'BR-1-AC1'] },
  ]);
  writeJson(dir, 'specs/brd/brd-acceptance.json', [
    { id: 'BR-1-AC1', requirement: 'BR-1', text: 'creating returns 201' },
  ]);
  return dir;
}

test('listStoryFiles prefers the higher sprint copy of the same id', () => {
  const listed = listStoryFiles([
    'specs/stories/E1-S1.md',
    'specs/stories/sprint-2/E1-S1.md',
    'specs/stories/notes.md',
  ]);
  assert.deepStrictEqual(listed, [{ id: 'E1-S1', path: 'specs/stories/sprint-2/E1-S1.md' }]);
});

test('buildBundle joins traces, map, matrix, and BR acceptance', () => {
  const bundle = buildBundle({
    storyId: 'E1-S1',
    storyPath: 'specs/stories/E1-S1.md',
    markdown: storyMd(),
    storyTraces: [{ id: 'E1-S1', traces: ['BR-1'], acs: ['E1-S1-AC1'] }],
    matrix: {
      requirements: [{ id: 'VM-001', story_id: 'E1-S1', ac_id: 'E1-S1-AC1', required_layers: ['unit'] }],
    },
    testTraces: [{ id: 'TC-1', traces: ['E1-S1-AC1', 'BR-1-AC1'] }],
    ownedFiles: ['src/links/service.py'],
    brdAcceptance: [{ id: 'BR-1-AC1', requirement: 'BR-1' }],
  });
  assert.strictEqual(bundle.story_id, 'E1-S1');
  assert.deepStrictEqual(bundle.requirements.ac_ids, ['E1-S1-AC1']);
  assert.deepStrictEqual(bundle.requirements.brd_ids, ['BR-1']);
  assert.deepStrictEqual(bundle.requirements.br_acceptance_ids, ['BR-1-AC1']);
  assert.deepStrictEqual(bundle.structure.owned_files, ['src/links/service.py']);
  assert.deepStrictEqual(bundle.tests.matrix_ids, ['VM-001']);
  assert.strictEqual(bundle.operations.pending, false);
});

test('checkTestBrdTraces fails when a case cites an AC but not the original req', () => {
  const v = checkTestBrdTraces(
    [{ id: 'TC-1', traces: ['E1-S1-AC1'] }],
    [{ id: 'BR-1-AC1', requirement: 'BR-1' }],
  );
  assert.strictEqual(v.pass, false);
  assert.ok(v.errors[0].includes('TC-1'));
});

test('checkProject is dormant when every story is needs_breakdown', () => {
  const v = checkProject({
    stories: [{ id: 'E1-S1', readiness: 'needs_breakdown' }],
  }, { mode: 'implementable' });
  assert.strictEqual(v.pass, true);
  assert.strictEqual(v.dormant, true);
});

test('writer then checker round-trip a real temp project', () => {
  const dir = fullProject();
  const writeOut = execFileSync(process.execPath, [WRITE, '--root', dir], { encoding: 'utf8' });
  assert.match(writeOut, /wrote 1 bundle/);
  const bundlePath = path.join(dir, 'specs', 'bundles', 'E1-S1.json');
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  assert.strictEqual(bundle.story_id, 'E1-S1');
  assert.deepStrictEqual(bundle.tests.matrix_ids, ['VM-001']);
  assert.deepStrictEqual(bundle.requirements.br_acceptance_ids, ['BR-1-AC1']);

  const checkOut = execFileSync(process.execPath, [CHECK, '--mode', 'implementable', '--root', dir], {
    encoding: 'utf8',
  });
  assert.match(checkOut, /PASS — 1 implementable/);
});

test('implementable check fails when the bundle file is missing', () => {
  const dir = fullProject();
  assert.throws(
    () => execFileSync(process.execPath, [CHECK, '--mode', 'implementable', '--root', dir], {
      encoding: 'utf8',
      stdio: 'pipe',
    }),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(String(err.stderr), /missing specs\/bundles\/E1-S1\.json/);
      return true;
    },
  );
});

test('implementable check fails when test-traces drop the BR acceptance id', () => {
  const dir = fullProject();
  execFileSync(process.execPath, [WRITE, '--root', dir], { encoding: 'utf8' });
  writeJson(dir, 'specs/test_artefacts/test-traces.json', [
    { id: 'TC-1', traces: ['E1-S1-AC1'] },
  ]);
  assert.throws(
    () => execFileSync(process.execPath, [CHECK, '--mode', 'implementable', '--root', dir], {
      encoding: 'utf8',
      stdio: 'pipe',
    }),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(String(err.stderr), /brd-acceptance/);
      return true;
    },
  );
});
