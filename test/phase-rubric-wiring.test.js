/**
 * Every phase rubric must actually be reachable.
 *
 * `phase-eval-rubrics.json` shipped a `test` rubric that no skill invoked and
 * the evaluator agent did not list among the phases it accepts. The result was
 * the one planning phase with cheap (Sonnet) generation and no review at all —
 * invisible, because an orphaned rubric fails nothing.
 *
 * A rubric key is a promise that the phase gets evaluated. These tests check
 * the promise is wired at both ends: the evaluator knows the phase name, and
 * some skill drives it.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const RUBRICS = require('../.claude/templates/phase-eval-rubrics.json');
const EVALUATOR = fs.readFileSync(path.join(ROOT, '.claude', 'agents', 'evaluator.md'), 'utf8');

function skillCorpora() {
  const dir = path.join(ROOT, '.claude', 'skills');
  const out = {};
  for (const skill of fs.readdirSync(dir)) {
    const entry = path.join(dir, skill, 'SKILL.md');
    if (!fs.existsSync(entry)) continue;
    let text = fs.readFileSync(entry, 'utf8');
    const refs = path.join(dir, skill, 'references');
    if (fs.existsSync(refs)) {
      for (const f of fs.readdirSync(refs).filter((x) => x.endsWith('.md'))) {
        text += fs.readFileSync(path.join(refs, f), 'utf8');
      }
    }
    out[skill] = text;
  }
  return out;
}

test('the evaluator agent accepts every phase the rubric file defines', () => {
  const phases = Object.keys(RUBRICS.phases);
  const unknown = phases.filter((p) => !new RegExp(`\`${p}\``).test(EVALUATOR));
  assert.deepStrictEqual(unknown, [],
    `rubric phases the evaluator does not list, so a caller passing them is unhandled: ${unknown.join(', ')}`);
});

test('every phase rubric is driven by some skill', () => {
  const corpora = skillCorpora();
  const orphans = Object.keys(RUBRICS.phases).filter((phase) => {
    const verdictFile = `phase-${phase}-eval.json`;
    return !Object.values(corpora).some(
      (text) => text.includes(verdictFile) || text.includes(`phases.${phase}`),
    );
  });
  assert.deepStrictEqual(orphans, [],
    `rubrics no skill invokes — the phase ships with no review: ${orphans.join(', ')}`);
});

test('the test phase carries the coverage hard gate, not just a weighted score', () => {
  // A weighted average can pass while an acceptance criterion has no test at
  // all; only the grounding verdict catches an untested requirement.
  const rubric = RUBRICS.phases.test;
  assert.ok(rubric, 'the test phase rubric must exist');
  assert.match(rubric.hard_gate, /test-grounding\.json/);
  assert.match(EVALUATOR, /test-grounding\.json/,
    'the evaluator must be told to treat the test grounding verdict as a hard gate');
});
