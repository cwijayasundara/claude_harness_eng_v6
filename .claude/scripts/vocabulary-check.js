#!/usr/bin/env node

'use strict';

// Deterministic vocabulary-consistency sensor (traceability axis): extends
// trace-check.js's ID-linkage discipline to term-linkage. Checks that every
// entity/field name surfaced in domain_concepts, data-models.schema.json, and
// api-contracts.schema.json resolves to a term already defined in CONTEXT.md,
// so "Account" in the BRD and "User" in the API contract can no longer trace
// cleanly just because their IDs line up.
//
//   undocumented — a candidate name with no matching glossary term. Hard
//                  block: an entity nobody defined in CONTEXT.md.
//   unused       — a glossary term no candidate currently references. Report
//                  only: expected mid-pipeline noise (BRD named a concept
//                  design/implementation hasn't reached yet), not a defect.
//
// pass = undocumented is empty. unused never fails the gate.

const fs = require('fs');
const path = require('path');

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeTerm(name) {
  let s = String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (s.length > 2 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

function parseGlossaryTerms(markdown) {
  const lines = String(markdown == null ? '' : markdown).split(/\r?\n/);
  const terms = [];
  let inTerms = false;
  for (const line of lines) {
    if (/^##\s+Terms\s*$/i.test(line)) { inTerms = true; continue; }
    if (inTerms && /^##\s+/.test(line)) break;
    if (inTerms) {
      const m = line.match(/^###\s+(.+?)\s*$/);
      if (m) terms.push(m[1].trim());
    }
  }
  return terms;
}

function candidatesFromDomainConcepts(json, source) {
  return asArray(json && json.domain_concepts).filter((c) => c && c.name).map((c) => ({ name: c.name, source }));
}

function candidatesFromDataModels(json, source) {
  const defs = (json && (json.$defs || json.definitions)) || {};
  return Object.keys(defs).map((name) => ({ name, source }));
}

function candidatesFromApiContracts(json, source) {
  const schemas = (json && json.components && json.components.schemas) || {};
  return Object.keys(schemas).map((name) => ({ name, source }));
}

// Pure core. glossaryTerms: string[]. candidates: { name, source }[].
function checkVocabulary({ glossaryTerms, candidates }) {
  const terms = asArray(glossaryTerms);
  const cands = asArray(candidates);
  const glossarySet = new Set(terms.map(normalizeTerm));
  const undocumented = cands
    .filter((c) => !glossarySet.has(normalizeTerm(c.name)))
    .map((c) => ({ name: c.name, source: c.source || null }));
  const candidateSet = new Set(cands.map((c) => normalizeTerm(c.name)));
  const unused = terms.filter((t) => !candidateSet.has(normalizeTerm(t)));
  return {
    pass: undocumented.length === 0,
    glossary_total: terms.length,
    candidate_total: cands.length,
    undocumented,
    unused,
  };
}

// --- CLI ----------------------------------------------------------------------

function parseArgs(argv) {
  const args = { candidateFiles: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--glossary') { args.glossary = argv[++i]; continue; }
    if (key === '--domain-concepts') { args.candidateFiles.push({ file: argv[++i], kind: 'domain-concepts' }); continue; }
    if (key === '--data-models') { args.candidateFiles.push({ file: argv[++i], kind: 'data-models' }); continue; }
    if (key === '--api-contracts') { args.candidateFiles.push({ file: argv[++i], kind: 'api-contracts' }); continue; }
    if (key === '--out') { args.out = argv[++i]; continue; }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCandidates(candidateFiles) {
  const extractors = {
    'domain-concepts': candidatesFromDomainConcepts,
    'data-models': candidatesFromDataModels,
    'api-contracts': candidatesFromApiContracts,
  };
  let all = [];
  for (const { file, kind } of candidateFiles) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      all = all.concat(extractors[kind](readJson(file), file));
    } catch (err) {
      throw new Error(`cannot read ${file}: ${err.message}`);
    }
  }
  return all;
}

function printVerdict(v) {
  process.stdout.write(
    `vocabulary-check: ${v.pass ? 'PASS' : 'FAIL'} — ` +
    `${v.glossary_total} glossary term(s), ${v.candidate_total} candidate(s), ` +
    `${v.undocumented.length} undocumented, ${v.unused.length} unused\n`
  );
  for (const u of v.undocumented) process.stdout.write(`  UNDOCUMENTED  ${u.name} (from ${u.source})\n`);
  for (const t of v.unused) process.stdout.write(`  UNUSED        ${t}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.glossary) {
    process.stderr.write('vocabulary-check: --glossary <CONTEXT.md> is required\n');
    process.exit(2);
  }
  if (!fs.existsSync(args.glossary)) {
    process.stderr.write(`vocabulary-check: no glossary at ${args.glossary} — run /brd or /brownfield first.\n`);
    process.exit(2);
  }
  const glossaryTerms = parseGlossaryTerms(fs.readFileSync(args.glossary, 'utf8'));
  let candidates;
  try {
    candidates = loadCandidates(args.candidateFiles);
  } catch (err) {
    process.stderr.write(`vocabulary-check: ${err.message}\n`);
    process.exit(2);
  }
  const verdict = checkVocabulary({ glossaryTerms, candidates });
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n');
  }
  printVerdict(verdict);
  process.exit(verdict.pass ? 0 : 1);
}

module.exports = {
  checkVocabulary, parseGlossaryTerms, normalizeTerm,
  candidatesFromDomainConcepts, candidatesFromDataModels, candidatesFromApiContracts,
};

if (require.main === module) main();
