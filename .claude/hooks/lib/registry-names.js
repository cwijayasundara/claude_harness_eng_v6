'use strict';

// Classify newly introduced package names: hallucinated (not on the registry)
// or slopsquat (edit-distance-close to a popular package). Pure; lookup is injected.

const { builtinModules } = require('module');
const { isTestFile } = require('./tdd');

const POPULAR_NPM = Object.freeze([
  'react', 'lodash', 'express', 'axios', 'next', 'vue', 'jquery', 'moment',
  'webpack', 'typescript', 'eslint', 'prettier', 'chalk', 'commander', 'yargs',
  'glob', 'debug', 'uuid', 'cors', 'dotenv', 'jsonwebtoken', 'mongoose',
  'sequelize', 'prisma', 'vitest', 'jest', 'mocha', 'playwright', 'puppeteer',
]);

const POPULAR_PYPI = Object.freeze([
  'requests', 'numpy', 'pandas', 'flask', 'django', 'fastapi', 'pydantic',
  'sqlalchemy', 'pytest', 'boto3', 'pillow', 'scipy', 'matplotlib', 'httpx',
  'uvicorn', 'celery', 'redis', 'click', 'pyyaml', 'black', 'ruff',
]);

const PY_STDLIB = new Set([
  'abc', 'argparse', 'asyncio', 'base64', 'collections', 'contextlib', 'copy',
  'csv', 'dataclasses', 'datetime', 'enum', 'functools', 'glob', 'hashlib',
  'http', 'importlib', 'io', 'itertools', 'json', 'logging', 'math', 'os',
  'pathlib', 'pickle', 're', 'shutil', 'sqlite3', 'string', 'subprocess',
  'sys', 'tempfile', 'threading', 'time', 'typing', 'unittest', 'urllib',
  'uuid', 'warnings', 'xml', 'zipfile',
]);

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.replace(/^node:/, '')]));

function popularSet(ecosystem) {
  return new Set(ecosystem === 'pypi' ? POPULAR_PYPI : POPULAR_NPM);
}

function jsPackageName(spec) {
  const s = String(spec || '').trim();
  if (!s || s.startsWith('.') || s.startsWith('/') || s.startsWith('node:')) return null;
  if (s.startsWith('@')) {
    const parts = s.split('/');
    return parts.length < 2 ? null : `${parts[0]}/${parts[1]}`;
  }
  return s.split('/')[0] || null;
}

/** Whether a `/` at this point can start a regex literal rather than divide. */
function regexAllowed(emitted) {
  const before = emitted.replace(/\s+$/, '');
  if (!before) return true;
  const last = before[before.length - 1];
  if ('(,=:[!&|?{};+-*%~^<>'.includes(last)) return true;
  const word = (before.match(/[A-Za-z_$][\w$]*$/) || [''])[0];
  return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw',
    'do', 'else', 'yield', 'await'].includes(word);
}

/** Index just past a regex literal starting at `start`, or `start` if unterminated. */
function regexEnd(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '\n') return start; // regex literals cannot span lines
    if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '/') {
      i += 1;
      while (i < text.length && /[a-z]/.test(text[i])) i += 1; // flags
      return i;
    }
    i += 1;
  }
  return start;
}

/**
 * Blank out JS comments so prose cannot parse as a dependency.
 *
 * The import patterns below match anywhere in the file, so an ordinary English
 * sentence — `flip the note from "main-loop only" to ...` — read as an import
 * and the gate blocked the commit as a slopsquat.
 *
 * Over-stripping is the dangerous direction: swallow a real `require()` and a
 * hallucinated package walks through the gate. So strings AND regex literals
 * are tracked and copied through verbatim — `"https://x"` is not a comment, and
 * neither is the `/*` in `/[/*]/`, where an unescaped `/` inside a character
 * class is legal JS and used to blank the rest of the file. A `/` starts a
 * regex only where one is grammatically possible (after an operator, an opening
 * bracket, or a keyword), so `a / b` stays division. An unterminated block
 * comment is treated as not-a-comment rather than swallowing to EOF.
 *
 * Comment bodies become spaces rather than being deleted, keeping every other
 * offset in the file unchanged.
 */
function stripJsComments(src) {
  const text = String(src || '');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < text.length) {
        out += text[i];
        if (text[i] === '\\') { // escape consumes the next character
          if (i + 1 < text.length) out += text[i + 1];
          i += 2;
          continue;
        }
        if (text[i] === quote) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) { out += c; i += 1; continue; } // unterminated: not a comment
      for (let j = i; j < close + 2; j += 1) out += text[j] === '\n' ? '\n' : ' ';
      i = close + 2;
      continue;
    }
    if (c === '/' && regexAllowed(out)) {
      // A regex literal — reached only when this `/` opens neither comment
      // form. Copy it verbatim, honouring escapes and character classes, so a
      // `//` or `/*` INSIDE it (legal in a class: `/[/*]/`) stays inert.
      const end = regexEnd(text, i);
      if (end > i) { out += text.slice(i, end); i = end; continue; }
    }
    out += c;
    i += 1;
  }
  return out;
}

function extractJsSpecs(content) {
  const names = new Set();
  const source = stripJsComments(content);
  const patterns = [
    /require\(\s*['"]([^'"]+)['"]/g,
    /from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) {
      const name = jsPackageName(m[1]);
      if (name) names.add(name);
    }
  }
  return [...names];
}

