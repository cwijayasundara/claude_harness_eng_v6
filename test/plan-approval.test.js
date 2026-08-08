'use strict';

// Receipt + gate for the human plan-review loop at /spec, /design, /test.
//
// The properties worth locking are the ones that stop the receipt from becoming
// a rubber stamp: feedback must say something, an approval that follows a
// changes-requested round must account for that feedback, and an approval is
// void once the artifacts it approved have moved on.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, readReceipt } = require('../.claude/scripts/plan-approval.js');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-approval-'));
  fs.mkdirSync(path.join(root, 'specs', 'stories'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'stories', 'epics.md'), '# Epics\n');
  return root;
}

const ART = ['--artifact', 'specs/stories/epics.md'];
const FEEDBACK = 'E2-S3 and E2-S4 both own the session cookie; merge them.';

function record(root, args) {
  return run(['record', '--phase', 'spec', ...args], root);
}

// --- feedback must be substantive -------------------------------------------

test('a changes-requested round needs at least one feedback item', () => {
  const root = tmpRoot();
  assert.strictEqual(record(root, ['--verdict', 'changes-requested']), 2);
  assert.strictEqual(readReceipt(root, 'spec'), null, 'a rejected round must not be written');
});

test('placeholder feedback is not feedback', () => {
  const root = tmpRoot();
  for (const junk of ['n/a', 'TBD', 'none', 'looks fine']) {
    assert.strictEqual(
      record(root, ['--verdict', 'changes-requested', '--feedback', junk]), 2,
      `"${junk}" must not count as review feedback`,
    );
  }
});

test('a substantive changes-requested round is recorded', () => {
  const root = tmpRoot();
  assert.strictEqual(record(root, ['--verdict', 'changes-requested', '--feedback', FEEDBACK]), 0);
  const receipt = readReceipt(root, 'spec');
  assert.strictEqual(receipt.status, 'changes-requested');
  assert.strictEqual(receipt.rounds.length, 1);
  assert.strictEqual(receipt.rounds[0].round, 1);
  assert.deepStrictEqual(receipt.rounds[0].feedback, [FEEDBACK]);
});

// --- an approval must account for prior feedback -----------------------------

test('approving after feedback requires saying what was done about it', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'changes-requested', '--feedback', FEEDBACK]);
  assert.strictEqual(
    record(root, ['--verdict', 'approved', ...ART]), 2,
    'round 2 must not approve silently over round 1 feedback',
  );
  const declined = ['--declined', 'Kept them split: the cookie write is in E2-S3 only.'];
  assert.strictEqual(record(root, ['--verdict', 'approved', ...declined, ...ART]), 0);
  assert.strictEqual(readReceipt(root, 'spec').status, 'approved');
});

test('a first-round approval needs no changelog', () => {
  const root = tmpRoot();
  assert.strictEqual(record(root, ['--verdict', 'approved', ...ART]), 0);
  assert.strictEqual(readReceipt(root, 'spec').status, 'approved');
});

test('an approval must name the artifacts it approves, and they must exist', () => {
  const root = tmpRoot();
  assert.strictEqual(record(root, ['--verdict', 'approved']), 2, 'no artifacts named');
  assert.strictEqual(
    record(root, ['--verdict', 'approved', '--artifact', 'specs/stories/ghost.md']), 2,
    'a named artifact that does not exist cannot have been reviewed',
  );
});

// --- rubber-stamp signal -----------------------------------------------------

test('an approval with no questions answered and no feedback is flagged, not blocked', () => {
  const root = tmpRoot();
  assert.strictEqual(record(root, ['--verdict', 'approved', '--questions', '4', ...ART]), 0);
  const receipt = readReceipt(root, 'spec');
  assert.strictEqual(receipt.status, 'approved', 'low engagement must not block');
  assert.strictEqual(receipt.low_engagement, true);
});

test('answering a question clears the rubber-stamp flag', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', '--questions', '4', '--answered', '2', ...ART]);
  assert.strictEqual(readReceipt(root, 'spec').low_engagement, false);
});

test('feedback in an earlier round clears the flag for the approval', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'changes-requested', '--feedback', FEEDBACK]);
  record(root, ['--verdict', 'approved', '--changes', 'Merged E2-S4 into E2-S3.', ...ART]);
  assert.strictEqual(readReceipt(root, 'spec').low_engagement, false);
});

// --- the gate ----------------------------------------------------------------

test('check fails when no review has happened at all', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['check', '--phase', 'spec'], root), 1);
});

