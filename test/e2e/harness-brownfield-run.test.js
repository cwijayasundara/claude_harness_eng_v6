'use strict';

// Live e2e: the REAL `/brownfield --seams` command on an existing codebase.
// Until now `/brownfield` was only *mimicked* — the cert suite's Stage 6 hand-
// writes a "create these 3 maps" prompt instead of invoking the skill, so the
// skill's own discovery logic (DeepWiki build, map authoring) and its
// `--seams` seam-ranking (the `/seam-finder` stage) were never driven. This
// invokes the command for real on a tiny two-file repo (calc.js <- main.js, so
// the dependency graph has a real import edge for seams to rank) and asserts the
// command's own artifacts exist and are grounded:
//   1. specs/brownfield/code-graph.json  — the deterministic graph (/code-map)
//   2. specs/brownfield/wiki/WIKI.md      — the committed DeepWiki (lean default)
//   3. specs/brownfield/change-strategy.md — the recommended lane for future work
//   4. specs/brownfield/seams-*.md        — the ranked seam candidates (--seams)
//   5. a map cites a real source basename — discovery is grounded, not invented
//
// Runs LIVE `claude -p` and costs tokens, so it is NOT part of `npm test`; run it
// with `npm run test:e2e:live --only brownfield-run`. The cheap static contract
// lives in ../e2e-route-matrix-contract.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const { runClaude } = require('./helpers/claude-runner');

const PROJECT_DIR = path.join(__dirname, 'brownfield-run-output');
const PLUGIN_DIR = path.join(__dirname, '..', '..', '.claude');
const { randomUUID } = require('crypto');
// Fresh id per run — hardcoded session ids fail with "already in use" on re-run.
const SESSION = randomUUID();

// A tiny two-module repo: main.js requires calc.js, so the deterministic graph
// has a real file->file import edge (seam-finder needs structure to rank).
const CALC_SRC = [
  "'use strict';",
  '',
  'function add(a, b) {',
  '  return Number(a) + Number(b);',
  '}',
  '',
  'module.exports = { add };',
  '',
].join('\n');

const MAIN_SRC = [
  "'use strict';",
  '',
  "const { add } = require('./calc');",
  '',
  'function main(argv) {',
  '  return add(argv[0], argv[1]);',
  '}',
  '',
  'module.exports = { main };',
  '',
].join('\n');

function seedExistingProject(resolved) {
  fs.writeFileSync(path.join(resolved, 'package.json'), `${JSON.stringify({
    scripts: { test: 'node --test' },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(resolved, 'calc.js'), CALC_SRC);
  fs.writeFileSync(path.join(resolved, 'main.js'), MAIN_SRC);
  execFileSync('git', ['init'], { cwd: resolved, stdio: 'ignore' });
}

// Confinement guard: never rm a path outside this package.
function resetExistingProject() {
  const resolved = path.resolve(PROJECT_DIR);
  if (!resolved.startsWith(__dirname + path.sep)) {
    throw new Error(`refusing to wipe ${resolved}: outside ${__dirname}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  seedExistingProject(resolved);
}

// True when any specs/brownfield/seams-*.md was written (the --seams output).
function hasSeamsFile(bfDir) {
  if (!fs.existsSync(bfDir)) return false;
  return fs.readdirSync(bfDir).some((f) => /^seams-.*\.md$/.test(f));
}

test('brownfield: /brownfield --seams discovers an existing repo and ranks seams', { timeout: 1080000 }, (t) => {
  resetExistingProject();
  const opts = { cwd: PROJECT_DIR, model: 'sonnet', pluginDir: PLUGIN_DIR, sessionId: SESSION };

  const scaffold = runClaude('/scaffold --yes existing small Node library with a calculator module and a main entry point', {
    ...opts,
    budgetUsd: '3.00',
    timeoutMs: 300000,
  });
  console.log('[brownfield-run] scaffold exit:', scaffold.exitCode);

  const result = runClaude('/brownfield --seams "add a subtract command to the calculator"', {
    ...opts,
    continueSession: true,
    budgetUsd: '8.00',
    timeoutMs: 720000,
  });
  console.log('[brownfield-run] brownfield exit:', result.exitCode, 'signal:', result.signal);

  t.after(() => console.log('[brownfield-run] artifacts: ' + PROJECT_DIR));

  const bfDir = path.join(PROJECT_DIR, 'specs', 'brownfield');

  // 1. The deterministic dependency graph (the /code-map stage of discovery).
  const codeGraph = path.join(bfDir, 'code-graph.json');
  assert.ok(fs.existsSync(codeGraph), '/brownfield must produce specs/brownfield/code-graph.json');

  // 2. The committed DeepWiki — the lean default's primary orientation artifact.
  const wiki = path.join(bfDir, 'wiki', 'WIKI.md');
  assert.ok(fs.existsSync(wiki), '/brownfield must produce the DeepWiki at specs/brownfield/wiki/WIKI.md');

  // 3. The recommended-lane map for future change work.
  const strategy = path.join(bfDir, 'change-strategy.md');
  assert.ok(fs.existsSync(strategy), '/brownfield must produce specs/brownfield/change-strategy.md');

  // 4. The --seams output: ranked seam candidates (the /seam-finder stage).
  assert.ok(hasSeamsFile(bfDir), '/brownfield --seams must write a specs/brownfield/seams-*.md');

  // 5. Discovery is grounded: a written map cites a real source basename, so the
  //    analysis describes THIS repo rather than a plausible-sounding invention.
  const arch = path.join(bfDir, 'architecture-map.md');
  const grounded = [arch, strategy, wiki]
    .filter((p) => fs.existsSync(p))
    .some((p) => /\b(calc|main)\.js\b/.test(fs.readFileSync(p, 'utf8')));
  assert.ok(grounded, 'a brownfield map must cite a real source file (calc.js or main.js)');
});