function extractPyModules(content) {
  const names = new Set();
  for (const line of String(content || '').split('\n')) {
    const trimmed = line.trim();
    const imp = trimmed.match(/^import\s+([A-Za-z_][\w]*)/);
    const fr = trimmed.match(/^from\s+([A-Za-z_][\w]*)/);
    if (imp) names.add(imp[1]);
    if (fr) names.add(fr[1]);
  }
  return [...names];
}

function namesFromPackageJson(obj) {
  const out = new Set();
  if (!obj || typeof obj !== 'object') return out;
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(obj[key] || {})) out.add(name);
  }
  return out;
}

function namesFromRequirements(text) {
  const out = new Set();
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const name = line.split(/[<>=!~\[]/)[0].trim().toLowerCase();
    if (name) out.add(name);
  }
  return out;
}

function namesFromLockfile(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/node_modules\/(@[^/]+\/[^/]+|[^/"\s]+)/g)) {
    out.add(m[1]);
  }
  return out;
}

function isBuiltin(name, ecosystem) {
  if (ecosystem === 'pypi') return PY_STDLIB.has(name);
  return NODE_BUILTINS.has(name);
}

function editDistance(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    let left = i;
    for (let j = 1; j <= t.length; j += 1) {
      const next = s[i - 1] === t[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], left);
      prev[j - 1] = left;
      left = next;
    }
    prev[t.length] = left;
  }
  return prev[t.length];
}

function isCloseTypo(name, popular) {
  const d = editDistance(name, popular);
  if (d === 1) return true;
  return d === 2 && name.length >= 5 && popular.length >= 5;
}

function typosquatOf(name, ecosystem) {
  const n = String(name).toLowerCase();
  const popular = popularSet(ecosystem);
  if (popular.has(n)) return null;
  for (const p of popular) {
    if (isCloseTypo(n, p)) return p;
  }
  return null;
}

function classifyCandidate(candidate, lookup) {
  const { name, ecosystem } = candidate;
  const squat = typosquatOf(name, ecosystem);
  if (squat) return { name, ecosystem, kind: 'typosquat', near: squat };
  const status = lookup(ecosystem, name);
  if (status === 'missing') return { name, ecosystem, kind: 'hallucinated' };
  if (status === 'error') return { name, ecosystem, kind: 'lookup-error' };
  return null;
}

function sourceEcosystem(file) {
  if (/\.(py)$/.test(file) || /requirements.*\.txt$/.test(file) || /pyproject\.toml$/.test(file)) {
    return 'pypi';
  }
  return 'npm';
}

function namesFromSource(file, content) {
  if (/\.(py)$/.test(file)) return extractPyModules(content);
  if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file)) return extractJsSpecs(content);
  return [];
}

function manifestNames(file, content) {
  if (file.endsWith('package.json')) {
    try { return [...namesFromPackageJson(JSON.parse(content))]; } catch (_) { return []; }
  }
  if (/requirements.*\.txt$/.test(file)) return [...namesFromRequirements(content)];
  return null;
}

function pushNew(out, seen, name, ecosystem, file, skip) {
  const key = `${ecosystem}:${name}`;
  if (seen.has(key) || skip.has(name) || isBuiltin(name, ecosystem)) return;
  seen.add(key);
  out.push({ name, ecosystem, file });
}

function collectNewNames({ files, headDeclared, headLocked }) {
  const previously = new Set([...(headDeclared || []), ...(headLocked || [])]);
  const stagedDeclared = new Set();
  const seen = new Set();
  const out = [];
  for (const { file, content } of files || []) {
    const listed = manifestNames(file, content);
    if (!listed) continue;
    for (const name of listed) {
      stagedDeclared.add(name);
      pushNew(out, seen, name, sourceEcosystem(file), file, previously);
    }
  }
  const importSkip = new Set([...previously, ...stagedDeclared]);
  for (const { file, content } of files || []) {
    if (manifestNames(file, content) || isTestFile(file)) continue;
    for (const name of namesFromSource(file, content)) {
      pushNew(out, seen, name, sourceEcosystem(file), file, importSkip);
    }
  }
  return out;
}

function evaluateNames(candidates, lookup) {
  const findings = [];
  const warnings = [];
  for (const c of candidates) {
    const hit = classifyCandidate(c, lookup);
    if (!hit) continue;
    const row = { ...hit, file: c.file };
    if (hit.kind === 'lookup-error') warnings.push(row);
    else findings.push(row);
  }
  return { pass: findings.length === 0, findings, warnings };
}

function findingLine(f) {
  if (f.kind === 'typosquat') {
    return `  TYPOSQUAT   ${f.file}  ${f.name}  (near popular "${f.near}")`;
  }
  return `  HALLUCINATED ${f.file}  ${f.name}  (not on ${f.ecosystem} registry)`;
}

module.exports = {
  POPULAR_NPM, POPULAR_PYPI, PY_STDLIB,
  jsPackageName, extractJsSpecs, extractPyModules, stripJsComments,
  namesFromPackageJson, namesFromRequirements, namesFromLockfile,
  isBuiltin, editDistance, typosquatOf, classifyCandidate,
  collectNewNames, evaluateNames, findingLine, sourceEcosystem,
};
