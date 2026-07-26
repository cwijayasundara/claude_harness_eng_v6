'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalize, contentHash } = require('./task-envelope');

const LEDGER_REL = path.join('.claude', 'state', 'task-lifecycle.jsonl');
const TRANSITIONS = Object.freeze({
  created: new Set(['active', 'aborted']),
  active: new Set(['amended', 'completed', 'aborted']),
  amended: new Set(['active', 'aborted']),
  completed: new Set(['created']),
  aborted: new Set(['created']),
});

function eventHash(event) {
  const body = { ...event };
  delete body.event_hash;
  return crypto.createHash('sha256').update(canonicalize(body)).digest('hex');
}

function readLedger(root) {
  const file = path.join(root, LEDGER_REL);
  if (!fs.existsSync(file)) return { state: 'absent', file, events: [], errors: [] };
  const errors = [];
  const events = [];
  for (const [index, line] of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).entries()) {
    try {
      const event = JSON.parse(line);
      const previous = events[events.length - 1];
      if (event.sequence !== index + 1) errors.push(`sequence mismatch at ${index + 1}`);
      if (event.previous_event_hash !== (previous ? previous.event_hash : null)) errors.push(`chain mismatch at ${index + 1}`);
      if (event.event_hash !== eventHash(event)) errors.push(`event hash mismatch at ${index + 1}`);
      events.push(event);
    } catch (err) { errors.push(`unparseable event ${index + 1}: ${err.message}`); }
  }
  return { state: errors.length ? 'invalid' : 'valid', file, events, errors };
}

function appendEvent(root, envelope, state, details = {}, now = new Date()) {
  const ledger = readLedger(root);
  if (ledger.state === 'invalid') throw new Error(ledger.errors.join('; '));
  const previous = ledger.events[ledger.events.length - 1] || null;
  if (previous && !TRANSITIONS[previous.state]?.has(state)) {
    throw new Error(`invalid lifecycle transition ${previous.state} -> ${state}`);
  }
  const event = {
    schema_version: 1, sequence: ledger.events.length + 1, state,
    task_id: envelope.task_id, task_envelope_hash: contentHash(envelope),
    at: now.toISOString(), previous_event_hash: previous ? previous.event_hash : null,
    ...details,
  };
  event.event_hash = eventHash(event);
  fs.mkdirSync(path.dirname(ledger.file), { recursive: true });
  fs.appendFileSync(ledger.file, `${JSON.stringify(event)}\n`);
  return event;
}

function lifecycleStatus(root, envelope, now = new Date()) {
  const ledger = readLedger(root);
  if (ledger.state === 'invalid') return { allowed: false, state: 'invalid', errors: ledger.errors };
  if (envelope.expires_at && Date.parse(envelope.expires_at) <= now.getTime()) {
    return { allowed: false, state: 'expired', errors: ['task envelope expired'] };
  }
  if (ledger.state === 'absent' || ledger.events.length === 0) return { allowed: true, state: 'legacy-active', errors: [] };
  const event = ledger.events[ledger.events.length - 1];
  if (event.task_id !== envelope.task_id || event.task_envelope_hash !== contentHash(envelope)) {
    return { allowed: false, state: 'stale', errors: ['lifecycle does not bind current task envelope'] };
  }
  return { allowed: event.state === 'active', state: event.state, event, errors: [] };
}

module.exports = { LEDGER_REL, TRANSITIONS, appendEvent, eventHash, lifecycleStatus, readLedger };
