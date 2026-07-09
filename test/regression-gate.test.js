'use strict';

// Regression-suite-full gate (gap G15). Closes the cross-feature regression
// hole: /evaluate and /gate only check the CURRENT story-group's sprint
// contract; /change and /vibe only re-run the unit suite. Nothing re-ran the
// ACCUMULATED e2e/ Playwright suite or PRIOR story-groups' sprint contracts,
// so a fix that passed its own tests could silently break an earlier feature.
//
// This file covers: pure logic, discovery, and the e2e-regression path. The
// prior-sprint-contract API-check regression path (against a real HTTP
// server) and the CLI smoke test live in regression-gate-contracts.test.js.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'regression-gate.js');
const {
  bodyMatches,
  evaluateApiCheck,
  lineOfCheckId,
  loadQuarantineNames,
  isQuarantined,
  extractPlaywrightFailures,
  discoverE2eSpecs,
  discoverPriorContracts,
  run,
} = require(SCRIPT);
const { runE2eSuite } = require(path.join(ROOT, '.claude', 'hooks', 'lib', 'regression-gate'));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'regression-gate-'));
}

function writeJson(dir, rel, data) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

test('bodyMatches: nested subset match passes, mismatched value fails', () => {
  assert.strictEqual(bodyMatches({ ok: true, data: { id: 1 } }, { ok: true, data: { id: 1, extra: 'x' } }), true);
  assert.strictEqual(bodyMatches({ ok: true }, { ok: false }), false);
  assert.strictEqual(bodyMatches(null, 'anything'), true);
  assert.strictEqual(bodyMatches({ id: 1 }, null), false);
});

test('evaluateApiCheck: flags status mismatch and body mismatch independently', () => {
  const check = { expected_status: 200, expected_body: { ok: true } };
  assert.strictEqual(evaluateApiCheck(check, { status: 200, body: { ok: true } }).pass, true);
  const statusFail = evaluateApiCheck(check, { status: 500, body: { ok: true } });
  assert.strictEqual(statusFail.pass, false);
  assert.match(statusFail.problems.join(';'), /expected status 200, got 500/);
  const bodyFail = evaluateApiCheck(check, { status: 200, body: { ok: false } });
  assert.strictEqual(bodyFail.pass, false);
});

test('lineOfCheckId: finds the line carrying the check id', () => {
  const raw = '{\n  "a": 1,\n  "id": "api-002",\n  "b": 2\n}\n';
  assert.strictEqual(lineOfCheckId(raw, 'api-002'), 3);
  assert.strictEqual(lineOfCheckId(raw, 'no-such-id'), null);
});

test('loadQuarantineNames: empty set when file missing; parses jsonl names when present', () => {
  const dir = tmpDir();
  const missing = path.join(dir, 'flake-history.jsonl');
  assert.strictEqual(loadQuarantineNames(missing).size, 0);

  const present = path.join(dir, 'flake-history2.jsonl');
  fs.writeFileSync(present, [
    JSON.stringify({ date: '2026-07-01', name: 'flaky test A', passed: 3, failed: 1 }),
    JSON.stringify({ date: '2026-07-02', name: 'flaky test A', passed: 2, failed: 2 }),
    '', // trailing blank line must not throw
  ].join('\n'));
  const names = loadQuarantineNames(present);
  assert.strictEqual(names.size, 1);
  assert.ok(isQuarantined('flaky test A', names));
  assert.ok(!isQuarantined('some other test', names));
});

test('loadQuarantineNames: malformed jsonl lines are skipped, not fatal', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'flake-history.jsonl');
  fs.writeFileSync(p, 'not json\n' + JSON.stringify({ name: 'ok test' }) + '\n');
  const names = loadQuarantineNames(p);
  assert.ok(names.has('ok test'));
});

