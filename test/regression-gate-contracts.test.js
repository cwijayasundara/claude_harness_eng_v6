'use strict';

// Regression-suite-full gate (gap G15), part 2: re-validating PRIOR story-
// group sprint contracts' API layer against the running app, reusing the
// validate-contract.js machinery (hooks/lib/contract-schema) for the
// structural check before executing live HTTP requests. Also the CLI smoke
// test for the require.main entrypoint. Pure logic + e2e-regression tests
// live in regression-gate.test.js.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'regression-gate.js');
const { run } = require(SCRIPT);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'regression-gate-c-'));
}

function writeJson(dir, rel, data) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function realSprintContract(group, apiChecks) {
  // Real schema shape: checks nest under `contract`, never flat at top level
  // (the historical bug this harness already hit once — see contract-schema.json).
  return {
    group,
    stories: [`E1-S${group}`],
    features: [`F${group}`],
    contract: { api_checks: apiChecks },
  };
}

test('run(): prior sprint contract API check now returns wrong status -> BLOCK naming the contract file', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/api/health') { res.writeHead(500); res.end('{}'); return; }
    res.writeHead(404); res.end();
  });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    writeJson(dir, 'sprint-contracts/A.json', realSprintContract('A', [
      { id: 'api-001', method: 'GET', path: '/api/health', expected_status: 200, description: 'health check' },
    ]));
    const outPath = path.join(dir, 'out.json');
    const code = await run(['--root', dir, '--out', outPath, '--api-base-url', `http://127.0.0.1:${port}`]);
    assert.strictEqual(code, 1);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(verdict.verdict, 'blocked');
    assert.strictEqual(verdict.findings.length, 1);
    assert.strictEqual(verdict.findings[0].file, path.join(dir, 'sprint-contracts', 'A.json'));
    assert.match(verdict.findings[0].detail, /api-001/);
    assert.match(verdict.findings[0].detail, /expected status 200, got 500/);
  } finally {
    server.close();
  }
});

test('run(): prior sprint contract API checks still pass -> exit 0', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    writeJson(dir, 'sprint-contracts/A.json', realSprintContract('A', [
      { id: 'api-001', method: 'GET', path: '/api/health', expected_status: 200, expected_body: { ok: true } },
    ]));
    const outPath = path.join(dir, 'out.json');
    const code = await run(['--root', dir, '--out', outPath, '--api-base-url', `http://127.0.0.1:${port}`]);
    assert.strictEqual(code, 0);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(verdict.verdict, 'pass');
  } finally {
    server.close();
  }
});

test('run(): the current group is excluded from the prior-contract regression set', async () => {
  const server = await startServer((req, res) => { res.writeHead(500); res.end(); });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    // Group B is "current" — its own contract is still mid-flight and must not
    // be treated as a prior regression target.
    writeJson(dir, 'sprint-contracts/B.json', realSprintContract('B', [
      { id: 'api-b', method: 'GET', path: '/anything', expected_status: 200 },
    ]));
    const outPath = path.join(dir, 'out.json');
    const code = await run(['--root', dir, '--out', outPath, '--api-base-url', `http://127.0.0.1:${port}`, '--exclude-group', 'B']);
    assert.strictEqual(code, 0);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.deepStrictEqual(verdict.findings, []);
  } finally {
    server.close();
  }
});

test('run(): a prior contract that drifted off the real schema (flat, not nested) is itself a BLOCK', async () => {
  const dir = tmpDir();
  // Flat shape — the exact historical bug: checks NOT nested under `contract`.
  writeJson(dir, 'sprint-contracts/A.json', { group: 'A', stories: ['E1-S1'], features: ['F1'], api_checks: [] });
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--api-base-url', 'http://127.0.0.1:1']);
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(verdict.verdict, 'blocked');
  assert.match(verdict.findings[0].detail, /schema-valid/);
});

test('run(): sprint-contracts/ exists but has no prior contracts (only current) -> exit 0 with a note', async () => {
  const dir = tmpDir();
  writeJson(dir, 'sprint-contracts/B.json', realSprintContract('B', []));
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--exclude-group', 'B']);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(verdict.findings, []);
  assert.ok(verdict.notes.some((n) => /no prior contracts/.test(n)));
});

test('run(): an unreadable contract-schema file BLOCKs instead of silently validating against an empty schema', async () => {
  // Regression-gate.js used to fall back to `{}` when --schema couldn't be
  // read, so validate({}, contract) reported zero schema errors and the
  // drift check was silently disabled — a vacuous pass in the exact gate
  // whose job is to never silently pass. A missing/corrupt schema must BLOCK.
  const server = await startServer((req, res) => { res.writeHead(200); res.end('{}'); });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    writeJson(dir, 'sprint-contracts/A.json', realSprintContract('A', [
      { id: 'api-001', method: 'GET', path: '/anything', expected_status: 200 },
    ]));
    const outPath = path.join(dir, 'out.json');
    const code = await run([
      '--root', dir, '--out', outPath,
      '--api-base-url', `http://127.0.0.1:${port}`,
      '--schema', path.join(dir, 'does-not-exist.json'),
    ]);
    assert.strictEqual(code, 1);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(verdict.verdict, 'blocked');
    assert.match(verdict.findings[0].detail, /schema unreadable/);
  } finally {
    server.close();
  }
});

test('run(): a quarantined api_check id is excluded from the block set', async () => {
  const server = await startServer((req, res) => { res.writeHead(500); res.end(); });
  const { port } = server.address();
  try {
    const dir = tmpDir();
    writeJson(dir, 'sprint-contracts/A.json', realSprintContract('A', [
      { id: 'flaky-api-check', method: 'GET', path: '/x', expected_status: 200 },
    ]));
    fs.mkdirSync(path.join(dir, 'specs', 'drift'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'specs', 'drift', 'flake-history.jsonl'),
      JSON.stringify({ name: 'flaky-api-check', passed: 3, failed: 1 }) + '\n'
    );
    const outPath = path.join(dir, 'out.json');
    const code = await run(['--root', dir, '--out', outPath, '--api-base-url', `http://127.0.0.1:${port}`]);
    assert.strictEqual(code, 0);
    const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.deepStrictEqual(verdict.findings, []);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// CLI smoke test (process.argv / require.main path)
// ---------------------------------------------------------------------------

test('CLI: node regression-gate.js exits 0 and writes a verdict file with nothing to regress against', () => {
  const dir = tmpDir();
  let code = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--root', dir], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'regression-gate-verdict.json'), 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-baseline');
});
