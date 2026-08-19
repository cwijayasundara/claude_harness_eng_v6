#!/usr/bin/env node

'use strict';

// Stamp milestone.requirements_in_scope from brd-milestones.json when /spec
// omitted it. The renderer must never invent this list — that is how a live
// run greened trace-check against a hand-narrowed required file.

const fs = require('fs');
const path = require('path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function matchMilestone(doc, milestones) {
  const name = String((doc.milestone && doc.milestone.name) || '');
  const list = Array.isArray(milestones) ? milestones : [];
  return list.find((m) => name.includes(m.id) || (m.name && name.includes(m.name))) || list[0] || null;
}

function fillSpecScope(root) {
  const decPath = path.join(root, 'specs', 'decisions', 'spec-decisions.json');
  const milesPath = path.join(root, 'specs', 'brd', 'brd-milestones.json');
  const doc = readJson(decPath);
  const existing = doc.milestone && doc.milestone.requirements_in_scope;
  if (Array.isArray(existing) && existing.length) {
    return { wrote: false, ids: existing, source: 'decisions' };
  }
  if (!fs.existsSync(milesPath)) {
    throw new Error('fill-spec-scope: no brd-milestones.json — write requirements_in_scope by hand');
  }
  const match = matchMilestone(doc, readJson(milesPath));
  if (!match || !Array.isArray(match.requirements) || !match.requirements.length) {
    throw new Error('fill-spec-scope: no milestone requirements to copy');
  }
  doc.milestone = doc.milestone || {};
  doc.milestone.requirements_in_scope = match.requirements.slice();
  fs.writeFileSync(decPath, `${JSON.stringify(doc, null, 2)}\n`);
  return { wrote: true, ids: doc.milestone.requirements_in_scope, source: match.id || match.name };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  try {
    const result = fillSpecScope(root);
    const verb = result.wrote ? 'wrote' : 'kept';
    process.stdout.write(
      `fill-spec-scope: ${verb} ${result.ids.length} id(s) from ${result.source}\n`,
    );
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { fillSpecScope, matchMilestone };
