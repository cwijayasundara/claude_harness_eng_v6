'use strict';

// Pure logic for the strict-tier security controls (secure-repo baseline,
// Increment 1). Two gates live in gates-strict.js and delegate every decision
// here so the ratchet math and the wiring-invariant parse stay unit-testable
// without spawning scanners or GitHub:
//   - security-baseline  (C2): secrets are absolute (any new one blocks, never
//     grandfathered, honours harness:secret-ok); SAST high/critical ratchets
//     down against a grandfathered baseline, same decision shape as
//     checkDuplicationRatchet / cycle-gate.
//   - secure-baseline-wiring (C3): a shallow presence invariant over the
//     scaffolded security.yml + .gitleaks.toml + quality.sast_engine, so the
//     guards cannot be silently removed or downgraded.

const { severityRank } = require('./security-scan');
const { gateDecision } = require('./cycle-gate');

// The always-available secrets tools (regex + gitleaks) vs the ratcheted SAST
// engine. A finding's tool decides which policy applies to it.
const SECRET_TOOLS = new Set(['gitleaks', 'secrets-regex']);
const SECRET_OK_MARKER = /harness:secret-ok/;
const VALID_ENGINES = new Set(['semgrep', 'veracode']);

function partitionFindings(findings) {
  const secrets = [];
  const sast = [];
  for (const f of findings || []) {
    if (SECRET_TOOLS.has(f.tool)) secrets.push(f);
    else sast.push(f);
  }
  return { secrets, sast };
}

// Drop secret findings whose source line carries the harness:secret-ok marker
// (per-line, reviewer-visible suppression — same trust model as the regex
// scanner). A finding with no line number is kept as-is: the regex tier already
// suppressed marked lines upstream, so an unlined finding is genuinely unmarked.
function unsuppressedSecrets(secrets, readLine) {
  return (secrets || []).filter((f) => {
    if (!f.line || typeof readLine !== 'function') return true;
    let line;
    try { line = readLine(f.file, f.line); } catch (_) { return true; }
    return !(line && SECRET_OK_MARKER.test(line));
  });
}

// Stable, sorted, de-duplicated keys for the ratcheted SAST findings (>= high).
// Below-threshold findings are report-only and never enter the ratchet.
function sastKeys(sast, threshold = 'high') {
  const min = severityRank(threshold);
  const keys = (sast || [])
    .filter((f) => severityRank(f.severity) >= min)
    .map((f) => `${f.rule || 'sast'}:${f.file || '?'}:${f.line || 0}`);
  return [...new Set(keys)].sort();
}

// Compose the whole gate decision. `prevKeys` is the grandfathered SAST key set
// (from state/security-baseline.txt); undefined on the first run.
function baselineDecision({ findings, prevKeys, readLine }) {
  const { secrets, sast } = partitionFindings(findings);
  const blockingSecrets = unsuppressedSecrets(secrets, readLine);
  const keys = sastKeys(sast);
  const prev = Array.isArray(prevKeys) ? prevKeys : undefined;
  const d = gateDecision(keys, prev === undefined ? undefined : prev.length);
  const prevSet = new Set(prev || []);
  const addedSast = keys.filter((k) => !prevSet.has(k));
  // Key-based, not count-based (CR-001): a security ratchet must block on any
  // genuinely NEW high/critical key, even when a same-count swap (fix one, add
  // another) leaves gateDecision's count comparison unmoved. A count-only ratchet
  // would pass the swap and then grandfather the new finding into the baseline.
  // First run (no baseline) establishes the baseline without blocking.
  const sastBlocked = prev !== undefined && addedSast.length > 0;
  return {
    blockingSecrets,
    secretBlocked: blockingSecrets.length > 0,
    sastKeys: keys,
    addedSast,
    sastDecision: d,
    sastBlocked,
    blocked: blockingSecrets.length > 0 || sastBlocked,
  };
}

// --- C3: secure-baseline-wiring presence invariant ---------------------------

// Shallow parse of a GitHub Actions workflow: return each top-level job name ->
// { continueOnError, hasIf, body, childIndent }. Not a full YAML parse, but it
// captures the three downgrade signals a name-only check misses (VULN-002): a
// job-level `if:` (gates the job off), any `continue-on-error` (soft-fail — any
// value/expression, not just bare `true`), and the job body (so we can require an
// actual scanner invocation rather than trusting the job name).

// Fold one in-job line into its record: collect the body and, at the job's own
// child-indent (a step-level if:/continue-on-error is deeper), the downgrade flags.
function foldJobLine(job, raw, indent) {
  job.body.push(raw);
  if (job.childIndent === null) job.childIndent = indent;
  if (indent !== job.childIndent) return;
  if (/^\s*continue-on-error\s*:/.test(raw)) job.continueOnError = true;
  if (/^\s*if\s*:/.test(raw)) job.hasIf = true;
}

