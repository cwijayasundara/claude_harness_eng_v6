'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run: runApproval } = require('../.claude/scripts/plan-approval.js');
const { run, readSeal } = require('../.claude/scripts/plan-seal.js');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-seal-'));
  fs.mkdirSync(path.join(root, 'specs', 'brd'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'stories'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'design'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'reviews'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'brd', 'brd.md'), '# BRD\n');
  fs.writeFileSync(path.join(root, 'specs', 'stories', 'epics.md'), '# Epics\n');
  fs.writeFileSync(path.join(root, 'specs', 'design', 'component-map.md'), '# Map\n');
  fs.writeFileSync(path.join(root, 'features.json'), '[]\n');
  return root;
}

function approve(root, phase, artifact) {
  return runApproval(
    ['record', '--phase', phase, '--verdict', 'approved', '--artifact', artifact],
    root,
  );
}

function approvePlan(root) {
  assert.strictEqual(approve(root, 'brd', 'specs/brd/brd.md'), 0);
  assert.strictEqual(approve(root, 'spec', 'specs/stories/epics.md'), 0);
  assert.strictEqual(approve(root, 'design', 'specs/design/component-map.md'), 0);
}

test('check fails when no seal exists', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['check'], root), 1);
});

test('write refuses when plan-approval has not closed', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['write'], root), 1);
  assert.strictEqual(readSeal(root), null);
});

test('write after approvals produces a human seal that check accepts', () => {
  const root = tmpRoot();
  approvePlan(root);
  assert.strictEqual(run(['write'], root), 0);
  const seal = readSeal(root);
  assert.strictEqual(seal.status, 'sealed');
  assert.strictEqual(seal.waived_by, null);
  assert.ok(seal.artifacts.some((a) => a.path === 'specs/stories/epics.md'));
  assert.ok(seal.artifacts.some((a) => a.path === 'features.json'));
  assert.strictEqual(run(['check'], root), 0);
  assert.strictEqual(run(['check', '--require-human'], root), 0);
});

test('an edited sealed artifact voids the seal', () => {
  const root = tmpRoot();
  approvePlan(root);
  assert.strictEqual(run(['write'], root), 0);
  fs.writeFileSync(path.join(root, 'specs', 'stories', 'epics.md'), '# Epics changed\n');
  assert.strictEqual(run(['check'], root), 1);
});

test('headless --auto may write a waived seal', () => {
  const root = tmpRoot();
  assert.strictEqual(runApproval(['waive', '--phase', 'brd', '--lane', '--auto'], root), 0);
  assert.strictEqual(runApproval(['waive', '--phase', 'spec', '--lane', '--auto'], root), 0);
  assert.strictEqual(runApproval(['waive', '--phase', 'design', '--lane', '--auto'], root), 0);
  assert.strictEqual(run(['write', '--lane', '--auto'], root), 0);
  const seal = readSeal(root);
  assert.strictEqual(seal.status, 'waived');
  assert.strictEqual(seal.waived_by, '--auto');
  assert.strictEqual(run(['check'], root), 0);
  assert.strictEqual(run(['check', '--require-human'], root), 1);
});

test('unknown --lane is usage', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['write', '--lane', '--lite'], root), 2);
});

test('evaluator live fields on features.json do not void the seal', () => {
  const root = tmpRoot();
  approvePlan(root);
  fs.writeFileSync(path.join(root, 'features.json'), `${JSON.stringify([{
    id: 'F001', story: 'E1-S1', description: 'register', steps: ['POST /register'],
    passes: false, last_evaluated: null, failure_reason: null, failure_layer: null,
  }], null, 2)}\n`);
  assert.strictEqual(run(['write'], root), 0);
  fs.writeFileSync(path.join(root, 'features.json'), `${JSON.stringify([{
    id: 'F001', story: 'E1-S1', description: 'register', steps: ['POST /register'],
    passes: true, last_evaluated: '2026-08-15T12:00:00.000Z',
    failure_reason: null, failure_layer: null,
  }], null, 2)}\n`);
  assert.strictEqual(run(['check'], root), 0);
});

test('changing a features.json identity field voids the seal', () => {
  const root = tmpRoot();
  approvePlan(root);
  fs.writeFileSync(path.join(root, 'features.json'), `${JSON.stringify([{
    id: 'F001', story: 'E1-S1', description: 'register', steps: ['POST /register'],
    passes: false, last_evaluated: null, failure_reason: null, failure_layer: null,
  }], null, 2)}\n`);
  assert.strictEqual(run(['write'], root), 0);
  fs.writeFileSync(path.join(root, 'features.json'), `${JSON.stringify([{
    id: 'F001', story: 'E1-S1', description: 'login instead', steps: ['POST /register'],
    passes: false, last_evaluated: null, failure_reason: null, failure_layer: null,
  }], null, 2)}\n`);
  assert.strictEqual(run(['check'], root), 1);
});
