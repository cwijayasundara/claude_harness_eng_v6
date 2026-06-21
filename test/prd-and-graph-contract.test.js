'use strict';

// S1 contract: the Mermaid story graph in /spec and the PRD grounding surface in
// /brd. Pins the prose so the visual-graph instruction and the --prd alias don't
// silently regress.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('/spec instructs a Mermaid flowchart of the story dependency graph', () => {
  const spec = read('.claude/skills/spec/SKILL.md');
  assert.match(spec, /```mermaid/);
  assert.match(spec, /flowchart TD/);
  // the diagram must be tied to the tables, not a free-floating example
  assert.match(spec, /consistent with the tables/i);
});

test('/brd accepts --prd as an alias for --frd and points at the PRD format', () => {
  const brd = read('.claude/skills/brd/SKILL.md');
  assert.match(brd, /\/brd --prd/);
  assert.match(brd, /alias for --frd|treated identically/i);
  assert.match(brd, /docs\/prd-format\.md/);
});

test('/brd emits Forbidden Actions and per-requirement acceptance postconditions', () => {
  const brd = read('.claude/skills/brd/SKILL.md');
  assert.match(brd, /Forbidden Actions/);
  assert.match(brd, /"acceptance":/);
  assert.match(brd, /postcondition/i);
});

test('the canonical PRD format doc exists and carries id-bearing FR/NFR + deny-list', () => {
  const prd = read('docs/prd-format.md');
  assert.match(prd, /\bFR-1\b/);
  assert.match(prd, /\bNFR-1\b/);
  assert.match(prd, /Out of Scope/i);
  assert.match(prd, /Forbidden Actions/);
  assert.match(prd, /Acceptance/);
});
