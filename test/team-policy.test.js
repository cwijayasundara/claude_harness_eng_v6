'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { decideTeamMode } = require('../.claude/scripts/team-policy');

test('single story is solo', () => {
  const d = decideTeamMode({ stories: [{ id: 'S1', files: ['a.js', 'b.js', 'c.js'] }] });
  assert.strictEqual(d.mode, 'solo');
  assert.strictEqual(d.teammates, 0);
});

test('two tiny independent stories are solo_sequential', () => {
  const d = decideTeamMode({
    stories: [
      { id: 'S1', files: ['a.js'] },
      { id: 'S2', files: ['b.js'] },
    ],
  });
  assert.strictEqual(d.mode, 'solo_sequential');
  assert.strictEqual(d.boundary_tax_risk, 'low');
  assert.strictEqual(d.teammates, 0);
});

test('large ownership forces team', () => {
  const d = decideTeamMode({
    stories: [
      { id: 'S1', files: ['a.js', 'b.js', 'c.js'] },
      { id: 'S2', files: ['d.js', 'e.js', 'f.js'] },
    ],
  });
  assert.strictEqual(d.mode, 'team');
  assert.strictEqual(d.teammates, 2);
});

test('cross-story deps force team even when tiny', () => {
  const d = decideTeamMode({
    stories: [
      { id: 'S1', files: ['a.js'], produces: ['AuthAPI'] },
      { id: 'S2', files: ['b.js'], consumes: ['AuthAPI'] },
    ],
  });
  assert.strictEqual(d.mode, 'team');
  assert.match(d.reason, /cross/);
});

test('force_teams and force_solo overrides', () => {
  assert.strictEqual(decideTeamMode({
    stories: [{ id: 'S1', files: ['a.js'] }, { id: 'S2', files: ['b.js'] }],
    opts: { force_teams: true },
  }).mode, 'team');
  assert.strictEqual(decideTeamMode({
    stories: [{ id: 'S1', files: ['a.js'] }, { id: 'S2', files: ['b.js'] }],
    opts: { force_solo: true },
  }).mode, 'solo_sequential');
});

test('unknown ownership prefers team for multi-story', () => {
  const d = decideTeamMode({ stories: [{ id: 'S1' }, { id: 'S2' }] });
  assert.strictEqual(d.mode, 'team');
});
