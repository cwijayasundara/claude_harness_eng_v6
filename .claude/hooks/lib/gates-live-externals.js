'use strict';

// Pre-commit wrapper for the live-externals sensor (gap G36). Kept in its own
// module (not gates-early.js) so the new gate does not require touching that
// file's pre-existing grandfathered length violations. Wired into GATE_CATALOG
// in gate-registry.js. Pure classification lives in hooks/lib/live-externals-gate.js.

const { execFileSync } = require('child_process');
const { failBlock, noteSkip, requireScript, gitExec } = require('./pre-commit-util');

function checkLiveExternalsGate(ctx) {
  const { projectDir } = ctx;
  if (process.env.HARNESS_LIVE_EXTERNALS_GATE === 'off') {
    noteSkip('live-externals', 'HARNESS_LIVE_EXTERNALS_GATE=off');
    return;
  }
  let gate;
  try {
    gate = requireScript('live-externals-gate');
  } catch (_) {
    noteSkip('live-externals', 'sensor script missing or unloadable from .claude/scripts');
    return;
  }
  const exec = gitExec(projectDir);
  const verdict = gate.checkStaged(exec);
  if (!verdict.pass) {
    failBlock({
      id: 'live-externals',
      title: 'live-externals (G36) — a staged integration/e2e test reaches a real external system',
      detail: `${verdict.findings.map(gate.findingLine).join('\n')}\n`,
      fix: 'route the call through the boundary-test-doubles kit (Python or .ts sibling): replay the HTTP wrapper (ReplayTransport), use FakeLLMClient for model calls, and the DB transactional fixture — bind them under HARNESS_TEST_REPLAY=1. See .claude/templates/boundary-doubles/. For a deliberately-live line (e.g. a staging smoke test), annotate it with `harness:live-ok`.',
      waive: 'genuine live-integration exception in specs/reviews/sensor-waivers.json (sensor_id: live-externals)',
      envOff: 'HARNESS_LIVE_EXTERNALS_GATE',
      minTier: 'standard',
    });
  }
}

module.exports = { checkLiveExternalsGate };
