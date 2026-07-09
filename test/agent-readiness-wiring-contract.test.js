'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, '.claude', 'scripts', 'agent-readiness.js');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('G21: agent-readiness is surfaced + scripted', () => {
  assert.strictEqual(
    JSON.parse(rd('package.json')).scripts['agent-readiness'],
    'node .claude/scripts/agent-readiness.js'
  );
  assert.ok(/## Agent readiness \(G21\)/.test(rd('HARNESS.md')), 'HARNESS.md must have a standalone G21 section');
  // Substance check, not an exact-phrase match: the summary sentence's exact
  // wording legitimately changes every time a later gap closes (G15-G22 each
  // updated it) — assert G21 appears as closed somewhere in that sentence,
  // not that the whole sentence matches one frozen snapshot of the gap list.
  const summarySentence = (rd('HARNESS.md').match(/As of 2026-07[^\n]*/) || [''])[0];
  assert.ok(/\bG21\b/.test(summarySentence), 'HARNESS.md summary line must mention G21');
  // "G21 is new" is the specific phrasing this file uses for a gap NOT yet
  // closed (see G20's own "G20 is new and only partially closed" clause) —
  // check only that exact adjacency, not a `.*` span that could cross into
  // an unrelated gap's own "is new"/"partially closed" clause later in the
  // same sentence.
  assert.ok(!/\bG21\s+is\s+new\b/.test(summarySentence),
    'G21 must be reflected as closed, not left/re-opened as a partial gap');
  assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'skills', 'agent-readiness', 'SKILL.md')),
    '/agent-readiness must be invokable as a skill (this harness never uses .claude/commands/ for slash capabilities)');
});

test('G21 is NOT registered as a manifest guide or sensor — same standalone placement as G11', () => {
  const manifest = JSON.parse(rd('harness-manifest.json'));
  const all = [...(manifest.guides || []), ...(manifest.sensors || [])];
  assert.ok(!all.some((e) => e.gap_ref === 'G21'), 'agent-readiness inspects/reports on existing state, not a governing control');
});

test('agent-readiness.js runs end to end against a fixture root and writes both report formats', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-readiness-e2e-'));
  const out = execFileSync('node', [SCRIPT, '--root', dir], { encoding: 'utf8' });
  assert.match(out, /agent-readiness: active \d+\/8, partial \d+\/8, planned \d+\/8/);

  const json = JSON.parse(fs.readFileSync(path.join(dir, 'specs', 'reviews', 'agent-readiness.json'), 'utf8'));
  assert.strictEqual(json.pillars.length, 8);
  assert.deepStrictEqual(Object.keys(json.summary).sort(), ['active', 'partial', 'planned']);
  const total = json.summary.active + json.summary.partial + json.summary.planned;
  assert.strictEqual(total, 8);

  const md = fs.readFileSync(path.join(dir, 'specs', 'reviews', 'agent-readiness.md'), 'utf8');
  assert.match(md, /# Agent readiness report/);
  assert.match(md, /## Remediation/);
});

test('agent-readiness.js exits 0 even on a completely empty root (report-only, never blocks)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-readiness-empty-'));
  let code = 0;
  try {
    execFileSync('node', [SCRIPT, '--root', dir], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.strictEqual(code, 0);
});
