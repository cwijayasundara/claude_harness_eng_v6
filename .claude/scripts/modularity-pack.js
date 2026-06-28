#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/modularity-pack.js
// Builds the deterministic grounding pack for the inferential modularity review
// (gap G6) from specs/brownfield/code-graph.json: hubs (pre-classified
// legitimate vs suspicious), cycles, and duplication candidates. Writes
// specs/brownfield/modularity-pack.md (+ .json) for the modularity-reviewer
// agent to judge against the source. Exit 0 = pack written, 2 = no graph.

const fs = require('fs');
const path = require('path');
const { buildPack, renderBrief } = require('../hooks/lib/modularity-pack');

const REPO = process.cwd();
const GRAPH = path.join(REPO, 'specs', 'brownfield', 'code-graph.json');
const OUT_DIR = path.join(REPO, 'specs', 'brownfield');

function main() {
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  } catch (err) {
    process.stderr.write(`modularity-pack: no code-graph at ${GRAPH} — run /code-map or /brownfield first.\n`);
    process.exit(2);
  }
  const pack = buildPack(graph);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'modularity-pack.md'), renderBrief(pack));
  fs.writeFileSync(path.join(OUT_DIR, 'modularity-pack.json'), JSON.stringify(pack, null, 2) + '\n');
  process.stdout.write(
    `modularity-pack OK: ${pack.hubs.length} hubs, ${pack.cycles.length} cycles, ` +
    `${pack.duplicationCandidates.length} duplication candidates → specs/brownfield/modularity-pack.md\n`
  );
  process.exit(0);
}

if (require.main === module) main();
