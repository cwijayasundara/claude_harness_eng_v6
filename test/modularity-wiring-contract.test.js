'use strict';

// Locks the G6 wiring: the deterministic pack CLI reuses the tested lib, the
// inferential reviewer agent exists and writes a verdict, /brownfield --full runs
// both, and the manifest registers the two-part sensor.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('modularity-pack CLI reuses the lib and is require-safe', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/scripts/modularity-pack.js')));
  assert.ok(fs.existsSync(path.join(ROOT, '.claude/hooks/lib/modularity-pack.js')));
  const cli = read('.claude/scripts/modularity-pack.js');
  assert.match(cli, /require\('\.\.\/hooks\/lib\/modularity-pack'\)/, 'CLI must use the tested lib');
});

test('the modularity-reviewer agent exists with frontmatter and a verdict', () => {
  const agent = read('.claude/agents/modularity-reviewer.md');
  assert.match(agent, /^name:\s*modularity-reviewer/m);
  assert.match(agent, /^model:\s*claude-/m);
  assert.match(agent, /modularity-pack/, 'must be grounded in the pack');
  assert.match(agent, /modularity-verdict\.json/, 'must write a verdict');
});

test('/brownfield --full runs the pack and the reviewer', () => {
  const skill = read('.claude/skills/brownfield/SKILL.md');
  assert.match(skill, /modularity-pack\.js/, '--full must build the grounding pack');
  assert.match(skill, /modularity-reviewer/, '--full must spawn the inferential reviewer');
});

test('manifest registers the two-part modularity sensor as active', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const pack = m.sensors.find((s) => s.id === 'modularity-pack');
  const review = m.sensors.find((s) => s.id === 'modularity-review');
  assert.strictEqual(pack.status, 'active');
  assert.strictEqual(pack.type, 'computational');
  assert.strictEqual(review.status, 'active');
  assert.strictEqual(review.type, 'inferential');
  assert.ok(!('gap_ref' in review), 'no longer a gap');
});

test('modularity-reviewer.md documents an output-path override for scoped callers', () => {
  const agent = read('.claude/agents/modularity-reviewer.md');
  assert.match(
    agent,
    /explicit output paths.*instead of the defaults/is,
    'agent must document that a scoped caller (e.g. design --delta Step D3.5) can override the default output paths'
  );
});

test('design --delta Step D3.5 scopes the modularity pre-check to the amendment', () => {
  const skill = read('.claude/skills/design/SKILL.md');
  const deltaSection = skill.slice(skill.indexOf('## Delta Mode'), skill.indexOf('## Baseline Recovery Mode'));
  assert.match(deltaSection, /Step D3\.5/, 'must add a Step D3.5');
  assert.match(deltaSection, /modularity-pack\.js/, 'must refresh the pack');
  assert.match(deltaSection, /modularity-reviewer/, 'must spawn the scoped reviewer');
  assert.match(deltaSection, /skipped-no-graph/, 'must document the no-graph skip marker');
  assert.match(deltaSection, /inconclusive/, 'must document the malformed-verdict marker');
});

test('GATE 2 (Step D7) displays the duplication pre-check result', () => {
  const skill = read('.claude/skills/design/SKILL.md');
  const deltaSection = skill.slice(skill.indexOf('## Delta Mode'), skill.indexOf('## Baseline Recovery Mode'));
  const d7Section = deltaSection.slice(deltaSection.indexOf('### Step D7'));
  assert.match(d7Section, /duplication pre-check/i, 'GATE 2 display list must include the duplication pre-check result');
});

test('manifest description mentions the design-delta invocation site', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const review = m.sensors.find((s) => s.id === 'modularity-review');
  assert.match(review.description, /design --delta/, 'description must mention the new call site');
  assert.strictEqual(review.status, 'active');
  assert.strictEqual(review.type, 'inferential');
});

test('HARNESS.md G6 line mentions the design-delta invocation site', () => {
  const doc = read('HARNESS.md');
  assert.match(doc, /G6 \(P1\)[\s\S]*?design --delta/, 'G6 done-line must mention the new invocation site');
});
