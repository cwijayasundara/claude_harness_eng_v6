'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseFailures, countRules, summarizeTelemetry, readFlakeCount,
  readBaselineNum, deriveNotes, buildScorecard, renderMd,
  leadTurnNotes, leadTurnRatioCell,
} = require(path.resolve(__dirname, '..', '.claude', 'hooks', 'lib', 'loop-health.js'));

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loop-health-'));
}

function writeFile(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// --- parseFailures ---------------------------------------------------------

test('parseFailures: ignores the commented-out template, counts real entries', () => {
  // The real failures.md ships with the entry format inside an HTML comment.
  const md = [
    '# Failure Log',
    '<!-- ENTRY FORMAT:',
    '## Group {ID} — Failure #{N}',
    '- **Category:** {lint_format}',
    '-->',
    '',
    '## Group G7 — Failure #1',
    '- **Category:** type_error',
    '## Group G7 — Failure #2',
    '- **Category:** type_error',
    '## Group G9 — Failure #1',
    '- **Category:** test_failure',
  ].join('\n');
  const r = parseFailures(md);
  assert.strictEqual(r.total, 3, 'template entry must not be counted');
  assert.deepStrictEqual(r.byCategory, { type_error: 2, test_failure: 1 });
});

test('parseFailures: empty / template-only file yields zero', () => {
  const md = '# Failure Log\n<!-- ## Group {ID} — Failure #{N} -->\n';
  assert.deepStrictEqual(parseFailures(md), { total: 0, byCategory: {} });
});

// --- countRules ------------------------------------------------------------

test('countRules: counts h2 rule headings, ignores comments and the h1 title', () => {
  const md = [
    '# Learned Rules',
    '<!-- Monotonic — ## not a rule -->',
    '## Rule 1',
    'body',
    '## Rule 2',
  ].join('\n');
  assert.strictEqual(countRules(md), 2);
  assert.strictEqual(countRules('# Learned Rules\n<!-- header only -->\n'), 0);
});

test('countRules: also counts h3 rule headings (process-rules.md real format), still ignores h1', () => {
  // process-rules.md ships entries as `### PR-default-NN — ...`, not `##`.
  const md = [
    '# Process Rules',
    '<!-- Monotonic **workflow** constraints -->',
    '### PR-default-01 — no destructive git during parallel implement',
    '- **Rule:** never run git stash while parallel implement is active',
    '### PR-default-02 — no stub-to-green',
    '- **Rule:** do not clear compile/lint by shipping stub markers',
  ].join('\n');
  assert.strictEqual(countRules(md), 2, 'h3 rule entries must be counted');
  assert.strictEqual(countRules('# Process Rules\n<!-- header only -->\n'), 0, 'h1 title alone must not count');
});

test('countRules: mixed h2/h3 file counts both levels', () => {
  const md = ['# Rules', '## Rule A', '### Sub-rule B'].join('\n');
  assert.strictEqual(countRules(md), 2);
});

// --- summarizeTelemetry ----------------------------------------------------

test('summarizeTelemetry: tallies kinds and computes tool error rate, skips bad lines', () => {
  const lines = [
    JSON.stringify({ kind: 'tool', exit: 'ok', lane: 'auto' }),
    JSON.stringify({ kind: 'tool', exit: 'error', lane: 'auto' }),
    JSON.stringify({ kind: 'tool', exit: 'ok', lane: 'gate' }),
    JSON.stringify({ kind: 'turn', lane: 'auto' }),
    JSON.stringify({ kind: 'prompt' }),
    JSON.stringify({ kind: 'subagent_stop' }),
    'not json at all',
  ];
  const s = summarizeTelemetry(lines);
  assert.strictEqual(s.tools, 3);
  assert.strictEqual(s.toolErrors, 1);
  assert.strictEqual(s.toolErrorRate, +(1 / 3).toFixed(4));
  assert.strictEqual(s.turns, 1);
  assert.strictEqual(s.prompts, 1);
  assert.strictEqual(s.subagents, 1);
  assert.deepStrictEqual(s.byLane, { auto: 3, gate: 1 });
});

test('summarizeTelemetry: no tools -> zero error rate, never NaN', () => {
  const s = summarizeTelemetry([JSON.stringify({ kind: 'turn' })]);
  assert.strictEqual(s.toolErrorRate, 0);
});

// --- readFlakeCount / readBaselineNum --------------------------------------

test('readFlakeCount: counts jsonl lines, 0 when missing or empty', () => {
  const root = tmpRoot();
  assert.strictEqual(readFlakeCount(root), 0);
  writeFile(root, 'specs/drift/flake-history.jsonl', '{"t":"a"}\n{"t":"b"}\n');
  assert.strictEqual(readFlakeCount(root), 2);
});

test('readBaselineNum: parses numeric baseline, null when absent or non-numeric', () => {
  const root = tmpRoot();
  assert.strictEqual(readBaselineNum(root, '.claude/state/cycle-baseline.txt'), null);
  writeFile(root, '.claude/state/cycle-baseline.txt', '0\n');
  assert.strictEqual(readBaselineNum(root, '.claude/state/cycle-baseline.txt'), 0);
  writeFile(root, '.claude/state/coverage-baseline.txt', '80');
  assert.strictEqual(readBaselineNum(root, '.claude/state/coverage-baseline.txt'), 80);
});

// --- buildScorecard (integration over a tmp root) --------------------------

test('buildScorecard: assembles signals from real on-disk state shapes', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/failures.md',
    '# Failure Log\n## Group G1 — Failure #1\n- **Category:** test_failure\n'
    + '## Group G1 — Failure #2\n- **Category:** test_failure\n');
  writeFile(root, '.claude/state/learned-rules.md', '# Learned Rules\n## Rule A\n');
  // Real process-rules.md format is h3, not h2 — this is the shape REC-20260713-001 fixed.
  writeFile(root, '.claude/state/process-rules.md', '# Process\n### PR-default-01 — foo\n### PR-default-02 — bar\n');
  writeFile(root, '.claude/state/telemetry-ledger.jsonl',
    [JSON.stringify({ kind: 'tool', exit: 'ok', lane: 'auto' }),
     JSON.stringify({ kind: 'tool', exit: 'error', lane: 'auto' })].join('\n'));
  writeFile(root, '.claude/state/cycle-baseline.txt', '0');
  writeFile(root, '.claude/state/coverage-baseline.txt', '80');

  const s = buildScorecard(root);
  assert.strictEqual(s.signals.failures.total, 2);
  assert.deepStrictEqual(s.signals.failures.byCategory, { test_failure: 2 });
  assert.strictEqual(s.signals.learnedRules, 1);
  assert.strictEqual(s.signals.processRules, 2);
  assert.strictEqual(s.signals.telemetry.tools, 2);
  assert.strictEqual(s.signals.telemetry.toolErrors, 1);
  assert.strictEqual(s.signals.baselines.cycle, 0);
  assert.strictEqual(s.signals.baselines.coverage, 80);
  assert.ok(Array.isArray(s.notes));
  // A category that recurred >=2x meets the SECTION 12 extraction threshold.
  assert.ok(s.notes.some((n) => /recurred/i.test(n)));
});

