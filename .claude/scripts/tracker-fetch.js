#!/usr/bin/env node

'use strict';

// Fetch one tracker ticket and print it as a story seed.
//
// The inbound counterpart to tracker-publish. Read-only by design — see
// .claude/hooks/lib/tracker-fetch.js for why nothing here transitions a ticket.
//
// Usage:
//   node .claude/scripts/tracker-fetch.js --linear ENG-123
//   node .claude/scripts/tracker-fetch.js --jira PROJ-45 [--json] [--root DIR]
//
// Credentials come from <root>/.env or the shell, same as tracker-publish:
//   Linear — LINEAR_API_KEY [, LINEAR_API_URL]
//   Jira   — JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
//
// Exit: 0 = fetched, 1 = fetch/config failure, 2 = usage error.

const path = require('path');
const { fetchTicket, toStorySeed, loadEnvFile } = require('../hooks/lib/tracker-fetch.js');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1];
}

function resolveTarget(argv) {
  for (const provider of ['linear', 'jira']) {
    const key = arg(argv, `--${provider}`, null);
    if (key) return { provider, key };
  }
  return null;
}

async function run(argv, cwd) {
  const target = resolveTarget(argv);
  if (!target) {
    process.stderr.write('tracker-fetch: pass --linear <KEY> or --jira <KEY>\n');
    return 2;
  }
  loadEnvFile(path.join(arg(argv, '--root', cwd), '.env'));
  let ticket;
  try {
    ticket = await fetchTicket(target.provider, target.key, process.env);
  } catch (err) {
    process.stderr.write(`tracker-fetch: ${err.message}\n`);
    return 1;
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(ticket, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${toStorySeed(ticket)}\n`);
  if (!ticket.acceptance.length) {
    process.stderr.write(
      'tracker-fetch: the ticket states no acceptance criteria. Author them with the human '
      + 'before writing code — a story with no criterion gives the tests no oracle.\n',
    );
  }
  return 0;
}

module.exports = { run, resolveTarget };

if (require.main === module) {
  run(process.argv.slice(2), process.cwd()).then((code) => process.exit(code));
}
