#!/usr/bin/env node

'use strict';

// CLI: node .claude/scripts/validate-agent-contracts.js [agents-dir]
// Static half of the agent write-scope contract (SwarmForge pickup #1): checks
// that every agent ships a `<name>.contract.json` and that the contract and the
// agent's `tools:` grant describe the same agent. Drift here is silent and
// expensive — a contract saying "read-only" beside a grant carrying Write means
// the runtime gate (agent-write-scope.js) enforces a scope nobody believes in.
//
// Exit 0 = consistent, 1 = drift found, 2 = usage/IO error.

const path = require('path');
const { validateContracts } = require('../hooks/lib/agent-contract');

function main(argv) {
  const dir = argv[0] || path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'agents');

  let errors;
  try {
    errors = validateContracts(dir);
  } catch (err) {
    process.stderr.write(`validate-agent-contracts: cannot read ${dir}: ${err.message}\n`);
    return 2;
  }

  if (errors.length === 0) {
    process.stdout.write(`agent contracts: consistent (${dir})\n`);
    return 0;
  }

  process.stdout.write(`agent contracts: ${errors.length} finding(s) in ${dir}\n`);
  for (const e of errors) process.stdout.write(`  - ${e}\n`);
  process.stdout.write(
    '\nFix: bring the contract and the agent\'s `tools:` grant into agreement.\n'
    + 'A contract is the enforceable statement of what an agent owns; the prose\n'
    + '"Does Not Own" section in the prompt is not a control.\n');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main };
