#!/usr/bin/env node

'use strict';

// Constraint-obligation extractor for the test-planning pipeline.
//
// The design phase emits machine-readable schemas — data-models.schema.json
// (JSON Schema draft-07+) and api-contracts.schema.json (OpenAPI 3.0). Every
// validation keyword in those schemas (minLength, maximum, pattern, enum,
// format, required, ...) is a promise the system makes about what it rejects.
// A promise nobody tests is a promise nobody keeps.
//
// This script turns each keyword into an *obligation*: a negative test the
// suite must contain. Obligations carry stable ids, so `obligationIndex` can
// feed them to trace-check.js as a `required` index — an un-covered constraint
// then fails the same hard grounding gate as an un-covered acceptance criterion.
//
// It is deterministic and dependency-free: one representative obligation per
// constraint keyword (an equivalence class), not one per value — the test
// authoring (see test-design.md) picks the boundary values.

const fs = require('fs');
const path = require('path');

// rule -> how to phrase the negative/boundary test cases it demands.
function suggestedCases(rule, value) {
  switch (rule) {
    case 'required':
      return ['omit the field — expect rejection'];
    case 'minLength':
      return [`length below ${value} — expect rejection`, `length exactly ${value} — expect acceptance`];
    case 'maxLength':
      return [`length exactly ${value} — expect acceptance`, `length above ${value} — expect rejection`];
    case 'minimum':
      return [`value below ${value} — expect rejection`, `value exactly ${value} — expect acceptance`];
    case 'maximum':
      return [`value exactly ${value} — expect acceptance`, `value above ${value} — expect rejection`];
    case 'exclusiveMinimum':
      return [`value equal to ${value} — expect rejection`, `value just above ${value} — expect acceptance`];
    case 'exclusiveMaximum':
      return [`value equal to ${value} — expect rejection`, `value just below ${value} — expect acceptance`];
    case 'pattern':
      return [`a string not matching /${value}/ — expect rejection`];
    case 'enum':
      return ['a value outside the allowed set — expect rejection'];
    case 'format':
      return [`a malformed ${value} value — expect rejection`];
    default:
      return ['violate the constraint — expect rejection'];
  }
}

function makeObligation(field, rule, value) {
  return { id: `OBL-${field}-${rule}`, field, rule, value, suggested_cases: suggestedCases(rule, value) };
}

// Constraint keywords read off a single schema node (not its children).
const NUMERIC_EXCLUSIVE = new Set(['exclusiveMinimum', 'exclusiveMaximum']);
const SCALAR_RULES = ['minLength', 'maxLength', 'pattern', 'enum', 'format', 'minimum', 'maximum'];

function nodeConstraints(field, node, out) {
  for (const rule of SCALAR_RULES) {
    if (Object.prototype.hasOwnProperty.call(node, rule)) out.push(makeObligation(field, rule, node[rule]));
  }
  // draft-06+ numeric exclusive bounds (booleans are draft-04 modifiers on
  // minimum/maximum and are intentionally ignored — the inclusive obligation
  // already covers that field).
  for (const rule of NUMERIC_EXCLUSIVE) {
    if (typeof node[rule] === 'number') out.push(makeObligation(field, rule, node[rule]));
  }
}

function isObject(v) {
  return v != null && typeof v === 'object';
}

// Walk a schema node, emitting obligations under the dotted `field` path.
function walkNode(field, node, out) {
  if (!isObject(node)) return;

  for (const comb of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(node[comb])) node[comb].forEach((sub) => walkNode(field, sub, out));
  }

  nodeConstraints(field, node, out);

  // A schema-level `required` is an array of property names. A boolean
  // `required` (OpenAPI parameter) is not ours to read.
  if (Array.isArray(node.required) && isObject(node.properties)) {
    for (const name of node.required) out.push(makeObligation(`${field}.${name}`, 'required', true));
  }

  if (isObject(node.properties)) {
    for (const [name, sub] of Object.entries(node.properties)) walkNode(`${field}.${name}`, sub, out);
  }
  if (isObject(node.items)) walkNode(`${field}[]`, node.items, out);
}

function baseName(label) {
  return path
    .basename(String(label || 'model'))
    .replace(/\.schema\.json$/i, '')
    .replace(/\.json$/i, '');
}

// Find the named entity schemas to walk, across the shapes /design emits.
function collectModels(schema, label) {
  if (!isObject(schema)) return [];
  if (isObject(schema.components) && isObject(schema.components.schemas)) {
    return Object.entries(schema.components.schemas).map(([name, node]) => ({ name, node }));
  }
  for (const defsKey of ['$defs', 'definitions']) {
    if (isObject(schema[defsKey])) return Object.entries(schema[defsKey]).map(([name, node]) => ({ name, node }));
  }
  if (isObject(schema.properties)) return [{ name: schema.title || baseName(label), node: schema }];
  // Fallback: a bare map of { ModelName: <schema> }.
  return Object.entries(schema)
    .filter(([, v]) => isObject(v) && (isObject(v.properties) || v.type))
    .map(([name, node]) => ({ name, node }));
}

// Pure core. sources is [{ label, schema }]. Returns { generated_from, obligations }.
function extractObligations(sources) {
  const raw = [];
  const generated_from = [];
  for (const { label, schema } of sources || []) {
    generated_from.push(label);
    for (const { name, node } of collectModels(schema, label)) walkNode(name, node, raw);
  }
  const byId = new Map();
  for (const o of raw) if (!byId.has(o.id)) byId.set(o.id, o);
  const obligations = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { generated_from, obligations };
}

// Render obligations as trace-check.js `required` items, so an un-covered
// constraint is a `dropped` upstream id at the test grounding gate.
function obligationIndex(result) {
  return (result.obligations || []).map((o) => ({ id: o.id, text: `${o.field}: ${o.rule}` }));
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { schemas: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'schemas') args.schemas.push(argv[i + 1]);
    else args[name] = argv[i + 1];
  }
  return args;
}

function loadSources(files) {
  const sources = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      process.stderr.write(`constraints-extract: schema not found, skipping: ${file}\n`);
      continue;
    }
    let schema;
    try {
      schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`invalid JSON in ${file}: ${err.message}`);
    }
    sources.push({ label: file, schema });
  }
  return sources;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.schemas.length === 0) {
    process.stderr.write('usage: constraints-extract.js --schemas <file> [--schemas <file>...] [--out <file>] [--index-out <file>]\n');
    process.exit(2);
  }
  let result;
  try {
    result = extractObligations(loadSources(args.schemas));
  } catch (err) {
    process.stderr.write(`constraints-extract: ${err.message}\n`);
    process.exit(2);
  }
  if (args.out) writeJson(args.out, result);
  if (args['index-out']) writeJson(args['index-out'], obligationIndex(result));
  process.stdout.write(
    `constraint obligations: ${result.obligations.length} from ${result.generated_from.length} schema(s)\n`
  );
  process.exit(0);
}

module.exports = { extractObligations, obligationIndex };

if (require.main === module) main();
