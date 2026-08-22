'use strict';

// Agent write-scope contracts — pure decision layer (no git, no hook payload).
//
// WHY. Each agent prompt in `.claude/agents/` carries a prose ownership section
// ("Does Not Own", "never implements", "does not rewrite frozen sprint
// contracts") and a separate `tools:` grant that can contradict it. Prose binds
// nothing: code-reviewer.md is report-only and holds Write + Bash. SwarmForge's
// `squad` branch fixes this by pairing every role prompt with a machine-readable
// contract and testing that the two agree. This module is that contract's
// loader, its drift checker, and the single write decision both the hook and
// the CLI ask.
//
// SHAPE. `.claude/agents/<name>.contract.json`:
//
//   {
//     "agent": "code-reviewer",
//     "may_spawn": false,
//     "artifact_roots": ["specs/reviews/"],          // ALLOW-list (deny by default)
//     "forbidden_artifact_roots": ["specs/sprint-contracts/"],  // DENY-list
//     "why": "one line — what ownership this encodes"
//   }
//
// An `artifact_roots` list makes the contract deny-by-default: that agent may
// write there and nowhere else. Omitting it (a builder) means "anywhere except
// the deny-list". An EMPTY list is read-only — deny everywhere. The two forms
// exist because a reviewer's surface is small and enumerable while a builder's
// is the whole product tree, which no harness can enumerate for every project.

const fs = require('fs');
const path = require('path');

/** Tool names granted by an agent markdown file's `tools:` frontmatter list. */
function frontmatterTools(markdown) {
  const text = String(markdown || '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return [];
  const tools = [];
  let inTools = false;
  for (const line of fm[1].split(/\r?\n/)) {
    if (/^tools:\s*$/.test(line)) { inTools = true; continue; }
    if (inTools && /^\s+-\s+/.test(line)) { tools.push(line.replace(/^\s+-\s+/, '').trim()); continue; }
    if (inTools && /^\S/.test(line)) break; // next top-level key ends the list
  }
  return tools;
}

/** Agent names shipped in `dir` (one `<name>.md` each, contract files excluded). */
function agentNames(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return []; }
  return entries.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

/** Map of agent name -> parsed contract, for every contract present in `dir`. */
function loadContracts(dir) {
  const out = new Map();
  for (const name of agentNames(dir)) {
    let raw;
    try { raw = fs.readFileSync(path.join(dir, `${name}.contract.json`), 'utf8'); } catch (_) { continue; }
    try { out.set(name, JSON.parse(raw)); } catch (_) { /* reported by validateContracts */ }
  }
  return out;
}

/** Every root must be a repo-relative directory prefix, so the write test is unambiguous. */
function rootShapeErrors(name, label, roots) {
  const errors = [];
  for (const root of roots) {
    if (typeof root !== 'string' || root === '') {
      errors.push(`${name}: ${label} contains an empty root`);
      continue;
    }
    if (path.isAbsolute(root)) {
      errors.push(`${name}: ${label} "${root}" is absolute — roots are repo-relative`);
    }
    if (!root.endsWith('/')) {
      errors.push(`${name}: ${label} "${root}" has no trailing / — a root is a directory prefix`);
    }
  }
  return errors;
}

/** Shape of both root lists, plus the overlap that would make a decision ambiguous. */
function rootListErrors(name, contract) {
  const allow = contract.artifact_roots || [];
  const deny = contract.forbidden_artifact_roots || [];
  const errors = [
    ...rootShapeErrors(name, 'artifact_roots', allow),
    ...rootShapeErrors(name, 'forbidden_artifact_roots', deny),
  ];
  for (const root of allow) {
    if (deny.includes(root)) {
      errors.push(`${name}: "${root}" is in BOTH lists — the write decision would be ambiguous (overlap)`);
    }
  }
  return errors;
}

/** The contract and the `tools:` grant must describe the same agent. */
function grantAgreementErrors(name, contract, markdown) {
  const errors = [];
  const tools = frontmatterTools(markdown);
  const grantsWrite = tools.some((t) => t === 'Write' || t === 'Edit' || t === 'NotebookEdit');
  const grantsSpawn = tools.some((t) => t === 'Agent' || t === 'Task');

  if (contract.may_spawn === false && grantsSpawn) {
    errors.push(`${name}: contract says may_spawn:false but the tools grant carries Agent — one of them is lying`);
  }
  if (contract.may_spawn === true && !grantsSpawn) {
    errors.push(`${name}: contract says may_spawn:true but the tools grant has no Agent tool`);
  }
  if (Array.isArray(contract.artifact_roots) && contract.artifact_roots.length === 0 && grantsWrite) {
    errors.push(`${name}: contract is read-only (artifact_roots: []) but the tools grant carries Write/Edit`);
  }
  return errors;
}

function isPlainList(value) {
  return value === undefined || Array.isArray(value);
}

/** Findings for one agent: contract present, parseable, self-consistent, honest. */
function contractErrors(dir, name) {
  const file = path.join(dir, `${name}.contract.json`);
  if (!fs.existsSync(file)) {
    return [`${name}: no contract — every agent needs ${name}.contract.json (write scope is not prose)`];
  }

  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return [`${name}: contract is not valid JSON (${err.message})`];
  }

  const errors = [];
  if (contract.agent !== name) {
    errors.push(`${name}: contract names agent "${contract.agent}" — must match the file it sits beside`);
  }
  if (!isPlainList(contract.artifact_roots) || !isPlainList(contract.forbidden_artifact_roots)) {
    errors.push(`${name}: artifact_roots and forbidden_artifact_roots must be arrays when present`);
    return errors;
  }
  if (typeof contract.why !== 'string' || contract.why.trim() === '') {
    errors.push(`${name}: contract needs a one-line "why" — an unexplained scope is unmaintainable`);
  }
  errors.push(...rootListErrors(name, contract));
  errors.push(...grantAgreementErrors(name, contract, fs.readFileSync(path.join(dir, `${name}.md`), 'utf8')));
  return errors;
}