test('buildScorecard: missing state degrades to zeros, never throws', () => {
  const s = buildScorecard(tmpRoot());
  assert.strictEqual(s.signals.failures.total, 0);
  assert.strictEqual(s.signals.telemetry.events, 0);
  assert.strictEqual(s.signals.baselines.cycle, null);
});

// --- renderMd --------------------------------------------------------------

test('renderMd: produces a human-readable scorecard with the generated stamp', () => {
  const s = buildScorecard(tmpRoot());
  const md = renderMd(s, '2026-07-13T00:00:00.000Z');
  assert.match(md, /# Loop-health scorecard/);
  assert.match(md, /2026-07-13T00:00:00\.000Z/);
});

test('renderMd: no lane data renders a placeholder, not an empty section', () => {
  const s = buildScorecard(tmpRoot());
  const md = renderMd(s, '2026-07-13T00:00:00.000Z');
  assert.match(md, /## Lane activity/);
  assert.match(md, /No lane data\./);
});

// --- deriveNotes / renderMd: lane skew (REC-20260713-004) -------------------

test('deriveNotes: flags when one lane accounts for >=90% of events with >=20 total', () => {
  const telemetry = summarizeTelemetry([
    ...Array(19).fill(JSON.stringify({ kind: 'turn', lane: 'loop' })),
    JSON.stringify({ kind: 'turn', lane: 'claude-api' }),
  ]);
  const notes = deriveNotes({
    failures: { total: 0, byCategory: {} }, learnedRules: 0, telemetry, flakeEvents: 0,
  });
  assert.ok(notes.some((n) => /Lane "loop"/.test(n) && /skewed/.test(n)));
});

test('deriveNotes: no lane-skew note below the 20-event floor even at 100% share', () => {
  const telemetry = summarizeTelemetry(
    Array(10).fill(JSON.stringify({ kind: 'turn', lane: 'loop' })),
  );
  const notes = deriveNotes({
    failures: { total: 0, byCategory: {} }, learnedRules: 0, telemetry, flakeEvents: 0,
  });
  assert.ok(!notes.some((n) => /skewed/.test(n)));
});

test('deriveNotes: no lane-skew note when share is under 90%', () => {
  const telemetry = summarizeTelemetry([
    ...Array(15).fill(JSON.stringify({ kind: 'turn', lane: 'loop' })),
    ...Array(10).fill(JSON.stringify({ kind: 'turn', lane: 'claude-api' })),
  ]);
  const notes = deriveNotes({
    failures: { total: 0, byCategory: {} }, learnedRules: 0, telemetry, flakeEvents: 0,
  });
  assert.ok(!notes.some((n) => /skewed/.test(n)));
});

// --- lead-turn efficiency (Cognition "Making Fable Cheaper Than Opus") -------

function telemetryWith(turns, subagents) {
  return summarizeTelemetry([
    ...Array(turns).fill(JSON.stringify({ kind: 'turn', lane: 'auto' })),
    ...Array(subagents).fill(JSON.stringify({ kind: 'subagent_stop', lane: 'auto' })),
  ]);
}

test('leadTurnNotes: flags a high turns-per-dispatch ratio above the attention line', () => {
  const notes = leadTurnNotes(telemetryWith(20, 2)); // 10:1, deeply lead-heavy
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /turns\/dispatch/);
  assert.match(notes[0], /attention line/);
  assert.match(notes[0], /lead/i);
  // 20 turns, 20 dispatches -> 1:1, well-delegated, not accruing -> no note.
  assert.deepStrictEqual(leadTurnNotes(telemetryWith(20, 20)), []);
  // Pin the attention line at exactly 4:1 (>= inclusive): 20/6=3.33 -> [],
  // 20/5=4.0 -> fires. Guards the constant + operator against silent regression.
  assert.deepStrictEqual(leadTurnNotes(telemetryWith(20, 6)), []);
  assert.strictEqual(leadTurnNotes(telemetryWith(20, 5)).length, 1);
});

test('leadTurnNotes: defers below the min-turns floor, never fires on empty', () => {
  const accruing = leadTurnNotes(telemetryWith(3, 0));
  assert.strictEqual(accruing.length, 1);
  assert.match(accruing[0], /accruing/i);
  assert.match(accruing[0], /deferred/i);
  assert.deepStrictEqual(leadTurnNotes(telemetryWith(0, 0)), []); // never vacuous
});

test('leadTurnNotes: zero dispatches with enough turns flags lead-loop concentration', () => {
  const notes = leadTurnNotes(telemetryWith(15, 0));
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /0 subagent dispatches/);
  assert.match(notes[0], /lead/i);
});

