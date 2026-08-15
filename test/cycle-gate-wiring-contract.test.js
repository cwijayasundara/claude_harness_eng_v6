'use strict';

// Locks the G8 cycle-fail wiring.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('cycle-gate CLI reuses the lib and is require-safe', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/cycle-gate.js')));
  const cli = read('.claude/scripts/cycle-gate.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/cycle-gate'\)/, 'CLI must use the tested lib');
});

test('package.json exposes the cycles script; /auto names it as strict-only', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts.cycles, 'node .claude/scripts/cycle-gate.js');
  const auto = readSkillCorpus('auto');
  assert.match(auto, /cycle-gate\.js/, 'the corpus must still name the cycle script');
  assert.match(auto, /run-gate-checks\.js/, 'SECTION 5 must name the one runner');
  assert.match(auto, /strict/, 'cycle must not be required on standard');
});

test('manifest marks cycle-detection active and enforced', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'cycle-detection');
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.wired_at, '.claude/scripts/cycle-gate.js');
  assert.ok(!('gap_ref' in s), 'no longer a gap');
});
