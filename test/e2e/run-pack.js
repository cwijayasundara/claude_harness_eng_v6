#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const LOG_DIR = path.join(RESULTS_DIR, 'logs');

const CERT_LAYERS = [
  layer('framework', 'Framework Validation', 720, ['node', '--test', '--test-force-exit', '--test-timeout=600000', 'test/e2e/harness-framework.test.js']),
  layer('pipeline', 'Greenfield Pipeline', 1620, ['node', '--test', '--test-force-exit', '--test-timeout=1500000', 'test/e2e/harness-pipeline.test.js']),
  layer('real-workflow', 'Real Workflow Certification', 1920, ['node', '--test', '--test-force-exit', '--test-timeout=1800000', 'test/e2e/harness-real-workflow.test.js']),
  layer('adversarial-fixtures', 'Adversarial Fixture Verification', 240, ['node', '--test', '--test-force-exit', '--test-timeout=120000', 'test/e2e/harness-adversarial-fixtures.test.js']),
  layer('adversarial-live', 'Live Adversarial Mutation', 1320, ['node', '--test', '--test-force-exit', '--test-timeout=1200000', 'test/e2e/harness-adversarial-live.test.js']),
  layer('pipeline-build', 'Auto Build + Observability', 1020, ['node', '--test', '--test-force-exit', '--test-timeout=900000', 'test/e2e/harness-pipeline-build.test.js'], { needsTelemetry: true }),
  layer('brownfield', 'Brownfield + Telemetry', 1320, ['node', '--test', '--test-force-exit', '--test-timeout=1200000', 'test/e2e/harness-brownfield.test.js'], { needsTelemetry: true }),
  layer('native-commands', 'Native Command Integration', 1320, ['node', '--test', '--test-force-exit', '--test-timeout=1200000', 'test/e2e/harness-native-commands.test.js']),
];

const LIVE_LAYERS = [
  layer('plan', 'Plan-only Build', 1320, ['node', '--test', '--test-force-exit', '--test-timeout=1200000', 'test/e2e/harness-plan-only.test.js']),
  layer('semi', 'Semi-auto Build', 2820, ['node', '--test', '--test-force-exit', '--test-timeout=2700000', 'test/e2e/harness-semi-auto-run.test.js']),
  layer('auto', 'Full-auto Build', 2820, ['node', '--test', '--test-force-exit', '--test-timeout=2700000', 'test/e2e/harness-auto-run.test.js']),
  layer('smoke', 'Self-healing Browser Smoke', 1320, ['node', '--test', '--test-force-exit', '--test-timeout=1200000', 'test/e2e/harness-selfheal-smoke.test.js'], { needsBrowser: true }),
];

const FAST_FILES = [
  'test/automated-e2e-contract.test.js',
  'test/e2e-no-hang-contract.test.js',
  'test/plan-only-contract.test.js',
  'test/auto-semi-contract.test.js',
  'test/full-auto-contract.test.js',
  'test/real-workflow-e2e-contract.test.js',
  'test/adversarial-fixtures-contract.test.js',
  'test/adversarial-live-e2e-contract.test.js',
  'test/pipeline-telemetry-e2e-contract.test.js',
  ...fs.readdirSync(path.join(ROOT, 'test', 'e2e', 'helpers'))
    .filter((name) => name.endsWith('.test.js'))
    .filter((name) => name !== 'app-runtime.test.js')
    .sort()
    .map((name) => path.join('test/e2e/helpers', name)),
];

const PROFILES = {
  fast: [layer('fast-contracts', 'Fast E2E Contracts', 180, ['node', '--test', '--test-force-exit', ...FAST_FILES])],
  smoke: [installBrowserLayer(), ...LIVE_LAYERS.filter((l) => l.id === 'smoke')],
  live: [installBrowserLayer(), ...LIVE_LAYERS],
  cert: [telemetryLayer(), ...CERT_LAYERS],
  all: [layer('fast-contracts', 'Fast E2E Contracts', 180, ['node', '--test', '--test-force-exit', ...FAST_FILES]), installBrowserLayer(), ...LIVE_LAYERS, telemetryLayer(), ...CERT_LAYERS],
};

function layer(id, name, timeoutSec, command, opts = {}) {
  return { id, name, timeoutSec, command, ...opts };
}

function installBrowserLayer() {
  return layer('install-browser', 'Install Playwright Chromium', 600, ['npx', 'playwright', 'install', 'chromium']);
}

function telemetryLayer() {
  return layer('telemetry', 'Ensure Telemetry Stack', 120, ['node', __filename, '__ensure_telemetry__'], { needsDocker: true });
}

function parseArgs(argv) {
  const out = { profile: 'cert', only: [], skip: [], bail: false, list: false };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) out.profile = args.shift();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--bail') out.bail = true;
    else if (arg === '--list') out.list = true;
    else if (arg === '--only') out.only = splitCsv(args[++i]);
    else if (arg.startsWith('--only=')) out.only = splitCsv(arg.slice('--only='.length));
    else if (arg === '--skip') out.skip = splitCsv(args[++i]);
    else if (arg.startsWith('--skip=')) out.skip = splitCsv(arg.slice('--skip='.length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!PROFILES[out.profile]) throw new Error(`unknown profile: ${out.profile}`);
  return out;
}