test('deriveNotes: wires the lead-turn note through the scorecard signals', () => {
  const notes = deriveNotes({
    failures: { total: 0, byCategory: {} }, learnedRules: 0,
    telemetry: telemetryWith(20, 2), flakeEvents: 0,
  });
  assert.ok(notes.some((n) => /turns\/dispatch/.test(n)));
});

test('leadTurnRatioCell: renders a ratio, n/a for empty, and the zero-dispatch shape', () => {
  assert.match(leadTurnRatioCell(telemetryWith(20, 2)), /10\.0/);
  assert.match(leadTurnRatioCell(telemetryWith(0, 0)), /n\/a/i);
  assert.match(leadTurnRatioCell(telemetryWith(15, 0)), /0 dispatch/);
  // Below the floor: raw counts, not a ratio (matches the deferred note).
  assert.strictEqual(leadTurnRatioCell(telemetryWith(5, 2)), '5 turns / 2 dispatches');
});

test('renderMd: shows the lead-turn ratio row and the not-in-loop-observable caveat', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/telemetry-ledger.jsonl', [
    ...Array(20).fill(JSON.stringify({ kind: 'turn', lane: 'auto' })),
    ...Array(2).fill(JSON.stringify({ kind: 'subagent_stop', lane: 'auto' })),
  ].join('\n'));
  const md = renderMd(buildScorecard(root), '2026-07-15T00:00:00.000Z');
  assert.match(md, /Lead-turn ratio/);
  assert.match(md, /not in-loop-observable/i);
  assert.match(md, /cost-report/);
});

test('renderMd: surfaces the byLane breakdown sorted by count desc', () => {
  const root = tmpRoot();
  writeFile(root, '.claude/state/telemetry-ledger.jsonl', [
    JSON.stringify({ kind: 'turn', lane: 'claude-api' }),
    JSON.stringify({ kind: 'turn', lane: 'loop' }),
    JSON.stringify({ kind: 'turn', lane: 'loop' }),
  ].join('\n'));
  const s = buildScorecard(root);
  const md = renderMd(s, '2026-07-13T00:00:00.000Z');
  assert.match(md, /## Lane activity/);
  assert.match(md, /\| loop \| 2 \|/);
  assert.match(md, /\| claude-api \| 1 \|/);
  const loopIdx = md.indexOf('| loop | 2 |');
  const apiIdx = md.indexOf('| claude-api | 1 |');
  assert.ok(loopIdx < apiIdx, 'higher-count lane must be listed first');
});
