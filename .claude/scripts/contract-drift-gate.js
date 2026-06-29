#!/usr/bin/env node

'use strict';

// API contract-drift gate (gap G12, slice 1). Runs `oasdiff breaking` between
// the OpenAPI spec as committed at the base ref (the "before") and the
// working-tree spec (the "after"), and BLOCKs on breaking changes. Conditional:
// only acts when an OpenAPI spec exists. Degrades loudly (exit 0) when oasdiff
// is not installed — like security-scan with a missing semgrep/gitleaks.
//
// CLI: node .claude/scripts/contract-drift-gate.js [--root DIR] [--base REF]
//        [--spec PATH] [--oasdiff BIN]
// Exit 0 = pass / no-spec / new-spec / unprovisioned; 1 = breaking changes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SPEC_CANDIDATES = [
  'openapi.yaml', 'openapi.yml', 'openapi.json',
  'specs/design/openapi.yaml', 'specs/design/openapi.yml', 'specs/design/openapi.json',
];

function arg(argv, name, fb) { const i = argv.indexOf(name); return i === -1 ? fb : argv[i + 1]; }

function resolveSpecPath(root, manifest) {
  const declared = manifest && manifest.api && manifest.api.openapi_spec;
  if (declared && fs.existsSync(path.join(root, declared))) return declared;
  for (const c of SPEC_CANDIDATES) if (fs.existsSync(path.join(root, c))) return c;
  return null;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function resolveBase(root, explicit) {
  if (explicit) return explicit;
  for (const ref of ['origin/main', 'main', 'HEAD']) {
    try { git(root, ['rev-parse', '--verify', '--quiet', ref]); return ref; } catch (_) { /* next */ }
  }
  return null;
}

function extractBaseSpec(root, base, relPath) {
  try {
    const content = git(root, ['show', `${base}:${relPath}`]);
    const tmp = path.join(os.tmpdir(), `contract-base-${process.pid}-${path.basename(relPath)}`);
    fs.writeFileSync(tmp, content);
    return tmp;
  } catch (_) { return null; } // spec absent at base
}

function verdictFromExit(code) { return code === 0 ? 'pass' : 'breaking'; }

function runOasdiff(bin, baseSpec, current) {
  const res = spawnSync(bin, ['breaking', baseSpec, current, '--fail-on', 'ERR'], { encoding: 'utf8' });
  if (res.error && res.error.code === 'ENOENT') return { enoent: true };
  return { code: res.status == null ? 1 : res.status, output: (res.stdout || '') + (res.stderr || '') };
}

function finish(root, verdict, code) {
  try {
    const outDir = path.join(root, 'specs', 'reviews');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'contract-drift-verdict.json'), JSON.stringify(verdict, null, 2));
  } catch (e) { process.stderr.write(`contract-drift: could not write verdict: ${e.message}\n`); }
  process.stdout.write(`contract-drift: ${verdict.verdict}${verdict.message ? ' — ' + verdict.message : ''}\n`);
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--root', process.cwd());
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'project-manifest.json'), 'utf8')); } catch (_) { /* none */ }
  const spec = arg(argv, '--spec', resolveSpecPath(root, manifest));
  if (!spec) return finish(root, { verdict: 'no-spec', message: 'no OpenAPI spec found — skipping' }, 0);
  const base = resolveBase(root, arg(argv, '--base', null));
  if (!base) return finish(root, { verdict: 'new-spec', spec, message: 'no base ref to diff against' }, 0);
  const baseSpec = extractBaseSpec(root, base, spec);
  if (!baseSpec) return finish(root, { verdict: 'new-spec', spec, base, message: 'spec absent at base — nothing to diff' }, 0);
  const r = runOasdiff(arg(argv, '--oasdiff', 'oasdiff'), baseSpec, path.join(root, spec));
  if (r.enoent) return finish(root, { verdict: 'unprovisioned', spec, base, message: 'oasdiff not on PATH — contract-drift skipped; install oasdiff to enforce' }, 0);
  const verdict = verdictFromExit(r.code);
  return finish(root, { verdict, spec, base, breaking_output: r.output }, verdict === 'breaking' ? 1 : 0);
}

module.exports = { verdictFromExit, resolveSpecPath };

if (require.main === module) main();
