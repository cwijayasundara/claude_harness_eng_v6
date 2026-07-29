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
const fs = require('fs');
const { resolveProjectDir, runHook, realResolve, isWriteInScope } = require('./lib/common');
const { isHarnessRepo, machineryViolation } = require('./lib/trust-boundary');
const { prefixCacheViolation, prefixCacheBlockMessage } = require('./lib/prefix-cache');
const { isProtectedEnvFile } = require('./lib/secrets');
const { extractWriteTargets } = require('./lib/bash-targets');
const { checkGitSafety } = require('./lib/git-safety');
const { forbiddenAction, loadEnvelope, pathAllowed } = require('./lib/task-envelope');
const { lifecycleStatus, readLedger } = require('./lib/task-lifecycle');
const { readLedger: readRedPhaseLedger } = require('./lib/red-phase-ledger');
const { decideLock } = require('./lib/test-write-lock');
const { consumeCapability, detectSensitiveAction, findCapability } = require('./lib/authority-receipt');
const { classifyCommand } = require('./lib/runtime-command-policy');

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
  if (opts.envelope && !pathAllowed(opts.envelope, projectDir, resolved)) {
    const rel = path.relative(projectDir, resolved).replace(/\\/g, '/');
    block(
      `BLOCKED: Bash write to ${rel} is outside task ${opts.envelope.task_id}'s allowed_paths.\n` +
      `Allowed: ${opts.envelope.allowed_paths.join(', ')}\n` +
      `Fix: amend/recreate the task envelope before expanding scope.\n`
    );
  }
  checkProtectedTarget(projectDir, resolved, command, opts);
  checkTestWriteLock(projectDir, resolved, opts);
}

// G42, shell half. The Edit/Write path is only half a lock — `sed -i`, `tee`, and
// `patch` reach the same file. The pack's adversarial checklist calls this out
// explicitly, and extractWriteTargets already resolves those verbs, so the same
// decision runs here rather than a second, weaker one.
function checkTestWriteLock(projectDir, resolved, opts) {
  const decision = decideLock({
    ledger: readRedPhaseLedger(projectDir),
    taskId: opts.envelope ? opts.envelope.task_id : null,
    // `resolved` has been through realResolve, so it must be made relative to the
    // REAL project dir too. Relativising a /private/var path against a /var
    // projectDir yields ../../.., which never looks like a test file — the lock
    // then passes silently on every shell write. Caught by the round-trip test;
    // the unit tests could not see it.
    filePath: path.relative(realResolve(projectDir), resolved).replace(/\\/g, '/'),
    env: process.env,
  });
  if (decision.blocked) block(decision.message);
}

function activeEnvelope(projectDir) {
  const loaded = loadEnvelope(projectDir);
  if (loaded.state === 'absent') {
    const ledger = readLedger(projectDir);
    if (ledger.events.length) block('BLOCKED: task envelope is missing while lifecycle state exists; recover or abort the task.\n');
    return null;
  }
  if (loaded.state === 'invalid') {
    block(
      `BLOCKED: task envelope is invalid: ${loaded.errors.join('; ')}\n` +
      'Fix: verify and recreate .claude/state/task-envelope.json before running Bash.\n'
    );
  }
  const lifecycle = lifecycleStatus(projectDir, loaded.envelope);
  if (!lifecycle.allowed) {
    block(`BLOCKED: task ${loaded.envelope.task_id} lifecycle is ${lifecycle.state}: ${lifecycle.errors.join('; ')}\n`);
  }
  return loaded.envelope;
}

function runtimeCommandViolation(projectDir, command) {
  if (process.env.HARNESS_UNATTENDED !== '1') return null;
  try {
    const policy = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'unattended-policy.json'), 'utf8'));
    const result = classifyCommand(policy, command);
    return result.allowed ? null : result;
  } catch (_) {
    return { finding: 'unattended-policy-missing' };
  }
}

runHook('pre-bash-gate', (input) => {
  if ((input.tool_name || '') !== 'Bash') process.exit(0);
  const command = (input.tool_input && input.tool_input.command) || '';
  if (typeof command !== 'string' || !command) process.exit(0);

  const projectDir = resolveProjectDir(path.dirname(path.resolve(__filename)));
  const envelope = activeEnvelope(projectDir);
  const runtimeViolation = runtimeCommandViolation(projectDir, command);
  if (runtimeViolation) {
    block(
      `BLOCKED: unattended command violates runtime policy: ${runtimeViolation.finding}` +
      `${runtimeViolation.detail ? ` (${JSON.stringify(runtimeViolation.detail)})` : ''}.\n` +
      'Fix: use an allowed transparent command, or submit a task-bound request for external execution.\n'
    );
  }
  const sensitiveAction = detectSensitiveAction(command);
  if (sensitiveAction) {
    if (sensitiveAction === 'execute_production_change') {
      block('BLOCKED: production execution is non-delegable; a human must execute it and provide a signed execution receipt.\n');
    }
    if (!envelope) {
      block(`BLOCKED: sensitive action "${sensitiveAction}" requires a valid task envelope and signed capability.\n`);
    }
    const capability = findCapability(projectDir, envelope, sensitiveAction);
    if (!capability.valid) {
      block(
        `BLOCKED: sensitive action "${sensitiveAction}" lacks external authority.\n` +
        `${capability.errors.join('; ')}\n` +
        'Fix: obtain signed human approval receipt(s) and a short-lived capability from a trusted issuer.\n'
      );
    }
    const consumed = consumeCapability(projectDir, capability.receipt, sensitiveAction);
    if (!consumed.consumed) block(`BLOCKED: ${consumed.error}; obtain a new short-lived capability.\n`);
  }
  const denied = envelope && forbiddenAction(envelope, command);
  if (denied && (!sensitiveAction || denied === 'execute_production_change')) {
    block(
      `BLOCKED: task ${envelope.task_id} forbids action "${denied}".\n` +
      `Command: ${command}\nFix: preserve the approved authority boundary; a human must amend the task envelope.\n`
    );
  }

  // Bun Phase A: deny destructive git while parallel agents are active.
  const gitSafety = checkGitSafety(command, { projectDir, env: process.env });
  if (gitSafety.block) {
    block(gitSafety.reason);
  }

  const opts = {
    protect: (process.env.HARNESS_PROTECT || '').toLowerCase() !== 'off',
    harness: isHarnessRepo(projectDir),
    envelope,
  };
  for (const target of extractWriteTargets(command)) {
    checkTarget(projectDir, target, command, opts);
  }
});
