'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
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

const NOW = '2026-06-21T12:00:00.000Z';

const PROGRESS_TWO_SESSIONS = [
  '=== Session 0 ===',
  'mode: lean',
  'groups_completed: [A]',
  'groups_remaining: [B]',
  'current_group: A',
  'features_passing: 2 / 4',
  'coverage: 90%',
  'next_action: start group A',
  '',
  '=== Session 1 ===',
  'date: 2026-06-21T00:00:00Z',
  'mode: lean',
  'groups_completed: [A]',
  'groups_remaining: [B]',
  'current_group: B',
  'features_passing: 2 / 4',
  'coverage: 88%',
  'blocked_stories: none',
  'next_action: Run evaluator against group B',
  '',
].join('\n');

const FEATURES_FOUR = JSON.stringify([
  { id: 'add', group: 'A', passes: true },
  { id: 'list', group: 'A', passes: true },
  { id: 'complete', group: 'B', passes: false },
  { id: 'delete', group: 'B', passes: false },
]);

const GRAPH_TWO_GROUPS = [
  '# Dependency Graph',
  '## Groups',
  '- **Group A** (no dependencies): E1-S1, E1-S2',
  '- **Group B** (depends on A): E1-S3, E1-S4',
  '',
].join('\n');

const ITERATION_LOG_PASS = [
  '# Iteration Log',
  '',
  '## Group A — CLI core',
  '- **Date:** 2026-06-20T01:00:00Z',
  '- **Status:** PASS',
  '- **Coverage:** 90% (baseline: 80%)',
  '',
].join('\n');

const RUNS_THREE_STEPS = [
  JSON.stringify({ kind: 'prompt', ts: '2026-06-21T11:00:00Z', session_id: 'sess-1', harness_sha: 'abc123', command: '/auto', lane: 'auto', mode: 'lean' }),
  JSON.stringify({ kind: 'subagent', ts: '2026-06-21T11:30:00Z', session_id: 'sess-1', harness_sha: 'abc123', agent: 'generator', exit: 'ok', group_id: 'B' }),
  JSON.stringify({ kind: 'subagent', ts: '2026-06-21T11:45:00Z', session_id: 'sess-1', harness_sha: 'abc123', agent: 'evaluator', exit: 'error', group_id: 'B' }),
].join('\n') + '\n';

const MID_BUILD_FILES = {
  '.claude/state/current-lane': 'auto\n',
  '.claude/state/current-mode': 'lean\n',
  '.claude/state/current-iteration': '2\n',
  '.claude/state/current-group': 'B\n',
  '.claude/state/current-story': 'E1-S3\n',
  'claude-progress.txt': PROGRESS_TWO_SESSIONS,
  'features.json': FEATURES_FOUR,
  'specs/stories/dependency-graph.md': GRAPH_TWO_GROUPS,
  '.claude/state/iteration-log.md': ITERATION_LOG_PASS,
  '.claude/state/pending-reviews.jsonl': '{"id":1}\n{"id":2}\n',
  '.claude/runs/2026-06-21.jsonl': RUNS_THREE_STEPS,
};

function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-status-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'runs'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

const midBuildProject = () => makeProject(MID_BUILD_FILES);

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

test('buildSnapshot reads iteration, coverage, pending reviews and last step', () => {
  const snap = buildSnapshot(midBuildProject(), { now: NOW });

  assert.strictEqual(snap.iteration.group, 'B');
  assert.strictEqual(snap.iteration.current, 2);
  assert.strictEqual(snap.iteration.max, 3);
  assert.strictEqual(snap.coverage.current, 88);
  assert.strictEqual(snap.coverage.baseline, 80);
  assert.strictEqual(snap.pending_reviews, 2);
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
  assert.strictEqual(snap.pending_reviews, 0);
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

test('CLI status --json emits a parseable snapshot object', () => {
  const res = spawnSync('node', [script, 'status', '--json'], { cwd: midBuildProject(), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  const snap = JSON.parse(res.stdout);
  assert.strictEqual(snap.schema_version, 1);
  assert.ok(snap.generated_at, 'generated_at injected at call time');
  assert.strictEqual(snap.features.total, 4);
});

test('CLI status prints a human-readable summary by default', () => {
  const res = spawnSync('node', [script, 'status'], { cwd: midBuildProject(), encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Pipeline/i);
  assert.match(res.stdout, /2 \/ 4/);
});

test('CLI rejects an unknown subcommand', () => {
  const res = spawnSync('node', [script, 'frobnicate'], { cwd: makeProject(), encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0, 'unknown command must exit non-zero');
});
