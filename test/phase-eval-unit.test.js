const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

// ── 1. Rubrics validation ───────────────────────────────────────────────────

const rubrics = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude', 'templates', 'phase-eval-rubrics.json'), 'utf8')
);

test('phase-eval-rubrics.json is valid JSON', () => {
  assert.ok(rubrics, 'rubrics parsed without error');
  assert.strictEqual(typeof rubrics, 'object');
});

test('rubrics contains exactly 6 phases', () => {
  const phases = Object.keys(rubrics.phases);
  assert.deepStrictEqual(phases.sort(), ['brd', 'brownfield', 'deploy', 'design', 'seam', 'spec']);
});

test('each phase has exactly 5 criteria', () => {
  const expectedCriteria = ['actionability', 'completeness', 'consistency', 'specificity', 'traceability'];
  for (const [phase, config] of Object.entries(rubrics.phases)) {
    const criteria = Object.keys(config.criteria).sort();
    assert.deepStrictEqual(criteria, expectedCriteria, `phase "${phase}" has wrong criteria`);
  }
});

test('global threshold is 7.0 and per_criterion_minimum is 5', () => {
  assert.strictEqual(rubrics.threshold, 7.0);
  assert.strictEqual(rubrics.per_criterion_minimum, 5);
});

// ── 2. Result schema validation ─────────────────────────────────────────────

const resultSchema = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude', 'templates', 'phase-eval-result.schema.json'), 'utf8')
);

test('phase-eval-result.schema.json is valid JSON', () => {
  assert.ok(resultSchema, 'schema parsed without error');
  assert.strictEqual(typeof resultSchema, 'object');
});

test('result schema has required fields', () => {
  const required = resultSchema.required;
  const expectedRequired = [
    'phase', 'iteration', 'timestamp', 'scores', 'weighted_average',
    'threshold', 'per_criterion_minimum', 'verdict', 'failing_criteria',
    'findings', 'traceability_report', 'score_history',
  ];
  for (const field of expectedRequired) {
    assert.ok(required.includes(field), `missing required field: ${field}`);
  }
});

test('phase enum contains exactly 6 values', () => {
  const phaseEnum = resultSchema.properties.phase.enum;
  assert.deepStrictEqual(phaseEnum.sort(), ['brd', 'brownfield', 'deploy', 'design', 'seam', 'spec']);
});

// ── 3. Phase evaluator agent definition ─────────────────────────────────────

const agentPath = path.join(ROOT, '.claude', 'agents', 'phase-evaluator.md');
const agentContent = fs.readFileSync(agentPath, 'utf8');

test('phase-evaluator.md exists and is non-empty', () => {
  assert.ok(fs.existsSync(agentPath));
  assert.ok(agentContent.length > 0, 'agent file is empty');
});

test('phase-evaluator.md contains frontmatter with model: opus', () => {
  assert.match(agentContent, /^---\n[\s\S]*?model:\s*opus[\s\S]*?\n---/);
});

test('phase-evaluator.md contains all 6 phase-specific guidance sections', () => {
  const phases = ['BRD', 'Spec', 'Design', 'Brownfield', 'Seam-Finder', 'Deploy'];
  for (const phase of phases) {
    assert.match(agentContent, new RegExp(`\\*\\*${phase}\\*\\*`), `missing guidance for ${phase}`);
  }
});

// ── 4. Hook limit values ────────────────────────────────────────────────────

const enforceLengthPre = fs.readFileSync(
  path.join(ROOT, '.claude', 'hooks', 'enforce-length-pre.js'), 'utf8'
);
const checkFunctionLength = fs.readFileSync(
  path.join(ROOT, '.claude', 'hooks', 'check-function-length.js'), 'utf8'
);
const settingsJson = fs.readFileSync(
  path.join(ROOT, '.claude', 'settings.json'), 'utf8'
);

test('enforce-length-pre.js contains HARD_LIMIT = 500', () => {
  assert.match(enforceLengthPre, /HARD_LIMIT\s*=\s*500/);
});

test('check-function-length.js contains HARD_LIMIT = 30', () => {
  assert.match(checkFunctionLength, /HARD_LIMIT\s*=\s*30/);
});

test('check-function-length.js contains WARN_LINES = 25', () => {
  assert.match(checkFunctionLength, /WARN_LINES\s*=\s*25/);
});

test('check-file-length.js is NOT in settings.json PostToolUse hooks', () => {
  assert.doesNotMatch(settingsJson, /check-file-length\.js/);
});

// ── 5. Settings.json consistency — removed hooks ────────────────────────────

