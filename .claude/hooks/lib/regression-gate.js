'use strict';

// Deterministic primitives for the regression-suite-full gate (gap G15).
// Reused by .claude/scripts/regression-gate.js (the CLI/orchestration
// surface) — kept separate so the mechanical pieces (discovery, quarantine
// matching, Playwright-report parsing, one API-check HTTP round trip) are
// unit-testable in isolation, the same split cycle-gate.js / mutation-gate.js
// use for their hooks/lib counterparts.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const SPEC_RE = /\.spec\.(ts|js)$/;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

// null = the e2e directory does not exist (nothing to regress against yet).
function discoverE2eSpecs(root, e2eDir) {
  const dir = path.join(root, e2eDir);
  if (!fs.existsSync(dir)) return null;
  const out = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (SPEC_RE.test(entry.name)) out.push(p);
    }
  })(dir);
  return out;
}

// null = the sprint-contracts directory does not exist. excludeGroups keeps
// the current, still-in-flight group out of the "prior" regression set.
function discoverPriorContracts(root, contractsDir, excludeGroups) {
  const dir = path.join(root, contractsDir);
  if (!fs.existsSync(dir)) return null;
  const excluded = new Set(excludeGroups || []);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !excluded.has(path.basename(f, '.json')))
    .map((f) => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// Quarantine (specs/drift/flake-history.jsonl)
// ---------------------------------------------------------------------------

function loadQuarantineNames(flakeHistoryPath) {
  const names = new Set();
  if (!fs.existsSync(flakeHistoryPath)) return names;
  for (const line of fs.readFileSync(flakeHistoryPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.name) names.add(row.name);
    } catch (_) { /* skip malformed line — quarantine stays best-effort */ }
  }
  return names;
}

function isQuarantined(name, quarantine) { return quarantine.has(name); }

// ---------------------------------------------------------------------------
// e2e (Playwright) regression
// ---------------------------------------------------------------------------

// Real reporter shape (verified against a live `playwright test --reporter=json`
// run): report.suites[] is one entry per spec FILE; each suite carries
// specs[] (flat tests) and/or suites[] (nested describe blocks). Every spec
// carries its own file/line/title/ok — ok:false means it failed even after
// retries.
//
// Shared tree-walk: visits EVERY spec (pass or fail) and invokes `visit` with
// the spec and its joined describe-block title prefix. Both
// extractPlaywrightFailures (fail-only, gap G15) and extractPlaywrightResults
// (every spec, gap G28) are thin filters over this one walk.
function walkPlaywrightSpecs(report, visit) {
  function walkSpecs(specs, titlePrefix) {
    for (const spec of specs || []) {
      visit(spec, titlePrefix);
    }
  }
  function walkSuite(suite, titlePrefix) {
    walkSpecs(suite.specs, titlePrefix);
    for (const child of suite.suites || []) walkSuite(child, [...titlePrefix, child.title]);
  }
  for (const fileSuite of (report && report.suites) || []) walkSuite(fileSuite, []);
}

function extractPlaywrightFailures(report) {
  const failures = [];
  walkPlaywrightSpecs(report, (spec, titlePrefix) => {
    if (spec.ok === false) {
      failures.push({ file: spec.file, line: spec.line || 1, title: [...titlePrefix, spec.title].join(' > ') });
    }
  });
  return failures;
}

// gap G28: every spec's {file, line, title, ok}, not just failures — the input
// flake-detector.js's e2e mode needs to tell "passed in run A, failed in run
// B" apart, which a failures-only list can never express.
function extractPlaywrightResults(report) {
  const results = [];
  walkPlaywrightSpecs(report, (spec, titlePrefix) => {
    const title = [...titlePrefix, spec.title].join(' > ');
    results.push({ file: spec.file, line: spec.line || 1, title, ok: spec.ok === true });
  });
  return results;
}

function splitCmd(cmd) { return cmd.trim().split(/\s+/); }

// Under forced replay (gap G34/G36), a wrapper/LLM double with no recorded
// fixture raises one of these — meaning the code path would have reached a live
// external. In a regression run that is a hard failure, not a fallback. The
// trailing `:` anchors on a raised exception's traceback line (`...Error: msg`)
// so a test that merely mentions the class name in prose can't false-fire.
const LIVE_EXTERNAL_MARKERS = /(MissingFixtureError|GoldenNotFoundError):/;
function detectLiveExternalReach(output) {
  return LIVE_EXTERNAL_MARKERS.test(String(output || ''));
}

