#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\n+/).filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter(Boolean);
}

function readRecords(root) {
  const dir = path.join(root, '.claude', 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()
    .flatMap((name) => readJsonl(path.join(dir, name)));
}

function summarize(records) {
  const outcomes = records.filter((r) => r.schema_version === 1 && r.task_id);
  const tasks = new Map();
  for (const event of outcomes) {
    const task = tasks.get(event.task_id) || { events: [], attention: 0, cost: 0 };
    task.events.push(event);
    task.attention += Number(event.attention_minutes) || 0;
    task.cost += Number(event.model_cost_usd) || 0;
    tasks.set(event.task_id, task);
  }
  const accepted = [...tasks.values()].filter((t) =>
    t.events.some((e) => e.kind === 'outcome_confirmed' && e.accepted === true));
  const survived = accepted.filter((t) =>
    !t.events.some((e) => e.kind === 'reverted' || e.kind === 'incident_linked')
    && !t.events.some((e) => e.production_survived === false));
  const attention = [...tasks.values()].reduce((sum, t) => sum + t.attention, 0);
  const cost = [...tasks.values()].reduce((sum, t) => sum + t.cost, 0);
  return {
    tasks_observed: tasks.size,
    accepted_outcomes: accepted.length,
    production_surviving_outcomes: survived.length,
    acceptance_rate: tasks.size ? accepted.length / tasks.size : 0,
    production_survival_rate: accepted.length ? survived.length / accepted.length : 0,
    attention_minutes: attention,
    model_cost_usd: cost,
    accepted_outcomes_per_attention_hour: attention ? accepted.length / (attention / 60) : null,
    model_cost_per_accepted_outcome: accepted.length ? cost / accepted.length : null,
  };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const report = summarize(readRecords(root));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { readRecords, summarize };

if (require.main === module) main();
