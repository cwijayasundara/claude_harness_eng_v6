'use strict';

// Deterministic half of checking-coverage-before-change's Iron Law: NO EDIT
// TO A SYMBOL UNTIL YOU KNOW WHICH TESTS COVER IT. Active only on projects
// with a brownfield code graph, and only for production files the graph maps.
// Verdicts come from coverage_map.py; results are cached per file against the
// graph/coverage mtimes so python runs only when something changed.
// UNCOVERED symbols in the edited range block with a route to pin-down or
// sprout. Missing coverage data blocks with the scoped-regen command ONLY when
// the project has tooling that could produce it; a project with no coverage
// runner at all gets a loud note instead, because a block it cannot satisfy is
// an unsatisfiable wall, not a gate. Tooling gaps (no python3, regex-fallback
// graph) degrade the same way — reported, never silent. Escape hatch:
// HARNESS_COVERAGE_PREFLIGHT=off.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.py$/;
const JS_COVERAGE_BINS = ['nyc', 'c8', 'vitest', 'jest'];
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
  // --files=<rel> (not "--files <rel>") so a path starting with '-' cannot be
  // misread as a flag by argparse.
  const res = spawnSync('python3', [
    script, '--graph', graphPath, '--coverage', coveragePath, `--files=${rel}`, '--root', projectDir,
  ], { encoding: 'utf8', timeout: 8000 });
  if (res.error || res.status === null) return { status: 'no-python' };
  if (res.status === 2) return { status: 'no-coverage' };
  if (res.status === 3) return { status: 'no-symbols' };
  if (res.status !== 0) return { status: 'error', detail: (res.stderr || '').slice(0, 400) };
  const report = (() => { try { return JSON.parse(res.stdout); } catch (_) { return null; } })();
  if (!report || !Array.isArray(report.results)) return { status: 'error', detail: 'unparseable report' };
  return { status: 'ok', results: report.results };
}

function hasJsCoverageTooling(projectDir) {
  for (const bin of JS_COVERAGE_BINS) {
    if (fs.existsSync(path.join(projectDir, 'node_modules', '.bin', bin))) return true;
  }
  const pkg = readJson(path.join(projectDir, 'package.json'));
  if (!pkg) return false;
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  return JS_COVERAGE_BINS.some((bin) => Object.prototype.hasOwnProperty.call(deps, bin));
}

// Declaration-based, not a subprocess probe: "does this project declare a coverage
// runner", answered from files. Executing `python3 -c "import coverage"` made the
// answer depend on what the machine happened to have installed, which is both
// non-deterministic across environments and wrong — a globally-importable coverage
// module says nothing about whether THIS project is set up to produce coverage.
const PY_COVERAGE_MANIFESTS = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.cfg', 'tox.ini'];
const PY_COVERAGE_RE = /\b(pytest-cov|coverage)\b/;

function hasPyCoverageTooling(projectDir) {
  for (const rel of PY_COVERAGE_MANIFESTS) {
    try {
      if (PY_COVERAGE_RE.test(fs.readFileSync(path.join(projectDir, rel), 'utf8'))) return true;
    } catch (_) { /* absent manifest is not a declaration */ }
  }
  return false;
}

// Can this project produce coverage FOR THIS FILE? A hard block is only fair when the
// developer has a way to satisfy it — and the tooling has to match the file's language.
// Python's coverage cannot produce a verdict for a .js file, so a repo that has
// coverage.py installed must not be treated as able to cover its JavaScript.
function canProduceCoverage(projectDir, rel) {
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.py') return hasPyCoverageTooling(projectDir);
  return hasJsCoverageTooling(projectDir);
}

// No coverage data. If the project HAS tooling, block — the developer can generate it.
// If it has none, blocking demands evidence the project cannot produce, so degrade to
// a loud note instead. This is how the gate already treats a missing python3 or a
// missing coverage_map.py: a tooling gap is reported, never silently passed, and never
// turned into an unsatisfiable wall.
function noCoverage(projectDir, rel) {
  if (!canProduceCoverage(projectDir, rel)) {
    const looked = path.extname(rel).toLowerCase() === '.py' ? 'python3 coverage' : JS_COVERAGE_BINS.join(', ');
    return {
      decision: 'note',
      message:
        `note: coverage preflight cannot run for ${rel} — no coverage data (.coverage / coverage-final.json), ` +
        `and no tooling in this project could produce it for a ${path.extname(rel) || 'source'} file (looked for ${looked}).\n` +
        `Treat the edited symbols as UNCOVERED and pin them down first (skill: pinning-down-behavior).\n` +
        `To enforce this gate here, add a coverage runner; to silence it, HARNESS_COVERAGE_PREFLIGHT=off.\n`,
    };
  }
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
  if (!coveragePath) return noCoverage(projectDir, ctx.rel);

  let results = cachedResults(projectDir, ctx.rel, ctx.graphPath, coveragePath);
  if (!results) {
    const run = runCoverageMap(projectDir, ctx.graphPath, coveragePath, ctx.rel);
    if (run.status === 'no-coverage') return noCoverage(projectDir, ctx.rel);
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

module.exports = { coveragePreflight, canProduceCoverage };