// specFiles (gap G16): optional list of spec file args appended after the base
// command, so a caller can run a targeted subset (`npx playwright test <file1>
// <file2> ...`) instead of the whole suite. Omitted/undefined preserves pass
// 1's original whole-suite behavior unchanged; an empty array is equivalent
// to omitting it.
function runE2eSuite(root, e2eCmd, timeoutMs, specFiles, replay) {
  const [bin, ...args] = splitCmd(e2eCmd);
  if (specFiles && specFiles.length) args.push(...specFiles);
  const env = replay ? { ...process.env, HARNESS_TEST_REPLAY: '1' } : process.env;
  const res = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env });
  if (res.error && res.error.code === 'ENOENT') return { unprovisioned: true };
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  if (replay && detectLiveExternalReach(stdout + stderr)) return { liveExternalReached: true, stdout, stderr };
  let report = null;
  try { report = JSON.parse(stdout); } catch (_) { /* not JSON — fall back to exit code only */ }
  return { code: res.status == null ? 1 : res.status, stdout, stderr, report };
}

// ---------------------------------------------------------------------------
// Prior sprint-contract API-check regression
// ---------------------------------------------------------------------------

function lineOfCheckId(rawText, id) {
  const needle = `"${id}"`;
  const lines = rawText.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  return null;
}

function bodyMatches(expected, actual) {
  if (expected == null) return true;
  if (typeof expected !== 'object') return expected === actual;
  if (actual == null || typeof actual !== 'object') return false;
  for (const [k, v] of Object.entries(expected)) {
    if (!(k in actual)) return false;
    if (v && typeof v === 'object') { if (!bodyMatches(v, actual[k])) return false; }
    else if (actual[k] !== v) return false;
  }
  return true;
}

function evaluateApiCheck(check, response) {
  const problems = [];
  if (check.expected_status != null && response.status !== check.expected_status) {
    problems.push(`expected status ${check.expected_status}, got ${response.status}`);
  }
  if (check.expected_body && Object.keys(check.expected_body).length && !bodyMatches(check.expected_body, response.body)) {
    problems.push('response body did not match expected_body');
  }
  return { pass: problems.length === 0, problems };
}

function httpRequest(baseUrl, check, timeoutMs) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(check.path, baseUrl); } catch (err) { resolve({ status: 0, body: null, error: err.message }); return; }
    const lib = url.protocol === 'https:' ? https : http;
    const payload = check.body ? JSON.stringify(check.body) : null;
    const req = lib.request(url, {
      method: check.method || 'GET',
      headers: Object.assign({}, check.headers, payload ? { 'content-type': 'application/json' } : {}),
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let body = raw;
        try { body = JSON.parse(raw); } catch (_) { /* non-JSON body is compared as-is */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: null, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Re-validates one prior contract's API layer against the running app.
// `validateSchema` is contract-schema.js's validate() — the exact machinery
// validate-contract.js uses — applied here BEFORE any HTTP call: a contract
// that has drifted off contract-schema.json (e.g. checks no longer nested
// under `contract`) can no longer be trusted to describe "still passing",
// so that is itself a regression finding.
async function regressPriorContract(contractPath, apiBaseUrl, quarantine, schema, validateSchema, httpTimeout) {
  const raw = fs.readFileSync(contractPath, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (err) {
    return [{ file: contractPath, line: 1, detail: `unreadable JSON: ${err.message}` }];
  }
  const schemaErrors = validateSchema(schema, data);
  if (schemaErrors.length) {
    return [{ file: contractPath, line: 1, detail: `sprint contract no longer schema-valid: ${schemaErrors.join('; ')}` }];
  }
  const checks = (data.contract && data.contract.api_checks) || [];
  const findings = [];
  for (const check of checks) {
    const name = check.id || check.description || '(unnamed check)';
    if (isQuarantined(name, quarantine)) continue;
    const response = await httpRequest(apiBaseUrl, check, httpTimeout);
    const { pass, problems } = evaluateApiCheck(check, response);
    if (!pass) {
      findings.push({
        file: contractPath,
        line: lineOfCheckId(raw, check.id) || 1,
        detail: `api_check "${name}" (${check.method || 'GET'} ${check.path}): ${problems.join('; ')}${response.error ? ' [' + response.error + ']' : ''}`,
      });
    }
  }
  return findings;
}

module.exports = {
  discoverE2eSpecs,
  discoverPriorContracts,
  loadQuarantineNames,
  isQuarantined,
  extractPlaywrightFailures,
  extractPlaywrightResults,
  runE2eSuite,
  detectLiveExternalReach,
  lineOfCheckId,
  bodyMatches,
  evaluateApiCheck,
  httpRequest,
  regressPriorContract,
};
