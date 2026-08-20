#!/usr/bin/env node
'use strict';

// Run user-defined custom sensors declared in project-manifest.json#custom_sensors[].
// Each command's stdout is parsed with the sensor-schema default parser. Commit-
// cadence entries are also invoked from the pre-commit sequence (see gate-registry).
//   node .claude/scripts/run-custom-sensors.js [--root <dir>] [--cadence commit|on-demand]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseDefault } = require('../hooks/lib/sensor-schema');

const SCHEMA_PATH = path.join(__dirname, '..', 'templates', 'custom-sensors.schema.json');

function schemaRequired() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    throw new Error(`custom-sensors.schema.json has no required[]: ${SCHEMA_PATH}`);
  }
  return schema.required;
}

function isValidEntry(entry, required) {
  if (!entry || typeof entry !== 'object') return false;
  return required.every((key) => typeof entry[key] === 'string' && entry[key].trim() !== '');
}

function loadCustomSensors(projectDir) {
  const required = schemaRequired();
  try {
    const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    if (!Array.isArray(m.custom_sensors)) return [];
    return m.custom_sensors.filter((e) => isValidEntry(e, required));
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return [];
    throw err;
  }
}

function runOne(entry, projectDir) {
  let stdout = '';
  try {
    // entry.command is trusted project-manifest configuration, never untrusted/user-derived input.
    stdout = execSync(entry.command, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    stdout = (e.stdout || '') + (e.stderr || e.message || '');
  }
  const result = parseDefault(stdout);
  return { id: String(entry.id || 'custom'), result, blocking: !!entry.blocking };
}

function runAll(projectDir, { cadence } = {}) {
  const entries = loadCustomSensors(projectDir)
    .filter((e) => e && e.enabled !== false)
    .filter((e) => !cadence || (e.cadence || 'on-demand') === cadence);
  const sensors = entries.map((e) => runOne(e, projectDir));
  return { sensors, pass: sensors.every((s) => s.result.success || !s.blocking) };
}

function main(argv = process.argv.slice(2)) {
  const root = (() => { const i = argv.indexOf('--root'); return i === -1 ? process.cwd() : argv[i + 1]; })();
  const cadence = (() => { const i = argv.indexOf('--cadence'); return i === -1 ? undefined : argv[i + 1]; })();
  const out = runAll(root, { cadence });
  const dir = path.join(root, 'specs', 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'custom-sensors.json'), JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`custom-sensors: ${out.sensors.length} run, ${out.pass ? 'PASS' : 'FAIL'}\n`);
  return out.pass ? 0 : 1;
}

if (require.main === module) {
  try { process.exit(main()); }
  catch (e) { process.stderr.write(`custom-sensors: ${e.message}\n`); process.exit(2); }
}

module.exports = { loadCustomSensors, runOne, runAll, main, SCHEMA_PATH };
