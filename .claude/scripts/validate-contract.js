#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-contract.js <contract.json> [schema.json]
// Validates a sprint contract against the contract schema. Run at negotiation
// time (the /auto loop, SECTION 3) so a malformed contract fails BEFORE it
// becomes immutable; the pre-commit hook repeats the check deterministically.
// Exit 0 = valid, 1 = invalid, 2 = usage/IO error.

const fs = require('fs');
const path = require('path');
const { validate } = require('../hooks/lib/contract-schema');

const DEFAULT_SCHEMA = path.join(__dirname, '..', 'skills', 'evaluate', 'references', 'contract-schema.json');

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`validate-contract: cannot read ${label} ${file}: ${err.message}\n`);
    process.exit(2);
  }
}

const contractPath = process.argv[2];
if (!contractPath) {
  process.stderr.write('usage: validate-contract.js <contract.json> [schema.json]\n');
  process.exit(2);
}

const contract = readJson(contractPath, 'contract');
const schema = readJson(process.argv[3] || DEFAULT_SCHEMA, 'schema');
const errors = validate(schema, contract);

if (errors.length > 0) {
  process.stdout.write(`INVALID: ${contractPath}\n` + errors.map((e) => `  - ${e}`).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write(`VALID: ${contractPath}\n`);
