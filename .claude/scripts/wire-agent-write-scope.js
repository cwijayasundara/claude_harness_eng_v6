#!/usr/bin/env node

'use strict';

// CLI: HARNESS_PREFIX_EDIT=1 node .claude/scripts/wire-agent-write-scope.js
//
// Registers agent-write-scope.js as a PreToolUse hook on Write|Edit|MultiEdit.
//
// This is a separate, human-run step on purpose. `.claude/settings.json` is a
// prompt-cache prefix file: editing it mid-session invalidates the cached
// prefix for every later turn, which is why pre-write-gate refuses the edit
// without HARNESS_PREFIX_EDIT. This script honours that rule rather than
// routing around it — run it between sessions, then start a new session.
//
// Idempotent: running it twice changes nothing.
// Exit 0 = wired (or already wired), 1 = refused, 2 = IO error.

const fs = require('fs');
const path = require('path');

const MATCHER = 'Write|Edit|MultiEdit';
const COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-write-scope.js"';

function prefixEditAllowed() {
  const v = (process.env.HARNESS_PREFIX_EDIT || '').toLowerCase();
  return v === '1' || v === 'off' || v === 'allow' || v === 'true';
}

function alreadyWired(preToolUse) {
  return preToolUse.some((entry) => (entry.hooks || [])
    .some((h) => typeof h.command === 'string' && h.command.includes('agent-write-scope.js')));
}

function addHook(preToolUse) {
  const existing = preToolUse.find((entry) => entry.matcher === MATCHER);
  const hook = { type: 'command', command: COMMAND, timeout: 5000 };
  if (existing) {
    existing.hooks = [...(existing.hooks || []), hook];
    return `appended to the existing "${MATCHER}" entry`;
  }
  preToolUse.push({ matcher: MATCHER, hooks: [hook] });
  return `added a new "${MATCHER}" entry`;
}

function refuse() {
  process.stderr.write(
    'wire-agent-write-scope: refusing to edit .claude/settings.json without HARNESS_PREFIX_EDIT.\n'
    + 'It is a prompt-cache prefix file; editing it mid-session busts the cache for every later\n'
    + 'turn. Run this between sessions:\n\n'
    + '  HARNESS_PREFIX_EDIT=1 node .claude/scripts/wire-agent-write-scope.js\n\n'
    + 'then start a new Claude Code session so the hook is loaded.\n');
  return 1;
}

function main(cwd) {
  if (!prefixEditAllowed()) return refuse();

  const file = path.join(cwd, '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`wire-agent-write-scope: cannot read ${file}: ${err.message}\n`);
    return 2;
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  if (alreadyWired(settings.hooks.PreToolUse)) {
    process.stdout.write('wire-agent-write-scope: already wired — nothing to do\n');
    return 0;
  }

  const how = addHook(settings.hooks.PreToolUse);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  process.stdout.write(
    `wire-agent-write-scope: ${how}.\n`
    + 'Start a new Claude Code session for the hook to take effect, then:\n'
    + '  node --test test/agent-write-scope-wiring.test.js\n');
  return 0;
}

if (require.main === module) process.exit(main(process.env.CLAUDE_PROJECT_DIR || process.cwd()));

module.exports = { addHook, alreadyWired, main };
