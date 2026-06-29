#!/usr/bin/env node

'use strict';

// Harness-coverage report (gap G11). Maps each source file in a project's
// code-graph against the manifest's active sensors by axis, reporting per-axis
// coverage % + ungoverned holes. Report-only (exit 0) unless --check. Makes the
// G1 registry measurable. The non-file-mapping scopes (runtime/dependencies/
// artifacts/repo) are reported separately, not folded into the per-file %.

const fs = require('fs');
const path = require('path');

const FILE_SCOPES = new Set(['universal', 'test-covered', 'layer-roots', 'contexts']);
const AXES = ['maintainability', 'architecture', 'behaviour', 'traceability'];

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }
function toFwd(p) { return String(p).replace(/\\/g, '/'); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function coveredKeys(covJson) {
  const out = [];
  if (!covJson) return out;
  for (const [f, s] of Object.entries(covJson)) {
    if (f === 'total' || !s) continue;
    const c = (s.lines && s.lines.covered) || (s.summary && s.summary.covered_lines) || 0;
    if (c > 0) out.push(toFwd(f));
  }
  return out;
}

// Tolerant match: handles absolute coverage keys vs relative code-graph paths
// (mirrors coverage-diff.js matchKey logic).
function isCovered(file, covKeys) {
  return covKeys.some((k) => k === file || k.endsWith('/' + file) || file.endsWith('/' + k));
}

function sourceFiles(graph) {
  return ((graph && graph.nodes) || [])
    .filter((n) => n.kind === 'file' && n.path).map((n) => toFwd(n.path));
}

function underRoots(file, roots) {
  return (roots || []).some((r) => { const b = toFwd(r).replace(/\/$/, ''); return file === b || file.startsWith(b + '/'); });
}

function inScope(scope, file, ctx) {
  if (scope === 'universal') return true;
  if (scope === 'test-covered') return isCovered(file, ctx.covered);
  if (scope === 'layer-roots') return underRoots(file, ctx.layerRoots);
  if (scope === 'contexts') return underRoots(file, ctx.ctxRoots);
  return false;
}

function buildReport(manifest, files, ctx) {
  const active = (manifest.sensors || []).filter((s) => (s.status || 'active') !== 'planned');
  const fileSensors = active.filter((s) => FILE_SCOPES.has(s.scope));
  const perAxis = {};
  for (const axis of AXES) {
    const ax = fileSensors.filter((s) => s.axis === axis);
    const holes = files.filter((f) => !ax.some((s) => inScope(s.scope, f, ctx)));
    perAxis[axis] = {
      sensors: ax.map((s) => s.id),
      total: files.length,
      covered: files.length - holes.length,
      pct: files.length ? Math.round(((files.length - holes.length) / files.length) * 100) : 0,
      holes,
    };
  }
  const nonFileMapping = {};
  for (const s of active.filter((s) => !FILE_SCOPES.has(s.scope))) {
    (nonFileMapping[s.scope] = nonFileMapping[s.scope] || []).push(s.id);
  }
  return { files: files.length, perAxis, nonFileMapping };
}

function renderMd(r) {
  const lines = [`# Harness coverage`, ``, `Source files: ${r.files}`, ``, `| Axis | Coverage | Sensors | Holes |`, `|---|---|---|---|`];
  for (const axis of AXES) {
    const a = r.perAxis[axis];
    lines.push(`| ${axis} | ${a.pct}% (${a.covered}/${a.total}) | ${a.sensors.join(', ') || '—'} | ${a.holes.length} |`);
  }
  for (const axis of AXES) {
    const a = r.perAxis[axis];
    if (a.holes.length) {
      lines.push('', `## Ungoverned — ${axis} (${a.holes.length})`, ...a.holes.slice(0, 50).map((f) => `- ${f}`));
      if (a.holes.length > 50) lines.push(`- … and ${a.holes.length - 50} more`);
    }
  }
  lines.push('', `## Non-file-mapping governance`);
  for (const [scope, ids] of Object.entries(r.nonFileMapping)) lines.push(`- **${scope}**: ${ids.join(', ')}`);
  return lines.join('\n') + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  const manifest = readJson(arg(argv, '--manifest', path.join(__dirname, '..', '..', 'harness-manifest.json')));
  if (!manifest) { process.stdout.write('harness-coverage: harness-manifest not found — pass --manifest to specify its path.\n'); process.exit(0); }
  const graphPath = arg(argv, '--graph', path.join(root, 'specs', 'brownfield', 'code-graph.json'));
  const graph = readJson(graphPath);
  if (!graph) { process.stdout.write(`harness-coverage: no code-graph.json at ${graphPath} — run /code-map first.\n`); process.exit(0); }
  const projManifest = readJson(path.join(root, 'project-manifest.json')) || {};
  const arch = projManifest.architecture || {};
  const ctx = {
    covered: coveredKeys(readJson(arg(argv, '--coverage', path.join(root, 'coverage', 'coverage-summary.json')))),
    layerRoots: arch.layer_roots || [],
    ctxRoots: (arch.contexts && arch.contexts.roots) || [],
  };
  const report = buildReport(manifest, sourceFiles(graph), ctx);
  const outDir = path.join(root, 'specs', 'harness-coverage');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'harness-coverage.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'harness-coverage.md'), renderMd(report));
  const zeroAxis = AXES.find((a) => report.perAxis[a].total > 0 && report.perAxis[a].pct === 0);
  process.stdout.write(`harness-coverage: ${report.files} files; ` + AXES.map((a) => `${a} ${report.perAxis[a].pct}%`).join(', ') + '\n');
  process.exit(argv.includes('--check') && zeroAxis ? 1 : 0);
}

main();
