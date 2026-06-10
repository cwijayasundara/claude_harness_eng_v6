'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'model-tier.js');
const { modelsForTier, sessionFor, applyTier, PRESETS } = require(SCRIPT);

const ROLES = ['planner', 'generator', 'evaluator', 'design-critic', 'security-reviewer', 'codebase-explorer'];

test('three presets exist: cost, balanced, max-quality', () => {
  assert.deepStrictEqual(Object.keys(PRESETS).sort(), ['balanced', 'cost', 'max-quality']);
});

test('every preset assigns a model to all six agent roles', () => {
  for (const preset of Object.keys(PRESETS)) {
    const m = modelsForTier(preset);
    assert.deepStrictEqual(Object.keys(m).sort(), ROLES.slice().sort(), `preset ${preset}`);
  }
});

test('cost (Profile A): zero Fable — Sonnet generation, Opus judgment', () => {
  const m = modelsForTier('cost');
  assert.strictEqual(m.generator, 'sonnet');
  assert.strictEqual(m['codebase-explorer'], 'sonnet');
  assert.strictEqual(m.planner, 'opus');
  assert.strictEqual(m.evaluator, 'opus');
  assert.ok(!Object.values(m).includes('fable'), 'cost preset must use no Fable');
});

test('balanced (Profile B): Fable only on the planner; generation + gate stay cheap', () => {
  const m = modelsForTier('balanced');
  assert.strictEqual(m.planner, 'fable'); // high-leverage, low-volume, cascade-preventing
  assert.strictEqual(m.generator, 'sonnet'); // volume bucket stays cheapest capable tier
  assert.strictEqual(m.evaluator, 'opus'); // gate precision, not 2x recall
  assert.strictEqual(m['codebase-explorer'], 'sonnet');
});

test('max-quality: Fable on judgment roles, generator bumped to Opus (never Fable on volume)', () => {
  const m = modelsForTier('max-quality');
  assert.strictEqual(m.planner, 'fable');
  assert.strictEqual(m.evaluator, 'fable');
  assert.strictEqual(m['design-critic'], 'fable');
  assert.strictEqual(m.generator, 'opus'); // not fable — volume cost guard
});

test('HARD INVARIANT: security-reviewer is never Fable in any preset (cyber-classifier refusal risk)', () => {
  for (const preset of Object.keys(PRESETS)) {
    assert.notStrictEqual(modelsForTier(preset)['security-reviewer'], 'fable',
      `security-reviewer must never be fable (preset ${preset})`);
  }
});

test('unknown preset throws', () => {
  assert.throws(() => modelsForTier('cheapest'), /unknown.*tier|preset/i);
});

test('session model guidance escalates with tier; security note is constant', () => {
  assert.strictEqual(sessionFor('cost'), 'opus');
  assert.strictEqual(sessionFor('balanced'), 'opus'); // fable only for long unattended /auto (operator's call)
  assert.strictEqual(sessionFor('max-quality'), 'fable');
});

// --- applyTier: stamps the model: frontmatter line in each agent file ----------

function fakeAgent(dir, role, model) {
  const p = path.join(dir, `${role}.md`);
  fs.writeFileSync(p, `---\nname: ${role}\nmodel: ${model}\ndescription: test\n---\n\nBody.\n`);
  return p;
}

test('applyTier rewrites each agent model: line to match the preset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  for (const role of ROLES) fakeAgent(dir, role, 'opus');
  const changed = applyTier(dir, 'balanced');
  // planner flips opus -> fable; generator/explorer opus -> sonnet
  const planner = fs.readFileSync(path.join(dir, 'planner.md'), 'utf8');
  assert.match(planner, /^model: fable$/m);
  const gen = fs.readFileSync(path.join(dir, 'generator.md'), 'utf8');
  assert.match(gen, /^model: sonnet$/m);
  // returns the roles it changed
  assert.ok(changed.includes('planner'));
  assert.ok(!changed.includes('evaluator')); // already opus, unchanged
});

test('applyTier preserves the rest of the frontmatter and body', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  fakeAgent(dir, 'planner', 'opus');
  applyTier(dir, 'cost');
  const txt = fs.readFileSync(path.join(dir, 'planner.md'), 'utf8');
  assert.match(txt, /^name: planner$/m);
  assert.match(txt, /^description: test$/m);
  assert.match(txt, /Body\./);
  assert.match(txt, /^model: opus$/m);
});
