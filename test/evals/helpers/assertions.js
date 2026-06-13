'use strict';

// Deterministic assertion engine for the golden-task eval suite. Each
// assertion checks one observable outcome of a headless claude run: the
// transcript, the work directory's diff against its fixture, or the fixture's
// own test suite. Returns human-readable failure strings; [] means pass.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const IGNORED = new Set(['node_modules', '.git', '.claude', '.DS_Store']);

function listFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function fileDiffers(fixtureDir, workDir, rel) {
  const a = path.join(fixtureDir, rel);
  const b = path.join(workDir, rel);
  if (!fs.existsSync(a) || !fs.existsSync(b)) return true;
  return fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8');
}

function checkTranscript(a, ctx) {
  const re = new RegExp(a.pattern, 'i');
  const hit = re.test(ctx.transcript);
  if (a.type === 'transcript_matches' && !hit) return `transcript does not match /${a.pattern}/i`;
  if (a.type === 'transcript_not_matches' && hit) return `transcript matches forbidden /${a.pattern}/i`;
  return null;
}

function checkFilesUnchanged(a, ctx) {
  const changed = a.paths.filter((rel) => fileDiffers(ctx.fixtureDir, ctx.workDir, rel));
  return changed.length > 0 ? `files changed that must stay untouched: ${changed.join(', ')}` : null;
}

function checkWorkdirUnchanged(ctx) {
  const fixtureFiles = listFiles(ctx.fixtureDir);
  const workFiles = listFiles(ctx.workDir);
  const added = workFiles.filter((f) => !fixtureFiles.includes(f));
  const removed = fixtureFiles.filter((f) => !workFiles.includes(f));
  const edited = fixtureFiles.filter(
    (f) => workFiles.includes(f) && fileDiffers(ctx.fixtureDir, ctx.workDir, f)
  );
  const problems = [];
  if (added.length) problems.push(`added: ${added.join(', ')}`);
  if (removed.length) problems.push(`removed: ${removed.join(', ')}`);
  if (edited.length) problems.push(`edited: ${edited.join(', ')}`);
  return problems.length > 0 ? `workdir changed (${problems.join('; ')})` : null;
}

function checkFileMatches(a, ctx) {
  const p = path.join(ctx.workDir, a.path);
  if (!fs.existsSync(p)) return `file missing: ${a.path}`;
  if (!new RegExp(a.pattern, 'i').test(fs.readFileSync(p, 'utf8'))) {
    return `${a.path} does not match /${a.pattern}/i`;
  }
  return null;
}

function checkFixtureTests(a, ctx) {
  // Strip the parent test-runner's env so the child run reports its own
  // status instead of behaving like a test-runner subprocess.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete env[key];
  }
  const result = spawnSync('node', ['--test'], {
    cwd: ctx.workDir,
    encoding: 'utf8',
    timeout: 60000,
    env,
  });
  const passed = result.status === 0;
  if (passed !== a.expect) {
    return `fixture tests ${passed ? 'pass' : 'fail'}, expected ${a.expect ? 'pass' : 'fail'}`;
  }
  return null;
}

function checkOne(a, ctx) {
  if (a.type === 'transcript_matches' || a.type === 'transcript_not_matches') {
    return checkTranscript(a, ctx);
  }
  if (a.type === 'files_unchanged') return checkFilesUnchanged(a, ctx);
  if (a.type === 'workdir_unchanged') return checkWorkdirUnchanged(ctx);
  if (a.type === 'file_exists') {
    return fs.existsSync(path.join(ctx.workDir, a.path)) ? null : `file missing: ${a.path}`;
  }
  if (a.type === 'file_absent') {
    return fs.existsSync(path.join(ctx.workDir, a.path)) ? `file must not exist: ${a.path}` : null;
  }
  if (a.type === 'file_matches') return checkFileMatches(a, ctx);
  if (a.type === 'fixture_tests_pass') return checkFixtureTests(a, ctx);
  return `unknown assertion type: ${a.type}`;
}

function applyAssertions(assertions, ctx) {
  const failures = [];
  for (const a of assertions) {
    const failure = checkOne(a, ctx);
    if (failure !== null) failures.push(failure);
  }
  return failures;
}

module.exports = { applyAssertions, listFiles };
