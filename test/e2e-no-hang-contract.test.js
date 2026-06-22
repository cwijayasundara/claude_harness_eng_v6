'use strict';

// Guards against the e2e runner hanging AFTER its tests pass — open handles from
// the telemetry helpers (HTTP sockets) and the spawned `claude` tree keep
// node:test's event loop alive, so a finished run looks like a multi-hour stall.
// An autonomous harness that can hang indefinitely isn't autonomous, so:
//   1. every long-running e2e npm script forces a clean exit (--test-force-exit);
//   2. run.sh wraps each layer in a wall-clock watchdog, turning a true stall
//      into a bounded, visible FAILURE instead of an unbounded hang.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const E2E_SCRIPTS = ['test:e2e', 'test:smoke', 'test:plan', 'test:auto', 'test:semi', 'test:all'];

test('every long-running e2e npm script forces a clean runner exit', () => {
  const pkg = JSON.parse(read('package.json'));
  const offenders = E2E_SCRIPTS.filter((s) => {
    const cmd = pkg.scripts[s] || '';
    return cmd.includes('node --test') && !cmd.includes('--test-force-exit');
  });
  assert.deepStrictEqual(offenders, [], `e2e scripts missing --test-force-exit: ${offenders.join(', ')}`);
});

test('run.sh forces a clean exit and wraps each layer in a wall-clock watchdog', () => {
  const sh = read(path.join('test', 'e2e', 'run.sh'));
  assert.match(sh, /--test-force-exit/, 'layers must force a clean runner exit');
  assert.match(sh, /run_layer|with_timeout|gtimeout|\btimeout /, 'layers must run under a bounded watchdog');
  // no layer may call `node --test` directly, bypassing the watchdog wrapper
  assert.strictEqual(sh.match(/^\s*node --test/m), null, 'every node --test must go through the watchdog');
});

test('the watchdog kills a stalled layer rather than waiting forever', () => {
  const sh = read(path.join('test', 'e2e', 'run.sh'));
  // a watchdog that backgrounds the layer and kills it past a cap
  assert.match(sh, /kill[^\n]*\b(-9|TERM|KILL)?\b/, 'watchdog must kill the layer on timeout');
});
