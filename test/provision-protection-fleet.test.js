'use strict';

// C5: the fleet.json registry ({ org, repos:[{owner,repo}] }) is the repo-mode
// rollup seam consumed only by `--apply --fleet`. All gh calls via a recording
// arg-matching stub (ghStub idiom); no live network.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { run } = require(path.join(__dirname, '..', '.claude', 'scripts', 'provision-protection.js'));

function ghStub(routes, calls) {
  return (args) => {
    if (calls) calls.push({ args: [...args] });
    const key = args.join(' ');
    for (const [needle, out] of routes) {
      if (key.includes(needle)) return typeof out === 'string' ? out : JSON.stringify(out);
    }
    throw new Error(`unexpected gh call: ${key}`);
  };
}

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-fleet-'));
  const manifest = { github: { org: '', ruleset_scope: 'repo', ruleset_name: 'harness-baseline-protection', required_checks: ['gitleaks', 'sast'], required_approvals: 1, require_code_owner_review: true, enforce_admins: true } };
  fs.writeFileSync(path.join(dir, 'project-manifest.json'), JSON.stringify(manifest));
  return dir;
}

function capture(fn) {
  const out = { stdout: '', stderr: '' };
  const ow = process.stdout.write; const oe = process.stderr.write;
  process.stdout.write = (c) => { out.stdout += c; return true; };
  process.stderr.write = (c) => { out.stderr += c; return true; };
  try { out.code = fn(); } finally { process.stdout.write = ow; process.stderr.write = oe; }
  return out;
}

test('--apply --fleet iterates every repo in the registry (repo-mode)', () => {
  const dir = mkProject();
  const fleet = path.join(dir, 'fleet.json');
  fs.writeFileSync(fleet, JSON.stringify({ org: '', repos: [{ owner: 'a', repo: 'x' }, { owner: 'b', repo: 'y' }] }));
  const calls = [];
  const runner = ghStub([
    ['--method POST', { id: 1 }],
    ['repos/a/x/rulesets', []],
    ['repos/b/y/rulesets', []],
  ], calls);
  const res = capture(() => run(['--apply', '--fleet', fleet], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 0, res.stderr);
  const posts = calls.filter((c) => c.args.includes('POST')).map((c) => c.args[3]);
  assert.deepStrictEqual(posts, ['repos/a/x/rulesets', 'repos/b/y/rulesets']);
});

test('--apply --fleet with an unreadable registry fails loudly (exit 2), never throws', () => {
  const dir = mkProject();
  const runner = () => { throw new Error('should not be called'); };
  const res = capture(() => run(['--apply', '--fleet', path.join(dir, 'nope.json')], { cwd: dir, runner, env: {} }));
  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /fleet/i);
});

test('the shipped fleet.template.json is the documented empty registry shape', () => {
  const tmpl = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'templates', 'fleet.template.json'), 'utf8'));
  assert.strictEqual(tmpl.org, '');
  assert.deepStrictEqual(tmpl.repos, []);
});
