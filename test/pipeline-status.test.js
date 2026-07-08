'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'pipeline-status.js');
const {
  buildSnapshot,
  renderStatus,
  renderTimeline,
  watchFrame,
  readRunReceipts,
  findProjectDir,
} = require(script);
const { storeContext } = require('../.claude/scripts/context-store');
const { NOW, FEATURES_FOUR, makeProject, midBuildProject } = require('./helpers/pipeline-status-fixtures');

test('buildSnapshot reads the latest session block and core state', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });

  assert.strictEqual(snap.schema_version, 1);
  assert.strictEqual(snap.generated_at, NOW);
  assert.strictEqual(snap.run.lane, 'auto');
  assert.strictEqual(snap.run.mode, 'lean');
  assert.strictEqual(snap.run.session_id, 'sess-1');
  assert.strictEqual(snap.run.harness_sha, 'abc123');

  // Latest session block (Session 1), not the first.
  assert.deepStrictEqual(snap.groups.completed, ['A']);
  assert.strictEqual(snap.groups.current, 'B');
  assert.deepStrictEqual(snap.groups.remaining, ['B']);
  assert.strictEqual(snap.next_action, 'Run evaluator against group B');
});

test('buildSnapshot counts features overall and per group', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });

  assert.strictEqual(snap.features.passing, 2);
  assert.strictEqual(snap.features.total, 4);
  assert.strictEqual(snap.features.by_group.A, '2/2');
  assert.strictEqual(snap.features.by_group.B, '0/2');
});

test('buildSnapshot derives wave progress from the dependency graph', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });

  assert.strictEqual(snap.wave.total, 2, 'two groups in the graph');
  assert.strictEqual(snap.wave.current, 2, 'one done + currently on one');
});

test('buildSnapshot reads iteration, coverage, and last step', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });

  assert.strictEqual(snap.iteration.group, 'B');
  assert.strictEqual(snap.iteration.current, 2);
  assert.strictEqual(snap.iteration.max, 3);
  assert.strictEqual(snap.coverage.current, 88);
  assert.strictEqual(snap.coverage.baseline, 80);
  assert.strictEqual(snap.last_step.agent, 'evaluator');
  assert.strictEqual(snap.last_step.exit, 'error');
  assert.strictEqual(snap.stories.active[0], 'E1-S3');
});

test('health is on_track when latest coverage is at or above baseline', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });
  assert.strictEqual(snap.health, 'on_track', '88% >= baseline 80%');
});

test('health is failing when coverage dropped below baseline', () => {
  const dir = makeProject({
    'claude-progress.txt': [
      '=== Session 0 ===',
      'groups_completed: [A]',
      'groups_remaining: [B]',
      'current_group: B',
      'features_passing: 2 / 4',
      'coverage: 70%',
      'next_action: build group B',
    ].join('\n'),
    'features.json': FEATURES_FOUR,
    '.claude/state/coverage-baseline.txt': '80\n',
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.health, 'failing');
});

test('health is blocked when a story is blocked', () => {
  const dir = makeProject({
    'claude-progress.txt': [
      '=== Session 0 ===',
      'groups_completed: []',
      'groups_remaining: [A]',
      'current_group: A',
      'features_passing: 0 / 1',
      'blocked_stories: [E1-S1]',
      'next_action: unblock E1-S1',
    ].join('\n'),
    'features.json': JSON.stringify([{ id: 'x', group: 'A', passes: false }]),
  });
  const snap = buildSnapshot(dir, { now: NOW });
  assert.deepStrictEqual(snap.stories.blocked, ['E1-S1']);
  assert.strictEqual(snap.health, 'blocked');
});

test('buildSnapshot tolerates a fresh project with no state', () => {
  const snap = buildSnapshot(makeProject(), { now: NOW });
  assert.strictEqual(snap.schema_version, 1);
  assert.strictEqual(snap.features.total, 0);
  assert.strictEqual(snap.last_step, null);
  assert.strictEqual(snap.health, 'on_track');
});

test('renderStatus surfaces the headline fields in plain text', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });
  const out = renderStatus(snap);

  assert.match(out, /2 \/ 4/, 'features count shown');
  assert.match(out, /Run evaluator against group B/, 'next action shown');
  assert.match(out, /on_track|failing|blocked/, 'health shown');
  assert.match(out, /group B/i, 'current group shown');
});

test('buildSnapshot and renderStatus surface living navigation freshness and token savings', () => {
  const dir = midBuildProject();
  fs.writeFileSync(path.join(dir, '.claude', 'state', 'navigation-status.json'), JSON.stringify({
    status: 'fresh',
    graph: 'fresh',
    wiki: 'fresh',
    source_files: 42,
    indexed_files: 42,
    dirty_files: 0,
    estimated_context_query_tokens: 800,
    estimated_tokens_saved_per_orientation: 4200,
    last_refresh: NOW,
  }));

  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.navigation.status, 'fresh');
  assert.strictEqual(snap.navigation.estimated_tokens_saved_per_orientation, 4200);
  const out = renderStatus(snap);
  assert.match(out, /Navigation:\s+fresh/);
  assert.match(out, /graph=fresh/);
  assert.match(out, /~4200 tokens saved/);
});

