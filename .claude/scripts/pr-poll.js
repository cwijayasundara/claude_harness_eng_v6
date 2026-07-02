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
  if (item.comment != null) {
    if (Number.isFinite(item.comment)) {
      if (!state.replied_comments.includes(item.comment)) state.replied_comments.push(item.comment);
    } else {
      process.stderr.write('pr-poll: ignoring non-numeric comment id\n');
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  return state;
}

function readView(pr, gh) {
  return parseJson(
    gh(['pr', 'view', String(pr), '--json', 'headRefName,headRefOid,state,mergeable,reviewDecision']),
    'pr view'
  ) || {};
}

function readChecks(pr, gh) {
  const checksRaw = parseJson(gh(['pr', 'checks', String(pr), '--json', 'name,workflow,bucket,link']), 'checks');
  return { checks: Array.isArray(checksRaw) ? checksRaw : [], checksKnown: checksRaw !== null };
}

function readComments(pr, gh, state) {
  const commentsRaw = parseJson(
    gh(['api', `repos/{owner}/{repo}/pulls/${pr}/comments`, '--paginate']),
    'comments'
  );
  return (Array.isArray(commentsRaw) ? commentsRaw : [])
    .filter((c) => c && !state.replied_comments.includes(c.id))
    .map((c) => ({
      id: c.id,
      path: c.path || '',
      line: c.line != null ? c.line : null,
      body: String(c.body || ''),
      author: (c.user && c.user.login) || '',
    }));
}

// 'skipping' (path-filtered CI jobs) is neutral: it can neither pass nor
// block clean. All-skipped stays NOT clean — nothing was actually validated.
function computeClean({ checks, checksKnown, failures, comments }) {
  const relevant = checks.filter((c) => c && c.bucket !== 'skipping');
  const pending = relevant.some((c) => c && (c.bucket === 'pending' || c.bucket === 'cancel'));
  const allPass = checksKnown && relevant.length > 0 && relevant.every((c) => c && c.bucket === 'pass');
  return allPass && !pending && failures.length === 0 && comments.length === 0;
}

// Pure core. gh(args) -> stdout string. Never throws on malformed payloads.
function poll(pr, state, gh) {
  const view = readView(pr, gh);
  const head_sha = view.headRefOid || '';

  const { checks, checksKnown } = readChecks(pr, gh);
  const failures = checks
    .filter((c) => c && c.bucket === 'fail')
    .filter((c) => !state.handled_checks.includes(`${head_sha}:${c.name}`))
    .map((c) => ({ name: c.name, workflow: c.workflow || '', link: c.link || '' }));
  const raw_failure_count = checks.filter((c) => c && c.bucket === 'fail').length;

  const comments = readComments(pr, gh, state);
  const clean = computeClean({ checks, checksKnown, failures, comments });

  return {
    pr,
    head_sha,
    head_branch: view.headRefName || '',
    state: view.state || '',
    mergeable: view.mergeable || '',
    review_decision: view.reviewDecision || '',
    failures,
    raw_failure_count,
    comments,
    clean,
  };
}

// Returns the updated state, or null if recordCommentRaw was given but isn't
// a finite number (caller turns that into a usage error + exit 2).
function handleRecordFlags(stateFile, recordCheck, recordCommentRaw) {
  let recordComment;
  if (recordCommentRaw !== undefined) {
    recordComment = Number(recordCommentRaw);
    if (!Number.isFinite(recordComment)) return null;
  }
  return recordHandled(stateFile, { check: recordCheck, comment: recordComment });
}

const USAGE = 'usage: pr-poll.js <pr-number> [--state-file <path>] [--record-check <sha:name>] [--record-comment <id>]\n';

function runRecord(stateFile, recordCheck, recordCommentRaw) {
  const state = handleRecordFlags(stateFile, recordCheck, recordCommentRaw);
  if (state === null) {
    process.stderr.write(USAGE);
    return 2;
  }
  process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  return 0;
}

function runPoll(pr, stateFile) {
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

function run(argv, root) {
  const pr = parseInt(argv[0], 10);
  if (!Number.isFinite(pr)) {
    process.stderr.write(USAGE);
    return 2;
  }
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stateFile = flag('--state-file') || path.join(root, '.claude', 'state', `pr-respond-${pr}.json`);

  const recordCheck = flag('--record-check');
  const recordCommentRaw = flag('--record-comment');
  if (recordCheck || recordCommentRaw !== undefined) {
    return runRecord(stateFile, recordCheck, recordCommentRaw);
  }
  return runPoll(pr, stateFile);
}

module.exports = { poll, loadState, recordHandled, run };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
