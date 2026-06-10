'use strict';

// Layer order from lowest to highest — one-way imports only
const LAYERS = ['types', 'config', 'repository', 'service', 'api'];

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

// Python-only check: `from src.<layer>` / `import src.<layer>` upward imports.
function checkContentViolations(filePath, content) {
  const currentLayer = getLayer(filePath);
  if (!currentLayer) return [];
  const higherLayers = getHigherLayers(currentLayer);
  if (higherLayers.length === 0) return [];

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

module.exports = { getLayer, getHigherLayers, checkContentViolations };
