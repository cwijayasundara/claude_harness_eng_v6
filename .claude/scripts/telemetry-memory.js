#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

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

function parseSkillFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  const result = {};
  if (!match) return result;
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    result[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

function truncateLabel(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function readSkillCatalog(projectDir) {
  const skillsDir = path.join(projectDir, '.claude', 'skills');
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        const raw = fs.readFileSync(skillPath, 'utf8');
        const frontmatter = parseSkillFrontmatter(raw);
        return {
          name: frontmatter.name || entry.name,
          directory: entry.name,
          path: `.claude/skills/${entry.name}/SKILL.md`,
          description: truncateLabel(frontmatter.description || ''),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) {
    return [];
  }
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
}

function readLedger(stateDir) {
  return readJsonl(ledgerPath(stateDir));
}

function stableProjectInstance(projectDir) {
  return path.basename(projectDir || process.cwd()) || os.hostname();
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

function collectSkillInventory(record, skillInfo) {
  for (const skill of [...(record.skill_inventory || []), ...(record.skills || [])]) {
    if (!skill || !skill.name) continue;
    const labels = labelPairs([
      ['skill', skill.name],
      ['directory', skill.directory || skill.name],
      ['path', skill.path],
      ['description', skill.description],
    ]);
    setGauge(skillInfo, 'harness_skill_info', labels, 1);
  }
}

function inferRecordSkills(record, skillInventory) {
  if (Array.isArray(record.skills) && record.skills.length > 0) return record.skills;
  const byName = new Map();
  for (const skill of skillInventory) {
    byName.set(skill.name, skill);
    byName.set(skill.directory, skill);
  }
  const inferred = [];
  for (const value of [record.command, record.lane]) {
    const skill = byName.get(value);
    if (skill && !inferred.some((item) => item.name === skill.name)) {
      inferred.push({ ...skill, source: value === record.command ? 'command' : 'lane' });
    }
  }
  return inferred;
}

function addSkillUsage(record, counters, skillInventory) {
  for (const skill of inferRecordSkills(record, skillInventory)) {
    if (!skill || !skill.name) continue;
    addCounter(counters, 'harness_skill_usage_total', labelPairs([
      ['skill', skill.name],
      ['directory', skill.directory || skill.name],
      ['source', skill.source || 'hook'],
      ['kind', record.kind],
      ['command', record.command],
      ['tool', record.tool],
      ['agent', record.agent],
      ['user', record.user],
      ['lane', record.lane],
      ['mode', record.mode],
      ['group', record.group_id],
      ['story', record.story_id],
      ['iteration', record.iteration],
      ['host', record.host],
    ]));
  }
}

function buildSnapshot(records, skillInventory = []) {
  const counters = new Map();
  const gauges = new Map();
  const skillInfo = new Map();

  collectSkillInventory({ skill_inventory: skillInventory }, skillInfo);

  for (const record of records) {
    collectSkillInventory(record, skillInfo);
    addSkillUsage(record, counters, skillInventory);
    const labels = baseLabels(record);
    if (record.kind === 'subagent') {
      addCounter(counters, 'harness_agent_runs_total', labelPairs([
        ['kind', 'subagent'],
        ['exit', record.exit || 'ok'],
      ]).concat(labels));
    } else if (record.kind === 'turn') {
      addCounter(counters, 'harness_conversation_turns_total', labelPairs([['kind', 'turn']]).concat(labels));
      if (typeof record.pending_reviews === 'number') {
        setGauge(gauges, 'harness_pending_reviews', labels, record.pending_reviews);
      }
    } else if (record.kind === 'subagent_stop') {
      addCounter(counters, 'harness_conversation_turns_total', labelPairs([['kind', 'subagent_stop']]).concat(labels));
      if (record.agent && record.agent !== 'unknown') {
        addCounter(counters, 'harness_agent_runs_total', labelPairs([
          ['kind', 'subagent_stop'],
          ['exit', record.exit || 'ok'],
        ]).concat(labels));
      }
    } else if (record.kind === 'prompt') {
      addCounter(counters, 'harness_conversation_turns_total', labelPairs([['kind', 'prompt']]).concat(labels));
      addCounter(counters, 'harness_command_invocations_total', labelPairs([
        ['kind', 'prompt'],
        ['command', record.command],
        ['user', record.user],
        ['lane', record.lane],
        ['mode', record.mode],
        ['group', record.group_id],
        ['story', record.story_id],
        ['iteration', record.iteration],
        ['host', record.host],
      ]));
    } else if (record.kind === 'tool') {
      addCounter(counters, 'harness_tool_events_total', labelPairs([
        ['kind', 'tool'],
        ['tool', record.tool],
        ['exit', record.exit || 'ok'],
        ['user', record.user],
        ['lane', record.lane],
        ['mode', record.mode],
        ['group', record.group_id],
        ['story', record.story_id],
        ['iteration', record.iteration],
        ['host', record.host],
      ]));
    }

    if (record.iteration) {
      setGauge(gauges, 'harness_iteration_current', labelPairs([
        ['user', record.user],
        ['group', record.group_id],
        ['lane', record.lane],
        ['mode', record.mode],
      ]), parseInt(record.iteration, 10) || 0);
    }

    if (record.story_id) {
      setGauge(gauges, 'harness_story_active', labelPairs([
        ['user', record.user],
        ['group', record.group_id],
        ['story', record.story_id],
        ['lane', record.lane],
      ]), 1);
    }
  }

  return [...counters.values(), ...gauges.values(), ...skillInfo.values()]
    .map((entry) => metricLine(entry.name, entry.labels, entry.value))
    .join('\n') + '\n';
}

function pushSnapshot({ projectDir, stateDir, gatewayUrl }) {
  return new Promise((resolve) => {
    seedLedgerFromRuns(projectDir, stateDir);
    const body = buildSnapshot(readLedger(stateDir), readSkillCatalog(projectDir));
    if (body.trim() === '') return resolve({ pushed: false, body });

    try {
      const url = new URL(gatewayUrl || process.env.HARNESS_PUSHGATEWAY_URL || 'http://localhost:9091');
      const basePath = url.pathname.replace(/\/$/, '');
      const client = url.protocol === 'https:' ? https : http;
      const instance = encodeURIComponent(stableProjectInstance(projectDir));
      const req = client.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 9091),
        path: `${basePath}/metrics/job/${MEMORY_JOB}/instance/${instance}`,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; version=0.0.4',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 2000,
      });
      req.on('error', () => resolve({ pushed: false, body }));
      req.on('close', () => resolve({ pushed: true, body }));
      req.end(body);
    } catch (_) {
      resolve({ pushed: false, body });
    }
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
