#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/naming-clusters.js
// Deterministic evidence for brownfield Step 6 (domain glossary): clusters
// recurring root nouns from specs/brownfield/code-graph.json's symbol lists
// and writes specs/brownfield/naming-clusters.md for the brownfield skill's
// LLM pass to confirm into CONTEXT.md. Exit 0 = written, 2 = no graph.

const fs = require('fs');
const path = require('path');
const { clusterNamingEvidence, renderCandidates } = require('../hooks/lib/naming-clusters');

const REPO = process.cwd();
const GRAPH = path.join(REPO, 'specs', 'brownfield', 'code-graph.json');
const OUT = path.join(REPO, 'specs', 'brownfield', 'naming-clusters.md');

function main() {
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  } catch (err) {
    process.stderr.write(`naming-clusters: no code-graph at ${GRAPH} — run /code-map or /brownfield first.\n`);
    process.exit(2);
  }
  const clusters = clusterNamingEvidence(graph);
  fs.writeFileSync(OUT, renderCandidates(clusters) + '\n');
  process.stdout.write(`naming-clusters OK: ${clusters.length} candidate term(s) → specs/brownfield/naming-clusters.md\n`);
  process.exit(0);
}

if (require.main === module) main();
