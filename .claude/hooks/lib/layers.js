'use strict';

// Layer order from lowest to highest — one-way imports only.
// Applied to both Python (src.<layer>) and JS/TS (path segments) imports.
const LAYERS = ['types', 'config', 'repository', 'service', 'api', 'ui'];

function getLayer(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const layer of LAYERS) {
    if (normalized.includes(`/src/${layer}/`) || normalized.startsWith(`src/${layer}/`)) {
      return layer;
    }
  }
  return null;
}

function getHigherLayers(layer) {
  const idx = LAYERS.indexOf(layer);
  if (idx === -1) return [];
  return LAYERS.slice(idx + 1);
}

// Python check: `from src.<layer>` / `import src.<layer>` upward imports.
function checkPythonViolations(filePath, content, currentLayer, higherLayers) {
  const violations = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const fromMatch = trimmed.match(/^from\s+src\.(\w+)/);
    const importMatch = trimmed.match(/^import\s+src\.(\w+)/);
    const imported = (fromMatch && fromMatch[1]) || (importMatch && importMatch[1]);
    if (imported && higherLayers.includes(imported)) {
      violations.push({ filePath, line: i + 1, layer: currentLayer, imported });
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
function checkContentViolations(filePath, content) {
  const currentLayer = getLayer(filePath);
  if (!currentLayer) return [];
  const higherLayers = getHigherLayers(currentLayer);
  if (higherLayers.length === 0) return [];

  const ext = filePath.replace(/\\/g, '/').split('.').pop().toLowerCase();
  if (ext === 'py') {
    return checkPythonViolations(filePath, content, currentLayer, higherLayers);
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return checkJsViolations(filePath, content, currentLayer, higherLayers);
  }
  return [];
}

module.exports = { getLayer, getHigherLayers, checkContentViolations };
