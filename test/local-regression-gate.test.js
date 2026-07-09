'use strict';

// Impact-scoped local regression gate (gap G16, pass 2a). The fast, local
// complement to G15's regression-gate.js: instead of the whole accumulated
// e2e/ suite + every prior contract, it runs only what impact-scope.js
// (deterministic TIA over code-graph.json) says a diff could plausibly have
// broken, plus an always-on golden-path safety net
// (project-manifest.json#verification.golden_paths).

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'local-regression-gate.js');
const { run } = require(SCRIPT);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'local-regression-gate-'));
}

function writeJson(dir, rel, data) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function writeText(dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

function fakeE2eCmd(dir, reportObj, exitCode) {
  const reportPath = path.join(dir, 'fake-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(reportObj));
  const argvOut = path.join(dir, 'argv.txt');
  const scriptPath = path.join(dir, 'fake-e2e.sh');
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho "$@" > "${argvOut}"\ncat "${reportPath}"\nexit ${exitCode}\n`);
  fs.chmodSync(scriptPath, 0o755);
  return { scriptPath, argvOut };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function matrixWithGroup(group, storyId, implPaths) {
  return { version: 1, requirements: [{ id: 'VM-1', group, story_id: storyId, implementation_paths: implPaths }] };
}

// ---------------------------------------------------------------------------

test('run(): no impact and no golden paths -> pass, note recorded, no findings', async () => {
  const dir = tmpDir();
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--changed-file', 'backend/nothing.py']);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(verdict.findings, []);
  assert.ok(verdict.notes.some((n) => /0 golden paths configured/.test(n)));
});

test('run(): only impact-scoped specs are passed to the e2e command, not the whole suite', async () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', matrixWithGroup('A', 'E1-S1', ['backend/service.py']));
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  writeText(dir, 'e2e/unrelated.spec.ts', '// spec, must NOT be in scope');
  const { scriptPath, argvOut } = fakeE2eCmd(dir, { suites: [] }, 0);
  const outPath = path.join(dir, 'out.json');
  const code = await run([
    '--root', dir, '--out', outPath,
    '--changed-file', 'backend/service.py',
    '--e2e-cmd', scriptPath,
  ]);
  assert.strictEqual(code, 0);
  const argv = fs.readFileSync(argvOut, 'utf8').trim();
  assert.strictEqual(argv, path.join('e2e', 'E1-S1.spec.ts'));
});

test('run(): an impact-scoped spec now failing -> BLOCK', async () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', matrixWithGroup('A', 'E1-S1', ['backend/service.py']));
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  const report = { suites: [{ title: 'E1-S1.spec.ts', file: 'E1-S1.spec.ts', specs: [{ title: 'flow works', ok: false, file: 'E1-S1.spec.ts', line: 7 }] }] };
  const { scriptPath } = fakeE2eCmd(dir, report, 1);
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--changed-file', 'backend/service.py', '--e2e-cmd', scriptPath]);
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(verdict.verdict, 'blocked');
  assert.strictEqual(verdict.findings.length, 1);
  assert.match(verdict.findings[0].detail, /flow works/);
});

test('run(): golden_paths always run even when impact analysis selects nothing', async () => {
  const dir = tmpDir();
  writeText(dir, 'e2e/golden.spec.ts', '// must always run');
  writeJson(dir, 'project-manifest.json', { verification: { golden_paths: [path.join('e2e', 'golden.spec.ts')] } });
  const { scriptPath, argvOut } = fakeE2eCmd(dir, { suites: [] }, 0);
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--changed-file', 'backend/nothing.py', '--e2e-cmd', scriptPath]);
  assert.strictEqual(code, 0);
  assert.strictEqual(fs.readFileSync(argvOut, 'utf8').trim(), path.join('e2e', 'golden.spec.ts'));
});

test('run(): a golden path that does not exist on disk is noted and excluded, not silently passed through', async () => {
  const dir = tmpDir();
  writeJson(dir, 'project-manifest.json', { verification: { golden_paths: [path.join('e2e', 'does-not-exist.spec.ts')] } });
  const { scriptPath, argvOut } = fakeE2eCmd(dir, { suites: [] }, 0);
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--changed-file', 'backend/nothing.py', '--e2e-cmd', scriptPath]);
  assert.strictEqual(code, 0);
  assert.strictEqual(fs.existsSync(argvOut), false);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.ok(verdict.notes.some((n) => /golden path not found/.test(n) && /does-not-exist\.spec\.ts/.test(n)));
});

test('run(): an impact-scoped prior contract now failing -> BLOCK naming the contract file', async () => {
  const server = await startServer((req, res) => { res.writeHead(500); res.end(); });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    writeJson(dir, 'specs/test_artefacts/verification-matrix.json', matrixWithGroup('A', 'E1-S1', ['backend/service.py']));
    writeJson(dir, 'sprint-contracts/A.json', {
      group: 'A', stories: ['E1-S1'], features: ['F1'],
      contract: { api_checks: [{ id: 'api-001', method: 'GET', path: '/x', expected_status: 200 }] },
    });
    const outPath = path.join(dir, 'out.json');
    const code = await run([
      '--root', dir, '--out', outPath,
      '--changed-file', 'backend/service.py',
      '--api-base-url', `http://127.0.0.1:${port}`,
    ]);
    assert.strictEqual(code, 1);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(verdict.verdict, 'blocked');
    assert.match(verdict.findings[0].detail, /api-001/);
  } finally {
    server.close();
  }
});

