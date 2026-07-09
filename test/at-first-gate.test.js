'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'at-first-gate.js');
const { checkAtFirst, fileToStory, findAtFile, hasReceipt, readReceipts, run } = require(SCRIPT);

const MAP = `# Component Map

| Story | Files |
|---|---|
| E1-S1 | \`src/api/users.py\` (Produces: user schema) |
| E1-S2 | \`src/services/orders.ts\` |
`;

function makeProject({ mapText, atFiles, receipts } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-first-'));
  if (mapText !== null && mapText !== undefined) {
    const p = path.join(dir, 'specs', 'design', 'component-map.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, mapText);
  }
  if (atFiles) {
    const atDir = path.join(dir, 'specs', 'test_artefacts', 'acceptance');
    fs.mkdirSync(atDir, { recursive: true });
    for (const name of atFiles) fs.writeFileSync(path.join(atDir, name), '// at\n');
  }
  if (receipts) {
    const p = path.join(dir, 'specs', 'reviews', 'at-red-receipts.jsonl');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, receipts.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return dir;
}

test('fileToStory maps each backticked file to its row story id', () => {
  const owner = fileToStory(MAP);
  assert.strictEqual(owner.get('src/api/users.py'), 'E1-S1');
  assert.strictEqual(owner.get('src/services/orders.ts'), 'E1-S2');
});

test('findAtFile matches by story-id basename prefix regardless of extension', () => {
  const dir = makeProject({ atFiles: ['E1-S1.spec.ts'] });
  assert.strictEqual(findAtFile(dir, 'E1-S1'), path.join('specs', 'test_artefacts', 'acceptance', 'E1-S1.spec.ts'));
  assert.strictEqual(findAtFile(dir, 'E1-S2'), null);
});

test('findAtFile returns null when the acceptance dir does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-first-'));
  assert.strictEqual(findAtFile(dir, 'E1-S1'), null);
});

test('hasReceipt matches on normalized storyId + atPath pair', () => {
  const receipts = [{ storyId: 'E1-S1', atPath: './specs/test_artefacts/acceptance/E1-S1.spec.ts' }];
  assert.strictEqual(hasReceipt(receipts, 'E1-S1', 'specs/test_artefacts/acceptance/E1-S1.spec.ts'), true);
  assert.strictEqual(hasReceipt(receipts, 'E1-S2', 'specs/test_artefacts/acceptance/E1-S1.spec.ts'), false);
});

test('checkAtFirst passes when a new file\'s story has both AT file and matching receipt', () => {
  const dir = makeProject({
    atFiles: ['E1-S1.spec.ts'],
    receipts: [{ storyId: 'E1-S1', atPath: 'specs/test_artefacts/acceptance/E1-S1.spec.ts' }],
  });
  const v = checkAtFirst(dir, ['src/api/users.py'], MAP, readReceipts(dir));
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.storiesChecked, ['E1-S1']);
});

test('checkAtFirst blocks a new file whose story has no AT file at all', () => {
  const dir = makeProject({});
  const v = checkAtFirst(dir, ['src/api/users.py'], MAP, readReceipts(dir));
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.missingAt, ['E1-S1']);
});

test('checkAtFirst blocks a new file whose story has an AT file but no matching receipt', () => {
  const dir = makeProject({ atFiles: ['E1-S1.spec.ts'] });
  const v = checkAtFirst(dir, ['src/api/users.py'], MAP, readReceipts(dir));
  assert.strictEqual(v.pass, false);
  assert.strictEqual(v.missingReceipt.length, 1);
  assert.strictEqual(v.missingReceipt[0].story, 'E1-S1');
});

test('checkAtFirst ignores a new file with no story owner (ownership-check\'s territory, not this gate\'s)', () => {
  const dir = makeProject({});
  const v = checkAtFirst(dir, ['src/rogue/backdoor.py'], MAP, readReceipts(dir));
  assert.strictEqual(v.pass, true);
  assert.deepStrictEqual(v.storiesChecked, []);
});

test('checkAtFirst checks each owning story only once for multiple new files', () => {
  const dir = makeProject({
    atFiles: ['E1-S1.spec.ts'],
    receipts: [{ storyId: 'E1-S1', atPath: 'specs/test_artefacts/acceptance/E1-S1.spec.ts' }],
  });
  const v = checkAtFirst(dir, ['src/api/users.py', 'src/api/users.py'], MAP, readReceipts(dir));
  assert.deepStrictEqual(v.storiesChecked, ['E1-S1']);
});

