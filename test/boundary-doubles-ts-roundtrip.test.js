'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function hasTsx() {
  return spawnSync('npx', ['tsx', '--version'], { encoding: 'utf8' }).status === 0;
}

const TEMPLATES = path.join(__dirname, '..', '.claude', 'templates', 'boundary-doubles');

function runTs(files, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdts-'));
  // Mark the temp dir as ESM so tsx/esbuild allows top-level await in run.ts.
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  for (const f of files) fs.copyFileSync(path.join(TEMPLATES, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'run.ts'), lines.join('\n'));
  return spawnSync('npx', ['tsx', 'run.ts'], { cwd: dir, encoding: 'utf8' });
}

test('ReplayTransport records then replays a byte-identical fixture (TS)', (t) => {
  if (!hasTsx()) { t.skip('tsx unavailable — TS round-trip skipped LOUDLY (not silently passed)'); return; }
  const r = runTs(['replay-transport.ts'], [
    "import { ReplayTransport } from './replay-transport';",
    "const t = new ReplayTransport('svc', 'fixtures');",
    "await t.record('op', { z: 1, a: 2 });",
    "process.env.HARNESS_TEST_REPLAY = '1';",
    "const got = await t.replay('op');",
    "if (JSON.stringify(got) !== JSON.stringify({ z: 1, a: 2 })) throw new Error('mismatch: ' + JSON.stringify(got));",
    "console.log('OK');",
  ]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('FakeLLMClient replays a golden keyed by an order-independent request hash (TS)', (t) => {
  if (!hasTsx()) { t.skip('tsx unavailable — TS round-trip skipped LOUDLY'); return; }
  const r = runTs(['fake-llm.ts'], [
    "import { FakeLLMClient, requestKey } from './fake-llm';",
    "const c = new FakeLLMClient('llm');",
    "await c.recordGolden('classify', { prompt: 'hi', n: 3 }, { label: 'greeting' });",
    "const got = await c.respond('classify', { n: 3, prompt: 'hi' });",
    "if (JSON.stringify(got) !== JSON.stringify({ label: 'greeting' })) throw new Error('mismatch');",
    "if (requestKey({ a: 1, b: 2 }) !== requestKey({ b: 2, a: 1 })) throw new Error('key not order-independent');",
    "console.log('OK');",
  ]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('MissingFixtureError / GoldenNotFoundError raised on a missing fixture (TS)', (t) => {
  if (!hasTsx()) { t.skip('tsx unavailable — TS round-trip skipped LOUDLY'); return; }
  const r = runTs(['replay-transport.ts', 'fake-llm.ts'], [
    "import { ReplayTransport, MissingFixtureError } from './replay-transport';",
    "import { FakeLLMClient, GoldenNotFoundError } from './fake-llm';",
    "let ok = 0;",
    "try { await new ReplayTransport('svc', 'fx').replay('never'); } catch (e) { if (e instanceof MissingFixtureError) ok++; else throw e; }",
    "try { await new FakeLLMClient('llm').respond('op', { a: 1 }); } catch (e) { if (e instanceof GoldenNotFoundError) ok++; else throw e; }",
    "if (ok === 2) console.log('OK'); else throw new Error('expected 2 typed errors, got ' + ok);",
  ]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});
