#!/usr/bin/env node

'use strict';

// Emit a greenfield project's dependency manifests and tool config, and warm
// the toolchain by installing them once.
//
// Two costs from the 2026-08-21 sprint-1 baseline, both fixed here:
//
//  1. The first story owned the bootstrap. E1-S1 ran 208 turns and cost $16.87
//     alone, a large share of it re-deriving ruff/mypy/pytest/tsconfig/eslint/
//     vitest configuration one conversational turn at a time.
//  2. Installs inside an agent expired its cache. Subagent contexts are written
//     at the 5-minute TTL only, and the run showed idle gaps of 8 to 25 minutes
//     before whole-context rewrites — the shape of a `uv sync` or `npm install`
//     running inside an implementer's turn. Installing at scaffold time, in the
//     main loop where there is no agent context to lose, removes that class.
//
// Idempotent by construction: an existing manifest is never overwritten, so a
// re-scaffold cannot discard a dependency a story added. Never fails the
// scaffold — a missing toolchain or an offline machine degrades to "manifests
// written, install skipped", which is still strictly better than nothing.
//
// Usage:
//   node .claude/scripts/scaffold-bootstrap.js [--target DIR] [--no-install] [--json]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { plan, filesFor, installCommand } = require('../hooks/lib/project-bootstrap.js');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/** Write only what is absent. Returns the paths actually created. */
function writeFiles(target, files) {
  const written = [];
  for (const [rel, contents] of Object.entries(files)) {
    const dest = path.join(target, rel);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contents);
    written.push(rel);
  }
  return written;
}

function runInstall(target, spec, timeoutMs) {
  const { cwd, command, args } = installCommand(spec);
  const dir = path.join(target, cwd);
  const res = spawnSync(command, args, {
    cwd: dir, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error && res.error.code === 'ENOENT') {
    return { part: spec.part, installed: false, reason: `${command} is not on PATH` };
  }
  if (res.status !== 0) {
    const tail = String(res.stderr || '').trim().split('\n').slice(-3).join(' ');
    return { part: spec.part, installed: false, reason: `${command} exited ${res.status}: ${tail}` };
  }
  return { part: spec.part, installed: true, reason: null };
}

function bootstrap(target, opts = {}) {
  const manifest = readJsonSafe(path.join(target, 'project-manifest.json')) || {};
  const specs = plan(manifest);
  const result = { stacks: specs.map((s) => s.part), written: [], installs: [], skipped: null };

  if (specs.length === 0) {
    result.skipped = 'no recognised stack in project-manifest.json#stack — '
      + 'bootstrap emits nothing rather than guessing a framework';
    return result;
  }

  for (const spec of specs) {
    result.written.push(...writeFiles(target, filesFor(spec, manifest.name || manifest.project_name)));
  }
  if (opts.install === false) return result;

  for (const spec of specs) {
    result.installs.push(runInstall(target, spec, opts.timeoutMs || 600000));
  }
  return result;
}

function render(result) {
  if (result.skipped) return `scaffold-bootstrap: skipped — ${result.skipped}\n`;
  const lines = [`scaffold-bootstrap: ${result.stacks.join(' + ')}`];
  lines.push(result.written.length
    ? `  wrote ${result.written.length} file(s): ${result.written.join(', ')}`
    : '  wrote nothing — every manifest already existed (a story may have added deps)');
  for (const i of result.installs) {
    lines.push(i.installed
      ? `  ${i.part}: toolchain installed and warm`
      : `  ${i.part}: install SKIPPED — ${i.reason}\n`
        + '    The first implementer will pay for it instead, inside an agent whose cache\n'
        + '    expires after 5 minutes of it. Run the install manually before /auto.');
  }
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const targetIdx = argv.indexOf('--target');
  const target = targetIdx >= 0 ? path.resolve(argv[targetIdx + 1]) : process.cwd();
  const result = bootstrap(target, { install: !argv.includes('--no-install') });
  process.stdout.write(argv.includes('--json')
    ? `${JSON.stringify(result, null, 2)}\n`
    : render(result));
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { bootstrap, writeFiles, render, main };