// Regression for the G23 review's CR-002: a component-map row can own a
// whole directory (a non-source-extension token, e.g. `src/orders/`), the
// same way ownership-check.js's isOwned() treats it as owning its subtree.
// fileToStory's exact-match Map alone can never match an individual new file
// under that directory, which silently exempted it from the AT-first
// requirement instead of degrading loudly or resolving the ownership.
const DIR_OWNED_MAP = `# Component Map

| Story | Files |
|---|---|
| E1-S3 | \`src/orders/\` |
`;

test('checkAtFirst resolves a directory-owned story for a new file under that directory (not just exact-match rows)', () => {
  const dir = makeProject({});
  const v = checkAtFirst(dir, ['src/orders/checkout.py'], DIR_OWNED_MAP, readReceipts(dir));
  assert.deepStrictEqual(v.storiesChecked, ['E1-S3']);
  assert.deepStrictEqual(v.missingAt, ['E1-S3']);
});

test('checkAtFirst: directory-owned story with AT file and receipt passes', () => {
  const dir = makeProject({
    atFiles: ['E1-S3.spec.ts'],
    receipts: [{ storyId: 'E1-S3', atPath: 'specs/test_artefacts/acceptance/E1-S3.spec.ts' }],
  });
  const v = checkAtFirst(dir, ['src/orders/checkout.py'], DIR_OWNED_MAP, readReceipts(dir));
  assert.strictEqual(v.pass, true);
});

// --- run() CLI (injected root/exec, no subprocess) ----------------------------

test('run --files SKIPs loudly and exits 0 when no component-map.md exists', () => {
  const dir = makeProject({ mapText: null });
  const code = run(['--files', 'src/api/users.py'], dir, {});
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'at-first-gate.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'skip');
});

test('run --files SKIPs when no new staged file resolves to a story owner', () => {
  const dir = makeProject({ mapText: MAP });
  const code = run(['--files', 'src/rogue/backdoor.py'], dir, {});
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'at-first-gate.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'skip');
});

test('run --files blocks when a new production file\'s story has no AT/receipt', () => {
  const dir = makeProject({ mapText: MAP });
  const code = run(['--files', 'src/api/users.py'], dir, {});
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'at-first-gate.json'), 'utf8'));
  assert.deepStrictEqual(verdict.missingAt, ['E1-S1']);
});

test('run --files passes when the AT file and receipt are both present', () => {
  const dir = makeProject({
    mapText: MAP,
    atFiles: ['E1-S1.spec.ts'],
    receipts: [{ storyId: 'E1-S1', atPath: 'specs/test_artefacts/acceptance/E1-S1.spec.ts' }],
  });
  const code = run(['--files', 'src/api/users.py'], dir, {});
  assert.strictEqual(code, 0);
});

test('run --files never checks test files or non-source files', () => {
  const dir = makeProject({ mapText: MAP });
  const code = run(['--files', 'test/foo.test.js', 'README.md'], dir, {});
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'at-first-gate.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'skip');
});

test('run --staged uses the injected exec with diff-filter=A', () => {
  const dir = makeProject({ mapText: MAP });
  let seenFilter = null;
  const fakeExec = (cmd, args) => {
    seenFilter = args.find((a) => a.startsWith('--diff-filter='));
    return 'src/api/users.py\n';
  };
  const code = run(['--staged'], dir, { exec: fakeExec });
  assert.strictEqual(seenFilter, '--diff-filter=A');
  assert.strictEqual(code, 1); // no AT/receipt staged for E1-S1
});

test('run returns usage error (2) for an unknown mode', () => {
  const dir = makeProject({ mapText: MAP });
  assert.strictEqual(run(['--bogus'], dir, {}), 2);
});

test('readReceipts tolerates a missing file and skips malformed lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-first-'));
  assert.deepStrictEqual(readReceipts(dir), []);
  const p = path.join(dir, 'specs', 'reviews', 'at-red-receipts.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'not json\n' + JSON.stringify({ storyId: 'E1-S1', atPath: 'a.ts' }) + '\n');
  const rows = readReceipts(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].storyId, 'E1-S1');
});
