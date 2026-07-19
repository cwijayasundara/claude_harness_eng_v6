'use strict';

// Strict-tier only: cycle + coupling ratchets at pre-commit (same logic as CLI).

const fs = require('fs');
const path = require('path');
const { failBlock, noteSkip } = require('./pre-commit-util');

// Lazy-require cycle/coupling (coupling-gate pulls drift.js → code-map scripts
// that fixtures do not copy). Only load when a strict gate actually runs.

function checkCycleDetection(ctx) {
  const { cycleKeys, gateDecision } = require('./cycle-gate');
  const { projectDir } = ctx;
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const baselinePath = path.join(projectDir, '.claude', 'state', 'cycle-baseline.txt');
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (_) {
    noteSkip('cycle-detection', 'no code-graph (run /code-map or /brownfield first)');
    return;
  }
  let baseline;
  try {
    const n = parseFloat(fs.readFileSync(baselinePath, 'utf8').trim());
    baseline = Number.isFinite(n) ? n : undefined;
  } catch (_) {
    baseline = undefined;
  }
  const keys = cycleKeys(graph);
  const d = gateDecision(keys, baseline);
  if (d.blocked) {
    failBlock({
      id: 'cycle-detection',
      title: `import cycles increased ${d.baseline} -> ${d.count} (the ratchet only goes down)`,
      detail: keys.map((k) => `  - ${k}`).join('\n') + '\n',
      fix: 'break the new cycle (extract the shared piece, or invert one dependency), then retry.',
      minTier: 'strict',
    });
  }
  try {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${d.newBaseline}\n`);
  } catch (_) { /* best effort */ }
}

function checkCouplingRatchet(ctx) {
  const { unstableHubKeys } = require('./coupling-gate');
  const { gateDecision } = require('./cycle-gate');
  const { projectDir } = ctx;
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  const baselinePath = path.join(projectDir, '.claude', 'state', 'coupling-baseline.txt');
  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (_) {
    noteSkip('coupling-ratchet', 'no code-graph (run /code-map or /brownfield first)');
    return;
  }
  let prevIds;
  try {
    prevIds = fs.readFileSync(baselinePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    prevIds = undefined;
  }
  const keys = unstableHubKeys(graph);
  // Reuse cycle gateDecision on counts (same as scripts/coupling-gate.js)
  const d = gateDecision(keys, prevIds === undefined ? undefined : prevIds.length);
  if (d.blocked) {
    const prevSet = new Set(prevIds || []);
    const newIds = keys.filter((id) => !prevSet.has(id));
    const hubs = ((((graph || {}).metrics) || {}).unstable_hubs)
      || ((((graph || {}).metrics) || {}).hubs)
      || [];
    const hubDetail = (id) => {
      const h = hubs.find((x) => x.id === id);
      if (!h) return `  - ${id}`;
      return `  - ${id} (fan_in=${h.fan_in}, instability=${Number(h.instability).toFixed(2)})`;
    };
    failBlock({
      id: 'coupling-ratchet',
      title: `unstable-hub count increased ${d.baseline} -> ${d.count} (the ratchet only goes down)`,
      detail: newIds.map(hubDetail).join('\n') + '\n',
      fix:
        "extract a narrower interface for each hub above so its dependents stop coupling to " +
        "the file's full surface — split responsibilities, or introduce a facade exposing only the " +
        'members callers actually use. Either move lowers fan-in without touching every caller at once. Then retry.',
      minTier: 'strict',
    });
  }
  try {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, keys.length ? `${keys.join('\n')}\n` : '');
  } catch (_) { /* best effort */ }
}

function readManifestSastEngine(projectDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    return m && m.quality && m.quality.sast_engine;
  } catch (_) { return undefined; }
}

// Increment 2, C4: the ruleset's require_code_owner_review flag drives whether the
// wiring gate also demands a real .github/CODEOWNERS.
function readRequireCodeOwnerReview(projectDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    return !!(m && m.github && m.github.require_code_owner_review === true);
  } catch (_) { return false; }
}

// Read a specific 1-based line from a source file (for harness:secret-ok checks).
function readSourceLine(projectDir, file, line) {
  const body = fs.readFileSync(path.join(projectDir, file), 'utf8');
  return body.split('\n')[line - 1];
}

function readSecurityBaseline(baselinePath) {
  try {
    return fs.readFileSync(baselinePath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (_) { return undefined; }
}

function writeSecurityBaseline(baselinePath, keys) {
  try {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, keys.length ? `${keys.join('\n')}\n` : '');
  } catch (_) { /* best effort, same as the sibling ratchets */ }
}

function blockMissingScanners(missing) {
  failBlock({
    id: 'security-baseline',
    title: `required security scanner(s) not installed: ${missing.join(', ')}`,
    fix: 'install the scanner(s) to enable the strict-tier enforced path, or lower quality.sensor_tier.',
    minTier: 'strict',
  });
}

function blockSecrets(secrets) {
  failBlock({
    id: 'security-baseline',
    title: `${secrets.length} secret finding(s) — secrets are absolute, never grandfathered`,
    detail: secrets.map((s) => `  - ${s.tool}:${s.rule} ${s.file || '?'}${s.line ? ':' + s.line : ''}`).join('\n') + '\n',
    fix: 'remove the secret (rotate it if it was ever committed), or mark a reviewed test-fixture line with harness:secret-ok.',
    minTier: 'strict',
  });
}

function blockSast(d) {
  failBlock({
    id: 'security-baseline',
    title: `${d.addedSast.length} new high/critical SAST finding(s) introduced (the ratchet only goes down — a fix-one-add-another swap still blocks)`,
    detail: d.addedSast.map((k) => `  - new finding ${k}`).join('\n') + '\n',
    fix: 'fix the newly introduced finding(s), or suppress with a reviewed rule exception — do not raise the baseline.',
    minTier: 'strict',
  });
}

// C2: security-baseline ratchet (mechanics mirror checkDuplicationRatchet).
function checkSecurityBaseline(ctx) {
  if (process.env.HARNESS_SECURITY_BASELINE_GATE === 'off') return;
  let collectTiered;
  try { ({ collectTiered } = require('../../scripts/security-scan')); }
  catch (_) { noteSkip('security-baseline', 'security-scan.js unavailable (scripts/ not present)'); return; }
  const { baselineDecision } = require('./security-baseline');
  const { projectDir, stagedSource } = ctx;
  const baselinePath = path.join(projectDir, '.claude', 'state', 'security-baseline.txt');
  const sastEngine = readManifestSastEngine(projectDir) || 'semgrep';
  const opts = { tiers: new Set(['secrets', 'sast']), boundaryOnly: false };
  const { findings, missing } = collectTiered(opts, stagedSource || [], projectDir, sastEngine);
  if (missing.length) blockMissingScanners(missing);
  const d = baselineDecision({
    findings,
    prevKeys: readSecurityBaseline(baselinePath),
    readLine: (f, l) => readSourceLine(projectDir, f, l),
  });
  if (d.secretBlocked) blockSecrets(d.blockingSecrets);
  if (d.sastBlocked) blockSast(d);
  writeSecurityBaseline(baselinePath, d.sastKeys);
}

function readFileOrNull(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

// Gather every input the secure-baseline-wiring invariant inspects (C3 + the C4
// CODEOWNERS extension), so checkSecureBaselineWiring stays small.
function readWiringInputs(projectDir) {
  const gitleaksTomlText = readFileOrNull(path.join(projectDir, '.gitleaks.toml'));
  return {
    workflowText: readFileOrNull(path.join(projectDir, '.github', 'workflows', 'security.yml')),
    gitleaksTomlExists: gitleaksTomlText !== null,
    gitleaksTomlText,
    sastEngine: readManifestSastEngine(projectDir),
    requireCodeOwnerReview: readRequireCodeOwnerReview(projectDir),
    codeownersText: readFileOrNull(path.join(projectDir, '.github', 'CODEOWNERS')),
  };
}

// C3: secure-baseline-wiring presence invariant (+ C4 CODEOWNERS requirement).
function checkSecureBaselineWiring(ctx) {
  if (process.env.HARNESS_SECURE_BASELINE_WIRING_GATE === 'off') return;
  const { wiringViolations } = require('./security-baseline');
  const violations = wiringViolations(readWiringInputs(ctx.projectDir));
  if (violations.length) {
    failBlock({
      id: 'secure-baseline-wiring',
      title: 'the secure-repo baseline guard is missing or downgraded',
      detail: violations.map((v) => `  - ${v}`).join('\n') + '\n',
      fix: 'restore .github/workflows/security.yml (blocking gitleaks + sast jobs), .gitleaks.toml, quality.sast_engine, and — when github.require_code_owner_review is true — a real .github/CODEOWNERS (generate-codeowners.js). Re-run /scaffold or /scaffold-upgrade if unsure.',
      minTier: 'strict',
    });
  }
}

function checkDuplicationRatchet(_ctx) {
  const { runJscpd, readBaseline, writeBaseline } = require('../../scripts/duplication-gate');
  const { cloneKeys } = require('./duplication-gate');
  const { gateDecision } = require('./cycle-gate');
  const { report, unavailable } = runJscpd(['.']);
  if (unavailable) {
    noteSkip('duplication-ratchet', 'jscpd not installed or unprovisioned');
    return;
  }
  const keys = cloneKeys(report);
  const baseline = readBaseline();
  const d = gateDecision(keys, baseline ? baseline.length : undefined);
  if (d.blocked) {
    const prev = new Set(baseline || []);
    const added = keys.filter((k) => !prev.has(k));
    failBlock({
      id: 'duplication-ratchet',
      title: `clone occurrences increased ${d.baseline} -> ${d.count} (the ratchet only goes down)`,
      detail: added.map((k) => `  - new clone occurrence in ${k.split(':').slice(1).join(':') || k}`).join('\n') + '\n',
      fix: 'extend the existing implementation or extract a shared function instead of copy-pasting.',
      minTier: 'strict',
    });
  }
  writeBaseline(keys);
}

module.exports = {
  checkCycleDetection,
  checkCouplingRatchet,
  checkDuplicationRatchet,
  checkSecurityBaseline,
  checkSecureBaselineWiring,
};
