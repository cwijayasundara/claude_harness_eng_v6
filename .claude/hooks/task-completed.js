#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

// Layer order from lowest to highest
const LAYERS = ['types', 'config', 'repository', 'service', 'api'];

function getLayer(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const layer of LAYERS) {
    if (normalized.includes(`/src/${layer}/`)) {
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

function findPyFiles(dir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findPyFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkArchitectureViolations(pyFiles) {
  const violations = [];

  for (const filePath of pyFiles) {
    const currentLayer = getLayer(filePath);
    if (!currentLayer) continue;

    const higherLayers = getHigherLayers(currentLayer);
    if (higherLayers.length === 0) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const fromMatch = trimmed.match(/^from\s+src\.(\w+)/);
      const importMatch = trimmed.match(/^import\s+src\.(\w+)/);
      const importedSegment = (fromMatch && fromMatch[1]) || (importMatch && importMatch[1]);
      if (!importedSegment) continue;

      if (higherLayers.includes(importedSegment)) {
        violations.push(`${filePath}:${i + 1} — ${currentLayer} cannot import from ${importedSegment}`);
      }
    }
  }

  return violations;
}

// Parse stdin — non-fatal if missing/invalid
try {
  JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
} catch (_) {
  // Non-blocking: continue even if stdin is invalid
}

// Find project root by walking up from script location to find .claude/
function findProjectDir(startDir) {
  let current = startDir;
  while (true) {
    const claudeDir = path.join(current, '.claude');
    if (fs.existsSync(claudeDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

const scriptDir = path.dirname(path.resolve(__filename));
const projectDir = findProjectDir(scriptDir) || process.cwd();

const srcDir = path.join(projectDir, 'src');

if (fs.existsSync(srcDir)) {
  const pyFiles = findPyFiles(srcDir);
  const violations = checkArchitectureViolations(pyFiles);

  if (violations.length > 0) {
    process.stdout.write('Architecture check: FAIL\n');
    for (const v of violations) {
      process.stdout.write(`  ${v}\n`);
    }
    process.stdout.write('Fix: Run /review to get specific findings, then fix before proceeding.\n');
  } else {
    process.stdout.write('Architecture check: PASS\n');
  }
} else {
  process.stdout.write('Architecture check: PASS (no src/ directory found)\n');
}

// Always remind about /review
process.stdout.write('Run /review before marking phase complete.\n');

// Non-blocking: always exit 0
process.exit(0);
