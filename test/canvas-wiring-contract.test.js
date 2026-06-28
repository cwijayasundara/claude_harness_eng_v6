'use strict';

// Locks the G4 wiring: /design emits + gates the REASONS Canvas, the drift
// monitor reads its Governs list, the shipped template is itself valid, and the
// manifest registers the Canvas guide + its two sensors.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const canvas = require(path.join(ROOT, '.claude/hooks/lib/canvas.js'));

test('/design emits the Canvas and runs the structure gate', () => {
  const skill = read('.claude/skills/design/SKILL.md');
  assert.match(skill, /reasons-canvas\.md/, '/design must emit the Canvas');
  assert.match(skill, /validate-canvas\.js/, '/design Step 1.9 must run the structure gate');
  assert.match(skill, /fix the prompt first/i, 'the living-artifact discipline must be documented');
});

test('the shipped Canvas template is itself valid', () => {
  const tmpl = read('.claude/skills/design/references/reasons-canvas-template.md');
  const { errors, governs } = canvas.validateCanvas(tmpl);
  assert.deepStrictEqual(errors, [], `template should validate, got: ${errors.join('; ')}`);
  assert.ok(governs.length >= 1, 'template must demonstrate a non-empty Governs list');
});

test('validate-canvas CLI reuses the lib and is require-safe', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/validate-canvas.js')));
  const cli = read('.claude/scripts/validate-canvas.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/canvas'\)/, 'CLI must use the tested lib');
});

test('drift monitor reads the Canvas Governs list for design-vs-code drift', () => {
  const cli = read('.claude/scripts/drift-report.js');
  assert.match(cli, /hooks\/lib\/canvas/, 'drift-report must use the canvas lib');
  assert.match(cli, /withCanvasDrift/, 'drift-report must thread canvas drift into the snapshot');
});

test('manifest registers the Canvas guide and its two sensors as active', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const guide = m.guides.find((g) => g.id === 'reasons-canvas');
  assert.strictEqual(guide.status, 'active');
  assert.ok(!('gap_ref' in guide), 'no longer a gap');
  const ids = m.sensors.filter((s) => ['canvas-structure', 'drift-design-code'].includes(s.id)).map((s) => s.id).sort();
  assert.deepStrictEqual(ids, ['canvas-structure', 'drift-design-code']);
});
