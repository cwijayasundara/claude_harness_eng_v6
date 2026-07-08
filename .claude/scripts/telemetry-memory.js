#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const { readSkillCatalog, collectSkillInventory, inferRecordSkills, addSkillUsage } = require('./telemetry-skill-helpers');
const { processPhaseEval } = require('./telemetry-phase-eval');

const { rotateLedgerIfNeeded } = require('./telemetry-ledger-rotate');
const { pipelineGaugeLines } = require('./telemetry-pipeline-gauges');

const MEMORY_JOB = 'claude_harness_memory';
const LEDGER_FILE = 'telemetry-ledger.jsonl';

function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function labelPairs(pairs) {
  return pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name, value]) => `${name}="${escapeLabelValue(value)}"`);
}

function formatLabels(labels) {
  return labels.length ? `{${labels.join(',')}}` : '';
}

function metricLine(name, labels, value) {
  return `${name}${formatLabels(labels)} ${value}`;
}

function metricKey(name, labels) {
  return `${name}{${labels.slice().sort().join(',')}}`;
}

function ledgerPath(stateDir) {
  return path.join(stateDir, LEDGER_FILE);
}

function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\n+/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function readRunReceipts(projectDir) {
  const runsDir = path.join(projectDir, '.claude', 'runs');
  try {
    return fs.readdirSync(runsDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .flatMap((name) => readJsonl(path.join(runsDir, name)));
  } catch (_) {
    return [];
  }
}

function seedLedgerFromRuns(projectDir, stateDir) {
  const target = ledgerPath(stateDir);
  if (fs.existsSync(target)) return;
  const records = readRunReceipts(projectDir);
  if (records.length === 0) return;
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(target, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function appendLedger(stateDir, record) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(ledgerPath(stateDir), JSON.stringify(record) + '\n');
  rotateLedgerIfNeeded(ledgerPath(stateDir));
}

function readLedger(stateDir) {
  return readJsonl(ledgerPath(stateDir));
}

function stableProjectInstance(projectDir) {
  // basename alone collides across same-named projects (and hosts pushing to
  // a shared gateway) — POST replaces the whole push group, so a collision
  // silently wipes the other project's metrics. Suffix with a short hash of
  // host + absolute path to keep groups disjoint yet human-readable.
  const dir = projectDir || process.cwd();
  // realpath: /var vs /private/var symlink spellings of one directory must
  // not produce two push groups (macOS).
  let canonical;
  try {
    canonical = fs.realpathSync(dir);
  } catch (_) {
    canonical = path.resolve(dir);
  }
  const hash = require('crypto')
    .createHash('sha256')
    .update(`${os.hostname()}:${canonical}`)
    .digest('hex')
    .slice(0, 8);
  return `${path.basename(dir) || os.hostname()}-${hash}`;
}

function baseLabels(record) {
  return labelPairs([
    ['user', record.user],
    ['lane', record.lane],
    ['mode', record.mode],
    ['agent', record.agent],
    ['group', record.group_id],
    ['story', record.story_id],
    ['iteration', record.iteration],
    ['host', record.host],
  ]);
}

function addCounter(counters, name, labels, amount = 1) {
  const key = metricKey(name, labels);
  const existing = counters.get(key) || { name, labels, value: 0 };
  existing.value += amount;
  counters.set(key, existing);
}

function setGauge(gauges, name, labels, value) {
  gauges.set(metricKey(name, labels), { name, labels, value });
}

const metricHelpers = { labelPairs, setGauge, addCounter };

// Handles subagent, turn, and subagent_stop record kinds.
function processAgentKinds(record, labels, counters) {
  if (record.kind === 'subagent') {
    addCounter(counters, 'harness_agent_runs_total', labelPairs([
      ['kind', 'subagent'], ['exit', record.exit || 'ok'],
    ]).concat(labels));
  } else if (record.kind === 'turn') {
    addCounter(counters, 'harness_conversation_turns_total', labelPairs([['kind', 'turn']]).concat(labels));
  } else if (record.kind === 'subagent_stop') {
    addCounter(counters, 'harness_conversation_turns_total', labelPairs([['kind', 'subagent_stop']]).concat(labels));
    if (record.agent && record.agent !== 'unknown') {
      addCounter(counters, 'harness_agent_runs_total', labelPairs([
        ['kind', 'subagent_stop'], ['exit', record.exit || 'ok'],
      ]).concat(labels));
    }
  }
}

// Handles prompt and tool record kinds.
function processCommandKinds(record, counters) {
  if (record.kind === 'prompt') {
    addCounter(counters, 'harness_conversation_turns_total', labelPairs([['kind', 'prompt']]).concat(baseLabels(record)));
    addCounter(counters, 'harness_command_invocations_total', labelPairs([
      ['kind', 'prompt'], ['command', record.command], ['user', record.user],
      ['lane', record.lane], ['mode', record.mode], ['group', record.group_id],
      ['story', record.story_id], ['iteration', record.iteration], ['host', record.host],
    ]));
  } else if (record.kind === 'tool') {
    addCounter(counters, 'harness_tool_events_total', labelPairs([
      ['kind', 'tool'], ['tool', record.tool], ['exit', record.exit || 'ok'],
      ['user', record.user], ['lane', record.lane], ['mode', record.mode],
      ['group', record.group_id], ['story', record.story_id],
      ['iteration', record.iteration], ['host', record.host],
    ]));
  }
}

function processRecordKind(record, labels, counters) {
  processAgentKinds(record, labels, counters);
  processCommandKinds(record, counters);
}

// Emits gauge metrics derived from a single record's iteration/story context.
function processRecordGauges(record, gauges) {
  if (record.iteration) {
    setGauge(gauges, 'harness_iteration_current', labelPairs([
      ['user', record.user], ['group', record.group_id],
      ['lane', record.lane], ['mode', record.mode],
    ]), parseInt(record.iteration, 10) || 0);
  }
  if (record.story_id) {
    setGauge(gauges, 'harness_story_active', labelPairs([
      ['user', record.user], ['group', record.group_id],
      ['story', record.story_id], ['lane', record.lane],
    ]), 1);
  }
}

function buildSnapshot(records, skillInventory = []) {
  const counters = new Map();
  const gauges = new Map();
  const skillInfo = new Map();

  collectSkillInventory({ skill_inventory: skillInventory }, skillInfo, metricHelpers);

  for (const record of records) {
    collectSkillInventory(record, skillInfo, metricHelpers);
    addSkillUsage(record, counters, skillInventory, metricHelpers);
    processRecordKind(record, baseLabels(record), counters);
    processRecordGauges(record, gauges);
    processPhaseEval(record, counters, gauges, metricHelpers);
  }

  return [...counters.values(), ...gauges.values(), ...skillInfo.values()]
    .map((entry) => metricLine(entry.name, entry.labels, entry.value))
    .join('\n') + '\n';
}

// Sends body to the Pushgateway URL and resolves with {pushed, body, statusCode}.
// pushed is true only when the server responds with HTTP < 400.
function sendMetrics(resolve, target, projectDir, body) {
  try {
    const url = new URL(target);
    const basePath = url.pathname.replace(/\/$/, '');
    const client = url.protocol === 'https:' ? https : http;
    const instance = encodeURIComponent(stableProjectInstance(projectDir));
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 9091),
      path: `${basePath}/metrics/job/${MEMORY_JOB}/instance/${instance}`,
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Content-Length': Buffer.byteLength(body) },
      timeout: 2000,
    });
    req.on('error', () => resolve({ pushed: false, body }));
    // Consume the response to read the HTTP status code.
    // req 'close' without a 'response' event fires only on connection errors
    // (already handled by 'error' above), so 'response' is the success path.
    req.on('response', (res) => {
      res.resume(); // drain so the socket is released
      const statusCode = res.statusCode;
      res.on('end', () => resolve({ pushed: statusCode < 400, body, statusCode }));
    });
    req.end(body);
  } catch (_) {
    resolve({ pushed: false, body });
  }
}

