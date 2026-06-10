'use strict';

const fs = require('fs');
const path = require('path');

const LANG_BY_SUFFIX = {
  '.py': 'python',
  '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.jsx': 'node',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.java': 'java',
  '.cs': 'csharp',
  '.go': 'go',
};

const NODE_PREFIX = {
  python: 'py',
  node: 'js',
  typescript: 'ts',
  java: 'java',
  csharp: 'cs',
  go: 'go',
};

function nodeId(language, relPath) {
  return `${NODE_PREFIX[language]}:${relPath}`;
}

const PATTERNS = {
  python: [
    { label: 'import', re: /^[ \t]*import[ \t]+([A-Za-z_][A-Za-z0-9_.]*)/gm },
    { label: 'from-import', re: /^[ \t]*from[ \t]+([A-Za-z_.][A-Za-z0-9_.]*)[ \t]+import[ \t]+([^\n#]+)/gm, symbolGroup: 2 },
    { label: 'class', re: /^[ \t]*class[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm },
    { label: 'def', re: /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm },
    { label: 'all-export', re: /^[ \t]*__all__[ \t]*=[ \t]*\[([^\]]+)\]/gm, symbolGroup: 1 },
  ],
  node: [
    { label: 'import', re: /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm },
    { label: 'require', re: /\brequire\(\s*['"]([^'"]+)['"]/gm },
    { label: 'export', re: /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm },
    { label: 'class', re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
    { label: 'func', re: /^\s*(?:async\s+)?function\s+\*?([A-Za-z_$][\w$]*)/gm },
    { label: 'topvar', re: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm },
  ],
  typescript: [
    { label: 'import', re: /^\s*import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm },
    { label: 'require', re: /\brequire\(\s*['"]([^'"]+)['"]/gm },
    { label: 'export', re: /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm },
    { label: 'class', re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
    { label: 'func', re: /^\s*(?:async\s+)?function\s+\*?([A-Za-z_$][\w$]*)/gm },
    { label: 'topvar', re: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/gm },
  ],
  java: [
    { label: 'import', re: /^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm },
    { label: 'package', re: /^\s*package\s+([A-Za-z0-9_.]+)\s*;/gm },
    { label: 'class', re: /^\s*(?:public\s+|abstract\s+|final\s+)*(?:class|interface|record|enum)\s+([A-Za-z_][\w]*)/gm },
  ],
  csharp: [
    { label: 'using', re: /^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm },
    { label: 'namespace', re: /^\s*namespace\s+([A-Za-z0-9_.]+)/gm },
    { label: 'class', re: /^\s*(?:public\s+|internal\s+|sealed\s+|abstract\s+|static\s+)*(?:class|interface|record|struct|enum)\s+([A-Za-z_][\w]*)/gm },
  ],
  go: [
    { label: 'package', re: /^\s*package\s+([A-Za-z_][\w]*)/gm },
    { label: 'import-line', re: /^\s*import\s+"([^"]+)"/gm },
    { label: 'import-block', re: /^\s*"([^"]+)"\s*$/gm },
    { label: 'func', re: /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)/gm },
    { label: 'type', re: /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/gm },
  ],
};

const IMPORT_LABELS = new Set([
  'import', 'from-import', 'require', 'using',
  'import-line', 'import-block', 'package',
]);
const SYMBOL_LABELS = new Set(['class', 'def', 'export', 'func', 'type', 'topvar']);
const NAMESPACE_LABELS = new Set(['namespace']);
const REEXPORT_LABELS = new Set(['from-import', 'all-export']);

function lineFor(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function applyPattern(spec, text, relPath, nid, edges, symbolSet) {
  const { label, re } = spec;
  for (const m of text.matchAll(re)) {
    const importTarget = m[1];
    if (IMPORT_LABELS.has(label)) {
      edges.push({
        source: nid,
        target: `ext:${importTarget}`,
        kind: 'imports',
        evidence: `${relPath}:${lineFor(text, m.index)} ${label} ${importTarget}`,
      });
    }
    if (SYMBOL_LABELS.has(label)) {
      symbolSet.add(importTarget);
    } else if (NAMESPACE_LABELS.has(label)) {
      symbolSet.add(`ns:${importTarget}`);
    }
    if (REEXPORT_LABELS.has(label) && spec.symbolGroup) {
      const tokenSrc = m[spec.symbolGroup] || '';
      for (const tok of tokenSrc.match(/[A-Za-z_][\w]*/g) || []) {
        if (tok === 'as') continue;
        symbolSet.add(tok);
      }
    }
  }
}

function extractFile(absPath, relPath) {
  const ext = path.extname(absPath).toLowerCase();
  const language = LANG_BY_SUFFIX[ext];
  if (!language) {
    return {
      node: { id: `unknown:${relPath}`, kind: 'file', language: 'unknown', path: relPath, symbols: [] },
      edges: [],
      warnings: [],
    };
  }
  const nid = nodeId(language, relPath);
  const node = { id: nid, kind: 'file', language, path: relPath, symbols: [] };
  const edges = [];
  const warnings = [];
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    warnings.push(`${relPath}: read error: ${err.message}`);
    return { node, edges, warnings };
  }
  const symbolSet = new Set();
  for (const spec of PATTERNS[language] || []) {
    applyPattern(spec, text, relPath, nid, edges, symbolSet);
  }
  node.symbols = [...symbolSet].sort();
  return { node, edges, warnings };
}

// Python call edges are produced by the AST indexer (code-map/scripts/code_index/),
// which only emits calls to locally-defined or explicitly-imported names. The old
// regex call scan (`sym:` edges) was removed: it fired on strings, comments, and
// builtins, polluting the graph with unresolvable targets.

module.exports = { LANG_BY_SUFFIX, NODE_PREFIX, nodeId, extractFile };
