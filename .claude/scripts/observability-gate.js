#!/usr/bin/env node

'use strict';

// Static observability + exception-handling ratchet on changed production source.
// Complements runtime slo-check.js and code-gen observability conventions.
//
//   node observability-gate.js --staged | --files a b | --diff-base <ref>
//
// Writes specs/reviews/observability-verdict.json
// Exit 1 on BLOCK findings; 0 on pass/skip.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SOURCE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_PREFIXES = [
  'test/', 'tests/', 'e2e/', 'specs/', 'docs/', '.claude/', 'node_modules/',
  'dist/', 'build/', 'coverage/',
];

// Patterns: BLOCK = merge-blocking, WARN = advisory in verdict
const RULES = [
  {
    id: 'OBS-BARE-EXCEPT-PASS',
    level: 'BLOCK',
    re: /except\s*:\s*(\n\s*)?pass\b|except\s+Exception\s*:\s*(\n\s*)?pass\b/m,
    message: 'Bare except/Exception with pass swallows errors — use typed exceptions and log/re-raise',
  },
  {
    id: 'OBS-EMPTY-CATCH',
    level: 'BLOCK',
    re: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: 'Empty catch block swallows errors',
  },
  {
    id: 'OBS-CATCH-CONSOLE-ONLY',
    level: 'WARN',
    re: /catch\s*\([^)]*\)\s*\{\s*console\.(log|error|warn)\([^)]*\)\s*;?\s*\}/m,
    message: 'catch only console.logs — prefer structured logger + rethrow or typed handling',
  },
  {
    id: 'OBS-FSTRING-LOG',
    level: 'WARN',
    re: /logger\.(debug|info|warning|error|exception)\(\s*f["']/,
    message: 'f-string log message — use structured extra={} fields for searchability',
  },
  {
    id: 'OBS-TEMPLATE-LOG',
    level: 'WARN',
    re: /logger\.(debug|info|warn|error)\(\s*`[^`]*\$\{/,
    message: 'Template-literal log message — pass structured fields as second arg',
  },
  {
    id: 'OBS-PRINT-DEBUG',
    level: 'WARN',
    re: /^\s*print\s*\(|^\s*console\.log\s*\(/m,
    message: 'print/console.log in production path — use structured logger',
  },
];

const BOUNDARY_HINT = /(?:router|route|endpoint|handler|middleware|controller|app\.(get|post|put|patch|delete)|@app\.|FastAPI|express|Router)/i;

function isSkipped(rel) {
  const p = rel.replace(/\\/g, '/');
  if (SKIP_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  const base = path.basename(p);
  if (base.includes('.test.') || base.includes('.spec.') || base.endsWith('_test.py')) return true;
  return !SOURCE_EXTS.has(path.extname(p).toLowerCase());
}

function scanContent(rel, content) {
  const findings = [];
  const lines = content.split('\n');
  for (const rule of RULES) {
    // Multi-line rules: test whole file then map first match line
    if (rule.re.flags.includes('m') && String(rule.re).includes('\\n')) {
      if (rule.re.test(content)) {
        let lineNo = 1;
        for (let i = 0; i < lines.length; i++) {
          // approximate: find first line of match
          const slice = lines.slice(Math.max(0, i - 1), i + 3).join('\n');
          if (rule.re.test(slice) || rule.re.test(lines[i])) {
            lineNo = i + 1;
            break;
          }
        }
        findings.push({
          id: rule.id,
          level: rule.level,
          file: rel,
          line: lineNo,
          message: rule.message,
        });
      }
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      if (rule.re.test(lines[i])) {
        findings.push({
          id: rule.id,
          level: rule.level,
          file: rel,
          line: i + 1,
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

function boundaryMissingLogger(rel, content) {
  if (!BOUNDARY_HINT.test(content) && !BOUNDARY_HINT.test(rel)) return null;
  // Skip pure type/schema files
  if (/\.d\.ts$|schemas?\.py$|models?\.py$/i.test(rel) && !/router|route|api/i.test(rel)) return null;
  const hasLogger = /getLogger\(|createLogger\(|pino\(|winston|logger\.(info|error|warning|warn|debug)/.test(content);
  if (hasLogger) return null;
  // Only flag substantial boundary files
  if (content.split('\n').length < 20) return null;
  return {
    id: 'OBS-BOUNDARY-NO-LOGGER',
    level: 'WARN',
    file: rel,
    line: 1,
    message: 'Likely service boundary without structured logger usage',
  };
}

function requestIdHint(rel, content) {
  if (!/middleware|app\.(use|middleware)|@app\.middleware/i.test(content) && !/middleware/i.test(rel)) {
    return null;
  }
  if (/request_id|requestId|X-Request-ID|x-request-id|correlation_id/i.test(content)) return null;
  if (content.split('\n').length < 15) return null;
  return {
    id: 'OBS-MIDDLEWARE-NO-REQUEST-ID',
    level: 'WARN',
    file: rel,
    line: 1,
    message: 'HTTP middleware without request_id / X-Request-ID correlation',
  };
}

function scanFile(root, rel) {
  let content;
  try {
    content = fs.readFileSync(path.join(root, rel), 'utf8');
  } catch (_) {
    return [];
  }
  const findings = scanContent(rel, content);
  const bl = boundaryMissingLogger(rel, content);
  if (bl) findings.push(bl);
  const rid = requestIdHint(rel, content);
  if (rid) findings.push(rid);
  return findings;
}

function stagedFiles(exec, root) {
  const out = exec('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root });
  return String(out).split('\n').filter(Boolean);
}

function diffBaseFiles(exec, root, base) {
  const out = exec('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root });
  return String(out).split('\n').filter(Boolean);
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
  const blocks = findings.filter((f) => f.level === 'BLOCK');
  const warns = findings.filter((f) => f.level === 'WARN');
  return {
    gate: 'observability',
    pass: blocks.length === 0,
    checked,
    summary: { block: blocks.length, warn: warns.length },
    findings,
  };
}

function writeVerdict(root, verdict) {
  const out = path.join(root, 'specs', 'reviews', 'observability-verdict.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`);
  const md = [
    '# Observability gate',
    '',
    `**${verdict.pass ? 'PASS' : 'FAIL'}** — checked ${verdict.checked} file(s); `
      + `${verdict.summary.block} BLOCK · ${verdict.summary.warn} WARN`,
    '',
    ...verdict.findings.map(
      (f) => `- **${f.level}** \`${f.file}:${f.line}\` ${f.id}: ${f.message}`,
    ),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'specs', 'reviews', 'observability-gate.md'), md);
}

function run(argv, root = process.cwd(), deps = {}) {
  const exec = deps.exec || ((cmd, args, opts) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }));
  let files;
  if (argv[0] === '--staged') {
    files = stagedFiles(exec, root);
  } else if (argv[0] === '--files') {
    files = argv.slice(1);
  } else if (argv[0] === '--diff-base') {
    files = diffBaseFiles(exec, root, argv[1] || 'main');
  } else if (argv[0] === '--all') {
    // scan nothing heavy — require explicit files for --all via walk is out of scope
    files = [];
    process.stderr.write('observability-gate: use --staged, --files, or --diff-base\n');
    return 2;
  } else {
    process.stderr.write('usage: observability-gate.js --staged | --files <paths...> | --diff-base <ref>\n');
    return 2;
  }

  if (!files.length) {
    const verdict = {
      gate: 'observability',
      pass: true,
      checked: 0,
      summary: { block: 0, warn: 0 },
      findings: [],
      note: 'no files to scan',
    };
    writeVerdict(root, verdict);
    process.stdout.write('observability: SKIP (no files)\n');
    return 0;
  }

  const verdict = checkFiles(root, files);
  writeVerdict(root, verdict);
  process.stdout.write(
    `observability: ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.checked} checked, `
    + `${verdict.summary.block} BLOCK, ${verdict.summary.warn} WARN\n`,
  );
  for (const f of verdict.findings.filter((x) => x.level === 'BLOCK')) {
    process.stdout.write(`  BLOCK  ${f.file}:${f.line} ${f.id}\n`);
  }
  return verdict.pass ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`observability-gate: ${e.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  run,
  checkFiles,
  scanContent,
  scanFile,
  isSkipped,
  RULES,
};
