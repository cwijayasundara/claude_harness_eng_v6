'use strict';

// Mutation-smoke pre-commit gate. VERIFICATION pack: it only runs inside an /auto
// build and needs the mutation runner. Split out of gates-quality (kernel) so the
// kernel commit gate does not require mutation-gate.

const { runMutationOnFiles, renderSurvivors } = require('./mutation-gate');
const { failBlock, noteSkip, inAutoBuild } = require('./pre-commit-util');

function checkMutation(ctx) {
  const { projectDir, stagedSource } = ctx;
  if ((process.env.HARNESS_MUTATION_GATE || '').toLowerCase() === 'off') return;
  if (!inAutoBuild(projectDir)) return;
  const { results, blocked } = runMutationOnFiles(stagedSource, projectDir, {});
  for (const r of results) {
    if (r.skipped) noteSkip(`Mutation-smoke (${r.lang})`, r.reason);
  }
  if (blocked.length === 0) return;
  const detail = blocked.map((r) => renderSurvivors(r.survived)).filter(Boolean).join('\n');
  failBlock({
    id: 'mutation-smoke',
    title: 'mutation-smoke found tests that pass but don\'t bite (survivors)',
    detail: `${detail}\n`,
    fix: 'add an assertion that fails when the flipped operator above is applied — test the boundary (off-by-one) or the false branch — then re-commit.',
    envOff: 'HARNESS_MUTATION_GATE',
    minTier: 'standard',
  });
}


module.exports = { checkMutation };
