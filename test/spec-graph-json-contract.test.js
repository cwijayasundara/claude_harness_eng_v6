'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const SPEC_SKILL = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'skills', 'spec', 'SKILL.md'), 'utf8',
);

test('/spec documents the machine-readable dependency-graph.json', () => {
  assert.ok(SPEC_SKILL.includes('dependency-graph.json'), 'SKILL.md must instruct writing dependency-graph.json');
  assert.ok(/blockedBy/.test(SPEC_SKILL), 'SKILL.md must document the blockedBy field');
});

test('the dependency-graph.json fixture matches the wave-plan schema', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'e2e', 'fixtures', 'stories', 'dependency-graph.json'), 'utf8',
  ));
  assert.ok(Array.isArray(graph.groups));
  for (const grp of graph.groups) {
    assert.strictEqual(typeof grp.id, 'string');
    assert.ok(Array.isArray(grp.stories));
    assert.ok(Array.isArray(grp.blockedBy));
  }
});

test('the json fixture covers the same groups as the md fixture', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'e2e', 'fixtures', 'stories', 'dependency-graph.json'), 'utf8',
  ));
  assert.deepStrictEqual(graph.groups.map((g) => g.id).sort(), ['A', 'B']);
});
