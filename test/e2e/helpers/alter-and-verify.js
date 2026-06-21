'use strict';

// After a build, exercise the "extend already-generated code" path: map the
// generated codebase with /code-map (the deterministic dependency-graph + wiki
// producer — seconds, no LLM essays), then alter its behavior with /change
// grounded in that graph. The generated project's own suite (now covering the
// new behavior) is the oracle.
//
// We call /code-map directly rather than /brownfield: /change only needs
// code-graph.json (see code-map's Consumers table), and /brownfield's six
// LLM-written narrative essays are the slow part we deliberately skip here.

const fs = require('fs');
const path = require('path');
const { runProjectSuite } = require('./project-suite');

function alterAndVerify(runClaude, baseOpts, { projectDir, changeDesc }) {
  const t0 = Date.now();
  const map = runClaude('/code-map build the dependency graph for this generated codebase', {
    ...baseOpts, continueSession: true, budgetUsd: '2.00', timeoutMs: 240000,
  });
  const mapSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[alter] /code-map (deterministic graph+wiki) took ${mapSec}s`);
  const codeGraph = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const wiki = path.join(projectDir, 'specs', 'brownfield', 'wiki', 'WIKI.md');

  const t1 = Date.now();
  const change = runClaude(`/change ${changeDesc}`, {
    ...baseOpts, continueSession: true, budgetUsd: '5.00', timeoutMs: 540000,
  });
  console.log(`[alter] /change took ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const suite = runProjectSuite(projectDir);
  return {
    mapExit: map.exitCode,
    codeGraph,
    codeGraphExists: fs.existsSync(codeGraph),
    wikiExists: fs.existsSync(wiki),
    changeExit: change.exitCode,
    suite,
  };
}

module.exports = { alterAndVerify };
