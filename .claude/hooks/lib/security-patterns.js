'use strict';

// Loads .claude/security-patterns.{json,yaml,yml} (the same file the
// security-guidance plugin reads) and returns the `block: true` rules that hit
// the edited content. JSON parses natively; YAML uses a minimal parser for the
// flat plugin schema. loadPatterns THROWS on unparseable structure — callers
// fail open so a malformed file never bricks editing.

const fs = require('fs');
const path = require('path');

function unescapeDouble(s) {
  return s.replace(/\\(["\\/bfnrt0]|u[0-9a-fA-F]{4})/g, (m, g) => {
    const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', 0: '\0' };
    if (g[0] === 'u') return String.fromCharCode(parseInt(g.slice(1), 16));
    return map[g] !== undefined ? map[g] : m;
  });
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v[0] === '"' && v[v.length - 1] === '"') return unescapeDouble(v.slice(1, -1));
  if (v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function splitTopLevel(body) {
  const out = [];
  let cur = '';
  let q = null;
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v[0] === '[' && v[v.length - 1] === ']') {
    return splitTopLevel(v.slice(1, -1)).map(parseScalar).filter((x) => x !== undefined);
  }
  return parseScalar(v);
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function parseYamlPatterns(text) {
  const rules = [];
  let cur = null;
  let inPatterns = false;
  for (const rawLine of text.split('\n')) {
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (line.trim() === '') continue;
    if (/^patterns\s*:\s*$/.test(line)) { inPatterns = true; continue; }
    if (!inPatterns) continue;
    const item = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    if (item) { cur = {}; rules.push(cur); cur[item[1]] = parseValue(item[2]); continue; }
    const kv = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (kv && cur) { cur[kv[1]] = parseValue(kv[2]); continue; }
    throw new Error(`unparseable line: ${line}`);
  }
  return rules;
}

function loadPatterns(projectDir) {
  const base = path.join(projectDir, '.claude');
  const json = path.join(base, 'security-patterns.json');
  if (fs.existsSync(json)) {
    const data = JSON.parse(fs.readFileSync(json, 'utf8'));
    return Array.isArray(data) ? data : data.patterns || [];
  }
  for (const name of ['security-patterns.yaml', 'security-patterns.yml']) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return parseYamlPatterns(fs.readFileSync(p, 'utf8'));
  }
  return [];
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function pathAllowed(file, rule) {
  const paths = rule.paths || [];
  const excl = rule.exclude_paths || [];
  if (excl.some((g) => globToRegExp(g).test(file))) return false;
  if (paths.length === 0) return true;
  return paths.some((g) => globToRegExp(g).test(file));
}

function ruleHits(rule, content) {
  if (Array.isArray(rule.substrings) && rule.substrings.some((s) => content.includes(s))) return true;
  if (typeof rule.regex === 'string' && rule.regex) {
    try { return new RegExp(rule.regex).test(content); } catch (_) { return false; } // skip broken regex
  }
  return false;
}

// Throws on a malformed patterns file (caller fails open with a warning).
function blockingHits(projectDir, file, content) {
  const rules = loadPatterns(projectDir);
  return rules.filter((r) => r && r.block === true && pathAllowed(file, r) && ruleHits(r, content));
}

module.exports = { blockingHits };
