'use strict';

// Pre-commit wrapper for the hallucinated-dependency / slopsquat sensor.
// Own module so gates-early.js stays untouched. Wired via GATE_CATALOG.

const { failBlock, noteSkip, requireScript, gitExec } = require('./pre-commit-util');

function checkRegistryNames(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_REGISTRY_NAME_GATE === 'off') {
    noteSkip('registry-names', 'HARNESS_REGISTRY_NAME_GATE=off');
    return;
  }
  let gate;
  try {
    gate = requireScript('registry-name-gate');
  } catch (_) {
    noteSkip('registry-names', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const verdict = gate.checkStaged(gitExec(projectDir));
  if (!verdict.pass) {
    failBlock({
      id: 'registry-names',
      title: 'registry-names — a staged dependency or import is hallucinated or a slopsquat',
      detail: `${verdict.findings.map(gate.findingLine).join('\n')}\n`,
      fix: 'use the real package name (check the near-popular hint), add it to package.json/requirements from the registry, and do not invent imports.',
      waive: 'genuine exception in specs/reviews/sensor-waivers.json (sensor_id: registry-names)',
      envOff: 'HARNESS_REGISTRY_NAME_GATE',
      minTier: 'standard',
    });
  }
}

module.exports = { checkRegistryNames };
