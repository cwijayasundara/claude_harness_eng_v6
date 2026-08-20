#!/usr/bin/env node

'use strict';

// After /test approval, materialize sprint-contracts/{group}.json from the
// reviewed proposed-check table and freeze their hashes. /auto then skips
// generator↔evaluator negotiation. Pre-commit re-checks the hashes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gateFailure } = require('./plan-approval');
const { normalizeContract } = require('./contract-accessibility-default');
const { validate } = require('../hooks/lib/contract-schema');

const FREEZE_REL = path.join('specs', 'reviews', 'contract-freeze.json');
const PLAN_REL = path.join('specs', 'test_artefacts', 'test-plan.md');
const SCHEMA_REL = path.join('.claude', 'skills', 'evaluate', 'references', 'contract-schema.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function asArray(v) { return Array.isArray(v) ? v : []; }

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseCells(line) {
  const inner = String(line).trim();
  if (!inner.startsWith('|')) return null;
  return inner.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\\\|/g, '|'));
}

function sectionTable(md, heading) {
  const lines = String(md).split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return { headers: [], rows: [] };
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) i += 1;
  const headers = parseCells(lines[i]) || [];
  i += 1;
  if (lines[i] && /---/.test(lines[i])) i += 1;
  const rows = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    const cells = parseCells(lines[i]);
    if (cells) rows.push(cells);
    i += 1;
  }
  return { headers, rows };
}

function parseApiObserve(observe) {
  const text = String(observe || '').trim();
  if (!text || /^\(fill\)$/i.test(text)) {
    return { error: 'Observe is unfilled — write METHOD /path → status' };
  }
  const m = text.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)(?:\s*(?:→|->)\s*(\d{3}))?/i);
  if (!m) return { error: `unparseable api Observe: ${text}` };
  return { method: m[1].toUpperCase(), path: m[2], expected_status: m[3] ? Number(m[3]) : 200 };
}

function parsePwObserve(observe) {
  const text = String(observe || '').trim();
  if (!text || /^\(fill\)$/i.test(text)) {
    return { error: 'Observe is unfilled — write the UI steps the evaluator will drive' };
  }
  return { description: text, url: '/', steps: [{ action: 'interact', assertion: text }] };
}

function proposedRows(md) {
  const table = sectionTable(md, '## Proposed sprint-contract checks');
  const idx = {};
  table.headers.forEach((h, i) => { idx[h.toLowerCase()] = i; });
  const col = (row, name, fallback) => row[idx[name] != null ? idx[name] : fallback] || '';
  return table.rows.map((row) => ({
    group: col(row, 'group', 0),
    id: col(row, 'check id', 1),
    kind: col(row, 'kind', 2).toLowerCase(),
    matrix_ids: col(row, 'matrix ids', 3).split(/[,\s]+/).filter(Boolean),
    observe: col(row, 'observe', 4),
  })).filter((r) => r.kind === 'api' || r.kind === 'playwright');
}

function storiesForGroup(stories, group) {
  return asArray(stories).filter((s) => String(s.group || 'A') === group).map((s) => s.id);
}

function featuresForGroup(features, group, storyIds) {
  const hit = asArray(features).filter((f) => f.group === group || storyIds.includes(f.story)).map((f) => f.id);
  return hit.length ? hit : storyIds.slice();
}

function appendCheck(row, api_checks, playwright_checks) {
  if (row.kind === 'api') {
    const parsed = parseApiObserve(row.observe);
    if (parsed.error) return `${row.id}: ${parsed.error}`;
    api_checks.push({
      id: row.id, matrix_ids: row.matrix_ids, method: parsed.method,
      path: parsed.path, expected_status: parsed.expected_status, description: row.observe,
    });
    return null;
  }
  const parsed = parsePwObserve(row.observe);
  if (parsed.error) return `${row.id}: ${parsed.error}`;
  playwright_checks.push({
    id: row.id, matrix_ids: row.matrix_ids, description: parsed.description,
    url: parsed.url, steps: parsed.steps,
  });
  return null;
}