test('buildSnapshot and renderStatus surface CCR context-cache savings', () => {
  const dir = midBuildProject();
  const first = storeContext({ projectDir: dir, kind: 'test-log', raw: Array.from({ length: 40 }, () => 'PASS repeated output').join('\n'), label: 'npm test' });
  const second = storeContext({ projectDir: dir, kind: 'search-results', raw: 'src/auth.js:1:function validateSession() {}\n', label: 'validateSession' });
  fs.writeFileSync(path.join(dir, '.claude', 'state', 'context-cache', `${first.hash}.json`), JSON.stringify({
    ...first,
    estimated_pack_tokens: 12,
    estimated_saved_tokens: 180,
  }));
  fs.writeFileSync(path.join(dir, '.claude', 'state', 'context-cache', `${second.hash}.json`), JSON.stringify({
    ...second,
    estimated_pack_tokens: 8,
    estimated_saved_tokens: 3,
  }));

  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.context_cache.entries, 2);
  assert.strictEqual(snap.context_cache.estimated_pack_tokens, 20);
  assert.strictEqual(snap.context_cache.estimated_saved_tokens, 183);

  const out = renderStatus(snap);
  assert.match(out, /Context Cache:\s+entries=2/);
  assert.match(out, /~183 tokens saved/);
});

test('buildSnapshot and renderStatus surface token advisor warning counts', () => {
  const dir = midBuildProject();
  fs.appendFileSync(path.join(dir, '.claude', 'state', 'token-advisor.jsonl'), `${JSON.stringify({ kind: 'broad_source_read', path: 'src/auth.js' })}\n`);
  fs.appendFileSync(path.join(dir, '.claude', 'state', 'token-advisor.jsonl'), `${JSON.stringify({ kind: 'verbose_command', command: 'npm test' })}\n`);

  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.token_advisor.warnings, 2);
  assert.strictEqual(snap.token_advisor.by_kind.broad_source_read, 1);
  assert.strictEqual(snap.token_advisor.by_kind.verbose_command, 1);

  const out = renderStatus(snap);
  assert.match(out, /Token Advisor:\s+warnings=2/);
  assert.match(out, /broad_source_read:1/);
  assert.match(out, /verbose_command:1/);
});

test('confidence is null and the Plan line is omitted when no artifact exists', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });
  assert.strictEqual(snap.confidence, null);
  assert.doesNotMatch(renderStatus(snap), /Plan:/);
});

test('buildSnapshot surfaces plan confidence and renderStatus shows it', () => {
  const dir = midBuildProject();
  fs.writeFileSync(path.join(dir, 'specs', 'plan-confidence.json'), JSON.stringify({
    band: 'low',
    score: 0.7,
    threshold: 0.6,
    drivers: [{ signal: 'openQuestions', detail: '1 unanswered open question(s)', weight: -0.3 }],
  }));
  const snap = buildSnapshot(dir, { now: NOW });
  assert.strictEqual(snap.confidence.band, 'low');
  assert.strictEqual(snap.confidence.threshold, 0.6);

  const out = renderStatus(snap);
  assert.match(out, /Plan:\s+confidence=low/);
  assert.match(out, /1 unanswered open question/);
  assert.match(out, /threshold=0\.6/);
});

test('renderTimeline lists steps for the current session with status glyphs', () => {
  const dir = midBuildProject();
  const snap = buildSnapshot(dir, { now: NOW });
  const out = renderTimeline(readRunReceipts(dir), snap);

  assert.match(out, /generator/, 'ok step listed');
  assert.match(out, /evaluator/, 'error step listed');
  assert.match(out, /✓/, 'ok glyph present');
  assert.match(out, /✗/, 'error glyph present');
});

test('renderTimeline omits the group tag when group is "none"', () => {
  const snap = { run: { session_id: 's' } };
  const records = [{ kind: 'tool', ts: 't', session_id: 's', tool: 'Bash', exit: 'ok', group_id: 'none' }];
  const out = renderTimeline(records, snap);
  assert.doesNotMatch(out, /\[group/, 'a "none" group must not render a group tag');
});

test('watchFrame clears the screen then renders the snapshot', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });
  const frame = watchFrame(snap, false);
  assert.match(frame, /^\x1b\[2J\x1b\[H/, 'starts with the clear-screen escape');
  assert.match(frame, /Pipeline status/);
});

test('watchFrame --json emits a parseable snapshot after the clear', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });
  const frame = watchFrame(snap, true);
  const body = frame.replace(/^\x1b\[2J\x1b\[H/, '').trim();
  assert.strictEqual(JSON.parse(body).schema_version, 1);
});

test('findProjectDir walks up to the directory containing .claude', () => {
  const dir = makeProject();
  const nested = path.join(dir, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(findProjectDir(nested), dir);
});
