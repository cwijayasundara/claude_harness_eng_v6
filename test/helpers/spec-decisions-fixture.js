'use strict';

// The spec decisions-document fixtures, shared by the validateDecisions unit
// tests and the CLI/verdict-stamping tests. One file until
// validate-spec-decisions.test.js crossed its 500-line cap.

const decision = (over = {}) => ({
  id: 'D1',
  question: 'Which epics are in milestone 1?',
  chosen: 'E1, E2, E3',
  rationale: 'They are the only ones with no upstream dependency.',
  basis: 'human',
  load_bearing: true,
  ...over,
});

const doc = (over = {}) => ({
  version: 1,
  phase: 'spec',
  source: 'specs/brd/brd.md',
  confirmed_at: '2026-08-05T10:00:00.000Z',
  milestone: {
    name: 'M1 — ingestion',
    epics: ['E1', 'E2', 'E3'],
    deferred_epics: ['E4'],
    requirements_in_scope: ['FR-1', 'FR-2'],
  },
  decisions: [decision()],
  ...over,
});

module.exports = { decision, doc };
