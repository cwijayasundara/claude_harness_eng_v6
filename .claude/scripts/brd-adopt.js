#!/usr/bin/env node

'use strict';

// PRD adoption — the deterministic half of `/brd --prd` (R2).
//
// Measured on a real run: /brd turned 149 PRD requirements into 88 BRD ones,
// and the grounding gate then proved the mapping lossless both ways (149/149,
// 0 net-new, 0 dropped). That is a formal proof that the re-expression added no
// requirement content — BR-1 was a paraphrase of FRD-1 — at a cost of 258 KB of
// frontier output and the standing risk that a paraphrase quietly shifts meaning.
//
// Adoption removes the paraphrase step. The PRD's own ids become the spine, so
// grounding is an identity: there is nothing to prove because nothing was
// transformed. What /brd genuinely contributes is untouched and still runs —
// the ten-slot taxonomy floor, the analysis pack, the clarification log.
//
// Usage:
//   node .claude/scripts/brd-adopt.js [--root DIR] [--source PATH] [--dry-run]
//   node .claude/scripts/brd-adopt.js --verify   # the render left the spine alone

const fs = require('fs');
const path = require('path');

const SOURCE_REL = path.join('specs', 'brd', 'frd-requirements.json');
const OUT_REQUIREMENTS = path.join('specs', 'brd', 'brd-requirements.json');
const OUT_SAFEGUARDS = path.join('specs', 'brd', 'brd-safeguards.json');
const OUT_ACCEPTANCE = path.join('specs', 'brd', 'brd-acceptance.json');
const SOURCE_PRD = path.join('specs', 'brd', 'source-frd.md');
const { parseMilestones } = require('../hooks/lib/prd-milestones.js');
const { verifyAdoptedSpine } = require('../hooks/lib/adopted-spine.js');

const {
  adoptRequirements, adoptSafeguards, adoptAcceptance,
} = require('../hooks/lib/prd-adoption.js');


function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadSource(sourcePath) {
  try {
    return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    process.stderr.write(`brd-adopt: cannot read ${sourcePath}: ${err.message}\n`);
    return process.exit(2);
  }
}

// Every source id, with how it was classified. This is what the Step 4.4
// grounding gate must read: brd-requirements.json holds only the requirements,
// so checking the source spine against it reports every classified entry as
// `dropped` — 52 of 149 on a real spine, a HARD BLOCK whose documented remedy
// ("add a BR entry covering it") would reinstate what classification removed.
function adoptionManifest(adopted, safeguards, acceptance) {
  const rows = [];
  const add = (entries, kind) => {
    for (const e of entries) rows.push({ id: e.id, kind, traces: [e.id], text: e.text });
  };
  add(adopted.requirements, 'requirement');
  add(adopted.context, 'context');
  add(adopted.open_questions, 'open_question');
  add(adopted.risks, 'risk');
  add(acceptance, 'acceptance');
  for (const s of safeguards) rows.push({ id: s.traces[0], kind: 'safeguard', traces: s.traces, text: s.text });
  return rows;
}

function writeOutputs(dir, adopted, safeguards, acceptance, milestones) {
  const at = (rel) => path.join(dir, path.basename(rel));
  writeJson(at(OUT_REQUIREMENTS), adopted.requirements);
  writeJson(at(OUT_SAFEGUARDS), safeguards);
  writeJson(at(OUT_ACCEPTANCE), acceptance);
  writeJson(at('brd-context.json'), adopted.context);
  writeJson(at('brd-open-questions.json'), adopted.open_questions);
  writeJson(at('brd-risks.json'), adopted.risks);
  writeJson(at('brd-adoption.json'), adoptionManifest(adopted, safeguards, acceptance));
  // R4: the PRD milestone plan, so /spec proposes scope from the document
  // rather than the human re-deriving it from memory each time.
  writeJson(at('brd-milestones.json'), milestones);
}

// Where this run reads from and writes to.
//
// Delta mode writes to specs/brd/sprint-N/. --root cannot express that: it
// prefixes specs/brd/ again, landing the files two levels deep where Step D2's
// trace-check never looks. resolve, not join: an absolute --out-dir must be
// honoured rather than silently reparented under root.
function pathsFrom(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const root = arg('--root', process.cwd());
  return {
    outDir: path.resolve(root, arg('--out-dir', path.dirname(OUT_REQUIREMENTS))),
    sourcePath: arg('--source', path.join(root, SOURCE_REL)),
  };
}

// The milestone plan from the PRD beside THIS spine, not the flat one. Delta
// mode adopts specs/brd/sprint-N/frd-requirements.json, and reading the flat
// source-frd.md there gave sprint N the previous sprint's milestone plan.
function milestonesBeside(sourcePath) {
  let prd = null;
  try {
    prd = fs.readFileSync(path.join(path.dirname(sourcePath), path.basename(SOURCE_PRD)), 'utf8');
  } catch (_) { /* interview mode, or no PRD beside the spine */ }
  return parseMilestones(prd);
}

function summary(adopted, safeguards, acceptance) {
  return `brd-adopt: ${adopted.requirements.length} requirements adopted verbatim, `
    + `${acceptance.length} acceptance criteria, ${safeguards.length} forbidden actions, `
    + `${adopted.context.length} context, ${adopted.open_questions.length} open question(s), `
    + `${adopted.risks.length} risk(s), ${adopted.warnings.length} warning(s).\n`
    + 'Taxonomy slots are unassigned — the ten-slot floor still has to be satisfied.\n';
}

function main(argv) {
  const { outDir, sourcePath } = pathsFrom(argv);
  const source = loadSource(sourcePath);

  let adopted;
  try {
    adopted = adoptRequirements(source);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return process.exit(2);
  }
  const safeguards = adoptSafeguards(source);
  const acceptance = adoptAcceptance(source);
  for (const w of adopted.warnings) process.stderr.write(`  WARN  ${w}\n`);

  // --verify re-derives and compares instead of writing: proof that the render
  // left the adopted baseline alone. See hooks/lib/adopted-spine.js.
  if (argv.includes('--verify')) {
    const file = path.join(outDir, path.basename(OUT_REQUIREMENTS));
    return process.exit(verifyAdoptedSpine(file, adopted.requirements));
  }
  if (!argv.includes('--dry-run')) {
    writeOutputs(outDir, adopted, safeguards, acceptance, milestonesBeside(sourcePath));
  }
  return process.stdout.write(summary(adopted, safeguards, acceptance));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { adoptRequirements, adoptSafeguards, adoptAcceptance, SOURCE_REL };
