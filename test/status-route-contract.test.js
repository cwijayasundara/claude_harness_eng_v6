'use strict';

// The /status command is a read-only CLI wrapper over pipeline-status.js (which
// has its own unit tests in pipeline-status.test.js + pipeline-status-budget.test.js).
// A live claude run just to invoke a CLI would be wasteful, so this pins the one
// thing those unit tests do NOT: that the /status SKILL actually routes to the
// tested script (and exposes it via `npm run status`). Without this guard the
// skill prose could drift to a renamed/missing script while the script's own
// tests stay green — the "command never driven" gap. Mirrors the existing
// publish-to-jira-docs-contract pattern for /tracker-publish.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('/status SKILL routes to the unit-tested pipeline-status.js script', () => {
  const skill = read('.claude/skills/status/SKILL.md');
  assert.match(skill, /pipeline-status\.js/, '/status must invoke .claude/scripts/pipeline-status.js');
  assert.ok(
    fs.existsSync(path.join(ROOT, '.claude', 'scripts', 'pipeline-status.js')),
    'the pipeline-status.js the skill names must exist',
  );
});

test('npm run status is wired to the same script the skill documents', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts && pkg.scripts.status, 'package.json must expose `npm run status`');
  assert.match(pkg.scripts.status, /pipeline-status\.js/, '`npm run status` must run pipeline-status.js');
});