test('extractPlaywrightFailures: shape captured from a real `playwright test --reporter=json` run', () => {
  // Captured verbatim (trimmed) from a live run of two spec files: one flat
  // (no describe) and one with a nested describe block.
  const report = {
    suites: [
      {
        title: 'sample.spec.js',
        file: 'sample.spec.js',
        specs: [
          { title: 'passing test', ok: true, file: 'sample.spec.js', line: 2 },
          { title: 'failing test', ok: false, file: 'sample.spec.js', line: 5 },
        ],
      },
      {
        title: 'nested.spec.js',
        file: 'nested.spec.js',
        specs: [],
        suites: [
          {
            title: 'group',
            file: 'nested.spec.js',
            specs: [
              { title: 'nested passing', ok: true, file: 'nested.spec.js', line: 3 },
              { title: 'nested failing', ok: false, file: 'nested.spec.js', line: 4 },
            ],
          },
        ],
      },
    ],
  };
  const failures = extractPlaywrightFailures(report);
  assert.strictEqual(failures.length, 2);
  assert.deepStrictEqual(failures[0], { file: 'sample.spec.js', line: 5, title: 'failing test' });
  assert.deepStrictEqual(failures[1], { file: 'nested.spec.js', line: 4, title: 'group > nested failing' });
});

test('extractPlaywrightFailures: all-passing report yields no failures', () => {
  const report = { suites: [{ title: 'a.spec.js', file: 'a.spec.js', specs: [{ title: 't', ok: true, file: 'a.spec.js', line: 1 }] }] };
  assert.deepStrictEqual(extractPlaywrightFailures(report), []);
});

test('discoverE2eSpecs: null when directory absent, recursive spec discovery otherwise', () => {
  const dir = tmpDir();
  assert.strictEqual(discoverE2eSpecs(dir, 'e2e'), null);
  fs.mkdirSync(path.join(dir, 'e2e', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'e2e', 'a.spec.ts'), '// spec');
  fs.writeFileSync(path.join(dir, 'e2e', 'nested', 'b.spec.js'), '// spec');
  fs.writeFileSync(path.join(dir, 'e2e', 'helper.ts'), '// not a spec');
  const specs = discoverE2eSpecs(dir, 'e2e').map((p) => path.relative(dir, p)).sort();
  assert.deepStrictEqual(specs, [path.join('e2e', 'a.spec.ts'), path.join('e2e', 'nested', 'b.spec.js')]);
});

test('discoverPriorContracts: null when directory absent, excludes named groups', () => {
  const dir = tmpDir();
  assert.strictEqual(discoverPriorContracts(dir, 'sprint-contracts', []), null);
  writeJson(dir, 'sprint-contracts/A.json', { group: 'A' });
  writeJson(dir, 'sprint-contracts/B.json', { group: 'B' });
  const all = discoverPriorContracts(dir, 'sprint-contracts', []).map((p) => path.basename(p)).sort();
  assert.deepStrictEqual(all, ['A.json', 'B.json']);
  const excluded = discoverPriorContracts(dir, 'sprint-contracts', ['B']).map((p) => path.basename(p));
  assert.deepStrictEqual(excluded, ['A.json']);
});

// ---------------------------------------------------------------------------
// Orchestration (run()) — degrade-loud paths
// ---------------------------------------------------------------------------

test('run(): no e2e/ and no sprint-contracts/ -> loud no-baseline pass, not a silent skip', async () => {
  const dir = tmpDir();
  const outPath = path.join(dir, 'specs', 'reviews', 'regression-gate-verdict.json');
  const code = await run(['--root', dir, '--out', outPath]);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(verdict.verdict, 'no-baseline');
  assert.match(verdict.message, /nothing to regress against/);
});

test('run(): e2e/ exists with only non-spec files -> exit 0, note recorded, no findings', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'e2e', 'README.md'), 'no specs here');
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath]);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(verdict.findings, []);
  assert.ok(verdict.notes.some((n) => /no \*\.spec/.test(n)));
});

// ---------------------------------------------------------------------------
// e2e regression via a fake e2e command emitting real-shaped JSON
// ---------------------------------------------------------------------------