test('check fails while the phase is still in changes-requested', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'changes-requested', '--feedback', FEEDBACK]);
  assert.strictEqual(run(['check', '--phase', 'spec'], root), 1);
});

test('check passes on an approved, unmodified phase', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', ...ART]);
  assert.strictEqual(run(['check', '--phase', 'spec'], root), 0);
});

test('editing an approved artifact voids the approval', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', ...ART]);
  fs.writeFileSync(path.join(root, 'specs', 'stories', 'epics.md'), '# Epics\n\n## E3 — scope the human never saw\n');
  assert.strictEqual(
    run(['check', '--phase', 'spec'], root), 1,
    'an approval must not survive a rewrite of what was approved',
  );
});

test('deleting an approved artifact voids the approval', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', ...ART]);
  fs.rmSync(path.join(root, 'specs', 'stories', 'epics.md'));
  assert.strictEqual(run(['check', '--phase', 'spec'], root), 1);
});

test('re-approving after a revision restores the gate', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', ...ART]);
  fs.writeFileSync(path.join(root, 'specs', 'stories', 'epics.md'), '# Epics\n\n## E3\n');
  record(root, ['--verdict', 'approved', '--changes', 'Added E3 at the reviewer request.', ...ART]);
  assert.strictEqual(run(['check', '--phase', 'spec'], root), 0);
});

// --- headless waivers --------------------------------------------------------

test('a waiver must name the lane that granted it', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['waive', '--phase', 'spec'], root), 2);
  assert.strictEqual(run(['waive', '--phase', 'spec', '--lane', 'nonsense'], root), 2);
});

test('a waived phase passes the gate and records why', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['waive', '--phase', 'spec', '--lane', '--auto'], root), 0);
  assert.strictEqual(run(['check', '--phase', 'spec'], root), 0);
  const receipt = readReceipt(root, 'spec');
  assert.strictEqual(receipt.status, 'waived');
  assert.strictEqual(receipt.waived_by, '--auto');
});

test('--require-human rejects a waiver, so the gated lane cannot be waived into', () => {
  const root = tmpRoot();
  run(['waive', '--phase', 'spec', '--lane', '--auto'], root);
  assert.strictEqual(run(['check', '--phase', 'spec', '--require-human'], root), 1);
});

// --- surface -----------------------------------------------------------------

test('every pipeline phase that has a review loop is a valid phase', () => {
  // brd joined the list when /brd was de-forked. Before that its approval could
  // not reach a human — a forked skill cannot pause for AskUserQuestion — so a
  // receipt would have recorded a stop that never happened, and a real gated
  // run duly produced no brd-approval.json at all.
  const root = tmpRoot();
  for (const phase of ['brd', 'spec', 'design', 'test']) {
    assert.strictEqual(run(['record', '--phase', phase, '--verdict', 'approved', ...ART], root), 0);
  }
});

test('a phase with no review loop is still rejected', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['record', '--phase', 'deploy', '--verdict', 'approved', ...ART], root), 2);
  assert.strictEqual(run(['record', '--phase', 'brownfield', '--verdict', 'approved', ...ART], root), 2);
});

test('check --phase all gates a phase only once that phase has produced artifacts', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', ...ART]);
  assert.strictEqual(
    run(['check', '--phase', 'all'], root), 0,
    'a lane that never designed or test-planned must not be blocked for it',
  );

  fs.mkdirSync(path.join(root, 'specs', 'design'));
  fs.writeFileSync(path.join(root, 'specs', 'design', 'api-contracts.md'), '# API\n');
  assert.strictEqual(run(['check', '--phase', 'all'], root), 1, 'design artifacts now exist, unapproved');

  run(['record', '--phase', 'design', '--verdict', 'approved', ...ART], root);
  assert.strictEqual(run(['check', '--phase', 'all'], root), 0);
});

test('an empty phase directory does not count as having produced artifacts', () => {
  const root = tmpRoot();
  record(root, ['--verdict', 'approved', ...ART]);
  fs.mkdirSync(path.join(root, 'specs', 'test_artefacts'));
  assert.strictEqual(run(['check', '--phase', 'all'], root), 0);
});

test('an explicitly named phase is required even with no artifacts — naming it is the assertion', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['check', '--phase', 'design'], root), 1);
});

test('an unknown verb is an error, not a silent pass', () => {
  const root = tmpRoot();
  assert.strictEqual(run(['approve', '--phase', 'spec'], root), 2);
  assert.strictEqual(run([], root), 2);
});
