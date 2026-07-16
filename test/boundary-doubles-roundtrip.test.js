'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function hasPython() {
  return spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
}

const TEMPLATES = path.join(__dirname, '..', '.claude', 'templates', 'boundary-doubles');

function runPy(script, cwd) {
  return spawnSync('python3', ['-c', script], { cwd, encoding: 'utf8' });
}

test('ReplayTransport records then replays a byte-identical fixture', (t) => {
  if (!hasPython()) { t.skip('python3 unavailable — round-trip skipped LOUDLY (not silently passed)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdrt-'));
  fs.copyFileSync(path.join(TEMPLATES, 'replay_transport.py'), path.join(dir, 'replay_transport.py'));
  const script = [
    'from replay_transport import ReplayTransport',
    't = ReplayTransport("svc", "fixtures")',
    't.record("op", {"z": 1, "a": 2})',
    'import os; os.environ["HARNESS_TEST_REPLAY"]="1"',
    'assert t.replay("op") == {"z": 1, "a": 2}',
    'print("OK")',
  ].join('\n');
  const r = runPy(script, dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('FakeLLMClient replays a golden keyed by stable request hash', (t) => {
  if (!hasPython()) { t.skip('python3 unavailable — round-trip skipped LOUDLY'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdrt-'));
  fs.copyFileSync(path.join(TEMPLATES, 'fake_llm.py'), path.join(dir, 'fake_llm.py'));
  const script = [
    'from fake_llm import FakeLLMClient, request_key',
    'c = FakeLLMClient("llm")',
    'payload = {"prompt": "hi", "n": 3}',
    'c.record_golden("classify", payload, {"label": "greeting"})',
    'assert c.respond("classify", {"n": 3, "prompt": "hi"}) == {"label": "greeting"}',  // key order-independent
    'assert request_key({"a":1,"b":2}) == request_key({"b":2,"a":1})',
    'print("OK")',
  ].join('\n');
  const r = runPy(script, dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('MissingFixtureError raised in replay mode when no fixture exists', (t) => {
  if (!hasPython()) { t.skip('python3 unavailable — round-trip skipped LOUDLY'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdrt-'));
  fs.copyFileSync(path.join(TEMPLATES, 'replay_transport.py'), path.join(dir, 'replay_transport.py'));
  const script = [
    'from replay_transport import ReplayTransport, MissingFixtureError',
    't = ReplayTransport("svc", "fixtures")',
    'try:',
    '    t.replay("never-recorded"); print("NO-RAISE")',
    'except MissingFixtureError:',
    '    print("OK")',
  ].join('\n');
  const r = runPy(script, dir);
  assert.match(r.stdout, /OK/);
});
