'use strict';

const fs = require('fs');
const path = require('path');

// Layer order from lowest to highest — one-way imports only.
// Applied to both Python (<pkg>.<layer>) and JS/TS (path segments) imports.
// The topology is configurable per project via project-manifest.json:
//   "architecture": { "layers": [low..high], "layer_roots": ["src", "backend/src"] }
// Defaults preserve the original src/<layer>/ convention.
const DEFAULT_LAYERS = ['types', 'config', 'repository', 'service', 'api', 'ui'];
const DEFAULT_ROOTS = ['src'];
const DEFAULT_CONFIG = { layers: DEFAULT_LAYERS, roots: DEFAULT_ROOTS };

function isStringArray(a) {
  return Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string' && s.length > 0);
}

function loadLayerConfig(projectDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'project-manifest.json'), 'utf8'));
    const arch = manifest.architecture || {};
    return {
      layers: isStringArray(arch.layers) ? arch.layers : DEFAULT_LAYERS,
      roots: isStringArray(arch.layer_roots) ? arch.layer_roots : DEFAULT_ROOTS,
    };
  } catch (_) {
    return DEFAULT_CONFIG;
  }
}

function getLayer(filePath, config = DEFAULT_CONFIG) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const root of config.roots) {
    for (const layer of config.layers) {
      const seg = `${root}/${layer}/`;
      if (normalized.includes(`/${seg}`) || normalized.startsWith(seg)) {
        return layer;
      }
    }
  }
  return null;
}

function getHigherLayers(layer, config = DEFAULT_CONFIG) {
  const idx = config.layers.indexOf(layer);
  if (idx === -1) return [];
  return config.layers.slice(idx + 1);
}

// Python check: `from <pkg>.<layer>` / `import <pkg>.<layer>` upward imports,
// where <pkg> is the last path segment of each layer root (src for backend/src).
function checkPythonViolations(filePath, content, currentLayer, higherLayers, config) {
  // Escape regex metacharacters: roots come from an agent-writable manifest,
  // and a pathological pattern like (a+)+$ would wedge the gate (ReDoS).
  const pkgs = [...new Set(config.roots.map((r) => r.replace(/\\/g, '/').split('/').filter(Boolean).pop()))]
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const importRe = new RegExp(`^(?:from|import)\\s+(?:${pkgs.join('|')})\\.(\\w+)`);
  const violations = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(importRe);
    if (match && higherLayers.includes(match[1])) {
      violations.push({ filePath, line: i + 1, layer: currentLayer, imported: match[1] });
    }
  }
  return violations;
}

// JS/TS heuristic: parse `import ... from '...'` and `require('...')` lines
// and look for path segments that match a higher layer name.
// Heuristic: only matches relative ('./...') and src-rooted ('@/...', 'src/...')
// paths; bare npm package names are ignored to keep false-positive rate low.
// Fails open on unparseable lines (no violation reported).
const JS_IMPORT_RE = /^(?:import\b.*?\bfrom\s+|(?:const|let|var)\s+.*?=\s*require\s*\()\s*['"]([^'"]+)['"]/;

function checkJsViolations(filePath, content, currentLayer, higherLayers) {
  const violations = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip comment lines.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    const match = trimmed.match(JS_IMPORT_RE);
    if (!match) continue;
    const importPath = match[1];
    // Only inspect relative paths and src-rooted aliases — ignore npm packages.
    if (!importPath.startsWith('.') && !importPath.startsWith('@/') && !importPath.startsWith('src/')) continue;
    // Normalise path separators.
    const parts = importPath.replace(/\\/g, '/').split('/');
    for (const part of parts) {
      if (higherLayers.includes(part)) {
        violations.push({ filePath, line: i + 1, layer: currentLayer, imported: part });
        break; // one violation per line is enough
      }
    }
  }
  return violations;
}

// Unified check: dispatches to the Python or JS/TS checker based on extension.
function checkContentViolations(filePath, content, config = DEFAULT_CONFIG) {
  const currentLayer = getLayer(filePath, config);
  if (!currentLayer) return [];
  const higherLayers = getHigherLayers(currentLayer, config);
  if (higherLayers.length === 0) return [];

  const ext = filePath.replace(/\\/g, '/').split('.').pop().toLowerCase();
  if (ext === 'py') {
    return checkPythonViolations(filePath, content, currentLayer, higherLayers, config);
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return checkJsViolations(filePath, content, currentLayer, higherLayers);
  }
  return [];
}

module.exports = { loadLayerConfig, getLayer, getHigherLayers, checkContentViolations };
