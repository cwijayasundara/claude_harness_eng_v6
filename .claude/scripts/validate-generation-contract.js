#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-generation-contract.js
//   [--mode skeleton|implementable] [--story E1-S1] [--stories specs/stories]
//   [--safeguards specs/brd/brd-safeguards.json]
// Exit 0 = pass, 1 = fail, 2 = IO.

const fs = require('fs');
const path = require('path');
const { validateGenerationContract } = require('../hooks/lib/generation-contract');

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

function listStoryFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /^E\d+-S\d+\.md$/.test(n))
    .map((n) => path.join(dir, n))
    .sort();
}

function skipUnready(md) {
  return /Readiness:\s*needs_breakdown/i.test(md);
}

function run(argv = process.argv.slice(2), cwd = process.cwd()) {
  const mode = arg(argv, '--mode', 'skeleton');
  if (mode !== 'skeleton' && mode !== 'implementable') {
    process.stderr.write('validate-generation-contract: --mode must be skeleton or implementable\n');
    return 2;
  }
  const storyId = arg(argv, '--story', null);
  const storiesDir = path.resolve(cwd, arg(argv, '--stories', path.join('specs', 'stories')));
  const safeguards = readJson(
    path.resolve(cwd, arg(argv, '--safeguards', path.join('specs', 'brd', 'brd-safeguards.json'))),
    [],
  );

  const files = storyId
    ? [path.join(storiesDir, `${storyId}.md`)]
    : listStoryFiles(storiesDir);

  if (!files.length) {
    process.stderr.write('validate-generation-contract: no story files to check\n');
    return 1;
  }

  let failed = 0;
  let checked = 0;
  for (const file of files) {
    let md;
    try {
      md = fs.readFileSync(file, 'utf8');
    } catch (err) {
      process.stderr.write(`  IO  ${path.basename(file)}: ${err.message}\n`);
      failed += 1;
      continue;
    }
    if (!storyId && skipUnready(md)) continue;
    checked += 1;
    const v = validateGenerationContract(md, { mode, safeguards });
    const label = path.basename(file, '.md');
    if (!v.pass) {
      failed += 1;
      process.stderr.write(`  FAIL  ${label} (${mode}):\n${v.errors.map((e) => `    - ${e}`).join('\n')}\n`);
    } else {
      process.stdout.write(`  OK    ${label}\n`);
    }
    for (const w of v.warnings) process.stdout.write(`  WARN  ${label}: ${w}\n`);
  }
  process.stdout.write(`generation-contract: ${failed ? 'FAIL' : 'PASS'} — ${checked - failed}/${checked} ${mode}\n`);
  return failed ? 1 : 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exit(run());
  } catch (err) {
    process.stderr.write(`validate-generation-contract: ${err.message}\n`);
    process.exit(2);
  }
}
