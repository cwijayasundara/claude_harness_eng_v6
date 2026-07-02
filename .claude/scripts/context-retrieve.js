#!/usr/bin/env node

'use strict';

const { retrieveContext } = require('./context-store');

function argValue(args, flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx === -1 ? fallback : args[idx + 1];
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hash = args.find((a, idx) => !a.startsWith('--') && args[idx - 1] !== '--root' && args[idx - 1] !== '--query' && args[idx - 1] !== '--max-lines');
  const projectDir = argValue(args, '--root', process.cwd());
  const query = argValue(args, '--query', '');
  const maxLines = parseInt(argValue(args, '--max-lines', '40'), 10) || 40;
  process.stdout.write(`${JSON.stringify(retrieveContext({ projectDir, hash, query, maxLines }), null, 2)}\n`);
}
