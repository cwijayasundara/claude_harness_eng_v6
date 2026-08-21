'use strict';

// Which PRD a live route builds from.
//
// Every route used to hardcode its fixture path, so pointing a route at a real
// project's PRD meant editing the test. The PRDs a harness change most needs to
// be tried against are the ones a real build already used — so the path is a
// seam: an env override, with a committed default that keeps every route
// runnable and reproducible out of the box.
//
// A missing override fails here rather than at `freshProject`, where a copy of
// a non-existent file surfaces as an opaque ENOENT halfway through a scaffold.

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

const PRDS = {
  // The shortlink pair: written as a sprint-1 / sprint-2 set, with sprint 2
  // declaring its own new/changed/carried classification — which is what makes
  // it usable as an oracle for the delta lane rather than just an input.
  sprint1: { env: 'HARNESS_E2E_PRD', file: 'shortlink-sprint1-prd.md' },
  sprint2: { env: 'HARNESS_E2E_PRD_SPRINT2', file: 'shortlink-sprint2-prd.md' },
  // The small fixtures the bounded routes use.
  counter: { env: 'HARNESS_E2E_PRD_COUNTER', file: 'counter-prd.md' },
  sample: { env: 'HARNESS_E2E_PRD_SAMPLE', file: 'sample-prd.md' },
};

function resolvePrd(kind) {
  const spec = PRDS[kind];
  if (!spec) throw new Error(`resolvePrd: unknown PRD "${kind}" (known: ${Object.keys(PRDS).join(', ')})`);

  const override = (process.env[spec.env] || '').trim();
  if (override) {
    const resolved = path.resolve(override);
    if (!fs.existsSync(resolved)) {
      throw new Error(`${spec.env}=${override} does not exist (resolved to ${resolved})`);
    }
    return resolved;
  }
  return path.join(FIXTURES, spec.file);
}

/**
 * The requirement labels a PRD declares, in order, deduplicated.
 *
 * The harness's own PRD convention bolds them (`**FR-1**`, `**NFR-2**`), and
 * every requirement in the shortlink pair is written that way. This turns the
 * PRD into an oracle: a phase that drops or invents a requirement is visible
 * without a human reading both documents side by side.
 */
function prdLabels(prdPath) {
  const text = fs.readFileSync(prdPath, 'utf8');
  const seen = [];
  for (const match of text.matchAll(/\*\*((?:FR|NFR)-\d+)\*\*/g)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/** Labels the PRD declares that the spine does not carry, and vice versa. */
function spineGap(prdPath, spine) {
  const declared = prdLabels(prdPath);
  const carried = (Array.isArray(spine) ? spine : []).map((r) => r && r.label).filter(Boolean);
  return {
    declared,
    carried,
    missing: declared.filter((l) => !carried.includes(l)),
    invented: carried.filter((l) => !declared.includes(l)),
  };
}

module.exports = { resolvePrd, prdLabels, spineGap, PRDS };
