'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');

const { planStorySync, applyStorySync } = require('../.claude/hooks/lib/story-sync');
const { appendMatrix } = require('../.claude/hooks/lib/matrix-append');
const { renderBundleMarkdown } = require('../.claude/hooks/lib/bundle-render');

const ROOT = path.resolve(__dirname, '..');

const bundle = {
  story_id: 'E1-S1',
  title: 'Create a short link',
  sprint: 1,
  requirements: { ac_ids: ['E1-S1-AC1'], brd_ids: ['BR-1'], br_acceptance_ids: ['BR-1-AC1'], scope_out: [] },
  structure: { owned_files: ['src/links/service.py'] },
  operations: { pending: false, files: ['src/links/service.py'], text: '- 1. Add create_link' },
  approach: { program_design: 'specs/design/program-design.md' },
  tests: { matrix_ids: ['VM-001'] },
  provenance: { parents: [] },
};

test('story-sync adds mapped files and refuses AC drift', () => {
  const ok = planStorySync({
    bundle,
    storyMarkdown: '**E1-S1-AC1** given when then',
    mapFiles: ['src/links/service.py', 'src/links/repo.py'],
  });
  assert.strictEqual(ok.behavior, false);
  assert.deepStrictEqual(ok.added_files, ['src/links/repo.py']);

  const drift = planStorySync({
    bundle,
    storyMarkdown: '**E1-S1-AC2** given when then',
    mapFiles: ['src/links/service.py'],
  });
  assert.strictEqual(drift.behavior, true);
  assert.ok(drift.errors[0].includes('acceptance criteria'));

  const next = applyStorySync(bundle, ok, '2026-08-17T00:00:00.000Z');
  assert.ok(next.structure.owned_files.includes('src/links/repo.py'));
  assert.strictEqual(next.provenance.synced_at, '2026-08-17T00:00:00.000Z');
});

test('matrix-append keeps old rows and versions a changed AC', () => {
  const living = {
    version: 1,
    requirements: [{ id: 'VM-001', ac_id: 'E1-S1-AC1', story_id: 'E1-S1' }],
  };
  const incoming = {
    requirements: [
      { id: 'VM-001', ac_id: 'E1-S1-AC9', story_id: 'E1-S1' },
      { id: 'VM-002', ac_id: 'E1-S2-AC1', story_id: 'E1-S2' },
    ],
  };
  const result = appendMatrix(living, incoming, { sprint: 2 });
  assert.strictEqual(result.matrix.requirements[0].status, 'superseded');
  assert.strictEqual(result.matrix.requirements[0].superseded_by, 'VM-001@s2');
  assert.ok(result.added.includes('VM-002'));
  assert.strictEqual(result.superseded[0].to, 'VM-001@s2');
});

test('bundle-render includes ACs, original reqs, and owned files', () => {
  const md = renderBundleMarkdown(bundle, { group: 'A', harnessCommand: '/auto --group A' });
  assert.match(md, /E1-S1-AC1/);
  assert.match(md, /BR-1-AC1/);
  assert.match(md, /src\/links\/service.py/);
  assert.match(md, /Harness command: \/auto --group A/);
});

test('tracker-body writes a bundle-rendered group file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-body-'));
  fs.mkdirSync(path.join(dir, 'specs', 'bundles'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'bundles', 'E1-S1.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '.claude', 'state', 'tracker-map.json'), JSON.stringify({
    granularity: 'group',
    groups: { A: { stories: ['E1-S1'], title: 'Group A' } },
    stories: { 'E1-S1': { group: 'A' } },
  }));
  const out = execFileSync(process.execPath, [
    path.join(ROOT, '.claude', 'scripts', 'tracker-body.js'),
    '--root', dir,
  ], { encoding: 'utf8' });
  assert.match(out, /wrote 1/);
  const body = fs.readFileSync(path.join(dir, '.claude', 'state', 'tracker-runs', 'group-A.md'), 'utf8');
  assert.match(body, /E1-S1-AC1/);
  assert.match(body, /BR-1-AC1/);
});

test('story-sync CLI writes the bundle and fails closed on AC drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-sync-'));
  fs.mkdirSync(path.join(dir, 'specs', 'stories'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'bundles'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'design'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'stories', 'E1-S1.md'), '# E1-S1\n\n**E1-S1-AC1**\n');
  fs.writeFileSync(path.join(dir, 'specs', 'bundles', 'E1-S1.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'specs', 'design', 'component-map.md'), '| E1-S1 | `src/links/service.py` |\n| E1-S1 | `src/links/repo.py` |\n');

  const out = execFileSync(process.execPath, [
    path.join(ROOT, '.claude', 'scripts', 'story-sync.js'),
    '--write', '--root', dir, '--files', 'src/links/repo.py',
  ], { encoding: 'utf8' });
  assert.match(out, /wrote/);
  const next = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'bundles', 'E1-S1.json'), 'utf8'));
  assert.ok(next.structure.owned_files.includes('src/links/repo.py'));

  fs.writeFileSync(path.join(dir, 'specs', 'stories', 'E1-S1.md'), '# E1-S1\n\n**E1-S1-AC9**\n');
  assert.throws(
    () => execFileSync(process.execPath, [
      path.join(ROOT, '.claude', 'scripts', 'story-sync.js'),
      '--write', '--root', dir,
    ], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(String(err.stderr), /acceptance criteria/);
      return true;
    },
  );
});
