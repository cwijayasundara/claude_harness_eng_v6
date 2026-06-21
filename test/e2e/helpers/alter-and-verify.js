'use strict';

// After a build, exercise the "extend already-generated code" path: map the
// generated codebase with /brownfield (which runs /code-map → specs/brownfield/
// code-graph.json), then alter its behavior with /change grounded in that map.
// The generated project's own suite (now covering the new behavior) is the oracle.

const fs = require('fs');
const path = require('path');
const { runProjectSuite } = require('./project-suite');

function alterAndVerify(runClaude, baseOpts, { projectDir, changeDesc }) {
  const bf = runClaude('/brownfield map this generated codebase', {
    ...baseOpts, continueSession: true, budgetUsd: '4.00', timeoutMs: 480000,
  });
  const codeGraph = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');

  const change = runClaude(`/change ${changeDesc}`, {
    ...baseOpts, continueSession: true, budgetUsd: '5.00', timeoutMs: 540000,
  });

  const suite = runProjectSuite(projectDir);
  return {
    brownfieldExit: bf.exitCode,
    codeGraph,
    codeGraphExists: fs.existsSync(codeGraph),
    changeExit: change.exitCode,
    suite,
  };
}

module.exports = { alterAndVerify };