/** Contract files left behind by a deleted agent — dead weight that reads as coverage. */
function orphanContractErrors(dir, names) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.contract.json'))
    .map((f) => f.slice(0, -'.contract.json'.length))
    .filter((name) => !names.includes(name))
    .map((name) => `${name}.contract.json: no ${name}.md — contract for an agent that does not exist`);
}

/**
 * Static drift between the contract set and the agent frontmatter it describes.
 * Returns a list of human-readable findings; empty means consistent.
 */
function validateContracts(dir) {
  const names = agentNames(dir);
  if (names.length === 0) return [`no agent markdown files found under ${dir}`];
  const errors = [];
  for (const name of names) errors.push(...contractErrors(dir, name));
  errors.push(...orphanContractErrors(dir, names));
  return errors;
}

/** Repo-relative, forward-slashed, with `..` resolved. Null if it escapes the repo. */
function normalizeRelative(relPath) {
  const resolved = path.posix.normalize(String(relPath || '').replace(/\\/g, '/'));
  if (resolved.startsWith('../') || resolved === '..') return null;
  return resolved.replace(/^\.\//, '');
}

function underRoot(rel, root) {
  // Roots end in "/", so a prefix test is already segment-safe:
  // "specs/reviews/" does not match "specs/reviews-draft/x".
  return rel === root.slice(0, -1) || rel.startsWith(root);
}

function denialReason(contract, rel) {
  const agent = contract.agent || 'agent';
  const allow = contract.artifact_roots;
  const where = allow.length === 0
    ? 'it is read-only and writes nothing'
    : `it may write only under ${allow.join(', ')}`;
  return `${agent} may not write ${rel}: ${where} `
    + `(.claude/agents/${agent}.contract.json). Report findings instead of applying them.`;
}

/**
 * May `contract`'s agent write `relPath`?
 * A missing contract is ALLOW: an unknown agent (general-purpose, a plugin's
 * own) is not this harness's to scope, and over-blocking stalls the build loop.
 * @returns {{allow: boolean, reason?: string}}
 */
function writeDecision(contract, relPath) {
  if (!contract) return { allow: true };

  const agent = contract.agent || 'agent';
  const rel = normalizeRelative(relPath);
  if (rel === null) {
    return { allow: false, reason: `${agent}: write path escapes the project (${relPath})` };
  }

  for (const root of contract.forbidden_artifact_roots || []) {
    if (underRoot(rel, root)) {
      return {
        allow: false,
        reason: `${agent} may not write ${rel}: "${root}" is closed to it by `
          + `.claude/agents/${agent}.contract.json${contract.why ? ` (${contract.why})` : ''}`,
      };
    }
  }

  if (!Array.isArray(contract.artifact_roots)) return { allow: true };
  if (contract.artifact_roots.some((root) => underRoot(rel, root))) return { allow: true };
  return { allow: false, reason: denialReason(contract, rel) };
}

module.exports = {
  agentNames,
  frontmatterTools,
  loadContracts,
  normalizeRelative,
  validateContracts,
  writeDecision,
};
