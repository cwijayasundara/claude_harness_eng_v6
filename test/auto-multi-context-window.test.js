'use strict';

// Contract for the Anthropic long-running-agent multi-context-window principles
// (gaps G13–G14): /auto SECTION 2 must do a *different* preflight on the first
// context window than on continuation windows, and must run a startup smoke
// check before building on a fresh-process resume. Both controls are registered
// in harness-manifest.json so the registry stays honest.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AUTO_CORPUS = () => readSkillCorpus('auto');
test('G13: /auto SECTION 2 distinguishes the first context window from continuation windows', () => {
  const auto = AUTO_CORPUS();
  const section2 = auto.slice(auto.indexOf('## SECTION 2'), auto.indexOf('## SECTION 3'));
  assert.ok(/first context window|First window/i.test(section2),
    'SECTION 2 must branch on first-window vs continuation');
  assert.ok(/Continuation window/i.test(section2),
    'SECTION 2 must name the continuation-window path');
  // First window verifies the initializer left a coherent project before building.
  assert.ok(/features\.json/.test(section2) && /init\.sh/.test(section2),
    'first-window preflight must verify features.json and init.sh');
});

test('G14: /auto SECTION 2 runs a startup smoke check before building on a resume', () => {
  const auto = AUTO_CORPUS();
  const section2 = auto.slice(auto.indexOf('## SECTION 2'), auto.indexOf('## SECTION 3'));
  assert.ok(/smoke check/i.test(section2), 'SECTION 2 must document a startup smoke check');
  assert.ok(/Health-Check Retry/.test(section2),
    'smoke check must reuse the evaluator Health-Check Retry loop');
  assert.ok(/failure_layer: "infrastructure"/.test(section2),
    'a failed smoke check must route as an infrastructure failure');
  // It must be a recovery-boundary check, not run on every in-process iteration.
  assert.ok(/in-process iteration/i.test(section2),
    'smoke check must be scoped to fresh-process resume, skipped on later in-process iterations');
});

test('G13/G14 controls are registered in harness-manifest.json', () => {
  const manifest = JSON.parse(read('harness-manifest.json'));
  const guide = manifest.guides.find((g) => g.id === 'first-window-init');
  assert.ok(guide, 'first-window-init guide must be registered (G13)');
  assert.strictEqual(guide.gap_ref, 'G13');
  assert.strictEqual(guide.status, 'active');
  assert.strictEqual(guide.wired_at, '.claude/skills/auto/SKILL.md');

  const sensor = manifest.sensors.find((s) => s.id === 'resume-smoke');
  assert.ok(sensor, 'resume-smoke sensor must be registered (G14)');
  assert.strictEqual(sensor.gap_ref, 'G14');
  assert.strictEqual(sensor.status, 'active');
  assert.strictEqual(sensor.wired_at, '.claude/skills/auto/SKILL.md');
});
