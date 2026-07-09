'use strict';

// Locks the propagation half of the 2026-07-09 Devin/Anthropic/Thoughtworks
// parity-hardening pass (docs/superpowers/specs/2026-07-09-devin-parity-hardening-design.md,
// §1): .claude/state/learned-rules.md was already injected into /auto,
// /implement, and /refactor, but not into /change, /vibe, or /feature.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/change reads learned-rules.md before editing', () => {
  const skill = read('.claude/skills/change/SKILL.md');
  assert.match(skill, /\.claude\/state\/learned-rules\.md/, 'must reference learned-rules.md');
  assert.match(skill, /inject its contents verbatim/i, "must inject verbatim, matching /auto's convention");
});
