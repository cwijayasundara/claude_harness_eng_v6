'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'model-tier.js');
const { modelsForTier, sessionFor, applyTier, PRESETS } = require(SCRIPT);

const OPUS = 'claude-opus-4-8';
const SONNET5 = 'claude-sonnet-5';
const ROLES = [
  'planner',
  'generator',
  'evaluator',
  'design-critic',
  'security-reviewer',
  'code-reviewer',
  'codebase-explorer',
];

test('three presets exist: cost, balanced, max-quality', () => {
  assert.deepStrictEqual(Object.keys(PRESETS).sort(), ['balanced', 'cost', 'max-quality']);
});

test('every preset assigns a model to all seven agent roles', () => {
  for (const preset of Object.keys(PRESETS)) {
    const m = modelsForTier(preset);
    assert.deepStrictEqual(Object.keys(m).sort(), ROLES.slice().sort(), `preset ${preset}`);
  }
});

test('pins are exact model IDs, never bare aliases', () => {
  const valid = new Set([OPUS, SONNET5]);
  for (const preset of Object.keys(PRESETS)) {
    for (const [role, model] of Object.entries(modelsForTier(preset))) {
      assert.ok(valid.has(model), `${preset}/${role} = "${model}" must be an exact model id`);
    }
  }
});

test('cost (Profile A): Sonnet 5 generation, Opus 4.8 judgment', () => {
  const m = modelsForTier('cost');
  assert.strictEqual(m.generator, SONNET5);
  assert.strictEqual(m['codebase-explorer'], SONNET5);
  assert.strictEqual(m.planner, OPUS);
  assert.strictEqual(m.evaluator, OPUS);
});

test('balanced (Profile B, default): Sonnet 5 generation, Opus 4.8 judgment', () => {
  const m = modelsForTier('balanced');
  assert.strictEqual(m.generator, SONNET5);
  assert.strictEqual(m.evaluator, OPUS);
  assert.strictEqual(m.planner, OPUS);
  // Opus 4.7 is retired; Sonnet 5 now covers what it used to, so cost and
  // balanced share the same generator pin — both a real step below max-quality.
  assert.strictEqual(m.generator, modelsForTier('cost').generator);
  assert.notStrictEqual(m.generator, modelsForTier('max-quality').generator);
});

test('max-quality: Opus 4.8 across the board; only codebase-explorer stays Sonnet', () => {
  const m = modelsForTier('max-quality');
  assert.strictEqual(m.planner, OPUS);
  assert.strictEqual(m.generator, OPUS); // generation bumped to the top tier
  assert.strictEqual(m.evaluator, OPUS);
  assert.strictEqual(m['design-critic'], OPUS);
  assert.strictEqual(m['code-reviewer'], OPUS);
  assert.strictEqual(m['security-reviewer'], OPUS);
  assert.strictEqual(m['codebase-explorer'], SONNET5);
});

test('unknown preset throws', () => {
  assert.throws(() => modelsForTier('cheapest'), /unknown.*tier|preset/i);
});

test('session model guidance is Opus 4.8 in every tier', () => {
  assert.strictEqual(sessionFor('cost'), OPUS);
  assert.strictEqual(sessionFor('balanced'), OPUS);
  assert.strictEqual(sessionFor('max-quality'), OPUS);
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
  assert.match(fs.readFileSync(path.join(dir, 'planner.md'), 'utf8'), /^model: claude-opus-4-8$/m);
  assert.match(fs.readFileSync(path.join(dir, 'generator.md'), 'utf8'), /^model: claude-sonnet-5$/m);
  assert.ok(changed.includes('generator')); // OPUS 4.8 -> Sonnet 5
  assert.ok(changed.includes('codebase-explorer')); // OPUS -> Sonnet 5
  assert.ok(!changed.includes('planner')); // already OPUS, unchanged
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
  const valid = new Set([OPUS, SONNET5]);
  for (const role of ROLES) {
    const txt = fs.readFileSync(path.join(dir, `${role}.md`), 'utf8');
    const m = txt.match(/^model: (.+)$/m);
    assert.ok(m, `${role}.md must declare a model`);
    assert.ok(valid.has(m[1]), `${role}.md model "${m[1]}" must be an exact id`);
    assert.strictEqual(m[1], expected[role], `${role}.md should match the balanced preset`);
  }
});
