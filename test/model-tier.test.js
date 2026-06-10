'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'model-tier.js');
const { modelsForTier, sessionFor, applyTier, PRESETS } = require(SCRIPT);

const FABLE = 'claude-fable-5';
const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-4-6';
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

test('pins are exact model IDs, never bare aliases', () => {
  const valid = new Set([FABLE, OPUS, SONNET]);
  for (const preset of Object.keys(PRESETS)) {
    for (const [role, model] of Object.entries(modelsForTier(preset))) {
      assert.ok(valid.has(model), `${preset}/${role} = "${model}" must be an exact model id`);
    }
  }
});

test('cost (Profile A): zero Fable — Sonnet generation, Opus judgment', () => {
  const m = modelsForTier('cost');
  assert.strictEqual(m.generator, SONNET);
  assert.strictEqual(m['codebase-explorer'], SONNET);
  assert.strictEqual(m.planner, OPUS);
  assert.strictEqual(m.evaluator, OPUS);
  assert.ok(!Object.values(m).includes(FABLE), 'cost preset must use no Fable 5');
});

test('balanced (Profile B): Fable only on the planner; generation + gate stay cheap', () => {
  const m = modelsForTier('balanced');
  assert.strictEqual(m.planner, FABLE); // high-leverage, low-volume, cascade-preventing
  assert.strictEqual(m.generator, SONNET); // volume bucket stays cheapest capable tier
  assert.strictEqual(m.evaluator, OPUS); // gate precision, not 2x recall
  assert.strictEqual(m['codebase-explorer'], SONNET);
});

test('max-quality: Fable on judgment roles, generator bumped to Opus (never Fable on volume)', () => {
  const m = modelsForTier('max-quality');
  assert.strictEqual(m.planner, FABLE);
  assert.strictEqual(m.evaluator, FABLE);
  assert.strictEqual(m['design-critic'], FABLE);
  assert.strictEqual(m.generator, OPUS); // not Fable — volume cost guard
});

test('HARD INVARIANT: security-reviewer is never Fable in any preset (cyber-classifier refusal risk)', () => {
  for (const preset of Object.keys(PRESETS)) {
    assert.notStrictEqual(modelsForTier(preset)['security-reviewer'], FABLE,
      `security-reviewer must never be Fable 5 (preset ${preset})`);
  }
});

test('unknown preset throws', () => {
  assert.throws(() => modelsForTier('cheapest'), /unknown.*tier|preset/i);
});

test('session model guidance escalates with tier', () => {
  assert.strictEqual(sessionFor('cost'), OPUS);
  assert.strictEqual(sessionFor('balanced'), OPUS); // Fable only for long unattended /auto (operator's call)
  assert.strictEqual(sessionFor('max-quality'), FABLE);
});

// --- applyTier: stamps the model: frontmatter line in each agent file ----------

function fakeAgent(dir, role, model) {
  const p = path.join(dir, `${role}.md`);
  fs.writeFileSync(p, `---\nname: ${role}\nmodel: ${model}\ndescription: test\n---\n\nBody.\n`);
  return p;
}

test('applyTier rewrites each agent model: line to the exact id for the preset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  for (const role of ROLES) fakeAgent(dir, role, OPUS);
  const changed = applyTier(dir, 'balanced');
  assert.match(fs.readFileSync(path.join(dir, 'planner.md'), 'utf8'), /^model: claude-fable-5$/m);
  assert.match(fs.readFileSync(path.join(dir, 'generator.md'), 'utf8'), /^model: claude-sonnet-4-6$/m);
  assert.ok(changed.includes('planner'));
  assert.ok(changed.includes('generator'));
  assert.ok(!changed.includes('evaluator')); // already OPUS, unchanged
});

test('applyTier preserves the rest of the frontmatter and body', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  fakeAgent(dir, 'planner', OPUS);
  applyTier(dir, 'cost');
  const txt = fs.readFileSync(path.join(dir, 'planner.md'), 'utf8');
  assert.match(txt, /^name: planner$/m);
  assert.match(txt, /^description: test$/m);
  assert.match(txt, /Body\./);
  assert.match(txt, /^model: claude-opus-4-8$/m);
});

// --- the repo's own agents must carry exact ids matching the default tier ------

test('repo agents are stamped with exact model ids (default tier = balanced)', () => {
  const dir = path.join(__dirname, '..', '.claude', 'agents');
  const expected = modelsForTier('balanced');
  const valid = new Set([FABLE, OPUS, SONNET]);
  for (const role of ROLES) {
    const txt = fs.readFileSync(path.join(dir, `${role}.md`), 'utf8');
    const m = txt.match(/^model: (.+)$/m);
    assert.ok(m, `${role}.md must declare a model`);
    assert.ok(valid.has(m[1]), `${role}.md model "${m[1]}" must be an exact id`);
    assert.strictEqual(m[1], expected[role], `${role}.md should match the balanced preset`);
  }
});