function splitCsv(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function selectedLayers(opts) {
  let layers = [...PROFILES[opts.profile]];
  const skipped = new Set(opts.skip);
  if (opts.only.length) {
    const wanted = new Set(opts.only);
    layers = layers.filter((l) => wanted.has(l.id));
  }
  if (opts.skip.length) {
    layers = layers.filter((l) => !skipped.has(l.id));
  }
  if (layers.some((l) => l.needsBrowser) && !layers.some((l) => l.id === 'install-browser') && !skipped.has('install-browser')) {
    layers = [installBrowserLayer(), ...layers];
  }
  if (layers.some((l) => l.needsTelemetry) && !layers.some((l) => l.id === 'telemetry') && !skipped.has('telemetry')) {
    layers = [telemetryLayer(), ...layers];
  }
  return layers;
}

function checkPrerequisites(layers) {
  const needsClaude = layers.some((l) => !l.id.startsWith('fast-') && l.id !== 'install-browser');
  if (needsClaude && !commandExists('claude')) return ['claude CLI not found on PATH'];
  if (layers.some((l) => l.needsDocker) && !commandExists('docker')) return ['docker CLI not found on PATH'];
  return [];
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [command], { stdio: 'ignore' }).status === 0;
}

function runLayer(l, opts = {}) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const stdoutPath = path.join(LOG_DIR, `${l.id}.stdout.log`);
  const stderrPath = path.join(LOG_DIR, `${l.id}.stderr.log`);
  const outFd = fs.openSync(stdoutPath, 'w');
  const errFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(l.command[0], l.command.slice(1), {
      cwd: ROOT,
      env: process.env,
      timeout: l.timeoutSec * 1000,
      killSignal: 'SIGKILL',
      detached: true,
      stdio: ['ignore', outFd, errFd],
    });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); } catch (_) { /* process group already exited */ }
  }
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  const exitCode = typeof result.status === 'number' ? result.status : (timedOut ? 137 : 1);
  const passed = exitCode === 0 && !result.signal && !result.error;
  const record = {
    id: l.id,
    name: l.name,
    command: l.command,
    timeoutSec: l.timeoutSec,
    startedAt,
    durationMs: Date.now() - started,
    exitCode,
    signal: result.signal || null,
    error: result.error ? result.error.message : null,
    timedOut,
    passed,
    stdoutPath,
    stderrPath,
  };
  if (!passed && opts.printFailureTail !== false) printFailureTail(record);
  return record;
}

function printFailureTail(record) {
  process.stderr.write(`\nFAILED ${record.id}. Logs:\n`);
  process.stderr.write(`  stdout: ${record.stdoutPath}\n`);
  process.stderr.write(`  stderr: ${record.stderrPath}\n`);
  const stderr = readTail(record.stderrPath, 40);
  if (stderr.trim()) process.stderr.write(`\n--- ${record.id} stderr tail ---\n${stderr}\n`);
}

function readTail(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch (_) {
    return '';
  }
}

function writeSummary(summary) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, 'e2e-pack-summary.json');
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  return file;
}

function runPack(opts) {
  const layers = selectedLayers(opts);
  const prereqErrors = checkPrerequisites(layers);
  if (prereqErrors.length) {
    const summary = {
      profile: opts.profile,
      startedAt: new Date().toISOString(),
      passed: false,
      prereqErrors,
      results: [],
    };
    const file = writeSummary(summary);
    process.stderr.write(`Prerequisite failure: ${prereqErrors.join('; ')}\nSummary: ${file}\n`);
    return { summary, file, exitCode: 2 };
  }

  const summary = { profile: opts.profile, startedAt: new Date().toISOString(), passed: true, results: [] };
  for (const l of layers) {
    process.stdout.write(`\n── ${l.name} [${l.id}] ──\n`);
    const result = runLayer(l);
    summary.results.push(result);
    process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${l.id} (${Math.round(result.durationMs / 1000)}s)\n`);
    if (!result.passed) {
      summary.passed = false;
      if (opts.bail) break;
    }
  }
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = summary.results.reduce((sum, r) => sum + r.durationMs, 0);
  const file = writeSummary(summary);
  process.stdout.write(`\nSummary: ${file}\n`);
  process.stdout.write(summary.passed ? 'ALL SELECTED E2E LAYERS PASSED\n' : 'ONE OR MORE E2E LAYERS FAILED\n');
  return { summary, file, exitCode: summary.passed ? 0 : 1 };
}

function listProfiles() {
  for (const [profile, layers] of Object.entries(PROFILES)) {
    process.stdout.write(`${profile}: ${layers.map((l) => l.id).join(', ')}\n`);
  }
}

function ensureTelemetry() {
  if (httpHealthy('http://localhost:9090/-/healthy')) return 0;
  const compose = spawnSync('docker', ['compose', '-f', path.join(ROOT, 'telemetry_docker_compose.yml'), 'up', '-d'], {
    cwd: ROOT, stdio: 'inherit',
  });
  if (compose.status !== 0) return compose.status || 1;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (httpHealthy('http://localhost:9090/-/healthy')) return 0;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  process.stderr.write('Prometheus did not become healthy within 60s\n');
  return 1;
}

function httpHealthy(url) {
  const curl = spawnSync('curl', ['-fsS', url], { stdio: 'ignore' });
  return curl.status === 0;
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === '__ensure_telemetry__') return ensureTelemetry();
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.stderr.write('Usage: node test/e2e/run-pack.js [fast|smoke|live|cert|all] [--only a,b] [--skip a,b] [--bail] [--list]\n');
    return 2;
  }
  if (opts.list) {
    listProfiles();
    return 0;
  }
  return runPack(opts).exitCode;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  CERT_LAYERS,
  FAST_FILES,
  LIVE_LAYERS,
  PROFILES,
  parseArgs,
  selectedLayers,
  checkPrerequisites,
  runLayer,
};
