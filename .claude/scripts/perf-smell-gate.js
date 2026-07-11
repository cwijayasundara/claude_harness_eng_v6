#!/usr/bin/env node

'use strict';

// Diff-scoped static performance smell gate (N+1-ish loops, unbounded loads,
// sequential independent awaits, sync-in-async). Complements runtime perf-baseline.
//
//   node perf-smell-gate.js --staged | --files a b | --diff-base <ref>
//
// Writes specs/reviews/perf-smell-verdict.json
// BLOCK findings exit 1; WARN-only exits 0 with report.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_PREFIXES = [
  'test/', 'tests/', 'e2e/', 'specs/', 'docs/', '.claude/', 'node_modules/',
  'dist/', 'build/', 'coverage/',
];

function isSkipped(rel) {
  const p = rel.replace(/\\/g, '/');
  if (SKIP_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  const base = path.basename(p);
  if (base.includes('.test.') || base.includes('.spec.') || base.endsWith('_test.py')) return true;
  return !SOURCE_EXTS.has(path.extname(p).toLowerCase());
}

function scanPython(rel, lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.match(/^(\s*)/)[1].length;
    // for-loop then await/query inside next few more-indented lines
    if (/^\s*for\s+\w+/.test(line) || /^\s*async\s+for\s+\w+/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const inner = lines[j];
        const ind2 = inner.match(/^(\s*)/)[1].length;
        if (inner.trim() === '' || inner.trim().startsWith('#')) continue;
        if (ind2 <= indent && inner.trim() !== '') break;
        if (
          /\.query\(|\.execute\(|session\.|await\s+.*(get|fetch|find|select|execute)/i.test(inner)
          || /db\.(get|query|execute)/i.test(inner)
        ) {
          findings.push({
            id: 'PERF-N1-LOOP-QUERY',
            level: 'BLOCK',
            file: rel,
            line: j + 1,
            message: 'Query/await inside loop — likely N+1; batch or eager-load',
          });
          break;
        }
      }
    }
    if (/\.all\(\)\s*$|\.findMany\(\s*\)|SELECT\s+\*\s+FROM/i.test(line)
      && !/limit|offset|take|page|paginate/i.test(line)) {
      findings.push({
        id: 'PERF-UNBOUNDED-LOAD',
        level: 'WARN',
        file: rel,
        line: i + 1,
        message: 'Possible unbounded result load — add LIMIT/pagination',
      });
    }
    if (/async\s+def\s+/.test(line)) {
      // look for time.sleep or requests. without to_thread in function body
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
        if (/^\s*async\s+def\s+|^\s*def\s+/.test(lines[j]) && j > i) break;
        if (/time\.sleep\(|requests\.(get|post|put|delete)\(/.test(lines[j])
          && !/to_thread|run_in_executor/.test(lines.slice(i, j + 1).join('\n'))) {
          findings.push({
            id: 'PERF-SYNC-IN-ASYNC',
            level: 'BLOCK',
            file: rel,
            line: j + 1,
            message: 'Blocking call in async function without to_thread/executor',
          });
        }
      }
    }
  }
  return findings;
}

function scanJs(rel, lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/for\s*\(|\.forEach\s*\(|for\s+await\s*\(/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        if (/await\s+.*(find|query|fetch|get|select)|prisma\.|supabase\.|\.query\(/.test(lines[j])) {
          findings.push({
            id: 'PERF-N1-LOOP-QUERY',
            level: 'BLOCK',
            file: rel,
            line: j + 1,
            message: 'Await/query inside loop — likely N+1; batch or join',
          });
          break;
        }
      }
    }
    // sequential awaits without Promise.all nearby
    if (/^\s*const\s+\w+\s*=\s*await\s+/.test(line)) {
      const next = lines[i + 1] || '';
      if (/^\s*const\s+\w+\s*=\s*await\s+/.test(next)
        && !/Promise\.all|Promise\.allSettled/.test(lines.slice(Math.max(0, i - 3), i + 5).join('\n'))) {
        findings.push({
          id: 'PERF-SEQUENTIAL-AWAIT',
          level: 'WARN',
          file: rel,
          line: i + 1,
          message: 'Sequential independent awaits — consider Promise.all if no data dependency',
        });
      }
    }
    if (/\.findMany\(\s*\{?\s*\}?\)|\.find\(\s*\{\s*\}\s*\)/.test(line)
      && !/take:|limit|skip:|cursor/i.test(line)) {
      findings.push({
        id: 'PERF-UNBOUNDED-LOAD',
        level: 'WARN',
        file: rel,
        line: i + 1,
        message: 'Possible unbounded findMany/find — add take/limit',
      });
    }
    if (/readFileSync|execSync|spawnSync/.test(line)
      && /async\s+function|async\s*\(/.test(lines.slice(Math.max(0, i - 30), i + 1).join('\n'))) {
      findings.push({
        id: 'PERF-SYNC-IN-ASYNC',
        level: 'WARN',
        file: rel,
        line: i + 1,
        message: 'Sync fs/child_process in async path — use async APIs',
      });
    }
  }
  return findings;
}

function scanFile(root, rel) {
  let content;
  try {
    content = fs.readFileSync(path.join(root, rel), 'utf8');
  } catch (_) {
    return [];
  }
  const lines = content.split('\n');
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.py') return scanPython(rel, lines);
  return scanJs(rel, lines);
}

function checkFiles(root, files) {
  const findings = [];
  let checked = 0;
  for (const raw of files) {
    const rel = String(raw).replace(/\\/g, '/');
    if (isSkipped(rel)) continue;
    checked += 1;
    findings.push(...scanFile(root, rel));
  }
  // de-dupe by id+file+line
  const seen = new Set();
  const unique = [];
  for (const f of findings) {
    const k = `${f.id}|${f.file}|${f.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(f);
  }
  const blocks = unique.filter((f) => f.level === 'BLOCK');
  const warns = unique.filter((f) => f.level === 'WARN');
  return {
    gate: 'perf-smell',
    pass: blocks.length === 0,
    checked,
    summary: { block: blocks.length, warn: warns.length },
    findings: unique,
  };
}

function writeVerdict(root, verdict) {
  const out = path.join(root, 'specs', 'reviews', 'perf-smell-verdict.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, 'specs', 'reviews', 'perf-smell-gate.md'),
    [
      '# Perf-smell gate',
      '',
      `**${verdict.pass ? 'PASS' : 'FAIL'}** — checked ${verdict.checked}; `
        + `${verdict.summary.block} BLOCK · ${verdict.summary.warn} WARN`,
      '',
      ...verdict.findings.map((f) => `- **${f.level}** \`${f.file}:${f.line}\` ${f.id}: ${f.message}`),
      '',
    ].join('\n'),
  );
}

function run(argv, root = process.cwd(), deps = {}) {
  const exec = deps.exec || ((cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }));
  let files;
  if (argv[0] === '--staged') {
    files = String(exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root }))
      .split('\n').filter(Boolean);
  } else if (argv[0] === '--files') {
    files = argv.slice(1);
  } else if (argv[0] === '--diff-base') {
    files = String(exec('git', ['diff', '--name-only', `${argv[1] || 'main'}...HEAD`], { cwd: root }))
      .split('\n').filter(Boolean);
  } else {
    process.stderr.write('usage: perf-smell-gate.js --staged | --files <paths...> | --diff-base <ref>\n');
    return 2;
  }

  if (!files.length) {
    const verdict = {
      gate: 'perf-smell', pass: true, checked: 0,
      summary: { block: 0, warn: 0 }, findings: [], note: 'no files',
    };
    writeVerdict(root, verdict);
    process.stdout.write('perf-smell: SKIP (no files)\n');
    return 0;
  }

  const verdict = checkFiles(root, files);
  writeVerdict(root, verdict);
  process.stdout.write(
    `perf-smell: ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.checked} checked, `
    + `${verdict.summary.block} BLOCK, ${verdict.summary.warn} WARN\n`,
  );
  return verdict.pass ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`perf-smell-gate: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = { run, checkFiles, scanFile, isSkipped };
