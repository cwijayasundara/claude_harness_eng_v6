'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

// Native-command integration (docs/native-command-integration.md):
//  Phase 1 — harness /review renamed to /gate to stop colliding with Claude
//            Code's native /review (PR review).
//  Phase 2 — /refactor delegates its mechanical-cleanup step to native /simplify,
//            fenced by the behavior-preservation gates.
// These tests keep the prose and directory layout in lockstep with that decision.

// --- Phase 1: the /review -> /gate rename -------------------------------------

test('the gate skill exists and the old review skill dir is gone', () => {
  assert.ok(exists('.claude', 'skills', 'gate', 'SKILL.md'), 'gate skill present');
  assert.ok(!exists('.claude', 'skills', 'review'), 'old review skill dir removed');
});

test('the gate skill is named gate, not review', () => {
  const gate = read('.claude', 'skills', 'gate', 'SKILL.md');
  assert.match(gate, /^name:\s*gate\s*$/m, 'frontmatter name is gate');
  assert.match(gate, /native `\/review`/, 'disambiguates from the native PR /review');
});

test('the security-reviewer reads its references from skills/gate, not skills/review', () => {
  const agent = read('.claude', 'agents', 'security-reviewer.md');
  assert.match(agent, /skills\/gate\/references\/security-/, 'points at the renamed dir');
  assert.ok(!/skills\/review\//.test(agent), 'no stale skills/review path remains');
});

test('the README documents the harness-vs-native command boundaries', () => {
  const readme = read('README.md');
  assert.match(readme, /Harness vs native Claude Code commands/, 'has the boundary section');
  assert.match(readme, /`\/gate`/, 'lists the renamed gate command');
});

// --- Phase 2: /refactor delegates mechanical cleanup to native /simplify -------

test('/refactor runs native /simplify as a fenced mechanical-cleanup step', () => {
  const refactor = read('.claude', 'skills', 'refactor', 'SKILL.md');
  assert.match(refactor, /native \*\*`\/simplify`\*\*/, 'invokes native /simplify');
  assert.match(refactor, /Green precondition/, 'fences on a passing suite');
  assert.match(refactor, /HARNESS_COMMIT_KIND=refactor/, 'commits as a pure refactor');
  assert.match(refactor, /clean-code-reviewer/, 'still spawns the structural reviewer after');
});
