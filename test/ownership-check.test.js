'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'ownership-check.js');
const { parseComponentMap, checkOwnership, run } = require(SCRIPT);

const MAP = `# Component Map

| Story | Files |
|---|---|
| S1 | \`src/api/users.py\` (Produces: user schema) |
| S2 | \`src/ui/\` — owns the whole directory. Consumes: \`src/api/users.py\` |
| S3 | \`src/services/orders.ts\` |
`;

test('parseComponentMap extracts backticked file and directory paths', () => {
  const owned = parseComponentMap(MAP);
  assert.ok(owned.has('src/api/users.py'));
  assert.ok(owned.has('src/ui'));
  assert.ok(owned.has('src/services/orders.ts'));
});

test('parseComponentMap ignores backticked non-path tokens', () => {
  const owned = parseComponentMap('| S1 | `Produces: schema` and `some phrase` and `GET /users` |');
  assert.strictEqual(owned.size, 0);
});

test('an exactly-owned file and a file under an owned directory pass', () => {
  const v = checkOwnership(['src/api/users.py', 'src/ui/App.tsx'], MAP);
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.unowned, []);
});

test('an unowned source file fails with its path listed', () => {
  const v = checkOwnership(['src/api/users.py', 'src/rogue/backdoor.py'], MAP);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.unowned, ['src/rogue/backdoor.py']);
});

test('allowlisted prefixes and non-source files are never checked', () => {
  const v = checkOwnership(
    ['specs/design/x.md', 'docs/a.md', '.claude/scripts/y.js', 'test/z.test.js', 'e2e/flow.spec.ts', 'README.md', '.env.example'],
    MAP
  );
  assert.strictEqual(v.checked, 0);
  assert.strictEqual(v.pass, true);
});

test('a map with zero parseable entries fails loudly when source files are checked (no vacuous pass)', () => {
  const v = checkOwnership(['src/api/users.py'], '# Component Map\n\nTBD\n');
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.reason, 'empty_map');
});

test('a map with zero entries and zero checked files passes (docs-only change)', () => {
  const v = checkOwnership(['docs/a.md'], '# Component Map\n\nTBD\n');
  assert.strictEqual(v.pass, true);
});

// --- run() CLI (injected root, no subprocess) ---------------------------------

function makeProject(mapText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-'));
  if (mapText !== null) {
    const p = path.join(dir, 'specs', 'design', 'component-map.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, mapText);
  }
  return dir;
}

test('run --files writes the verdict and exits 1 on an unowned file', () => {
  const dir = makeProject(MAP);
  const code = run(['--files', 'src/rogue/backdoor.py'], dir);
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'ownership-check.json'), 'utf8'));
  assert.strictEqual(verdict.pass, false);
  assert.deepStrictEqual(verdict.unowned, ['src/rogue/backdoor.py']);
});

test('run exits 0 with a no-map verdict when component-map.md is absent', () => {
  const dir = makeProject(null);
  const code = run(['--files', 'src/anything.py'], dir);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'ownership-check.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-map');
});

test('run --staged uses the injected exec to list staged files', () => {
  const dir = makeProject(MAP);
  const fakeExec = () => 'src/api/users.py\nsrc/rogue/backdoor.py\n';
  const code = run(['--staged'], dir, { exec: fakeExec });
  assert.strictEqual(code, 1);
});
