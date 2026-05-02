#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

// Layer order from lowest to highest
const LAYERS = ['types', 'config', 'repository', 'service', 'api'];

// Determine layer from file path
function getLayer(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const layer of LAYERS) {
    if (normalized.includes(`/src/${layer}/`)) {
      return layer;
    }
  }
  return null;
}

// Return layers that are strictly higher than the given layer
function getHigherLayers(layer) {
  const idx = LAYERS.indexOf(layer);
  if (idx === -1) return [];
  return LAYERS.slice(idx + 1);
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const filePath = (input.tool_input && input.tool_input.file_path) || '';

  if (!filePath) {
    process.exit(0);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.py') {
    process.exit(0);
  }

  // Only process files in paths containing src/
  if (!filePath.replace(/\\/g, '/').includes('/src/')) {
    process.exit(0);
  }

  const currentLayer = getLayer(filePath);
  if (!currentLayer) {
    process.exit(0);
  }

  const higherLayers = getHigherLayers(currentLayer);
  if (higherLayers.length === 0) {
    process.exit(0);
  }

  // Read file content
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    process.exit(0);
  }

  const lines = content.split('\n');
  let violated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Look for `from src.<layer>` or `import src.<layer>`
    const fromMatch = trimmed.match(/^from\s+src\.(\w+)/);
    const importMatch = trimmed.match(/^import\s+src\.(\w+)/);

    const importedSegment = (fromMatch && fromMatch[1]) || (importMatch && importMatch[1]);
    if (!importedSegment) continue;

    if (higherLayers.includes(importedSegment)) {
      const lineNum = i + 1;
      process.stdout.write(
        `BLOCKED: Architecture violation in ${filePath}:${lineNum} — ${currentLayer} cannot import from ${importedSegment}\nFix: Move the import to the correct layer, or extract the shared type to src/types/.\n`
      );
      violated = true;
    }
  }

  if (violated) {
    process.exit(2);
  }
} catch (_) {
  // Silent exit — stderr output triggers "hook error" in Claude Code
}

process.exit(0);