test('run(): --exclude-group keeps the current in-flight group out of scope (e2e command never invoked)', async () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', matrixWithGroup('A', 'E1-S1', ['backend/service.py']));
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  const { scriptPath, argvOut } = fakeE2eCmd(dir, { suites: [] }, 0);
  const outPath = path.join(dir, 'out.json');
  const code = await run([
    '--root', dir, '--out', outPath,
    '--changed-file', 'backend/service.py',
    '--e2e-cmd', scriptPath,
    '--exclude-group', 'A',
  ]);
  assert.strictEqual(code, 0);
  assert.strictEqual(fs.existsSync(argvOut), false);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(verdict.scope.impactedGroups, []);
  assert.ok(verdict.notes.some((n) => /no e2e specs in scope/.test(n)));
});

test('run(): a quarantined impact-scoped spec does not block', async () => {
  const dir = tmpDir();
  writeJson(dir, 'specs/test_artefacts/verification-matrix.json', matrixWithGroup('A', 'E1-S1', ['backend/service.py']));
  writeText(dir, 'e2e/E1-S1.spec.ts', '// spec');
  writeText(dir, 'specs/drift/flake-history.jsonl', JSON.stringify({ name: 'known flaky' }) + '\n');
  const report = { suites: [{ title: 'E1-S1.spec.ts', file: 'E1-S1.spec.ts', specs: [{ title: 'known flaky', ok: false, file: 'E1-S1.spec.ts', line: 1 }] }] };
  const { scriptPath } = fakeE2eCmd(dir, report, 1);
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--changed-file', 'backend/service.py', '--e2e-cmd', scriptPath]);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(verdict.findings, []);
});

test('run(): an unreadable contract-schema BLOCKs instead of silently validating against an empty schema', async () => {
  const server = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    writeJson(dir, 'specs/test_artefacts/verification-matrix.json', matrixWithGroup('A', 'E1-S1', ['backend/service.py']));
    writeJson(dir, 'sprint-contracts/A.json', { contract: { api_checks: [{ id: 'api-001', method: 'GET', path: '/x', expected_status: 200 }] } });
    const outPath = path.join(dir, 'out.json');
    const code = await run([
      '--root', dir, '--out', outPath,
      '--changed-file', 'backend/service.py',
      '--api-base-url', `http://127.0.0.1:${port}`,
      '--schema', path.join(dir, 'does-not-exist.json'),
    ]);
    assert.strictEqual(code, 1);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.match(verdict.findings[0].detail, /schema unreadable/);
  } finally {
    server.close();
  }
});

test('CLI: node local-regression-gate.js exits 0 and writes a verdict with an empty scope', async () => {
  const { execFileSync } = require('child_process');
  const dir = tmpDir();
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--root', dir, '--changed-file', 'nothing.py'], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'local-regression-gate-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'pass');
});