function pushSnapshot({ projectDir, stateDir, gatewayUrl }) {
  return new Promise((resolve) => {
    // Telemetry is opt-in: with no Pushgateway URL configured there is nothing
    // to push to, so skip entirely rather than defaulting to localhost. Setting
    // HARNESS_PUSHGATEWAY_URL (see docs/telemetry.md) turns the push on.
    const target = gatewayUrl || process.env.HARNESS_PUSHGATEWAY_URL;
    if (!target) return resolve({ pushed: false, body: '', disabled: true });

    seedLedgerFromRuns(projectDir, stateDir);
    // Append pipeline-progress gauges (features/coverage) so every push — including
    // the live record-run hook pushes — keeps them current. They share the same
    // job/instance group, so they must travel in the same body (a POST replaces
    // the whole group). Empty for a fresh project, preserving empty-push behaviour.
    const body = buildSnapshot(readLedger(stateDir), readSkillCatalog(projectDir))
      + pipelineGaugeLines(projectDir);
    if (body.trim() === '') return resolve({ pushed: false, body });

    sendMetrics(resolve, target, projectDir, body);
  });
}

module.exports = {
  MEMORY_JOB,
  LEDGER_FILE,
  appendLedger,
  readSkillCatalog,
  readLedger,
  inferRecordSkills,
  readRunReceipts,
  seedLedgerFromRuns,
  buildSnapshot,
  pushSnapshot,
  stableProjectInstance,
};
