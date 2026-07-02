#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const { packToolOutput } = require('./tool-output-pack');
const { storeContext } = require('./context-store');

function argValue(args, flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const sep = args.indexOf('--');
  const opts = sep === -1 ? args : args.slice(0, sep);
  const command = sep === -1 ? [] : args.slice(sep + 1);
  const projectDir = argValue(opts, '--root', process.cwd());
  const kind = argValue(opts, '--kind', 'generic-log');

  if (!command.length) {
    process.stdout.write(`${JSON.stringify({ status: 'missing_command', exit: 2, warnings: ['pass command after --'] }, null, 2)}\n`);
    process.exit(2);
  }

  const result = spawnSync(command[0], command.slice(1), { cwd: projectDir, encoding: 'utf8' });
  const raw = `${result.stdout || ''}${result.stderr || ''}`;
  const pack = packToolOutput({ projectDir, kind, command: command.join(' '), raw, exit: result.status == null ? 1 : result.status });
  const stored = storeContext({
    projectDir,
    kind,
    raw,
    label: command.join(' '),
    estimatedPackTokens: pack.estimated_pack_tokens,
    estimatedSavedTokens: pack.estimated_saved_tokens,
  });
  process.stdout.write(`${JSON.stringify({
    ...pack,
    context_hash: stored.hash,
    retrieve: `node .claude/scripts/context-retrieve.js ${stored.hash}`,
  }, null, 2)}\n`);
  process.exit(result.status == null ? 1 : result.status);
}
