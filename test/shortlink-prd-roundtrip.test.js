'use strict';

// The mid-sized pipeline fixture, round-tripped through the REAL validators.
//
// docs/shortlink-prd.md exists to exercise the whole pipeline in one sitting.
// That only works if it stays structurally clean, so this asserts against
// validate-prd.js and brd-adopt.js themselves rather than a hand-built fixture:
// if either gate changes its conventions, this fails and the fixture gets fixed
// with it.
//
// It also pins the section conventions brd-extract documents. brd-adopt routes
// by section label, not by content — a postcondition labelled anything other
// than "<id> AC" is adopted as a REQUIREMENT, which inflates the spine and
// leaves the real requirement with no oracle. That failure is silent: every
// count still looks plausible.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRD = path.join(ROOT, 'docs/shortlink-prd.md');

/** Build the spine the way brd-extract's section table instructs. */
function extractSpine(markdown) {
  const out = [];
  let section = null;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) { section = heading[1].trim(); continue; }
    if (!section) continue;
    const ac = line.match(/^-\s+\*\*((?:FR|NFR)-[\w.]+)\*\*\s+(?:→|->)\s+(.*)$/);
    if (ac && /Acceptance/i.test(section)) {
      out.push({ id: `FRD-${out.length + 1}`, text: ac[2], section: `${section} / ${ac[1]} AC` });
      continue;
    }
    const req = line.match(/^-\s+\*\*((?:FR|NFR)-[\w.]+)\*\*\s+(.*)$/);
    if (req) {
      out.push({ id: `FRD-${out.length + 1}`, text: req[2], section: `${section} / ${req[1]}` });
      continue;
    }
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet && /Out of Scope|Risks|Open Questions|Milestones/i.test(section)) {
      out.push({ id: `FRD-${out.length + 1}`, text: bullet[1], section });
    }
  }
  return out;
}

function adopt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortlink-'));
  fs.mkdirSync(path.join(dir, 'specs/brd'), { recursive: true });
  const markdown = fs.readFileSync(PRD, 'utf8');
  fs.writeFileSync(path.join(dir, 'specs/brd/source-frd.md'), markdown);
  fs.writeFileSync(
    path.join(dir, 'specs/brd/frd-requirements.json'),
    JSON.stringify(extractSpine(markdown), null, 1),
  );
  execFileSync('node', [path.join(ROOT, '.claude/scripts/brd-adopt.js'), '--root', dir]);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'specs/brd', f), 'utf8'));
  return {
    requirements: read('brd-requirements.json'),
    acceptance: read('brd-acceptance.json'),
    safeguards: read('brd-safeguards.json'),
    milestones: read('brd-milestones.json'),
    risks: read('brd-risks.json'),
    openQuestions: read('brd-open-questions.json'),
  };
}

test('the fixture passes the PRD shape gate clean — no errors, no warnings', () => {
  // A fixture that ships warnings teaches operators to ignore the gate's output,
  // which is how the 35-error PRD reached adoption unexamined.
  const out = execFileSync('node', [path.join(ROOT, '.claude/scripts/validate-prd.js'), PRD])
    .toString();
  assert.match(out, /validate-prd: OK — 24 requirements, 0 warning\(s\)\./);
});

test('adoption routes every section to the artifact that section means', () => {
  const a = adopt();
  assert.strictEqual(a.requirements.length, 24, 'FR-1..FR-16 plus NFR-1..NFR-8');
  assert.strictEqual(a.safeguards.length, 7, 'Out of Scope is a deny-list, not a backlog');
  assert.strictEqual(a.risks.length, 3);
  assert.strictEqual(a.openQuestions.length, 3);
  assert.strictEqual(a.milestones.length, 3);
});

test('acceptance criteria link to their requirement rather than becoming requirements', () => {
  const a = adopt();
  assert.strictEqual(a.acceptance.length, 17, '16 FR postconditions plus NFR-8');
  for (const criterion of a.acceptance) {
    assert.match(criterion.requirement, /^(FR|NFR)-/,
      'a criterion must name the requirement it gates, not a spine id');
  }
  const gated = a.requirements.filter((r) => (r.acceptance || []).length);
  assert.strictEqual(gated.length, 17, 'every criterion must land back on a requirement');
});

test('adoption is verbatim — the spine text survives into the requirements', () => {
  const a = adopt();
  const markdown = fs.readFileSync(PRD, 'utf8');
  for (const req of a.requirements) {
    assert.ok(markdown.includes(req.text),
      `"${req.text.slice(0, 40)}…" was reworded; grounding is only an identity if nothing is transformed`);
  }
});

test('every milestone is observable and names the requirements it closes', () => {
  for (const m of adopt().milestones) {
    assert.strictEqual(m.observable, true, `${m.id} needs a Done when: that can gate a deploy`);
    assert.ok(m.requirements.length > 0,
      `${m.id} names no requirement — /spec cannot propose scope and has to ask`);
  }
});

test('taxonomy is left unassigned for the session that has the human', () => {
  assert.ok(adopt().requirements.every((r) => r.taxonomy === null),
    'slot classification is a judgement; adopting a guess would satisfy the floor with nobody deciding');
});
