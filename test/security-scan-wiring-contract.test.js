'use strict';

// Locks the G3 wiring so a security control can't be silently un-wired: the
// pre-commit hook must run the baseline secrets sensor, and /gate must invoke
// the computational scan under the security-boundary trigger.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('pre-commit hook wires the baseline secrets sensor', () => {
  // PR3 moved dispatch from the pre-commit script itself into gate-registry.js's
  // declarative GATE_CATALOG — assert against the real catalog, not prose.
  // "Must run before the docs-only early exit" is now expressed as runsWithoutSource: true
  // (Phase A of runPreCommit runs these gates unconditionally, before the source-only exit).
  const { GATE_CATALOG } = require('../.claude/hooks/lib/gate-registry.js');
  const early = require('../.claude/hooks/lib/gates-early.js');
  const entry = GATE_CATALOG.find((g) => g.id === 'secret-scan');
  assert.ok(entry, 'GATE_CATALOG must register secret-scan');
  assert.strictEqual(entry.run, early.checkSecrets, 'must dispatch to the real gate function, not a copy');
  assert.strictEqual(entry.runsWithoutSource, true, 'must run before the docs-only early exit (secrets hide in config/yaml)');

  const src = read('.claude/hooks/lib/gates-early.js');
  assert.match(src, /baselineSecretFindings/, 'must import the baseline secrets scanner');
});

test('/gate invokes the computational security scan under the boundary trigger', () => {
  const skill = read('.claude/skills/gate/SKILL.md');
  assert.match(skill, /security-scan\.js/, '/gate must reference the security-scan CLI');
  assert.match(skill, /--all --staged --boundary-only/, '/gate must run the boundary-gated scan');
});

test('security-scan CLI and lib are present and required correctly', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/security-scan.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/security-scan.js')));
  const cli = read('.claude/scripts/security-scan.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/security-scan'\)/, 'CLI must reuse the tested lib');
});

test('pre-commit hook wires the amendment-provenance gate before the source-only early exit', () => {
  // PR3 moved dispatch from the pre-commit script itself into gate-registry.js's
  // declarative GATE_CATALOG — assert against the real catalog, not prose.
  // "Before the source-only early exit" is now runsWithoutSource: true; "after checkSecrets"
  // (design docs are markdown/json, not SOURCE_EXTS, but secrets must be scanned first) is
  // now the relative `order` of the two catalog entries.
  const { GATE_CATALOG } = require('../.claude/hooks/lib/gate-registry.js');
  const early = require('../.claude/hooks/lib/gates-early.js');
  const secretEntry = GATE_CATALOG.find((g) => g.id === 'secret-scan');
  const amendEntry = GATE_CATALOG.find((g) => g.id === 'amendment-provenance');
  assert.ok(amendEntry, 'GATE_CATALOG must register amendment-provenance');
  assert.strictEqual(amendEntry.run, early.checkAmendmentProvenance, 'must dispatch to the real gate function, not a copy');
  assert.strictEqual(amendEntry.runsWithoutSource, true, 'must run before the source-only early exit');
  assert.ok(amendEntry.order > secretEntry.order, 'must run after the secret scan (relative order preserved)');
});
