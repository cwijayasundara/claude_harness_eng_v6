'use strict';

// Shared fixtures for pipeline-status.test.js (unit-level buildSnapshot/render
// tests) and pipeline-status-cli.test.js (spawnSync CLI tests) — split out of
// one file so each stays under the harness's file-length gate.

const fs = require('fs');
const os = require('os');
const path = require('path');

const script = path.join(__dirname, '..', '..', '.claude', 'scripts', 'pipeline-status.js');

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

module.exports = {
  script,
  NOW,
  PROGRESS_TWO_SESSIONS,
  FEATURES_FOUR,
  GRAPH_TWO_GROUPS,
  ITERATION_LOG_PASS,
  RUNS_THREE_STEPS,
  MID_BUILD_FILES,
  makeProject,
  midBuildProject,
};
