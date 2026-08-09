'use strict';

// /brd's spine extraction belongs on the sidekick.
//
// The harness declared the shaping/rendering split but put the split point in
// the wrong place: /brd Step 0.0 told the MAIN session to write
// frd-requirements.json itself. On a metered run that produced a 34 KB blob
// with the frontier model before the interview started, and it was then
// re-billed on every remaining turn — the phase cost $15.58 with only 8.6% of
// its output coming from the fork.
//
// These assertions pin the split: extraction is forked, its return is counts,
// and the caller does not read the spine back in.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EXTRACT = '.claude/skills/brd-extract/SKILL.md';

function frontmatter(rel) {
  const out = {};
  for (const l of read(rel).split(/\r?\n/).slice(1)) {
    if (l === '---') break;
    const m = l.match(/^([a-z-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

test('brd-extract runs as a fork on the sidekick agent', () => {
  const fm = frontmatter(EXTRACT);
  assert.strictEqual(fm.context, 'fork', 'extraction in the main session is the cost this fixes');
  assert.strictEqual(fm.agent, 'generator', 'transcription does not need the frontier model');
  assert.match(fm.description, /^\[Internal pipeline stage/,
    'internal stages must be marked so they are not offered as a user lane');
});

test('brd-extract returns counts, and says so in the imperative', () => {
  const body = read(EXTRACT);
  assert.match(body, /Return counts, not content/i);
  assert.match(body, /Do not restate requirements/i,
    'a fork that pastes the spine into its return has moved the blob, not removed it');
});

test('brd-extract keeps the properties adoption depends on', () => {
  const body = read(EXTRACT);
  assert.match(body, /verbatim/i, 'paraphrase is what makes grounding more than an identity');
  assert.match(body, /brd-adopt\.js/, 'the derived artifacts must come from the deterministic adopter');
  assert.match(body, /taxonomy: null/,
    'slot classification is a judgement and stays with the session that has the human');
  assert.match(body, /[Nn]ever invoke `\/clarify`/,
    'a fork cannot reach the human, so clarifying means answering its own question');
});

test('/brd dispatches extraction instead of doing it', () => {
  const brd = read('.claude/skills/brd/SKILL.md');
  assert.match(brd, /brd-extract/, '/brd must dispatch the extractor');
  assert.match(brd, /Do not extract the spine yourself/i);
  assert.match(brd, /Do not read `frd-requirements\.json`/i,
    'reading the spine back costs the same as having written it');
  assert.doesNotMatch(
    brd,
    /\*\*Extract its requirements\*\* into `specs\/brd\/frd-requirements\.json`/,
    'the old main-session extraction instruction must be gone, not merely supplemented',
  );
});

test('brd-extract ships to scaffolded projects', () => {
  const packs = JSON.parse(read('.claude/config/packs.json'));
  assert.ok(
    packs.packs.planning.skill.includes('brd-extract'),
    'an unregistered skill is absent from every scaffolded project, so /brd would dispatch nothing',
  );
});

test('/brd checks the PRD shape before adopting it as the baseline', () => {
  // The PRD becomes the immutable grounding baseline, and every downstream gate
  // measures against it — but /brd never ran the shape gate. A real PRD reached
  // adoption with 35 structural errors, 34 of them requirements with no
  // acceptance postcondition, and the gap surfaced by hand three hours later.
  const brd = read('.claude/skills/brd/SKILL.md');
  assert.match(brd, /validate-prd\.js/, '/brd must run the PRD shape gate');
  assert.match(brd, /before\*\* dispatching the extractor|Step 0\.0a/,
    'the check must precede extraction — after adoption it is no longer cheap to fix');
  assert.match(brd, /no acceptance postcondition/i,
    'the missing-oracle case is the one that passes silently forever');
});

test('brd-extract states the section conventions brd-adopt routes on', () => {
  const body = read(EXTRACT);
  assert.match(body, /AC\b/, 'the acceptance section suffix must be documented');
  assert.match(body, /adopted as a \*requirement\*|adopted as a requirement/i,
    'the consequence of mislabelling must be stated, not just the rule');
});
