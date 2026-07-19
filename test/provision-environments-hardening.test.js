'use strict';

// Increment-3 whole-branch-review hardening (CR-001/ENV-001..004). Kept in a
// separate file so provision-environments.test.js stays under the length gate.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { normalizeLiveEnvironment } = require('../.claude/scripts/env-diff');
const { run } = require('../.claude/scripts/provision-environments');
const { materializeDeployWorkflow } = require('../.claude/scripts/scaffold-security-baseline');

const SRC = path.join(__dirname, '..', '.claude');

function mkProject(environments) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provenv-h-'));
  const manifest = { name: 'p', quality: { sensor_tier: 'strict' }, github: { org: 'o', environments } };
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function capture(fn) {
  const out = { stdout: '', stderr: '' };
  const ow = process.stdout.write;
  const oe = process.stderr.write;
  process.stdout.write = (c) => { out.stdout += c; return true; };
  process.stderr.write = (c) => { out.stderr += c; return true; };
  try { out.code = fn(); } finally { process.stdout.write = ow; process.stderr.write = oe; }
  return out;
}

// --- CR-001/ENV-001: GET-shape normalization --------------------------------

test('normalizeLiveEnvironment folds protection_rules[] into the flat canonical shape', () => {
  const get = {
    name: 'production',
    protection_rules: [
      { id: 1, type: 'wait_timer', wait_timer: 30 },
      { id: 2, type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 7 } }, { type: 'Team', reviewer: { id: 9 } }] },
      { id: 3, type: 'branch_policy' },
    ],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  };
  const flat = normalizeLiveEnvironment(get);
  assert.strictEqual(flat.wait_timer, 30);
  assert.deepStrictEqual(flat.reviewers, [{ type: 'User', id: 7 }, { type: 'Team', id: 9 }]);
  assert.deepStrictEqual(flat.deployment_branch_policy, { protected_branches: true, custom_branch_policies: false });
});

test('normalizeLiveEnvironment passes an already-flat body through unchanged', () => {
  const flat = { name: 'x', wait_timer: 0, reviewers: [], deployment_branch_policy: {} };
  assert.strictEqual(normalizeLiveEnvironment(flat), flat);
});

// --- ENV-002: environment-name path-traversal rejected ----------------------

test('--apply rejects an environment name that would manipulate the API path (exit 2)', () => {
  const dir = mkProject([{ name: 'prod/../../orgs/x', reviewers: [{ type: 'Team', id: 1 }], protected_branches: true }]);
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner: () => { throw new Error('should not be called'); } }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /environment name .* is invalid/);
});

test('plan also rejects a traversal environment name (exit 2)', () => {
  const dir = mkProject([{ name: '../evil', reviewers: [], protected_branches: true }]);
  const res = capture(() => run(['plan', '--repo', 'acme/widget'], { cwd: dir, runner: () => { throw new Error('nope'); } }));
  assert.strictEqual(res.code, 2);
});

// --- CR-002a: 404 detection is not over-broad --------------------------------

test('--verify treats a non-"HTTP 404" error as a read failure (exit 2), not as an absent env', () => {
  const dir = mkProject([{ name: 'production', reviewers: [{ type: 'Team', id: 1 }], protected_branches: true }]);
  // Contains a bare "404" and "Not Found" but is NOT the gh HTTP 404 status line.
  const runner = () => { throw new Error('gh: unexpected token 404 in resource Not Found reference'); };
  const res = capture(() => run(['--verify', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 2);
});

// --- ENV-003: gateless apply is a distinct exit 3 ---------------------------

test('--apply with a populated reviewer exits 0 (gate is live)', () => {
  const dir = mkProject([{ name: 'production', reviewers: [{ type: 'Team', id: 1 }], wait_timer: 0, protected_branches: true }]);
  const runner = (args) => (args.includes('PUT') ? '{}' : '{}');
  const res = capture(() => run(['--apply', '--repo', 'acme/widget'], { cwd: dir, runner }));
  assert.strictEqual(res.code, 0, res.stderr);
});

// --- ENV-004: deploy.yml env name is validated + stamped safely -------------

test('materializeDeployWorkflow stamps a valid environment name literally', () => {
  const target = mkProject([{ name: 'prod-1', reviewers: [], protected_branches: true }]);
  const out = materializeDeployWorkflow(target, SRC);
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /environment: prod-1\b/);
});

test('materializeDeployWorkflow rejects an environment name with shell/regex specials', () => {
  const target = mkProject([{ name: 'prod$1', reviewers: [], protected_branches: true }]);
  assert.throws(() => materializeDeployWorkflow(target, SRC), /invalid environment name/);
});
