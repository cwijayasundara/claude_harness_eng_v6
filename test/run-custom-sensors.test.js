'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { loadCustomSensors, runOne, runAll, SCHEMA_PATH } = require('../.claude/scripts/run-custom-sensors');

function proj(customSensors) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.writeFileSync(path.join(d, 'project-manifest.json'), JSON.stringify({ custom_sensors: customSensors }));
  return d;
}

test('loadCustomSensors returns [] when key absent', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.writeFileSync(path.join(d, 'project-manifest.json'), JSON.stringify({}));
  assert.deepStrictEqual(loadCustomSensors(d), []);
});

test('runOne parses a passing command as success', () => {
  const d = proj([]);
  const r = runOne({ id: 'ok', command: 'echo \'{"findings":[]}\'', parser: 'default' }, d);
  assert.strictEqual(r.result.success, true);
});

test('runOne treats a non-JSON / failing command as a failed result, never throws', () => {
  const d = proj([]);
  const r = runOne({ id: 'boom', command: 'echo not-json; exit 3', parser: 'default' }, d);
  assert.strictEqual(r.result.success, false);
});

test('loadCustomSensors drops entries that fail custom-sensors.schema.json required fields', () => {
  assert.ok(fs.existsSync(SCHEMA_PATH), 'runner must load the shipped schema, not a hardcoded fallback');
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  assert.deepStrictEqual(schema.required, ['id', 'command']);
  const d = proj([
    { id: 'ok', command: 'echo hi' },
    { id: 'no-command' },
    { command: 'echo hi' },
    { id: 1, command: 'echo hi' },
    null,
  ]);
  assert.deepStrictEqual(loadCustomSensors(d).map((e) => e.id), ['ok']);
});

test('runAll filters by cadence and skips disabled entries', () => {
  const d = proj([
    { id: 'a', command: 'echo \'{"findings":[]}\'', cadence: 'commit', enabled: true },
    { id: 'b', command: 'echo \'{"findings":[]}\'', cadence: 'on-demand' },
    { id: 'c', command: 'echo \'{"findings":[]}\'', cadence: 'commit', enabled: false },
  ]);
  const out = runAll(d, { cadence: 'commit' });
  assert.deepStrictEqual(out.sensors.map((s) => s.id), ['a']);
});
