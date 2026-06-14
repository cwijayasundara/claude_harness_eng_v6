'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'cr-index.js');
const { extractAcceptance } = require(SCRIPT);

// A change request is the brownfield analogue of a story's acceptance criteria.
// cr-index turns it into a stable {id,text} upstream index so the delta test plan
// can be grounded against the CR with the same trace-check gate the greenfield
// lane uses for ACs — a delta test tracing to no CR line is scope creep; a CR
// line with no delta test is an unverified requirement.

const CR = [
  '# Change Request: Add confidence scores to extraction',
  '',
  '## Background',
  'Today extraction returns fields with no confidence. We want a score per field.',
  '',
  '## Acceptance Criteria',
  '- [ ] Extraction returns a confidence between 0 and 1 for each field',
  '- [x] A confidence below 0.5 marks the field low-confidence',
  '1. The API response includes a `confidence` object keyed by field',
  '',
  '## Out of Scope',
  '- Re-processing historical extractions',
].join('\n');

test('extracts only the acceptance-section items, ignoring prose and out-of-scope', () => {
  const items = extractAcceptance(CR);
  assert.strictEqual(items.length, 3);
  assert.ok(items.every((i) => /confidence/.test(i.text)));
  assert.ok(!items.some((i) => /historical/.test(i.text)), 'out-of-scope bullet excluded');
});

test('assigns sequential CR-AC ids and trims/normalizes text', () => {
  const items = extractAcceptance(CR);
  assert.deepStrictEqual(items.map((i) => i.id), ['CR-AC1', 'CR-AC2', 'CR-AC3']);
  assert.strictEqual(items[0].text, 'Extraction returns a confidence between 0 and 1 for each field');
});

test('handles checkbox, bullet and numbered list markers', () => {
  const items = extractAcceptance('## Requirements\n- [ ] a\n* b\n2. c\n');
  assert.deepStrictEqual(items.map((i) => i.text), ['a', 'b', 'c']);
});

test('falls back to all list items when no acceptance-like heading exists', () => {
  const items = extractAcceptance('# Notes\n- first thing\n- second thing\n');
  assert.deepStrictEqual(items.map((i) => i.text), ['first thing', 'second thing']);
});

test('a CR with no list items yields an empty index (route to /clarify upstream)', () => {
  assert.deepStrictEqual(extractAcceptance('# CR\nJust a paragraph, no list.\n'), []);
});

// --- CLI ----------------------------------------------------------------------

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe' }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

test('CLI: --cr <file> --out <file> writes the index and exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'));
  const cr = path.join(dir, 'cr.md');
  const out = path.join(dir, 'cr-acceptance.json');
  fs.writeFileSync(cr, CR);
  const r = run(['--cr', cr, '--out', out]);
  assert.strictEqual(r.code, 0);
  const index = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(index.length, 3);
  assert.ok(index.every((i) => i.id && i.text), 'trace-check {id,text} shape');
});

test('CLI: exit 2 when the CR file is missing or no input is given', () => {
  assert.strictEqual(run([]).code, 2);
  assert.strictEqual(run(['--cr', path.join(os.tmpdir(), 'no-such-cr.md')]).code, 2);
});

// --- integration: the index grounds delta traces via trace-check --------------

test('CR index is a valid upstream for trace-check (delta tests trace to CR lines)', () => {
  const { checkTraces } = require(path.join(__dirname, '..', '.claude', 'scripts', 'trace-check.js'));
  const required = extractAcceptance(CR);
  const downstream = [
    { id: 'TC-1', text: 'confidence in [0,1] per field', traces: ['CR-AC1'] },
    { id: 'TC-2', text: 'below 0.5 flagged', traces: ['CR-AC2'] },
    { id: 'TC-3', text: 'response has confidence object', traces: ['CR-AC3'] },
  ];
  assert.strictEqual(checkTraces({ required, downstream }).pass, true);
  // a delta test tracing to no CR line is net-new (scope creep)
  const creep = checkTraces({ required, downstream: [...downstream, { id: 'TC-4', traces: [] }] });
  assert.strictEqual(creep.pass, false);
});
