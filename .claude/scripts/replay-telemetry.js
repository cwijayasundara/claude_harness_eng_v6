#!/usr/bin/env node
'use strict';

const path = require('path');
const { pushSnapshot } = require('./telemetry-memory');

function findProjectDir(startDir) {
  let cur = startDir;
  while (cur && cur !== path.dirname(cur)) {
    if (require('fs').existsSync(path.join(cur, '.claude'))) return cur;
    cur = path.dirname(cur);
  }
  return process.cwd();
}

(async () => {
  const projectDir = findProjectDir(process.cwd());
  const stateDir = path.join(projectDir, '.claude', 'state');
  await pushSnapshot({ projectDir, stateDir });
})().catch(() => {
  process.exit(0);
});
