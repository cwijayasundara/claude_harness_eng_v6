'use strict';

// Shared helpers for the agent-readiness report (gap G21) pillar modules
// (agent-readiness.js, agent-readiness-project.js). Kept in its own file so
// neither pillar module has to require the other (would be circular) —
// both require only this one, dependency-free, module.

const fs = require('fs');
const toolchain = require('./toolchain');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

// One pillar's verdict. Reuses harness-manifest.json#model.statuses' exact
// vocabulary (active/partial/planned) rather than inventing new names.
// remediation is nulled on 'active' so renderers don't need their own check.
function pillar(id, label, status, detail, remediation) {
  return { id, label, status, detail, remediation: status === 'active' ? null : remediation };
}

function bool(v) {
  return v ? 'yes' : 'no';
}

function hasNpmScript(root, name) {
  const pkg = readJsonSafe(require('path').join(root, 'package.json'));
  return !!(pkg && pkg.scripts && pkg.scripts[name]);
}

// Reuses toolchain.js's own provisioning-detection pattern (run + skipped) —
// the same primitives verify-on-save.js and security-scan.js are built on —
// instead of a bespoke `which <tool>` check. Injectable so pillar tests can
// fixture provisioning deterministically without spawning real processes.
function defaultToolCheck(cmd, cwd) {
  const res = toolchain.run(cmd, cwd, 8000);
  return !toolchain.skipped(res);
}

module.exports = { readJsonSafe, pillar, bool, hasNpmScript, defaultToolCheck };