function parseWorkflowJobs(text) {
  const jobs = {};
  let inJobs = false;
  let jobIndent = null;
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    if (/^jobs:\s*$/.test(raw)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (raw.trim() && !/^\s/.test(raw)) break; // dedent back to a top-level key
    const m = raw.match(/^(\s+)([A-Za-z0-9_-]+):\s*$/);
    if (m && (jobIndent === null || m[1].length === jobIndent)) {
      jobIndent = m[1].length;
      current = m[2];
      jobs[current] = { continueOnError: false, hasIf: false, body: [], childIndent: null };
      continue;
    }
    const indent = raw.match(/^(\s*)/)[1].length;
    if (current && indent > jobIndent) foldJobLine(jobs[current], raw, indent);
  }
  return jobs;
}

// Does the job actually invoke its scanner? gitleaks → a gitleaks action/CLI;
// sast → the configured engine's action/CLI. A gutted job that keeps the name but
// runs `true` fails this (VULN-002).
function invokesScanner(job, name, sastEngine) {
  const body = (job.body || []).join('\n');
  const token = name === 'gitleaks' ? /gitleaks/i
    : sastEngine === 'veracode' ? /veracode/i
      : /semgrep/i;
  return /(^|\n)\s*-?\s*(uses|run)\s*:/.test(body) && token.test(body);
}

function checkJob(jobs, name, sastEngine, out) {
  const job = jobs[name];
  if (!job) { out.push(`security workflow is missing a blocking "${name}" job`); return; }
  if (job.continueOnError) out.push(`security workflow "${name}" job is non-blocking (continue-on-error set)`);
  if (job.hasIf) out.push(`security workflow "${name}" job is conditional (job-level if: can gate it off in CI)`);
  if (!invokesScanner(job, name, sastEngine)) out.push(`security workflow "${name}" job does not invoke the scanner (gutted step)`);
}

// Reject a catch-all gitleaks allowlist (VULN-003): a paths/regexes entry of `.*`
// (optionally quoted/anchored) neuters gitleaks in both local and CI runs while
// the file still "exists". Inspects allowlist entries, not the useDefault block.
function isCatchAllAllowlist(tomlText) {
  if (!tomlText) return false;
  return /^\s*(paths|regexes)\s*=/m.test(tomlText)
    && /(['"]{1,3})\s*(\^\??)?\.\*(\$\??)?\s*\1/.test(tomlText);
}

// Returns a list of human-legible wiring violations; empty === wired correctly.
function wiringViolations({ workflowText, gitleaksTomlExists, gitleaksTomlText, sastEngine }) {
  const out = [];
  if (!workflowText) {
    out.push('.github/workflows/security.yml is absent');
  } else {
    const jobs = parseWorkflowJobs(workflowText);
    checkJob(jobs, 'gitleaks', sastEngine, out);
    checkJob(jobs, 'sast', sastEngine, out);
  }
  if (!gitleaksTomlExists) out.push('.gitleaks.toml is absent');
  else if (isCatchAllAllowlist(gitleaksTomlText)) out.push('.gitleaks.toml has a catch-all allowlist (.*) that neuters the scan');
  if (!VALID_ENGINES.has(sastEngine)) out.push('project-manifest.json#quality.sast_engine is unset or invalid');
  return out;
}

// --- C4: render the config-driven security workflow --------------------------

// Keep the selected SAST engine's job block, drop the other, and strip the
// `# >>> / # <<< sast:<engine>` marker lines. Both engines yield a valid
// two-job (gitleaks + sast) workflow with no client/org literals.
function renderSecurityWorkflow(sastEngine, templateText) {
  const engine = sastEngine === 'veracode' ? 'veracode' : 'semgrep';
  const out = [];
  let skipping = null;
  for (const line of String(templateText).split('\n')) {
    const open = line.match(/^#\s*>>>\s*sast:(\w+)\s*$/);
    const close = line.match(/^#\s*<<<\s*sast:(\w+)\s*$/);
    if (open) { if (open[1] !== engine) skipping = open[1]; continue; }
    if (close) { if (skipping === close[1]) skipping = null; continue; }
    if (skipping) continue;
    out.push(line);
  }
  return out.join('\n');
}

module.exports = {
  SECRET_TOOLS,
  VALID_ENGINES,
  partitionFindings,
  unsuppressedSecrets,
  sastKeys,
  baselineDecision,
  parseWorkflowJobs,
  wiringViolations,
  renderSecurityWorkflow,
};
