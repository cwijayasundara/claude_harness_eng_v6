#!/usr/bin/env node
'use strict';

// CLI for reuse-scout (design spec C3). Non-gate feedforward tool: ranks the
// existing seam a new story could extend and whether to fire the reuse dialogue.
// Degrades loud (announce + low result, exit 0) when inputs are missing.

const fs = require('fs');
const path = require('path');
const { scoutReuse } = require('../hooks/lib/reuse-scout');

const REPO = path.resolve(__dirname, '..', '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function readMaybe(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return undefined; } }

// --batch accepts a story-list JSON file OR a directory of per-story JSON files
// (e.g. specs/stories/sprint-N/). A directory is the natural shape /sprint and
// /feature epics already produce, so glob its *.json and normalise each story to
// {id, goal}; a bare file path is read directly. Returns undefined when there is
// nothing usable — never throws (a directory passed to readFileSync throws EISDIR).
function readBatch(batchArg) {
  if (!batchArg) return undefined;
  const abs = path.resolve(REPO, batchArg);
  let stat;
  try { stat = fs.statSync(abs); } catch (_) { return undefined; }
  const items = [];
  const collect = (text) => {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return; }
    for (const s of (Array.isArray(parsed) ? parsed : [parsed])) {
      if (s && s.id) items.push({ id: s.id, goal: s.goal || s.text || s.title || s.name || '' });
    }
  };
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) {
      if (name.endsWith('.json')) { const t = readMaybe(path.join(abs, name)); if (t) collect(t); }
    }
  } else {
    const t = readMaybe(abs);
    if (t) collect(t);
  }
  return items.length ? items : undefined;
}

function main() {
  const graphPath = path.resolve(REPO, arg('--graph', 'specs/brownfield/code-graph.json'));
  const goal = arg('--goal', '');
  const constitutionText = readMaybe(path.resolve(REPO, arg('--constitution', 'specs/design/constitution.md')));
  const batch = readBatch(arg('--batch', ''));
  const outPath = arg('--out', '');

  const graphText = readMaybe(graphPath);
  let result;
  if (!graphText) {
    result = { fire: false, band: 'low', target_seam: null, candidates: [], touched_invariants: [], intra_batch: [], reasons: [`code-graph not found at ${graphPath} — run /code-map first (loud skip)`] };
  } else {
    let graph = {};
    try { graph = JSON.parse(graphText); } catch (_) { graph = { nodes: [], edges: [], metrics: {} }; }
    result = scoutReuse({ graph, goal, invariantsText: constitutionText, batch });
  }

  const json = JSON.stringify(result, null, 2);
  if (outPath) { try { fs.writeFileSync(path.resolve(REPO, outPath), json + '\n'); } catch (_) { /* best effort */ } }
  process.stdout.write(json + '\n');
  process.exit(0);
}

if (require.main === module) main();
module.exports = { main };
