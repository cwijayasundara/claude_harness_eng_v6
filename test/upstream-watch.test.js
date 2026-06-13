'use strict';

const assert = require('assert');
const { test } = require('node:test');

const { addedLines, buildReport } = require('../.claude/scripts/upstream-watch.js');

const OLD_CHANGELOG = [
  '# Changelog',
  '',
  '## 2.1.30',
  '- Fixed a typo in help output',
].join('\n');

const NEW_CHANGELOG = [
  '# Changelog',
  '',
  '## 2.1.31',
  '- BREAKING: hooks now receive JSON on stdin',
  '- Improved spinner colors',
  '',
  '## 2.1.30',
  '- Fixed a typo in help output',
].join('\n');

test('addedLines returns only lines new in the latest snapshot', () => {
  const added = addedLines(OLD_CHANGELOG, NEW_CHANGELOG);
  assert.deepStrictEqual(added, [
    '## 2.1.31',
    '- BREAKING: hooks now receive JSON on stdin',
    '- Improved spinner colors',
  ]);
});

test('addedLines is empty when nothing changed', () => {
  assert.deepStrictEqual(addedLines(NEW_CHANGELOG, NEW_CHANGELOG), []);
});

test('buildReport returns null when neither changelog nor plugins changed', () => {
  const report = buildReport({
    oldChangelog: OLD_CHANGELOG,
    newChangelog: OLD_CHANGELOG,
    oldPlugins: ['ralph-wiggum'],
    newPlugins: ['ralph-wiggum'],
  });
  assert.strictEqual(report, null);
});

test('buildReport flags harness-relevant changelog lines', () => {
  const report = buildReport({
    oldChangelog: OLD_CHANGELOG,
    newChangelog: NEW_CHANGELOG,
    oldPlugins: [],
    newPlugins: [],
  });
  assert.ok(report.relevant, 'hook change must be marked relevant');
  assert.ok(report.body.includes('hooks now receive JSON on stdin'));
});

test('buildReport reports cosmetic-only changes as not relevant', () => {
  const cosmetic = OLD_CHANGELOG + '\n## 2.1.31\n- Improved spinner colors';
  const report = buildReport({
    oldChangelog: OLD_CHANGELOG,
    newChangelog: cosmetic,
    oldPlugins: [],
    newPlugins: [],
  });
  assert.strictEqual(report.relevant, false);
  assert.ok(report.body.includes('Improved spinner colors'));
});

test('buildReport calls out new migration plugins loudly', () => {
  const report = buildReport({
    oldChangelog: OLD_CHANGELOG,
    newChangelog: OLD_CHANGELOG,
    oldPlugins: ['ralph-wiggum'],
    newPlugins: ['ralph-wiggum', 'claude-fable-6-migration'],
  });
  assert.ok(report.relevant);
  assert.ok(report.body.includes('claude-fable-6-migration'));
  assert.ok(/migration plugin/i.test(report.body));
});

test('buildReport lists removed plugins', () => {
  const report = buildReport({
    oldChangelog: OLD_CHANGELOG,
    newChangelog: OLD_CHANGELOG,
    oldPlugins: ['old-helper'],
    newPlugins: [],
  });
  assert.ok(report.body.includes('old-helper'));
});