function buildGroupDoc(group, rows, stories, features) {
  const storyIds = storiesForGroup(stories, group);
  const api_checks = [];
  const playwright_checks = [];
  for (const row of rows.filter((r) => r.group === group)) {
    const err = appendCheck(row, api_checks, playwright_checks);
    if (err) return { error: err, doc: null };
  }
  const contract = {};
  if (api_checks.length) contract.api_checks = api_checks;
  if (playwright_checks.length) contract.playwright_checks = playwright_checks;
  return {
    error: storyIds.length ? null : `group ${group} has no stories`,
    doc: {
      group, stories: storyIds,
      features: featuresForGroup(features, group, storyIds),
      contract,
    },
  };
}

function freezePath(root) {
  return path.join(root, FREEZE_REL);
}

function verifyFreeze(root) {
  const freeze = readJson(freezePath(root), null);
  if (!freeze || !asArray(freeze.files).length) return { ok: true, skipped: true };
  const mismatches = [];
  for (const file of freeze.files) {
    const abs = path.join(root, file.path);
    if (!fs.existsSync(abs)) { mismatches.push(`${file.path} missing`); continue; }
    const hash = sha256(fs.readFileSync(abs));
    if (hash !== file.sha256) mismatches.push(`${file.path} hash changed`);
  }
  if (mismatches.length) {
    return { ok: false, error: `frozen sprint contract changed: ${mismatches.join('; ')}` };
  }
  return { ok: true, skipped: false };
}

function freeze(root) {
  const blocked = gateFailure(root, 'test', false);
  if (blocked) return { ok: false, error: `test gate: ${blocked}` };
  const planPath = path.join(root, PLAN_REL);
  if (!fs.existsSync(planPath)) return { ok: false, error: `${PLAN_REL} missing — cannot freeze` };
  const rows = proposedRows(fs.readFileSync(planPath, 'utf8'));
  const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))];
  if (!groups.length) return { ok: false, error: 'no api/playwright proposed checks to freeze' };
  const stories = readJson(path.join(root, 'specs', 'stories', 'stories.json'), []);
  const features = readJson(path.join(root, 'features.json'), []);
  const schema = readJson(path.join(root, SCHEMA_REL), null);
  const files = [];
  for (const group of groups) {
    const built = buildGroupDoc(group, rows, stories, features);
    if (built.error) return { ok: false, error: built.error };
    let doc = normalizeContract(built.doc, { enabled: true });
    if (schema) {
      const errors = validate(schema, doc);
      if (errors.length) return { ok: false, error: `${group}: ${errors.join('; ')}` };
    }
    const rel = path.join('sprint-contracts', `${group}.json`);
    writeJson(path.join(root, rel), doc);
    files.push({ path: rel, sha256: sha256(fs.readFileSync(path.join(root, rel))) });
  }
  writeJson(freezePath(root), {
    frozenAt: new Date().toISOString(),
    source: PLAN_REL,
    files,
  });
  return { ok: true, groups, files };
}

function run(argv, cwd) {
  const root = path.resolve(arg(argv, '--root', cwd) || cwd);
  if (argv.includes('--check')) {
    const result = verifyFreeze(root);
    if (!result.ok) {
      process.stderr.write(`contract-freeze: ${result.error}\n`);
      return 1;
    }
    process.stdout.write(`contract-freeze: ${result.skipped ? 'no freeze receipt' : 'hashes match'}\n`);
    return 0;
  }
  const result = freeze(root);
  if (!result.ok) {
    process.stderr.write(`contract-freeze: ${result.error}\n`);
    return 1;
  }
  process.stdout.write(`contract-freeze: froze ${result.groups.join(', ')}\n`);
  return 0;
}

module.exports = {
  freeze, verifyFreeze, parseApiObserve, parsePwObserve, proposedRows, buildGroupDoc, run,
};

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
