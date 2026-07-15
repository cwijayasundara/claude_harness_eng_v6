#!/usr/bin/env node

'use strict';

// PreToolUse(Bash) — closes the shell write-bypass.
// The Write/Edit/MultiEdit pre-write gate cannot see files created through the
// shell (redirections, tee, sed -i, dd, cp/mv), so an agent could disable a
// quality gate, escape the project tree, or clobber a .env entirely outside the
// gate. This hook extracts the command's write targets and re-applies the
// security-critical subset of the pre-write checks: project scope, the harness
// machinery trust-boundary, and protected env files. Content-level checks
// (secrets, length, TDD) cannot be reproduced from a shell string and remain the
// Write path's responsibility — agents should prefer Write/Edit for source so
// those checks apply. Escape hatches: HARNESS_PROTECT=off (machinery only);
// HARNESS_PREFIX_EDIT=1 (prompt-cache prefix files only).

const path = require('path');
const { resolveProjectDir, runHook, realResolve, isWriteInScope } = require('./lib/common');
const { isHarnessRepo, machineryViolation } = require('./lib/trust-boundary');
const { prefixCacheViolation, prefixCacheBlockMessage } = require('./lib/prefix-cache');
const { isProtectedEnvFile } = require('./lib/secrets');
const { extractWriteTargets } = require('./lib/bash-targets');
const { checkGitSafety } = require('./lib/git-safety');

function block(message) {
  process.stdout.write(message);
  process.stderr.write(message); // exit-2 feedback channel for Claude Code
  process.exit(2);
}

// /dev/null, /dev/stdout, /dev/fd/2, … are benign write sinks, not files —
// `2>/dev/null` is one of the most common idioms in any shell command. Never
// treat a device node as an out-of-project write.
function isDeviceSink(target) {
  return target === '/dev/null' || target.startsWith('/dev/');
}

// The machinery / prompt-cache-prefix / protected-env subset of the target
// checks. Split out of checkTarget so each function stays within the harness's
// own function-length limit and each check is testable in isolation.
function checkProtectedTarget(projectDir, resolved, command, opts) {
  if (opts.protect && !opts.harness) {
    const rel = machineryViolation(realResolve(projectDir), resolved);
    if (rel) {
      block(`BLOCKED: Bash write to harness machinery: ${rel}\n` +
        `Agents may not modify the gates that verify their own work — not even via the shell.\n` +
        `Fix: a human applies machinery changes (HARNESS_PROTECT=off), or they land in the harness repo and are re-scaffolded.\n`);
    }
  }
  // Prompt-cache prefix applies even in the harness repo (unlike machinery).
  const prefixRel = prefixCacheViolation(realResolve(projectDir), resolved);
  if (prefixRel) {
    block(
      `BLOCKED: Bash write to prompt-cache prefix: ${prefixRel}\n` +
        `(from: ${command})\n` +
        prefixCacheBlockMessage(prefixRel)
    );
  }
  if (isProtectedEnvFile(resolved)) {
    block(`BLOCKED: Bash write to ${path.basename(resolved)} — environment files contain real secrets. Edit them manually.\n` +
      `Fix: write to .env.example for documentation, or edit .env outside Claude.\n`);
  }
}

function checkTarget(projectDir, target, command, opts) {
  if (isDeviceSink(target)) return;
  // Targets are resolved relative to the project dir — the cwd Claude Code runs
  // Bash in. realResolve handles symlinks and not-yet-existing paths.
  const abs = path.isAbsolute(target) ? target : path.join(projectDir, target);
  const resolved = realResolve(abs);

  if (!isWriteInScope(projectDir, resolved)) {
    block(`BLOCKED: Bash write outside the project directory: ${resolved}\n` +
      `(from: ${command})\nFix: write inside the project, or use Write/Edit so the gate can verify the change.\n`);
  }
  checkProtectedTarget(projectDir, resolved, command, opts);
}

runHook('pre-bash-gate', (input) => {
  if ((input.tool_name || '') !== 'Bash') process.exit(0);
  const command = (input.tool_input && input.tool_input.command) || '';
  if (typeof command !== 'string' || !command) process.exit(0);

  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));

  // Bun Phase A: deny destructive git while parallel agents are active.
  const gitSafety = checkGitSafety(command, { projectDir, env: process.env });
  if (gitSafety.block) {
    block(gitSafety.reason);
  }

  const opts = {
    protect: (process.env.HARNESS_PROTECT || '').toLowerCase() !== 'off',
    harness: isHarnessRepo(projectDir),
  };
  for (const target of extractWriteTargets(command)) {
    checkTarget(projectDir, target, command, opts);
  }
});
