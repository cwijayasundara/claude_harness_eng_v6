'use strict';

// Locks the plan-confidence gate for headless /build --auto and --lite --auto:
// compute artifact, --gate exit codes, and skill prose that stops unattended builds.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const { parseCliArgs } = require('../.claude/scripts/plan-confidence');
const { readSkillCorpus } = require('./helpers/skill-corpus');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'plan-confidence.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('parseCliArgs understands --gate, --verify and --root', () => {
  assert.deepStrictEqual(parseCliArgs(['node', 'x', '--gate']), { root: '.', gate: true, verify: false });
  assert.deepStrictEqual(parseCliArgs(['node', 'x', '/tmp/proj', '--gate']), {
    root: '/tmp/proj',
    gate: true,
    verify: false,
  });
  assert.deepStrictEqual(parseCliArgs(['node', 'x', '--root', '/tmp/a', '--gate']), {
    root: '/tmp/a',
    gate: true,
    verify: false,
  });
});

test('--gate exits 0 for a clean plan and 2 for open questions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcg-'));
  fs.mkdirSync(path.join(dir, 'specs', 'brd'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'stories'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'specs', 'design'), { recursive: true });
  // Minimal clean BRD / epics
  fs.writeFileSync(
    path.join(dir, 'specs', 'brd', 'brd.md'),
    '# BRD\n\n## Assumptions\n\n- one\n\n## Open Questions\n\nNone.\n'
  );
  fs.writeFileSync(
    path.join(dir, 'specs', 'stories', 'epics.md'),
    '# Epics\n\n## Epic E1\n\n## Epic E2\n'
  );
  fs.writeFileSync(path.join(dir, 'specs', 'stories', 'backlog-needs-breakdown.md'), '# empty\n');
  fs.writeFileSync(path.join(dir, 'specs', 'design', 'api-contracts.schema.json'), '{"definitions":{}}\n');
  fs.writeFileSync(path.join(dir, 'specs', 'design', 'data-models.schema.json'), '{"definitions":{}}\n');

  const clean = spawnSync(process.execPath, [SCRIPT, dir, '--gate'], { encoding: 'utf8' });
  assert.strictEqual(clean.status, 0, clean.stdout + clean.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'specs', 'plan-confidence.json')));

  fs.writeFileSync(
    path.join(dir, 'specs', 'brd', 'brd.md'),
    '# BRD\n\n## Open Questions\n\n- What is auth?\n- Who owns data?\n'
  );
  const low = spawnSync(process.execPath, [SCRIPT, dir, '--gate'], { encoding: 'utf8' });
  assert.strictEqual(low.status, 2, low.stdout + low.stderr);
  assert.match(low.stderr, /LOW/i);
});

test('/build --auto documents mechanical --gate after Phase 3', () => {
  const build = readSkillCorpus('build');
  assert.match(build, /plan-confidence\.js/);
  assert.match(build, /--gate/);
  assert.match(build, /exit code \*\*2\*\*|Exit code \*\*2\*\*/i);
  assert.match(build, /auto-invoke `?\/clarify`?|auto-invoke \/clarify/i);
  assert.match(build, /Never loop `?\/clarify`? more than once|never loop \/clarify more than once/i);
});

test('lite --auto escalates on low plan confidence via --gate', () => {
  const build = readSkillCorpus('build');
  assert.match(build, /Low plan confidence is an escalation trigger/);
  assert.match(build, /plan-confidence\.js \. --gate|--gate/);
  assert.match(build, /auto-escalate to the full `--auto` pipeline/);
});

test('harness-manifest registers plan-confidence active on planning cadence', () => {
  const m = JSON.parse(read('harness-manifest.json'));
  const s = m.sensors.find((x) => x.id === 'plan-confidence');
  assert.ok(s);
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.cadence, 'planning');
  assert.match(s.wired_at, /plan-confidence\.js/);
});

// --verify is deliberately separate from --gate: --gate RECOMPUTES the score,
// --verify only asks whether the stored verdict still describes the current
// plan. Conflating them would let a stale verdict be silently refreshed instead
// of reported — which is the failure it exists to surface.
test('--verify is parsed as its own mode, distinct from --gate', () => {
  assert.deepStrictEqual(parseCliArgs(['node', 'x', '--verify']),
    { root: '.', gate: false, verify: true });
  assert.deepStrictEqual(parseCliArgs(['node', 'x', '--root', '/tmp/a', '--verify']),
    { root: '/tmp/a', gate: false, verify: true });
});

// The gated lane is where this was missing: /auto already ran --gate, the human
// lane only recommended /clarify in prose, and a real run recorded band LOW then
// proceeded to /design fifteen hours later.
test('/build Phase 3 enforces --gate and checks staleness before quoting the verdict', () => {
  const phases = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'skills', 'build', 'references',
      'section-04-pipeline-phases.md'), 'utf8',
  );
  assert.match(phases, /plan-confidence\.js \. --gate/, 'the gated lane must run the gate');
  assert.match(phases, /plan-confidence\.js \. --verify/, 'and must check the verdict is current');
  assert.match(phases, /Exit 2 \(band LOW\) \*\*blocks\*\*/, 'and must say it blocks');
});
