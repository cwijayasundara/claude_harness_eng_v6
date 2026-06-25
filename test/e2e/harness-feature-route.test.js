'use strict';

// Live e2e: `/feature` on an existing codebase. This is the brownfield route a
// second sprint should use: scaffold into an existing repo, refresh/use code-map,
// change behavior, and keep the project suite green.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');
const { runProjectSuite } = require('./helpers/project-suite');

const PROJECT_DIR = path.join(__dirname, 'feature-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const SESSION = 'aaaa0007-0000-4000-8000-000000000007';

function resetExistingProject() {
  const resolved = path.resolve(PROJECT_DIR);
  if (!resolved.startsWith(__dirname + path.sep)) {
    throw new Error(`refusing to wipe ${resolved}: outside ${__dirname}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(path.join(resolved, 'test'), { recursive: true });
  fs.writeFileSync(path.join(resolved, 'package.json'), `${JSON.stringify({
    scripts: { test: 'node --test' },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(resolved, 'calc.js'), [
    "'use strict';",
    '',
    'function add(a, b) {',
    '  return Number(a) + Number(b);',
    '}',
    '',
    'module.exports = { add };',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(resolved, 'test', 'calc.test.js'), [
    "'use strict';",
    '',
    "const assert = require('assert');",
    "const { test } = require('node:test');",
    "const { add } = require('../calc');",
    '',
    "test('adds numbers', () => {",
    '  assert.strictEqual(add(2, 3), 5);',
    '});',
    '',
  ].join('\n'));
  execFileSync('git', ['init'], { cwd: resolved, stdio: 'ignore' });
}

test('feature: existing repo -> /feature changes behavior and keeps suite green', { timeout: 1500000 }, (t) => {
  resetExistingProject();
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold --yes existing small Node library with calculator behavior and tests', {
    ...opts,
    budgetUsd: '3.00',
    timeoutMs: 300000,
  });
  console.log('[feature] scaffold exit:', scaffold.exitCode);

  const result = runClaude('/feature add a multiply(a, b) function exported from calc.js and covered by node:test; keep add(a, b) unchanged', {
    ...opts,
    continueSession: true,
    budgetUsd: '8.00',
    timeoutMs: 900000,
  });
  console.log('[feature] feature exit:', result.exitCode, 'signal:', result.signal);

  t.after(() => console.log('[feature] artifacts: ' + PROJECT_DIR));

  const source = fs.readFileSync(path.join(PROJECT_DIR, 'calc.js'), 'utf8');
  assert.match(source, /multiply/, 'feature route must add multiply to the existing module');
  assert.ok(fs.existsSync(path.join(PROJECT_DIR, 'specs', 'brownfield', 'code-graph.json')), '/feature must refresh the brownfield code graph');

  const suite = runProjectSuite(PROJECT_DIR);
  assert.strictEqual(suite.status, 0, `project suite must stay green:\n${suite.out}`);
});
