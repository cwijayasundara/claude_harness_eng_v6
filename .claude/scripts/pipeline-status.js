#!/usr/bin/env node
'use strict';

// CLI-friendly SDLC pipeline progress view (Devin-style status / watch / timeline).
// Reads only what the harness already writes; produces one snapshot object and
// renders it. A plain node script so it works outside a Claude session — watch a
// running /auto from a second terminal. The /status skill wraps it in-session.
// See docs/internal/PIPELINE_PROGRESS_PROPOSAL_2026-06-21.md.

const { buildSnapshot } = require('./pipeline-snapshot');
const { readRunReceipts, findProjectDir } = require('./pipeline-state-readers');

// ---------- presenters ----------

function fmtCoverage(c) {
  if (c.current == null) return 'n/a';
  const base = c.baseline != null ? ` (baseline ${c.baseline}%)` : '';
  return `${c.current}%${base}`;
}

function fmtConfidence(c) {
  const drivers = c.drivers.map((d) => d.detail).join(', ') || 'no risk drivers';
  const thr = c.threshold != null ? `  threshold=${c.threshold}` : '';
  return `Plan:      confidence=${c.band} (${drivers})${thr}`;
}

function renderStatus(s) {
  const lines = [
    `Pipeline status — ${s.phase}  [${s.health}]`,
    `Run:       lane=${s.run.lane || '-'}  mode=${s.run.mode || '-'}  session=${s.run.session_id || '-'}`,
  ];
  if (s.confidence) lines.push(fmtConfidence(s.confidence));
  lines.push(
    `Groups:    ${s.wave.current}/${s.wave.total}  done=[${s.groups.completed.join(', ')}]  current=${s.groups.current || 'none'}  remaining=[${s.groups.remaining.join(', ')}]`,
    `Features:  ${s.features.passing} / ${s.features.total} passing`,
    `Coverage:  ${fmtCoverage(s.coverage)}`,
    `Iteration: ${s.iteration.current}/${s.iteration.max} (group ${s.iteration.group || '-'})`,
    `Reviews:   ${s.pending_reviews} pending`,
    `Next:      ${s.next_action || '-'}`,
  );
  if (s.stories.blocked.length) lines.push(`Blocked:   ${s.stories.blocked.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function glyph(exit) {
  if (exit === 'error') return '✗';
  if (exit === 'ok' || exit == null) return '✓';
  return '•';
}

function stepLine(r) {
  const label = r.agent || r.command || r.tool || r.kind || 'step';
  const group = r.group_id && r.group_id !== 'none' ? r.group_id : null;
  const where = group ? ` [group ${group}]` : '';
  return `${glyph(r.exit)} ${r.ts || ''}  ${r.kind}: ${label}${where}`;
}

function timelineSteps(records, snapshot) {
  const sid = snapshot.run.session_id;
  return records.filter((r) => !sid || r.session_id === sid);
}

function renderTimeline(records, snapshot) {
  const steps = timelineSteps(records, snapshot);
  if (steps.length === 0) return 'No steps recorded for the current session.\n';
  return `${steps.map(stepLine).join('\n')}\n`;
}

// ---------- CLI ----------

function snapshotForCwd() {
  const projectDir = findProjectDir(process.cwd());
  if (!projectDir) {
    process.stderr.write('No .claude/ directory found.\n');
    process.exit(1);
  }
  return { projectDir, snapshot: buildSnapshot(projectDir) };
}

function runStatus(json) {
  const { snapshot } = snapshotForCwd();
  process.stdout.write(json ? `${JSON.stringify(snapshot, null, 2)}\n` : renderStatus(snapshot));
}

function runTimeline(json) {
  const { projectDir, snapshot } = snapshotForCwd();
  const records = readRunReceipts(projectDir);
  if (json) {
    process.stdout.write(`${JSON.stringify(timelineSteps(records, snapshot), null, 2)}\n`);
    return;
  }
  process.stdout.write(renderTimeline(records, snapshot));
}

// A single watch frame: clear-screen + home cursor, then the rendered snapshot.
function watchFrame(snapshot, json) {
  const body = json ? `${JSON.stringify(snapshot)}\n` : renderStatus(snapshot);
  return `\x1b[2J\x1b[H${body}`;
}

function runWatch(json, intervalMs) {
  const tick = () => {
    process.stdout.write(watchFrame(snapshotForCwd().snapshot, json));
  };
  tick();
  setInterval(tick, intervalMs);
}

function parseInterval(args) {
  const i = args.indexOf('--interval');
  const n = i !== -1 ? parseInt(args[i + 1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : 3000;
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const cmd = args.find((a) => !a.startsWith('-')) || 'status';
  if (cmd === 'status') return runStatus(json);
  if (cmd === 'timeline') return runTimeline(json);
  if (cmd === 'watch') return runWatch(json, parseInterval(args));
  process.stderr.write(`Unknown command: ${cmd}\nUsage: pipeline-status [status|watch|timeline] [--json] [--interval N]\n`);
  return process.exit(2);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  buildSnapshot,
  renderStatus,
  renderTimeline,
  watchFrame,
  readRunReceipts,
  findProjectDir,
};
