#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MATRIX = path.join('specs', 'test_artefacts', 'verification-matrix.json');
const VERDICT_PATH = path.join('specs', 'reviews', 'verification-matrix-verdict.json');
const CONTRACT_LAYERS = new Set(['api', 'e2e', 'accessibility', 'security', 'performance']);
const VALID_PHASES = new Set(['plan', 'contract', 'implementation', 'executed']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function add(failures, code, detail) {
  failures.push(Object.assign({ code }, detail));
}

function relExists(root, rel) {
  return typeof rel === 'string' && rel.length > 0 && fs.existsSync(path.join(root, rel));
}

function evidencePath(check) {
  return check && (check.evidence_path || check.evidencePath || check.evidence);
}

function loadMatrix(root, matrixPath) {
  const file = path.resolve(root, matrixPath || DEFAULT_MATRIX);
  const matrix = readJson(file, null);
  if (!matrix) throw new Error(`matrix not found: ${path.relative(root, file)}`);
  return asArray(matrix.requirements);
}

function scopedRows(rows, group) {
  if (!group) return rows;
  return rows.filter((row) => !row.group || row.group === group);
}

function matrixIdSet(rows) {
  return new Set(rows.map((row) => row.id).filter(Boolean));
}

function storyAcIds(root, rows, group) {
  const traces = readJson(path.join(root, 'specs', 'stories', 'story-traces.json'), []);
  const storyIds = group ? new Set(rows.map((row) => row.story_id).filter(Boolean)) : null;
  return new Set(
    asArray(traces)
      .filter((story) => !storyIds || storyIds.has(story.id))
      .flatMap((story) => asArray(story.acs))
  );
}

function validatePlan(root, rows, failures, group) {
  const acIds = storyAcIds(root, rows, group);
  const coveredAcs = new Set();

  for (const row of rows) {
    if (!row.id) add(failures, 'missing_matrix_id', { ac_id: row.ac_id || null });
    if (!row.ac_id || !acIds.has(row.ac_id)) {
      add(failures, 'invalid_ac_trace', { matrix_id: row.id || null, ac_id: row.ac_id || null });
    } else {
      coveredAcs.add(row.ac_id);
    }
    if (asArray(row.required_layers).length === 0) {
      add(failures, 'missing_required_layers', { matrix_id: row.id || null });
    }
    const plannedLayers = new Set(asArray(row.checks).map((check) => check && check.layer).filter(Boolean));
    for (const layer of asArray(row.required_layers)) {
      if (!plannedLayers.has(layer)) {
        add(failures, 'missing_planned_layer', { matrix_id: row.id || null, layer });
      }
    }
  }

  for (const ac_id of acIds) {
    if (!coveredAcs.has(ac_id)) add(failures, 'missing_matrix_obligation', { ac_id });
  }
}

function matrixIdsForCheck(check) {
  return asArray(check && check.matrix_ids);
}

function collectContractChecks(contract) {
  const checkSource = contract && contract.contract ? contract.contract : contract;
  const checks = [];
  const arrayFields = [
    ['api_checks', 'api'],
    ['playwright_checks', 'e2e'],
    ['design_checks', 'design'],
    ['performance_checks', 'performance'],
  ];

  for (const [field, layer] of arrayFields) {
    for (const check of asArray(checkSource[field])) checks.push({ layer, check });
  }

  for (const [field, layer] of [
    ['accessibility_checks', 'accessibility'],
    ['security_checks', 'security'],
  ]) {
    const value = checkSource[field];
    if (Array.isArray(value)) {
      for (const check of value) checks.push({ layer, check });
    } else if (value && typeof value === 'object') {
      checks.push({ layer, check: value });
    }
  }

  return checks;
}

function validateContract(root, rows, group, failures, allRows) {
  if (!group) {
    add(failures, 'missing_group', {});
    return;
  }

  const contract = readJson(path.join(root, 'sprint-contracts', `${group}.json`), null);
  if (!contract) {
    add(failures, 'missing_contract', { group });
    return;
  }

  const scopedIds = matrixIdSet(rows);
  const allIds = matrixIdSet(allRows || rows);
  const covered = new Map();

  for (const { layer, check } of collectContractChecks(contract)) {
    const matrixIds = matrixIdsForCheck(check);
    if (matrixIds.length === 0) {
      add(failures, 'missing_matrix_ids', { layer, check_id: check && (check.id || check.name) || layer });
      continue;
    }

    for (const matrix_id of matrixIds) {
      if (!allIds.has(matrix_id)) {
        add(failures, 'unknown_matrix_id', { layer, matrix_id });
        continue;
      }
      if (!scopedIds.has(matrix_id)) {
        add(failures, 'out_of_scope_matrix_id', { layer, matrix_id, group });
        continue;
      }
      if (!covered.has(matrix_id)) covered.set(matrix_id, new Set());
      covered.get(matrix_id).add(layer);
    }
  }

  for (const row of rows) {
    for (const layer of asArray(row.required_layers)) {
      if (!CONTRACT_LAYERS.has(layer)) continue;
      if (!covered.get(row.id) || !covered.get(row.id).has(layer)) {
        add(failures, 'missing_contract_layer', { matrix_id: row.id, layer });
      }
    }
  }
}

function traceRows(root, rel) {
  return asArray(readJson(path.join(root, rel), []));
}

function validateTraceLayer(root, rows, layer, traceRel, failures, allRows) {
  const scopedIds = matrixIdSet(rows);
  const allIds = matrixIdSet(allRows || rows);
  const covered = new Set();

  for (const trace of traceRows(root, traceRel)) {
    const matrix_id = trace.matrix_id || null;
    if (!allIds.has(matrix_id)) {
      add(failures, 'unknown_matrix_id', { layer, matrix_id });
      continue;
    }
    if (!scopedIds.has(matrix_id)) continue;
    covered.add(matrix_id);
    if (!relExists(root, trace.path)) {
      add(failures, 'missing_artifact', { layer, matrix_id, path: trace.path || null });
    }
  }

  for (const row of rows) {
    if (asArray(row.required_layers).includes(layer) && !covered.has(row.id)) {
      add(failures, 'missing_trace', { matrix_id: row.id, layer });
    }
  }
}

function validateImplementation(root, rows, failures, allRows) {
  validateTraceLayer(root, rows, 'unit', path.join('specs', 'test_artefacts', 'unit-traces.json'), failures, allRows);
  validateTraceLayer(root, rows, 'integration', path.join('specs', 'test_artefacts', 'integration-traces.json'), failures, allRows);
}

function validateExecuted(root, rows, failures, allRows) {
  validateImplementation(root, rows, failures, allRows);
  validateTraceLayer(root, rows, 'e2e', path.join('specs', 'test_artefacts', 'e2e-traces.json'), failures, allRows);

  for (const row of rows) {
    for (const layer of asArray(row.required_layers)) {
      const checks = asArray(row.checks).filter((check) => check && check.layer === layer);
      if (checks.length === 0) {
        add(failures, 'missing_executed_evidence', { matrix_id: row.id, layer });
        continue;
      }
      for (const check of checks) {
        const evidence = evidencePath(check);
        if (check.status !== 'executed' || !relExists(root, evidence)) {
          add(failures, 'missing_executed_evidence', {
            matrix_id: row.id,
            layer,
            check_id: check.id || null,
            path: evidence || null,
          });
        }
      }
    }
  }

  const needsRuntime = rows.some((row) => asArray(row.required_layers).some((layer) => CONTRACT_LAYERS.has(layer)));
  if (!needsRuntime) return;

  let report = '';
  try {
    report = fs.readFileSync(path.join(root, 'specs', 'reviews', 'evaluator-report.md'), 'utf8');
  } catch (_) {
    report = '';
  }

  if (!/^VERDICT:\s*PASS\s*$/m.test(report)) {
    add(failures, 'evaluator_not_pass', { path: 'specs/reviews/evaluator-report.md' });
  }
}

function runGate(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || process.cwd());
  const phase = opts.phase || 'plan';
  if (!VALID_PHASES.has(phase)) throw new Error(`invalid phase: ${phase}`);
  const allRows = loadMatrix(root, opts.matrix || DEFAULT_MATRIX);
  const rows = scopedRows(allRows, opts.group);
  const failures = [];

  validatePlan(root, rows, failures, opts.group);
  if (phase === 'contract') validateContract(root, rows, opts.group, failures, allRows);
  else if (phase === 'implementation') validateImplementation(root, rows, failures, allRows);
  else if (phase === 'executed') validateExecuted(root, rows, failures, allRows);

  return {
    phase,
    group: opts.group || null,
    pass: failures.length === 0,
    rows_checked: rows.length,
    failures,
  };
}

