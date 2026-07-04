'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const script = path.join(__dirname, '..', '.claude', 'scripts', 'pipeline-status.js');
const { buildSnapshot, renderStatus } = require(script);

const NOW = '2026-06-21T12:00:00.000Z';

// Minimal fixtures for sprint tests
const PROGRESS_MINIMAL = [
  '=== Session 0 ===',
  'mode: lean',
  'groups_completed: []',
  'groups_remaining: []',
  'current_group: none',
  'features_passing: 0 / 0',
  'coverage: 0%',
  'next_action: idle',
  '',
].join('\n');

const FEATURES_MINIMAL = JSON.stringify([]);

function makeProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-status-'));
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'runs'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

test('buildSnapshot surfaces sprint number and phase when /sprint has written state markers', () => {
  const dir = makeProject({
    'claude-progress.txt': PROGRESS_MINIMAL,
    'features.json': FEATURES_MINIMAL,
    '.claude/state/current-sprint': '2',
    '.claude/state/sprint-phase': 'design-delta',
  });
  try {
    const snapshot = buildSnapshot(dir, { now: NOW });
    assert.deepStrictEqual(snapshot.sprint, { number: 2, phase: 'design-delta' });
    const rendered = renderStatus(snapshot);
    assert.match(rendered, /Sprint:\s+2 \(design-delta\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSnapshot omits sprint when no /sprint state markers exist', () => {
  const dir = makeProject({
    'claude-progress.txt': PROGRESS_MINIMAL,
    'features.json': FEATURES_MINIMAL,
  });
  try {
    const snapshot = buildSnapshot(dir, { now: NOW });
    assert.strictEqual(snapshot.sprint, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
