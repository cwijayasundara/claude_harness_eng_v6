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
  // Enrichment is centralized in emit(); the invariant is that emit enriches the
  // message AND that all three lint/type failure branches (ruff, mypy, eslint)
  // route their block/advisory message through emit().
  assert.match(src, /enrich\(output\(res\)\)/, 'emit() must enrich the reported message');
  const emitCalls = (src.match(/emit\('(?:lint|type) errors'/g) || []).length;
  assert.ok(emitCalls >= 3, `expected all 3 lint/type blocks to route through emit(), found ${emitCalls}`);
});

test('the guidance lib is require-safe and covers high-signal rules', () => {
  const { GUIDANCE, enrich } = require(path.join(ROOT, '.claude/hooks/lib/sensor-guidance.js'));
  for (const rule of ['F401', 'E501', '@typescript-eslint/no-explicit-any', 'complexity']) {
    assert.ok(rule in GUIDANCE, `missing guidance for ${rule}`);
  }
  assert.strictEqual(enrich('nothing here'), '', 'no false guidance on clean output');
});
