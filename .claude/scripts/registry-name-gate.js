#!/usr/bin/env node
'use strict';

// CLI: node .claude/scripts/registry-name-gate.js --staged
// Git plumbing here; classification in hooks/lib/registry-names.js.

const { execFileSync, spawnSync } = require('child_process');
const {
  namesFromPackageJson, namesFromRequirements, namesFromLockfile,
  collectNewNames, evaluateNames, findingLine,
} = require('../hooks/lib/registry-names');

function gitShow(exec, ref) {
  try { return String(exec('git', ['show', ref])); } catch (_) { return null; }
}

function stagedFiles(exec) {
  return String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']))
    .split('\n').filter(Boolean);
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function headDeclared(exec) {
  const names = new Set();
  const pkg = parseJsonSafe(gitShow(exec, 'HEAD:package.json'));
  if (pkg) for (const n of namesFromPackageJson(pkg)) names.add(n);
  const req = gitShow(exec, 'HEAD:requirements.txt');
  if (req) for (const n of namesFromRequirements(req)) names.add(n);
  return names;
}

function headLocked(exec) {
  const lock = gitShow(exec, 'HEAD:package-lock.json') || gitShow(exec, 'HEAD:npm-shrinkwrap.json');
  return lock ? namesFromLockfile(lock) : new Set();
}

function collectStaged(exec) {
  return stagedFiles(exec)
    .map((file) => ({ file, content: gitShow(exec, `:${file}`) }))
    .filter((c) => c.content !== null);
}

function registryUrl(ecosystem, name) {
  if (ecosystem === 'pypi') return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  return `https://registry.npmjs.org/${encodeURIComponent(name)}`;
}

function statusFromCode(code) {
  if (code === '200') return 'exists';
  if (code === '404') return 'missing';
  return 'error';
}

function probeRegistry(url) {
  const script = [
    'const https=require("https");',
    `const u=${JSON.stringify(url)};`,
    'https.get(u,{timeout:4000},r=>{r.resume();process.stdout.write(String(r.statusCode));})',
    '.on("error",()=>process.stdout.write("0"))',
    '.on("timeout",function(){this.destroy();process.stdout.write("0");});',
  ].join('');
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 6000 });
  return statusFromCode(String(r.stdout || '').trim());
}

function syncLookup() {
  const cache = new Map();
  return (ecosystem, name) => {
    const key = `${ecosystem}:${name}`;
    if (cache.has(key)) return cache.get(key);
    const status = probeRegistry(registryUrl(ecosystem, name));
    cache.set(key, status);
    return status;
  };
}

function checkStaged(exec, lookup) {
  const files = collectStaged(exec);
  const candidates = collectNewNames({
    files,
    headDeclared: headDeclared(exec),
    headLocked: headLocked(exec),
  });
  return evaluateNames(candidates, lookup || syncLookup());
}

function reportVerdict(v) {
  process.stdout.write(`registry-names: ${v.pass ? 'PASS' : 'FAIL'} — ${v.findings.length} finding(s)\n`);
  for (const f of v.findings) process.stdout.write(`${findingLine(f)}\n`);
  for (const w of v.warnings || []) {
    process.stdout.write(`  LOOKUP-ERROR ${w.file}  ${w.name} (registry unreachable; not blocking)\n`);
  }
}

function run(argv, root, deps) {
  const exec = (deps && deps.exec) || ((cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }));
  if (argv[0] !== '--staged') {
    process.stderr.write('usage: registry-name-gate.js --staged\n');
    return 2;
  }
  const v = checkStaged(exec, deps && deps.lookup);
  reportVerdict(v);
  return v.pass ? 0 : 1;
}

module.exports = { collectStaged, checkStaged, findingLine, run, probeRegistry };

if (require.main === module) process.exit(run(process.argv.slice(2), process.cwd()));
