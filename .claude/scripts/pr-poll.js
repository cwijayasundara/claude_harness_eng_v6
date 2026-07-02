#!/usr/bin/env node

'use strict';

// Deterministic poller for /pr-respond (2026-07-02 audit fix #1): reads a PR's
// checks, review-thread comments, and metadata via gh, diffs against a state
// file so each failure/comment is surfaced once per head SHA, and emits JSON
// for the respond loop. Read-only against GitHub; the state file is written
// only via --record-* (the skill marks items handled AFTER a successful
// push/reply, never before).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EMPTY_STATE = () => ({ handled_checks: [], replied_comments: [] });

function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (_) {
    process.stderr.write(`pr-poll: malformed ${label} payload — treating as empty\n`);
    return null;
  }
}

function loadState(file) {
  if (!file || !fs.existsSync(file)) return EMPTY_STATE();
  const doc = parseJson(fs.readFileSync(file, 'utf8'), 'state');
  if (!doc || !Array.isArray(doc.handled_checks) || !Array.isArray(doc.replied_comments)) return EMPTY_STATE();
  return doc;
}

function recordHandled(file, item) {
  const state = loadState(file);
  if (item.check && !state.handled_checks.includes(item.check)) state.handled_checks.push(item.check);
  if (item.comment != null && !state.replied_comments.includes(item.comment)) state.replied_comments.push(item.comment);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  return state;
}

// Pure core. gh(args) -> stdout string. Never throws on malformed payloads.
function poll(pr, state, gh) {
  const view = parseJson(
    gh(['pr', 'view', String(pr), '--json', 'headRefName,headRefOid,state,mergeable,reviewDecision']),
    'pr view'
  ) || {};
  const head_sha = view.headRefOid || '';

  const checksRaw = parseJson(gh(['pr', 'checks', String(pr), '--json', 'name,workflow,bucket,link']), 'checks');
  const checks = Array.isArray(checksRaw) ? checksRaw : [];
  const failures = checks
    .filter((c) => c && c.bucket === 'fail')
    .filter((c) => !state.handled_checks.includes(`${head_sha}:${c.name}`))
    .map((c) => ({ name: c.name, workflow: c.workflow || '', link: c.link || '' }));
  const pending = checks.some((c) => c && (c.bucket === 'pending' || c.bucket === 'cancel'));
  const checksKnown = checksRaw !== null;

  const commentsRaw = parseJson(
    gh(['api', `repos/{owner}/{repo}/pulls/${pr}/comments`, '--paginate']),
    'comments'
  );
  const comments = (Array.isArray(commentsRaw) ? commentsRaw : [])
    .filter((c) => c && !state.replied_comments.includes(c.id))
    .map((c) => ({
      id: c.id,
      path: c.path || '',
      line: c.line != null ? c.line : null,
      body: String(c.body || ''),
      author: (c.user && c.user.login) || '',
    }));

  const allChecksPass = checksKnown && checks.length > 0 && checks.every((c) => c && c.bucket === 'pass');
  const clean = allChecksPass && !pending && failures.length === 0 && comments.length === 0;

  return {
    pr,
    head_sha,
    head_branch: view.headRefName || '',
    state: view.state || '',
    mergeable: view.mergeable || '',
    review_decision: view.reviewDecision || '',
    failures,
    comments,
    clean,
  };
}

function run(argv, root) {
  const pr = parseInt(argv[0], 10);
  if (!Number.isFinite(pr)) {
    process.stderr.write('usage: pr-poll.js <pr-number> [--state-file <path>] [--record-check <sha:name>] [--record-comment <id>]\n');
    return 2;
  }
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stateFile = flag('--state-file') || path.join(root, '.claude', 'state', `pr-respond-${pr}.json`);

  const recordCheck = flag('--record-check');
  const recordComment = flag('--record-comment');
  if (recordCheck || recordComment) {
    const state = recordHandled(stateFile, { check: recordCheck, comment: recordComment ? Number(recordComment) : undefined });
    process.stdout.write(JSON.stringify(state) + '\n');
    return 0;
  }

  let result;
  try {
    result = poll(pr, loadState(stateFile), defaultGh);
  } catch (err) {
    process.stderr.write(`pr-poll: gh unavailable or PR not found: ${err.message}\n`);
    return 2;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return 0;
}

module.exports = { poll, loadState, recordHandled, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