function parseArgs(argv) {
  const out = {};
  const valueFor = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--phase') out.phase = valueFor(arg, i++);
    else if (arg === '--group') out.group = valueFor(arg, i++);
    else if (arg === '--matrix') out.matrix = valueFor(arg, i++);
    else if (arg === '--root') out.root = valueFor(arg, i++);
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (out.phase && !VALID_PHASES.has(out.phase)) throw new Error(`invalid phase: ${out.phase}`);
  return out;
}

function writeVerdict(root, verdict) {
  const out = path.join(root, VERDICT_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`verification-matrix-gate: ${err.message}\n`);
    process.exit(2);
  }

  const root = path.resolve(args.root || process.cwd());
  let verdict;
  try {
    verdict = runGate(Object.assign({}, args, { root }));
    writeVerdict(root, verdict);
  } catch (err) {
    process.stderr.write(`verification-matrix-gate: ${err.message}\n`);
    process.exit(2);
  }

  process.stdout.write(`verification-matrix: ${verdict.pass ? 'PASS' : 'FAIL'} (${verdict.failures.length} failure(s))\n`);
  process.exit(verdict.pass ? 0 : 1);
}

module.exports = {
  runGate,
  validatePlan,
  validateContract,
  validateImplementation,
  validateExecuted,
};

if (require.main === module) main();
