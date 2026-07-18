'use strict';

// C1: security-scan.js is tier-aware. A required scanner missing from PATH is a
// BLOCK in the strict tier (fail-closed) and a loud, non-blocking note-skip in
// minimal/standard. Real subprocess with an empty PATH forces the scanners
// absent — no hand-built fixture.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, '.claude', 'scripts', 'security-scan.js');
const { requiredScanners, localSastCommand } = require('../.claude/scripts/security-scan.js');

function runCli(args, cwd) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: '' } });
  return { code: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

test('requiredScanners: gitleaks + semgrep for semgrep, gitleaks-only for veracode (CI-only)', () => {
  assert.deepStrictEqual(requiredScanners('semgrep'), ['gitleaks', 'semgrep']);
  assert.deepStrictEqual(requiredScanners('veracode'), ['gitleaks']);
  assert.strictEqual(localSastCommand('veracode'), null);
  assert.strictEqual(localSastCommand('semgrep'), 'semgrep');
});

test('strict tier BLOCKS (exit 1) when a required scanner is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secscan-strict-'));
  try {
    const { code, out } = runCli(['--secrets', '--tier=strict'], dir);
    assert.strictEqual(code, 1, 'strict must fail closed on a missing required scanner');
    assert.match(out, /SENSOR REQUIRED but not installed/);
    assert.match(out, /gitleaks/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// VULN-001: a gitleaks that RAN but errored (no readable report) must count as
// "did not run" and BLOCK in strict — never a silent zero-finding pass. A fake
// gitleaks on PATH exits non-zero, writes no report, and prints no
// missing-signature, so toolchain.skipped() is false and the report read throws.
test('strict tier BLOCKS when gitleaks errored (ran, no readable report)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secscan-err-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebin-'));
  try {
    const fake = path.join(bin, 'gitleaks');
    fs.writeFileSync(fake, '#!/bin/sh\necho "encountered a fatal error parsing config" >&2\nexit 1\n');
    fs.chmodSync(fake, 0o755);
    const res = spawnSync(process.execPath, [CLI, '--secrets', '--tier=strict'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: bin },
    });
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.strictEqual(res.status, 1, 'an errored required scanner must fail closed in strict');
    assert.match(out, /SENSOR REQUIRED but not installed|gitleaks/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('standard tier note-skips (exit 0) when the scanner is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secscan-std-'));
  try {
    const { code, out } = runCli(['--secrets', '--tier=standard'], dir);
    assert.strictEqual(code, 0, 'standard must not block an unprovisioned repo');
    assert.match(out, /SENSOR SKIPPED|not installed/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
