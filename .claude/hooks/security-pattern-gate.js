#!/usr/bin/env node

'use strict';

// PreToolUse(Write|Edit|MultiEdit) — deterministic security pattern BLOCK.
// The security-guidance plugin only WARNS on its patterns; this hook hard-blocks
// (exit 2) the rules a team opts into with `block: true` in the SAME
// .claude/security-patterns.{json,yaml,yml} the plugin reads. Rules without
// `block: true` are left to the plugin's advisory warning.
//
// JSON parses natively. YAML uses a minimal parser for the flat plugin schema;
// on any parse failure the hook FAILS OPEN (exit 0) with a visible warning so a
// malformed file never bricks editing. A rule with a broken regex is skipped.
// Disable entirely with HARNESS_PATTERN_BLOCK=off.

const fs = require('fs');
const path = require('path');

function findProjectDir(startDir) {
  let cur = startDir;
  while (true) {
    if (fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

// --- minimal scalar/array parsing for the flat YAML schema ---

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

// Split inline-array body on top-level commas (commas inside quotes are kept).
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

// Strip a trailing ` # comment` that is not inside quotes.
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

// Parse the flat `patterns:` list. Throws on structure it does not understand.
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
    return { rules: Array.isArray(data) ? data : data.patterns || [], src: json };
  }
  for (const name of ['security-patterns.yaml', 'security-patterns.yml']) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return { rules: parseYamlPatterns(fs.readFileSync(p, 'utf8')), src: p };
  }
  return null;
}

// --- glob + matching ---

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

function editedContent(input) {
  const tn = input.tool_name || '';
  const ti = input.tool_input || {};
  if (tn === 'Write') return ti.content || '';
  if (tn === 'Edit') return ti.new_string || '';
  if (tn === 'MultiEdit') return (ti.edits || []).map((e) => e.new_string || '').join('\n');
  return '';
}

try {
  if ((process.env.HARNESS_PATTERN_BLOCK || '').toLowerCase() === 'off') process.exit(0);

  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';
  if (!filePath) process.exit(0);
  const file = filePath.replace(/\\/g, '/');
  const content = editedContent(input);
  if (!content) process.exit(0);

  const scriptDir = path.dirname(path.resolve(__filename));
  const projectDir = findProjectDir(scriptDir) || process.cwd();

  let loaded;
  try {
    loaded = loadPatterns(projectDir);
  } catch (e) {
    // Fail open: a malformed pattern file must not block all edits.
    process.stdout.write(`[security-pattern-gate] could not parse security-patterns file (${e.message}); blocking disabled. Use security-patterns.json for reliable parsing.\n`);
    process.exit(0);
  }
  if (!loaded || !loaded.rules.length) process.exit(0);

  const hits = loaded.rules.filter((r) => r && r.block === true && pathAllowed(file, r) && ruleHits(r, content));
  if (hits.length === 0) process.exit(0);

  for (const r of hits) {
    process.stdout.write(`BLOCKED by security-patterns (${r.rule_name || 'rule'}): ${r.reminder || 'matched a blocking security pattern'}\nFix the flagged pattern, or set block:false to downgrade to an advisory warning.\n`);
  }
  process.exit(2);
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
