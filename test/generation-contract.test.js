'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  extractContract,
  validateGenerationContract,
} = require('../.claude/hooks/lib/generation-contract');

const ROOT = path.resolve(__dirname, '..');

function story(overrides = {}) {
  return `# E1-S1 — Create a short link

## Metadata
- Readiness: ready

## Scope
**Out:** must not alter the session cookie format.

## Generation Contract

### Requirements
- **E1-S1-AC1** — Given a signed-in member and \`https://example.com/a\`, when creating a link, then the response is 201 with a code of at least 7 characters.

### Entities
- Link — unknown — no code-graph

### Operations
${overrides.operations || '- pending'}

### Safeguards
${overrides.safeguards || '- none — this slice does not touch auth or retention rules'}
`;
}

test('extractContract reads the four subsections from a story file', () => {
  const c = extractContract(story());
  assert.ok(c.present);
  assert.match(c.requirements, /E1-S1-AC1/);
  assert.match(c.entities, /Link/);
  assert.match(c.operations, /pending/);
});

test('skeleton accepts pending Operations; implementable does not', () => {
  const skel = validateGenerationContract(story(), { mode: 'skeleton' });
  assert.strictEqual(skel.pass, true, skel.errors.join('; '));
  const impl = validateGenerationContract(story(), { mode: 'implementable' });
  assert.strictEqual(impl.pass, false);
  assert.ok(impl.errors.some((e) => /pending/i.test(e)));
});

test('implementable passes when Operations names a file', () => {
  const v = validateGenerationContract(story({
    operations: '- 1. Add create_link in `src/links/service.py`',
  }), { mode: 'implementable' });
  assert.strictEqual(v.pass, true, v.errors.join('; '));
});

test('unknown SG-n is a hard fail when a spine is provided', () => {
  const v = validateGenerationContract(story({
    safeguards: '- SG-99 — invented',
  }), { mode: 'skeleton', safeguards: [{ id: 'SG-1', text: 'real' }] });
  assert.strictEqual(v.pass, false);
  assert.ok(v.errors.some((e) => /UNKNOWN SG-99/.test(e)));
});

test('CLI checks every ready story in a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-contract-'));
  const stories = path.join(dir, 'specs', 'stories');
  fs.mkdirSync(stories, { recursive: true });
  fs.writeFileSync(path.join(stories, 'E1-S1.md'), story());
  fs.writeFileSync(path.join(stories, 'E1-S2.md'), story().replace('Readiness: ready', 'Readiness: needs_breakdown'));
  const out = execFileSync(process.execPath, [
    path.join(ROOT, '.claude/scripts/validate-generation-contract.js'),
    '--mode', 'skeleton',
    '--stories', stories,
  ], { encoding: 'utf8' });
  assert.match(out, /1\/1 skeleton/);
});
