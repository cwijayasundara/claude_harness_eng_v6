'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

// Exercises the validate-contract.js CLI end-to-end (arg parsing, file IO, exit
// codes) — contract-validate.test.js covers the schema library; this covers the
// script that the /auto loop and the pre-commit hook actually invoke.

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'validate-contract.js');
const SCHEMA = path.join(__dirname, '..', '.claude', 'skills', 'evaluate', 'references', 'contract-schema.json');

const VALID_CONTRACT = { group: 'A', stories: ['E1-S1'], features: ['F1'], contract: {} };

function writeJson(dir, name, data) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe' }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

test('exit 0 and VALID on a schema-conformant contract', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  const r = run([writeJson(dir, 'c.json', VALID_CONTRACT)]);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /VALID:/);
});

test('exit 1 and INVALID when a required field is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  const bad = { group: 'A', stories: ['E1-S1'], features: ['F1'] }; // no `contract`
  const r = run([writeJson(dir, 'c.json', bad)]);
  assert.strictEqual(r.code, 1);
  assert.match(r.stdout, /INVALID:/);
});

test('exit 1 when a constraint is violated (empty stories)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  const bad = { group: 'A', stories: [], features: ['F1'], contract: {} };
  const r = run([writeJson(dir, 'c.json', bad)]);
  assert.strictEqual(r.code, 1);
});

test('exit 2 with usage when no contract path is given', () => {
  const r = run([]);
  assert.strictEqual(r.code, 2);
  assert.match(r.stderr, /usage:/);
});

test('exit 2 when the contract file cannot be read', () => {
  const r = run([path.join(os.tmpdir(), 'no-such-contract.json')]);
  assert.strictEqual(r.code, 2);
});

test('accepts an explicit schema path as the second argument', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-'));
  const r = run([writeJson(dir, 'c.json', VALID_CONTRACT), SCHEMA]);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /VALID:/);
});
