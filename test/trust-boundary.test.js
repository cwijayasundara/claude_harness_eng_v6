'use strict';

/**
 * The harness-repo exemption.
 *
 * `machineryViolation` stops an agent rewriting the gates that judge its own
 * work. That block is correct in a scaffolded project and wrong in the harness
 * repo, where editing the machinery IS the work — so `isHarnessRepo` exempts it,
 * detected from package.json's name.
 *
 * It was pinned to the exact string 'claude-harness-eng-v5'. The repo was then
 * renamed to '-v6' and the constant did not follow, so the harness stopped
 * recognizing itself: the exemption silently died and every machinery change
 * made here was blocked as if this were a downstream project. An exact match on
 * a name that carries a version number is a control with an expiry date.
 *
 * The replacement matches the harness's own naming SERIES and nothing else.
 * These tests care at least as much about what must stay outside the exemption:
 * widening it to any name merely starting with the prefix would hand the
 * machinery bypass to any project that named itself accordingly.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const { isHarnessRepo } = require('../.claude/hooks/lib/trust-boundary.js');

const REPO_ROOT = path.join(__dirname, '..');

/** A throwaway dir whose package.json carries `name` (null = no package.json). */
function projectNamed(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-trust-'));
  if (name !== null) {
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name })}\n`);
  }
  return dir;
}

function withProject(name, fn) {
  const dir = projectNamed(name);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('the harness repo recognizes ITSELF', () => {
  // The regression that started this: true here, or the exemption is dead and
  // every machinery edit in this repo is blocked for the wrong reason.
  assert.strictEqual(
    isHarnessRepo(REPO_ROOT), true,
    'this IS the harness repo — package.json name must satisfy the detector',
  );
});

test('every version in the harness naming series is exempt', () => {
  for (const name of ['claude-harness-eng', 'claude-harness-eng-v5', 'claude-harness-eng-v6', 'claude-harness-eng-v7', 'claude-harness-eng-v10']) {
    withProject(name, (dir) => {
      assert.strictEqual(isHarnessRepo(dir), true, `${name} should be recognized as the harness repo`);
    });
  }
});

test('a name outside the series is NOT exempt', () => {
  // The whole point of the boundary. A scaffolded project must never reach the
  // machinery exemption by choosing a lookalike name.
  const outsiders = [
    'my-app',
    'shortlink-p3',
    'claude-harness-eng-evil',      // prefix + arbitrary suffix
    'claude-harness-engine',        // prefix, different word
    'claude-harness-eng-v6-fork',   // series + suffix
    'not-claude-harness-eng-v6',    // series, but not at the start
    'claude-harness-eng-v',         // truncated version
    'claude-harness-eng-vX',        // non-numeric version
    '',
  ];
  for (const name of outsiders) {
    withProject(name, (dir) => {
      assert.strictEqual(isHarnessRepo(dir), false, `${name} must NOT be treated as the harness repo`);
    });
  }
});

test('an unreadable or malformed package.json is not exempt', () => {
  // Fail closed: an unreadable manifest must not grant the bypass.
  withProject(null, (dir) => {
    assert.strictEqual(isHarnessRepo(dir), false, 'no package.json means no exemption');
  });
  const dir = projectNamed('claude-harness-eng-v6');
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');
    assert.strictEqual(isHarnessRepo(dir), false, 'malformed package.json means no exemption');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  withProject(undefined, (dir) => {
    // JSON.stringify drops an undefined value, so this writes `{}` — no name.
    assert.strictEqual(isHarnessRepo(dir), false, 'a package.json with no name means no exemption');
  });
});