function fakeE2eCmd(dir, reportObj, exitCode) {
  const reportPath = path.join(dir, 'fake-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(reportObj));
  const scriptPath = path.join(dir, 'fake-e2e.sh');
  fs.writeFileSync(scriptPath, `#!/bin/sh\ncat "${reportPath}"\nexit ${exitCode}\n`);
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test('run(): a previously-passing e2e spec now failing -> BLOCK with file:line detail', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'e2e', 'checkout.spec.ts'), '// spec');
  const report = {
    suites: [{
      title: 'checkout.spec.ts',
      file: 'checkout.spec.ts',
      specs: [{ title: 'checkout completes', ok: false, file: 'checkout.spec.ts', line: 12 }],
    }],
  };
  const cmd = fakeE2eCmd(dir, report, 1);
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--e2e-cmd', cmd]);
  assert.strictEqual(code, 1);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(verdict.verdict, 'blocked');
  assert.strictEqual(verdict.findings.length, 1);
  assert.strictEqual(verdict.findings[0].file, path.join('e2e', 'checkout.spec.ts'));
  assert.strictEqual(verdict.findings[0].line, 12);
  assert.match(verdict.findings[0].detail, /checkout completes/);
});

test('run(): a quarantined (flake-history) failing spec does not block', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'e2e', 'flaky.spec.ts'), '// spec');
  fs.mkdirSync(path.join(dir, 'specs', 'drift'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'specs', 'drift', 'flake-history.jsonl'),
    JSON.stringify({ date: '2026-07-01', name: 'known flaky', passed: 5, failed: 2 }) + '\n'
  );
  const report = {
    suites: [{
      title: 'flaky.spec.ts',
      file: 'flaky.spec.ts',
      specs: [{ title: 'known flaky', ok: false, file: 'flaky.spec.ts', line: 3 }],
    }],
  };
  const cmd = fakeE2eCmd(dir, report, 1);
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--e2e-cmd', cmd]);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.deepStrictEqual(verdict.findings, []);
  assert.ok(verdict.notes.some((n) => /quarantined/.test(n) && /known flaky/.test(n)));
});

test('run(): e2e command binary not found -> unprovisioned note, not a hard failure by itself', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'e2e', 'a.spec.ts'), '// spec');
  const outPath = path.join(dir, 'out.json');
  const code = await run(['--root', dir, '--out', outPath, '--e2e-cmd', '/no/such/e2e-binary-xyz']);
  assert.strictEqual(code, 0);
  const verdict = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.ok(verdict.notes.some((n) => /not runnable/.test(n)));
});

// ---------------------------------------------------------------------------
// runE2eSuite with a file-scoped subset (groundwork for G16 local-regression-gate,
// which runs only the specs impact-scope.js selected instead of the whole suite).
// Additive: the 3-arg call (pass 1's own usage above) must keep working unchanged.
// ---------------------------------------------------------------------------

test('runE2eSuite: 3-arg call (no specFiles) runs the base command unchanged', () => {
  const dir = tmpDir();
  const scriptPath = path.join(dir, 'argv-echo.sh');
  fs.writeFileSync(scriptPath, '#!/bin/sh\necho "{\\"suites\\":[]}"\nexit 0\n');
  fs.chmodSync(scriptPath, 0o755);
  const res = runE2eSuite(dir, scriptPath, 5000);
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(res.report, { suites: [] });
});

test('runE2eSuite: specFiles are appended as extra args to the e2e command', () => {
  const dir = tmpDir();
  const argvOut = path.join(dir, 'argv.txt');
  const scriptPath = path.join(dir, 'argv-capture.sh');
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho "$@" > "${argvOut}"\necho "{\\"suites\\":[]}"\nexit 0\n`);
  fs.chmodSync(scriptPath, 0o755);
  const res = runE2eSuite(dir, `${scriptPath} --reporter=json`, 5000, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
  assert.strictEqual(res.code, 0);
  const argv = fs.readFileSync(argvOut, 'utf8').trim();
  assert.strictEqual(argv, '--reporter=json e2e/a.spec.ts e2e/b.spec.ts');
});

test('runE2eSuite: empty specFiles array behaves like no filter (whole-suite call)', () => {
  const dir = tmpDir();
  const argvOut = path.join(dir, 'argv.txt');
  const scriptPath = path.join(dir, 'argv-capture.sh');
  fs.writeFileSync(scriptPath, `#!/bin/sh\necho "$@" > "${argvOut}"\necho "{\\"suites\\":[]}"\nexit 0\n`);
  fs.chmodSync(scriptPath, 0o755);
  runE2eSuite(dir, scriptPath, 5000, []);
  assert.strictEqual(fs.readFileSync(argvOut, 'utf8').trim(), '');
});
