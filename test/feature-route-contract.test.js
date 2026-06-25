'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SKILL = '.claude/skills/feature/SKILL.md';

test('skill exists with correct frontmatter (name, fork context)', () => {
  const s = read(SKILL);
  assert.match(s, /^name:\s*feature\s*$/m);
  assert.match(s, /^context:\s*fork\s*$/m);
});

test('A: documents the scope-adaptive lanes (single -> /change, cluster -> spec/design/auto)', () => {
  const s = read(SKILL);
  assert.match(s, /single[- ]story/i);
  assert.match(s, /\/change/);
  assert.match(s, /\/spec/);
  assert.match(s, /\/design/);
  assert.match(s, /\/auto/);
  // routing rule: the ≤3 files / no auth-data-API threshold (shared with /change Step 0)
  assert.match(s, /≤\s*3 files|3 files/);
  assert.match(s, /auth|persistence|public[- ]API/i);
});

test('A: defines exactly the three human gates', () => {
  const s = read(SKILL);
  assert.match(s, /GATE 1[^\n]*decompos/i);
  assert.match(s, /GATE 2[^\n]*(plan|design)/i);
  assert.match(s, /GATE 3[^\n]*PR/i);
});

test('A: is a thin conductor that delegates and does not reimplement', () => {
  const s = read(SKILL);
  assert.match(s, /thin conductor|delegate/i);
  assert.match(s, /\/brownfield/);
  assert.match(s, /\/gate/);
});

test('B: DeepWiki lifecycle — build once, patch incrementally, ship with PR', () => {
  const s = read(SKILL);
  assert.match(s, /first run/i);
  assert.match(s, /--files|incremental/i);
  assert.match(s, /graph-refresh/);
  assert.match(s, /STALE/);
  assert.match(s, /same PR|ships? (in|with)/i);
  // GATE 2 reads the committed pre-change wiki to enforce design-adherence
  assert.match(s, /cite[^\n]*wiki|wiki[^\n]*cite/i);
  assert.match(s, /design[- ]adherence|adhere to/i);
});

test('B: full-rebuild fallback when graph warnings spike', () => {
  const s = read(SKILL);
  assert.match(s, /fallback|spike|massive refactor/i);
});

test('C: single-story lane publishes via single-story-map + publish-to-linear', () => {
  const s = read(SKILL);
  assert.match(s, /single-story-map\.js|--granularity single/);
  assert.match(s, /publish-to-linear\.js/);
});

test('C: cluster lane publishes via tracker-publish --granularity group', () => {
  const s = read(SKILL);
  assert.match(s, /--granularity group|tracker-publish/);
});

test('C: PR links back to the Linear issue; issue left in Human Review, never auto-Done', () => {
  const s = read(SKILL);
  assert.match(s, /link[^\n]*Linear|Linear[^\n]*link/i);
  assert.match(s, /Human Review/);
  assert.match(s, /never[^\n]*Done|not[^\n]*auto.*Done/i);
});
