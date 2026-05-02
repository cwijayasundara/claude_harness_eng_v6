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

let input;
try {
  input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
} catch (_) {
  process.exit(0);
}

const command = (input.tool_input && input.tool_input.command) || '';

// Only activate on git commit commands
if (!command.includes('git commit')) {
  process.exit(0);
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

if (!fs.existsSync(srcDir)) {
  process.exit(0);
}

const pyFiles = findPyFiles(srcDir);
const violations = checkArchitectureViolations(pyFiles);

if (violations.length > 0) {
  process.stdout.write('BLOCKED: Architecture violations found — fix before committing:\n');
  for (const v of violations) {
    process.stdout.write(`  ${v}\n`);
  }
  process.stdout.write('Fix: Move imports to the correct layer or extract shared types to src/types/.\n');
  process.exit(2);
}

process.exit(0);
