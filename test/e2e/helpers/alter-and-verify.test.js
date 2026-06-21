'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { alterAndVerify } = require('./alter-and-verify');

test('alterAndVerify maps the codebase, alters it, and reports code-graph + suite status', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alter-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brownfield'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'brownfield', 'code-graph.json'), '{"nodes":[],"edges":[]}');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));

  const calls = [];
  const fakeRun = (cmd) => { calls.push(cmd); return { exitCode: 0 }; };
  const r = alterAndVerify(fakeRun, { cwd: dir }, { projectDir: dir, changeDesc: 'add subtract' });

  assert.ok(calls.some((c) => c.startsWith('/brownfield')), 'runs /brownfield (code-map + discovery)');
  assert.ok(calls.some((c) => c.startsWith('/change add subtract')), 'runs /change to alter');
  assert.equal(r.codeGraphExists, true, 'reports the code-graph the map produced');
  assert.equal(r.suite.status, 0, 'reports the generated suite status after the alteration');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('alterAndVerify reports a missing code-graph as false (no throw)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alter-bare-'));
  const r = alterAndVerify(() => ({ exitCode: 0 }), { cwd: dir }, { projectDir: dir, changeDesc: 'x' });
  assert.equal(r.codeGraphExists, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
