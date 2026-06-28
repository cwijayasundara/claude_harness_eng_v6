'use strict';

// Locks the G5 wiring: verify-on-save enriches its lint/type block messages with
// per-rule self-correction guidance, so the inner-loop sensors coach the agent
// rather than just saying "fix the errors".

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('verify-on-save imports and applies the guidance enricher', () => {
  const src = read('.claude/hooks/verify-on-save.js');
  assert.match(src, /require\('\.\/lib\/sensor-guidance'\)/, 'must import sensor-guidance');
  const enrichCalls = (src.match(/enrich\(output\(res\)\)/g) || []).length;
  assert.ok(enrichCalls >= 3, `expected enrich on lint+type blocks, found ${enrichCalls}`);
});

test('the guidance lib is require-safe and covers high-signal rules', () => {
  const { GUIDANCE, enrich } = require(path.join(ROOT, '.claude/hooks/lib/sensor-guidance.js'));
  for (const rule of ['F401', 'E501', '@typescript-eslint/no-explicit-any', 'complexity']) {
    assert.ok(rule in GUIDANCE, `missing guidance for ${rule}`);
  }
  assert.strictEqual(enrich('nothing here'), '', 'no false guidance on clean output');
});
