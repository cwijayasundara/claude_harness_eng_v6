'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeStoryGraph, parseGwt, heavyReason, categoryOf } = require('../.claude/scripts/spec-render-write');
const { fillSpecScope } = require('../.claude/scripts/fill-spec-scope');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-render-write-'));
}

function write(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

test('parseGwt splits a Given/When/Then sentence', () => {
  const g = parseGwt('Given a visitor, when they POST /register, then the response is 201');
  assert.strictEqual(g.given, 'a visitor');
  assert.strictEqual(g.when, 'they POST /register');
  assert.strictEqual(g.then, 'the response is 201');
});

test('heavyReason tags load and statistical ACs', () => {
  assert.strictEqual(heavyReason('p95 under 50ms at 100 rps'), 'load');
  assert.strictEqual(heavyReason('10,000 codes from a CSPRNG'), 'statistical');
  assert.strictEqual(heavyReason('response is 201'), null);
});

test('writeStoryGraph expands stories.json and marks characterization features', () => {
  const root = tmp();
  write(root, 'specs/decisions/spec-decisions.json', {
    milestone: { name: 'M1', epics: ['E1'], deferred_epics: ['E2'], requirements_in_scope: ['FR-1'] },
  });
  write(root, 'specs/stories/stories.json', [{
    id: 'E1-S1',
    title: 'Member can register',
    epic: 'E1',
    layer: 'API',
    story_points: 3,
    traces: ['FRD-1'],
    scope_in: ['POST /register'],
    scope_out: ['must not add SSO'],
    acceptance_criteria: [
      { id: 'E1-S1-AC1', given: 'a visitor', when: 'they POST /register', then: 'the response is 201' },
      { id: 'E1-S1-AC2', given: '10k links', when: 'driven at 100 rps for 60 seconds', then: 'p95 is under 50 ms' },
    ],
  }]);

  const result = writeStoryGraph(root);
  assert.strictEqual(result.stories, 1);
  assert.strictEqual(result.features, 2);
  assert.ok(fs.existsSync(path.join(root, 'specs/stories/E1-S1.md')));
  assert.ok(fs.existsSync(path.join(root, 'specs/stories/epics.md')));
  const features = JSON.parse(fs.readFileSync(path.join(root, 'features.json'), 'utf8'));
  assert.strictEqual(features[0].verification, 'default');
  assert.strictEqual(features[1].verification, 'characterization');
  assert.strictEqual(features[1].category, 'performance');
  const md = fs.readFileSync(path.join(root, 'specs/stories/E1-S1.md'), 'utf8');
  assert.match(md, /## Generation Contract/);
  assert.match(md, /E1-S1-AC1/);
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'specs/bundles/E1-S1.json'), 'utf8'));
  assert.strictEqual(bundle.story_id, 'E1-S1');
  assert.ok(bundle.requirements.ac_ids.includes('E1-S1-AC1'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('fillSpecScope copies milestone requirements when the decisions file omitted them', () => {
  const root = tmp();
  write(root, 'specs/decisions/spec-decisions.json', {
    milestone: { name: 'M1 — Redirect works.', epics: ['E1'] },
  });
  write(root, 'specs/brd/brd-milestones.json', [
    { id: 'M1', name: 'M1 — Redirect works.', requirements: ['FR-1', 'FR-2'] },
  ]);
  const result = fillSpecScope(root);
  assert.strictEqual(result.wrote, true);
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'specs/decisions/spec-decisions.json'), 'utf8'));
  assert.deepStrictEqual(doc.milestone.requirements_in_scope, ['FR-1', 'FR-2']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('categoryOf marks password ACs as security', () => {
  assert.strictEqual(categoryOf({ given: 'x', when: 'login', then: 'HTTP-only cookie is set' }), 'security');
});
