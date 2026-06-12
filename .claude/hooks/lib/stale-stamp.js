'use strict';

// dependency-graph.md and coupling-report.md are derived from code-graph.json
// by a full /code-map run only; the graph-refresh hook patches the graph
// incrementally and cannot rebuild them. Stamp them STALE the moment the
// graph moves on, so a planning step that reads them sees the warning instead
// of trusting silently outdated coupling data. A fresh /code-map run rewrites
// the files and the banner disappears with them.

const fs = require('fs');
const path = require('path');

const STALE_MARK = '> STALE since ';
const DERIVED = ['dependency-graph.md', 'coupling-report.md'];

function stamp(file, note) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return;
  }
  if (content.startsWith(STALE_MARK)) {
    const bodyStart = content.indexOf('\n\n');
    content = bodyStart === -1 ? '' : content.slice(bodyStart + 2);
  }
  try {
    fs.writeFileSync(file, note + content);
  } catch (_) {
    /* advisory only — never break the refresh */
  }
}

function stampDerived(projectDir, rels) {
  const note =
    `${STALE_MARK}${new Date().toISOString()} — code-graph.json was patched (${rels.length} file(s) re-indexed) ` +
    `after this artifact was rendered. Re-run /code-map to regenerate it before using it for planning.\n\n`;
  for (const name of DERIVED) {
    stamp(path.join(projectDir, 'specs', 'brownfield', name), note);
  }
}

module.exports = { stampDerived, STALE_MARK };