test('lint-on-save.js is NOT in PostToolUse hooks', () => {
  const settings = JSON.parse(settingsJson);
  const postToolUseHooks = settings.hooks.PostToolUse || [];
  const allCommands = postToolUseHooks.flatMap((entry) =>
    (entry.hooks || []).map((h) => h.command || '')
  );
  assert.ok(
    !allCommands.some((cmd) => cmd.includes('lint-on-save.js')),
    'lint-on-save.js should not be in PostToolUse hooks'
  );
});

test('typecheck.js is NOT in PostToolUse hooks', () => {
  const settings = JSON.parse(settingsJson);
  const postToolUseHooks = settings.hooks.PostToolUse || [];
  const allCommands = postToolUseHooks.flatMap((entry) =>
    (entry.hooks || []).map((h) => h.command || '')
  );
  assert.ok(
    !allCommands.some((cmd) => cmd.includes('typecheck.js')),
    'typecheck.js should not be in PostToolUse hooks'
  );
});

test('track-writes.js is NOT in PostToolUse hooks', () => {
  const settings = JSON.parse(settingsJson);
  const postToolUseHooks = settings.hooks.PostToolUse || [];
  const allCommands = postToolUseHooks.flatMap((entry) =>
    (entry.hooks || []).map((h) => h.command || '')
  );
  assert.ok(
    !allCommands.some((cmd) => cmd.includes('track-writes.js')),
    'track-writes.js should not be in PostToolUse hooks'
  );
});

test('require-review.js is NOT in Stop hooks', () => {
  const settings = JSON.parse(settingsJson);
  const stopHooks = settings.hooks.Stop || [];
  const allCommands = stopHooks.flatMap((entry) =>
    (entry.hooks || []).map((h) => h.command || '')
  );
  assert.ok(
    !allCommands.some((cmd) => cmd.includes('require-review.js')),
    'require-review.js should not be in Stop hooks'
  );
});

// ── 6. Telemetry phase eval module ──────────────────────────────────────────

const phaseEvalScriptPath = path.join(ROOT, '.claude', 'scripts', 'telemetry-phase-eval.js');

test('telemetry-phase-eval.js exists', () => {
  assert.ok(fs.existsSync(phaseEvalScriptPath));
});

test('telemetry-phase-eval.js exports processPhaseEval', () => {
  const content = fs.readFileSync(phaseEvalScriptPath, 'utf8');
  assert.match(content, /processPhaseEval/);
  assert.match(content, /harness_phase_eval_score/);
});

test('telemetry-memory.js requires phase eval module', () => {
  const memoryContent = fs.readFileSync(
    path.join(ROOT, '.claude', 'scripts', 'telemetry-memory.js'), 'utf8'
  );
  assert.match(memoryContent, /require\(.*telemetry-phase-eval.*\)/);
});

// ── 7. Skill modifications — phase-evaluator references ─────────────────────

const skillNames = ['brd', 'spec', 'design', 'brownfield', 'seam-finder', 'deploy'];

for (const skill of skillNames) {
  test(`${skill}/SKILL.md contains phase-evaluator reference`, () => {
    const content = fs.readFileSync(
      path.join(ROOT, '.claude', 'skills', skill, 'SKILL.md'), 'utf8'
    );
    assert.match(content, /phase-evaluator/);
  });
}

for (const skill of skillNames) {
  test(`${skill}/SKILL.md contains Phase Evaluation Gate or Ratchet text`, () => {
    const content = fs.readFileSync(
      path.join(ROOT, '.claude', 'skills', skill, 'SKILL.md'), 'utf8'
    );
    assert.ok(
      /Phase Evaluation Gate/i.test(content) || /Ratchet/i.test(content),
      `${skill}/SKILL.md should reference Phase Evaluation Gate or Ratchet`
    );
  });
}

// ── 8. Cross-phase traceability references ──────────────────────────────────

test('spec/SKILL.md references specs/brd/brd.md as upstream', () => {
  const content = fs.readFileSync(
    path.join(ROOT, '.claude', 'skills', 'spec', 'SKILL.md'), 'utf8'
  );
  assert.match(content, /specs\/brd\/brd\.md/);
});

test('design/SKILL.md references specs/stories/ as upstream', () => {
  const content = fs.readFileSync(
    path.join(ROOT, '.claude', 'skills', 'design', 'SKILL.md'), 'utf8'
  );
  assert.match(content, /specs\/stories\//);
});

test('brownfield/SKILL.md references actual codebase or verify against for upstream validation', () => {
  const content = fs.readFileSync(
    path.join(ROOT, '.claude', 'skills', 'brownfield', 'SKILL.md'), 'utf8'
  );
  assert.ok(
    /actual codebase/i.test(content) || /verify against/i.test(content),
    'brownfield/SKILL.md should reference actual codebase or verify against'
  );
});
