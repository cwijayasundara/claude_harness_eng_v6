'use strict';

// Deterministic half of checking-coverage-before-change's Iron Law: NO EDIT
// TO A SYMBOL UNTIL YOU KNOW WHICH TESTS COVER IT. Active only on projects
// with a brownfield code graph, and only for production files the graph maps.
// Verdicts come from coverage_map.py; results are cached per file against the
// graph/coverage mtimes so python runs only when something changed.
// UNCOVERED symbols in the edited range block with a route to pin-down or
// sprout. Missing coverage data blocks with the scoped-regen command. Tooling
// gaps (no python3, regex-fallback graph) degrade to a non-blocking note —
// never silently. Escape hatch: HARNESS_COVERAGE_PREFLIGHT=off.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.py$/;
const COVERAGE_CANDIDATES = ['.coverage', 'coverage/coverage-final.json', 'coverage-final.json'];
const SCRIPT_REL = path.join('.claude', 'skills', 'code-map', 'scripts', 'code_index', 'coverage_map.py');
const CACHE_REL = path.join('.claude', 'state', 'coverage-preflight-cache.json');

function findCoverage(projectDir) {
  for (const rel of COVERAGE_CANDIDATES) {
    const p = path.join(projectDir, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (_) {
    return 0;
  }
}

// Map the edit's old_string occurrences to 1-based line ranges.
// null = could not narrow (Write / unmatched old_string) → treat as whole file.
function editedRanges(toolName, ti, content) {
  const edits = toolName === 'MultiEdit' ? ti.edits || [] : [ti];
  const ranges = [];
  for (const e of edits) {
    if (!e.old_string) return null;
    const idx = content.indexOf(e.old_string);
    if (idx === -1) return null;
    const startLine = content.slice(0, idx).split('\n').length;
    ranges.push([startLine, startLine + e.old_string.split('\n').length - 1]);
  }
  return ranges;
}

function overlaps(ranges, start, end) {
  if (!ranges) return true;
  return ranges.some(([s, e]) => s <= end && e >= start);
}

function cachedResults(projectDir, rel, graphPath, coveragePath) {
  const cache = readJson(path.join(projectDir, CACHE_REL));
  const entry = cache && cache[rel];
  if (entry && entry.graphMtime === mtimeOf(graphPath) && entry.covMtime === mtimeOf(coveragePath)) {
    return entry.results;
  }
  return null;
}

function storeResults(projectDir, rel, graphPath, coveragePath, results) {
  const cacheFile = path.join(projectDir, CACHE_REL);
  const cache = readJson(cacheFile) || {};
  cache[rel] = { graphMtime: mtimeOf(graphPath), covMtime: mtimeOf(coveragePath), results };
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  } catch (_) {
    /* cache is an optimization only */
  }
}

function runCoverageMap(projectDir, graphPath, coveragePath, rel) {
  const script = path.join(projectDir, SCRIPT_REL);
  if (!fs.existsSync(script)) return { status: 'no-script' };
  const res = spawnSync('python3', [
    script, '--graph', graphPath, '--coverage', coveragePath, '--files', rel, '--root', projectDir,
  ], { encoding: 'utf8', timeout: 8000 });
  if (res.error || res.status === null) return { status: 'no-python' };
  if (res.status === 2) return { status: 'no-coverage' };
  if (res.status === 3) return { status: 'no-symbols' };
  if (res.status !== 0) return { status: 'error', detail: (res.stderr || '').slice(0, 400) };
  const report = (() => { try { return JSON.parse(res.stdout); } catch (_) { return null; } })();
  if (!report || !Array.isArray(report.results)) return { status: 'error', detail: 'unparseable report' };
  return { status: 'ok', results: report.results };
}

function noCoverageBlock(rel) {
  return {
    decision: 'block',
    message:
      `BLOCKED: coverage preflight — specs/brownfield/code-graph.json maps ${rel}, but no coverage data was found (.coverage or coverage-final.json).\n` +
      `The Iron Law: no edit to a symbol until you know which tests cover it.\n` +
      `Fix: generate coverage first — pytest --cov --cov-context=test (Python) or nyc --reporter=json <test cmd> (JS). A run scoped to this module is enough.\n` +
      `Bypass (deliberate, logged in the diff): HARNESS_COVERAGE_PREFLIGHT=off.\n`,
  };
}

function uncoveredBlock(rel, hits) {
  const list = hits.map((r) => `  - ${r.symbol.split('#').pop()} (lines ${r.start}-${r.end})`).join('\n');
  return {
    decision: 'block',
    message:
      `BLOCKED: coverage preflight — this edit touches UNCOVERED symbol(s) in ${rel}:\n${list}\n` +
      `No test exercises these lines; a regression here would be invisible.\n` +
      `Fix: pin down current behavior first (skill: pinning-down-behavior), or add the change as a new tested unit (skill: sprouting-instead-of-editing). Then re-run coverage and retry.\n` +
      `Bypass (deliberate): HARNESS_COVERAGE_PREFLIGHT=off.\n`,
  };
}

function fileContext(projectDir, toolName, ti, filePath) {
  const rel = path.relative(projectDir, filePath).split(path.sep).join('/');
  if (rel.startsWith('..') || TEST_PATH_RE.test(rel)) return null;
  if (!fs.existsSync(filePath)) return null; // new file → sprouting, not gated
  const graphPath = path.join(projectDir, 'specs', 'brownfield', 'code-graph.json');
  if (!fs.existsSync(graphPath)) return null;
  const graph = readJson(graphPath);
  if (!graph) return null;
  const record = (graph.files || []).find((f) => f.path === rel && (f.symbols || []).length > 0);
  if (!record) return null;
  return { rel, graphPath };
}

// Returns {decision: 'allow'|'block'|'note', message?}.
function coveragePreflight(projectDir, toolName, ti, filePath) {
  if ((process.env.HARNESS_COVERAGE_PREFLIGHT || '').toLowerCase() === 'off') return { decision: 'allow' };
  const ctx = fileContext(projectDir, toolName, ti, filePath);
  if (!ctx) return { decision: 'allow' };

  const coveragePath = findCoverage(projectDir);
  if (!coveragePath) return noCoverageBlock(ctx.rel);

  let results = cachedResults(projectDir, ctx.rel, ctx.graphPath, coveragePath);
  if (!results) {
    const run = runCoverageMap(projectDir, ctx.graphPath, coveragePath, ctx.rel);
    if (run.status === 'no-coverage') return noCoverageBlock(ctx.rel);
    if (run.status !== 'ok') {
      return { decision: 'note', message: `note: coverage preflight could not run (${run.status}${run.detail ? `: ${run.detail}` : ''}) — treat edited symbols in ${ctx.rel} as UNCOVERED and pin them down first.\n` };
    }
    results = run.results;
    storeResults(projectDir, ctx.rel, ctx.graphPath, coveragePath, results);
  }

  const ranges = editedRanges(toolName, ti, fs.readFileSync(filePath, 'utf8'));
  const hits = results.filter((r) => r.path === ctx.rel && r.verdict === 'UNCOVERED' && overlaps(ranges, r.start, r.end));
  return hits.length > 0 ? uncoveredBlock(ctx.rel, hits) : { decision: 'allow' };
}

module.exports = { coveragePreflight };
