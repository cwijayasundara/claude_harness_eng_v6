'use strict';

// Inbound tracker read — the counterpart to tracker-publish, which only pushed.
//
// A team working FROM Linear/Jira had to copy ticket text into
// /change "<description>" by hand, and the resulting story carried no link back
// to the work item. Provenance ran one way only.
//
// The two properties worth pinning: the fetch is read-only (nothing here may
// transition a ticket the harness has not actually finished), and a ticket with
// no acceptance criteria is surfaced rather than silently accepted — a story
// with no criterion gives the tests no oracle.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const lib = require(path.join(ROOT, '.claude/hooks/lib/tracker-fetch.js'));
const { resolveTarget } = require(path.join(ROOT, '.claude/scripts/tracker-fetch.js'));

const LINEAR_BODY = `We need confidence scores on the extraction endpoint.

## Acceptance Criteria
- Given a document, when extracted, then each field carries a 0-1 score.
- Given a score below 0.5, when rendered, then the field is flagged for review.

## Notes
- Ask design about the flag colour.`;

test('acceptance criteria are lifted out of the ticket body', () => {
  const ac = lib.extractAcceptance(LINEAR_BODY);
  assert.strictEqual(ac.length, 2, 'only the AC section bullets, not the Notes bullet');
  assert.match(ac[0], /^Given a document/);
});

test('Given/AC-shaped bullets outside a heading still count', () => {
  const ac = lib.extractAcceptance('Do the thing.\n- Given a user, when X, then Y.\n- unrelated note');
  assert.deepStrictEqual(ac, ['Given a user, when X, then Y.']);
});

test('a ticket with no criteria yields none rather than inventing one', () => {
  assert.deepStrictEqual(lib.extractAcceptance('Just make it faster please'), []);
});

test('Jira ADF descriptions are flattened to text rather than dropped', () => {
  const adf = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Rate limit the API.' }] },
      { type: 'heading', content: [{ type: 'text', text: 'Acceptance Criteria' }] },
    ],
  };
  const text = lib.adfToText(adf);
  assert.match(text, /Rate limit the API\./, 'losing formatting is fine; losing the words is not');
  assert.match(text, /Acceptance Criteria/);
});

test('issue keys are validated before a network call is attempted', async () => {
  await assert.rejects(
    () => lib.fetchTicket('linear', 'not a key', { LINEAR_API_KEY: 'x' }),
    /not a Linear issue key/,
  );
  await assert.rejects(
    () => lib.fetchTicket('jira', 'lowercase-1', { JIRA_BASE_URL: 'https://x', JIRA_EMAIL: 'a', JIRA_API_TOKEN: 'b' }),
    /not a Jira issue key/,
  );
});

test('missing credentials fail with the variable name, not a stack trace', async () => {
  await assert.rejects(() => lib.fetchTicket('linear', 'ENG-1', {}), /LINEAR_API_KEY/);
  await assert.rejects(() => lib.fetchTicket('jira', 'ENG-1', { JIRA_BASE_URL: 'https://x' }), /JIRA_EMAIL/);
});

test('an unknown provider is refused rather than guessed', async () => {
  await assert.rejects(() => lib.fetchTicket('github', 'ENG-1', {}), /unknown provider/);
});

test('the story seed carries provenance back to the ticket', () => {
  const seed = lib.toStorySeed({
    provider: 'linear',
    key: 'ENG-123',
    url: 'https://linear.app/t/ENG-123',
    title: 'Confidence scores',
    description: LINEAR_BODY,
    acceptance: lib.extractAcceptance(LINEAR_BODY),
    labels: ['backend'],
    state: 'Todo',
  });
  assert.match(seed, /# ENG-123 — Confidence scores/);
  assert.match(seed, /Source: \[ENG-123\]\(https:\/\/linear\.app\/t\/ENG-123\)/,
    'the story must link to the work item the team actually tracks');
  assert.match(seed, /## Acceptance criteria/);
  assert.match(seed, /1\. Given a document/);
  assert.match(seed, /## Out of scope/);
});

test('a criteria-less ticket seeds a story that says so, loudly', () => {
  const seed = lib.toStorySeed({
    provider: 'jira', key: 'P-9', url: 'u', title: 't', description: 'make it faster',
    acceptance: [], labels: [], state: null,
  });
  assert.match(seed, /None stated in the ticket/,
    'a blank criteria section reads as "none needed"; this must read as "owed"');
});

test('the CLI resolves either provider flag', () => {
  assert.deepStrictEqual(resolveTarget(['--linear', 'ENG-1']), { provider: 'linear', key: 'ENG-1' });
  assert.deepStrictEqual(resolveTarget(['--jira', 'PROJ-2']), { provider: 'jira', key: 'PROJ-2' });
  assert.strictEqual(resolveTarget(['--json']), null);
});

test('nothing in the inbound path can write to a tracker', () => {
  // Linear's GraphQL endpoint takes POST even for reads, so the HTTP verb proves
  // nothing. What proves it: no GraphQL mutation, and no Jira write endpoint.
  const source = read('.claude/hooks/lib/tracker-fetch.js') + read('.claude/scripts/tracker-fetch.js');
  assert.doesNotMatch(source, /\bmutation\b/,
    'a GraphQL mutation is the only way this file could change a Linear issue');
  assert.doesNotMatch(source, /\/transitions|issueUpdate|issueCreate|\/comment\b/,
    'the harness opens a PR and a human merges it — moving a ticket asserts an outcome it does not control');
  // Jira: every call must be a GET. The one fetch() has no method, i.e. GET.
  const jira = source.slice(source.indexOf('function fetchJira'));
  assert.doesNotMatch(jira.slice(0, 600), /method:/,
    'the Jira read must stay a plain GET');
  assert.match(read('.claude/skills/change/SKILL.md'), /read-only/,
    '/change must state that the fetch does not move the ticket');
});

test('/change documents both inbound flags and ships the script', () => {
  const change = read('.claude/skills/change/SKILL.md');
  assert.match(change, /--linear KEY \| --jira KEY/, 'the argument hint must advertise the entry');
  assert.match(change, /tracker-fetch\.js --linear/);
  // In the KERNEL, not the planning pack: /change is a kernel skill, so a
  // planning-pack placement made a kernel unit unrunnable in a kernel-only
  // install — check-partition caught exactly that. tracker-fetch is safe in the
  // kernel because it depends on no planning artifact (unlike tracker-publish,
  // which needs tracker-map.json from /spec); it reads a ticket and prints text.
  const packs = JSON.parse(read('.claude/config/packs.json'));
  assert.ok(packs.kernel.script.includes('tracker-fetch'));
  assert.ok(packs.kernel.lib.includes('tracker-fetch'));
  assert.ok(!packs.packs.planning.script.includes('tracker-fetch'),
    'a unit in both the kernel and a pack is ambiguous to the installer');
});
