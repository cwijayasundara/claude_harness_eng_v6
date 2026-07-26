#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { contentHash, loadEnvelope } = require('../hooks/lib/task-envelope');
const { appendEvent, lifecycleStatus } = require('../hooks/lib/task-lifecycle');

function transition(root, state, reason, now = new Date()) {
  const loaded = loadEnvelope(root);
  if (loaded.state !== 'valid') throw new Error(`task envelope is ${loaded.state}`);
  if (state === 'completed') {
    const file = path.join(root, '.claude', 'state', 'task-completion-receipt.json');
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { receipt = null; }
    if (!receipt || receipt.pass !== true || receipt.task_envelope_hash !== contentHash(loaded.envelope)) {
      throw new Error('completion requires a passing receipt bound to the current task envelope');
    }
  }
  return appendEvent(root, loaded.envelope, state, { reason: reason || null }, now);
}

function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    if (argv[0] === 'status') {
      const loaded = loadEnvelope(root);
      const status = loaded.state === 'valid' ? lifecycleStatus(root, loaded.envelope) : { state: loaded.state, allowed: false };
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      if (!status.allowed && !['completed', 'aborted'].includes(status.state)) process.exitCode = 1;
      return;
    }
    if (argv[0] !== 'transition' || !argv[1]) throw new Error('usage: task-lifecycle.js status|transition <active|completed|aborted>');
    const event = transition(root, argv[1], argv.slice(2).join(' '));
    process.stdout.write(`task-lifecycle: ${event.task_id} -> ${event.state}\n`);
  } catch (err) {
    process.stderr.write(`task-lifecycle: ${err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { transition };
if (require.main === module) main();
