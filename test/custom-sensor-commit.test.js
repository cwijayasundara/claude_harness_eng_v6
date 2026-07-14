'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runCommitCustomSensors } = require('../.claude/hooks/lib/gate-registry');
const fs = require('fs'), os = require('os'), path = require('path');

function proj(cs) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  fs.mkdirSync(path.join(d, '.claude/state'), { recursive: true });
  fs.writeFileSync(path.join(d, 'project-manifest.json'), JSON.stringify({ custom_sensors: cs }));
  return d;
}

test('report-only failing custom sensor does not block', () => {
  const d = proj([{ id: 'r', command: 'echo not-json', cadence: 'commit', blocking: false }]);
  assert.doesNotThrow(() => runCommitCustomSensors(d));
});

test('blocking failing custom sensor calls fail (throws in test harness)', () => {
  const d = proj([{ id: 'b', command: 'echo not-json', cadence: 'commit', blocking: true }]);
  // fail() calls process.exit(1); stub it to throw so the test can observe the block.
  const origExit = process.exit;
  process.exit = (code) => { throw new Error('exit ' + code); };
  try { assert.throws(() => runCommitCustomSensors(d), /exit 1/); }
  finally { process.exit = origExit; }
});
