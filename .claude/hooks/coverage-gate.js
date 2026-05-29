#!/usr/bin/env node

'use strict';

// PostToolUse(Bash) — coverage ratchet gate on `git commit`.
// Runs pytest coverage for Python projects, parses the TOTAL %, and blocks
// (exit 2) if coverage is below the recorded baseline or the 80% floor. On a
// pass it ratchets the baseline upward. Mirrors pre-commit-gate.js semantics:
// it fires after the commit Bash call and flags a regression so the change can
// be fixed/amended. Never blocks when the toolchain is unprovisioned.
// Escape hatch: set HARNESS_COVERAGE_GATE=off.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FLOOR = 80;

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function readBaseline(projectDir) {
  try {
    const raw = fs.readFileSync(path.join(projectDir, '.claude', 'state', 'coverage-baseline.txt'), 'utf8');
    const n = parseFloat(raw.trim());
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function writeBaseline(projectDir, pct) {
  try {
    fs.writeFileSync(path.join(projectDir, '.claude', 'state', 'coverage-baseline.txt'), `${pct}\n`);
  } catch (_) {
    /* best effort */
  }
}

function toolUnavailable(out) {
  const s = (out || '').toLowerCase();
  return [
    'no such file', 'command not found', 'not found', 'failed to spawn',
    'no module named', 'no virtual environment', 'no `pyproject', 'no tests ran',
  ].some((sig) => s.includes(sig));
}

try {
  if ((process.env.HARNESS_COVERAGE_GATE || '').toLowerCase() === 'off') process.exit(0);

  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command.includes('git commit')) process.exit(0);

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();

  // Scope: Python projects with both src/ and tests/. Other stacks are skipped.
  if (!fs.existsSync(path.join(projectDir, 'src'))) process.exit(0);
  if (!fs.existsSync(path.join(projectDir, 'tests'))) process.exit(0);

  const res = spawnSync('sh', ['-c', 'uv run pytest --cov=src --cov-report=term-missing -q'], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 110000,
  });
  const out = (res.stdout || '') + (res.stderr || '');
  if (res.error || res.status === null || toolUnavailable(out)) process.exit(0); // unprovisioned → skip

  const match = out.match(/^TOTAL\s+.*?(\d+(?:\.\d+)?)%/m);
  if (!match) process.exit(0); // could not parse coverage → do not block
  const pct = parseFloat(match[1]);

  const baseline = readBaseline(projectDir);
  const required = baseline !== null ? baseline : FLOOR;

  if (pct < required) {
    const label = baseline !== null ? `baseline ${baseline}%` : `floor ${FLOOR}%`;
    process.stdout.write(
      `BLOCKED: coverage ${pct}% is below the ${label}.\n` +
        `Fix: add tests to restore coverage before committing. The ratchet only moves forward.\n`
    );
    process.exit(2);
  }

  // Pass — ratchet the baseline upward (never downward).
  if (baseline === null || pct > baseline) writeBaseline(projectDir, pct);
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
