'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'contract-accessibility-default.js');
const { normalizeContract } = require('../.claude/scripts/contract-accessibility-default.js');

const A11Y = { required: true, block_impacts: ['serious', 'critical'] };

test('UI contract (playwright_checks) gets a default accessibility_checks block', () => {
  const out = normalizeContract({ playwright_checks: [{ action: 'click' }] }, { enabled: true });
  assert.deepStrictEqual(out.accessibility_checks, A11Y);
});

test('enabled:false leaves the contract unchanged', () => {
  const c = { playwright_checks: [{ action: 'click' }] };
  assert.strictEqual(normalizeContract(c, { enabled: false }), c);
});

test('a contract that already defines accessibility_checks is respected', () => {
  const c = { playwright_checks: [{}], accessibility_checks: { required: false, block_impacts: ['critical'] } };
  const out = normalizeContract(c, { enabled: true });
  assert.deepStrictEqual(out.accessibility_checks, { required: false, block_impacts: ['critical'] });
  assert.strictEqual(out, c); // unchanged reference
});

test('API-only contract (no playwright_checks) is unchanged', () => {
  const c = { api_checks: [{}] };
  assert.strictEqual(normalizeContract(c, { enabled: true }), c);
});

test('idempotent: a second pass changes nothing', () => {
  const once = normalizeContract({ playwright_checks: [{}] }, { enabled: true });
  const twice = normalizeContract(once, { enabled: true });
  assert.deepStrictEqual(twice, once);
});

// CLI: hermetic temp dir with manifest + contract file.
function runCli(manifestAccessibility, contract) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  const mani = manifestAccessibility === undefined ? {} : { accessibility: manifestAccessibility };
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(mani));
  const cp = path.join(dir, 'contract.json');
  fs.writeFileSync(cp, JSON.stringify(contract));
  execFileSync('node', [SCRIPT, cp, '--root', dir], { stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(cp, 'utf8'));
}

test('CLI injects the block for a UI contract (default-on)', () => {
  const out = runCli(undefined, { playwright_checks: [{ action: 'click' }] });
  assert.deepStrictEqual(out.accessibility_checks, A11Y);
});

test('CLI leaves the contract alone when accessibility.enabled is false', () => {
  const out = runCli({ enabled: false }, { playwright_checks: [{ action: 'click' }] });
  assert.strictEqual(out.accessibility_checks, undefined);
});
