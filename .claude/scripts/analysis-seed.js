#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/analysis-seed.js [--root DIR] [--dir specs/brd]
// Deterministic lean analysis seed. Does not paraphrase requirement text.
// Exit 0 = written, 1 = empty spine, 2 = IO.

const fs = require('fs');
const path = require('path');
const { buildAnalysisSeed } = require('../hooks/lib/analysis-seed');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const root = path.resolve(cwd, arg(argv, '--root', cwd));
  const destDir = path.resolve(root, arg(argv, '--dir', path.join('specs', 'brd')));
  const outArg = arg(argv, '--out', null);
  const outPath = outArg ? path.resolve(root, outArg) : path.join(destDir, 'analysis-seed.json');
  const reqs = readJson(path.join(destDir, 'brd-requirements.json'), null);
  if (!Array.isArray(reqs) || reqs.length === 0) {
    process.stderr.write('analysis-seed: no brd-requirements.json (or empty) — run prd-extract / brd-adopt first\n');
    return 1;
  }
  const seed = buildAnalysisSeed({
    requirements: reqs,
    questions: readJson(path.join(destDir, 'brd-open-questions.json'), []),
    risks: readJson(path.join(destDir, 'brd-risks.json'), []),
    clarifications: readJson(path.join(destDir, 'clarification-log.json'), []),
    safeguards: readJson(path.join(destDir, 'brd-safeguards.json'), []),
    glossaryMarkdown: readText(path.join(root, 'CONTEXT.md')),
    clustersMarkdown: readText(path.join(root, 'specs', 'brownfield', 'naming-clusters.md')),
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(seed, null, 2)}\n`);
  process.stdout.write(
    `analysis-seed: ${seed.domain_concepts.length} concept(s), `
    + `${seed.open_questions.length} open question(s), ${seed.risks.length} risk(s) `
    + `→ ${path.relative(root, outPath) || outPath}\n`,
  );
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`analysis-seed: ${err.message}\n`);
    process.exit(2);
  }
}
