'use strict';

const fs = require('fs');
const path = require('path');

// Bounded-context boundary rules (gap G8) — the VERTICAL complement to the
// horizontal layer check (lib/layers). Two contexts (e.g. src/billing, src/user)
// may not reach into each other's internals; a cross-context import is allowed
// only via the target's public surface (its root, root/index, root/public,
// __init__) or an explicit allow-edge. This is the dependency-cruiser/ArchUnit
// rule the layer check can't express (both contexts may sit at the same layer).
//
// Opt-IN: active only when project-manifest.json#architecture.contexts is set.
// Most projects have no bounded contexts, so the default is off (no false
// positives on unconfigured repos). Config shape:
//   "architecture": { "contexts": {
//      "roots": ["src/billing", "src/user"],
//      "allow": [["billing", "user"]],            // billing may import user freely
//      "public": ["index", "public", "__init__"]  // optional; these defaults apply
//   }}

const DEFAULT_PUBLIC = ['index', 'public', '__init__'];
const JS_IMPORT_RE = /^(?:import\b.*?\bfrom\s+|(?:const|let|var)\s+.*?=\s*require\s*\()\s*['"]([^'"]+)['"]/;

function isStringArray(a) {
  return Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string' && s.length > 0);
}

function norm(s) {
  return String(s).replace(/\\/g, '/');
}

function contextNames(roots) {
  return roots.map((r) => norm(r).split('/').filter(Boolean).pop());
}

function loadContextConfig(projectDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    const c = manifest.architecture && manifest.architecture.contexts;
    if (!c || !isStringArray(c.roots)) return null; // opt-in: unconfigured → off
    return {
      roots: c.roots.map(norm),
      names: contextNames(c.roots),
      allow: Array.isArray(c.allow) ? c.allow.map((e) => e.map(String)) : [],
      public: isStringArray(c.public) ? c.public : DEFAULT_PUBLIC,
    };
  } catch (_) {
    return null;
  }
}

// Which context a source file belongs to: the context root that prefixes it.
function fileContext(filePath, config) {
  const f = norm(filePath);
  for (let i = 0; i < config.roots.length; i++) {
    const root = config.roots[i];
    if (f.startsWith(`${root}/`) || f.includes(`/${root}/`)) return config.names[i];
  }
  return null;
}

// Python uses dotted modules (src.billing.x); JS uses slashed paths (../billing/x).
function segmentsOf(importPath) {
  const p = norm(importPath);
  return (p.includes('/') ? p.split('/') : p.split('.')).filter(Boolean);
}

function importedContext(importPath, names) {
  return segmentsOf(importPath).find((seg) => names.includes(seg)) || null;
}

function stripExt(seg) {
  return String(seg).replace(/\.\w+$/, '');
}

// A cross-context import is allowed when it lands on the target's public surface:
// the context root itself (no segment after the name) or a public entry.
function isPublicImport(importPath, name, publicNames) {
  const segs = segmentsOf(importPath);
  const idx = segs.indexOf(name);
  if (idx === -1 || idx === segs.length - 1) return true; // importing the root = public
  return publicNames.includes(stripExt(segs[idx + 1]));
}

function isAllowedEdge(from, to, allow) {
  return allow.some(([a, b]) => a === from && b === to);
}

function extractImports(content, ext) {
  const out = [];
  const lines = String(content).split('\n');
  const py = ext === 'py';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('#') || t.startsWith('//') || t.startsWith('*')) continue;
    const m = py ? t.match(/^(?:from|import)\s+([.\w]+)/) : t.match(JS_IMPORT_RE);
    if (m) out.push({ line: i + 1, importPath: m[1] });
  }
  return out;
}

function checkContextContent(filePath, content, config) {
  if (!config) return [];
  const from = fileContext(filePath, config);
  if (!from) return [];
  const ext = norm(filePath).split('.').pop().toLowerCase();
  const violations = [];
  for (const { line, importPath } of extractImports(content, ext)) {
    const to = importedContext(importPath, config.names);
    if (!to || to === from) continue;
    if (isAllowedEdge(from, to, config.allow)) continue;
    if (isPublicImport(importPath, to, config.public)) continue;
    violations.push({ filePath, line, from, to, importPath });
  }
  return violations;
}

module.exports = {
  loadContextConfig, fileContext, importedContext, isPublicImport,
  isAllowedEdge, extractImports, checkContextContent,
};
