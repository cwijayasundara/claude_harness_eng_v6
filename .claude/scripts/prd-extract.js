#!/usr/bin/env node

'use strict';

// Deterministic /brd --prd ingest. Replaces the LLM brd-extract fork for any
// PRD that validate-prd.js can parse (id'd FR/NFR bullets + Acceptance).
//
//   node prd-extract.js <prd.md> [--root DIR] [--out-dir DIR] [--tag] [--write-brd]
//
// Copies the source, writes frd-requirements.json, runs brd-adopt.js.
// --tag fills taxonomy from the requirement text. --write-brd emits the
// short pointer brd.md (≤80 lines). Prints counts only.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { extractSpine, counts } = require('../hooks/lib/prd-extract');

function fail(msg, code = 2) {
  process.stderr.write(`prd-extract: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { tag: false, writeBrd: false, root: process.cwd(), outDir: null, prd: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--out-dir') opts.outDir = argv[++i];
    else if (a === '--tag') opts.tag = true;
    else if (a === '--write-brd') opts.writeBrd = true;
    else if (a === '--no-adopt') opts.noAdopt = true;
    else if (!a.startsWith('--') && !opts.prd) opts.prd = a;
    else fail(`unknown argument: ${a}`);
  }
  if (!opts.prd) fail('usage: prd-extract.js <prd.md> [--root DIR] [--out-dir DIR] [--tag] [--write-brd]');
  return opts;
}

function copySource(prdPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'source-frd.md');
  fs.copyFileSync(prdPath, dest);
  return dest;
}

function writeSpine(destDir, spine) {
  const file = path.join(destDir, 'frd-requirements.json');
  fs.writeFileSync(file, `${JSON.stringify(spine, null, 2)}\n`);
  return file;
}

function runAdopt(root, outDir) {
  const adopt = path.join(__dirname, 'brd-adopt.js');
  const args = [
    adopt,
    '--root', root,
    '--source', path.join(outDir, 'frd-requirements.json'),
    '--out-dir', outDir,
  ];
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}

function seedClarifications(destDir) {
  const file = path.join(destDir, 'clarification-log.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]\n');
}

function run(argv) {
  const opts = parseArgs(argv);
  const root = path.resolve(opts.root);
  const prdPath = path.resolve(root, opts.prd);
  if (!fs.existsSync(prdPath)) fail(`prd not found: ${prdPath}`);
  const markdown = fs.readFileSync(prdPath, 'utf8');
  const spine = extractSpine(markdown);
  if (spine.length === 0) fail('extracted an empty spine — the PRD has no parseable FR/NFR/Acceptance/Out of Scope entries', 1);

  const destDir = path.resolve(root, opts.outDir || path.join('specs', 'brd'));
  copySource(prdPath, destDir);
  writeSpine(destDir, spine);
  seedClarifications(destDir);
  if (!opts.noAdopt) runAdopt(root, destDir);

  if (opts.tag) {
    execFileSync(process.execPath, [path.join(__dirname, 'brd-taxonomy-tag.js'), '--root', root, '--dir', destDir], { stdio: 'inherit' });
  }
  if (!opts.noAdopt) {
    execFileSync(process.execPath, [
      path.join(__dirname, 'analysis-seed.js'),
      '--root', root,
      '--dir', destDir,
    ], { stdio: 'inherit' });
  }
  if (opts.writeBrd) {
    execFileSync(process.execPath, [
      path.join(__dirname, 'brd-lean-write.js'),
      '--root', root,
      '--dir', destDir,
      '--source', opts.prd,
    ], { stdio: 'inherit' });
  }

  const c = counts(spine);
  process.stdout.write(
    `spine: ${c.entries} entries -> ${c.requirements} requirements, ${c.acceptance} acceptance, `
    + `${c.forbidden} forbidden, ${c.open_questions} open questions, ${c.risks} risks, `
    + `${c.milestones} milestones\n`
    + 'adoption: lossless (grounding is an identity)\n',
  );
}

module.exports = { extractSpine, counts, run };

if (require.main === module) {
  try {
    run(process.argv.slice(2));
  } catch (err) {
    fail(err.message);
  }
}
