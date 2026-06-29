'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'contract-accessibility-default.js');
const VALIDATOR = path.join(ROOT, '.claude', 'scripts', 'validate-contract.js');
const { normalizeContract } = require('../.claude/scripts/contract-accessibility-default.js');

const A11Y = { required: true, block_impacts: ['serious', 'critical'] };

// Build the real nested contract shape: { group, stories, features, contract: checks }
const wrapped = (checks) => ({ group: 'A', stories: ['E1-S1'], features: ['F1'], contract: checks });

test('UI contract (playwright_checks) gets a default accessibility_checks block', () => {
  const out = normalizeContract(wrapped({ playwright_checks: [{ action: 'click' }] }), { enabled: true });
  assert.deepStrictEqual(out.contract.accessibility_checks, A11Y);
});

test('enabled:false leaves the contract unchanged', () => {
  const c = wrapped({ playwright_checks: [{ action: 'click' }] });
  assert.strictEqual(normalizeContract(c, { enabled: false }), c);
});

test('a contract that already defines accessibility_checks is respected', () => {
  const c = wrapped({ playwright_checks: [{}], accessibility_checks: { required: false, block_impacts: ['critical'] } });
  const out = normalizeContract(c, { enabled: true });
  assert.deepStrictEqual(out.contract.accessibility_checks, { required: false, block_impacts: ['critical'] });
  assert.strictEqual(out, c); // unchanged reference
});

test('API-only contract (no playwright_checks) is unchanged', () => {
  const c = wrapped({ api_checks: [{}] });
  assert.strictEqual(normalizeContract(c, { enabled: true }), c);
});

test('idempotent: a second pass changes nothing', () => {
  const once = normalizeContract(wrapped({ playwright_checks: [{}] }), { enabled: true });
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
  const out = runCli(undefined, wrapped({ playwright_checks: [{ action: 'click' }] }));
  assert.deepStrictEqual(out.contract.accessibility_checks, A11Y);
});

test('CLI leaves the contract alone when accessibility.enabled is false', () => {
  const out = runCli({ enabled: false }, wrapped({ playwright_checks: [{ action: 'click' }] }));
  assert.strictEqual(out.contract && out.contract.accessibility_checks, undefined);
});

// Schema-valid playwright_checks item requires id, description, steps (each step requires action).
function schemaValidContract() {
  return wrapped({
    playwright_checks: [
      {
        id: 'pw-001',
        description: 'Homepage loads',
        url: '/',
        steps: [{ action: 'navigate', value: '/' }],
      },
    ],
  });
}

test('CLI + validate-contract round-trip: injected accessibility_checks is schema-valid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-rt-'));
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify({}));
  const cp = path.join(dir, 'contract.json');
  fs.writeFileSync(cp, JSON.stringify(schemaValidContract()));

  // Run normalizer — should inject accessibility_checks.
  execFileSync('node', [SCRIPT, cp, '--root', dir], { stdio: 'pipe' });
  const out = JSON.parse(fs.readFileSync(cp, 'utf8'));
  assert.deepStrictEqual(out.contract.accessibility_checks, A11Y, 'block injected');

  // Run schema validator — must exit 0 (contract still valid after injection).
  let validatorOutput = '';
  try {
    validatorOutput = execFileSync('node', [VALIDATOR, cp], { stdio: 'pipe' }).toString();
  } catch (err) {
    assert.fail(`validate-contract exited non-zero after injection:\n${err.stdout}\n${err.stderr}`);
  }
  assert.ok(/VALID/.test(validatorOutput), `validator output should say VALID: ${validatorOutput}`);
});

const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G12: default-on a11y is wired into /auto + registered active', () => {
  assert.ok(/contract-accessibility-default\.js/.test(rd('.claude/skills/auto/SKILL.md')),
    '/auto must run the accessibility normalizer');
  const m = JSON.parse(rd('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'accessibility');
  assert.ok(s, 'accessibility sensor must exist');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.scope, 'runtime');
  assert.ok(s.wired_at && fs.existsSync(path.join(ROOT, s.wired_at)), 'wired_at must resolve');
});
